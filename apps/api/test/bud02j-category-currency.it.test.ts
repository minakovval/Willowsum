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
import {
  createBudgetCategoryUsage,
  createBudgetServices,
  type BudgetServices,
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
 * BUD-02@PoC FR 1, FR 24, AC21 («Валюта категорії»; owner decision 2026-11-26, Q3 а; wave 2 row 223), BUD-03@PoC and
 * BUD-17@PoC business rules — the server part, through the real API on a real PostgreSQL with the real categories,
 * accounts, transactions, categorization and fx-rates modules: a limit and an income category's plan in their own
 * currency, the line in it, the totals in the budget's at today's rate with the rate exposed for «≈», a finished period
 * at its last day's rate kept in the snapshot, «Можна витратити» and «План». Every name and amount is synthetic; the
 * clock is the test's own (Kyiv); 1 € = 50,00 UAH.
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

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

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
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices)],
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

afterEach(() => {
  vi.restoreAllMocks();
  now = at(TODAY);
});

const uah = (amount: string) => ({ amount, currency: "UAH" });

/** «Нова категорія…»: a custom category in the group of that name (as in «Налаштування → Категорії»). */
async function newCategory(space: Space, group: string, name: string): Promise<string> {
  const tree = await call(space, "GET", "/v1/categories");
  const groupId = (tree.json().groups as { id: string; name: string }[]).find((g) => g.name === group)!.id;
  const res = await call(space, "POST", "/v1/categories", { groupId, name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** 1 € = 50,00 UAH from 1 October on (the NBU rate; UAH → EUR 0.02). */
async function rates() {
  for (const date of ["2026-10-01", "2026-11-01", "2026-11-17"]) await rate(date, "EUR", "50.00");
}

const patch = (space: Space, body: Record<string, unknown>) => call(space, "PATCH", "/v1/budget/plan", body);

const UAH_TODAY = { currency: "UAH", rate: "0.02", date: "2026-11-17" };

describe("BUD-02@PoC FR 24: the currency of a category", () => {
  it("BUD-02@PoC AC21: «Гуртки дітей» 2 000 UAH spent 800,00 UAH — the line in UAH, the total of limits ≈ 1 040,00 € with the rate; a new category without a currency gets EUR", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    const b = await createBudget(space, {
      limits: [
        { categoryId: clubs, amount: uah("2000") },
        { categoryId: groceries, amount: eur("700") },
        { categoryId: cafes, amount: eur("300") },
      ],
    });
    expect(b.limits).toEqual(
      expect.arrayContaining([
        { categoryId: clubs, amount: uah("2000") },
        { categoryId: groceries, amount: eur("700") },
        { categoryId: cafes, amount: eur("300") },
      ]),
    );
    expect(b.rates).toEqual([UAH_TODAY]);
    const card = await account(space, "current", "UAH");
    await spend(space, card, "-800.00", "2026-11-05", "Гуртки дітей", { currency: "UAH" });
    const view = await period(space, "2026-11");
    expect(line(view, clubs)).toEqual({
      categoryId: clubs,
      groupId: expect.any(String),
      mandatory: false,
      limit: uah("2000"),
      spent: uah("800"),
      remaining: uah("1200"),
      inBudgetCurrency: { limit: eur("40"), spent: eur("16"), remaining: eur("24") },
    });
    expect(line(view, groceries)).toMatchObject({ limit: eur("700"), inBudgetCurrency: null });
    expect(view.totals).toEqual({ limits: eur("1040"), spent: eur("16"), remaining: eur("1024") });
    // «≈ 1 040,00 €»: the hint names the rate 1 € = 50,00 UAH (UAH → EUR 0.02) and its date.
    expect(view.rates).toEqual([UAH_TODAY]);
    // A new category without a choice of currency — in the budget's (the page sends the budget's currency).
    const travel = await category(space, "Подорожі");
    const added = await patch(space, {
      version: b.version,
      limits: [{ categoryId: travel, amount: eur("100") }],
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(
      (added.json().limits as { categoryId: string; amount: unknown }[]).find((l) => l.categoryId === travel),
    ).toEqual({ categoryId: travel, amount: eur("100") });
  });

  it("BUD-02@PoC FR 1: limits and income plans are in the budget's currency by default — no rates, no «≈»", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const b = await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("500") }] });
    expect(b).toMatchObject({
      currency: "EUR",
      limits: [{ categoryId: groceries, amount: eur("500") }],
      rates: [],
    });
    const view = await period(space, "2026-11");
    expect(view.rates).toEqual([]);
    expect(line(view, groceries)).toMatchObject({ limit: eur("500"), inBudgetCurrency: null });
  });

  it("BUD-02@PoC FR 24: the currency is changed from the current period on and audited; a currency without a rate is refused; two changes at once — one wins", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const b = await createBudget(space, { limits: [{ categoryId: clubs, amount: eur("40") }] });
    const both = await Promise.all(
      ["2000", "2500"].map((amount) =>
        patch(space, { version: b.version, limits: [{ categoryId: clubs, amount: uah(amount) }] }),
      ),
    );
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const won = both.find((r) => r.statusCode === 200)!.json();
    expect(won.limits).toEqual([{ categoryId: clubs, amount: expect.objectContaining({ currency: "UAH" }) }]);
    const { rows } = await db.owner.query<{ changes: { field: string; before: string; after: string }[] }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'budget.limit' AND action = 'update'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toContainEqual(
      expect.objectContaining({ field: "currency", before: "EUR", after: "UAH" }),
    );
    const refused = await patch(space, {
      version: won.version,
      limits: [{ categoryId: clubs, amount: { amount: "10", currency: "SEK" } }],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errors).toEqual([
      { in: "body", path: "limits.0.amount.currency", issue: "currency" },
    ]);
  });

  it("BUD-02@PoC FR 24: an income category's plan in UAH — «Дохід» shows plan and fact in UAH, the income plan ≈ in EUR", async () => {
    await rates();
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const b = await createBudget(space, { incomePlans: [{ categoryId: salary, amount: uah("50000") }] });
    expect(b.incomePlan).toEqual(eur("1000"));
    expect(b.incomePlans).toEqual([{ categoryId: salary, amount: uah("50000") }]);
    const card = await account(space, "current", "UAH");
    await spend(space, card, "30000.00", "2026-11-10", "Зарплата", { currency: "UAH" });
    const view = await period(space, "2026-11");
    expect(view.incomePlan).toEqual(eur("1000"));
    expect(view.incomeCategories).toEqual([
      {
        categoryId: salary,
        plan: uah("50000"),
        actual: uah("30000"),
        inBudgetCurrency: { plan: eur("1000"), actual: eur("600") },
      },
    ]);
    expect(view.rates).toEqual([UAH_TODAY]);
  });

  it("BUD-02@PoC FR 24, FR 11: a finished period converts at its last day's rate and keeps it and each line's currency in the snapshot", async () => {
    await rates();
    await rate("2026-10-31", "EUR", "40.00");
    now = at("2026-10-20");
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: clubs, amount: uah("2000") }],
    });
    now = at(TODAY);
    const october = await period(space, "2026-10");
    expect(october.mode).toBe("past");
    expect(line(october, clubs)).toMatchObject({
      limit: uah("2000"),
      inBudgetCurrency: { limit: eur("50") },
    });
    expect(october.rates).toEqual([{ currency: "UAH", rate: "0.025", date: "2026-10-31" }]);
    const { rows } = await db.owner.query<{ rates: unknown; limits: unknown }>(
      `SELECT rates, limits FROM budget.period_snapshots WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([
      {
        rates: [{ currency: "UAH", rate: "0.025", date: "2026-10-31", source: "NBU" }],
        limits: [
          {
            categoryId: clubs,
            amount: "50",
            mandatory: false,
            original: { amount: "2000", currency: "UAH" },
          },
        ],
      },
    ]);
    // The current period — today's rate.
    expect(line(await period(space, "2026-11"), clubs)).toMatchObject({
      inBudgetCurrency: { limit: eur("40") },
    });
  });
});

describe("BUD-02@PoC FR 24, FR 11: a snapshot written without a rate (lead decision 2026-11-26, #709)", () => {
  it("BUD-02@PoC FR 24: a finished period whose line had no rate keeps its own amount and takes the first rate that appears after — for good", async () => {
    await rates();
    // CHF has a rate when the budget is made, none on the period's last day or before (the history is lost, then back).
    await rate("2026-10-20", "EUR", "50.00");
    await rate("2026-10-20", "CHF", "55.00");
    now = at("2026-10-20");
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: clubs, amount: { amount: "100", currency: "CHF" } }],
    });
    await db.owner.query(`DELETE FROM fx_rates.rates WHERE currency = 'CHF'`);
    now = at(TODAY);
    const missing = await period(space, "2026-10");
    expect(missing.rates).toEqual([{ currency: "CHF", rate: null, date: null }]);
    expect(line(missing, clubs)).toMatchObject({
      limit: { amount: "100", currency: "CHF" },
      inBudgetCurrency: { limit: eur("0") },
    });
    const stored = await db.owner.query<{ limits: unknown }>(
      `SELECT limits FROM budget.period_snapshots WHERE household_id = $1`,
      [space.householdId],
    );
    expect(stored.rows[0]!.limits).toEqual([
      { categoryId: clubs, amount: "0", mandatory: false, original: { amount: "100", currency: "CHF" } },
    ]);
    // The first rate that appears after the snapshot (1 CHF = 55 UAH, 1 € = 50 UAH: 1.1 €) converts the line…
    await rate("2026-11-10", "EUR", "50.00");
    await rate("2026-11-10", "CHF", "55.00");
    const resolved = await period(space, "2026-10");
    expect(line(resolved, clubs)).toMatchObject({ inBudgetCurrency: { limit: eur("110") } });
    expect(resolved.rates).toEqual([{ currency: "CHF", rate: "1.1", date: "2026-11-10" }]);
    expect(resolved.totals.limits).toEqual(eur("110"));
    // …and stays in the snapshot: a later rate changes nothing.
    await rate("2026-11-17", "CHF", "60.00");
    expect(await period(space, "2026-10")).toEqual(resolved);
    const { rows } = await db.owner.query<{ rates: unknown }>(
      `SELECT rates FROM budget.period_snapshots WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([{ rates: [{ currency: "CHF", rate: "1.1", date: "2026-11-10", source: "NBU" }] }]);
    await db.owner.query(`DELETE FROM fx_rates.rates WHERE currency = 'CHF'`);
  });
});

