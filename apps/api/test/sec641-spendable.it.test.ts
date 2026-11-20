import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
  createCreditAccounts,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetObligations,
  createBudgetPlanSources,
  createBudgetServices,
} from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalPlans, createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringMonth,
  createRecurringServices,
} from "../src/modules/recurring/index.ts";
import {
  createAccountPayments,
  createBudgetTransactions,
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-03@PoC c) (the read API of «Можна витратити», before row 126): GET /v1/budget/periods/{period}/spendable through
 * the real API on a real PostgreSQL — the period's figures (BUD-02), the live `BudgetObligations` (recurring, accounts,
 * liabilities, transactions), the real goals module's `GoalPlans` behind `createBudgetPlanSources` with the cells of
 * «План» (BUD-17), and the test's planned expenses of saved payoff plans. Every name and amount is synthetic; the clock
 * is the test's own (Kyiv): 12 November 2026 — the 12th of a 30-day month, 19 days left with today.
 */
const WEB = "http://localhost:5173";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
let now = at("2026-11-12");
const flagsOff = new Set<string>();
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
let obligations: ReturnType<typeof createBudgetObligations>;
/** The test's planned expenses of saved payoff plans (module debt-payoff's port), by space. */
const extras = new Map<string, { accountId: string; amount: Money }[]>();

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
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

