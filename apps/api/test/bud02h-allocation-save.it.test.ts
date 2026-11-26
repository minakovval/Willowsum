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
  type BudgetServices,
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

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

/**
 * BUD-02@PoC FR 3, FR 15, AC6, AC7 (row 31, saving «Розподіл»): POST /v1/budget saves the typed rows of «Розподіл»
 * with the budget, in one transaction, as the first period's cells of «План» (BUD-17), checked with the rules of POST
 * /v1/budget/allocation; the calculation gives «Можна витратити в <місяць> ≈ M» or null with what is missing. Real
 * API on a real PostgreSQL with the real categories, accounts, transactions, categorization and fx-rates modules; the
 * goals, the debts' minimum payments and the payoff plans' extra payments are the test's ports behind the real
 * `createBudgetPlanSources`. Every name and amount is synthetic; the clock is the test's own (Kyiv).
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
  method: "GET" | "POST",
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

/** A space with a goal (required 300 €/month to March), a debt with a 100 € minimum and the plan of AC6. */
async function surplusSpace() {
  const space = await newSpace();
  const goalId = randomUUID();
  const debtId = randomUUID();
  goals.set(space.householdId, [{ goalId, requiredMonthly: m("300"), targetDate: "2027-03-31" }]);
  minimums.set(space.householdId, [{ accountId: debtId, amount: m("100"), paid: false }]);
  const cafes = await category(space, "Кафе і ресторани");
  // AC6: income 5 600, limits 2 860, no regular payments outside limits; minus the 100 minimum and the goal's planned
  // 300 (FR 15, owner decision 2026-11-20, Q5 а) — a surplus of 2 340.
  const plan = {
    firstPeriod: "2026-12",
    incomePlan: eur("5600.00"),
    limits: [{ categoryId: cafes, amount: eur("2860.00") }],
  };
  return { space, goalId, debtId, cafes, plan };
}

/**
 * A space whose plan is a deficit of 200 (AC7: income 3 000, limits 3 200) with the goal of 300 €/month. Since Q5 а the
 * difference subtracts the goal's planned 300 as well, so the income is 3 300 to keep AC7's 200.
 */
