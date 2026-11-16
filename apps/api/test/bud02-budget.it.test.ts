import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetErasure,
  createBudgetServices,
} from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
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
 * BUD-02@PoC a) (wave 2 row 29), the server part of the module `budget`, through the real API on a real PostgreSQL with
 * the real categories, accounts, transactions, categorization and fx-rates modules: one budget per space, the income
 * plan and limits from the current period on, «Поза планом», the budget's accounts, the snapshot of a finished period,
 * the deletion, the space's boundary and the audit hand-off with its daily recovery (ARC-04, #249). Every name and
 * amount is synthetic; the clock is the test's own (Kyiv).
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
const telemetry = testTelemetryForFile();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

async function account(space: Space, kind = "current", currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind}`,
    balance: { amount: "5000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
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

/** A transaction of the account in `categoryName` (null — «Без категорії»). */
async function spend(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  categoryName: string | null,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { currency = "EUR", ...rest } = extra as { currency?: string };
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний продавець",
    ...rest,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  if (categoryName !== null) {
    const set = await call(space, "PUT", `/v1/transactions/${id}/category`, {
      categoryId: await category(space, categoryName),
    });
    expect(set.statusCode, set.body).toBe(200);
  }
  return id;
}

async function createBudget(space: Space, body: Record<string, unknown> = {}) {
  const res = await call(space, "POST", "/v1/budget", { firstPeriod: TODAY.slice(0, 7), ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; version: number; [k: string]: unknown };
}

async function period(space: Space, p: string) {
  const res = await call(space, "GET", `/v1/budget/periods/${p}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

interface Line {
  categoryId: string;
  limit: unknown;
  spent: unknown;
  remaining: unknown;
  mandatory: boolean;
}
const line = (view: { groups: { categories: Line[] }[] }, categoryId: string) =>
  view.groups.flatMap((g) => g.categories).find((c) => c.categoryId === categoryId);

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const budgetAudit = (householdId: string, entity: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3",
    householdId,
    entity,
    action,
  );

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
    [date, currency, uah],
  );
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
        budget: createBudgetServices({
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock,
          newId: randomUUID,
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
  vi.restoreAllMocks();
  now = at(TODAY);
});

