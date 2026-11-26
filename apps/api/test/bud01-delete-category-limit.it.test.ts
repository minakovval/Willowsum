import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  createBudgetServices,
  type BudgetServices,
} from "../src/modules/budget/index.ts";
import {
  createCategoriesServices,
  createCategoryDirectory,
  type CategoryUsage,
} from "../src/modules/categories/index.ts";
import {
  createCategorizationCategoryUsage,
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createRecurringCategoryUsage } from "../src/modules/recurring/index.ts";
import {
  createBudgetTransactions,
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-01@PoC FR 12, AC22, AC23; BUD-02@PoC FR 23 (wave 2 row 221; owner decision 2026-11-26): the exact reason of the
 * delete dialog and the category only its limit holds, through the real API on a real PostgreSQL with the real
 * categories, budget, transactions, categorization and recurring modules wired as the API process wires them. A rule
 * and a regular payment are rows of their modules written by the owner connection (their own flows are BUD-14 and
 * BUD-07). A rule does not hold its category (lead decision 2026-11-26, row 221); a regular payment does. Every name and amount is synthetic; the clock is the test's own (Kyiv).
 */
const WEB = "http://localhost:5173";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
let now = at("2026-11-18");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
/** The budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function names(space: Space): Promise<Map<string, { id: string; deletable: boolean }>> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  return new Map(
    (res.json().groups as { categories: { id: string; name: string; deletable: boolean }[] }[]).flatMap((g) =>
      g.categories.map((c) => [c.name, c] as const),
    ),
  );
}

async function addCategory(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  const group = (res.json().groups as { id: string; name: string }[]).find((g) => g.name === "Харчування")!;
  const created = await call(space, "POST", "/v1/categories", { groupId: group.id, name });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().id as string;
}

const put = (space: Space, period: string, lineId: string, amount: string, version = 0) =>
  call(space, "PUT", "/v1/budget/plan-grid/cells", {
    period,
    kind: "limit",
    lineId,
    amount: eur(amount),
    version,
  });

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

async function octoberLimits(householdId: string): Promise<unknown> {
  const { rows } = await db.owner.query<{ limits: unknown }>(
    `SELECT limits FROM budget.period_snapshots WHERE household_id = $1 AND period = '2026-10-01'`,
    [householdId],
  );
  return rows[0]?.limits;
}

/**
 * «Абонементи» with a limit of 30 € from October, a finished October and its own values of «План» for December and
 * January.
 */
async function subscriptions(space: Space, extra: { categoryId: string; amount: string }[] = []) {
  now = at("2026-10-05");
  const subs = await addCategory(space, "Абонементи");
  const created = await call(space, "POST", "/v1/budget", {
    firstPeriod: "2026-10",
    incomePlan: eur("2000.00"),
    limits: [
      { categoryId: subs, amount: eur("30.00") },
      ...extra.map((e) => ({ categoryId: e.categoryId, amount: eur(e.amount) })),
    ],
  });
  expect(created.statusCode, created.body).toBe(201);
  now = at("2026-11-18");
  expect((await put(space, "2026-12", subs, "35.00")).statusCode).toBe(200);
  expect((await put(space, "2027-01", subs, "40.00")).statusCode).toBe(200);
  return subs;
}

/**
 * A write of module budget that lands right after budget's own commit in a confirmed delete, while the category is
 * still in the directory (the money review of #708): set once, run after the first `release`.
 */
let raceOnce: ((householdId: string, categoryId: string) => Promise<void>) | null = null;
function withRace(usage: CategoryUsage): CategoryUsage {
  const limits = usage.limits!;
  return {
    ...usage,
    limits: {
      ...limits,
      async release(caller, categoryId) {
        const removed = await limits.release(caller, categoryId);
        const race = raceOnce;
        raceOnce = null;
        if (race) await race(caller.householdId, categoryId);
        return removed;
      },
    },
  };
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
        // As src/main.ts wires it.
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [
            createTransactionCategoryUsage(db.databases.for("transactions")),
            createCategorizationCategoryUsage(db.databases.for("categorization"), lookup),
            withRace(createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices)),
            createRecurringCategoryUsage(db.databases.for("recurring")),
          ],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
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

describe("BUD-01@PoC FR 12: a category only its limit holds is deleted after confirmation", () => {
  it("BUD-01@PoC AC 22: «Абонементи» with a limit of 30 € and «План» cells for December and January, a finished October — the confirmation names 30 €; confirmed, the category, its limit and cells go, the name is free again, October's snapshot keeps it and the deletion is in the audit log", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    expect((await names(space)).get("Абонементи")!.deletable).toBe(true);
    const usage = await call(space, "GET", `/v1/categories/${subs}/usage`);
    expect(usage.statusCode, usage.body).toBe(200);
    const reason = {
      transactions: 0,
      rules: 0,
      recurringPayments: 0,
      mergedCategories: 0,
      budget: { limit: eur("30"), stored: true, planCells: 2 },
    };
    expect(usage.json()).toEqual({ ...reason, deletable: true });

    // Unconfirmed: refused with the limit, nothing changes.
    const unconfirmed = await call(space, "DELETE", `/v1/categories/${subs}`);
    expect(unconfirmed.statusCode, unconfirmed.body).toBe(409);
    expect(unconfirmed.json()).toMatchObject({ code: "CATEGORY_LIMIT_CONFIRM", categoryUsage: reason });
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(2);

    const version = (await call(space, "GET", "/v1/budget")).json().budget.version as number;
    const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(200);
    expect((await names(space)).has("Абонементи")).toBe(false);
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
    // October's snapshot was written before the limit went: it keeps the category as it was.
    expect(await octoberLimits(space.householdId)).toEqual([
      { categoryId: subs, amount: "30", mandatory: false },
    ]);
    // Another window's page sees a new version of the budget.
    expect((await call(space, "GET", "/v1/budget")).json().budget.version).toBeGreaterThan(version);
    // The name is free again.
    expect(await addCategory(space, "Абонементи")).not.toBe(subs);

    const entry = await audit.entriesFor(space.householdId, { type: "categories.category", id: subs });
    expect(entry.map((e) => e.action)).toEqual(["create", "delete"]);
    expect(entry[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name", before: "Абонементи", after: null }),
        expect.objectContaining({ field: "limit", before: "30 EUR", after: null }),
        expect.objectContaining({ field: "planCells", before: "2", after: null }),
      ]),
    );
    const limit = await audit.entriesFor(space.householdId, { type: "budget.limit", id: subs });
    expect(limit.map((e) => e.action)).toContain("delete");
    const cells = await audit.entriesFor(space.householdId, { type: "budget.plan-cell", id: subs });
    expect(cells.filter((e) => e.action === "delete")).toHaveLength(2);
  });

  it("BUD-01@PoC FR 12: N is the current period's limit — the month's own value of «План» when it has one", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    expect((await put(space, "2026-11", subs, "25.00")).statusCode).toBe(200);
    const usage = (await call(space, "GET", `/v1/categories/${subs}/usage`)).json();
    expect(usage.budget).toEqual({ limit: eur("25"), stored: true, planCells: 3 });
  });

  it("BUD-01@PoC FR 12: an income category with only a plan in «План доходу» — deleted after confirmation; the income plan becomes the sum of the others", async () => {
    const space = await newSpace();
    const res = await call(space, "GET", "/v1/categories");
    const group = (res.json().groups as { id: string; kind: string }[]).find((g) => g.kind === "income")!;
    const bonus = (
      await call(space, "POST", "/v1/categories", { groupId: group.id, name: "Синтетичні премії" })
    ).json().id as string;
    const salary = (await names(space)).get("Зарплата")!.id;
    const created = await call(space, "POST", "/v1/budget", {
      firstPeriod: "2026-11",
      incomePlans: [
        { categoryId: salary, amount: eur("2000.00") },
        { categoryId: bonus, amount: eur("300.00") },
      ],
      limits: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call(space, "GET", `/v1/categories/${bonus}/usage`)).json().budget.limit).toEqual(
      eur("300"),
    );
    const del = await call(space, "DELETE", `/v1/categories/${bonus}?confirmLimit=true`);
    expect(del.statusCode, del.body).toBe(200);
    expect((await call(space, "GET", "/v1/budget")).json().budget.incomePlan).toEqual(eur("2000"));
  });

  it("BUD-01@PoC FR 12: two confirmed deletes at once — one 200, one 404; the limit's audit entry once, one category entry", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    const answers = await Promise.all([
      call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`),
      call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`),
    ]);
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 404]);
    const entry = await audit.entriesFor(space.householdId, { type: "categories.category", id: subs });
    expect(entry.map((e) => e.action)).toEqual(["create", "delete"]);
    const limit = await audit.entriesFor(space.householdId, { type: "budget.limit", id: subs });
    expect(limit.filter((e) => e.action === "delete")).toHaveLength(1);
  });

  it("BUD-01@PoC FR 12: a limit and a «План» cell budget saved while the confirmed delete ran (after budget's commit, before the category's) are swept after the delete — no entry of the deleted category is left", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    const budgetId = (await call(space, "GET", "/v1/budget")).json().budget.id as string;
    raceOnce = async (householdId, categoryId) => {
      await db.owner.query(
        `INSERT INTO budget.limits (household_id, budget_id, category_id, amount, currency) VALUES ($1, $2, $3, 45, 'EUR')`,
        [householdId, budgetId, categoryId],
      );
      await db.owner.query(
        `INSERT INTO budget.plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
         VALUES ($1, $2, '2027-02-01', 'limit', $3, 50, 'EUR', 1)`,
        [householdId, budgetId, categoryId],
      );
    };
    const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(200);
    expect(raceOnce).toBeNull();
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await n("budget.plan_cells WHERE household_id = $1", space.householdId)).toBe(0);
    const limit = await audit.entriesFor(space.householdId, { type: "budget.limit", id: subs });
    expect(limit.filter((e) => e.action === "delete")).toHaveLength(2);
  });

  it("BUD-01@PoC FR 12 «Права доступу»: another space's category with a limit — 404 for its usage and its confirmed delete; its limit and cells stay", async () => {
    const owner = await newSpace();
    const subs = await subscriptions(owner);
    const stranger = await newSpace();
    expect((await call(stranger, "GET", `/v1/categories/${subs}/usage`)).statusCode).toBe(404);
    expect((await call(stranger, "DELETE", `/v1/categories/${subs}?confirmLimit=true`)).statusCode).toBe(404);
    expect(await n("budget.limits WHERE household_id = $1", owner.householdId)).toBe(1);
    expect(await n("budget.plan_cells WHERE household_id = $1", owner.householdId)).toBe(2);
  });
});