async function deficitSpace() {
  const space = await newSpace();
  const goalId = randomUUID();
  goals.set(space.householdId, [{ goalId, requiredMonthly: m("300"), targetDate: "2027-03-31" }]);
  const cafes = await category(space, "Кафе і ресторани");
  const plan = {
    firstPeriod: "2026-12",
    incomePlan: eur("3300"),
    limits: [{ categoryId: cafes, amount: eur("3200") }],
  };
  return { space, goalId, plan };
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
          usage: [createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices)],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        goals: goalsServices,
        budget: (budgetServices = createBudgetServices({
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

describe("BUD-02@PoC: «Розподіл» is saved with the budget (POST /v1/budget)", () => {
  it("BUD-02@PoC FR 15: a surplus's goal, extra debt payment and «Заощадження без цілі» are saved as December's cells of «План»; the rest stays «Не розподілено»", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const allocation = [
      { kind: "goal", goalId, amount: eur("300.00") },
      { kind: "debt", accountId: debtId, amount: eur("200") },
      { kind: "savings", amount: eur("1000.50") },
    ];
    const res = await create(space, { ...plan, allocation });
    expect(res.statusCode, res.body).toBe(201);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    const jan = dec + 1;
    expect(g.goals.rows[0]!.cells[dec]).toMatchObject({ amount: eur("300"), own: true });
    expect(g.goals.savings[dec]).toMatchObject({ amount: eur("1000.5"), own: true });
    expect(g.debts.rows[0]!.cells[dec]).toEqual({ minimum: eur("100"), extra: eur("200") });
    // «Не розподілено» of the grid = the rest of «Розподіл»: 2 340 − (0 + 200 + 1 000.50); the goal row 300 is its
    // planned contribution, so it counts 0 (Q5 а).
    expect(g.unallocated[dec]).toEqual({ kind: "unallocated", amount: eur("1139.5") });
    // Only the first period: January keeps the defaults (the required contribution, no extra payment).
    expect(g.goals.rows[0]!.cells[jan]).toMatchObject({ amount: eur("300"), own: false });
    expect(g.debts.rows[0]!.cells[jan]).toEqual({ minimum: eur("100"), extra: null });
    // BUD-02 FR 11: the planned savings of the period are the goal and «Заощадження без цілі», not the debt payment.
    const period = await call(space, "GET", "/v1/budget/periods/2026-12");
    expect(period.json().plannedSavings).toEqual(eur("1300.5"));
    expect(await cells(space.householdId)).toBe(3);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell' AND action = 'create'",
        space.householdId,
      ),
    ).toBe(3);
  });

  it("BUD-02@PoC AC7: «З цілі …» covering the 200 € deficit exactly lowers the goal's December contribution 300 → 100; nothing is moved", async () => {
    const { space, goalId, plan } = await deficitSpace();
    const res = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("200") }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    expect(g.goals.rows[0]!.cells[dec]).toMatchObject({ amount: eur("100"), own: true });
    expect(g.goals.rows[0]!.cells[dec + 1]).toMatchObject({ amount: eur("300"), own: false });
    // Q5 а: covered exactly — the grid shows no deficit.
    expect(g.unallocated[dec]).toEqual({ kind: "unallocated", amount: eur("0") });
    expect(await cells(space.householdId)).toBe(1);
  });

  it("BUD-02@PoC AC7: a sum over N or over the goal's contribution is refused, and nothing is saved — no budget, no cell; less than N is a budget with a deficit (AC17)", async () => {
    const { space, goalId, plan } = await deficitSpace();
    const over = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("250") }],
    });
    expect(paths(over)).toEqual(["allocation: over"]);
    const beyond = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("350") }],
    });
    expect(paths(beyond)).toEqual(["allocation.0.amount: over_contribution"]);
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
    // FR 15 (owner decision 2026-11-21): covered by less than 200 € — saved; the rest 0.01 € stays the plan's deficit.
    const short = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("199.99") }],
    });
    expect(short.statusCode, short.body).toBe(201);
    expect(await cells(space.householdId)).toBe(1);
  });

  it("BUD-02@PoC FR 15: a surplus refuses rows over N, deficit rows, duplicates, inexact amounts and another currency — the same issues as the calculation", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const cases: [unknown[], string[]][] = [
      // The goal left empty frees its 300 (Q4 а): N 2 340 + 300.
      [[{ kind: "savings", amount: eur("2640.01") }], ["allocation: over"]],
      [[{ kind: "from-goal", goalId, amount: eur("1") }], ["allocation.0.kind: invalid"]],
      [
        [
          { kind: "goal", goalId, amount: eur("1") },
          { kind: "goal", goalId, amount: eur("2") },
        ],
        ["allocation.1.goalId: duplicate"],
      ],
      [[{ kind: "debt", accountId: debtId, amount: eur("10.001") }], ["allocation.0.amount: invalid"]],
      [
        [{ kind: "savings", amount: { amount: "10", currency: "USD" } }],
        ["allocation.0.amount.currency: currency"],
      ],
    ];
    for (const [allocation, expected] of cases) {
      const res = await create(space, { ...plan, allocation });
      expect(res.statusCode, JSON.stringify(allocation)).toBe(400);
      expect(paths(res)).toEqual(expected);
      const calc = await preview(space, { ...plan, allocation });
      expect(calc.statusCode).toBe(400);
      expect(paths(calc)).toEqual(expected);
    }
    // The whole surplus is allowed — status `exact`; less is allowed too, the rest «Лишити нерозподіленим».
    const calc = await preview(space, { ...plan, allocation: [{ kind: "savings", amount: eur("2640") }] });
    expect(calc.json().choice).toEqual({ chosen: eur("2340"), rest: eur("0"), status: "exact" });
    expect(await budgets(space.householdId)).toBe(0);
  });

  it("BUD-02@PoC «Права доступу»: a goal or a debt of another space is «not found» and reveals nothing; a scoped member cannot allocate (403), its calculation is 404", async () => {
    const { space, plan } = await surplusSpace();
    const other = await surplusSpace();
    for (const row of [
      { kind: "goal", goalId: other.goalId, amount: eur("1") },
      { kind: "debt", accountId: other.debtId, amount: eur("1") },
    ]) {
      const res = await create(space, { ...plan, allocation: [row] });
      expect(res.statusCode).toBe(400);
      expect(paths(res)).toEqual([
        row.kind === "goal" ? "allocation.0.goalId: not_found" : "allocation.0.accountId: not_found",
      ]);
    }
    const scoped = { role: "viewer", scoped: true };
    const allocation = [{ kind: "goal", goalId: other.goalId, amount: eur("1") }];
    expect((await create(other.space, { ...other.plan, allocation }, undefined, scoped)).statusCode).toBe(
      403,
    );
    expect(
      (await call(other.space, "POST", "/v1/budget/allocation", { ...other.plan, allocation }, scoped))
        .statusCode,
    ).toBe(404);
    expect(await budgets(space.householdId)).toBe(0);
    expect(await budgets(other.space.householdId)).toBe(0);
    expect(await cells(other.space.householdId)).toBe(0);
  });

  it("BUD-02@PoC FR 15: a create retried with its Idempotency-Key saves «Розподіл» once; a second budget is «Бюджет уже існує» and adds no cell", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const body = { ...plan, allocation: [{ kind: "goal", goalId, amount: eur("300") }] };
    const key = randomUUID();
    const first = await create(space, body, key);
    expect(first.statusCode, first.body).toBe(201);
    const again = await create(space, body, key);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const second = await create(space, body, randomUUID());
    expect(second.statusCode).toBe(409);
    expect(await budgets(space.householdId)).toBe(1);
    expect(await cells(space.householdId)).toBe(1);
  });

  it("BUD-02@PoC FR 15: two simultaneous creates with «Розподіл» make one budget and one set of cells", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const body = {
      ...plan,
      allocation: [
        { kind: "goal", goalId, amount: eur("300") },
        { kind: "debt", accountId: debtId, amount: eur("50") },
      ],
    };
    const results = await Promise.all([create(space, body, randomUUID()), create(space, body, randomUUID())]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await budgets(space.householdId)).toBe(1);
    expect(await cells(space.householdId)).toBe(2);
  });
});