describe("BUD-02@PoC: one budget per space", () => {
  it("BUD-02@PoC FR 1: the space's one budget is in its reporting currency; «Почати з нуля» has no limits", async () => {
    const space = await newSpace();
    expect((await call(space, "GET", "/v1/budget")).json()).toEqual({ budget: null });
    const b = await createBudget(space);
    expect(b).toMatchObject({
      currency: "EUR",
      firstPeriod: "2026-11",
      incomePlan: eur("0"),
      limits: [],
      version: 1,
    });
    expect((await call(space, "GET", "/v1/budget")).json().budget).toMatchObject({ id: b.id });
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(1);
  });

  it("BUD-02@PoC EC6: a second budget is refused «Бюджет уже існує» — also when two requests come at once", async () => {
    const space = await newSpace();
    const both = await Promise.all([
      call(space, "POST", "/v1/budget", { firstPeriod: "2026-11" }),
      call(space, "POST", "/v1/budget", { firstPeriod: "2026-12" }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.statusCode === 409)!.json().code).toBe("BUDGET_EXISTS");
    expect(await n("budget.budgets WHERE household_id = $1", space.householdId)).toBe(1);
    const again = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11" });
    expect(again.json().code).toBe("BUDGET_EXISTS");
  });

  it("BUD-02@PoC FR 5 (server part): the first period is the current or the next month; EC5 — before it «Бюджет ще не існував»", async () => {
    const space = await newSpace();
    const bad = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-10" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "body", path: "firstPeriod", issue: "invalid" }]);
    await createBudget(space, { firstPeriod: "2026-12" });
    const before = await call(space, "GET", "/v1/budget/periods/2026-11");
    expect(before.statusCode).toBe(404);
    expect(before.json().code).toBe("BUDGET_PERIOD_BEFORE_START");
    expect((await period(space, "2026-12")).mode).toBe("future");
  });
});

describe("BUD-02@PoC: limits from the current period on", () => {
  it("BUD-02@PoC FR 7: a limit is set, changed and removed; without it the category is «Поза планом»; only active expense categories", async () => {
    const space = await newSpace();
    const cafes = await category(space, "Кафе і ресторани");
    const b = await createBudget(space, {
      incomePlan: eur("3000.00"),
      limits: [{ categoryId: cafes, amount: eur("300.00") }],
    });
    const acc = await account(space);
    await spend(space, acc, "-45.00", "2026-11-03", "Кафе і ресторани");
    expect(line(await period(space, "2026-11"), cafes)).toMatchObject({
      limit: eur("300"),
      spent: eur("45"),
      remaining: eur("255"),
    });
    const changed = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      limits: [{ categoryId: cafes, amount: eur("250.00") }],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().limits).toEqual([{ categoryId: cafes, amount: eur("250") }]);
    const removed = await call(space, "PATCH", "/v1/budget/plan", {
      version: changed.json().version,
      limits: [{ categoryId: cafes, amount: null }],
    });
    expect(removed.json().limits).toEqual([]);
    const view = await period(space, "2026-11");
    expect(view.groups).toEqual([]);
    expect(view.outsidePlan).toEqual({
      categories: [{ categoryId: cafes, spent: eur("45") }],
      total: eur("45"),
    });
    expect(await budgetAudit(space.householdId, "budget.limit", "create")).toBe(1);
    expect(await budgetAudit(space.householdId, "budget.limit", "update")).toBe(1);
    expect(await budgetAudit(space.householdId, "budget.limit", "delete")).toBe(1);
    const invalid = await call(space, "PATCH", "/v1/budget/plan", {
      version: removed.json().version,
      limits: [
        { categoryId: await category(space, "Зарплата"), amount: eur("10.00") },
        { categoryId: await category(space, "Переказ"), amount: eur("10.00") },
        { categoryId: randomUUID(), amount: eur("10.00") },
        { categoryId: cafes, amount: { amount: "10.00", currency: "UAH" } },
      ],
    });
    expect(invalid.json().errors).toEqual([
      { in: "body", path: "limits.0.categoryId", issue: "not_expense" },
      { in: "body", path: "limits.1.categoryId", issue: "not_expense" },
      { in: "body", path: "limits.2.categoryId", issue: "not_found" },
      { in: "body", path: "limits.3.amount.currency", issue: "currency" },
    ]);
  });

  it("BUD-02@PoC AC12 (server part): a limit changed in place acts from the current period; a stale version is «Бюджет змінено в іншому вікні» — also two saves at once", async () => {
    const space = await newSpace();
    const cafes = await category(space, "Кафе і ресторани");
    const b = await createBudget(space, { limits: [{ categoryId: cafes, amount: eur("300.00") }] });
    const both = await Promise.all(
      ["320.00", "340.00"].map((amount) =>
        call(space, "PATCH", "/v1/budget/plan", {
          version: b.version,
          limits: [{ categoryId: cafes, amount: eur(amount) }],
        }),
      ),
    );
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const lost = both.find((r) => r.statusCode === 409)!.json();
    expect(lost).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 2 });
    const won = both.find((r) => r.statusCode === 200)!.json();
    expect((await call(space, "GET", "/v1/budget")).json().budget.limits).toEqual(won.limits);
    expect(await budgetAudit(space.householdId, "budget.limit", "update")).toBe(1);
    expect(line(await period(space, "2026-11"), cafes)!.limit).toEqual(won.limits[0].amount);
  });

  it("BUD-02@PoC AC4: September keeps its snapshot with «Продукти» 600 €; the change to 700 € in October acts on October and later", async () => {
    now = at("2026-09-10");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const b = await createBudget(space, {
      firstPeriod: "2026-09",
      limits: [{ categoryId: groceries, amount: eur("600.00") }],
    });
    const acc = await account(space);
    await spend(space, acc, "-420.00", "2026-09-05", "Продукти");
    now = at("2026-10-02");
    const res = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      limits: [{ categoryId: groceries, amount: eur("700.00") }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const september = await period(space, "2026-09");
    expect(september.mode).toBe("past");
    expect(line(september, groceries)).toMatchObject({
      limit: eur("600"),
      spent: eur("420"),
      mandatory: true,
    });
    expect(line(await period(space, "2026-10"), groceries)!.limit).toEqual(eur("700"));
    expect(line(await period(space, "2026-12"), groceries)).toMatchObject({ limit: eur("700"), spent: null });
    // Later changes never touch the snapshot; spending in the finished period stays live (FR 11).
    now = at(TODAY);
    const later = await call(space, "PATCH", "/v1/budget/plan", {
      version: res.json().version,
      limits: [{ categoryId: groceries, amount: eur("800.00") }],
    });
    expect(later.statusCode).toBe(200);
    const t = await spend(space, acc, "-30.00", "2026-09-20", null);
    await call(space, "PUT", `/v1/transactions/${t}/category`, { categoryId: groceries });
    expect(line(await period(space, "2026-09"), groceries)).toMatchObject({
      limit: eur("600"),
      spent: eur("450"),
    });
    expect(line(await period(space, "2026-10"), groceries)!.limit).toEqual(eur("700"));
    expect(await n("budget.period_snapshots WHERE household_id = $1", space.householdId)).toBe(2);
  });

  it("BUD-02@PoC FR 11: a finished period gets its snapshot on its first view, with the income plan and «обов'язкова»", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-10",
      incomePlan: eur("2500.00"),
      limits: [{ categoryId: groceries, amount: eur("500.00") }],
    });
    now = at(TODAY);
    expect(await n("budget.period_snapshots WHERE household_id = $1", space.householdId)).toBe(0);
    const october = await period(space, "2026-10");
    expect(october).toMatchObject({ mode: "past", incomePlan: eur("2500"), plannedSavings: eur("0") });
    const { rows } = await db.owner.query<{ limits: unknown }>(
      `SELECT limits FROM budget.period_snapshots WHERE household_id = $1 AND period = '2026-10-01'`,
      [space.householdId],
    );
    expect(rows[0]!.limits).toEqual([{ categoryId: groceries, amount: "500", mandatory: true }]);
  });

  it("BUD-02@PoC FR 8, AC16: October's unspent «Одяг» and overspent «Кафе і ресторани» do not carry over — November has the base limits", async () => {
    now = at("2026-10-01");
    const space = await newSpace();
    const clothing = await category(space, "Одяг");
    const cafes = await category(space, "Кафе і ресторани");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [
        { categoryId: clothing, amount: eur("200.00") },
        { categoryId: cafes, amount: eur("300.00") },
      ],
    });
    const acc = await account(space);
    now = at("2026-10-20");
    await spend(space, acc, "-120.00", "2026-10-10", "Одяг");
    await spend(space, acc, "-360.00", "2026-10-12", "Кафе і ресторани");
    now = at(TODAY);
    const october = await period(space, "2026-10");
    expect(line(october, clothing)).toMatchObject({ remaining: eur("80") });
    expect(line(october, cafes)).toMatchObject({ remaining: eur("-60") });
    const november = await period(space, "2026-11");
    expect(line(november, clothing)).toMatchObject({
      limit: eur("200"),
      spent: eur("0"),
      remaining: eur("200"),
    });
    expect(line(november, cafes)).toMatchObject({
      limit: eur("300"),
      spent: eur("0"),
      remaining: eur("300"),
    });
  });
});

