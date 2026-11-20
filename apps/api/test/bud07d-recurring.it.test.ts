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
  createRecurringMonth,
  createRecurringServices,
  type RecurringMonth,
} from "../src/modules/recurring/index.ts";
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
let month: RecurringMonth;
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
  month = createRecurringMonth(db.databases.for("recurring"), recurring);
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

async function chargesOf(space: Space, paymentId: string): Promise<ChargeBody[]> {
  const res = await call(space, "GET", `/v1/recurring/payments/${paymentId}/charges`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as ChargeBody[];
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

const monthOf = async (space: Space, period: string, paymentId: string) =>
  (await month.chargesIn(space.householdId, period))
    .filter((c) => c.paymentId === paymentId)
    .map((c) => [c.dueOn, c.status]);

describe("BUD-07@PoC FR 13: «Призупинити» and «Відновити»", () => {
  it("BUD-07@PoC FR 13: paused to a date — its charges and its share of «Можна витратити» are gone until then; audited", async () => {
    const space = await newSpace();
    const id = await internet(space);
    expect(await monthOf(space, "2026-12", id)).toEqual([["2026-12-05", "expected"]]);
    const res = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, { until: "2026-12-31" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json() as PaymentBody).toMatchObject({
      id,
      nextDate: "2027-01-05",
      holds: [{ kind: "pause", from: "2026-11-16", until: "2026-12-31" }],
    });
    // November's miss stays counted while paused; «Відновити» counts anew.
    expect(await statusOf(space, id)).toMatchObject({ state: "paused", missesInRow: 1 });
    // November's charge was overdue before the pause began: it stays; December's is held.
    expect(await monthOf(space, "2026-11", id)).toEqual([["2026-11-05", "overdue"]]);
    expect(await monthOf(space, "2026-12", id)).toEqual([]);
    expect(await monthOf(space, "2027-01", id)).toEqual([["2027-01-05", "expected"]]);
    expect((await chargesOf(space, id)).map((c) => c.status)).toEqual(["overdue", "paid-late", "paid-late"]);
    expect(await userUpdates(space.householdId)).toBe(1);
    const again = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, {});
    expect([again.statusCode, again.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
  });

  it("BUD-07@PoC FR 13: paused until «Відновити» — no next date; «Відновити» brings the schedule back and counts misses anew", async () => {
    const space = await newSpace();
    const id = await manual(
      space,
      { name: "Sport Life", amount: { amount: "35.00", currency: "EUR" }, anchorDate: "2026-09-12" },
      "2026-09-01",
    );
    expect(await statusOf(space, id)).toMatchObject({ state: "possibly-cancelled", missesInRow: 3 });
    const paused = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, { until: null });
    expect(paused.statusCode, paused.body).toBe(200);
    expect((paused.json() as PaymentBody).nextDate).toBeNull();
    expect(await statusOf(space, id)).toMatchObject({ state: "paused", lastCharge: { dueOn: "2026-11-12" } });
    const resumed = await call(space, "POST", `/v1/recurring/payments/${id}/resume`);
    expect(resumed.statusCode, resumed.body).toBe(200);
    // Paused and resumed the same day: nothing was held, and the misses are counted from today.
    expect(resumed.json() as PaymentBody).toMatchObject({ nextDate: "2026-12-12", holds: [] });
    expect(await statusOf(space, id)).toMatchObject({ state: "active", missesInRow: 0 });
    expect(await monthOf(space, "2026-12", id)).toEqual([["2026-12-12", "expected"]]);
    expect(await userUpdates(space.householdId)).toBe(2);
    const twice = await call(space, "POST", `/v1/recurring/payments/${id}/resume`);
    expect([twice.statusCode, twice.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
  });

  it("BUD-07@PoC FR 13: a pause date not after today is refused (400), nothing written", async () => {
    const space = await newSpace();
    const id = await internet(space);
    for (const until of ["2026-11-16", "2026-02-30"]) {
      const res = await call(space, "POST", `/v1/recurring/payments/${id}/pause`, { until });
      expect(res.statusCode, res.body).toBe(400);
    }
    expect(await n("recurring.payment_holds WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await userUpdates(space.householdId)).toBe(0);
  });

  it("BUD-07@PoC FR 13: two pauses of one payment at once — one hold, one audit entry, the other 409", async () => {
    const space = await newSpace();
    const id = await internet(space);
    const url = `/v1/recurring/payments/${id}/pause`;
    const both = await Promise.all([call(space, "POST", url, {}), call(space, "POST", url, {})]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await n("recurring.payment_holds WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await userUpdates(space.householdId)).toBe(1);
  });
});

describe("BUD-07@PoC FR 13: «Позначити скасованим» and its restore", () => {
  it("BUD-07@PoC FR 13: marked cancelled — gone from the plan from this month, history kept, restorable; audited", async () => {
    const space = await newSpace();
    const id = await internet(space);
    const res = await call(space, "POST", `/v1/recurring/payments/${id}/cancel`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json() as PaymentBody).toMatchObject({
      nextDate: null,
      holds: [{ kind: "cancel", from: "2026-11-01", until: null }],
    });
    expect(await statusOf(space, id)).toMatchObject({ state: "cancelled", missesInRow: 0 });
    expect(await monthOf(space, "2026-11", id)).toEqual([]);
    expect(await monthOf(space, "2026-10", id)).toEqual([["2026-10-05", "paid-late"]]);
    expect((await chargesOf(space, id)).map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-10-05", "paid-late"],
      ["2026-09-05", "paid-late"],
    ]);
    // The payment stays: it is a mark in the app, not a deletion.
    expect((await call(space, "GET", `/v1/recurring/payments/${id}`)).statusCode).toBe(200);
    const twice = await call(space, "POST", `/v1/recurring/payments/${id}/cancel`);
    expect([twice.statusCode, twice.json().code]).toEqual([409, "RECURRING_CHARGE_STATE"]);
    const restored = await call(space, "POST", `/v1/recurring/payments/${id}/resume`);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json() as PaymentBody).toMatchObject({
      nextDate: "2026-12-05",
      holds: [{ kind: "cancel", from: "2026-11-01", until: "2026-11-15" }],
    });
    expect(await statusOf(space, id)).toMatchObject({ state: "active" });
    expect(await monthOf(space, "2026-12", id)).toEqual([["2026-12-05", "expected"]]);
    expect(await userUpdates(space.householdId)).toBe(2);
  });

  it("BUD-07@PoC FR 13: another space's payment is not found on every hold route; a scoped member is refused; the flag off — not found", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const id = await internet(owner);
    for (const action of ["pause", "cancel", "resume"]) {
      const url = `/v1/recurring/payments/${id}/${action}`;
      const body = action === "pause" ? {} : undefined;
      expect((await call(other, "POST", url, body)).statusCode).toBe(404);
      expect((await call(owner, "POST", url, body, { scoped: true })).statusCode).toBe(403);
    }
    expect(
      (await call(owner, "POST", `/v1/recurring/payments/${id}/pause`, {}, { role: "viewer" })).statusCode,
    ).toBe(403);
    off.add("recurring.payments");
    expect((await call(owner, "POST", `/v1/recurring/payments/${id}/cancel`)).statusCode).toBe(404);
    expect(await n("recurring.payment_holds WHERE household_id = $1", owner.householdId)).toBe(0);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the payments' holds too", async () => {
    const space = await newSpace();
    const id = await internet(space);
    expect((await call(space, "POST", `/v1/recurring/payments/${id}/cancel`)).statusCode).toBe(200);
    await createRecurringErasure(db.databases.for("recurring")).eraseHousehold(space.householdId);
    expect(await n("recurring.payment_holds WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