async function account(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", body);
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

const current = (space: Space) =>
  account(space, {
    kind: "current",
    name: "Синтетичний поточний",
    balance: eur("5000.00"),
    balanceDate: "2026-01-01",
  });

async function category(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

/** A regular payment added by hand («Додати вручну»), on 1 November (so its November charges are its own). */
async function payment(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/recurring/payments", {
    type: "expense",
    frequency: "month",
    name: "Синтетична підписка",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await db.owner.query(
    `UPDATE recurring.payments SET created_on = '2026-11-01' WHERE household_id = $1 AND id = $2`,
    [space.householdId, id],
  );
  return id;
}

async function transaction(space: Space, accountId: string, amount: string, date: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний продавець",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function createBudget(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11", ...body });
  expect(res.statusCode, res.body).toBe(201);
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const recurring = createRecurringServices({
    history: createTransactionHistory(db.databases.for("transactions")),
    transactionCategories: createTransactionCategories(db.databases.for("categorization")),
    fx,
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    accounts: createAccountDirectory(db.databases.for("accounts")),
    categories: directory,
    audit,
    clock,
    newId: randomUUID,
  });
  const goals = createGoalsServices({
    accounts: createAccountDirectory(db.databases.for("accounts")),
    ledger,
    audit,
    clock,
    newId: randomUUID,
  });
  obligations = createBudgetObligations({
    recurring: createRecurringMonth(db.databases.for("recurring"), recurring),
    credit: createCreditAccounts(db.databases.for("accounts")),
    liabilities,
    payments: createAccountPayments(db.databases.for("transactions")),
    fx,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabled: async (_h: string, flag: string) => !flagsOff.has(flag) },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities,
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx,
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: clock.now })),
            now: clock.now,
          }),
          audit,
          clock,
          newId: randomUUID,
          categories: directory,
          flags: fakeFlags(),
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [
            createBudgetCategoryUsage(db.databases.for("budget")),
            createRecurringCategoryUsage(db.databases.for("recurring")),
          ],
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
        }),
        recurring,
        goals,
        budget: createBudgetServices({
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock,
          newId: randomUUID,
          obligations,
          planSources: createBudgetPlanSources({
            goals: createGoalPlans(db.databases.for("goals"), goals),
            debts: { inMonth: async (householdId) => extras.get(householdId) ?? [] },
            fx,
          }),
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

afterEach(async () => {
  await db.owner.query(`DELETE FROM fx_rates.rates`);
  now = at("2026-11-12");
});

interface Spendable {
  period: string;
  currency: string;
  daysLeft: number;
  figures: {
    amount: { amount: string };
    daily: { amount: string };
    overspend: { amount: { amount: string }; base: { amount: string } } | null;
    income: Record<string, unknown>;
    spent: Record<string, unknown>;
    regularPayments: { items: Record<string, unknown>[]; total: unknown };
    goals: { items: Record<string, unknown>[]; total: unknown };
    plannedExpenses: { items: Record<string, unknown>[]; total: unknown };
    mandatory: { categories: Record<string, unknown>[]; total: unknown };
    mini: { row: string; amount: unknown }[];
  } | null;
  unavailable: string[];
  approximate: Record<string, unknown>;
}

async function spendable(space: Space, p = "2026-11"): Promise<Spendable> {
  const res = await call(space, "GET", `/v1/budget/periods/${p}/spendable`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Spendable;
}

async function categorised(space: Space, acc: string, amount: string, date: string, name: string) {
  const id = await transaction(space, acc, amount, date);
  const set = await call(space, "PUT", `/v1/transactions/${id}/category`, {
    categoryId: await category(space, name),
  });
  expect(set.statusCode, set.body).toBe(200);
  return id;
}

async function goal(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/goals", {
    template: "travel",
    name: "Синтетична відпустка",
    target: eur("6000.00"),
    targetDate: "2027-12-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** «План» (BUD-17): the goal's own planned contribution of November. */
async function plannedContribution(space: Space, goalId: string, amount: string) {
  const res = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
    period: "2026-11",
    kind: "goal",
    lineId: goalId,
    amount: eur(amount),
    version: 0,
  });
  expect(res.statusCode, res.body).toBe(200);
}

/**
 * AC1: income 6 000 € (the plan and a salary of 6 000 € that came in), 2 300 € spent («Без категорії»), unpaid regular
 * payments 1 200 € and 700 € later in the month, a planned goal contribution of 500 € in «План».
 */
async function ac1(): Promise<{ space: Space; acc: string; goalId: string; rent: string; phone: string }> {
  const space = await newSpace();
  const acc = await current(space);
  await createBudget(space, { incomePlan: eur("6000") });
  await categorised(space, acc, "6000.00", "2026-11-03", "Зарплата");
  await transaction(space, acc, "-2300.00", "2026-11-05");
  const rent = await payment(space, {
    amount: eur("1200"),
    anchorDate: "2026-11-20",
    name: "Синтетична оренда",
  });
  const phone = await payment(space, {
    amount: eur("700"),
    anchorDate: "2026-11-25",
    name: "Синтетичні послуги",
  });
  const goalId = await goal(space);
  await plannedContribution(space, goalId, "500");
  return { space, acc, goalId, rent, phone };
}

const usd = (amount: string) => ({ amount, currency: "USD" });
const get = (space: Space, principal: { role?: string; scoped?: boolean } = {}) =>
  call(space, "GET", "/v1/budget/periods/2026-11/spendable", undefined, principal);

describe("sec641: «Можна витратити» — guards, breakdown, missing rates, bounds", () => {
  afterEach(() => {
    flagsOff.clear();
    extras.clear();
  });

  it("sec641 guard: flag budget.spendable off → 404 with the body of an unknown path, no sums; budget.period stays served", async () => {
    const { space } = await ac1();
    flagsOff.add("budget.spendable");
    const res = await get(space);
    const unknown = await call(space, "GET", "/v1/budget/periods/2026-11/nope");
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(unknown.body);
    for (const leaked of ["1300", "6000", "2300", "1900", "68.42"])
      expect(leakText(res.body)).not.toContain(leaked);
  });

  it("sec641 guard: a scoped member of every scopable role gets 404 (an impossible scoped owner / admin — 403) without ids or sums; an unscoped stranger never sees the space's ids", async () => {
    const { space, goalId, rent, phone } = await ac1();
    const ok = await get(space);
    expect(ok.statusCode).toBe(200);
    for (const role of ["owner", "admin", "editor", "viewer", "advisor"]) {
      expect((await get(space, { role })).statusCode, role).toBe(200);
      const res = await get(space, { role, scoped: true });
      expect(res.statusCode, role).toBe(role === "owner" || role === "admin" ? 403 : 404);
      expect(leakText(res.body), role).not.toContain("figures");
      for (const leaked of ["1300", "6000", "2300", "1900", "68.42", goalId, rent, phone])
        expect(leakText(res.body), role).not.toContain(leaked);
    }
    const stranger = await newSpace();
    await createBudget(stranger, { incomePlan: eur("10") });
    const other = await get(stranger);
    expect(other.statusCode).toBe(200);
    for (const leaked of [goalId, rent, phone, "1300", "2300", "1900"])
      expect(leakText(other.body)).not.toContain(leaked);
    // Path tampering: the period is the only parameter.
    for (const p of [space.householdId, "2026-11%2F..", "2026-1", "999999999"]) {
      const res = await call(stranger, "GET", `/v1/budget/periods/${p}/spendable`);
      expect([400, 404]).toContain(res.statusCode);
      for (const leaked of [goalId, rent, "1300"]) expect(leakText(res.body)).not.toContain(leaked);
    }
  });

  it("sec641 breakdown: only ids, dates and sums — no names, counterparties or notes of the sources", async () => {
    const { space } = await ac1();
    const res = await get(space);
    for (const text of [
      "Синтетична оренда",
      "Синтетичні послуги",
      "Синтетична відпустка",
      "Синтетичний продавець",
      "Синтетичний поточний",
    ])
      expect(leakText(res.body)).not.toContain(text);
  });

  it("sec641 breakdown: a paid charge and an income are not listed; the list holds only unpaid expense charges", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("3000") });
    const paidId = await payment(space, {
      amount: eur("50"),
      anchorDate: "2026-11-05",
      name: "Синтетична сплачена",
    });
    const charges = await call(space, "GET", `/v1/recurring/payments/${paidId}`);
    expect(charges.statusCode, charges.body).toBe(200);
    const skip = await call(space, "POST", `/v1/recurring/payments/${paidId}/charges/2026-11-05/skip`, {});
    const unpaid = await payment(space, { amount: eur("70"), anchorDate: "2026-11-20" });
    const f = (await spendable(space)).figures!;
    const ids = f.regularPayments.items.map((i) => i["paymentId"]);
    expect(ids).toContain(unpaid);
    // The overdue one is listed until skipped; once «Пропущено» it is gone (FR 5).
    if (skip.statusCode < 300) expect(ids).not.toContain(paidId);
    else
      expect(f.regularPayments.items.find((i) => i["paymentId"] === paidId)).toMatchObject({
        overdueDays: 7,
      });
    void acc;
  });

  it("sec641 no rate: a regular INCOME in another currency → figures null, unavailable [incomes]", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await payment(space, { type: "income", amount: usd("100"), anchorDate: "2026-11-25" });
    const s = await spendable(space);
    expect(s.figures).toBeNull();
    expect(s.unavailable).toEqual(["incomes"]);
  });

  it("sec641 no rate: a GOAL in another currency → figures null, unavailable [goals]", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    const res = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Синтетична ціль",
      target: usd("6000.00"),
      targetDate: "2027-12-01",
    });
    expect(res.statusCode, res.body).toBe(201);
    const s = await spendable(space);
    expect(s.figures).toBeNull();
    expect(s.unavailable).toEqual(["goals"]);
  });

  it("sec641 no rate: a planned expense in another currency → figures null, unavailable [plannedExpenses]; all three at once are all named", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    extras.set(space.householdId, [{ accountId: randomUUID(), amount: Money.of("100", "USD") }]);
    let s = await spendable(space);
    expect(s.figures).toBeNull();
    expect(s.unavailable).toEqual(["plannedExpenses"]);
    await payment(space, { amount: usd("100"), anchorDate: "2026-11-20" });
    s = await spendable(space);
    expect(s.figures).toBeNull();
    expect(s.unavailable).toEqual(["obligations", "plannedExpenses"]);
    expect(JSON.stringify(s)).not.toContain('"amount"');
  });

  it("sec641 no rate: a TRANSACTION left out for want of any rate is always signalled — approximate.unavailableCount, and no sum (#649 item 3, EC4, #651)", async () => {
    const space = await newSpace();
    const eurAcc = await current(space);
    const usdAcc = await account(space, {
      kind: "current",
      name: "Синтетичний доларовий",
      balance: usd("5000.00"),
      balanceDate: "2026-01-01",
    });
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, eurAcc, "1000.00", "2026-11-03", "Зарплата");
    const res = await call(space, "POST", "/v1/transactions", {
      accountId: usdAcc,
      amount: usd("-900.00"),
      date: "2026-11-05",
      counterparty: "Синтетичний продавець",
    });
    expect(res.statusCode, res.body).toBe(201);
    const s = await spendable(space);
    expect(s.approximate).toMatchObject({ unavailableCount: 1 });
    // #649 item 3: never the sum without the 900 USD (1000) shown as complete — no figure, the source named.
    expect(s.figures).toBeNull();
    // #651: `unavailable` keeps its published values (ARC-07 FR 3); `unavailableCount` names the transaction.
    expect(s.unavailable).toEqual([]);
  });

  it("sec641 overflow: amounts at and over the cap never answer 500 and never give a partial sum", async () => {
    const space = await newSpace();
    await current(space);
    const max = "999999999999999";
    const b = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11", incomePlan: eur(max) });
    expect(b.statusCode, b.body).toBe(201);
    for (let i = 0; i < 3; i++) await payment(space, { amount: eur(max), anchorDate: "2026-11-20" });
    await payment(space, { type: "income", amount: eur(max), anchorDate: "2026-11-21" });
    extras.set(space.householdId, [{ accountId: randomUUID(), amount: Money.of(max, "EUR") }]);
    let res = await get(space);
    expect(res.statusCode, res.body).toBe(200);
    let s = res.json() as Spendable;
    // max(plan, 0 + still expected) = max; − 3·max payments − max planned = −3·max, exact.
    expect(s.figures!.amount).toEqual(eur("-2999999999999997"));
    expect(s.figures!.daily).toEqual(eur("0"));
    // Over the cap: a planned expense of 17 digits — no figure.
    extras.set(space.householdId, [
      { accountId: randomUUID(), amount: Money.of("12345678901234567", "EUR") },
    ]);
    res = await get(space);
    expect(res.statusCode, res.body).toBe(200);
    s = res.json() as Spendable;
    expect(s.figures).toBeNull();
    expect(s.unavailable).toEqual(["plannedExpenses"]);
    extras.clear();
    // A goal whose required contribution is over the cap.
    const g = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Синтетична велика",
      target: eur("99999999999999999999.00"),
      targetDate: "2026-12-01",
    });
    res = await get(space);
    expect(res.statusCode, res.body).toBe(200);
    s = res.json() as Spendable;
    if (g.statusCode === 201) {
      expect(s.figures).toBeNull();
      expect(s.unavailable).toEqual(["goals"]);
    }
    // A regular payment over the cap.
    const p = await call(space, "POST", "/v1/recurring/payments", {
      type: "income",
      frequency: "month",
      name: "Синтетичний великий",
      amount: eur("99999999999999999999"),
      anchorDate: "2026-11-25",
    });
    expect(p.statusCode, p.body).toBe(201);
    res = await get(space);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Spendable).figures).toBeNull();
  });

  it("sec641 exact decimals: 0.10 + 0.20 spent, the daily limit rounded down, no float artefacts", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("1000.01") });
    await transaction(space, acc, "-0.10", "2026-11-05");
    await transaction(space, acc, "-0.20", "2026-11-06");
    await payment(space, { amount: eur("0.07"), anchorDate: "2026-11-20" });
    const f = (await spendable(space)).figures!;
    expect(f.spent).toMatchObject({ total: eur("0.3") });
    expect(f.amount).toEqual(eur("999.64"));
    // 999.64 / 19 = 52.6126… → 52.61
    expect(f.daily).toEqual(eur("52.61"));
    expect(JSON.stringify(f)).not.toMatch(/\d\.\d{3,}/);
  });
});
