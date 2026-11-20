import { randomUUID } from "node:crypto";
import { Decimal, Money } from "@willowsum/domain-kernel";
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
import { createGoalPlans, createGoalsServices, createGoalSpends } from "../src/modules/goals/index.ts";
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

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
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
    // BUD-03@PoC EC5: «Витратити з цілі» needs the transactions' lookup.
    transactions: createTransactionLookup(db.databases.for("transactions")),
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
        flags: fakeFlags(),
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
          planEnabled: async () => true,
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
            // FR 1 «Надходження»: the month's expected regular incomes (the income plan of «План», #651).
            recurring: createRecurringMonth(db.databases.for("recurring"), recurring),
          }),
          goalSpends: createGoalSpends(db.databases.for("goals")),
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

describe("BUD-03@PoC: GET /v1/budget/periods/{period}/spendable", () => {
  it("BUD-03@PoC AC1: income 6 000, spent 2 300, unpaid regular payments 1 900, goals 500 on the 12th of a 30-day month — 1 300 € and 68,42 € a day (19 days)", async () => {
    const { space } = await ac1();
    const s = await spendable(space);
    expect(s.unavailable).toEqual([]);
    expect([s.period, s.currency, s.daysLeft]).toEqual(["2026-11", "EUR", 19]);
    expect(s.figures!.amount).toEqual(eur("1300"));
    expect(s.figures!.daily).toEqual(eur("68.42"));
    expect(s.figures!.overspend).toBeNull();
  });

  it("BUD-03@PoC FR 15: the card's five rows with sums — «Дохід», «Витрачено», «Регулярні платежі», «Цілі», «Обов'язкові»", async () => {
    const { space } = await ac1();
    expect((await spendable(space)).figures!.mini).toEqual([
      { row: "income", amount: eur("6000") },
      { row: "spent", amount: eur("2300") },
      { row: "regular", amount: eur("1900") },
      { row: "goals", amount: eur("500") },
      { row: "mandatory", amount: eur("0") },
    ]);
  });

  it("BUD-03@PoC AC2: the breakdown — income plan / actual, spent, the regular payments with their dates, the goal contributions, each with its source", async () => {
    const { space, goalId, rent, phone } = await ac1();
    const f = (await spendable(space)).figures!;
    expect(f.income).toEqual({
      plan: eur("6000"),
      actual: eur("6000"),
      expected: eur("6000"),
      stillExpected: eur("0"),
      value: eur("6000"),
      pending: false,
    });
    expect(f.spent).toEqual({ total: eur("2300"), limited: eur("0"), outsidePlan: eur("2300") });
    expect(f.regularPayments).toEqual({
      items: [
        {
          kind: "recurring",
          paymentId: rent,
          categoryId: null,
          dueOn: "2026-11-20",
          overdueDays: null,
          amount: eur("1200"),
        },
        {
          kind: "recurring",
          paymentId: phone,
          categoryId: null,
          dueOn: "2026-11-25",
          overdueDays: null,
          amount: eur("700"),
        },
      ],
      total: eur("1900"),
    });
    expect(f.goals).toEqual({
      items: [{ goalId, planned: eur("500"), contributed: eur("0"), amount: eur("500") }],
      total: eur("500"),
    });
    expect(f.plannedExpenses).toEqual({ items: [], total: eur("0") });
  });

  it("BUD-03@PoC FR 8: the full breakdown holds the planned expenses of a payoff plan and «Обов'язкові категорії: ще потрібно N» by category", async () => {
    const { space } = await ac1();
    const loanId = randomUUID();
    extras.set(space.householdId, [{ accountId: loanId, amount: Money.of("100", "EUR") }]);
    const f = (await spendable(space)).figures!;
    expect(f.plannedExpenses).toEqual({
      items: [{ accountId: loanId, amount: eur("100") }],
      total: eur("100"),
    });
    // 6000 − 2300 − 1900 − 500 − 100.
    expect(f.amount).toEqual(eur("1200"));
    expect(f.mini.find((r) => r.row === "goals")?.amount).toEqual(eur("600"));
    expect(f.mandatory).toEqual({ categories: [], total: eur("0") });
  });

  it("BUD-03@PoC FR 6: the goal's planned contribution of «План» less what is already contributed this month, never below 0 — a contribution never raises the sum", async () => {
    const { space, goalId } = await ac1();
    const paid = await call(space, "POST", `/v1/goals/${goalId}/contributions`, { amount: eur("200.00") });
    expect(paid.statusCode, paid.body).toBe(201);
    let f = (await spendable(space)).figures!;
    expect(f.goals.items).toEqual([
      { goalId, planned: eur("500"), contributed: eur("200"), amount: eur("300") },
    ]);
    // Business rules: what came in this month lowers the sum too — «Цілі» holds max(planned, contributed).
    expect(f.goals.total).toEqual(eur("500"));
    expect(f.amount).toEqual(eur("1300"));
    const more = await call(space, "POST", `/v1/goals/${goalId}/contributions`, { amount: eur("400.00") });
    expect(more.statusCode, more.body).toBe(201);
    f = (await spendable(space)).figures!;
    expect(f.goals.items[0]).toMatchObject({ contributed: eur("600"), amount: eur("0") });
    expect(f.goals.total).toEqual(eur("600"));
    expect(f.amount).toEqual(eur("1200"));
  });

  it("BUD-03@PoC FR 6: without a cell of «План» the month plans the goal's required contribution", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("6000") });
    const goalId = await goal(space);
    const card = await call(space, "GET", `/v1/goals/${goalId}`);
    expect(card.statusCode, card.body).toBe(200);
    const required = card.json().requiredMonthly as { amount: string };
    const f = (await spendable(space)).figures!;
    expect(f.goals.items).toEqual([{ goalId, planned: required, contributed: eur("0"), amount: required }]);
  });

  it("BUD-03@PoC AC3: a categorised restaurant transaction of 240 € — 1 060 € and 55,78 € a day", async () => {
    const { space, acc } = await ac1();
    expect((await spendable(space)).figures!.amount).toEqual(eur("1300"));
    await categorised(space, acc, "-240.00", "2026-11-12", "Кафе і ресторани");
    const f = (await spendable(space)).figures!;
    expect(f.amount).toEqual(eur("1060"));
    expect(f.daily).toEqual(eur("55.78"));
  });

  it("BUD-03@PoC AC9: a mandatory «Продукти» with a limit of 620 € and 590 € spent — 30 € less and «Обов'язкові категорії: ще потрібно 30 €»", async () => {
    const space = await newSpace();
    const acc = await current(space);
    const groceries = await category(space, "Продукти"); // mandatory by default
    await createBudget(space, {
      incomePlan: eur("6000"),
      limits: [{ categoryId: groceries, amount: eur("620") }],
    });
    await categorised(space, acc, "6000.00", "2026-11-03", "Зарплата");
    await categorised(space, acc, "-590.00", "2026-11-04", "Продукти");
    await transaction(space, acc, "-1710.00", "2026-11-05");
    await payment(space, { amount: eur("1900"), anchorDate: "2026-11-20" });
    await plannedContribution(space, await goal(space), "500");
    const f = (await spendable(space)).figures!;
    expect(f.mandatory).toEqual({
      categories: [{ categoryId: groceries, amount: eur("30") }],
      total: eur("30"),
    });
    expect(f.amount).toEqual(eur("1270"));
    expect(f.spent).toEqual({ total: eur("2300"), limited: eur("590"), outsidePlan: eur("1710") });
  });

  it("BUD-03@PoC AC5: plan 6 000 €, actual 6 400 € — the expected income is 6 400 €; nothing came in yet — the plan 6 000 € «очікується»", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("6000") });
    let f = (await spendable(space)).figures!;
    expect(f.income).toMatchObject({ actual: eur("0"), value: eur("6000"), pending: true });
    await categorised(space, acc, "6400.00", "2026-11-03", "Зарплата");
    f = (await spendable(space)).figures!;
    expect(f.income).toMatchObject({
      plan: eur("6000"),
      actual: eur("6400"),
      value: eur("6400"),
      pending: false,
    });
  });

  it("BUD-03@PoC FR 3: a regular income still expected in the period is added to the actual income against the plan", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("6000") });
    await categorised(space, acc, "5500.00", "2026-11-03", "Зарплата");
    await payment(space, {
      type: "income",
      amount: eur("1000"),
      anchorDate: "2026-11-25",
      name: "Синтетичний дохід",
    });
    const f = (await spendable(space)).figures!;
    expect(f.income).toEqual({
      plan: eur("6000"),
      actual: eur("5500"),
      expected: eur("6500"),
      stillExpected: eur("1000"),
      value: eur("6500"),
      pending: false,
    });
    // An income is no regular payment the sum holds back.
    expect(f.regularPayments.items).toEqual([]);
  });

  it("BUD-03@PoC AC4: budget 3 000 €, spent 3 150 € — «Перевитрата 150 €» with its shade base, daily limit 0", async () => {
    const space = await newSpace();
    const acc = await current(space);
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    await createBudget(space, {
      incomePlan: eur("6000"),
      limits: [
        { categoryId: groceries, amount: eur("1000") },
        { categoryId: cafes, amount: eur("2000") },
      ],
    });
    await categorised(space, acc, "-1000.00", "2026-11-04", "Продукти");
    await categorised(space, acc, "-2150.00", "2026-11-05", "Кафе і ресторани");
    const f = (await spendable(space)).figures!;
    // The base of `over-1`…`over-8`: the optional categories' limits (DS-23 п. 4) — 150 ÷ 2 000 = 7,5 %, `over-2`.
    expect(f.overspend).toEqual({ amount: eur("150"), base: eur("2000") });
    expect(f.daily).toEqual(eur("0"));
  });

  it("BUD-03@PoC FR 10: without limits the budget of the period is the expected income less the planned savings", async () => {
    const { space, acc } = await ac1();
    // 6 000 − 500 planned = 5 500; spent 2 300 + 3 300 = 5 600 — 100 over.
    await transaction(space, acc, "-3300.00", "2026-11-06");
    const f = (await spendable(space)).figures!;
    expect(f.overspend).toEqual({ amount: eur("100"), base: eur("0") });
    expect(f.daily).toEqual(eur("0"));
  });

  it("BUD-03@PoC AC6: the last day of the period with 90 € left — the daily limit is 90 €", async () => {
    now = at("2026-11-30");
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    await transaction(space, acc, "-910.00", "2026-11-05");
    const s = await spendable(space);
    expect(s.daysLeft).toBe(1);
    expect(s.figures!.amount).toEqual(eur("90"));
    expect(s.figures!.daily).toEqual(eur("90"));
  });

  it("BUD-03@PoC FR 4: a negative sum without overspend shows with «−» and the daily limit is 0", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    await transaction(space, acc, "-400.00", "2026-11-05");
    await payment(space, { amount: eur("700"), anchorDate: "2026-11-20" });
    const f = (await spendable(space)).figures!;
    expect(f.overspend).toBeNull();
    expect(f.amount).toEqual(eur("-100"));
    expect(f.daily).toEqual(eur("0"));
  });

  it("BUD-03@PoC AC7: no budget — no card: 404, and the page shows the budget's empty state", async () => {
    const space = await newSpace();
    const res = await call(space, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(res.statusCode, res.body).toBe(404);
    expect((await call(space, "GET", "/v1/budget")).json()).toEqual({ budget: null });
  });

  it("BUD-03@PoC AC8: a user outside the space never gets its card or breakdown — 404 without its records, counts or sums", async () => {
    const { space } = await ac1();
    const stranger = await newSpace();
    const res = await call(stranger, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(res.statusCode).toBe(404);
    for (const leaked of ["1300", "6000", "2300", "1900", "68.42"])
      expect(leakText(res.body)).not.toContain(leaked);
    // A scoped member of the space itself: «бюджет і цілі» closed — not found.
    const scoped = await call(space, "GET", "/v1/budget/periods/2026-11/spendable", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(leakText(scoped.body)).not.toContain("1300");
    // The stranger's own budget shows only its own figures.
    await createBudget(stranger, {});
    const own = await spendable(stranger);
    expect(own.figures!.amount).toEqual(eur("0"));
    expect(own.figures!.regularPayments.items).toEqual([]);
    expect(own.figures!.goals.items).toEqual([]);
  });

  it("BUD-03@PoC FR 1: only the current period has «Можна витратити» — another month is refused, a month before the budget is not found", async () => {
    const { space } = await ac1();
    for (const p of ["2026-10", "2026-12"]) {
      const res = await call(space, "GET", `/v1/budget/periods/${p}/spendable`);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().errors).toEqual([{ in: "path", path: "period", issue: "not_current" }]);
    }
    expect((await call(space, "GET", "/v1/budget/periods/2026-13/spendable")).statusCode).toBe(400);
    const later = await newSpace();
    await createBudget(later, { firstPeriod: "2026-12" });
    const before = await call(later, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(before.statusCode, before.body).toBe(404);
    expect(before.json().code).toBe("BUDGET_PERIOD_BEFORE_START");
  });

  it("BUD-03@PoC EC4: a regular payment in another currency at today's rate; with no rate at all — no figure, never a sum without it", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    await payment(space, { amount: { amount: "100", currency: "USD" }, anchorDate: "2026-11-20" });
    const none = await spendable(space);
    expect(none.figures).toBeNull();
    expect(none.unavailable).toEqual(["obligations"]);
    // 1 USD = 41.6 UAH, 1 EUR = 52 UAH: 100 USD = 80 EUR.
    await rate("2026-11-12", "USD", "41.6");
    await rate("2026-11-12", "EUR", "52");
    const s = await spendable(space);
    expect(s.unavailable).toEqual([]);
    expect(s.figures!.regularPayments.total).toEqual(eur("80"));
    expect(s.figures!.amount).toEqual(eur("920"));
  });
});

