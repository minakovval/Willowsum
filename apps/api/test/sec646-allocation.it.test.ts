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
import { leakText } from "./leak-text.ts";
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
  { goalId: string; requiredMonthly: Money | null; targetDate: string | null }[]
>();
const minimums = new Map<string, { accountId: string; amount: Money; paid: boolean }[]>();
const recurring = new Map<string, { categoryId: string | null; amount: Money; paid: boolean }[]>();
const extras = new Map<string, { accountId: string; amount: Money }[]>();
const charges = new Map<string, { paymentId: string; month: string; expected: Money }[]>();
/** BUD-03 FR 3 (#641): the regular incomes still expected in the month, as `BudgetObligations` gives them; null — no rate. */
const incomeExpected = new Map<string, Money | null>();

const obligations: BudgetObligations = {
  month: async (householdId) => ({
    recurring: recurring.get(householdId) ?? [],
    debtMinimums: minimums.get(householdId) ?? [],
    ...(incomeExpected.has(householdId) ? { incomeExpected: incomeExpected.get(householdId)! } : {}),
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
  incomeExpected.clear();
});

// ===== security probes (PR 646) =====
const jobs = (householdId: string) =>
  n("audit.entries WHERE household_id = $1 AND entity_type LIKE 'budget.%'", householdId);
/** The body without the per-request ids (trace, instance, request). */
const strip = (res: { json: () => Record<string, unknown> }) => {
  const rest = { ...res.json() };
  for (const k of ["traceId", "instance", "requestId"]) delete rest[k];
  return rest;
};
const MAX = "999999999999999";

describe("sec646: authorization and isolation", () => {
  it("sec646: a member without household.data.write (unscoped viewer) cannot create with «Розподіл» (403), nothing saved", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const body = { ...plan, allocation: [{ kind: "goal", goalId, amount: eur("1") }] };
    const res = await create(space, body, undefined, { role: "viewer" });
    expect(res.statusCode).toBe(403);
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
  });

  it("sec646: a scoped member of every role is refused on both routes and learns no balance", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const body = { ...plan, allocation: [{ kind: "goal", goalId, amount: eur("1") }] };
    for (const role of ["owner", "admin", "member", "viewer"]) {
      const c = await create(space, body, undefined, { role, scoped: true });
      expect(c.statusCode, role).toBe(403);
      const p = await call(space, "POST", "/v1/budget/allocation", body, { role, scoped: true });
      expect([403, 404], role).toContain(p.statusCode);
      // Q5 а: N = 2 640 − the goal's 300 € = 2 340; neither figure leaks.
      expect(leakText(p.body)).not.toContain("2640");
      expect(leakText(p.body)).not.toContain("2340");
    }
    expect(await budgets(space.householdId)).toBe(0);
  });

  it("sec646: another space's goal or debt answers exactly as an id that exists nowhere, on both routes", async () => {
    const { space, plan } = await surplusSpace();
    const other = await surplusSpace();
    for (const send of [create, preview] as const) {
      for (const [theirs, nowhere] of [
        [
          { kind: "goal", goalId: other.goalId, amount: eur("1") },
          { kind: "goal", goalId: randomUUID(), amount: eur("1") },
        ],
        [
          { kind: "debt", accountId: other.debtId, amount: eur("1") },
          { kind: "debt", accountId: randomUUID(), amount: eur("1") },
        ],
      ]) {
        const a = await send(space, { ...plan, allocation: [theirs] });
        const b = await send(space, { ...plan, allocation: [nowhere] });
        expect(a.statusCode).toBe(400);
        expect(strip(a)).toEqual(strip(b));
        expect(leakText(a.body)).not.toContain(other.space.householdId);
      }
    }
    // a foreign id is refused even when its amount is invalid too: the id check never depends on the other space
    const res = await create(space, {
      ...plan,
      allocation: [{ kind: "goal", goalId: other.goalId, amount: eur("99999") }],
    });
    expect(paths(res)).toEqual(["allocation.0.goalId: not_found"]);
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
  });
});

