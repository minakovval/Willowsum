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
import { leakText } from "./leak-text.ts";
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
 * BUD-07@PoC b2) (wave 2 row 26): «Призупинити», «Позначити скасованим» and «Відновити» (FR 13) through the real API on a
 * real PostgreSQL — the held charges leave the statuses and the month's charges the budget reads («Можна витратити»),
 * the audit entries, two actions at once, another space, a scoped member and the space's erasure. Every name and amount
 * is synthetic; the clock is fixed (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");

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

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

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
  const recurring = createRecurringServices({
    history: createTransactionHistory(db.databases.for("transactions")),
    transactionCategories: createTransactionCategories(db.databases.for("categorization")),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    accounts: createAccountDirectory(db.databases.for("accounts")),
    categories,
    audit,
    clock: { now: () => NOW },
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
          pendingPostings: [],
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
        recurring,
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
  hold: string | null;
  expectedAmount: { amount: string; currency: string };
  amountChange: { from: unknown; to: unknown; on: string } | null;
  missesInRow: number;
  approximate: boolean;
  lastCharge: ChargeBody | null;
  nextCharge: ChargeBody | null;
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

interface PaymentBody {
  id: string;
  nextDate: string | null;
  version: number;
  holds: { kind: string; from: string; until: string | null }[];
}

const userUpdates = (householdId: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'recurring.payment' AND action = 'update' AND actor_kind = 'user'",
    householdId,
  );

/** «Воля · інтернет» 14,00 € on the 5th, added on 1 September; September and October settled, November overdue. */
async function internet(space: Space): Promise<string> {
  const account = await createAccount(space);
  const id = await manual(
    space,
    { name: "Воля · інтернет", amount: { amount: "14.00", currency: "EUR" }, anchorDate: "2026-09-05" },
    "2026-09-01",
  );
  // Paid by «Зарахувати» (FR 20, «Сплачено із запізненням»): a payment added by hand without a category matches nothing.
  for (const [due, date] of [
    ["2026-09-05", "2026-09-05"],
    ["2026-10-05", "2026-10-06"],
  ] as const) {
    const t = await tx(space, account, date, "-14.00", "VOLIA SYNTH");
    const settled = await call(space, "POST", `/v1/recurring/payments/${id}/charges/${due}/settle`, {
      transactionId: t,
    });
    expect(settled.statusCode, settled.body).toBe(200);
  }
  return id;
}

describe("sec653: payment_holds isolation and the hold routes", () => {
  it("sec653: recurring.payment_holds has forced row security, the household policy and grants only for its module", async () => {
    const { rows } = await db.owner.query<{ rls: boolean; forced: boolean; policies: number }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'recurring' AND p.tablename = 'payment_holds' AND p.policyname = 'household_isolation') AS policies
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'recurring' AND c.relname = 'payment_holds'`,
    );
    expect(rows).toEqual([{ rls: true, forced: true, policies: 1 }]);
    const grants = await db.owner.query<{ grantee: string; t: string }>(
      `SELECT DISTINCT grantee, table_name AS t FROM information_schema.role_table_grants
       WHERE table_schema = 'recurring' AND table_name IN ('payment_holds', 'payments') ORDER BY 1, 2`,
    );
    const of = (t: string) => grants.rows.filter((g) => g.t === t).map((g) => g.grantee);
    // The same grantees as the module's first table: nothing wider for the new one.
    expect(of("payment_holds")).toEqual(of("payments"));
    expect(of("payment_holds")).not.toContain("PUBLIC");
  });

  it("sec653: the row policy hides another space's holds without a household filter, refuses a foreign row, and another module cannot read the table", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const id = await internet(owner);
    expect((await call(owner, "POST", `/v1/recurring/payments/${id}/pause`, {})).statusCode).toBe(200);
    const recurringDb = db.databases.for("recurring");
    const seen = (householdId: string) =>
      recurringDb.inHousehold(
        householdId,
        async (q) => (await q.query(`SELECT 1 FROM payment_holds`)).rowCount,
      );
    expect(await seen(owner.householdId)).toBe(1);
    expect(await seen(other.householdId)).toBe(0);
    const foreign = recurringDb.inHousehold(other.householdId, (q) =>
      q.query(
        `INSERT INTO payment_holds (household_id, id, payment_id, kind, starts_on) VALUES ($1, $2, $3, 'pause', '2026-11-16')`,
        [owner.householdId, randomUUID(), id],
      ),
    );
    await expect(foreign).rejects.toMatchObject({ code: "42501" });
    const changed = await recurringDb.inHousehold(other.householdId, async (q) => [
      (await q.query(`UPDATE payment_holds SET ends_on = '2030-01-01'`)).rowCount,
      (await q.query(`DELETE FROM payment_holds`)).rowCount,
    ]);
    expect(changed).toEqual([0, 0]);
    const elsewhere = db.databases
      .for("categories")
      .inHousehold(owner.householdId, (q) => q.query(`SELECT 1 FROM recurring.payment_holds`));
    await expect(elsewhere).rejects.toMatchObject({ code: "42501" });
    expect(await n("recurring.payment_holds WHERE household_id = $1", owner.householdId)).toBe(1);
  });

  it("sec653: another space gets the same 404 as for an unknown id, with nothing of the payment; a viewer and a scoped member are refused on all three", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const id = await internet(owner);
    expect(
      (await call(owner, "POST", `/v1/recurring/payments/${id}/pause`, { until: "2026-12-31" })).statusCode,
    ).toBe(200);
    const strip = (body: string) => leakText(body).replace(/"(traceId|requestId|instance)":"[^"]*",?/g, "");
    for (const action of ["pause", "cancel", "resume"]) {
      const body = action === "pause" ? {} : undefined;
      const foreign = await call(other, "POST", `/v1/recurring/payments/${id}/${action}`, body);
      const unknown = await call(other, "POST", `/v1/recurring/payments/${randomUUID()}/${action}`, body);
      expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(strip(foreign.body)).toBe(strip(unknown.body));
      expect(leakText(foreign.body)).not.toContain("Воля");
      expect(leakText(foreign.body)).not.toContain("2026-12-31");
      expect(leakText(foreign.body)).not.toContain(owner.householdId);
      for (const principal of [{ role: "viewer" }, { scoped: true }]) {
        const res = await call(owner, "POST", `/v1/recurring/payments/${id}/${action}`, body, principal);
        expect(res.statusCode, `${action} ${JSON.stringify(principal)}`).toBe(403);
      }
    }
    const got = await call(other, "GET", `/v1/recurring/payments/${id}`);
    expect(got.statusCode).toBe(404);
    const list = await call(other, "GET", `/v1/recurring/payments`);
    expect(leakText(list.body)).not.toContain(id);
    expect(await n("recurring.payment_holds WHERE household_id = $1", owner.householdId)).toBe(1);
    expect(await userUpdates(owner.householdId)).toBe(1);
    expect(await userUpdates(other.householdId)).toBe(0);
  });

  it("sec653: a malformed pause body is refused with 400 and nothing is written", async () => {
    const space = await newSpace();
    const id = await internet(space);
    const bodies: unknown[] = [
      { until: "2026-12-31T00:00:00Z" },
      { until: "20261231" },
      { until: "2026-13-01" },
      { until: "31.12.2026" },
      { until: 20261231 },
      { until: "2026-12-31", from: "2020-01-01" },
      { until: "2026-12-31", kind: "cancel" },
      { until: "' OR 1=1" },
      { until: "" },
    ];
    for (const b of bodies) {
      const res = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, b);
      expect(res.statusCode, JSON.stringify(b)).toBe(400);
      expect(leakText(res.body)).not.toMatch(/payment_holds|SELECT|INSERT|stack|\.ts:/);
    }
    expect(await n("recurring.payment_holds WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await userUpdates(space.householdId)).toBe(0);
  });

  it(
    "sec653: a pause to a date near the end of the calendar is refused (400) and nothing is stored — the reads of the space's payments stay fast",
    { timeout: 120_000 },
    async () => {
      const space = await newSpace();
      const id = await manual(
        space,
        {
          name: "Синтетична підписка",
          frequency: "week",
          amount: { amount: "3.00", currency: "EUR" },
          anchorDate: "2026-11-02",
        },
        "2026-11-01",
      );
      for (const until of ["9999-12-28", "9999-12-31", "2036-11-24"]) {
        const res = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, { until });
        expect(res.statusCode, until).toBe(400);
      }
      expect(await n("recurring.payment_holds WHERE household_id = $1", space.householdId)).toBe(0);
      expect(await userUpdates(space.householdId)).toBe(0);
      const started = Date.now();
      expect((await call(space, "GET", "/v1/recurring/payments")).statusCode).toBe(200);
      expect(Date.now() - started).toBeLessThan(2000);
      // The furthest date allowed (3660 days after 16 November 2026) still works.
      const ok = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, { until: "2036-11-23" });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((ok.json() as PaymentBody).nextDate).toBe("2036-11-24");
    },
  );

  it("sec653: different hold actions at once on one payment leave one consistent state and one audit entry per success", async () => {
    for (let round = 0; round < 3; round += 1) {
      const space = await newSpace();
      const id = await internet(space);
      const url = (a: string) => `/v1/recurring/payments/${id}/${a}`;
      const first = await Promise.all([
        call(space, "POST", url("pause"), {}),
        call(space, "POST", url("cancel")),
        call(space, "POST", url("pause"), { until: "2026-12-31" }),
        call(space, "POST", url("cancel")),
      ]);
      const codes = first.map((r) => r.statusCode);
      expect(codes.filter((c) => c !== 200 && c !== 409)).toEqual([]);
      const ok = codes.filter((c) => c === 200).length;
      expect(await userUpdates(space.householdId)).toBe(ok);
      const open = await n(
        "recurring.payment_holds WHERE household_id = $1 AND ends_on IS NULL",
        space.householdId,
      );
      expect(open).toBeLessThanOrEqual(1);
      expect((await statusOf(space, id)).hold).toMatch(/^(paused|cancelled)$/);
      const resumes = await Promise.all([
        call(space, "POST", url("resume")),
        call(space, "POST", url("resume")),
      ]);
      expect(resumes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await userUpdates(space.householdId)).toBe(ok + 1);
      expect((await statusOf(space, id)).state).toBe("active");
      expect((await statusOf(space, id)).hold).toBeNull();
    }
  });
});
