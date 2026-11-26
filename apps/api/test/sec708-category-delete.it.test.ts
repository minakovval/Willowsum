// ===== FILE: apps/api/test/sec708-category-delete.it.test.ts =====
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
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
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
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-01@PoC FR 12, AC22, AC23; BUD-02@PoC FR 23 (wave 2 row 221; owner decision 2026-11-26): the exact reason of the
 * delete dialog and the category only its limit holds, through the real API on a real PostgreSQL with the real
 * categories, budget, transactions, categorization and recurring modules wired as the API process wires them. A rule
 * and a regular payment are rows of their modules written by the owner connection (their own flows are BUD-14 and
 * BUD-07). Every name and amount is synthetic; the clock is the test's own (Kyiv).
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
const off = new Set<string>();

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

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal } as never),
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
        flags: { ...fakeFlags(), isEnabled: async (_h: string, f: string) => !off.has(f) },
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
            createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices),
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

/** Security review of #708: the confirmed delete is not a way around the roles, the scope, the flag or what holds a category. */
describe("sec708: `confirmLimit=true` removes a limit only for who may delete and only when nothing holds the category", () => {
  const budgetRows = async (householdId: string) => [
    await n("budget.limits WHERE household_id = $1", householdId),
    await n("budget.plan_cells WHERE household_id = $1", householdId),
    await n("budget.period_snapshots WHERE household_id = $1", householdId),
  ];

  it.each([
    [{ role: "viewer" }, 403],
    [{ role: "advisor" }, 403],
    [{ role: "editor", scoped: true }, 403],
  ] as const)(
    "sec708: %o may not delete a category with its limit (%i); the limit, the cells and the audit log stay",
    async (p, status) => {
      const space = await newSpace();
      const subs = await subscriptions(space);
      const before = await budgetRows(space.householdId);
      const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`, undefined, p);
      expect(res.statusCode, res.body).toBe(status);
      expect(await budgetRows(space.householdId)).toEqual(before);
      expect((await names(space)).has("Абонементи")).toBe(true);
      const limit = await audit.entriesFor(space.householdId, { type: "budget.limit", id: subs });
      expect(limit.filter((e) => e.action === "delete")).toHaveLength(0);
    },
  );

  it("sec708: a scoped member learns nothing from the usage of a category with a limit — not found", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    const res = await call(space, "GET", `/v1/categories/${subs}/usage`, undefined, {
      role: "editor",
      scoped: true,
    });
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain("30");
  });

  it("sec708: the flag categories.tree off — a confirmed delete is 404 and the limit stays", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    off.add("categories.tree");
    try {
      expect((await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`)).statusCode).toBe(404);
      expect((await call(space, "GET", `/v1/categories/${subs}/usage`)).statusCode).toBe(404);
    } finally {
      off.clear();
    }
    expect((await budgetRows(space.householdId)).slice(0, 2)).toEqual([1, 2]);
  });

  it("sec708: a system category with a limit and `confirmLimit=true` — CATEGORY_SYSTEM_FIXED; its limit stays", async () => {
    const space = await newSpace();
    const all = await call(space, "GET", "/v1/categories");
    const system = (
      all.json().groups as { kind: string; categories: { id: string; systemKey: string | null }[] }[]
    )
      .filter((g) => g.kind === "expense")
      .flatMap((g) => g.categories)
      .find((c) => c.systemKey !== null)!;
    await subscriptions(space, [{ categoryId: system.id, amount: "70.00" }]);
    const res = await call(space, "DELETE", `/v1/categories/${system.id}?confirmLimit=true`);
    expect([res.statusCode, res.json().code]).toEqual([409, "CATEGORY_SYSTEM_FIXED"]);
    expect(
      await n("budget.limits WHERE household_id = $1 AND category_id = $2", space.householdId, system.id),
    ).toBe(1);
  });

  it("sec708: a confirmed delete removes only this category's entries — another category's limit and cells, and another space's rows with the same category id, stay", async () => {
    const space = await newSpace();
    const other = await addCategory(space, "Синтетичні книжки");
    const subs = await subscriptions(space, [{ categoryId: other, amount: "45.00" }]);
    expect((await put(space, "2026-12", other, "50.00")).statusCode).toBe(200);
    // Another space whose budget rows carry this space's category id (defence in depth).
    const stranger = await newSpace();
    const theirs = await subscriptions(stranger);
    await db.owner.query(
      `UPDATE budget.limits SET category_id = $2 WHERE household_id = $1 AND category_id = $3`,
      [stranger.householdId, subs, theirs],
    );
    await db.owner.query(
      `UPDATE budget.plan_cells SET line_id = $2 WHERE household_id = $1 AND line_id = $3`,
      [stranger.householdId, subs, theirs],
    );
    const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(200);
    expect(
      await n("budget.limits WHERE household_id = $1 AND category_id = $2", space.householdId, other),
    ).toBe(1);
    expect(
      await n("budget.plan_cells WHERE household_id = $1 AND line_id = $2", space.householdId, other),
    ).toBe(1);
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(1);
    expect(
      await n("budget.limits WHERE household_id = $1 AND category_id = $2", stranger.householdId, subs),
    ).toBe(1);
    expect(
      await n("budget.plan_cells WHERE household_id = $1 AND line_id = $2", stranger.householdId, subs),
    ).toBe(2);
  });

  it("sec708: `confirmLimit=false` and a value other than true/false never confirm", async () => {
    const space = await newSpace();
    const subs = await subscriptions(space);
    const no = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=false`);
    expect([no.statusCode, no.json().code]).toEqual([409, "CATEGORY_LIMIT_CONFIRM"]);
    for (const v of ["1", "TRUE", "yes", ""]) {
      const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=${v}`);
      expect(res.statusCode, v).toBeGreaterThanOrEqual(400);
    }
    expect((await budgetRows(space.householdId)).slice(0, 2)).toEqual([1, 2]);
    expect((await names(space)).has("Абонементи")).toBe(true);
  });
  it("sec708: the snapshot of a finished period is written by the delete itself — nothing read the budget since October, and October keeps the category's limit", async () => {
    const space = await newSpace();
    now = at("2026-10-05");
    const subs = await addCategory(space, "Абонементи");
    const created = await call(space, "POST", "/v1/budget", {
      firstPeriod: "2026-10",
      incomePlan: eur("2000.00"),
      limits: [{ categoryId: subs, amount: eur("30.00") }],
    });
    expect(created.statusCode, created.body).toBe(201);
    now = at("2026-11-18");
    expect(await octoberLimits(space.householdId)).toBeUndefined();
    const res = await call(space, "DELETE", `/v1/categories/${subs}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await n("budget.limits WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await octoberLimits(space.householdId)).toEqual([
      { categoryId: subs, amount: "30", mandatory: false },
    ]);
  });
});