describe("BUD-01@PoC FR 12: the exact reason of a held category", () => {
  it("BUD-01@PoC AC 23: «Спортзал» without transactions, with 1 category rule and 1 regular payment — no «Видалити»; the reason is «1 регулярний платіж» (the rule is named as information, not as a reason); the request is refused with the same reason and nothing changes; once the payment is gone the category is deleted and its rule stays, now pointing at a deleted category («Потребує уваги»)", async () => {
    const space = await newSpace();
    const gym = await addCategory(space, "Спортзал");
    const ruleId = randomUUID();
    const paymentId = randomUUID();
    await db.owner.query(
      `INSERT INTO categorization.rules (household_id, id, position, conditions, category_id, condition_key)
       VALUES ($1, $2, 1, '[]'::jsonb, $3, 'synthetic-gym')`,
      [space.householdId, ruleId, gym],
    );
    await db.owner.query(
      `INSERT INTO recurring.payments (household_id, id, name, type, frequency, expected_amount, expected_currency,
         anchor_date, category_id, source, created_on)
       VALUES ($1, $2, 'Синтетичний спортзал', 'expense', 'month', 25, 'EUR', '2026-10-01', $3, 'manual', '2026-10-01')`,
      [space.householdId, paymentId, gym],
    );
    expect((await names(space)).get("Спортзал")!.deletable).toBe(false);
    const reason = {
      transactions: 0,
      rules: 1,
      recurringPayments: 1,
      mergedCategories: 0,
      budget: { limit: null, stored: false, planCells: 0 },
    };
    expect((await call(space, "GET", `/v1/categories/${gym}/usage`)).json()).toEqual({
      ...reason,
      deletable: false,
    });
    for (const url of [`/v1/categories/${gym}`, `/v1/categories/${gym}?confirmLimit=true`]) {
      const res = await call(space, "DELETE", url);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ code: "CATEGORY_NOT_EMPTY", categoryUsage: reason });
    }
    expect((await names(space)).has("Спортзал")).toBe(true);
    expect(await n("categorization.rules WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(1);

    // The rule alone does not hold it (lead decision 2026-11-26, row 221).
    await db.owner.query(`DELETE FROM recurring.payments WHERE household_id = $1 AND id = $2`, [
      space.householdId,
      paymentId,
    ]);
    expect((await call(space, "GET", `/v1/categories/${gym}/usage`)).json()).toEqual({
      ...reason,
      recurringPayments: 0,
      deletable: true,
    });
    const deleted = await call(space, "DELETE", `/v1/categories/${gym}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      await n(
        "categorization.rules WHERE household_id = $1 AND id = $2 AND category_id = $3",
        space.householdId,
        ruleId,
        gym,
      ),
    ).toBe(1);
  });

  it("BUD-01@PoC FR 12: a held category with a limit keeps its limit — the reasons are what holds it, the limit is listed among the budget entries only", async () => {
    const space = await newSpace();
    const gym = await addCategory(space, "Спортзал");
    const subs = await subscriptions(space, [{ categoryId: gym, amount: "50.00" }]);
    await db.owner.query(
      `INSERT INTO recurring.payments (household_id, id, name, type, frequency, expected_amount, expected_currency,
         anchor_date, category_id, source, created_on)
       VALUES ($1, $2, 'Синтетичний спортзал', 'expense', 'month', 25, 'EUR', '2026-10-01', $3, 'manual', '2026-10-01')`,
      [space.householdId, randomUUID(), gym],
    );
    const res = await call(space, "DELETE", `/v1/categories/${gym}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().categoryUsage).toMatchObject({
      recurringPayments: 1,
      budget: { limit: eur("50"), stored: true },
    });
    expect(
      await n("budget.limits WHERE household_id = $1 AND category_id = $2", space.householdId, gym),
    ).toBe(1);
    expect(subs).not.toBe(gym);
  });
});
