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
  createBudgetErasure,
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
 * Security review of PR #613 (BUD-17@PoC a, «Бюджет → План», the server part): space isolation of `budget.plan_cells`
 * (row policy and the routes), the permission guards and the release flag, the bounds of the PUT body, a finished
 * month's snapshot, erasure. The harness is the one of bud17a-plan.it.test.ts with the real `createGoalPlans`; the
 * debts' ports are the test's. Every name and amount is synthetic.
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
/** The spaces the debt-payoff port was asked for. */
const debtCalls: string[] = [];
/** The flags switched off for the next requests. */
let off: string[] = [];
/** The spaces `budget.plan` is switched off for (the other spaces keep it), for the next requests. */
const planOffFor = new Set<string>();
const FLAGS_UNDER_TEST = {
  ...fakeFlags(),
  isEnabled: async (h: string, flag: string) =>
    !off.includes(flag) && !(flag === "budget.plan" && planOffFor.has(h)),
};
void goals;

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
  income: { rows: { categoryId: string | null; cells: Cell[] }[]; totals: unknown[] };
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
        flags: FLAGS_UNDER_TEST,
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
            goals: createGoalPlans(db.databases.for("goals"), goalsServices),
            debts: {
              inMonth: async (householdId) => (debtCalls.push(householdId), extras.get(householdId) ?? []),
            },
            fx,
            planEnabled: (householdId) => FLAGS_UNDER_TEST.isEnabled(householdId, "budget.plan"),
          }),
          // As main.ts: «План» off — the months' typed values act nowhere (owner decision 2026-11-20, batch 2, item 2).
          planEnabled: (householdId) => FLAGS_UNDER_TEST.isEnabled(householdId, "budget.plan"),
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
  off = [];
  planOffFor.clear();
});

const NIL = "00000000-0000-0000-0000-000000000000";