/**
 * EC5's space: income 1 000 € that came in, no limits; «Синтетична відпустка» — an envelope on the current account with
 * 400 € put aside before November, planned 0 € in November's «План» (so «Цілі» is what is contributed this month), and
 * `contributed` put in on 12 November.
 */
async function ec5(contributed: string | null) {
  const space = await newSpace();
  const acc = await current(space);
  await createBudget(space, { incomePlan: eur("1000") });
  await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
  const res = await call(space, "POST", "/v1/goals", {
    template: "travel",
    name: "Синтетична відпустка",
    target: eur("6000.00"),
    targetDate: "2027-12-01",
    part: { kind: "envelope", accountId: acc, startAmount: "400.00" },
  });
  expect(res.statusCode, res.body).toBe(201);
  const goalId = res.json().id as string;
  await plannedContribution(space, goalId, "0");
  if (contributed !== null) {
    const paid = await call(space, "POST", `/v1/goals/${goalId}/contributions`, { amount: eur(contributed) });
    expect(paid.statusCode, paid.body).toBe(201);
  }
  /** «Витратити з цілі»: a hotel of `amount` paid from the account on 10 November, written off from the goal. */
  const spendFromGoal = async (amount: string) => {
    const hotel = await transaction(space, acc, `-${amount}`, "2026-11-10");
    const before = (await spendable(space)).figures!;
    const res = await call(space, "POST", `/v1/goals/${goalId}/spends`, {
      transactions: [{ transactionId: hotel, accountId: acc }],
    });
    expect(res.statusCode, res.body).toBe(201);
    return before;
  };
  return { space, acc, goalId, spendFromGoal };
}