describe("BUD-02@PoC: «Можна витратити в <місяць> ≈ M» (POST /v1/budget/allocation)", () => {
  it("BUD-02@PoC AC6: «Можна витратити в грудні ≈ 5 200 €» for the plan from December — income 5 600 − the debt minimum 100 − the goal's 300; with «Розподіл» the chosen goal and extra payment", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const bare = await preview(space, plan);
    expect(bare.statusCode, bare.body).toBe(200);
    expect(bare.json().balance).toMatchObject({
      unallocated: eur("2740"),
      goalContributions: eur("300"),
      difference: eur("2340"),
      kind: "surplus",
      amount: eur("2340"),
    });
    expect(bare.json().spendable).toEqual({ period: "2026-12", amount: eur("5200"), missing: [] });
    const allocated = await preview(space, {
      ...plan,
      allocation: [
        { kind: "goal", goalId, amount: eur("100") },
        { kind: "debt", accountId: debtId, amount: eur("200") },
        { kind: "savings", amount: eur("500") },
      ],
    });
    // 5 600 − 100 (minimum) − 100 (goal) − 200 (extra payment, a planned expense); «Заощадження без цілі» is not a
    // contribution to a goal (BUD-03 FR 2).
    expect(allocated.json().spendable).toEqual({ period: "2026-12", amount: eur("5200"), missing: [] });
    // The goal row 100 counts as −200 against its planned 300 (Q5 а): 2 340 − (−200 + 200 + 500).
    expect(allocated.json().choice).toEqual({ chosen: eur("500"), rest: eur("1840"), status: "short" });
    expect(await budgets(space.householdId)).toBe(0);
  });

  it("BUD-02@PoC AC6: a first period next month counts nothing contributed — this month's contributions never lower it", async () => {
    const { space, goalId, plan } = await surplusSpace();
    goals.set(space.householdId, [
      { goalId, requiredMonthly: m("300"), targetDate: "2027-03-31", contributedThisMonth: m("400") },
    ]);
    const res = await preview(space, plan);
    expect(res.statusCode, res.body).toBe(200);
    // December as of its 1st: 5 600 − the minimum 100 − the goal's planned 300; November's 400 is not December's.
    expect(res.json().spendable).toEqual({ period: "2026-12", amount: eur("5200"), missing: [] });
  });

  it("BUD-02@PoC AC6: the current month with a goal — this month's contributions count as on «Можна витратити» (#641); one without a rate — no figure", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const res = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(res.statusCode, res.body).toBe(200);
    // 5 600 − the minimum 100 − the goal's 300 (nothing contributed yet).
    expect(res.json().spendable).toEqual({ period: "2026-11", amount: eur("5200"), missing: [] });
    // 400 already contributed this month: Σ max(planned 300, contributed 400) — 5 100.
    goals.set(space.householdId, [
      { goalId, requiredMonthly: m("300"), targetDate: "2027-03-31", contributedThisMonth: m("400") },
    ]);
    const more = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(more.json().spendable).toEqual({ period: "2026-11", amount: eur("5100"), missing: [] });
    // A goal of another currency whose contribution has no rate: no figure, never a partial one.
    goals.set(space.householdId, [
      { goalId, requiredMonthly: null, targetDate: null, contributedThisMonth: Money.of("10", "USD") },
    ]);
    const noRate = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(noRate.json().spendable).toEqual({ period: "2026-11", amount: null, missing: ["rates"] });
    // Without goals: income 5 600 − nothing spent yet − the minimum 100.
    goals.delete(space.householdId);
    const plain = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(plain.json().spendable).toEqual({ period: "2026-11", amount: eur("5500"), missing: [] });
  });

  it("BUD-02@PoC AC6: a payoff plan's extra payment without a rate leaves the figure out («rates»)", async () => {
    const { space, debtId, plan } = await surplusSpace();
    extras.set(space.householdId, [{ accountId: debtId, amount: Money.of("50", "USD") }]);
    const res = await preview(space, plan);
    expect(res.json().spendable).toEqual({ period: "2026-12", amount: null, missing: ["rates"] });
  });
});