describe("sec646: integrity", () => {
  it("sec646: an Idempotency-Key is the space's — the same key in another space creates that space's own budget and cells", async () => {
    const a = await surplusSpace();
    const b = await surplusSpace();
    const key = randomUUID();
    const ra = await create(
      a.space,
      { ...a.plan, allocation: [{ kind: "goal", goalId: a.goalId, amount: eur("300") }] },
      key,
    );
    const rb = await create(
      b.space,
      { ...b.plan, allocation: [{ kind: "goal", goalId: b.goalId, amount: eur("7") }] },
      key,
    );
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);
    expect(rb.headers["idempotent-replayed"]).toBeUndefined();
    expect(rb.json().id).not.toBe(ra.json().id);
    expect(await cells(a.space.householdId)).toBe(1);
    expect(await cells(b.space.householdId)).toBe(1);
  });

  it("sec646: the same key with another «Розподіл» is 409 and changes nothing; the stored cells are the first request's", async () => {
    const { space, goalId, plan } = await surplusSpace();
    const key = randomUUID();
    const first = await create(
      space,
      { ...plan, allocation: [{ kind: "goal", goalId, amount: eur("300") }] },
      key,
    );
    expect(first.statusCode).toBe(201);
    const other = await create(
      space,
      { ...plan, allocation: [{ kind: "goal", goalId, amount: eur("999") }] },
      key,
    );
    expect(other.statusCode).toBe(409);
    const { rows } = await db.owner.query<{ amount: string }>(
      "SELECT amount::text AS amount FROM budget.plan_cells WHERE household_id = $1",
      [space.householdId],
    );
    expect(rows.map((r) => Number(r.amount))).toEqual([300]);
  });

  it("sec646: a failure in the middle of the transaction saves nothing (no budget, limit, cell, queued audit job); the retry with the same key saves once", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const body = {
      ...plan,
      allocation: [
        { kind: "goal", goalId, amount: eur("300") },
        { kind: "debt", accountId: debtId, amount: eur("77.77") },
      ],
    };
    await db.owner.query(`
      CREATE FUNCTION budget.sec646_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.kind = 'debt' THEN RAISE EXCEPTION 'sec646'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER sec646_fail BEFORE INSERT ON budget.plan_cells
        FOR EACH ROW EXECUTE FUNCTION budget.sec646_fail();`);
    const key = randomUUID();
    let failed;
    try {
      failed = await create(space, body, key);
    } finally {
      await db.owner.query(
        "DROP TRIGGER sec646_fail ON budget.plan_cells; DROP FUNCTION budget.sec646_fail();",
      );
    }
    expect(failed.statusCode).toBe(500);
    expect(leakText(failed.body)).not.toContain("sec646");
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await jobs(space.householdId)).toBe(0);
    const retry = await create(space, body, key);
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBeUndefined();
    expect(await budgets(space.householdId)).toBe(1);
    expect(await cells(space.householdId)).toBe(2);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell'",
        space.householdId,
      ),
    ).toBe(2);
  });

  it("sec646: a body crafted without the calculation step cannot store what the calculation refuses", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const bad: unknown[][] = [
      [{ kind: "savings", amount: eur("-1") }],
      [{ kind: "savings", amount: eur("1e3") }],
      [{ kind: "savings", amount: eur(" 5") }],
      [{ kind: "savings", amount: eur("+5") }],
      [{ kind: "savings", amount: eur("0x10") }],
      [{ kind: "savings", amount: eur("NaN") }],
      [{ kind: "savings", amount: eur("1".repeat(16)) }],
      [
        { kind: "savings", amount: eur("1") },
        { kind: "savings", amount: eur("2") },
      ],
      [
        { kind: "debt", accountId: debtId, amount: eur("1") },
        { kind: "debt", accountId: debtId, amount: eur("1") },
      ],
      [
        { kind: "goal", goalId, amount: eur("2000") },
        { kind: "debt", accountId: debtId, amount: eur("640.01") },
      ],
      [{ kind: "goal", goalId: debtId, amount: eur("1") }],
      [{ kind: "debt", accountId: goalId, amount: eur("1") }],
      [{ kind: "goal", goalId, accountId: debtId, amount: eur("1") }],
      [{ kind: "savings", goalId, amount: eur("1") }],
      [{ kind: "limit", goalId, amount: eur("1") }],
      [{ kind: "income", amount: eur("1") }],
      [{ kind: "goal", goalId, amount: eur("1"), period: "2027-05" }],
      Array.from({ length: 101 }, () => ({ kind: "savings", amount: eur("0") })),
      // the sum of 100 amounts at the cap: refused, never a 500
      Array.from({ length: 100 }, () => ({ kind: "goal", goalId: randomUUID(), amount: eur(MAX) })),
    ];
    for (const allocation of bad) {
      for (const send of [create, preview] as const) {
        const res = await send(space, { ...plan, allocation });
        expect(res.statusCode, JSON.stringify(allocation).slice(0, 120)).toBe(400);
      }
    }
    // `chosen` cannot ride along to move the check to the untyped sum
    const both = await create(space, {
      ...plan,
      chosen: [eur("1")],
      allocation: [{ kind: "savings", amount: eur("1") }],
    });
    expect(both.statusCode).toBe(400);
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
  });

  it("sec646: the sum at the top of the money range — income at the 15-digit cap, rows adding up past N — is 400 `over`, exactly", async () => {
    const { space, goalId, plan } = await surplusSpace();
    goals.set(space.householdId, [{ goalId, requiredMonthly: m("300"), targetDate: "2027-03-31" }]);
    const big = { firstPeriod: plan.firstPeriod, incomePlan: eur(MAX) };
    // N = MAX − 100 (the debt minimum) − 300 (the goal's planned contribution, Q5 а); a `goal` row counts as its
    // change against the 300
    const over = await create(space, {
      ...big,
      allocation: [
        { kind: "goal", goalId, amount: eur("999999999999899") },
        { kind: "savings", amount: eur("0.01") },
      ],
    });
    expect(paths(over)).toEqual(["allocation: over"]);
    const exact = await preview(space, {
      ...big,
      allocation: [
        { kind: "goal", goalId, amount: eur("999999999999898.99") },
        { kind: "savings", amount: eur("0.01") },
      ],
    });
    expect(exact.statusCode, exact.body).toBe(200);
    expect(exact.json().choice).toEqual({ chosen: eur("999999999999599"), rest: eur("0"), status: "exact" });
    const saved = await create(space, {
      ...big,
      allocation: [
        { kind: "goal", goalId, amount: eur("999999999999898.99") },
        { kind: "savings", amount: eur("0.01") },
      ],
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const { rows } = await db.owner.query<{ kind: string; amount: string }>(
      "SELECT kind, trim(trailing '0' from amount::text) AS amount FROM budget.plan_cells WHERE household_id = $1 ORDER BY kind",
      [space.householdId],
    );
    expect(rows).toEqual([
      { kind: "goal", amount: "999999999999898.99" },
      { kind: "savings", amount: "0.01" },
    ]);
  });

  it("sec646: a deficit cannot be saved with surplus rows, over N or one goal twice; a balanced plan takes no row; «Лишити дефіцит» is saved (BUD-02@PoC AC17)", async () => {
    const { space, goalId, plan } = await deficitSpace();
    for (const allocation of [
      [{ kind: "savings", amount: eur("200") }],
      [{ kind: "goal", goalId, amount: eur("200") }],
      // Over the goal's 300 € of December (the deficit is 500 €: a part covered is saved, AC17).
      [{ kind: "from-goal", goalId, amount: eur("300.01") }],
      [
        { kind: "from-goal", goalId, amount: eur("100") },
        { kind: "from-goal", goalId, amount: eur("100") },
      ],
    ]) {
      const res = await create(space, { ...plan, allocation });
      expect(res.statusCode, JSON.stringify(allocation)).toBe(400);
    }
    // Q5 а: limits 3 200 + the goal's planned 300 — balanced at 3 500.
    const balanced = { ...plan, incomePlan: eur("3500") };
    for (const allocation of [
      [{ kind: "savings", amount: eur("0") }],
      [{ kind: "from-goal", goalId, amount: eur("0") }],
    ]) {
      const res = await create(space, { ...balanced, allocation });
      expect(paths(res)).toEqual(["allocation.0.kind: invalid"]);
    }
    expect(await budgets(space.householdId)).toBe(0);
    expect(await cells(space.householdId)).toBe(0);
    // Owner decision 2026-11-21: an empty «Розподіл» (or «З цілі» 0 €) leaves the whole deficit — the budget is saved.
    const left = await create(space, {
      ...plan,
      allocation: [{ kind: "from-goal", goalId, amount: eur("0") }],
    });
    expect(left.statusCode, left.body).toBe(201);
    expect(await budgets(space.householdId)).toBe(1);
  });

  it("sec646: «З цілі …» from a goal with no contribution this month is refused", async () => {
    const { space, plan } = await deficitSpace();
    const noDate = randomUUID();
    const past = randomUUID();
    goals.set(space.householdId, [
      { goalId: noDate, requiredMonthly: null, targetDate: null },
      { goalId: past, requiredMonthly: m("300"), targetDate: "2026-11-30" },
    ]);
    for (const goalId of [noDate, past]) {
      const res = await create(space, {
        ...plan,
        allocation: [{ kind: "from-goal", goalId, amount: eur("200") }],
      });
      expect(paths(res)).toEqual(["allocation.0.goalId: no_contribution"]);
    }
    expect(await budgets(space.householdId)).toBe(0);
  });
});

