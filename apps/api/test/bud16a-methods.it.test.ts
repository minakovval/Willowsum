import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createBudgetCategoryUsage, createBudgetServices } from "../src/modules/budget/index.ts";
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
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-16@PoC a) (wave 2 row 32), the server part of the method «Ліміти»: «План місяця» for history, trend and «факт /
 * план» is the sum of the month's limits (a finished month — its snapshot's), no method, no history of methods, no
 * marks of a change; facts only. Through the real API on a real PostgreSQL with the real categories, accounts,
 * transactions, categorization and fx-rates modules. Every name and amount is synthetic; the clock is the test's own.
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
/** Release flags switched off for the space while a test runs. */
const flagsOff = new Set<string>();

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
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabled: async (_h: string, flag: string) => !flagsOff.has(flag) },
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
        budget: createBudgetServices({
          planEnabled: async () => true,
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

async function trend(space: Space, query: string) {
  const res = await call(space, "GET", `/v1/budget/trend?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    currency: string;
    months: { period: string; mode: string; plan: unknown; spent: unknown; income: unknown }[];
    approximate: { nearestRateCount: number; unavailableCount: number };
  };
}
const month = (view: Awaited<ReturnType<typeof trend>>, p: string) => view.months.find((m) => m.period === p);

/** Every key of a JSON value, nested. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsOf);
}
/** The keys of the method's other releases (PoC v2): none of them is in this release's answers. */
const OTHER_METHODS =
  /^(?:method\w*|\w*Method\w*|\w*[hH]istory\w*|assigned|available|toAssign|moneyAge|monthAhead|moves?|cover\w*|flex\w*|target\w*|marks?)$/;

describe("BUD-16@PoC: the method «Ліміти»", () => {
  it("BUD-16@PoC AC1 (server part): November's limits are 4 800 € — the trend's plan line for November is 4 800 €, with no method and no marks of a change", async () => {
    const space = await newSpace();
    const [groceries, cafes, transport] = [
      await category(space, "Продукти"),
      await category(space, "Кафе і ресторани"),
      await category(space, "Транспорт"),
    ];
    await createBudget(space, {
      incomePlan: eur("6000.00"),
      limits: [
        { categoryId: groceries, amount: eur("2600.00") },
        { categoryId: cafes, amount: eur("1400.00") },
        { categoryId: transport, amount: eur("800.00") },
      ],
    });
    const acc = await account(space);
    await spend(space, acc, "-420.00", "2026-11-03", "Продукти");
    await spend(space, acc, "-150.00", "2026-11-04", "Подорожі");
    await spend(space, acc, "-30.00", "2026-11-05", null);
    await spend(space, acc, "3000.00", "2026-11-06", "Зарплата");
    await spend(space, acc, "-99.00", "2026-10-20", "Продукти");
    const view = await trend(space, "from=2026-10&to=2026-12");
    expect(view.currency).toBe("EUR");
    expect(view.months.map((m) => m.period)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(month(view, "2026-11")).toEqual({
      period: "2026-11",
      mode: "current",
      plan: eur("4800"),
      spent: eur("600"),
      income: eur("3000"),
    });
    // October is before the budget: its spending, no plan line.
    expect(month(view, "2026-10")).toMatchObject({ mode: "past", plan: null, spent: eur("99") });
    // A future month: the plan only.
    expect(month(view, "2026-12")).toEqual({
      period: "2026-12",
      mode: "future",
      plan: eur("4800"),
      spent: null,
      income: null,
    });
    // FR 4: no «Історія методів», no marks of a change of method — and the budget has no method to show (FR 1).
    expect(keysOf(view).filter((k) => OTHER_METHODS.test(k))).toEqual([]);
    const budget = (await call(space, "GET", "/v1/budget")).json();
    expect(keysOf(budget).filter((k) => OTHER_METHODS.test(k))).toEqual([]);
    const period = (await call(space, "GET", "/v1/budget/periods/2026-11")).json();
    // FR 3 (server part): no «Призначено», «Доступно», «Гроші до розподілу», «Вік грошей», «На місяць уперед».
    expect(keysOf(period).filter((k) => OTHER_METHODS.test(k))).toEqual([]);
  });

  it("BUD-16@PoC FR 1 (server part): the method is neither chosen nor changed — there is no route for it", async () => {
    const space = await newSpace();
    await createBudget(space);
    for (const [method, url] of [
      ["GET", "/v1/budget/method"],
      ["PUT", "/v1/budget/method"],
      ["POST", "/v1/budget/moves"],
    ] as const) {
      const res = await call(space, method, url, method === "GET" ? undefined : { method: "flex" });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const patch = await call(space, "PATCH", "/v1/budget/plan", { version: 1, method: "flex" });
    expect(patch.statusCode).toBe(400);
  });

  it("BUD-16@PoC FR 4: a finished month's plan is its snapshot's limits; a change acts on the current and later months (FR 2: no carry-over)", async () => {
    now = at("2026-09-10");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    const b = await createBudget(space, {
      firstPeriod: "2026-09",
      limits: [
        { categoryId: groceries, amount: eur("600.00") },
        { categoryId: cafes, amount: eur("200.00") },
      ],
    });
    const acc = await account(space);
    await spend(space, acc, "-350.00", "2026-09-08", "Кафе і ресторани");
    now = at("2026-10-02");
    const oct = await call(space, "PATCH", "/v1/budget/plan", {
      version: b.version,
      limits: [{ categoryId: groceries, amount: eur("700.00") }],
    });
    expect(oct.statusCode, oct.body).toBe(200);
    now = at(TODAY);
    const nov = await call(space, "PATCH", "/v1/budget/plan", {
      version: oct.json().version,
      limits: [{ categoryId: cafes, amount: null }],
    });
    expect(nov.statusCode, nov.body).toBe(200);
    const view = await trend(space, "from=2026-09&to=2026-11");
    expect(view.months.map((m) => m.plan)).toEqual([eur("800"), eur("900"), eur("700")]);
    // Filtered by a category: its limit; none that month — no plan line («Поза планом»).
    const byCafes = await trend(space, `from=2026-09&to=2026-11&categoryId=${cafes}`);
    expect(byCafes.months.map((m) => [m.plan, m.spent])).toEqual([
      [eur("200"), eur("350")],
      [eur("200"), eur("0")],
      [null, eur("0")],
    ]);
  });

  it("BUD-16@PoC FR 4: two trend reads at once snapshot each finished month once and answer the same plan", async () => {
    now = at("2026-07-03");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-07",
      limits: [{ categoryId: groceries, amount: eur("500.00") }],
    });
    now = at(TODAY);
    const both = await Promise.all([
      call(space, "GET", "/v1/budget/trend?from=2026-06&to=2026-11"),
      call(space, "GET", "/v1/budget/trend?from=2026-06&to=2026-11"),
    ]);
    for (const r of both) expect(r.statusCode, r.body).toBe(200);
    expect(both[0]!.json()).toEqual(both[1]!.json());
    expect(both[0]!.json().months.map((m: { plan: unknown }) => m.plan)).toEqual([
      null,
      eur("500"),
      eur("500"),
      eur("500"),
      eur("500"),
      eur("500"),
    ]);
    expect(await n("budget.period_snapshots WHERE household_id = $1", space.householdId)).toBe(4);
  });

  it("BUD-16@PoC FR 5: the trend answers facts only — periods, modes, a currency, amounts and counts; no text, no advice", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("100.00") }] });
    const acc = await account(space);
    await spend(space, acc, "-180.00", "2026-11-03", "Продукти");
    const view = await trend(space, "from=2026-08&to=2027-01");
    const facts = /^(?:\d{4}-\d{2}|past|current|future|EUR|-?\d+(?:\.\d+)?)$/;
    expect(stringsOf(view).filter((s) => !facts.test(s))).toEqual([]);
    expect([...new Set(keysOf(view))].sort()).toEqual(
      [
        "amount",
        "approximate",
        "currency",
        "income",
        "mode",
        "months",
        "nearestRateCount",
        "period",
        "plan",
        "spent",
        "unavailableCount",
      ].sort(),
    );
  });

  it("BUD-16@PoC FR 4: the months are checked — `to` before `from`, over 120 months, a category not of this space's expenses", async () => {
    const space = await newSpace();
    await createBudget(space);
    const issue = async (query: string) => {
      const res = await call(space, "GET", `/v1/budget/trend?${query}`);
      expect(res.statusCode, res.body).toBe(400);
      return res.json().errors.map((e: { path: string; issue: string }) => `${e.path}: ${e.issue}`);
    };
    expect(await issue("from=2026-11&to=2026-10")).toEqual(["to: invalid"]);
    expect(await issue("from=2016-11&to=2026-11")).toEqual(["from: too_many_months"]);
    expect(await issue("from=2026-1&to=2026-11")).toEqual(["from: invalid"]);
    expect(await issue(`from=2026-10&to=2026-11&categoryId=${randomUUID()}`)).toEqual([
      "categoryId: not_found",
    ]);
    const salary = await category(space, "Зарплата");
    expect(await issue(`from=2026-10&to=2026-11&categoryId=${salary}`)).toEqual(["categoryId: not_expense"]);
    const other = await newSpace();
    const theirs = await category(other, "Продукти");
    expect(await issue(`from=2026-10&to=2026-11&categoryId=${theirs}`)).toEqual(["categoryId: not_found"]);
  });

  it("BUD-16@PoC «Права доступу»: another space sees none of the plan or sums; a scoped member — not found; the flag off — not found", async () => {
    const owner = await newSpace();
    const groceries = await category(owner, "Продукти");
    await createBudget(owner, { limits: [{ categoryId: groceries, amount: eur("4321.00") }] });
    const acc = await account(owner);
    await spend(owner, acc, "-1234.00", "2026-11-03", "Продукти");
    const other = await newSpace();
    const theirs = await call(other, "GET", "/v1/budget/trend?from=2026-11&to=2026-11");
    expect(theirs.statusCode).toBe(404);
    expect(leakText(theirs.body)).not.toContain("4321");
    await createBudget(other);
    const own = await trend(other, "from=2026-11&to=2026-11");
    expect(own.months[0]).toMatchObject({ plan: eur("0"), spent: eur("0") });
    const scoped = await call(owner, "GET", "/v1/budget/trend?from=2026-11&to=2026-11", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(scoped.json().code).toBe("NOT_FOUND");
    expect(leakText(scoped.body)).not.toContain("4321");
    flagsOff.add("budget.trend");
    try {
      const off = await call(owner, "GET", "/v1/budget/trend?from=2026-11&to=2026-11");
      expect(off.statusCode).toBe(404);
      expect(leakText(off.body)).not.toContain("4321");
      // The budget itself stays under its own flag.
      expect((await call(owner, "GET", "/v1/budget")).statusCode).toBe(200);
    } finally {
      flagsOff.delete("budget.trend");
    }
  });

  it("BUD-16@PoC FR 4: a 20-digit expense is left out of the month's spending (counted in `unavailableCount`), never 500; other months still count", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("500.00") }] });
    const acc = await account(space);
    await spend(space, acc, "-" + "9".repeat(20), "2026-11-03", "Продукти");
    await spend(space, acc, "-45.00", "2026-11-05", "Продукти");
    await spend(space, acc, "-" + "9".repeat(18), "2026-10-03", "Продукти");
    await spend(space, acc, "-" + "9".repeat(18), "2026-10-04", "Продукти");
    await spend(space, acc, "-12.00", "2026-09-04", "Продукти");
    const res = await call(space, "GET", "/v1/budget/trend?from=2026-09&to=2026-11");
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json();
    expect(view.months.map((m: { spent: unknown }) => m.spent)).toEqual([eur("12"), eur("0"), eur("45")]);
    expect(view.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 3 });
  });

  // ---- #603: tests for the mutants of the security review of #600 that survived ----

  it("BUD-16@PoC FR 4 (#603): an account switched out of the budget counts in no month of the trend — as in the period", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("500.00") }] });
    const inBudget = await account(space);
    const out = await account(space, "cash");
    const off = await call(space, "PUT", `/v1/budget/accounts/${out}`, { included: false });
    expect(off.statusCode, off.body).toBe(200);
    await spend(space, inBudget, "-45.00", "2026-11-03", "Продукти");
    await spend(space, out, "-7777.00", "2026-11-04", "Продукти");
    await spend(space, out, "-6666.00", "2026-10-04", null);
    await spend(space, out, "8888.00", "2026-11-05", "Зарплата");
    const res = await call(space, "GET", "/v1/budget/trend?from=2026-10&to=2026-11");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().months.map((m: { spent: unknown; income: unknown }) => [m.spent, m.income])).toEqual([
      [eur("0"), eur("0")],
      [eur("45"), eur("0")],
    ]);
    for (const amount of ["7777", "6666", "8888"]) expect(leakText(res.body)).not.toContain(amount);
    const byCategory = await trend(space, `from=2026-11&to=2026-11&categoryId=${groceries}`);
    expect(byCategory.months[0]!.spent).toEqual(eur("45"));
  });

  it("BUD-16@PoC FR 4 (#603): a proportional first period counts spending and income from its first day only (BUD-02 FR 14)", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      proportional: true,
      limits: [{ categoryId: groceries, amount: eur("600.00") }],
    });
    await spend(space, acc, "-80.00", "2026-11-10", "Продукти");
    await spend(space, acc, "-45.00", "2026-11-18", "Продукти");
    await spend(space, acc, "1000.00", "2026-11-05", "Зарплата");
    const view = await trend(space, "from=2026-11&to=2026-11");
    const period = (await call(space, "GET", "/v1/budget/periods/2026-11")).json();
    expect(view.months[0]).toMatchObject({ spent: eur("45"), income: eur("0"), plan: eur("260") });
    expect(view.months[0]!.spent).toEqual(period.totals.spent);
  });

  it("BUD-16@PoC FR 4 (#603): a category merged away (out of use) is no filter of the trend — 400 not_found", async () => {
    const space = await newSpace();
    await createBudget(space);
    const tree = (await call(space, "GET", "/v1/categories")).json().groups as {
      id: string;
      categories: { id: string; name: string }[];
    }[];
    const group = tree.find((g) => g.categories.some((c) => c.name === "Продукти"))!;
    const made = await call(space, "POST", "/v1/categories", { groupId: group.id, name: "Синтетична зайва" });
    expect(made.statusCode, made.body).toBe(201);
    const merged = await call(space, "POST", `/v1/categories/${made.json().id}/merge`, {
      targetId: await category(space, "Продукти"),
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json().sourceState).toBe("retired");
    const res = await call(
      space,
      "GET",
      `/v1/budget/trend?from=2026-11&to=2026-11&categoryId=${made.json().id}`,
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors).toEqual([{ in: "query", path: "categoryId", issue: "not_found" }]);
  });
});