describe("BUD-02@PoC FR 15 (owner decision 2026-11-20, Q3 а, Q4 а, Q5 а): «Розподіл» and the grid of «План» agree", () => {
  it("BUD-02@PoC FR 15: after saving «Розподіл» the grid's «Не розподілено» of the first period is the step's rest — a surplus with a goal left empty", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const allocation = [{ kind: "savings", amount: eur("1000") }];
    const step = await preview(space, { ...plan, allocation });
    expect(step.statusCode, step.body).toBe(200);
    // 2 340 − (1 000 − the goal's 300 left empty) = 1 640.
    expect(step.json().choice).toEqual({ chosen: eur("700"), rest: eur("1640"), status: "short" });
    const res = await create(space, { ...plan, allocation });
    expect(res.statusCode, res.body).toBe(201);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    expect(g.unallocated[dec]).toEqual({ kind: "unallocated", amount: step.json().choice.rest });
    // Q4 а: the goal the wizard shows, left empty, is an explicit 0 € for December; January keeps its 300.
    const row = g.goals.rows.find((r) => r.goalId === goalId)!;
    expect(row.cells[dec]).toMatchObject({ amount: eur("0"), own: true });
    expect(row.cells[dec + 1]).toMatchObject({ amount: eur("300"), own: false });
    expect(await cells(space.householdId)).toBe(2);
  });

  it("BUD-02@PoC FR 15: after saving «Розподіл» the grid's «Не розподілено» is the step's rest — a deficit covered exactly shows no deficit", async () => {
    const { space, goalId, plan } = await deficitSpace();
    const allocation = [{ kind: "from-goal", goalId, amount: eur("200") }];
    const step = await preview(space, { ...plan, allocation });
    expect(step.json().balance).toMatchObject({ kind: "deficit", amount: eur("200") });
    expect(step.json().choice).toEqual({ chosen: eur("200"), rest: eur("0"), status: "exact" });
    expect((await create(space, { ...plan, allocation })).statusCode).toBe(201);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    expect(g.unallocated[dec]).toEqual({ kind: "unallocated", amount: eur("0") });
  });

  it("BUD-02@PoC FR 15 (Q3 а): «Із заощаджень» and «У борг» are not saved in PoC — both routes refuse them as `not_saved`, nothing saved", async () => {
    const { space, plan } = await deficitSpace();
    for (const kind of ["from-savings", "to-debt"])
      for (const send of [create, preview] as const) {
        const res = await send(space, {
          ...plan,
          allocation: [{ kind, accountId: randomUUID(), amount: eur("200") }],
        });
        expect(res.statusCode).toBe(400);
        expect(paths(res)).toEqual(["allocation.0.kind: not_saved"]);
      }
    expect(await budgets(space.householdId)).toBe(0);
  });
});