describe("BUD-03@PoC and BUD-17@PoC: a category's currency in «Можна витратити» and «План»", () => {
  it("BUD-03@PoC business rules: «Можна витратити» counts a UAH limit at today's rate and names the rate for «≈»", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    await createBudget(space, { limits: [{ categoryId: clubs, amount: uah("2000") }] });
    const res = await call(space, "GET", "/v1/budget/periods/2026-11/spendable");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rates).toEqual([UAH_TODAY]);
  });

  it("BUD-17@PoC business rules: the cell of a UAH category is in UAH; «Витрати» is summed in EUR at today's rate with the rate; a cell in another currency is refused", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      limits: [
        { categoryId: clubs, amount: uah("2000") },
        { categoryId: groceries, amount: eur("700") },
      ],
    });
    const grid = async () => {
      const res = await call(space, "GET", "/v1/budget/plan-grid");
      expect(res.statusCode, res.body).toBe(200);
      return res.json();
    };
    const cellsOf = (g: {
      expenses: { groups: { categories: { categoryId: string; cells: { amount: unknown }[] }[] }[] };
    }) => g.expenses.groups.flatMap((x) => x.categories).find((c) => c.categoryId === clubs)!.cells;
    const before = await grid();
    expect(cellsOf(before)[0]!.amount).toEqual(uah("2000"));
    expect(before.expenses.totals[0]).toEqual(eur("740"));
    expect(before.rates).toEqual([UAH_TODAY]);
    const set = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
      period: "2026-12",
      kind: "limit",
      lineId: clubs,
      amount: uah("2500"),
      version: 0,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().amount).toEqual(uah("2500"));
    const after = await grid();
    expect(cellsOf(after)[1]!.amount).toEqual(uah("2500"));
    expect(after.expenses.totals[1]).toEqual(eur("750"));
    expect(line(await period(space, "2026-12"), clubs)).toMatchObject({
      limit: uah("2500"),
      inBudgetCurrency: { limit: eur("50") },
    });
    const wrong = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
      period: "2026-12",
      kind: "limit",
      lineId: clubs,
      amount: eur("60"),
      version: 1,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().errors).toEqual([{ in: "body", path: "amount.currency", issue: "currency" }]);
  });

  it("BUD-17@PoC business rules: «План доходу» of the grid converts a UAH income plan at today's rate, as «Бюджет», and names the rate", async () => {
    await rates();
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const b = await createBudget(space, { incomePlans: [{ categoryId: salary, amount: uah("50000") }] });
    expect(b.incomePlan).toEqual(eur("1000"));
    // Today's rate moves after the plan was saved: every read converts at its own rate.
    await rate("2026-11-18", "EUR", "40.00");
    expect((await period(space, "2026-11")).incomePlan).toEqual(eur("1250"));
    const res = await call(space, "GET", "/v1/budget/plan-grid");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().income.totals[0]).toEqual(eur("1250"));
    expect(res.json().rates).toEqual([{ currency: "UAH", rate: "0.025", date: "2026-11-18" }]);
  });

  it("BUD-17@PoC FR 1, business rules (row 231): the row of a UAH income category is in UAH — its cell saved in UAH, the section's sum in EUR at today's rate; a cell in EUR is refused", async () => {
    await rates();
    // Today's rate (the test above may already have written it — the same row): 1 € = 40,00 UAH.
    await rate("2026-11-18", "EUR", "40.00");
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const rent = await category(space, "Дохід від оренди");
    await createBudget(space, {
      incomePlans: [
        { categoryId: salary, amount: eur("1000") },
        { categoryId: rent, amount: uah("20000") },
      ],
    });
    const set = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
      period: "2026-12",
      kind: "income",
      lineId: rent,
      amount: uah("25000.25"),
      version: 0,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ amount: uah("25000.25"), version: 1 });
    const g = (await call(space, "GET", "/v1/budget/plan-grid")).json();
    const row = (g.income.categories as { categoryId: string; cells: unknown[] }[]).find(
      (r) => r.categoryId === rent,
    )!;
    expect(row.cells.slice(0, 2)).toEqual([
      { amount: uah("20000"), own: false, version: 0 },
      { amount: uah("25000.25"), own: true, version: 1 },
    ]);
    // 1 000 € + 20 000 UAH × 0,025; December: 1 000 € + 25 000,25 UAH × 0,025 = 1 625,00625 € — unrounded.
    expect(g.income.totals.slice(0, 2)).toEqual([eur("1500"), eur("1625.00625")]);
    expect(g.rates).toEqual([{ currency: "UAH", rate: "0.025", date: "2026-11-18" }]);
    expect((await period(space, "2026-12")).incomePlan).toEqual(eur("1625.00625"));
    const wrong = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
      period: "2027-01",
      kind: "income",
      lineId: rent,
      amount: eur("500"),
      version: 0,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().errors).toEqual([{ in: "body", path: "amount.currency", issue: "currency" }]);
  });

  it("BUD-17@PoC FR 1, business rules (lead decision 2026-11-26, row 231): a «План доходу» typed before goes only to the categories in the budget's currency — a UAH category gets no share and keeps its plan on top", async () => {
    await rates();
    await rate("2026-11-18", "EUR", "40.00");
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const rent = await category(space, "Дохід від оренди");
    await createBudget(space, {
      incomePlans: [
        { categoryId: salary, amount: eur("1000") },
        { categoryId: rent, amount: uah("20000") },
      ],
    });
    const b = (await call(space, "GET", "/v1/budget")).json().budget as { id: string };
    await db.owner.query(
      `INSERT INTO budget.plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
       VALUES ($1, $2, '2026-12-01', 'income', '00000000-0000-0000-0000-000000000000', 1400, 'EUR', 2)`,
      [space.householdId, b.id],
    );
    const g = (await call(space, "GET", "/v1/budget/plan-grid")).json();
    const cellOf = (id: string) =>
      (g.income.categories as { categoryId: string; cells: unknown[] }[]).find((r) => r.categoryId === id)!
        .cells[1];
    expect(cellOf(salary)).toEqual({ amount: eur("1400"), own: true, version: 1 });
    expect(cellOf(rent)).toEqual({ amount: uah("20000"), own: false, version: 0 });
    // 1 400 € + 20 000 UAH × 0,025.
    expect(g.income.totals[1]).toEqual(eur("1900"));
    expect((await period(space, "2026-12")).incomePlan).toEqual(eur("1900"));
  });

  it("BUD-17@PoC business rules: a cell changed from 3 000 UAH to 3 000 EUR is a change, audited with its currency", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const b = await createBudget(space, { limits: [{ categoryId: clubs, amount: uah("2000") }] });
    const put = (amount: unknown, version: number) =>
      call(space, "PUT", "/v1/budget/plan-grid/cells", {
        period: "2026-12",
        kind: "limit",
        lineId: clubs,
        amount,
        version,
      });
    const first = await put(uah("3000"), 0);
    expect(first.statusCode, first.body).toBe(200);
    // The limit moves to EUR; the cell is rewritten with the same digits in EUR.
    expect(
      (await patch(space, { version: b.version, limits: [{ categoryId: clubs, amount: eur("40") }] }))
        .statusCode,
    ).toBe(200);
    const second = await put(eur("3000"), first.json().version as number);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().version).toBe((first.json().version as number) + 1);
    const { rows } = await db.owner.query<{
      action: string;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(
      `SELECT action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'budget.plan-cell' ORDER BY occurred_at, action`,
      [space.householdId],
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "update"]);
    expect(rows[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "amount", before: "3000", after: "3000" }),
        expect.objectContaining({ field: "currency", before: "UAH", after: "EUR" }),
      ]),
    );
  });

  it("BUD-02@PoC FR 24: another space never sees the budget; a scoped member is refused", async () => {
    await rates();
    const space = await newSpace();
    const other = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    await createBudget(space, { limits: [{ categoryId: clubs, amount: uah("2000") }] });
    expect((await call(other, "GET", "/v1/budget")).json()).toEqual({ budget: null });
    expect((await call(other, "GET", "/v1/budget/periods/2026-11")).statusCode).toBe(404);
    const scoped = await call(space, "GET", "/v1/budget/periods/2026-11", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
  });
});