describe("BUD-02@PoC: what the period counts", () => {
  it("BUD-02@PoC AC5: «Подорожі» without a limit and 150 € spent is in «Поза планом» and in the period's spending", async () => {
    const space = await newSpace();
    const travel = await category(space, "Подорожі");
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-150.00", "2026-11-04", "Подорожі");
    const view = await period(space, "2026-11");
    expect(view.outsidePlan).toEqual({
      categories: [{ categoryId: travel, spent: eur("150") }],
      total: eur("150"),
    });
  });

  it("BUD-02@PoC FR 12: pending ones count, hidden ones do not; a split one counts by its parts; EC4 — a refund lowers spending", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const household = await category(space, "Побутова хімія");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("600.00") }] });
    const acc = await account(space);
    await spend(space, acc, "-100.00", "2026-11-02", "Продукти", { status: "pending" });
    const hidden = await spend(space, acc, "-70.00", "2026-11-03", "Продукти");
    // Hidden (FIN-03 FR 16–18: in this release only a duplicate is hidden, set here directly).
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, hidden],
    );
    await spend(space, acc, "25.00", "2026-11-05", "Продукти");
    const split = await spend(space, acc, "-186.00", "2026-11-06", null);
    const res = await call(space, "POST", `/v1/transactions/${split}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries, amount: "-150.00" },
        { categoryId: household, amount: "-36.00" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    await spend(space, acc, "-50.00", "2026-10-30", "Продукти");
    const view = await period(space, "2026-11");
    expect(line(view, groceries)).toMatchObject({ spent: eur("225"), remaining: eur("375") });
    expect(view.outsidePlan.categories).toEqual([{ categoryId: household, spent: eur("36") }]);
  });

  it("BUD-02@PoC FR 9, FR 12: a split part of a category merged into another counts in the target (lead decision: merged into the target)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const tree = (await call(space, "GET", "/v1/categories")).json() as {
      groups: { id: string; categories: { id: string }[] }[];
    };
    const groupId = tree.groups.find((g) => g.categories.some((c) => c.id === groceries))!.id;
    const added = await call(space, "POST", "/v1/categories", { groupId, name: "Синтетична кава" });
    expect(added.statusCode, added.body).toBe(201);
    const coffee = added.json().id as string;
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("600.00") }] });
    const acc = await account(space);
    const split = await spend(space, acc, "-186.00", "2026-11-06", null);
    const parts = await call(space, "POST", `/v1/transactions/${split}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries, amount: "-136.00" },
        { categoryId: coffee, amount: "-50.00" },
      ],
    });
    expect(parts.statusCode, parts.body).toBe(200);
    const merged = await call(space, "POST", `/v1/categories/${coffee}/merge`, { targetId: groceries });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json().sourceState).toBe("retired");
    await runWorker(space.householdId);
    const view = await period(space, "2026-11");
    // 136 + 50: all of it in «Продукти»; nothing «Без категорії» in «Поза планом».
    expect(line(view, groceries)).toMatchObject({ spent: eur("186"), remaining: eur("414") });
    expect(view.outsidePlan).toEqual({ categories: [], total: eur("0") });
  });

  it("BUD-02@PoC AC3: 2 000 грн in a EUR budget without the date's rate counts at the nearest 40,00 — 50,00 € «приблизно»; with the date's rate it is exact", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("600.00") }] });
    await rate("2025-12-31", "EUR", "45.00");
    const uah = await account(space, "current", "UAH");
    await spend(space, uah, "-2000.00", "2026-11-10", "Продукти", { currency: "UAH" });
    await rate("2026-11-09", "EUR", "40.00");
    const approximate = await period(space, "2026-11");
    expect(line(approximate, groceries)!.spent).toEqual(eur("50"));
    expect(approximate.approximate).toEqual({ nearestRateCount: 1, unavailableCount: 0 });
    await rate("2026-11-10", "EUR", "50.00");
    const exact = await period(space, "2026-11");
    expect(line(exact, groceries)!.spent).toEqual(eur("40"));
    expect(exact.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
  });

  it("BUD-02@PoC FR 10, AC2: «Рахунки бюджету» — current accounts in, savings out by default; a company account switched off leaves the budget but stays in the list", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("600.00") }] });
    const daily = await account(space);
    const company = await account(space);
    const savings = await account(space, "savings");
    const list = (await call(space, "GET", "/v1/budget/accounts")).json().accounts as {
      accountId: string;
      included: boolean;
    }[];
    expect(Object.fromEntries(list.map((a) => [a.accountId, a.included]))).toEqual({
      [daily]: true,
      [company]: true,
      [savings]: false,
    });
    await spend(space, daily, "-10.00", "2026-11-02", "Продукти");
    const theirs = await spend(space, company, "-500.00", "2026-11-02", "Продукти");
    const off = await call(space, "PUT", `/v1/budget/accounts/${company}`, { included: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ accountId: company, included: false });
    expect(line(await period(space, "2026-11"), groceries)!.spent).toEqual(eur("10"));
    expect((await call(space, "GET", `/v1/transactions/${theirs}`)).statusCode).toBe(200);
    expect(await budgetAudit(space.householdId, "budget.account", "update")).toBe(1);
    // Back on: the default again, no row kept.
    await call(space, "PUT", `/v1/budget/accounts/${company}`, { included: true });
    expect(await n("budget.budget_accounts WHERE household_id = $1", space.householdId)).toBe(0);
    expect(line(await period(space, "2026-11"), groceries)!.spent).toEqual(eur("510"));
  });
});