describe("BUD-03@PoC EC5: a goal spent through «Витратити з цілі» does not lower «Можна витратити» a second time", () => {
  // 1 000 − 200,25 contributed this month = 799,75, whatever is then spent from the goal.
  for (const [what, amount] of [
    ["smaller than", "150.37"],
    ["equal to", "200.25"],
    ["greater than", "300.11"],
  ] as const)
    it(`BUD-03@PoC EC5: a spend from the goal ${what} this month's contribution of 200,25 € — the sum stays 799,75 €`, async () => {
      const { space, spendFromGoal } = await ec5("200.25");
      const held = (await spendable(space)).figures!;
      expect(held.goals.total).toEqual(eur("200.25"));
      expect(held.amount).toEqual(eur("799.75"));
      // Before «Витратити з цілі» the hotel is spending as any other.
      const before = await spendFromGoal(amount);
      expect(before.amount).toEqual(eur(new Decimal("799.75").minus(amount).toString()));
      const f = (await spendable(space)).figures!;
      expect(f.amount).toEqual(eur("799.75"));
      expect(f.goals.total).toEqual(eur("200.25"));
      expect(f.spent.total).toEqual(eur("0"));
      expect(f.mini.find((r) => r.row === "spent")?.amount).toEqual(eur("0"));
      expect(f.daily).toEqual(eur("42.09"));
    });

  it("BUD-03@PoC EC5: a spend from a previous month's savings (nothing contributed this month) — the sum stays 1 000 €", async () => {
    const { space, spendFromGoal } = await ec5(null);
    expect((await spendable(space)).figures!.amount).toEqual(eur("1000"));
    const before = await spendFromGoal("250.50");
    expect(before.amount).toEqual(eur("749.5"));
    const f = (await spendable(space)).figures!;
    expect(f.amount).toEqual(eur("1000"));
    expect(f.goals.total).toEqual(eur("0"));
    expect(f.spent.total).toEqual(eur("0"));
  });

  it("BUD-03@PoC EC5: a spend from the goal in a mandatory category — it leaves «Витрачено» and the category still needs its whole limit", async () => {
    const space = await newSpace();
    const acc = await current(space);
    const groceries = await category(space, "Продукти"); // mandatory by default
    await createBudget(space, {
      incomePlan: eur("1000"),
      limits: [{ categoryId: groceries, amount: eur("620") }],
    });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    const res = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Синтетична відпустка",
      target: eur("6000.00"),
      targetDate: "2027-12-01",
      part: { kind: "envelope", accountId: acc, startAmount: "700.00" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const goalId = res.json().id as string;
    await plannedContribution(space, goalId, "0");
    const bought = await categorised(space, acc, "-590.13", "2026-11-04", "Продукти");
    let f = (await spendable(space)).figures!;
    // 1 000 − 590,13 spent − 29,87 still needed by «Продукти» = 380.
    expect(f.mandatory).toEqual({
      categories: [{ categoryId: groceries, amount: eur("29.87") }],
      total: eur("29.87"),
    });
    expect(f.amount).toEqual(eur("380"));
    const spent = await call(space, "POST", `/v1/goals/${goalId}/spends`, {
      transactions: [{ transactionId: bought, accountId: acc }],
    });
    expect(spent.statusCode, spent.body).toBe(201);
    f = (await spendable(space)).figures!;
    expect(f.spent).toEqual({ total: eur("0"), limited: eur("0"), outsidePlan: eur("0") });
    expect(f.mandatory).toEqual({
      categories: [{ categoryId: groceries, amount: eur("620") }],
      total: eur("620"),
    });
    expect(f.amount).toEqual(eur("380"));
  });

  it("BUD-03@PoC EC5: only «Можна витратити» leaves the spend out — the period's «Витрачено» on «Бюджет» still counts it", async () => {
    const { space, acc, spendFromGoal } = await ec5("200.25");
    await spendFromGoal("150.37");
    await transaction(space, acc, "-10.01", "2026-11-11");
    const f = (await spendable(space)).figures!;
    expect(f.spent.total).toEqual(eur("10.01"));
    expect(f.amount).toEqual(eur("789.74"));
    const period = await call(space, "GET", "/v1/budget/periods/2026-11");
    expect(period.statusCode, period.body).toBe(200);
    expect(period.body).toContain("160.38");
  });
});

describe("BUD-03@PoC «приблизно» and EC4: the nearest rate is marked, no rate at all is no sum", () => {
  it("BUD-03@PoC EC4: a regular income still expected, a goal and a planned expense at the nearest rate (older than 3 days) — «приблизно» for each", async () => {
    const space = await newSpace();
    const acc = await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    let s = await spendable(space);
    expect(s.approximate).toEqual({
      nearestRateCount: 0,
      unavailableCount: 0,
      obligations: false,
      incomes: false,
      goals: false,
      plannedExpenses: false,
    });
    // The latest rates are of 5 November, 7 days before today: 1 USD = 41.6 UAH, 1 EUR = 52 UAH (1 USD = 0,8 EUR).
    await rate("2026-11-05", "USD", "41.6");
    await rate("2026-11-05", "EUR", "52");
    await payment(space, {
      type: "income",
      amount: { amount: "100", currency: "USD" },
      anchorDate: "2026-11-25",
      name: "Синтетичний дохід",
    });
    s = await spendable(space);
    expect(s.figures!.income).toMatchObject({ stillExpected: eur("80") });
    expect(s.approximate).toMatchObject({ incomes: true, goals: false, plannedExpenses: false });
    const goalRes = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Синтетична поїздка",
      target: { amount: "1000.00", currency: "USD" },
      targetDate: "2027-12-01",
    });
    expect(goalRes.statusCode, goalRes.body).toBe(201);
    s = await spendable(space);
    expect(s.approximate).toMatchObject({ incomes: true, goals: true, plannedExpenses: false });
    extras.set(space.householdId, [{ accountId: randomUUID(), amount: Money.of("50", "USD") }]);
    s = await spendable(space);
    expect(s.figures!.plannedExpenses.total).toEqual(eur("40"));
    expect(s.approximate).toMatchObject({ incomes: true, goals: true, plannedExpenses: true });
    // Today's rates: nothing is «приблизно» any more.
    await rate("2026-11-12", "USD", "41.6");
    await rate("2026-11-12", "EUR", "52");
    s = await spendable(space);
    expect(s.approximate).toMatchObject({ incomes: false, goals: false, plannedExpenses: false });
    extras.delete(space.householdId);
  });

  it("BUD-03@PoC EC4: a goal's own cell of «План» in the budget's currency — its required contribution at the nearest rate does not make it «приблизно»", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("1000") });
    await rate("2026-11-05", "USD", "41.6");
    await rate("2026-11-05", "EUR", "52");
    const goalRes = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Синтетична поїздка",
      target: { amount: "1000.00", currency: "USD" },
      targetDate: "2027-12-01",
    });
    expect(goalRes.statusCode, goalRes.body).toBe(201);
    expect((await spendable(space)).approximate).toMatchObject({ goals: true });
    const goalId = goalRes.json().id as string;
    await plannedContribution(space, goalId, "30");
    expect((await spendable(space)).approximate).toMatchObject({ goals: false });
    // #651: what is contributed in USD this month enters the goal's row at the nearest rate — «приблизно» again.
    const paid = await call(space, "POST", `/v1/goals/${goalId}/contributions`, {
      amount: { amount: "10.00", currency: "USD" },
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const s = await spendable(space);
    // max(30 planned, 8 contributed) — the planned cell; the 8 € entered at the 5 November rate.
    expect(s.figures!.goals.total).toEqual(eur("30"));
    expect(s.figures!.goals.items).toEqual([expect.objectContaining({ goalId, contributed: eur("8") })]);
    expect(s.approximate).toMatchObject({ goals: true });
  });

  it("BUD-03@PoC EC4: the month's income plan made of a regular income in USD at the nearest rate — «приблизно» (#651)", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("100") });
    await rate("2026-11-05", "USD", "41.6");
    await rate("2026-11-05", "EUR", "52");
    // 1 000 USD = 800 € at the 5 November rate: more than «План доходу» 100 €, so the month's plan is 800 €.
    await payment(space, {
      type: "income",
      amount: { amount: "1000", currency: "USD" },
      anchorDate: "2026-11-01",
      name: "Синтетичний дохід",
    });
    let s = await spendable(space);
    expect(s.figures!.income).toMatchObject({ plan: eur("800") });
    expect(s.approximate).toMatchObject({ incomes: true });
    // Today's rates: the plan is exact.
    await rate("2026-11-12", "USD", "41.6");
    await rate("2026-11-12", "EUR", "52");
    s = await spendable(space);
    expect(s.figures!.income).toMatchObject({ plan: eur("800") });
    expect(s.approximate).toMatchObject({ incomes: false });
  });

  it("BUD-03@PoC EC4: a transaction with no rate at all — `figures: null` with `approximate.unavailableCount`, no partial sum shown as complete", async () => {
    const space = await newSpace();
    const acc = await current(space);
    const usd = await account(space, {
      kind: "current",
      name: "Синтетичний доларовий",
      balance: { amount: "500.00", currency: "USD" },
      balanceDate: "2026-01-01",
    });
    await createBudget(space, { incomePlan: eur("1000") });
    await categorised(space, acc, "1000.00", "2026-11-03", "Зарплата");
    const res = await call(space, "POST", "/v1/transactions", {
      accountId: usd,
      amount: { amount: "-25.00", currency: "USD" },
      date: "2026-11-04",
      counterparty: "Синтетичний продавець",
    });
    expect(res.statusCode, res.body).toBe(201);
    const none = await spendable(space);
    // #651: `unavailable` keeps its published values; the no-rate transaction is `unavailableCount`.
    expect(none.figures).toBeNull();
    expect(none.unavailable).toEqual([]);
    expect(none.approximate).toMatchObject({ unavailableCount: 1 });
    expect(leakText(JSON.stringify(none))).not.toContain("975");
    // The rate of the transaction's date comes: the sum is back, exact.
    await rate("2026-11-04", "USD", "41.6");
    await rate("2026-11-04", "EUR", "52");
    const s = await spendable(space);
    expect(s.unavailable).toEqual([]);
    expect(s.approximate).toMatchObject({ nearestRateCount: 0, unavailableCount: 0 });
    expect(s.figures!.amount).toEqual(eur("980"));
  });
});