describe("sec646: schema — the `debt` cell is read only", () => {
  it("sec646: PUT /v1/budget/plan-grid/cells refuses kind `debt` (400) and the cell keeps its amount and version", async () => {
    const { space, debtId, goalId, plan } = await surplusSpace();
    const res = await create(space, {
      ...plan,
      allocation: [{ kind: "debt", accountId: debtId, amount: eur("200") }],
    });
    expect(res.statusCode, res.body).toBe(201);
    for (const version of [0, 1]) {
      for (const amount of [eur("1"), null]) {
        const put = await app.inject({
          method: "PUT",
          url: "/v1/budget/plan-grid/cells",
          headers: {
            origin: WEB,
            "content-type": "application/json",
            ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
          },
          payload: JSON.stringify({ period: "2026-12", kind: "debt", lineId: debtId, amount, version }),
        });
        expect(put.statusCode).toBe(400);
      }
    }
    // nor through another kind with the debt's id
    for (const kind of ["goal", "limit", "income"]) {
      const put = await app.inject({
        method: "PUT",
        url: "/v1/budget/plan-grid/cells",
        headers: {
          origin: WEB,
          "content-type": "application/json",
          ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
        },
        payload: JSON.stringify({ period: "2026-12", kind, lineId: debtId, amount: eur("1"), version: 0 }),
      });
      expect(put.statusCode, kind).toBe(400);
    }
    const { rows } = await db.owner.query<{ kind: string; amount: string; version: number }>(
      "SELECT kind, amount::text AS amount, version FROM budget.plan_cells WHERE household_id = $1 ORDER BY kind",
      [space.householdId],
    );
    // Q4 а: the goal left empty is saved as 0 € for the month; the debt cell keeps its amount and version.
    expect(rows.map((r) => [r.kind, Number(r.amount), r.version])).toEqual([
      ["debt", 200, 1],
      ["goal", 0, 1],
    ]);
    const g = await grid(space);
    const dec = g.months.findIndex((x) => x.period === "2026-12");
    expect(g.goals.rows.find((r) => r.goalId === goalId)!.cells[dec]).toMatchObject({
      amount: eur("0"),
      own: true,
    });
    expect(g.debts.rows[0]!.cells[dec]).toEqual({ minimum: eur("100"), extra: eur("200") });
  });

  it("sec646: the database refuses a kind outside the list and a negative amount", async () => {
    const { space, plan } = await surplusSpace();
    const res = await create(space, plan);
    const id = res.json().id as string;
    const insert = (kind: string, amount: string) =>
      db.owner.query(
        `INSERT INTO budget.plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
         VALUES ($1, $2, '2026-12-01', $3, $4, $5, 'EUR', 1)`,
        [space.householdId, id, kind, randomUUID(), amount],
      );
    await expect(insert("payoff", "1")).rejects.toThrow(/plan_cells_kind_check/);
    await expect(insert("debt", "-1")).rejects.toThrow(/check/);
    await insert("debt", "1");
  });
});