describe("BUD-02@PoC: deletion, the space's boundary, audit", () => {
  it("BUD-02@PoC FR 10, FR 13: two simultaneous switches of one account write one change; two simultaneous deletes delete once", async () => {
    const space = await newSpace();
    await createBudget(space);
    const company = await account(space);
    const switches = await Promise.all([
      call(space, "PUT", `/v1/budget/accounts/${company}`, { included: false }),
      call(space, "PUT", `/v1/budget/accounts/${company}`, { included: false }),
    ]);
    expect(switches.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await n("budget.budget_accounts WHERE household_id = $1", space.householdId)).toBe(1);
    expect(
      await n(
        "budget.jobs WHERE household_id = $1 AND payload->>'entity' = 'budget.account'",
        space.householdId,
      ),
    ).toBe(1);
    const deletes = await Promise.all([
      call(space, "DELETE", "/v1/budget"),
      call(space, "DELETE", "/v1/budget"),
    ]);
    expect(deletes.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(
      await n("budget.jobs WHERE household_id = $1 AND payload->>'action' = 'delete'", space.householdId),
    ).toBe(1);
  });

  it("BUD-02@PoC FR 13, AC13 (server part): «Видалити бюджет» takes the limits, account choices and snapshots; AC14 — the Owner does it", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: groceries, amount: eur("500.00") }],
    });
    const acc = await account(space, "savings");
    now = at(TODAY);
    await call(space, "PUT", `/v1/budget/accounts/${acc}`, { included: true });
    expect(await n("budget.period_snapshots WHERE household_id = $1", space.householdId)).toBe(1);
    const res = await call(space, "DELETE", "/v1/budget");
    expect(res.json()).toEqual({ deleted: true });
    for (const table of ["budgets", "limits", "budget_accounts", "period_snapshots"])
      expect(await n(`budget.${table} WHERE household_id = $1`, space.householdId), table).toBe(0);
    expect((await call(space, "GET", "/v1/budget")).json()).toEqual({ budget: null });
    expect(await budgetAudit(space.householdId, "budget.budget", "delete")).toBe(1);
    expect(await budgetAudit(space.householdId, "budget.limit", "delete")).toBe(1);
    expect((await call(space, "DELETE", "/v1/budget")).statusCode).toBe(404);
  });

  it("BUD-02@PoC «Права доступу»: another space sees no budget — no records or sums; a scoped member gets «not found» on reads and 403 on changes", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const acc = await account(owner);
    await createBudget(owner, { incomePlan: eur("4321.00") });
    expect((await call(stranger, "GET", "/v1/budget")).json()).toEqual({ budget: null });
    for (const [method, url, body] of [
      ["GET", "/v1/budget/periods/2026-11", undefined],
      ["GET", "/v1/budget/accounts", undefined],
      ["PUT", `/v1/budget/accounts/${acc}`, { included: false }],
      ["PATCH", "/v1/budget/plan", { version: 1, incomePlan: eur("1.00") }],
      ["DELETE", "/v1/budget", undefined],
    ] as const) {
      const res = await call(stranger, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.body).not.toContain("4321");
    }
    expect(
      (await call(owner, "GET", "/v1/budget", undefined, { role: "viewer", scoped: true })).statusCode,
    ).toBe(404);
    expect(
      (await call(owner, "PATCH", "/v1/budget/plan", { version: 1 }, { role: "viewer", scoped: true }))
        .statusCode,
    ).toBe(403);
    expect(await n("budget.budgets WHERE household_id = $1", stranger.householdId)).toBe(0);
  });

  it("BUD-01@PoC FR 12: a category with a limit is in use for module categories", async () => {
    const space = await newSpace();
    const cafes = await category(space, "Кафе і ресторани");
    const travel = await category(space, "Подорожі");
    await createBudget(space, { limits: [{ categoryId: cafes, amount: eur("300.00") }] });
    const used = await createBudgetCategoryUsage(db.databases.for("budget")).used(space.householdId, [
      cafes,
      travel,
    ]);
    expect([...used]).toEqual([cafes]);
  });

  it("ARC-04@PoC FR 4: a budget audit job in state dead goes back to the budget queue with the daily recovery", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "budget.budget") throw new Error("injected");
      return original(householdId, entry);
    });
    await createBudget(space);
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "budget.hand_off_deferred")).toBe(true);
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE budget.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    await runWorker(space.householdId);
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("budget.hand-off-recovery")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("budget.hand-off-recovery")).toBeLessThan(names.indexOf("queue.retention-cleanup"));
    await tasks.find((t) => t.name === "budget.hand-off-recovery")!.run();
    expect(telemetry.memory.logRecords().some((r) => r.body === "budget.hand_off_requeued")).toBe(true);
    await runWorker(space.householdId);
    expect(await n("budget.jobs WHERE household_id = $1 AND state = 'done'", space.householdId)).toBe(1);
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(1);
    await tasks.find((t) => t.name === "budget.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes its budget, snapshots and queue rows", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: groceries, amount: eur("500.00") }],
    });
    now = at(TODAY);
    await period(space, "2026-10");
    const erased = await createBudgetErasure(db.databases.for("budget")).eraseHousehold(space.householdId);
    expect(erased).toEqual({ budgets: 1, snapshots: 1, jobs: 2 });
    for (const table of ["budgets", "limits", "period_snapshots", "jobs"])
      expect(await n(`budget.${table} WHERE household_id = $1`, space.householdId), table).toBe(0);
  });
});
