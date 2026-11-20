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
  { goalId: string; requiredMonthly: Money | null; targetDate: string | null }[]
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
  // AC6: income 5 600, limits 2 860, no regular payments outside limits; minus the 100 minimum — a surplus of 2 640.
  const plan = {
    firstPeriod: "2026-12",
    incomePlan: eur("5600.00"),
    limits: [{ categoryId: cafes, amount: eur("2860.00") }],
  };
  return { space, goalId, debtId, cafes, plan };
}

/** A space whose plan is a deficit of 200 (AC7: income 3 000, limits 3 200) with the goal of 300 €/month. */
async function deficitSpace() {
  const space = await newSpace();
  const goalId = randomUUID();
  goals.set(space.householdId, [{ goalId, requiredMonthly: m("300"), targetDate: "2027-03-31" }]);
  const cafes = await category(space, "Кафе і ресторани");
  const plan = {
    firstPeriod: "2026-12",
    incomePlan: eur("3000"),
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
    // «Не розподілено» of the grid = the rest of «Розподіл»: 2 640 − 1 500.50.
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
    expect(await cells(space.householdId)).toBe(1);
  });

  it("BUD-02@PoC AC7: a deficit covered by less than 200 € or a sum over N is refused, and nothing is saved — no budget, no cell", async () => {
    const { space, goalId, plan } = await deficitSpace();
    const short = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("199.99") }],
    });
    expect(short.statusCode).toBe(400);
    expect(paths(short)).toEqual(["allocation: short"]);
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
  });

  it("BUD-02@PoC FR 15: a surplus refuses rows over N, deficit rows, duplicates, inexact amounts and another currency — the same issues as the calculation", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const cases: [unknown[], string[]][] = [
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
    expect(calc.json().choice).toEqual({ chosen: eur("2640"), rest: eur("0"), status: "exact" });
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
      kind: "surplus",
      amount: eur("2640"),
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
    expect(allocated.json().choice).toEqual({ chosen: eur("800"), rest: eur("1840"), status: "short" });
    expect(await budgets(space.householdId)).toBe(0);
  });

  it("BUD-02@PoC AC6: the current month with a goal — this month's contributions are not known yet, so no figure, never a partial one", async () => {
    const { space, plan } = await surplusSpace();
    const res = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().spendable).toEqual({
      period: "2026-11",
      amount: null,
      missing: ["goal-contributions"],
    });
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