async function goal(space: Space, name: string, target: string): Promise<string> {
  const res = await call(space, "POST", "/v1/goals", {
    template: "travel",
    name,
    target: eur(target),
    targetDate: "2027-08-18",
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

const period = async (space: Space, p: string) => {
  const res = await call(space, "GET", `/v1/budget/periods/${p}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    incomePlan: { amount: string };
    plannedSavings: { amount: string };
    totals: { limits: { amount: string } };
  };
};

describe("sec613: «Бюджет → План» — isolation, guards, bounds", () => {
  it("sec613 AC5: another space's grid, period view and cells never carry this space's cells, goals or debts; its ids are «not_found» like a random id", async () => {
    const a = await newSpace();
    await budgetWith(a, "5611.37", { Продукти: "700.00" });
    const groceries = await category(a, "Продукти");
    const trip = await goal(a, "Таємна подорож", "9917.00");
    const debt = randomUUID();
    extras.set(a.householdId, [{ accountId: debt, amount: Money.of("8123.45", "EUR") }]);
    minimums.set(a.householdId, [{ accountId: debt, amount: Money.of("7234.56", "EUR"), paid: false }]);
    for (const body of [
      { kind: "limit", lineId: groceries, amount: eur("6543.21") },
      { kind: "goal", lineId: trip, amount: eur("4321.09") },
      { kind: "savings", lineId: null, amount: eur("3219.87") },
      { kind: "income", lineId: null, amount: eur("2198.76") },
    ]) {
      const res = await put(a, { period: "2026-12", version: 0, ...body });
      expect(res.statusCode, res.body).toBe(200);
    }
    const b = await newSpace();
    await budgetWith(b, "100", {});
    debtCalls.length = 0;
    const read = await call(b, "GET", "/v1/budget/plan-grid");
    expect(read.statusCode, read.body).toBe(200);
    const text = leakText(read.body) + leakText((await call(b, "GET", "/v1/budget/periods/2026-12")).body);
    for (const secret of [
      "6543.21",
      "4321.09",
      "3219.87",
      "2198.76",
      "5611.37",
      "8123.45",
      "7234.56",
      groceries,
      trip,
      debt,
      a.householdId,
    ])
      expect(text, secret).not.toContain(secret);
    expect((read.json() as Grid).goals.rows).toEqual([]);
    expect((read.json() as Grid).debts.rows).toEqual([]);
    // The other modules were asked for the caller's space only.
    expect(new Set(debtCalls)).toEqual(new Set([b.householdId]));
    // A's ids from B: the same answer as an id that does not exist; nothing written anywhere.
    for (const [kind, lineId] of [
      ["limit", groceries],
      ["income", groceries],
      ["goal", trip],
    ] as const) {
      const foreign = await put(b, { period: "2026-12", kind, lineId, amount: eur("1"), version: 1 });
      const random = await put(b, {
        period: "2026-12",
        kind,
        lineId: randomUUID(),
        amount: eur("1"),
        version: 1,
      });
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json().errors).toEqual(random.json().errors);
      expect(foreign.json().errors).toEqual([{ in: "body", path: "lineId", issue: "not_found" }]);
    }
    // B's own cell with the same key as A's («Заощадження без цілі») is B's alone: version 0, and A's stays.
    const own = await put(b, {
      period: "2026-12",
      kind: "savings",
      lineId: null,
      amount: eur("5"),
      version: 0,
    });
    expect(own.json()).toEqual({ amount: eur("5"), version: 1 });
    expect(await n("budget.plan_cells WHERE household_id = $1", b.householdId)).toBe(1);
    const { rows } = await db.owner.query<{ amount: string; version: number }>(
      `SELECT amount::text AS amount, version FROM budget.plan_cells
        WHERE household_id = $1 AND kind = 'savings' AND line_id = $2`,
      [a.householdId, NIL],
    );
    expect(rows.map((r) => [Number(r.amount), r.version])).toEqual([[3219.87, 1]]);
    expect((await period(a, "2026-12")).plannedSavings.amount).toBe("7540.96");
    expect((await period(b, "2026-12")).plannedSavings.amount).toBe("5");
  });

  it("sec613 ARC-03 FR 2: budget.plan_cells has the forced row policy — the module's role bound to one space cannot read or write another's rows", async () => {
    const a = await newSpace();
    const ba = await budgetWith(a, "0", { Продукти: "700.00" });
    await put(a, { period: "2026-12", kind: "savings", lineId: null, amount: eur("77"), version: 0 });
    const b = await newSpace();
    const meta = await db.owner.query<{ rls: boolean; forced: boolean; policies: number }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'budget' AND p.tablename = 'plan_cells' AND p.policyname = 'household_isolation') AS policies
         FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = 'budget' AND c.relname = 'plan_cells'`,
    );
    expect(meta.rows).toEqual([{ rls: true, forced: true, policies: 1 }]);
    const budgetDb = db.databases.for("budget");
    // No WHERE: only the policy stands between B and A's rows.
    const seen = await budgetDb.inHousehold(b.householdId, (q) =>
      q.query<{ household_id: string }>(`SELECT household_id FROM plan_cells`),
    );
    expect(seen.rows).toEqual([]);
    const changed = await budgetDb.inHousehold(b.householdId, (q) =>
      q.query(`UPDATE plan_cells SET amount = 1 WHERE household_id = $1`, [a.householdId]),
    );
    expect(changed.rowCount).toBe(0);
    await expect(
      budgetDb.inHousehold(b.householdId, (q) =>
        q.query(
          `INSERT INTO plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
           VALUES ($1, $2, '2026-12-01', 'savings', $3, 1, 'EUR', 1)`,
          [a.householdId, ba.id, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
    expect(await n("budget.plan_cells WHERE household_id = $1 AND amount = 77", a.householdId)).toBe(1);
  });

  it("sec613 guards: no session — 401; a viewer cannot write; a scoped member reads 404 and writes 403; nothing is written", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const body = { period: "2026-12", kind: "savings", lineId: null, amount: eur("1"), version: 0 };
    for (const [method, payload] of [
      ["GET", undefined],
      ["PUT", body],
    ] as const) {
      const res = await app.inject({
        method,
        url: method === "GET" ? "/v1/budget/plan-grid" : "/v1/budget/plan-grid/cells",
        headers: { origin: WEB, ...(payload ? { "content-type": "application/json" } : {}) },
        ...(payload ? { payload: JSON.stringify(payload) } : {}),
      });
      expect(res.statusCode).toBe(401);
    }
    const viewer = { role: "viewer" };
    expect((await call(space, "PUT", "/v1/budget/plan-grid/cells", body, viewer)).statusCode).toBe(403);
    const scoped = { role: "viewer", scoped: true };
    expect((await call(space, "GET", "/v1/budget/plan-grid", undefined, scoped)).statusCode).toBe(404);
    expect([403, 404]).toContain(
      (await call(space, "PUT", "/v1/budget/plan-grid/cells", body, scoped)).statusCode,
    );
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("sec613 flag: with `budget.plan` off both routes are «not found» and nothing is written; the period view goes on", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    off = ["budget.plan"];
    const read = await call(space, "GET", "/v1/budget/plan-grid");
    expect(read.statusCode).toBe(404);
    expect(leakText(read.body)).not.toContain("700");
    const write = await put(space, {
      period: "2026-12",
      kind: "savings",
      lineId: null,
      amount: eur("1"),
      version: 0,
    });
    expect(write.statusCode).toBe(404);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
    expect((await call(space, "GET", "/v1/budget/periods/2026-11")).statusCode).toBe(200);
  });

  it("BUD-17@PoC business rules (owner decision 2026-11-20, item 4): values typed on «План» are kept while `budget.plan` is off and are there again when it is on", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const cell = { period: "2026-12", kind: "limit", lineId: groceries };
    expect((await put(space, { ...cell, amount: eur("650"), version: 0 })).statusCode).toBe(200);
    expect(
      (await put(space, { period: "2026-12", kind: "savings", lineId: null, amount: eur("90"), version: 0 }))
        .statusCode,
    ).toBe(200);
    off = ["budget.plan"];
    expect((await call(space, "GET", "/v1/budget/plan-grid")).statusCode).toBe(404);
    // Batch 2, item 2: while it is off the typed values act nowhere — «Бюджет» shows the budget's own limit.
    expect(await limitOf(space, "2026-12", groceries)).toBe("700");
    expect((await period(space, "2026-12")).plannedSavings.amount).toBe("0");
    // Switching off resets nothing: both typed cells stay as they were, with their versions.
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(2);
    off = [];
    const g = await grid(space);
    const december = g.months.findIndex((m) => m.period === "2026-12");
    expect(row(g, groceries)!.cells[december]).toMatchObject({ amount: eur("650"), own: true, version: 1 });
    expect(g.goals.savings[december]).toMatchObject({ amount: eur("90"), own: true, version: 1 });
    expect(await limitOf(space, "2026-12", groceries)).toBe("650");
    expect((await period(space, "2026-12")).plannedSavings.amount).toBe("90");
  });

  it("BUD-17@PoC business rules (owner decision 2026-11-20, batch 2, item 2): with `budget.plan` off the typed values change nothing on «Бюджет», «Можна витратити», «Тренд» or «Порівняння»; on — the same values act again, exact", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000.00", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const trip = await goal(space, "Відпустка", "3000.00");
    const reads = {
      period: "/v1/budget/periods/2026-11",
      december: "/v1/budget/periods/2026-12",
      spendable: "/v1/budget/periods/2026-11/spendable",
      trend: "/v1/budget/trend?from=2026-11&to=2027-01",
      compare: "/v1/budget/compare?type=month&period=2026-11",
    };
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const [name, url] of Object.entries(reads)) {
        const res = await call(space, "GET", url);
        expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
        out[name] = res.json();
      }
      return out;
    };
    const before = await snapshot();
    expect((before.spendable as { figures: unknown }).figures).not.toBeNull();
    for (const [cell, amount] of [
      [{ kind: "limit", lineId: groceries }, "650.37"],
      [{ kind: "income", lineId: null }, "1234.56"],
      [{ kind: "savings", lineId: null }, "90.05"],
      [{ kind: "goal", lineId: trip }, "200.10"],
    ] as const)
      for (const p of ["2026-11", "2026-12"]) {
        const res = await put(space, { period: p, ...cell, amount: eur(amount), version: 0 });
        expect(res.statusCode, res.body).toBe(200);
      }
    const typed = await snapshot();
    off = ["budget.plan"];
    // Off: every read is as it was before anything was typed.
    expect(await snapshot()).toEqual(before);
    expect(await limitOf(space, "2026-12", groceries)).toBe("700");
    const december = await period(space, "2026-12");
    expect(december.incomePlan.amount).toBe("1000");
    // Kept: the eight cells with their amounts and versions.
    const kept = await db.owner.query<{ amount: string; version: number }>(
      `SELECT amount::text AS amount, version FROM budget.plan_cells WHERE household_id = $1 ORDER BY period, kind, amount`,
      [space.householdId],
    );
    expect(kept.rows.map((r) => r.version)).toEqual(Array(8).fill(1));
    expect(kept.rows.map((r) => Money.of(r.amount, "EUR").toDecimalString()).sort()).toEqual(
      ["1234.56", "1234.56", "200.1", "200.1", "650.37", "650.37", "90.05", "90.05"].sort(),
    );
    off = [];
    // On: the same values act again, as before switching off.
    expect(await snapshot()).toEqual(typed);
    expect(typed).not.toEqual(before);
    expect(await limitOf(space, "2026-11", groceries)).toBe("650.37");
    expect(await limitOf(space, "2026-12", groceries)).toBe("650.37");
    const on = await period(space, "2026-12");
    expect(on.incomePlan.amount).toBe("1234.56");
    expect(on.plannedSavings.amount).toBe("290.15");
  });

  it("BUD-17@PoC business rules (owner decision 2026-11-20, batch 2, item 2): a finished month's snapshot written while `budget.plan` is off keeps the plan then in effect — without the typed values", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000.00", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    expect(
      (
        await put(space, {
          period: "2026-11",
          kind: "limit",
          lineId: groceries,
          amount: eur("650.37"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    now = at("2026-12-03");
    off = ["budget.plan"];
    expect(await limitOf(space, "2026-11", groceries)).toBe("700");
    off = [];
    // The snapshot is the plan in effect when it was written (as #613 for the incomes); the cell stays stored.
    expect(await limitOf(space, "2026-11", groceries)).toBe("700");
    expect(await n("budget.plan_cells WHERE household_id = $1 AND amount = 650.37", space.householdId)).toBe(
      1,
    );
  });

  it("sec652: `budget.plan` is read for the caller's space — off for one space leaves another space's typed values acting, and the other way round", async () => {
    const [a, b] = [await newSpace(), await newSpace()];
    const cat: Record<string, string> = {};
    for (const s of [a, b]) {
      await budgetWith(s, "1000.00", { Продукти: "700.00" });
      cat[s.householdId] = await category(s, "Продукти");
    }
    const typed = new Map([
      [a, "650.37"],
      [b, "611.19"],
    ]);
    for (const [s, amount] of typed) {
      const res = await put(s, {
        period: "2026-11",
        kind: "limit",
        lineId: cat[s.householdId],
        amount: eur(amount),
        version: 0,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    const views = async (s: Space) => {
      const out: string[] = [];
      for (const url of [
        "/v1/budget/periods/2026-11",
        "/v1/budget/periods/2026-11/spendable",
        "/v1/budget/trend?from=2026-11&to=2027-01",
        "/v1/budget/compare?type=month&period=2026-11",
      ]) {
        const res = await call(s, "GET", url);
        expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
        out.push(res.body);
      }
      return out.join("\n");
    };
    for (const [offSpace, onSpace] of [
      [a, b],
      [b, a],
    ] as const) {
      planOffFor.clear();
      planOffFor.add(offSpace.householdId);
      // Off for this space: the budget's own limit, the route is closed, the typed amount is nowhere in the views.
      expect(await limitOf(offSpace, "2026-11", cat[offSpace.householdId]!)).toBe("700");
      expect((await call(offSpace, "GET", "/v1/budget/plan-grid")).statusCode).toBe(404);
      expect(leakText(await views(offSpace))).not.toContain(typed.get(offSpace)!);
      // The other space keeps its own typed value and never carries the first one's.
      expect(await limitOf(onSpace, "2026-11", cat[onSpace.householdId]!)).toBe(typed.get(onSpace)!);
      expect((await call(onSpace, "GET", "/v1/budget/plan-grid")).statusCode).toBe(200);
      expect(leakText(await views(onSpace))).not.toContain(typed.get(offSpace)!);
    }
  });

  it("sec613 bounds: a malformed or out-of-range PUT body is 400 (413 over the body limit), never 500, and writes nothing", async () => {
    const space = await newSpace();
    await budgetWith(space, "0", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const ok = { period: "2026-12", kind: "limit", lineId: groceries, amount: eur("1"), version: 0 };
    const bad: unknown[] = [
      [ok],
      [ok, ok],
      { cells: [ok] },
      { ...ok, extra: 1 },
      { ...ok, amount: { ...eur("1"), extra: 1 } },
      { ...ok, amount: 1 },
      { ...ok, amount: "1" },
      { ...ok, amount: { amount: 1, currency: "EUR" } },
      ...[
        "-1",
        "-0",
        "+1",
        "1e5",
        "0x10",
        "NaN",
        "Infinity",
        "",
        " 1",
        "1,5",
        "1.",
        ".5",
        "0.001",
        "1.999",
        "1234567890123456",
        "9".repeat(48),
        "9".repeat(49),
        "١٢٣",
      ].map((amount) => ({ ...ok, amount: eur(amount) })),
      { ...ok, amount: { amount: "1", currency: "USD" } },
      { ...ok, amount: { amount: "1", currency: "eur" } },
      { ...ok, amount: { amount: "1", currency: "" } },
      { ...ok, amount: { amount: "1", currency: "E".repeat(11) } },
      ...[-1, 0.5, 2 ** 53, 1e308, "0", null].map((version) => ({ ...ok, version })),
      ...["2026-13", "2026-00", "2026-1", "202612", "2026-12-01", "0000-01", "9999-12", "", 202612].map(
        (p) => ({ ...ok, period: p }),
      ),
      ...["debt", "", "LIMIT", null].map((kind) => ({ ...ok, kind })),
      ...["x", "", 1, `${groceries}'`, NIL].map((lineId) => ({ ...ok, lineId })),
      { ...ok, lineId: null },
      { ...ok, kind: "savings" },
      { ...ok, kind: "goal" },
      { ...ok, kind: "goal", lineId: null },
      { ...ok, kind: "income" },
      {},
      null,
      "x",
      7,
    ];
    for (const body of bad) {
      const res = await put(space, body as Record<string, unknown>);
      expect(res.statusCode, `${JSON.stringify(body)} → ${res.body}`).toBe(400);
    }
    const raw = await app.inject({
      method: "PUT",
      url: "/v1/budget/plan-grid/cells",
      headers: {
        origin: WEB,
        "content-type": "application/json",
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
      payload: '{"period":',
    });
    expect(raw.statusCode).toBe(400);
    const big = await put(space, { ...ok, pad: "x".repeat(5000) });
    expect(big.statusCode).toBe(413);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("sec613 money: the largest amounts in every month keep the grid and the period view exact and answered (no 500, no float)", async () => {
    const space = await newSpace();
    await budgetWith(space, "999999999999999.99", { Продукти: "999999999999999.99" });
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    const MAX = "999999999999999.99";
    const g0 = await grid(space);
    for (const m of g0.months)
      for (const body of [
        { kind: "limit", lineId: groceries },
        { kind: "limit", lineId: cafe },
        { kind: "savings", lineId: null },
        { kind: "income", lineId: null },
      ]) {
        const res = await put(space, { period: m.period, amount: eur(MAX), version: 0, ...body });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toEqual({ amount: eur(MAX), version: 1 });
      }
    const g = await grid(space);
    expect(g.expenses.totals[1]).toEqual(eur("1999999999999999.98"));
    expect(g.unallocated[1]).toEqual({ kind: "deficit", amount: eur("1999999999999999.98") });
    const december = await period(space, "2026-12");
    expect(december.totals.limits.amount).toBe("1999999999999999.98");
    expect(december.plannedSavings.amount).toBe(MAX);
    // 0.01 is kept to the cent; zero is a value of its own, not «no value».
    const cent = await put(space, {
      period: "2026-12",
      kind: "limit",
      lineId: cafe,
      amount: eur("0.01"),
      version: 1,
    });
    expect(cent.json()).toEqual({ amount: eur("0.01"), version: 2 });
    const zero = await put(space, {
      period: "2026-12",
      kind: "limit",
      lineId: cafe,
      amount: eur("0"),
      version: 2,
    });
    expect(zero.statusCode, zero.body).toBe(200);
    expect(row(await grid(space), cafe)!.cells[1]).toMatchObject({ own: true, version: 3 });
    const { rows } = await db.owner.query<{ currency: string; amount: string }>(
      `SELECT DISTINCT currency, amount::text AS amount FROM budget.plan_cells
        WHERE household_id = $1 AND kind = 'savings'`,
      [space.householdId],
    );
    expect(rows).toEqual([{ currency: "EUR", amount: "999999999999999.990000000000000000" }]);
  });

  it("sec613 snapshot: a finished month's plan is not changed by a later cell, a later change of the plan, or a refused save to that month", async () => {
    const space = await newSpace();
    const b = await budgetWith(space, "1000", { Продукти: "700.00" });
    const groceries = await category(space, "Продукти");
    const cell = { period: "2026-12", kind: "limit", lineId: groceries };
    expect((await put(space, { ...cell, amount: eur("650"), version: 0 })).statusCode).toBe(200);
    expect(
      (await put(space, { period: "2026-12", kind: "savings", lineId: null, amount: eur("90"), version: 0 }))
        .statusCode,
    ).toBe(200);
    // January: nobody has looked at December yet, so it has no snapshot. The first thing that happens is a write.
    now = at("2027-01-05");
    expect(await n("budget.period_snapshots WHERE household_id = $1", space.householdId)).toBe(0);
    const past = await put(space, { ...cell, amount: eur("1"), version: 1 });
    expect(past.statusCode).toBe(400);
    expect(past.json().errors).toEqual([{ in: "body", path: "period", issue: "past" }]);
    const reset = await put(space, { ...cell, amount: null, version: 1 });
    expect(reset.statusCode).toBe(400);
    const patch = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      incomePlan: eur("2000"),
      limits: [{ categoryId: groceries, amount: eur("800") }],
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(
      (
        await put(space, {
          period: "2027-01",
          kind: "limit",
          lineId: groceries,
          amount: eur("5"),
          version: 0,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await put(space, { period: "2027-01", kind: "savings", lineId: null, amount: eur("6"), version: 0 }))
        .statusCode,
    ).toBe(200);
    const december = await period(space, "2026-12");
    expect(await limitOf(space, "2026-12", groceries)).toBe("650");
    expect(december.plannedSavings.amount).toBe("90");
    expect(december.incomePlan.amount).toBe("1000");
    expect(await limitOf(space, "2026-11", groceries)).toBe("700");
    // The stored snapshot and the past cell are as they were.
    const snap = await db.owner.query<{ limits: { amount: string }[]; planned_savings: string }>(
      `SELECT limits, planned_savings::text AS planned_savings FROM budget.period_snapshots
        WHERE household_id = $1 AND period = '2026-12-01'`,
      [space.householdId],
    );
    expect(snap.rows.map((r) => [Number(r.limits[0]!.amount), Number(r.planned_savings)])).toEqual([
      [650, 90],
    ]);
    expect(
      await n(
        "budget.plan_cells WHERE household_id = $1 AND period = '2026-12-01' AND kind = 'limit' AND amount = 650 AND version = 1",
        space.householdId,
      ),
    ).toBe(1);
    expect(await limitOf(space, "2027-01", groceries)).toBe("5");
    expect(await limitOf(space, "2027-02", groceries)).toBe("800");
  });

  it("sec613 NFR-12 FR 3: erasure of a space removes its plan cells and leaves another space's", async () => {
    const a = await newSpace();
    await budgetWith(a, "0", {});
    const b = await newSpace();
    await budgetWith(b, "0", {});
    for (const s of [a, b])
      expect(
        (await put(s, { period: "2026-12", kind: "savings", lineId: null, amount: eur("42"), version: 0 }))
          .statusCode,
      ).toBe(200);
    await createBudgetErasure(db.databases.for("budget")).eraseHousehold(a.householdId);
    expect(await n("budget.plan_cells WHERE household_id = $1", a.householdId)).toBe(0);
    expect(await n("budget.plan_cells WHERE household_id = $1", b.householdId)).toBe(1);
    expect((await call(a, "GET", "/v1/budget/plan-grid")).statusCode).toBe(404);
  });

  it("sec613 money: a closed goal's cell no longer counts in the month's planned savings — the period view agrees with the grid", async () => {
    const space = await newSpace();
    await budgetWith(space, "1000", {});
    const trip = await goal(space, "Відпустка", "3000.00");
    expect(
      (await put(space, { period: "2026-12", kind: "goal", lineId: trip, amount: eur("200"), version: 0 }))
        .statusCode,
    ).toBe(200);
    expect((await period(space, "2026-12")).plannedSavings.amount).toBe("200");
    const closed = await call(space, "POST", `/v1/goals/${trip}/close`);
    expect(closed.statusCode, closed.body).toBe(200);
    // The grid has no row for the goal and plans nothing for it: «Не розподілено 1 000 €»; the cell cannot be cleared.
    const g = await grid(space);
    expect(g.goals.rows).toEqual([]);
    expect(g.unallocated[1]).toEqual({ kind: "unallocated", amount: eur("1000") });
    expect((await period(space, "2026-12")).plannedSavings.amount).toBe("0");
  });

  it("sec613 snapshot: a closed goal's cell is not in a snapshot written after the goal closed; a snapshot written before stays as it was", async () => {
    const written = await newSpace();
    const later = await newSpace();
    const goals: string[] = [];
    for (const space of [written, later]) {
      await budgetWith(space, "1000", {});
      const trip = await goal(space, "Відпустка", "3000.00");
      goals.push(trip);
      expect(
        (await put(space, { period: "2026-12", kind: "goal", lineId: trip, amount: eur("200"), version: 0 }))
          .statusCode,
      ).toBe(200);
    }
    // The goal of `later` closes in December, before the month's snapshot exists.
    expect((await call(later, "POST", `/v1/goals/${goals[1]}/close`)).statusCode).toBe(200);
    now = at("2027-01-05");
    // The first view of the finished month writes its snapshot.
    expect((await period(written, "2026-12")).plannedSavings.amount).toBe("200");
    expect((await period(later, "2026-12")).plannedSavings.amount).toBe("0");
    expect((await call(written, "POST", `/v1/goals/${goals[0]}/close`)).statusCode).toBe(200);
    expect((await period(written, "2026-12")).plannedSavings.amount).toBe("200");
  });
});

describe("#665: with `budget.plan` off the wizard's «≈ M» ignores «Розподіл»'s typed rows, as the card does", () => {
  const wizard = async (space: Space, body: Record<string, unknown>) => {
    const res = await call(space, "POST", "/v1/budget/allocation", body);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().spendable as { amount: { amount: string; currency: string } | null };
  };
  const card = async (space: Space) => {
    const res = await call(space, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(res.statusCode, res.body).toBe(200);
    return res.json().figures as { amount: unknown; plannedExpenses: unknown };
  };

  it("BUD-17@PoC business rules (owner decision 2026-11-20, batch 2, item 2): «План» off — the wizard's «≈ M» (BUD-02@PoC FR 3) counts no typed debt or goal row of «Розподіл», so it equals «Можна витратити» (BUD-03@PoC FR 6) after saving: 6 000 − 100; on — both count the cell: 6 000 − 250,25", async () => {
    const space = await newSpace();
    const trip = await goal(space, "Відпустка", "3000.00");
    const loanId = randomUUID();
    extras.set(space.householdId, [{ accountId: loanId, amount: Money.of("100", "EUR") }]);
    try {
      const plain = { firstPeriod: "2026-11", incomePlan: eur("6000") };
      const typed = {
        ...plain,
        allocation: [
          { kind: "debt", accountId: loanId, amount: eur("250.25") },
          { kind: "goal", goalId: trip, amount: eur("321.09") },
        ],
      };
      planOffFor.add(space.householdId);
      const without = (await wizard(space, plain)).amount;
      expect(without).not.toBeNull();
      const off = (await wizard(space, typed)).amount;
      // Off: the typed rows change nothing — the plan's extra payment 100 € and the goal's required contribution count.
      expect(off).toEqual(without);
      const res = await call(space, "POST", "/v1/budget", typed);
      expect(res.statusCode, res.body).toBe(201);
      const offCard = await card(space);
      expect(offCard.amount).toEqual(off);
      expect(offCard.plannedExpenses).toEqual({
        items: [{ accountId: loanId, amount: eur("100") }],
        total: eur("100"),
      });
      // On: the same rows act in both, exact.
      planOffFor.clear();
      const on = (await wizard(space, typed)).amount;
      const onCard = await card(space);
      expect(onCard.plannedExpenses).toEqual({
        items: [{ accountId: loanId, amount: eur("250.25") }],
        total: eur("250.25"),
      });
      expect(onCard.amount).toEqual(on);
      expect(on).not.toEqual(off);
    } finally {
      extras.delete(space.householdId);
    }
  });
});