describe("BUD-02@PoC FR 24 with BUD-01@PoC FR 12: a category of another currency deleted with its budget entries", () => {
  it("BUD-02@PoC FR 24: the delete names the limit in the category's currency and audits it; the income plan of the others is their sum at today's rate", async () => {
    // Its own day with its own rate: the rates are shared by the file's tests (another one sets 2026-11-18).
    now = at("2026-11-25");
    await rate("2026-11-25", "EUR", "50.00");
    const space = await newSpace();
    const tree = await call(space, "GET", "/v1/categories");
    const incomeGroup = (tree.json().groups as { id: string; kind: string }[]).find(
      (g) => g.kind === "income",
    )!;
    const income = async (name: string) => {
      const res = await call(space, "POST", "/v1/categories", { groupId: incomeGroup.id, name });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    };
    const salary = await category(space, "Зарплата");
    const bonus = await income("Синтетичні премії");
    const rent = await income("Синтетична оренда");
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const b = await createBudget(space, {
      incomePlans: [
        { categoryId: salary, amount: eur("1000") },
        { categoryId: bonus, amount: eur("300") },
        { categoryId: rent, amount: uah("10000") },
      ],
      limits: [{ categoryId: clubs, amount: uah("2000") }],
    });
    expect(b.incomePlan).toEqual(eur("1500"));

    // «ліміт N теж буде видалено»: N as it was typed — 2 000 UAH, not its ≈ 40 €.
    const usage = await call(space, "GET", `/v1/categories/${clubs}/usage`);
    expect(usage.statusCode, usage.body).toBe(200);
    expect(usage.json().budget).toEqual({ limit: uah("2000"), stored: true, planCells: 0 });
    const del = await call(space, "DELETE", `/v1/categories/${clubs}?confirmLimit=true`);
    expect(del.statusCode, del.body).toBe(200);
    const { rows } = await db.owner.query<{ changes: { field: string; before: unknown; after: unknown }[] }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'budget.limit' AND action = 'delete'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toContainEqual(
      expect.objectContaining({ field: "currency", before: "UAH", after: null }),
    );

    // The other plans are 1 000 € and 10 000 UAH (≈ 200 € today): the income plan becomes 1 200 €.
    const gone = await call(space, "DELETE", `/v1/categories/${bonus}?confirmLimit=true`);
    expect(gone.statusCode, gone.body).toBe(200);
    expect((await call(space, "GET", "/v1/budget")).json().budget.incomePlan).toEqual(eur("1200"));
  });
});
