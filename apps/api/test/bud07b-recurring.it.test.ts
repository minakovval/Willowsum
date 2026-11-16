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
import {
  createRecurringCategoryUsage,
  createRecurringErasure,
  createRecurringServices,
} from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-07@PoC b1) (wave 2 row 26): the statuses of the charges through the real API on a real PostgreSQL — a charge
 * matched by the merchant or the category (FR 8), the expected amount the charges change, with its audit entry from the
 * system (FR 11, AC3), a charge in another currency (FR 12, AC7), «Позначити пропущеним» (FR 21, AC16), «Зарахувати за
 * <місяць>» (FR 20, AC14), «Можливо, скасований» and «Залишити» (FR 10, AC4), two actions at once, another space, a
 * scoped member, the release flag and the space's erasure. Every description and amount is synthetic; the clock is fixed
 * (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const FLAG = "recurring.payments";

let db: RealModulesDatabase;
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

async function categoryId(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const all = (res.json().groups as { categories: { id: string; name: string }[] }[]).flatMap(
    (g) => g.categories,
  );
  return all.find((c) => c.name === name)!.id;
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
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
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

const charge = (all: ChargeBody[], dueOn: string) => all.find((c) => c.dueOn === dueOn)!;

const systemUpdates = (householdId: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'recurring.payment' AND action = 'update' AND actor_kind = 'system'",
    householdId,
  );

describe("BUD-07@PoC FR 8, FR 9: the charges are matched to the space's transactions on every read", () => {
  it("BUD-07@PoC AC3: 15,49 € streaming charged 17,99 € — the expected amount is 17,99 €, audited once from the system", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    const confirmed = await call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const id = confirmed.json().id as string;
    const up = await tx(space, account, "2026-11-16", "-17.99", "NETFLIX.COM 8812");

    // Two reads at once find the same change: one writes it.
    const [a, b] = await Promise.all([
      call(space, "GET", "/v1/recurring/statuses"),
      call(space, "GET", "/v1/recurring/statuses"),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const s = await statusOf(space, id);
    expect(s).toMatchObject({
      state: "active",
      expectedAmount: { amount: "17.99", currency: "EUR" },
      amountChange: {
        from: { amount: "15.49", currency: "EUR" },
        to: { amount: "17.99", currency: "EUR" },
        on: "2026-11-16",
      },
      lastCharge: { dueOn: "2026-11-14", status: "paid", transactionId: up, paidOn: "2026-11-16" },
      nextCharge: { dueOn: "2026-12-14", status: "expected", transactionId: null },
    });
    expect(await systemUpdates(space.householdId)).toBe(1);
    const payment = await call(space, "GET", `/v1/recurring/payments/${id}`);
    expect(payment.json().expectedAmount).toEqual({ amount: "17.99", currency: "EUR" });
  });

  it("BUD-07@PoC FR 8: «сплачено» with the transaction, «очікується» to come; FR 8 — matched by the category within ± 10 %", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const category = await categoryId(space, "Підписки");
    const id = await manual(
      space,
      {
        name: "Квартплата",
        amount: { amount: "90.00", currency: "EUR" },
        anchorDate: "2026-10-28",
        categoryId: category,
      },
      "2026-10-01",
    );
    const paid = await tx(space, account, "2026-10-27", "-92.00", "KP OSBB 0042");
    const put = await call(space, "PUT", `/v1/transactions/${paid}/category`, { categoryId: category });
    expect(put.statusCode, put.body).toBe(200);
    const all = await chargesOf(space, id);
    expect(all.map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-11-28", "expected"],
      ["2026-10-28", "paid"],
    ]);
    expect(charge(all, "2026-10-28")).toMatchObject({ transactionId: paid, paidOn: "2026-10-27" });
    expect(await systemUpdates(space.householdId)).toBe(0);
  });

  it("BUD-07@PoC AC7: 10,00 £ expected, 11,50 € charged at 1 GBP = 1,15 € — paid; the expected amount is unchanged", async () => {
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-13"]) {
      await rate(date, "EUR", "46.00");
      await rate(date, "GBP", "52.90");
    }
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      await tx(space, account, date, "-11.50", "SPOTIFY UK 4410");
    const [p] = await proposals(space);
    const confirmed = await call(space, "POST", "/v1/recurring/proposals/confirm", {
      key: p!.key,
      amount: { amount: "10.00", currency: "GBP" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const id = confirmed.json().id as string;
    const nov = await tx(space, account, "2026-11-13", "-11.50", "SPOTIFY UK 4410");
    const all = await chargesOf(space, id);
    expect(charge(all, "2026-11-14")).toMatchObject({
      status: "paid",
      transactionId: nov,
      amount: { amount: "11.5", currency: "EUR" },
      approximate: false,
    });
    expect((await statusOf(space, id)).expectedAmount).toEqual({ amount: "10", currency: "GBP" });
    expect(await systemUpdates(space.householdId)).toBe(0);
  });
});

describe("BUD-07@PoC FR 21, FR 10: «Позначити пропущеним», «Можливо, скасований» and «Залишити»", () => {
  it("BUD-07@PoC AC16: an overdue charge marked skipped is «Пропущено», audited; AC15, AC10 — the others stay «Прострочено на N дн.»", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-09-05" },
      "2026-09-01",
    );
    const before = await chargesOf(space, id);
    expect(charge(before, "2026-10-05")).toMatchObject({ status: "overdue", overdueDays: 42 });
    expect(charge(before, "2026-11-05")).toMatchObject({ status: "overdue", overdueDays: 11 });
    const res = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-10-05/skip`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      dueOn: "2026-10-05",
      status: "skipped",
      markedOn: "2026-11-16",
      overdueDays: null,
    });
    expect(charge(await chargesOf(space, id), "2026-10-05").status).toBe("skipped");
    expect(await entries(space.householdId, "recurring.charge")).toBe(1);
    // Only an overdue charge: again, a charge to come, a date that is no charge.
    const again = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-10-05/skip`);
    expect([again.statusCode, again.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
    const future = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-12-05/skip`);
    expect([future.statusCode, future.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
    expect(
      (await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-10-06/skip`)).statusCode,
    ).toBe(404);
    expect(await entries(space.householdId, "recurring.charge")).toBe(1);
  });

  it("BUD-07@PoC AC4: misses in a row — «Можливо, скасований» until «Залишити», which counts them anew (audited)", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Sport Life", amount: { amount: "35.00", currency: "EUR" }, anchorDate: "2026-09-12" },
      "2026-09-01",
    );
    expect(
      (await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-09-12/skip`)).statusCode,
    ).toBe(200);
    expect(await statusOf(space, id)).toMatchObject({
      state: "possibly-cancelled",
      missesInRow: 3,
      lastCharge: { dueOn: "2026-11-12", status: "overdue", overdueDays: 4 },
    });
    const kept = await call(space, "POST", `/v1/recurring/payments/${id}/keep`);
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({ id, version: 2 });
    expect(await statusOf(space, id)).toMatchObject({ state: "active", missesInRow: 0 });
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'recurring.payment' AND action = 'update' AND actor_kind = 'user'",
        space.householdId,
      ),
    ).toBe(1);
    const again = await call(space, "POST", `/v1/recurring/payments/${id}/keep`);
    expect([again.statusCode, again.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
  });

  it("BUD-07@PoC FR 21: two «Позначити пропущеним» of one charge at once — one mark, one audit entry, the other 409", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    const url = `/v1/recurring/payments/${id}/charges/2026-10-05/skip`;
    const both = await Promise.all([call(space, "POST", url), call(space, "POST", url)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await n("recurring.charge_marks WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await entries(space.householdId, "recurring.charge")).toBe(1);
  });
});

describe("BUD-07@PoC FR 20: «Зарахувати за <місяць>»", () => {
  it("BUD-07@PoC AC14: an unmatched transaction pays the skipped September — «Сплачено із запізненням», one miss less, audited", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await manual(
      space,
      { name: "Воля", amount: { amount: "45.00", currency: "EUR" }, anchorDate: "2026-09-25" },
      "2026-09-01",
    );
    const other = await tx(space, account, "2026-10-30", "-45.00", "VOLIA*ONLINE PAY");
    const income = await tx(space, account, "2026-10-30", "45.00", "VOLIA REFUND");
    expect(
      (await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-09-25/skip`)).statusCode,
    ).toBe(200);
    expect((await statusOf(space, id)).missesInRow).toBe(2);

    // An income pays no expense.
    const wrong = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-09-25/settle`, {
      transactionId: income,
    });
    expect([wrong.statusCode, wrong.json().code]).toEqual([409, "RECURRING_TRANSACTION_TAKEN"]);
    const res = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-09-25/settle`, {
      transactionId: other,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      status: "paid-late",
      transactionId: other,
      paidOn: "2026-10-30",
      markedOn: "2026-11-16",
    });
    const all = await chargesOf(space, id);
    expect(charge(all, "2026-09-25")).toMatchObject({ status: "paid-late", transactionId: other });
    expect((await statusOf(space, id)).missesInRow).toBe(1);
    expect(await entries(space.householdId, "recurring.charge", "update")).toBe(1);
    // A transaction pays one charge; a paid charge takes no other.
    const twice = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-10-25/settle`, {
      transactionId: other,
    });
    expect([twice.statusCode, twice.json().code]).toEqual([409, "RECURRING_TRANSACTION_TAKEN"]);
    const paid = await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-09-25/settle`, {
      transactionId: other,
    });
    expect([paid.statusCode, paid.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
  });

  it("BUD-07@PoC FR 20: one transaction settled for two charges of two payments at once — one wins, nothing paid twice", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await manual(
      space,
      { name: "Воля", amount: { amount: "8.50", currency: "EUR" }, anchorDate: "2026-10-25" },
      "2026-10-01",
    );
    const b = await manual(
      space,
      { name: "Київстар", amount: { amount: "8.50", currency: "EUR" }, anchorDate: "2026-10-20" },
      "2026-10-01",
    );
    const t = await tx(space, account, "2026-11-01", "-8.50", "PAY 7731");
    const both = await Promise.all([
      call(space, "POST", `/v1/recurring/payments/${a}/charges/2026-10-25/settle`, { transactionId: t }),
      call(space, "POST", `/v1/recurring/payments/${b}/charges/2026-10-20/settle`, { transactionId: t }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await n("recurring.charge_marks WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await entries(space.householdId, "recurring.charge")).toBe(1);
  });
});

describe("BUD-07@PoC «Права доступу»: the statuses and actions of the space only", () => {
  it("BUD-07@PoC AC9: another space's payment is not found on every status route; nothing is written", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(owner);
    const id = await manual(
      owner,
      { name: "Садочок", amount: { amount: "300.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    const t = await tx(owner, account, "2026-11-01", "-300.00", "SADOCHOK 12");
    const list = await call(stranger, "GET", "/v1/recurring/statuses");
    expect(list.json()).toEqual({ items: [] });
    for (const [method, url, body] of [
      ["GET", `/v1/recurring/payments/${id}/charges`, undefined],
      ["POST", `/v1/recurring/payments/${id}/charges/2026-10-05/skip`, undefined],
      ["POST", `/v1/recurring/payments/${id}/charges/2026-10-05/settle`, { transactionId: t }],
      ["POST", `/v1/recurring/payments/${id}/keep`, undefined],
    ] as const) {
      const res = await call(stranger, method, url, body);
      expect(res.statusCode, url).toBe(404);
      const problem = res.json() as Record<string, unknown>;
      expect(String(problem.type), url).toContain("not-found");
      // Check the values, not the raw body: ids/trace/instance are random and may contain any digits.
      for (const value of Object.values(problem)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        expect(text, url).not.toContain("300.00");
        expect(text, url).not.toContain("Садочок");
        expect(text, url).not.toContain("SADOCHOK");
      }
    }
    expect(await n("recurring.charge_marks WHERE household_id = $1", owner.householdId)).toBe(0);
    expect(charge(await chargesOf(owner, id), "2026-10-05").status).toBe("overdue");
  });

  it("BUD-07@PoC «Права доступу»: a scoped member — not found on reads, refused on changes; the flag off — not found", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    const scoped = { role: "viewer", scoped: true };
    expect((await call(space, "GET", "/v1/recurring/statuses", undefined, scoped)).statusCode).toBe(404);
    expect(
      (await call(space, "GET", `/v1/recurring/payments/${id}/charges`, undefined, scoped)).statusCode,
    ).toBe(404);
    const skip = `/v1/recurring/payments/${id}/charges/2026-10-05/skip`;
    expect((await call(space, "POST", skip, undefined, scoped)).statusCode).toBe(403);
    expect((await call(space, "POST", skip, undefined, { role: "viewer" })).statusCode).toBe(403);
    off.add(FLAG);
    expect((await call(space, "GET", "/v1/recurring/statuses")).statusCode).toBe(404);
    expect((await call(space, "POST", skip)).statusCode).toBe(404);
    expect(await n("recurring.charge_marks WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the charges' marks too", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Спортзал", amount: { amount: "40.00", currency: "EUR" }, anchorDate: "2026-10-05" },
      "2026-10-01",
    );
    expect(
      (await call(space, "POST", `/v1/recurring/payments/${id}/charges/2026-10-05/skip`)).statusCode,
    ).toBe(200);
    await createRecurringErasure(db.databases.for("recurring")).eraseHousehold(space.householdId);
    expect(await n("recurring.charge_marks WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
