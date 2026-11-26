import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
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
  type BudgetServices,
} from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalPlans, createGoalsServices, type GoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createBudgetTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

/**
 * BUD-17@PoC a) (wave 2 row 35), the server part of «Бюджет → План», through the real API on a real PostgreSQL with
 * the real categories, accounts, transactions, categorization and fx-rates modules. The goals (module goals), the
 * debts' minimum payments (`BudgetObligations`) and the saved plans' extra payments (module debt-payoff) are the
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

/** The test's goals, debts' minimums and extra payments, by space. */
const goals = new Map<
  string,
  { goalId: string; requiredMonthly: Money | null; targetDate: string | null }[]
>();
const minimums = new Map<string, { accountId: string; amount: Money; paid: boolean }[]>();
const extras = new Map<string, { accountId: string; amount: Money }[]>();

const obligations: BudgetObligations = {
  month: async (householdId) => ({ recurring: [], debtMinimums: minimums.get(householdId) ?? [] }),
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

async function budgetWith(space: Space, income: string, limits: Record<string, string>) {
  const res = await call(space, "POST", "/v1/budget", {
    firstPeriod: "2026-11",
    incomePlan: eur(income),
    limits: await Promise.all(
      Object.entries(limits).map(async ([name, amount]) => ({
        categoryId: await category(space, name),
        amount: eur(amount),
      })),
    ),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; version: number };
}

/** BUD-02 FR 21: a budget with its income categories' plans (by name); the category ids in that order. */
/** The ids of the income categories, in the order of `plans` (one to three). */
async function budgetWithIncome(
  space: Space,
  plans: Record<string, string>,
): Promise<[string, string, string]> {
  const ids = await Promise.all(Object.keys(plans).map((name) => category(space, name)));
  const res = await call(space, "POST", "/v1/budget", {
    firstPeriod: "2026-11",
    incomePlans: Object.values(plans).map((amount, i) => ({ categoryId: ids[i], amount: eur(amount) })),
    limits: [],
  });
  expect(res.statusCode, res.body).toBe(201);
  return ids as [string, string, string];
}

/** Row 231: the data step of `0010_plan_income_categories.sql`, run again on rows written after the migrations. */
const MIGRATION_INSERT = readFileSync(
  new URL("../src/modules/budget/adapters/db/migrations/0010_plan_income_categories.sql", import.meta.url),
  "utf8",
)
  .split("CREATE INDEX")[0]!
  .replaceAll("plan_cells", "budget.plan_cells")
  .replaceAll("JOIN budgets", "JOIN budget.budgets")
  .replaceAll("FROM income_plans", "FROM budget.income_plans")
  .replace(/--[^\n]*\n/g, "");

interface Cell {
  amount: { amount: string; currency: string } | null;
  own: boolean;
  version: number;
}
interface Grid {
  months: { period: string; mode: string; inBudget: boolean }[];
  income: {
    categories: { categoryId: string; cells: Cell[] }[];
    plan: Cell[];
    rows: unknown[];
    other: unknown[];
    totals: unknown[];
  };
  expenses: { groups: { categories: { categoryId: string; cells: Cell[] }[] }[]; totals: unknown[] };
  goals: {
    rows: { goalId: string; cells: (Cell & { required: unknown })[] }[];
    savings: Cell[];
    totals: unknown[];
  };
  debts: { rows: { accountId: string; cells: { minimum: unknown; extra: unknown }[] }[]; totals: unknown[] };
  unallocated: ({ kind: string; amount: { amount: string } } | null)[];
}

async function grid(space: Space): Promise<Grid> {
  const res = await call(space, "GET", "/v1/budget/plan-grid");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Grid;
}

const row = (g: Grid, categoryId: string) =>
  g.expenses.groups.flatMap((x) => x.categories).find((c) => c.categoryId === categoryId);
const month = (g: Grid, period: string) => g.months.findIndex((m) => m.period === period);

const put = (space: Space, body: Record<string, unknown>) =>
  call(space, "PUT", "/v1/budget/plan-grid/cells", body);

async function limitOf(space: Space, period: string, categoryId: string): Promise<string | undefined> {
  const res = await call(space, "GET", `/v1/budget/periods/${period}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().groups as { categories: { categoryId: string; limit: { amount: string } }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.categoryId === categoryId)?.limit.amount;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

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
          usage: [createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices)],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        goals: goalsServices,
        budget: (budgetServices = createBudgetServices({
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
            goals: {
              active: async (householdId) =>
                (goals.get(householdId) ?? []).map((g) => ({
                  ...g,
                  contributedThisMonth: Money.of("0", g.requiredMonthly?.currency ?? "EUR"),
                })),
            },
            debts: { inMonth: async (householdId) => extras.get(householdId) ?? [] },
            fx,
          }),
        })),
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

describe("BUD-17@PoC: «Бюджет → План»", () => {
  it("BUD-17@PoC AC1, FR 1, FR 4, FR 6: the grid is the current month and the 11 next of the space's one budget; «Продукти» November = 700 €", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const g = await grid(space);
    expect(g.months.map((m) => m.period)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
      "2027-09",
      "2027-10",
    ]);
    expect(g.months[0]).toEqual({ period: "2026-11", mode: "current", inBudget: true });
    const groceries = row(g, await category(space, "Продукти"))!;
    expect(groceries.cells[0]).toEqual({ amount: eur("700"), own: false, version: 0 });
    expect(groceries.cells.every((c) => c.amount?.amount === "700")).toBe(true);
    // FR 4: one budget per space — the grid takes no budget and has no switcher.
    expect(Object.keys(g).sort()).toEqual([
      "currency",
      "debts",
      "expenses",
      "goals",
      "income",
      "months",
      "rates",
      "unallocated",
    ]);
  });

  it("BUD-17@PoC AC2, FR 2: December's cell 650 € is December's limit, saved at once and audited; November and January keep 700 €", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const res = await put(space, {
      period: "2026-12",
      kind: "limit",
      lineId: groceries,
      amount: eur("650.00"),
      version: 0,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ amount: eur("650"), version: 1 });
    expect(await limitOf(space, "2026-12", groceries)).toBe("650");
    expect(await limitOf(space, "2026-11", groceries)).toBe("700");
    expect(await limitOf(space, "2027-01", groceries)).toBe("700");
    const cells = row(await grid(space), groceries)!.cells;
    expect(cells[1]).toEqual({ amount: eur("650"), own: true, version: 1 });
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell' AND action = 'create'",
        space.householdId,
      ),
    ).toBe(1);
    // The same value again writes nothing.
    const again = await put(space, {
      period: "2026-12",
      kind: "limit",
      lineId: groceries,
      amount: eur("650"),
      version: 1,
    });
    expect(again.json()).toEqual({ amount: eur("650"), version: 1 });
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell'",
        space.householdId,
      ),
    ).toBe(1);
  });

  it("BUD-17@PoC FR 2: a finished month keeps its own cell in its snapshot; a new month has the budget-wide limit", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    expect(
      (
        await put(space, {
          period: "2026-12",
          kind: "limit",
          lineId: groceries,
          amount: eur("650"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    now = at("2027-01-05");
    expect(await limitOf(space, "2026-12", groceries)).toBe("650");
    expect(await limitOf(space, "2027-01", groceries)).toBe("700");
    expect((await grid(space)).months[0]!.period).toBe("2027-01");
  });

  it("BUD-17@PoC AC3: in November a cell of October is read only — «Минулий місяць змінити не можна»", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const past = await put(space, {
      period: "2026-10",
      kind: "limit",
      lineId: groceries,
      amount: eur("1"),
      version: 0,
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().errors).toEqual([{ in: "body", path: "period", issue: "past" }]);
    const far = await put(space, {
      period: "2027-11",
      kind: "limit",
      lineId: groceries,
      amount: eur("1"),
      version: 0,
    });
    expect(far.json().errors).toEqual([{ in: "body", path: "period", issue: "too_far" }]);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-17@PoC AC4, FR 3: a save with the version another window already changed is refused — no silent overwrite", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const cell = { period: "2027-09", kind: "limit", lineId: groceries };
    const first = await put(space, { ...cell, amount: eur("700"), version: 0 });
    expect(first.json()).toEqual({ amount: eur("700"), version: 1 });
    const second = await put(space, { ...cell, amount: eur("750"), version: 1 });
    expect(second.json()).toEqual({ amount: eur("750"), version: 2 });
    // The first window still holds version 1: its next save is refused and the cell shows 750 € (700 € → 750 €).
    const stale = await put(space, { ...cell, amount: eur("720"), version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 2 });
    const cells = row(await grid(space), groceries)!.cells;
    expect(cells[month(await grid(space), "2027-09")]).toEqual({ amount: eur("750"), own: true, version: 2 });
  });

  it("BUD-17@PoC FR 3: two saves of one cell at once — one is saved, the other refused; one audit entry", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const cell = { period: "2027-02", kind: "limit", lineId: groceries, version: 0 };
    const both = await Promise.all([
      put(space, { ...cell, amount: eur("600") }),
      put(space, { ...cell, amount: eur("800") }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const saved = both.find((r) => r.statusCode === 200)!.json().amount;
    const cells = row(await grid(space), groceries)!.cells;
    expect(cells[month(await grid(space), "2027-02")]).toEqual({ amount: saved, own: true, version: 1 });
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell'",
        space.householdId,
      ),
    ).toBe(1);
  });

  it("BUD-17@PoC AC5: another space's request is «не знайдено» and reveals nothing; a scoped member too", async () => {
    const owner = await newSpace();
    await budgetWith(owner, "5600", { Продукти: "700.00" });
    const groceries = await category(owner, "Продукти");
    const stranger = await newSpace();
    const read = await call(stranger, "GET", "/v1/budget/plan-grid");
    expect(read.statusCode).toBe(404);
    expect(leakText(read.body)).not.toContain("5600");
    const write = await put(stranger, {
      period: "2026-12",
      kind: "limit",
      lineId: groceries,
      amount: eur("1"),
      version: 0,
    });
    expect(write.statusCode).toBe(404);
    const scoped = { role: "viewer", scoped: true };
    expect((await call(owner, "GET", "/v1/budget/plan-grid", undefined, scoped)).statusCode).toBe(404);
    const body = { period: "2026-12", kind: "limit", lineId: groceries, amount: eur("1"), version: 0 };
    expect((await call(owner, "PUT", "/v1/budget/plan-grid/cells", body, scoped)).statusCode).toBe(403);
    expect(await n("budget.plan_cells WHERE household_id = $1", owner.householdId)).toBe(0);
  });

  it("BUD-17@PoC AC6, FR 1: «Не розподілено 200 €» = 5 600 − 4 200 − 900 − 300; at 4 600 € of expenses «Дефіцит 200 €»", async () => {
    const space = await newSpace();
    await budgetWith(space, "5600", { Продукти: "4200.00" });
    const loan = randomUUID();
    minimums.set(space.householdId, [{ accountId: loan, amount: Money.of("300", "EUR"), paid: false }]);
    expect(
      (await put(space, { period: "2026-11", kind: "savings", lineId: null, amount: eur("900"), version: 0 }))
        .statusCode,
    ).toBe(200);
    let g = await grid(space);
    expect(g.income.totals[0]).toEqual(eur("5600"));
    expect(g.expenses.totals[0]).toEqual(eur("4200"));
    expect(g.goals.totals[0]).toEqual(eur("900"));
    expect(g.debts.totals[0]).toEqual(eur("300"));
    expect(g.debts.rows).toEqual([
      { accountId: loan, cells: Array(12).fill({ minimum: eur("300"), extra: null }) },
    ]);
    expect(g.unallocated[0]).toEqual({ kind: "unallocated", amount: eur("200") });
    const groceries = await category(space, "Продукти");
    expect(
      (
        await put(space, {
          period: "2026-11",
          kind: "limit",
          lineId: groceries,
          amount: eur("4600"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    g = await grid(space);
    expect(g.unallocated[0]).toEqual({ kind: "deficit", amount: eur("200") });
    // December has no savings cell: 5 600 − 4 200 − 300.
    expect(g.unallocated[1]).toEqual({ kind: "unallocated", amount: eur("1100") });
  });

  it("BUD-17@PoC FR 1: a saved plan's extra payment is in «Погашення боргів»; one without a rate leaves no «Не розподілено»", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000", {});
    const card = randomUUID();
    extras.set(space.householdId, [{ accountId: card, amount: Money.of("50", "EUR") }]);
    let g = await grid(space);
    expect(g.debts.rows[0]).toEqual({
      accountId: card,
      cells: Array(12).fill({ minimum: null, extra: eur("50") }),
    });
    expect(g.unallocated[0]).toEqual({ kind: "unallocated", amount: eur("950") });
    extras.set(space.householdId, [{ accountId: card, amount: Money.of("50", "XAU") }]);
    g = await grid(space);
    expect(g.debts.totals[0]).toBeNull();
    expect(g.unallocated[0]).toBeNull();
  });

  it("BUD-17@PoC AC7: «Відпустка» needs 334 €; December's cell 200 € is December's planned contribution and planned savings", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000", {});
    const trip = randomUUID();
    goals.set(space.householdId, [
      { goalId: trip, requiredMonthly: Money.of("334", "EUR"), targetDate: "2027-08-01" },
    ]);
    const res = await put(space, {
      period: "2026-12",
      kind: "goal",
      lineId: trip,
      amount: eur("200"),
      version: 0,
    });
    expect(res.statusCode, res.body).toBe(200);
    const g = await grid(space);
    const cells = g.goals.rows[0]!.cells;
    expect(cells[0]).toEqual({ amount: eur("334"), own: false, version: 0, required: eur("334") });
    expect(cells[1]).toEqual({ amount: eur("200"), own: true, version: 1, required: eur("334") });
    // No contribution after the goal's month.
    expect(cells[month(g, "2027-09")]!.amount).toBeNull();
    expect(g.unallocated[1]).toEqual({ kind: "unallocated", amount: eur("800") });
    const december = await call(space, "GET", "/v1/budget/periods/2026-12");
    expect(december.json().plannedSavings).toEqual(eur("200"));
    // A goal that is not the space's active one is refused.
    const other = await put(space, {
      period: "2026-12",
      kind: "goal",
      lineId: randomUUID(),
      amount: eur("1"),
      version: 0,
    });
    expect(other.json().errors).toEqual([{ in: "body", path: "lineId", issue: "not_found" }]);
  });

  it("BUD-17@PoC FR 1 (owner decision 2026-11-21): «Надходження» — «Зарплата» 5 000 € and «Фриланс» 600 € are a row each and 5 600 € together; December's «Фриланс» 800,25 € is December's plan of the category", async () => {
    const space = await newSpace();
    const [salary, freelance] = await budgetWithIncome(space, { Зарплата: "5000", Фриланс: "600" });
    const before = await grid(space);
    const incomeRow = (g: Grid, id: string) => g.income.categories.find((r) => r.categoryId === id)!;
    expect(before.income.categories.map((r) => r.categoryId).sort()).toEqual([salary, freelance].sort());
    expect(incomeRow(before, freelance).cells[0]).toEqual({ amount: eur("600"), own: false, version: 0 });
    expect(before.income.totals).toEqual(Array(12).fill(eur("5600")));
    // ARC-07 FR 3: the former fields stay until their removal — no «План доходу» row, no regular incomes, no «Інші».
    expect(before.income.plan[0]).toEqual({ amount: eur("5600"), own: false, version: 0 });
    expect(before.income.rows).toEqual([]);
    expect(before.income.other).toEqual(Array(12).fill(null));
    const res = await put(space, {
      period: "2026-12",
      kind: "income",
      lineId: freelance,
      amount: eur("800.25"),
      version: 0,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ amount: eur("800.25"), version: 1 });
    const g = await grid(space);
    expect(incomeRow(g, freelance).cells[1]).toEqual({ amount: eur("800.25"), own: true, version: 1 });
    expect(g.income.totals.slice(0, 3)).toEqual([eur("5600"), eur("5800.25"), eur("5600")]);
    // BUD-02 FR 9, BUD-03 FR 2: the month's plan and its card «Дохід» — the sum of the rows, the category's own value.
    const december = (await call(space, "GET", "/v1/budget/periods/2026-12")).json();
    expect(december.incomePlan).toEqual(eur("5800.25"));
    expect((await call(space, "GET", "/v1/budget/periods/2027-01")).json().incomePlan).toEqual(eur("5600"));
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell' AND action = 'create'",
        space.householdId,
      ),
    ).toBe(1);
  });

  it("BUD-17@PoC FR 1: a cell of «Надходження» is an income category of the budget's plan in its currency — anything else is refused and nothing is written", async () => {
    const space = await newSpace();
    const [salary] = await budgetWithIncome(space, { Зарплата: "5000" });
    const other = await newSpace();
    const [foreign] = await budgetWithIncome(other, { Зарплата: "100" });
    const refuse = async (body: Record<string, unknown>, issue: string, path = "lineId") => {
      const res = await put(space, {
        period: "2026-12",
        kind: "income",
        amount: eur("1"),
        version: 0,
        ...body,
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().errors).toEqual([{ in: "body", path, issue }]);
    };
    // The former «План доходу» (no line), a category without a plan, an expense one, another space's, a random id.
    await refuse({ lineId: null }, "required");
    await refuse({ lineId: await category(space, "Кешбек") }, "not_found");
    await refuse({ lineId: await category(space, "Продукти") }, "not_income");
    await refuse({ lineId: foreign }, "not_found");
    await refuse({ lineId: randomUUID() }, "not_found");
    await refuse({ lineId: salary, amount: { amount: "1", currency: "USD" } }, "currency", "amount.currency");
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
    expect((await grid(other)).income.totals[1]).toEqual(eur("100"));
  });

  it("BUD-17@PoC FR 1: two saves of one income cell at once — one is saved, the other refused; one audit entry", async () => {
    const space = await newSpace();
    const [salary] = await budgetWithIncome(space, { Зарплата: "5000" });
    const body = (amount: string) => ({
      period: "2027-01",
      kind: "income",
      lineId: salary,
      amount: eur(amount),
      version: 0,
    });
    const [a, b] = await Promise.all([put(space, body("4000")), put(space, body("4500"))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const saved = (a.statusCode === 200 ? a : b).json().amount;
    const g = await grid(space);
    expect(g.income.categories[0]!.cells[2]).toEqual({ amount: saved, own: true, version: 1 });
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell'",
        space.householdId,
      ),
    ).toBe(1);
  });

  it("BUD-17@PoC EC2: an income category hidden or taken out of the budget's plan — its row is gone and its month's value no longer counts", async () => {
    const space = await newSpace();
    const [salary, freelance] = await budgetWithIncome(space, { Зарплата: "5000", Фриланс: "600" });
    for (const lineId of [salary, freelance])
      expect(
        (await put(space, { period: "2026-12", kind: "income", lineId, amount: eur("100"), version: 0 }))
          .statusCode,
      ).toBe(200);
    const b = (await call(space, "GET", "/v1/budget")).json().budget as { version: number };
    const removed = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      incomePlans: [{ categoryId: freelance, amount: null }],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    let g = await grid(space);
    expect(g.income.categories.map((r) => r.categoryId)).toEqual([salary]);
    expect(g.income.totals.slice(0, 2)).toEqual([eur("5000"), eur("100")]);
    const hide = await call(space, "PATCH", `/v1/categories/${salary}`, { hidden: true });
    expect(hide.statusCode, hide.body).toBe(200);
    g = await grid(space);
    expect(g.income.categories).toEqual([]);
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("5000"));
  });

  it("BUD-17@PoC FR 1 (lead decision 2026-11-26, row 231): a month's «План доходу» typed before is that month's cells of the income categories, adding up to it exactly; the old row stays", async () => {
    const space = await newSpace();
    const [salary, rent, freelance] = await budgetWithIncome(space, {
      Зарплата: "3000",
      "Дохід від оренди": "1000",
      Фриланс: "500.50",
    });
    const b = (await call(space, "GET", "/v1/budget")).json().budget as { id: string };
    const typed = async (period: string, amount: string) =>
      db.owner.query(
        `INSERT INTO budget.plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
         VALUES ($1, $2, $3::date, 'income', '00000000-0000-0000-0000-000000000000', $4, 'EUR', 3)`,
        [space.householdId, b.id, `${period}-01`, amount],
      );
    // Above the plans' sum (4 500,50), under it, and between the second and the third plan.
    await typed("2026-12", "5600.07");
    await typed("2027-01", "3500.25");
    await typed("2027-02", "4100");
    await db.owner.query(MIGRATION_INSERT);
    const g = await grid(space);
    const cells = (period: string) =>
      [salary, rent, freelance].map(
        (id) => g.income.categories.find((r) => r.categoryId === id)!.cells[month(g, period)],
      );
    expect(cells("2026-12").map((c) => c!.amount)).toEqual([eur("4099.57"), eur("1000"), eur("500.5")]);
    expect(cells("2027-01").map((c) => c!.amount)).toEqual([eur("3000"), eur("500.25"), eur("0")]);
    expect(cells("2027-02").map((c) => c!.amount)).toEqual([eur("3000"), eur("1000"), eur("100")]);
    expect(cells("2027-02").every((c) => c!.own && c!.version === 1)).toBe(true);
    expect(g.income.totals.slice(1, 5)).toEqual([eur("5600.07"), eur("3500.25"), eur("4100"), eur("4500.5")]);
    expect(
      await n(
        "budget.plan_cells WHERE household_id = $1 AND line_id = '00000000-0000-0000-0000-000000000000'",
        space.householdId,
      ),
    ).toBe(3);
  });

  it("BUD-17@PoC business rules (owner decision 2026-11-19, Q2): a change of the limit on «Бюджет» acts on the current and future months — a month's own value typed on «План» is kept", async () => {
    const space = await newSpace();
    const b = await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    expect(
      (
        await put(space, {
          period: "2026-12",
          kind: "limit",
          lineId: groceries,
          amount: eur("650"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    const patch = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      limits: [{ categoryId: groceries, amount: eur("800") }],
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const cells = row(await grid(space), groceries)!.cells;
    expect(cells[0]).toEqual({ amount: eur("800"), own: false, version: 0 });
    expect(cells[1]).toEqual({ amount: eur("650"), own: true, version: 1 });
    expect(cells[2]).toEqual({ amount: eur("800"), own: false, version: 0 });
    expect(await limitOf(space, "2026-12", groceries)).toBe("650");
    expect(await limitOf(space, "2027-01", groceries)).toBe("800");
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell' AND action = 'delete'",
        space.householdId,
      ),
    ).toBe(0);
  });

  it("BUD-17@PoC FR 1, business rules (owner decision 2026-11-19, Q2): a change of a category's plan on «Бюджет» keeps the month's value typed for it on «План»", async () => {
    const space = await newSpace();
    const [salary] = await budgetWithIncome(space, { Зарплата: "4000" });
    expect(
      (
        await put(space, {
          period: "2026-12",
          kind: "income",
          lineId: salary,
          amount: eur("5600"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    const b = (await call(space, "GET", "/v1/budget")).json().budget as { version: number };
    const patch = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      incomePlans: [{ categoryId: salary, amount: eur("4500.50") }],
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const g = await grid(space);
    expect(g.income.categories[0]!.cells.slice(0, 3)).toEqual([
      { amount: eur("4500.5"), own: false, version: 0 },
      { amount: eur("5600"), own: true, version: 1 },
      { amount: eur("4500.5"), own: false, version: 0 },
    ]);
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("5600"));
    expect((await call(space, "GET", "/v1/budget/periods/2027-01")).json().incomePlan).toEqual(eur("4500.5"));
  });

  it("BUD-17@PoC EC1: a new category in the middle of the year is empty in every month", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const cafe = row(await grid(space), await category(space, "Кафе і ресторани"))!;
    expect(cafe.cells.every((c) => c.amount === null && !c.own)).toBe(true);
  });

  it("BUD-17@PoC EC2: a hidden category's row is gone from the grid; a finished month keeps its value", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const hide = await call(space, "PATCH", `/v1/categories/${groceries}`, { hidden: true });
    expect(hide.statusCode, hide.body).toBe(200);
    expect(row(await grid(space), groceries)).toBeUndefined();
    const hidden = await put(space, {
      period: "2026-12",
      kind: "limit",
      lineId: groceries,
      amount: eur("1"),
      version: 0,
    });
    expect(hidden.json().errors).toEqual([{ in: "body", path: "lineId", issue: "hidden" }]);
    now = at("2026-12-02");
    expect(await limitOf(space, "2026-11", groceries)).toBe("700");
  });

  it("BUD-17@PoC FR 1: module goals gives «План» each active goal with the required contribution its card shows", async () => {
    const space = await newSpace();
    const created = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Відпустка",
      target: eur("3000.00"),
      targetDate: "2027-08-18",
    });
    expect(created.statusCode, created.body).toBe(201);
    const card = created.json() as { id: string; requiredMonthly: unknown };
    const plans = await createGoalPlans(db.databases.for("goals"), goalsServices).active(space.householdId);
    expect(plans).toEqual([
      {
        goalId: card.id,
        requiredMonthly: expect.any(Money),
        targetDate: "2027-08-18",
        contributedThisMonth: expect.any(Money),
      },
    ]);
    expect(plans[0]!.requiredMonthly!.toJSON()).toEqual(card.requiredMonthly);
    expect(await createGoalPlans(db.databases.for("goals"), goalsServices).active(randomUUID())).toEqual([]);
  });
});
