import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import { createRecurringCategoryUsage, createRecurringServices } from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";

/**
 * Security review of PR #344 (BUD-07@PoC b1, wave 2 row 26) through the real API on a real PostgreSQL: the expected
 * amount a read writes (FR 11 «без автора») — once, in the reader's space only, without personal data; «Зарахувати»
 * takes a transaction of the caller's space only (AC9); the cost of one read does not grow with a far anchor date or
 * with the number of transactions in another currency (FR 8, FR 12). Every description and amount is synthetic; the
 * clock is fixed (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");

let db: RealModulesDatabase;
/** Calls of module fx-rates made by module recurring (each call is at least one query of rates). */
let fxCalls = 0;
function countedFx<T extends object>(fx: T): T {
  return new Proxy(fx, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        fxCalls += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
testTelemetryForFile();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface ProposalBody {
  key: string;
  merchant: { id: string; name: string };
  frequency: string;
  expectedAmount: { amount: string; currency: string };
  anchorDate: string;
  accountId: string;
  transactionIds: string[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function createAccount(space: Space, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function tx(space: Space, accountId: string, date: string, amount: string, counterparty: string) {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    counterparty,
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function proposals(space: Space): Promise<ProposalBody[]> {
  const res = await call(space, "GET", "/v1/recurring/proposals");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as ProposalBody[];
}

/** A monthly streaming subscription on the 14th: Aug, Sep, Oct — proposed today (FR 2). */
async function streaming(space: Space, account: string): Promise<string[]> {
  const ids: string[] = [];
  for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
    ids.push(await tx(space, account, date, "-15.49", "NETFLIX.COM 8812"));
  return ids;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const entries = (householdId: string, entity: string, action = "create") =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3",
    householdId,
    entity,
    action,
  );

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const categories = createCategoryDirectory({
    db: db.databases.for("categories"),
    audit,
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          walletUsage: [],
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories,
          flags: { isEnabled },
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories,
          audit,
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [createRecurringCategoryUsage(db.databases.for("recurring"))],
        }),
        recurring: createRecurringServices({
          history: createTransactionHistory(db.databases.for("transactions")),
          transactionCategories: createTransactionCategories(db.databases.for("categorization")),
          fx: countedFx(createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW })),
          merchants: createMerchantDirectory(db.databases.for("merchants")),
          accounts: createAccountDirectory(db.databases.for("accounts")),
          categories,
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

interface ChargeBody {
  dueOn: string;
  status: string;
  transactionId: string | null;
  paidOn: string | null;
  overdueDays: number | null;
  markedOn: string | null;
  approximate: boolean;
  expectedAmount: { amount: string; currency: string };
  amount: { amount: string; currency: string } | null;
}

interface StatusBody {
  paymentId: string;
  state: string;
  expectedAmount: { amount: string; currency: string };
  amountChange: { from: unknown; to: unknown; on: string } | null;
  missesInRow: number;
  approximate: boolean;
  lastCharge: ChargeBody | null;
  nextCharge: ChargeBody | null;
}

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

/** A payment added by hand on `createdOn` (the clock is fixed: the test moves the day it was added back). */
async function manual(space: Space, body: Record<string, unknown>, createdOn: string): Promise<string> {
  const res = await call(space, "POST", "/v1/recurring/payments", {
    type: "expense",
    frequency: "month",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await db.owner.query(`UPDATE recurring.payments SET created_on = $3 WHERE household_id = $1 AND id = $2`, [
    space.householdId,
    id,
    createdOn,
  ]);
  return id;
}

async function statusOf(space: Space, paymentId: string): Promise<StatusBody> {
  const res = await call(space, "GET", "/v1/recurring/statuses");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().items as StatusBody[]).find((s) => s.paymentId === paymentId)!;
}

async function chargesOf(space: Space, paymentId: string): Promise<ChargeBody[]> {
  const res = await call(space, "GET", `/v1/recurring/payments/${paymentId}/charges`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as ChargeBody[];
}

const systemUpdates = (householdId: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'recurring.payment' AND action = 'update' AND actor_kind = 'system'",
    householdId,
  );

async function streamingPayment(space: Space, account: string): Promise<string> {
  await streaming(space, account);
  const [p] = await proposals(space);
  const confirmed = await call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key });
  expect(confirmed.statusCode, confirmed.body).toBe(201);
  return confirmed.json().id as string;
}

describe("sec344 BUD-07@PoC FR 11: the expected amount written by a read («без автора»)", () => {
  it("BUD-07@PoC FR 11: eight reads at once and later reads write the new amount once — one system audit entry", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await streamingPayment(space, account);
    await tx(space, account, "2026-11-16", "-17.99", "NETFLIX.COM 8812");
    const all = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call(space, "GET", i % 2 ? "/v1/recurring/statuses" : `/v1/recurring/payments/${id}/charges`),
      ),
    );
    expect(all.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    for (let i = 0; i < 3; i += 1) await statusOf(space, id);
    expect(await systemUpdates(space.householdId)).toBe(1);
    const { rows } = await db.owner.query<{ expected: string; current: string; version: number }>(
      `SELECT expected_amount::text AS expected, current_amount::text AS current, version FROM recurring.payments
        WHERE household_id = $1 AND id = $2`,
      [space.householdId, id],
    );
    // The amount the user set stays; the optimistic version is not bumped by the system's write.
    expect(Number(rows[0]!.expected)).toBe(15.49);
    expect(Number(rows[0]!.current)).toBe(17.99);
    expect(rows[0]!.version).toBe(1);
  });

  it("BUD-07@PoC FR 11: a read in one space writes nothing in another; the entry has no actor and no personal data", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const id = await streamingPayment(space, account);
    await streamingPayment(other, otherAccount);
    await tx(space, account, "2026-11-16", "-17.99", "NETFLIX.COM 8812");
    await tx(other, otherAccount, "2026-11-16", "-17.99", "NETFLIX.COM 8812");
    await statusOf(space, id);
    expect(await systemUpdates(space.householdId)).toBe(1);
    expect(await systemUpdates(other.householdId)).toBe(0);
    expect(
      await n("recurring.payments WHERE household_id = $1 AND current_amount IS NOT NULL", other.householdId),
    ).toBe(0);
    const { rows } = await db.owner.query<Record<string, unknown>>(
      `SELECT * FROM audit.entries WHERE household_id = $1 AND entity_type = 'recurring.payment' AND actor_kind = 'system'`,
      [space.householdId],
    );
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain(space.accountId);
    expect(text).not.toContain("NETFLIX");
  });

  it("BUD-07@PoC FR 11: the hidden charge takes the amount back — one more system entry, then none (no entry per read)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await streamingPayment(space, account);
    const up = await tx(space, account, "2026-11-16", "-17.99", "NETFLIX.COM 8812");
    await statusOf(space, id);
    // «Приховати» (FIN-03 FR 16) needs the duplicates service this harness does not mount: the row is hidden directly.
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [up]);
    for (let i = 0; i < 3; i += 1)
      expect((await statusOf(space, id)).expectedAmount).toEqual({ amount: "15.49", currency: "EUR" });
    expect(await systemUpdates(space.householdId)).toBe(2);
  });
});

describe("sec344 BUD-07@PoC FR 20, AC9: «Зарахувати» takes a transaction of the caller's space only", () => {
  it("BUD-07@PoC AC9: another space's transaction answers as one that does not exist; no mark, no audit entry", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(owner);
    const foreignAccount = await createAccount(stranger);
    const id = await manual(
      owner,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    await tx(owner, account, "2026-11-01", "-12.00", "SYNTHETIC SHOP 1");
    const foreign = await tx(stranger, foreignAccount, "2026-11-01", "-40.00", "SPORTZAL 77");
    const url = `/v1/recurring/payments/${id}/charges/2026-10-05/settle`;
    const a = await call(owner, "POST", url, { transactionId: foreign });
    const b = await call(owner, "POST", url, { transactionId: randomUUID() });
    expect(a.statusCode).toBe(409);
    expect(JSON.parse(a.body).code ?? JSON.parse(a.body).type).toEqual(
      JSON.parse(b.body).code ?? JSON.parse(b.body).type,
    );
    expect(b.statusCode).toBe(409);
    expect(a.json().title).toBe(b.json().title);
    expect(await n("recurring.charge_marks WHERE household_id = $1", owner.householdId)).toBe(0);
    expect(await entries(owner.householdId, "recurring.charge")).toBe(0);
    // The stranger's transaction stays free in its own space.
    expect(await n("recurring.charge_marks WHERE transaction_id = $1", foreign)).toBe(0);
  });

  it("BUD-07@PoC FR 20: an income transaction does not pay an expense; a transaction a charge took is refused", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await streamingPayment(space, account);
    await db.owner.query(
      `UPDATE recurring.payments SET created_on = '2026-08-01', anchor_date = '2026-08-14' WHERE id = $1`,
      [id],
    );
    const other = await manual(
      space,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    const income = await tx(space, account, "2026-11-01", "40.00", "SYNTHETIC REFUND");
    const url = `/v1/recurring/payments/${other}/charges/2026-10-05/settle`;
    expect((await call(space, "POST", url, { transactionId: income })).statusCode).toBe(409);
    const used = (await chargesOf(space, id)).find((c) => c.transactionId !== null)!.transactionId;
    expect((await call(space, "POST", url, { transactionId: used })).statusCode).toBe(409);
    expect(await n("recurring.charge_marks WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-07@PoC FR 20: two transactions settled for one charge at once — one pays it, the other is refused; one mark, one audit entry", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (let round = 0; round < 4; round += 1) {
      const id = await manual(
        space,
        { name: `Спортзал ${round}`, amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
        "2026-10-01",
      );
      const a = await tx(space, account, "2026-11-01", "-12.00", "SYNTHETIC SHOP 1");
      const b = await tx(space, account, "2026-11-02", "-13.00", "SYNTHETIC SHOP 2");
      const url = `/v1/recurring/payments/${id}/charges/2026-10-05/settle`;
      const both = await Promise.all([
        call(space, "POST", url, { transactionId: a }),
        call(space, "POST", url, { transactionId: b }),
      ]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const won = both.find((r) => r.statusCode === 200)!.json().transactionId as string;
      const { rows } = await db.owner.query<{ transaction_id: string }>(
        `SELECT transaction_id FROM recurring.charge_marks WHERE household_id = $1 AND payment_id = $2`,
        [space.householdId, id],
      );
      expect(rows.map((r) => r.transaction_id)).toEqual([won]);
      expect(await entries(space.householdId, "recurring.charge")).toBe(round + 1);
      expect(await entries(space.householdId, "recurring.charge", "update")).toBe(0);
    }
  });
});

describe("sec344 BUD-07@PoC FR 8: the cost of one read is bounded", () => {
  it("BUD-07@PoC FR 8: payments anchored far in the future or the past do not hold the API", async () => {
    const space = await newSpace();
    await createAccount(space);
    const anchors = Array.from({ length: 19 }, (_, i) => `9999-12-${String(10 + i)}`);
    for (const anchorDate of [...anchors, "0100-01-01"]) {
      const res = await call(space, "POST", "/v1/recurring/payments", {
        type: "expense",
        frequency: "week",
        name: "Синтетичний",
        amount: { amount: "1.00", currency: "EUR" },
        anchorDate,
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    await call(space, "GET", "/v1/recurring/statuses");
    const started = performance.now();
    const res = await call(space, "GET", "/v1/recurring/statuses");
    const ms = performance.now() - started;
    expect(res.statusCode, res.body).toBe(200);
    console.error(`sec344 far anchors: ${Math.round(ms)} ms for 20 payments`);
    expect(ms).toBeLessThan(400);
  });

  it("BUD-07@PoC FR 12: 300 transactions in another currency are converted with one call of rates per read, not one each", async () => {
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"]) {
      await rate(date, "EUR", "46.00");
      await rate(date, "GBP", "52.90");
    }
    const space = await newSpace();
    const account = await createAccount(space);
    const ids: string[] = [];
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      ids.push(await tx(space, account, date, "-11.50", "SPOTIFY UK 4410"));
    const [p] = await proposals(space);
    const confirmed = await call(space, "POST", "/v1/recurring/proposals/confirm", {
      key: p!.key,
      amount: { amount: "10.00", currency: "GBP" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const id = confirmed.json().id as string;
    // 300 more charges of the merchant in EUR, as an imported statement leaves them.
    const { rows } = await db.owner.query<{ c: string }>(
      `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'transactions'
         AND table_name = 'transactions' AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => r.c);
    const select = cols
      .map((c) =>
        c === "id" ? "gen_random_uuid()" : c === "occurred_on" ? "date '2026-11-16' - (g % 90)" : `t.${c}`,
      )
      .join(", ");
    await db.owner.query(
      `INSERT INTO transactions.transactions (${cols.join(", ")})
       SELECT ${select} FROM transactions.transactions t, generate_series(1, 300) g WHERE t.id = $1`,
      [ids[0]],
    );
    fxCalls = 0;
    const status = await statusOf(space, id);
    expect(status.expectedAmount).toEqual({ amount: "10", currency: "GBP" });
    expect(status.lastCharge).toMatchObject({ dueOn: "2026-11-14", status: "paid" });
    expect(fxCalls).toBeLessThanOrEqual(1);
  });
});
