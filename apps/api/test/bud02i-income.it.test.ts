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
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetPlanSources,
  createBudgetServices,
  type BudgetObligations,
} from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalsServices, type GoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createBudgetTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-02@PoC FR 3, FR 9, FR 11, FR 15, FR 21, AC1, AC7, AC17, AC18, EC1 and BUD-17@PoC FR 1 (owner decision 2026-11-21,
 * options 1 а and 2 а): «План доходу» by income category — the wizard's proposal, the plan saved and changed by
 * category (the income plan = their sum), the card «Дохід» (plan and fact by category), the snapshot of a finished
 * period, the grid's «План доходу»; a budget created with a deficit. Real API on a real PostgreSQL with the real
 * categories, accounts, transactions, categorization and fx-rates modules; goals, debts and regular payments are the
 * test's ports behind the real `createBudgetPlanSources`. Every name and amount is synthetic; the clock is the test's
 * own (Kyiv).
 */
const WEB = "http://localhost:5173";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
const TODAY = "2026-11-18";
let now = at(TODAY);
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
let goalsServices: GoalsServices;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

const eur = (amount: string) => ({ amount, currency: "EUR" });
const m = (amount: string) => Money.of(amount, "EUR");

const goals = new Map<
  string,
  {
    goalId: string;
    requiredMonthly: Money | null;
    targetDate: string | null;
    /** BUD-03@PoC FR 6 (#641): contributed this month; left out — 0. */
    contributedThisMonth?: Money;
  }[]
>();
const minimums = new Map<string, { accountId: string; amount: Money; paid: boolean }[]>();
const recurring = new Map<string, { categoryId: string | null; amount: Money; paid: boolean }[]>();
const extras = new Map<string, { accountId: string; amount: Money }[]>();
const charges = new Map<string, { paymentId: string; month: string; expected: Money }[]>();

const obligations: BudgetObligations = {
  month: async (householdId) => ({
    recurring: recurring.get(householdId) ?? [],
    debtMinimums: minimums.get(householdId) ?? [],
  }),
};

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
  key?: string,
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key !== undefined ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const categoryIds = new Map<string, Map<string, string>>();
async function category(space: Space, name: string): Promise<string> {
  let ids = categoryIds.get(space.householdId);
  if (!ids) {
    const res = await call(space, "GET", "/v1/categories");
    expect(res.statusCode, res.body).toBe(200);
    ids = new Map(
      (res.json().groups as { categories: { id: string; name: string }[] }[]).flatMap((g) =>
        g.categories.map((c) => [c.name, c.id] as const),
      ),
    );
    categoryIds.set(space.householdId, ids);
  }
  expect(ids.get(name), name).toBeDefined();
  return ids.get(name)!;
}

interface Cell {
  amount: { amount: string; currency: string } | null;
  own: boolean;
}
interface Grid {
  months: { period: string }[];
  goals: { rows: { goalId: string; cells: Cell[] }[]; savings: Cell[]; totals: unknown[] };
  debts: { rows: { accountId: string; cells: { minimum: unknown; extra: unknown }[] }[] };
  unallocated: ({ kind: string; amount: { amount: string } } | null)[];
}

async function grid(space: Space): Promise<Grid> {
  const res = await call(space, "GET", "/v1/budget/plan-grid");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Grid;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}