describe("sec646: «Можна витратити» is never a partial figure", () => {
  it("sec646: a transaction without a rate in the current month, a goal without a rate and a regular income of the current month each leave the figure out", async () => {
    const { space, plan } = await surplusSpace();
    const goalId = randomUUID();
    goals.set(space.householdId, [
      { goalId, requiredMonthly: Money.of("10", "USD"), targetDate: "2027-03-31" },
    ]);
    const noRate = await preview(space, plan);
    expect(noRate.json().spendable).toEqual({ period: "2026-12", amount: null, missing: ["rates"] });
    goals.delete(space.householdId);
    // Since #641 the regular incomes still expected of the current month are known (`BudgetObligations`): a figure.
    incomeExpected.set(space.householdId, m("100"));
    const current = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(current.json().spendable).toMatchObject({ period: "2026-11", missing: [] });
    expect(current.json().spendable.amount).not.toBeNull();
    // A regular income without a rate: no figure.
    incomeExpected.set(space.householdId, null);
    const income = await preview(space, plan);
    expect(income.json().spendable).toEqual({ period: "2026-12", amount: null, missing: ["rates"] });
  });
});

describe("sec646: survivors of the mutation round", () => {
  it("sec646: a dated goal whose contribution has no rate leaves no balance — rows are refused `balance_unknown`, nothing saved", async () => {
    const { space, goalId, plan } = await surplusSpace();
    goals.set(space.householdId, [
      { goalId, requiredMonthly: Money.of("10", "USD"), targetDate: "2027-03-31" },
    ]);
    const calc = await preview(space, plan);
    expect(calc.statusCode, calc.body).toBe(200);
    expect(calc.json().balance).toBeNull();
    const res = await create(space, { ...plan, allocation: [{ kind: "savings", amount: eur("2640") }] });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(["allocation: balance_unknown"]);
    expect(await budgets(space.householdId)).toBe(0);
  });

  it("sec646: the regular incomes still expected count in the wizard's figure — above the plan they raise it, exactly", async () => {
    const { space, plan } = await surplusSpace();
    incomeExpected.set(space.householdId, m("6000"));
    const res = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(res.statusCode, res.body).toBe(200);
    // max(plan 5 600, received 0 + still expected 6 000) − the minimum 100 − the goal's 300.
    expect(res.json().spendable).toEqual({ period: "2026-11", amount: eur("5600"), missing: [] });
  });

  it("sec646: more than 100 rows are refused before any work — 101 rows that would each be valid (a goal each, 0 €) are 400, 100 are saved", async () => {
    const { space, plan } = await surplusSpace();
    const many = Array.from({ length: 101 }, () => ({
      goalId: randomUUID(),
      requiredMonthly: null,
      targetDate: null,
    }));
    goals.set(space.householdId, many);
    const rows = many.map((g) => ({ kind: "goal", goalId: g.goalId, amount: eur("0") }));
    for (const send of [create, preview] as const) {
      const res = await send(space, { ...plan, allocation: rows });
      expect(res.statusCode).toBe(400);
      expect(paths(res)).toEqual(["allocation: too_big"]);
    }
    expect(await budgets(space.householdId)).toBe(0);
    const ok = await create(space, { ...plan, allocation: rows.slice(0, 100) });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await cells(space.householdId)).toBe(100);
  });

  it("sec646: the calculation refuses `chosen` together with `allocation` — the untyped sum never stands in for the typed rows", async () => {
    const { space, plan } = await surplusSpace();
    const res = await preview(space, {
      ...plan,
      chosen: [eur("1")],
      allocation: [{ kind: "savings", amount: eur("1") }],
    });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(["chosen: with_allocation"]);
  });

  it("sec646: a second create with ANOTHER «Розподіл» is 409 and leaves the first budget's cells as they were (amount, version, count)", async () => {
    const { space, goalId, debtId, plan } = await surplusSpace();
    const first = await create(space, {
      ...plan,
      allocation: [{ kind: "goal", goalId, amount: eur("300") }],
    });
    expect(first.statusCode).toBe(201);
    const second = await create(
      space,
      {
        ...plan,
        allocation: [
          { kind: "goal", goalId, amount: eur("5") },
          { kind: "debt", accountId: debtId, amount: eur("9") },
        ],
      },
      randomUUID(),
    );
    expect(second.statusCode).toBe(409);
    const { rows } = await db.owner.query<{ kind: string; amount: string; version: number }>(
      "SELECT kind, amount::text AS amount, version FROM budget.plan_cells WHERE household_id = $1",
      [space.householdId],
    );
    expect(rows.map((r) => [r.kind, Number(r.amount), r.version])).toEqual([["goal", 300, 1]]);
  });

  it("sec646: the current month with a transaction that has no rate gives no figure («rates»)", async () => {
    const { space, plan } = await surplusSpace();
    goals.delete(space.householdId);
    const acc = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний USD",
      balance: { amount: "100.00", currency: "USD" },
      balanceDate: "2026-01-01",
    });
    expect(acc.statusCode, acc.body).toBe(201);
    const tx = await call(space, "POST", "/v1/transactions", {
      accountId: acc.json().id,
      amount: { amount: "-12.00", currency: "USD" },
      date: "2026-11-10",
      counterparty: "Синтетичний продавець",
    });
    expect(tx.statusCode, tx.body).toBe(201);
    const res = await preview(space, { ...plan, firstPeriod: "2026-11" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().spendable).toEqual({ period: "2026-11", amount: null, missing: ["rates"] });
  });
});
