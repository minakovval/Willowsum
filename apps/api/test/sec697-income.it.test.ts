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
 * sec697 (security review of PR #697): «План доходу» by income category — space isolation and roles, the amount rules,
 * the stored sum, the database's own checks, deleting and erasing, and a change that touches no category. Real API on a
 * real PostgreSQL with the real categories, accounts, transactions, categorization and fx-rates modules; goals, debts
 * and regular payments are the test's ports. Every name and amount is synthetic; the clock is the test's own (Kyiv).
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

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}
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
const paths = (res: { json: () => { errors?: { path: string; issue: string }[] } }) =>
  (res.json().errors ?? []).map((e) => `${e.path}: ${e.issue}`);

afterEach(() => {
  goals.clear();
  minimums.clear();
  recurring.clear();
  extras.clear();
  charges.clear();
});

const patch = (space: Space, body: Record<string, unknown>) => call(space, "PATCH", "/v1/budget/plan", body);

/** «Нова категорія доходу…»: a custom income category in the group of that name (made as in «Налаштування → Категорії»). */
async function newIncomeCategory(space: Space, group: string, name: string): Promise<string> {
  const tree = await call(space, "GET", "/v1/categories");
  const groupId = (tree.json().groups as { id: string; name: string }[]).find((g) => g.name === group)!.id;
  const res = await call(space, "POST", "/v1/categories", { groupId, name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
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

const patchAs = (
  space: Space,
  body: Record<string, unknown>,
  principal: { role?: string; scoped?: boolean },
) => call(space, "PATCH", "/v1/budget/plan", body, principal);
const incomeRows = (householdId: string) => n("budget.income_plans WHERE household_id = $1", householdId);
async function sumInvariant(householdId: string): Promise<boolean> {
  const { rows } = await db.owner.query<{ ok: boolean }>(
    `SELECT b.income_plan = COALESCE((SELECT sum(amount) FROM budget.income_plans i
                                       WHERE i.household_id = b.household_id AND i.budget_id = b.id), 0) AS ok
       FROM budget.budgets b WHERE b.household_id = $1`,
    [householdId],
  );
  return rows.length === 1 && rows[0]!.ok;
}

describe("sec697: «План доходу» by income category — isolation, roles, amounts", () => {
  it("sec697: income_plans has forced row-level security with the space's policy; the module's role sees no row of another space", async () => {
    const { rows } = await db.owner.query<{ rls: boolean; forced: boolean; policies: number }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = 'budget' AND c.relname = 'income_plans'`,
    );
    expect(rows).toEqual([{ rls: true, forced: true, policies: 1 }]);
    const a = await newSpace();
    const b = await newSpace();
    const created = await create(a, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: await category(a, "Зарплата"), amount: eur("3000") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    // The query asks for A's rows inside B's context: the policy, not the WHERE, hides them.
    const seen = await db.databases
      .for("budget")
      .inHousehold(b.householdId, (q) =>
        q.query(`SELECT 1 FROM income_plans WHERE household_id = $1`, [a.householdId]),
      );
    expect(seen.rows).toEqual([]);
    const all = await db.databases
      .for("budget")
      .inHousehold(b.householdId, (q) => q.query(`SELECT 1 FROM income_plans`));
    expect(all.rows).toEqual([]);
  });

  it("sec697: another space reads no income plan and cannot plan the first space's income category; nothing changes there", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const salaryA = await category(a, "Зарплата");
    const created = await create(a, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salaryA, amount: eur("3000") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call(b, "GET", "/v1/budget")).json().budget).toBeNull();
    const own = await create(b, { firstPeriod: "2026-11", incomePlan: eur("10") });
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json().incomePlans).toEqual([]);
    expect((await period(b, "2026-11")).incomeCategories).toEqual([]);
    const cross = await call(b, "PATCH", "/v1/budget/plan", {
      version: own.json().version,
      incomePlans: [{ categoryId: salaryA, amount: eur("1") }],
    });
    expect(cross.statusCode).toBe(400);
    expect(paths(cross)).toEqual(["incomePlans.0.categoryId: not_found"]);
    // Removing an id of another space is a no-op, never a write there.
    const remove = await call(b, "PATCH", "/v1/budget/plan", {
      version: own.json().version,
      incomePlans: [{ categoryId: salaryA, amount: null }],
    });
    expect([200, 400]).toContain(remove.statusCode);
    expect(await incomeRows(a.householdId)).toBe(1);
    expect(await incomeRows(b.householdId)).toBe(0);
    expect((await call(a, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("3000"),
      incomePlans: [{ categoryId: salaryA, amount: eur("3000") }],
    });
  });

  it("sec697: a viewer reads the plan by category and cannot create or change it; a scoped member gets no budget", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const body = { firstPeriod: "2026-11", incomePlans: [{ categoryId: salary, amount: eur("3000") }] };
    const denied = await create(space, body, undefined, { role: "viewer" });
    expect(denied.statusCode).toBe(403);
    expect(await budgets(space.householdId)).toBe(0);
    const created = await create(space, body);
    expect(created.statusCode, created.body).toBe(201);
    const version = created.json().version as number;
    const change = { version, incomePlans: [{ categoryId: salary, amount: eur("1") }] };
    expect((await patchAs(space, change, { role: "viewer" })).statusCode).toBe(403);
    expect(
      (
        await patchAs(
          space,
          { version, incomePlans: [{ categoryId: salary, amount: null }] },
          { role: "viewer" },
        )
      ).statusCode,
    ).toBe(403);
    const read = await call(space, "GET", "/v1/budget", undefined, { role: "viewer" });
    expect(read.statusCode).toBe(200);
    expect(read.json().budget.incomePlans).toEqual([{ categoryId: salary, amount: eur("3000") }]);
    for (const role of ["member", "viewer"]) {
      const scopedPatch = await patchAs(space, change, { role, scoped: true });
      const scopedGet = await call(space, "GET", "/v1/budget", undefined, { role, scoped: true });
      const scopedPeriod = await call(space, "GET", "/v1/budget/periods/2026-11", undefined, {
        role,
        scoped: true,
      });
      const scopedWizard = await call(space, "GET", "/v1/budget/wizard", undefined, { role, scoped: true });
      for (const r of [scopedPatch, scopedGet, scopedPeriod, scopedWizard])
        expect([403, 404], role).toContain(r.statusCode);
      expect(scopedGet.body + scopedPeriod.body + scopedWizard.body).not.toContain("3000");
    }
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("3000"),
      version,
    });
    expect(await sumInvariant(space.householdId)).toBe(true);
  });

  it("sec697: an income category's plan is ≥ 0, a decimal string in the budget's currency at its minor units; a refused request saves nothing", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    for (const amount of [
      { amount: "-1", currency: "EUR" },
      { amount: "1e3", currency: "EUR" },
      { amount: "1.005", currency: "EUR" },
      { amount: "1,5", currency: "EUR" },
      { amount: " 1", currency: "EUR" },
      { amount: "NaN", currency: "EUR" },
      { amount: "Infinity", currency: "EUR" },
      { amount: "1234567890123456", currency: "EUR" },
      { amount: "1", currency: "USD" },
      { amount: 1, currency: "EUR" },
      "1",
      1,
    ]) {
      const res = await create(space, {
        firstPeriod: "2026-11",
        incomePlans: [{ categoryId: salary, amount }],
      });
      expect(res.statusCode, JSON.stringify(amount)).toBe(400);
    }
    // A new plan has nothing to remove.
    expect(
      (await create(space, { firstPeriod: "2026-11", incomePlans: [{ categoryId: salary, amount: null }] }))
        .statusCode,
    ).toBe(400);
    expect(await budgets(space.householdId)).toBe(0);
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salary, amount: eur("3000.10") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const version = created.json().version as number;
    for (const amount of [eur("-0.01"), eur("1.005"), { amount: "1", currency: "USD" }, eur("1e2"), 5]) {
      const res = await patch(space, { version, incomePlans: [{ categoryId: salary, amount }] });
      expect(res.statusCode, JSON.stringify(amount)).toBe(400);
    }
    const extra = await patch(space, {
      version,
      incomePlans: [{ categoryId: salary, amount: eur("1"), note: "x" }],
    });
    expect(extra.statusCode).toBe(400);
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("3000.1"),
      incomePlans: [{ categoryId: salary, amount: eur("3000.1") }],
      version,
    });
    expect(await sumInvariant(space.householdId)).toBe(true);
  });

  it("sec697: the stored income plan equals the sum of the stored rows after every change (exact cents, no float)", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const freelance = await category(space, "Фриланс");
    const rent = await category(space, "Дохід від оренди");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [
        { categoryId: salary, amount: eur("0.10") },
        { categoryId: freelance, amount: eur("0.20") },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().incomePlan).toEqual(eur("0.3"));
    expect(await sumInvariant(space.householdId)).toBe(true);
    // Only one category in the request: the others stay in the sum.
    const one = await patch(space, {
      version: created.json().version,
      incomePlans: [{ categoryId: rent, amount: eur("999999999999999.99") }],
    });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().incomePlan).toEqual(eur("1000000000000000.29"));
    expect(await sumInvariant(space.householdId)).toBe(true);
    const removed = await patch(space, {
      version: one.json().version,
      incomePlans: [
        { categoryId: rent, amount: null },
        { categoryId: salary, amount: eur("0.10") },
      ],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().incomePlan).toEqual(eur("0.3"));
    expect(await sumInvariant(space.householdId)).toBe(true);
    // The last ones removed: the plan is 0, not the old sum.
    const none = await patch(space, {
      version: removed.json().version,
      incomePlans: [
        { categoryId: salary, amount: null },
        { categoryId: freelance, amount: null },
      ],
    });
    expect(none.statusCode, none.body).toBe(200);
    expect(none.json()).toMatchObject({ incomePlan: eur("0"), incomePlans: [] });
    expect(await incomeRows(space.householdId)).toBe(0);
  });

  it("sec697: deleting the budget or erasing the space leaves no income plan row; a category with an income plan is not empty", async () => {
    const space = await newSpace();
    const custom = await newIncomeCategory(space, "Дохід від роботи", "Синтетичний підробіток");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: custom, amount: eur("300") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const del = await call(space, "DELETE" as "PUT", `/v1/categories/${custom}`);
    expect(del.statusCode, del.body).toBe(409);
    expect(await incomeRows(space.householdId)).toBe(1);
    const gone = await call(space, "DELETE" as "PUT", "/v1/budget");
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    expect(await incomeRows(space.householdId)).toBe(0);
    expect(await incomeAudit(space.householdId, "delete")).toBe(1);
  });

  it("sec697: the database refuses a negative income plan and a second row of one category (defence in depth)", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const insert = (categoryId: string, amount: string) =>
      db.owner.query(
        `INSERT INTO budget.income_plans (household_id, budget_id, category_id, amount, currency)
         VALUES ($1, $2, $3, $4, 'EUR')`,
        [space.householdId, created.json().id, categoryId, amount],
      );
    await expect(insert(randomUUID(), "-0.01")).rejects.toThrow(/check/i);
    await expect(insert(salary, "1")).rejects.toThrow(/duplicate|unique/i);
    // A row cannot point at a budget of another space.
    await expect(
      db.owner.query(
        `INSERT INTO budget.income_plans (household_id, budget_id, category_id, amount, currency)
         VALUES ($1, $2, $3, 1, 'EUR')`,
        [randomUUID(), created.json().id, randomUUID()],
      ),
    ).rejects.toThrow(/foreign key/i);
    expect(await incomeRows(space.householdId)).toBe(1);
  });

  it("sec697: a new plan takes no removal row; a plan by category takes no single amount, alone or with categories", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const created = await create(space, {
      firstPeriod: "2026-11",
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    const version = created.json().version as number;
    const both = await patch(space, {
      version,
      incomePlan: eur("1"),
      incomePlans: [{ categoryId: salary, amount: eur("2") }],
    });
    expect(both.statusCode).toBe(400);
    expect(paths(both)).toEqual(["incomePlan: with_income_plans"]);
    const single = await patch(space, { version, incomePlan: eur("1") });
    expect(paths(single)).toEqual(["incomePlan: by_category"]);
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("3000"),
      version,
    });
  });

  it("sec697: a change that touches no income category leaves a plan without categories as it is (empty list, removing a category that has no plan)", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const created = await create(space, { firstPeriod: "2026-11", incomePlan: eur("3000") });
    expect(created.statusCode, created.body).toBe(201);
    const empty = await patch(space, { version: created.json().version, incomePlans: [] });
    expect(empty.statusCode, empty.body).toBe(200);
    const removal = await patch(space, {
      version: empty.json().version,
      incomePlans: [{ categoryId: salary, amount: null }],
    });
    expect(removal.statusCode, removal.body).toBe(200);
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("3000"),
      incomePlans: [],
    });
  });

  it("sec697: the first income category set on a plan without categories makes the income plan their sum", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const created = await create(space, { firstPeriod: "2026-11", incomePlan: eur("3000") });
    expect(created.statusCode, created.body).toBe(201);
    const first = await patch(space, {
      version: created.json().version,
      incomePlans: [{ categoryId: salary, amount: eur("500.05") }],
    });
    expect(first.statusCode, first.body).toBe(200);
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({
      incomePlan: eur("500.05"),
      incomePlans: [{ categoryId: salary, amount: eur("500.05") }],
    });
    expect(await sumInvariant(space.householdId)).toBe(true);
  });
});