const cells = (householdId: string) => n("budget.plan_cells WHERE household_id = $1", householdId);
const budgets = (householdId: string) => n("budget.budgets WHERE household_id = $1", householdId);

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  goalsServices = createGoalsServices({ accounts, ledger, audit, clock, newId: randomUUID });
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
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx,
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
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
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [createBudgetCategoryUsage(db.databases.for("budget"))],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        goals: goalsServices,
        budget: createBudgetServices({
          planEnabled: (householdId) => fakeFlags().isEnabled(householdId, "budget.plan"),
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
            goals: {
              active: async (householdId) =>
                (goals.get(householdId) ?? []).map((g) => ({
                  ...g,
                  contributedThisMonth:
                    g.contributedThisMonth ?? Money.of("0", g.requiredMonthly?.currency ?? "EUR"),
                })),
            },
            debts: { inMonth: async (householdId) => extras.get(householdId) ?? [] },
            fx,
            recurring: {
              chargesIn: async (householdId, month) =>
                (charges.get(householdId) ?? [])
                  .filter((c) => c.month === month)
                  .map((c) => ({
                    paymentId: c.paymentId,
                    type: "income" as const,
                    categoryId: null,
                    dueOn: `${month}-10`,
                    expected: c.expected,
                    status: "expected" as const,
                    overdueDays: null,
                  })),
            },
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

afterEach(() => {
  now = at(TODAY);
});

const create = (space: Space, body: Record<string, unknown>, key?: string, principal = {}) =>
  call(space, "POST", "/v1/budget", body, principal, key);
const preview = (space: Space, body: Record<string, unknown>) =>
  call(space, "POST", "/v1/budget/allocation", body);
const paths = (res: { json: () => { errors?: { path: string; issue: string }[] } }) =>
  (res.json().errors ?? []).map((e) => `${e.path}: ${e.issue}`);

afterEach(() => {
  goals.clear();
  minimums.clear();
  recurring.clear();
  extras.clear();
  charges.clear();
});

afterEach(() => {
  goals.clear();
  minimums.clear();
  recurring.clear();
  extras.clear();
  charges.clear();
});

const patch = (space: Space, body: Record<string, unknown>) => call(space, "PATCH", "/v1/budget/plan", body);

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

async function account(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний поточний",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

/** A transaction of the account in the category: income positive, spending negative. */
async function transaction(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  categoryName: string,
) {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний платник",
  });
  expect(res.statusCode, res.body).toBe(201);
  const set = await call(space, "PUT", `/v1/transactions/${res.json().id as string}/category`, {
    categoryId: await category(space, categoryName),
  });
  expect(set.statusCode, set.body).toBe(200);
}

/** «Нова категорія доходу…»: a custom income category in the group of that name (made as in «Налаштування → Категорії»). */
async function newIncomeCategory(space: Space, group: string, name: string): Promise<string> {
  const tree = await call(space, "GET", "/v1/categories");
  const groupId = (tree.json().groups as { id: string; name: string }[]).find((g) => g.name === group)!.id;
  const res = await call(space, "POST", "/v1/categories", { groupId, name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function wizard(space: Space) {
  const res = await call(space, "GET", "/v1/budget/wizard");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().fromSpending as {
    incomePlan: unknown;
    incomeIrregular: boolean;
    incomes: { categoryId: string; average: unknown; plan: unknown; irregular: boolean }[];
  };
}

async function period(space: Space, p: string) {
  const res = await call(space, "GET", `/v1/budget/periods/${p}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    incomePlan: unknown;
    incomeCategories: { categoryId: string; plan: unknown; actual: unknown }[];
  };
}

const incomeAudit = (householdId: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'budget.income-plan' AND action = $2",
    householdId,
    action,
  );

describe("BUD-02@PoC FR 21: «План доходу» by income category", () => {
  it("BUD-02@PoC AC18: «Зарплата» 5 000 € and «Дохід від оренди» 395, 405, 405 € → 5 000 € and 400 €; with «Репетиторство» 300 € the plan is 5 700 € and «Дохід» shows plan and fact of the three", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const salary = await category(space, "Зарплата");
    const rent = await category(space, "Дохід від оренди");
    for (const [p, r] of [
      ["2026-08", "395.00"],
      ["2026-09", "405.00"],
      ["2026-10", "405.00"],
    ] as const) {
      await transaction(space, acc, "5000.00", `${p}-25`, "Зарплата");
      await transaction(space, acc, r, `${p}-03`, "Дохід від оренди");
      await transaction(space, acc, "-100.00", `${p}-05`, "Продукти");
    }
    const w = await wizard(space);
    expect(w.incomes).toEqual([
      { categoryId: salary, average: eur("5000"), plan: eur("5000"), irregular: false },
      { categoryId: rent, average: eur("401.67"), plan: eur("400"), irregular: false },
    ]);
    expect(w.incomePlan).toEqual(eur("5400"));
    // «Додати категорію доходу» → «Нова категорія доходу…» «Репетиторство» in «Дохід від роботи», plan 300 €.
    const tutoring = await newIncomeCategory(space, "Дохід від роботи", "Репетиторство");
    const incomePlans = [
      { categoryId: salary, amount: eur("5000") },
      { categoryId: rent, amount: eur("400") },
      { categoryId: tutoring, amount: eur("300") },
    ];
    const step = await preview(space, { firstPeriod: "2026-11", incomePlans });
    expect(step.statusCode, step.body).toBe(200);
    expect(step.json().incomePlan).toEqual(eur("5700"));
    const res = await create(space, { firstPeriod: "2026-11", incomePlans });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().incomePlan).toEqual(eur("5700"));
    expect(res.json().incomePlans).toHaveLength(3);
    expect(await incomeAudit(space.householdId, "create")).toBe(3);
    // November: the salary came in, the rent in part, nothing from tutoring yet.
    await transaction(space, acc, "5000.00", "2026-11-10", "Зарплата");
    await transaction(space, acc, "150.00", "2026-11-03", "Дохід від оренди");
    const nov = await period(space, "2026-11");
    expect(nov.incomePlan).toEqual(eur("5700"));
    // FR 9: first the categories still below the plan (the larger plan first), then those that reached it.
    expect(nov.incomeCategories).toEqual([
      { categoryId: rent, plan: eur("400"), actual: eur("150"), inBudgetCurrency: null },
      { categoryId: tutoring, plan: eur("300"), actual: eur("0"), inBudgetCurrency: null },
      { categoryId: salary, plan: eur("5000"), actual: eur("5000"), inBudgetCurrency: null },
    ]);
  });

  it("BUD-02@PoC FR 9: the income of a category without a plan is a line with plan 0; a future month has the plan without a fact", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const salary = await category(space, "Зарплата");
    const cashback = await category(space, "Кешбек");
    expect(
      (
        await create(space, {
          firstPeriod: "2026-11",
          incomePlans: [{ categoryId: salary, amount: eur("3000") }],
        })
      ).statusCode,
    ).toBe(201);
    await transaction(space, acc, "12.50", "2026-11-04", "Кешбек");
    expect((await period(space, "2026-11")).incomeCategories).toEqual([
      { categoryId: salary, plan: eur("3000"), actual: eur("0"), inBudgetCurrency: null },
      { categoryId: cashback, plan: eur("0"), actual: eur("12.5"), inBudgetCurrency: null },
    ]);
    expect((await period(space, "2026-12")).incomeCategories).toEqual([
      { categoryId: salary, plan: eur("3000"), actual: null, inBudgetCurrency: null },
    ]);
  });

  it("BUD-02@PoC FR 21: «Почати з нуля» leaves «План доходу» empty; a category must be an income one of the caller's space, once; not with `incomePlan`", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const salary = await category(space, "Зарплата");
    const groceries = await category(space, "Продукти");
    const elsewhere = await category(other, "Фриланс");
    const refused = await create(space, {
      firstPeriod: "2026-11",
      incomePlan: eur("1"),
      incomePlans: [
        { categoryId: elsewhere, amount: eur("1") },
        { categoryId: groceries, amount: eur("1") },
        { categoryId: salary, amount: eur("1") },
        { categoryId: salary, amount: eur("2") },
      ],
    });
    expect(refused.statusCode).toBe(400);
    expect(paths(refused)).toEqual([
      "incomePlans.0.categoryId: not_found",
      "incomePlans.1.categoryId: not_income",
      "incomePlans.3.categoryId: duplicate",
      "incomePlan: with_income_plans",
    ]);
    expect(await budgets(space.householdId)).toBe(0);
    const zero = await create(space, { firstPeriod: "2026-11" });
    expect(zero.statusCode, zero.body).toBe(201);
    expect(zero.json()).toMatchObject({ incomePlan: eur("0"), incomePlans: [] });
    expect((await period(space, "2026-11")).incomeCategories).toEqual([]);
  });

  it("BUD-02@PoC FR 21: on «Бюджет» a category's plan is set, changed and removed in place; the income plan stays the sum, each change audited", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const freelance = await category(space, "Фриланс");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    let version = created.json().version as number;
    const added = await patch(space, {
      version,
      incomePlans: [
        { categoryId: salary, amount: eur("3200") },
        { categoryId: freelance, amount: eur("450.50") },
      ],
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json().incomePlan).toEqual(eur("3650.5"));
    version = added.json().version as number;
    // A plan by category takes no single amount: it is the sum of its categories.
    const single = await patch(space, { version, incomePlan: eur("9999") });
    expect(single.statusCode).toBe(400);
    expect(paths(single)).toEqual(["incomePlan: by_category"]);
    const removed = await patch(space, { version, incomePlans: [{ categoryId: freelance, amount: null }] });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({
      incomePlan: eur("3200"),
      incomePlans: [{ categoryId: salary, amount: eur("3200") }],
    });
    expect(await incomeAudit(space.householdId, "create")).toBe(2);
    expect(await incomeAudit(space.householdId, "update")).toBe(1);
    expect(await incomeAudit(space.householdId, "delete")).toBe(1);
    // A stale version changes nothing (another window): 409.
    const stale = await patch(space, { version, incomePlans: [{ categoryId: salary, amount: eur("1") }] });
    expect(stale.statusCode).toBe(409);
  });

  it("BUD-02@PoC FR 21: two changes of the income plan at once with the same version — one is saved, the other is a version conflict; the plan stays the sum", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const freelance = await category(space, "Фриланс");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    const version = created.json().version as number;
    const [a, b] = await Promise.all([
      patch(space, { version, incomePlans: [{ categoryId: freelance, amount: eur("500") }] }),
      patch(space, { version, incomePlans: [{ categoryId: freelance, amount: eur("700") }] }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const saved = (a.statusCode === 200 ? a : b).json();
    const now = await call(space, "GET", "/v1/budget");
    expect(now.json().budget).toMatchObject({ incomePlan: saved.incomePlan, incomePlans: saved.incomePlans });
    expect(["3500", "3700"]).toContain(saved.incomePlan.amount);
  });

  it("BUD-02@PoC FR 11: a finished period keeps the plan of each income category; a later change acts from the current period on", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const freelance = await category(space, "Фриланс");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [
        { categoryId: salary, amount: eur("3000") },
        { categoryId: freelance, amount: eur("200") },
      ],
    });
    now = at("2026-12-05");
    const changed = await patch(space, {
      version: created.json().version as number,
      incomePlans: [
        { categoryId: salary, amount: eur("3100") },
        { categoryId: freelance, amount: null },
      ],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const nov = await period(space, "2026-11");
    expect(nov.incomePlan).toEqual(eur("3200"));
    expect(nov.incomeCategories.map((l) => [l.categoryId, l.plan])).toEqual([
      [salary, eur("3000")],
      [freelance, eur("200")],
    ]);
    const dec = await period(space, "2026-12");
    expect(dec.incomePlan).toEqual(eur("3100"));
    expect(dec.incomeCategories.map((l) => [l.categoryId, l.plan])).toEqual([[salary, eur("3100")]]);
  });

  it("BUD-02@PoC EC1: the irregular rule acts per income category — the salary keeps its 3-month average, the irregular freelance its lowest month of 6, a category with a shorter history the average of its months", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const salary = await category(space, "Зарплата");
    const freelance = await category(space, "Фриланс");
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const side = await category(space, "Підприємництво");
    // The low month (200) is older than the newest 3, whose average and lowest month are 600: the lowest of 6.
    const fees = ["600.00", "200.00", "1000.00", "600.00", "600.00", "600.00"];
    for (const [i, p] of months.entries()) {
      await transaction(space, acc, "3000.00", `${p}-25`, "Зарплата");
      await transaction(space, acc, fees[i]!, `${p}-15`, "Фриланс");
    }
    // Lead decision 2026-11-21: 2 months of its own history — not irregular, (300 + 100) / 2 = 200.
    await transaction(space, acc, "300.00", "2026-09-10", "Підприємництво");
    await transaction(space, acc, "100.00", "2026-10-10", "Підприємництво");
    const w = await wizard(space);
    expect(w.incomes).toEqual([
      { categoryId: salary, average: eur("3000"), plan: eur("3000"), irregular: false },
      { categoryId: freelance, average: eur("600"), plan: eur("200"), irregular: true },
      { categoryId: side, average: eur("200"), plan: eur("200"), irregular: false },
    ]);
    expect(w).toMatchObject({ incomeIrregular: true, incomePlan: eur("3400") });
  });
});

describe("BUD-17@PoC FR 1: the grid's «План доходу»", () => {
  it("BUD-17@PoC FR 1: «План доходу» of the grid is the budget's income plan — the sum of the income categories' plans", async () => {
    const space = await newSpace();
    const res = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [
        { categoryId: await category(space, "Зарплата"), amount: eur("5000") },
        { categoryId: await category(space, "Дохід від оренди"), amount: eur("400") },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const g = (await call(space, "GET", "/v1/budget/plan-grid")).json() as {
      months: { period: string }[];
      income: { plan: { amount: unknown; own: boolean }[] };
    };
    const nov = g.months.findIndex((x) => x.period === "2026-11");
    expect(g.income.plan[nov]).toMatchObject({ amount: eur("5400"), own: false });
    expect(g.income.plan[nov + 1]).toMatchObject({ amount: eur("5400"), own: false });
  });
});

describe("BUD-02@PoC FR 15: a budget with a deficit", () => {
  it("BUD-02@PoC AC17: plan 3 000 €, limits 3 200 € all mandatory, «Лишити дефіцит» → the budget is created; «План» shows «Дефіцит 200 €», «Можна витратити» −200,00 € and the daily limit 0", async () => {
    const space = await newSpace();
    await account(space);
    const plan = {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: await category(space, "Зарплата"), amount: eur("3000") }],
      // «Продукти» and «Оренда» are mandatory by default (BUD-01 FR 11).
      limits: [
        { categoryId: await category(space, "Продукти"), amount: eur("2000") },
        { categoryId: await category(space, "Оренда"), amount: eur("1200") },
      ],
    };
    const step = await preview(space, { ...plan, allocation: [] });
    expect(step.statusCode, step.body).toBe(200);
    expect(step.json().balance).toMatchObject({ kind: "deficit", amount: eur("200") });
    expect(step.json().choice).toEqual({ chosen: eur("0"), rest: eur("200"), status: "short" });
    const res = await create(space, { ...plan, allocation: [] });
    expect(res.statusCode, res.body).toBe(201);
    const g = await grid(space);
    const nov = g.months.findIndex((x) => x.period === "2026-11");
    expect(g.unallocated[nov]).toEqual({ kind: "deficit", amount: eur("200") });
    const s = await call(space, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().figures).toMatchObject({ amount: eur("-200"), daily: eur("0") });
  });

  it("BUD-02@PoC AC7: «З цілі …» covering less than the 200 € deficit is saved — the goal's month lowered, the rest stays the plan's deficit; nothing is moved", async () => {
    const space = await newSpace();
    const goalId = randomUUID();
    goals.set(space.householdId, [{ goalId, requiredMonthly: m("300"), targetDate: "2027-03-31" }]);
    // 3 300 − 3 200 − the goal's planned 300 (Q5 а) = a deficit of 200.
    const res = await create(space, {
      firstPeriod: "2026-12",
      incomePlans: [{ categoryId: await category(space, "Зарплата"), amount: eur("3300") }],
      limits: [{ categoryId: await category(space, "Кафе і ресторани"), amount: eur("3200") }],
      allocation: [{ kind: "from-goal", goalId, amount: eur("150") }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    expect(g.goals.rows[0]!.cells[dec]).toMatchObject({ amount: eur("150"), own: true });
    expect(g.unallocated[dec]).toEqual({ kind: "deficit", amount: eur("50") });
    expect(await cells(space.householdId)).toBe(1);
  });
});