describe("sec651: «Витратити з цілі» in «Можна витратити» is bound to one space", () => {
  it("sec651 isolation: another space's goal spend naming this space's transaction id never leaves it out of this space's sum, and nothing of it is answered", async () => {
    // Space A: income 1 000 €, a purchase of 150,37 € that no goal of A wrote off.
    const a = await newSpace();
    const accA = await current(a);
    await createBudget(a, { incomePlan: eur("1000") });
    await categorised(a, accA, "1000.00", "2026-11-03", "Зарплата");
    const bought = await transaction(a, accA, "-150.37", "2026-11-10");
    expect((await spendable(a)).figures!.amount).toEqual(eur("849.63"));
    // Space B: a real spend from its own goal, then a forged row of B's spends naming A's transaction id.
    const b = await ec5("200.25");
    await b.spendFromGoal("123.45");
    const { rows } = await db.owner.query<{ id: string }>(
      `SELECT id FROM goals.spends WHERE household_id = $1`,
      [b.space.householdId],
    );
    expect(rows).toHaveLength(1);
    await db.owner.query(
      `INSERT INTO goals.spends (household_id, id, goal_id, transaction_id, account_id, entry_id, amount, currency, spent_on)
       SELECT household_id, $2, goal_id, $3, account_id, $4, 987.65, currency, spent_on FROM goals.spends
        WHERE household_id = $1 AND id = $5`,
      [b.space.householdId, randomUUID(), bought, randomUUID(), rows[0]!.id],
    );
    const res = await call(a, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json() as Spendable;
    expect(s.figures!.amount).toEqual(eur("849.63"));
    expect(s.figures!.spent.total).toEqual(eur("150.37"));
    for (const leaked of [b.goalId, b.space.householdId, "987.65", "123.45", "Синтетична відпустка"])
      expect(leakText(res.body)).not.toContain(leaked);
    // B's own sum still leaves its real spend out (799,75 €), whatever the forged row.
    expect((await spendable(b.space)).figures!.amount).toEqual(eur("799.75"));
  });

  it("sec651 exact: a goal spend leaves out exactly its transaction — 0,01 € and an 8-digit amount add up without rounding", async () => {
    const { space, acc, spendFromGoal } = await ec5(null);
    await spendFromGoal("0.01");
    await transaction(space, acc, "-0.01", "2026-11-11");
    await transaction(space, acc, "-12345678.91", "2026-11-11");
    const f = (await spendable(space)).figures!;
    expect(f.spent.total).toEqual(eur("12345678.92"));
    expect(f.amount).toEqual(eur("-12344678.92"));
  });
});
describe("BUD-03@PoC EC4: the income plan alone at the nearest rate (#651 confirmation)", () => {
  it("BUD-03@PoC EC4: a regular income in USD no longer expected (skipped) still makes the month's income plan — «приблизно» from the plan alone", async () => {
    const space = await newSpace();
    await current(space);
    await createBudget(space, { incomePlan: eur("100") });
    await rate("2026-11-05", "USD", "41.6");
    await rate("2026-11-05", "EUR", "52");
    const paymentId = await payment(space, {
      type: "income",
      amount: { amount: "1000", currency: "USD" },
      anchorDate: "2026-11-01",
      name: "Синтетичний дохід",
    });
    const skipped = await call(space, "POST", `/v1/recurring/payments/${paymentId}/charges/2026-11-01/skip`);
    expect(skipped.statusCode, skipped.body).toBe(200);
    const s = await spendable(space);
    // Nothing still expected — only the plan (800 € at the 5 November rate) carries the nearest rate.
    expect(s.figures!.income).toMatchObject({ plan: eur("800"), stillExpected: eur("0") });
    expect(s.approximate).toMatchObject({ incomes: true });
  });
});

/** The wizard's «Можна витратити в <місяць> ≈ M» of a plan not saved yet (POST /v1/budget/allocation, BUD-02 FR 3). */
async function wizard(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/budget/allocation", body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().spendable as { period: string; amount: { amount: string; currency: string } | null };
}

describe("BUD-03@PoC FR 6 (#661): a debt's cell of «План» replaces its payoff plan's extra payment in «Заплановані витрати»", () => {
  // Income 6 000 € (the plan, nothing came in yet), no limits, no regular payments; the payoff plan's extra payment 100 €.
  for (const [what, own, sum] of [
    ["above", "250.25", "5749.75"],
    ["below", "40.1", "5959.9"],
  ] as const)
    it(`BUD-03@PoC FR 6: «Розподіл»'s ${own} € for the debt (${what} the plan's 100 €) is the month's planned expense in place of it — ${sum} €, as the wizard and the grid`, async () => {
      const space = await newSpace();
      await current(space);
      const loanId = randomUUID();
      extras.set(space.householdId, [{ accountId: loanId, amount: Money.of("100", "EUR") }]);
      const plan = {
        firstPeriod: "2026-11",
        incomePlan: eur("6000"),
        allocation: [{ kind: "debt", accountId: loanId, amount: eur(own) }],
      };
      expect((await wizard(space, plan)).amount).toEqual(eur(sum));
      await createBudget(space, plan);
      const f = (await spendable(space)).figures!;
      expect(f.plannedExpenses).toEqual({
        items: [{ accountId: loanId, amount: eur(own) }],
        total: eur(own),
      });
      // 6 000 − the cell; never 6 000 − 100 − the cell, nor 6 000 − 100.
      expect(f.amount).toEqual(eur(sum));
      expect(f.mini.find((r) => r.row === "goals")?.amount).toEqual(eur(own));
      const grid = await call(space, "GET", "/v1/budget/plan-grid");
      expect(grid.statusCode, grid.body).toBe(200);
      const row = (grid.json().debts.rows as { accountId: string; cells: { extra: unknown }[] }[]).find(
        (r) => r.accountId === loanId,
      )!;
      expect(row.cells[0]!.extra).toEqual(eur(own));
      // A debt the month no longer owes (its plan is gone): its cell does not bring it back.
      extras.set(space.householdId, []);
      const gone = (await spendable(space)).figures!;
      expect(gone.plannedExpenses).toEqual({ items: [], total: eur("0") });
      expect(gone.amount).toEqual(eur("6000"));
      extras.delete(space.householdId);
    });

  it("BUD-03@PoC EC4: a payoff plan's extra payment at the nearest rate replaced by the debt's cell in euro is not «приблизно»", async () => {
    const space = await newSpace();
    await current(space);
    await rate("2026-11-05", "USD", "41.6");
    await rate("2026-11-05", "EUR", "52");
    const loanId = randomUUID();
    const other = randomUUID();
    extras.set(space.householdId, [
      { accountId: loanId, amount: Money.of("50", "USD") },
      { accountId: other, amount: Money.of("12.34", "EUR") },
    ]);
    await createBudget(space, {
      incomePlan: eur("6000"),
      allocation: [{ kind: "debt", accountId: loanId, amount: eur("70.07") }],
    });
    const s = await spendable(space);
    expect(s.figures!.plannedExpenses).toEqual({
      items: [
        { accountId: loanId, amount: eur("70.07") },
        { accountId: other, amount: eur("12.34") },
      ],
      total: eur("82.41"),
    });
    expect(s.figures!.amount).toEqual(eur("5917.59"));
    expect(s.approximate).toMatchObject({ plannedExpenses: false });
    extras.delete(space.householdId);
  });
});

describe("BUD-02@PoC FR 3 (#661): the wizard's «≈ M» and «Можна витратити» read the period's facts by one rule", () => {
  it("BUD-02@PoC FR 3: a first period next month subtracts the share «На кілька місяців» already dated into it — 4 900 €, what «Можна витратити» shows on 1 December", async () => {
    const space = await newSpace();
    const acc = await current(space);
    const groceries = await category(space, "Продукти");
    // 1 200 € on 10 November over 12 months from November: 100 € a month, December's share dated 1 December.
    const yearly = await transaction(space, acc, "-1200.00", "2026-11-10");
    const split = await call(space, "POST", `/v1/transactions/${yearly}/split`, {
      mode: "months",
      startMonth: "2026-11",
      months: 12,
      categoryId: groceries,
    });
    expect(split.statusCode, split.body).toBe(200);
    const plan = { firstPeriod: "2026-12", incomePlan: eur("5000") };
    // 5 000 − December's share 100; November's share is not December's.
    expect(await wizard(space, plan)).toEqual({ period: "2026-12", amount: eur("4900"), missing: [] });
    await createBudget(space, plan);
    now = at("2026-12-01");
    expect((await spendable(space, "2026-12")).figures!.amount).toEqual(eur("4900"));
    // The current month counts November's share as the budget page does: 5 000 − 100.
    now = at("2026-11-12");
    expect((await wizard(space, { ...plan, firstPeriod: "2026-11" })).amount).toEqual(eur("4900"));
  });

  it("BUD-02@PoC FR 3: a spend «Витратити з цілі» leaves the wizard's «≈ M» of the current month unchanged, as it leaves «Можна витратити» (BUD-03 EC5)", async () => {
    const { space, goalId, spendFromGoal } = await ec5(null);
    // As the budget's «План»: the goal planned 0 € in November, so only the facts move the figure.
    const plan = {
      firstPeriod: "2026-11",
      incomePlan: eur("1000"),
      allocation: [{ kind: "goal", goalId, amount: eur("0") }],
    };
    expect((await wizard(space, plan)).amount).toEqual(eur("1000"));
    const before = await spendFromGoal("250.50");
    // The hotel before «Витратити з цілі» is spending on both: 1 000 − 250,50.
    expect(before.amount).toEqual(eur("749.5"));
    expect((await wizard(space, plan)).amount).toEqual(eur("1000"));
    expect((await spendable(space)).figures!.amount).toEqual(eur("1000"));
  });
});
