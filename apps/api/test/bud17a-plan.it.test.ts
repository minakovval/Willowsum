import { randomUUID } from "node:crypto";
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
/** The test's regular incomes (module recurring's charges), by space and month. */
const charges = new Map<string, { paymentId: string; month: string; expected: Money }[]>();

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

interface Cell {
  amount: { amount: string; currency: string } | null;
  own: boolean;
  version: number;
}
interface Grid {
  months: { period: string; mode: string; inBudget: boolean }[];
  income: {
    plan: Cell[];
    rows: { paymentId: string; cells: (Cell & { expected: boolean })[] }[];
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
          usage: [createBudgetCategoryUsage(db.databases.for("budget"))],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        goals: goalsServices,
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
            goals: {
              active: async (householdId) =>
                (goals.get(householdId) ?? []).map((g) => ({
                  ...g,
                  contributedThisMonth: Money.of("0", g.requiredMonthly?.currency ?? "EUR"),
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

  it("BUD-17@PoC FR 1: «Надходження» — «Андрій, зарплата» and «Олена, зарплата» are the month's sources; over «План доходу» their sum is its income plan", async () => {
    const space = await newSpace();
    await budgetWith(space, "4000", {});
    const andrii = randomUUID();
    const olena = randomUUID();
    charges.set(space.householdId, [
      ...["2026-12", "2027-01"].flatMap((month) => [
        { paymentId: andrii, month, expected: Money.of("3100", "EUR") },
        { paymentId: olena, month, expected: Money.of("2500", "EUR") },
      ]),
    ]);
    // November has no regular income: all of «План доходу» (the budget's income plan) is «Інші надходження».
    const before = await grid(space);
    expect(before.income.rows.map((r) => r.paymentId)).toEqual([andrii, olena]);
    expect(before.income.plan[0]).toEqual({ amount: eur("4000"), own: false, version: 0 });
    expect(before.income.other.slice(0, 4)).toEqual([eur("4000"), null, null, eur("4000")]);
    expect(before.income.totals.slice(0, 4)).toEqual([eur("4000"), eur("5600"), eur("5600"), eur("4000")]);
    const res = await put(space, {
      period: "2026-12",
      kind: "income",
      lineId: olena,
      amount: eur("2000"),
      version: 0,
    });
    expect(res.statusCode, res.body).toBe(200);
    const g = await grid(space);
    expect(g.income.rows[1]!.cells[1]).toEqual({
      amount: eur("2000"),
      own: true,
      version: 1,
      expected: true,
    });
    expect(g.income.totals[1]).toEqual(eur("5100"));
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("5100"));
    expect((await call(space, "GET", "/v1/budget/periods/2027-01")).json().incomePlan).toEqual(eur("5600"));
    // A payment not expected in the month is no line there.
    const refused = await put(space, {
      period: "2027-02",
      kind: "income",
      lineId: olena,
      amount: eur("1"),
      version: 0,
    });
    expect(refused.json().errors).toEqual([{ in: "body", path: "lineId", issue: "not_found" }]);
  });

  it("BUD-17@PoC FR 1 (owner decision 2026-11-19, Q3): regular incomes under the typed «План доходу» — «Інші надходження» is the rest, the month's plan stays 5 600; over it — no negative row", async () => {
    const space = await newSpace();
    await budgetWith(space, "4000", {});
    const andrii = randomUUID();
    charges.set(
      space.householdId,
      ["2026-12", "2027-01"].map((month) => ({
        paymentId: andrii,
        month,
        expected: Money.of("3100", "EUR"),
      })),
    );
    const typed = await put(space, {
      period: "2026-12",
      kind: "income",
      lineId: null,
      amount: eur("5600"),
      version: 0,
    });
    expect(typed.statusCode, typed.body).toBe(200);
    const g = await grid(space);
    const dec = month(g, "2026-12");
    expect(g.income.plan[dec]).toEqual({ amount: eur("5600"), own: true, version: 1 });
    expect(g.income.other[dec]).toEqual(eur("2500"));
    expect(g.income.totals[dec]).toEqual(eur("5600"));
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("5600"));
    // January: the regular incomes (3 100) are under the budget's 4 000 — «Інші надходження» 900.
    expect(g.income.other[month(g, "2027-01")]).toEqual(eur("900"));
    // Lead decision (Q3): regular incomes over the plan — no negative row; the sum is the regular incomes.
    charges.set(
      space.householdId,
      ["2026-12", "2027-01"].map((month) => ({
        paymentId: andrii,
        month,
        expected: Money.of("6000.50", "EUR"),
      })),
    );
    const over = await grid(space);
    expect(over.income.other[dec]).toBeNull();
    expect(over.income.totals[dec]).toEqual(eur("6000.5"));
    expect(over.income.plan[dec]!.amount).toEqual(eur("5600"));
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("6000.5"));
  });

  it("BUD-17@PoC EC2: an income no longer expected stops counting in the period plan — it agrees with the grid", async () => {
    const space = await newSpace();
    await budgetWith(space, "500", {});
    const bonus = randomUUID();
    charges.set(space.householdId, [
      { paymentId: bonus, month: "2026-12", expected: Money.of("700", "EUR") },
    ]);
    expect(
      (await put(space, { period: "2026-12", kind: "income", lineId: bonus, amount: eur("900"), version: 0 }))
        .statusCode,
    ).toBe(200);
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("900"));
    charges.delete(space.householdId);
    const g = await grid(space);
    expect(g.income.rows.map((r) => r.paymentId)).toEqual([]);
    expect(g.income.totals[1]).toEqual(eur("500"));
    expect((await call(space, "GET", "/v1/budget/periods/2026-12")).json().incomePlan).toEqual(eur("500"));
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

  it("BUD-17@PoC business rules (owner decision 2026-11-19, Q2): a change of the income plan on «Бюджет» keeps «План доходу» typed for a month on «План»", async () => {
    const space = await newSpace();
    const b = await budgetWith(space, "4000", {});
    expect(
      (await put(space, { period: "2026-12", kind: "income", lineId: null, amount: eur("5600"), version: 0 }))
        .statusCode,
    ).toBe(200);
    const patch = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      incomePlan: eur("4500.50"),
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const g = await grid(space);
    expect(g.income.plan.slice(0, 3)).toEqual([
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
