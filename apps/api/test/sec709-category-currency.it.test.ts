import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
 * Security review of PR #709 (BUD-02@PoC FR 24, «Валюта категорії», server): currency codes and amounts are validated
 * (400, never 500), the rate-required guard, no money created or lost by a conversion, a finished period's snapshot is
 * immutable, another space's currencies never leak, the stored currency follows a change. Real API on PostgreSQL;
 * every name and amount is synthetic; 1 € = 50,00 UAH.
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

const gbp = (amount: string) => ({ amount, currency: "GBP" });
const snapshotRows = async (space: Space) =>
  (
    await db.owner.query(
      `SELECT to_char(period, 'YYYY-MM') AS period, currency, income_plan::text, limits, income_plans, rates
         FROM budget.period_snapshots WHERE household_id = $1 ORDER BY period`,
      [space.householdId],
    )
  ).rows;

describe("sec709: category currency — input validation, isolation, snapshot immutability", () => {
  it("sec709: a malformed or unknown currency code is a 400 on every write, never a 500", async () => {
    await rates();
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const salary = await category(space, "Зарплата");
    for (const currency of ["zzz", "eur", "uah", "€€€", "", "UAH ", "XXX", "U", "UAHUAHUAHU", "'; --"]) {
      const amount = { amount: "10", currency };
      const created = await call(space, "POST", "/v1/budget", {
        firstPeriod: "2026-11",
        limits: [{ categoryId: clubs, amount }],
      });
      expect(created.statusCode, `POST limit ${currency}: ${created.body}`).toBe(400);
      const income = await call(space, "POST", "/v1/budget", {
        firstPeriod: "2026-11",
        incomePlans: [{ categoryId: salary, amount }],
      });
      expect(income.statusCode, `POST income ${currency}: ${income.body}`).toBe(400);
      const alloc = await call(space, "POST", "/v1/budget/allocation", {
        firstPeriod: "2026-11",
        limits: [{ categoryId: clubs, amount }],
      });
      expect(alloc.statusCode, `allocation ${currency}: ${alloc.body}`).toBe(400);
    }
    const b = await createBudget(space, { limits: [{ categoryId: clubs, amount: uah("2000") }] });
    for (const currency of ["zzz", "eur", "", "XXX", "SEK", "EUR"]) {
      const res = await patch(space, {
        version: b.version,
        limits: [{ categoryId: clubs, amount: { amount: "10", currency } }],
        incomePlans: [{ categoryId: salary, amount: { amount: "10", currency } }],
      });
      if (currency === "EUR") continue;
      expect(res.statusCode, `PATCH ${currency}: ${res.body}`).toBe(400);
      const cell = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
        period: "2026-12",
        kind: "limit",
        lineId: clubs,
        amount: { amount: "10", currency },
        version: 0,
      });
      expect(cell.statusCode, `cell ${currency}: ${cell.body}`).toBe(400);
    }
  });

  it("sec709: amounts of another currency — negative, past minor units, over 15 digits before or after the conversion — are 400; nothing is stored", async () => {
    await rates();
    await rate("2026-11-17", "GBP", "60.00"); // 1 GBP = 1.2 EUR
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const b = await createBudget(space, { limits: [{ categoryId: clubs, amount: eur("40") }] });
    for (const amount of [
      uah("-1"),
      uah("10.001"),
      uah("1e3"),
      uah("1000000000000000"),
      gbp("999999999999999"),
      uah("NaN"),
      uah(" 5"),
    ]) {
      const res = await patch(space, { version: b.version, limits: [{ categoryId: clubs, amount }] });
      expect(res.statusCode, `${JSON.stringify(amount)}: ${res.body}`).toBe(400);
    }
    const { rows } = await db.owner.query(
      `SELECT amount::text, currency FROM budget.limits WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([{ amount: "40.000000000000000000", currency: "EUR" }]);
    // The largest accepted amounts convert without loss and never 500 the reads.
    const ok = await patch(space, {
      version: b.version,
      limits: [{ categoryId: clubs, amount: uah("999999999999999.99") }],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const view = await period(space, "2026-11");
    expect(line(view, clubs)).toMatchObject({
      limit: uah("999999999999999.99"),
      inBudgetCurrency: { limit: eur("19999999999999.9998") },
    });
    expect(view.totals.limits ?? view.totals).toBeDefined();
    expect((await call(space, "GET", "/v1/budget/plan-grid")).statusCode).toBe(200);
    expect((await call(space, "GET", "/v1/budget")).statusCode).toBe(200);
  });

  it("sec709: the conversion neither creates nor loses money — the total of limits is the exact sum of the lines at the named rate", async () => {
    await rates();
    await rate("2026-11-17", "USD", "41.50");
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const food = await category(space, "Продукти");
    const other = await newCategory(space, "Родина", "Синтетична");
    await createBudget(space, {
      limits: [
        { categoryId: clubs, amount: uah("2000.33") },
        { categoryId: food, amount: eur("1000.01") },
        { categoryId: other, amount: { amount: "7.77", currency: "USD" } },
      ],
    });
    const view = await period(space, "2026-11");
    const lines = (
      view.groups as { categories: (Line & { inBudgetCurrency: { limit: { amount: string } } | null })[] }[]
    ).flatMap((g) => g.categories);
    expect(lines).toHaveLength(3);
    // 2000.33 × 0.02 = 40.0066; 7.77 × 41.5 / 50 = 6.4491; unrounded.
    expect(line(view, clubs)).toMatchObject({
      limit: uah("2000.33"),
      inBudgetCurrency: { limit: eur("40.0066") },
    });
    expect(line(view, other)).toMatchObject({ inBudgetCurrency: { limit: eur("6.4491") } });
    expect(line(view, food)).toMatchObject({ limit: eur("1000.01"), inBudgetCurrency: null });
    expect(JSON.stringify(view.totals)).toContain('"1046.4657"');
    expect(view.rates).toEqual([
      { currency: "UAH", rate: "0.02", date: "2026-11-17" },
      { currency: "USD", rate: "0.83", date: "2026-11-17" },
    ]);
  });

  it("sec709: a finished period's snapshot never changes — a later rate for its last day, a currency change and a new limit leave it byte for byte", async () => {
    await rates();
    await rate("2026-10-31", "EUR", "40.00");
    now = at("2026-10-20");
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const salary = await category(space, "Зарплата");
    const b = await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: clubs, amount: uah("2000") }],
      incomePlans: [{ categoryId: salary, amount: uah("100000") }],
    });
    now = at(TODAY);
    const october = await period(space, "2026-10");
    const stored = await snapshotRows(space);
    expect(stored).toHaveLength(1);
    expect(october.incomePlan).toEqual(eur("2500"));
    // The rate of the last day is corrected later, and the plan changes currency.
    await db.owner.query(`UPDATE fx_rates.rates SET rate = 10 WHERE currency = 'EUR'`);
    const current = (await call(space, "GET", "/v1/budget")).json().budget;
    const changed = await patch(space, {
      version: current.version ?? b.version,
      limits: [{ categoryId: clubs, amount: eur("77") }],
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await snapshotRows(space)).toEqual(stored);
    expect(await period(space, "2026-10")).toEqual(october);
    await db.owner.query(`UPDATE fx_rates.rates SET rate = 50 WHERE currency = 'EUR'`);
    await db.owner.query(
      `UPDATE fx_rates.rates SET rate = 40 WHERE currency = 'EUR' AND rate_date = '2026-10-31'`,
    );
  });

  it("sec709: a stored line whose currency lost every rate counts 0, is named with rate null, and no read fails", async () => {
    await rates();
    await rate("2026-11-17", "CHF", "55.00");
    const space = await newSpace();
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const food = await category(space, "Продукти");
    await createBudget(space, {
      limits: [
        { categoryId: clubs, amount: { amount: "100", currency: "CHF" } },
        { categoryId: food, amount: eur("10") },
      ],
    });
    await db.owner.query(`DELETE FROM fx_rates.rates WHERE currency = 'CHF'`);
    const view = await period(space, "2026-11");
    expect(view.rates).toEqual([{ currency: "CHF", rate: null, date: null }]);
    expect(line(view, clubs)).toMatchObject({
      limit: { amount: "100", currency: "CHF" },
      inBudgetCurrency: { limit: eur("0") },
    });
    for (const url of [
      "/v1/budget",
      "/v1/budget/plan-grid",
      "/v1/budget/periods/2026-11/spendable",
      "/v1/budget/periods/2026-12",
    ])
      expect((await call(space, "GET", url)).statusCode, url).toBe(200);
    // The same currency is refused for a new line now.
    const b = (await call(space, "GET", "/v1/budget")).json().budget;
    const res = await patch(space, {
      version: b.version,
      limits: [{ categoryId: food, amount: { amount: "5", currency: "CHF" } }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("sec709: another space's category currency, rates and snapshot never reach this space", async () => {
    await rates();
    const mine = await newSpace();
    const theirs = await newSpace();
    const food = await category(mine, "Продукти");
    const theirClubs = await newCategory(theirs, "Родина", "Гуртки дітей");
    await createBudget(mine, { limits: [{ categoryId: food, amount: eur("100") }] });
    await createBudget(theirs, { limits: [{ categoryId: theirClubs, amount: uah("2000") }] });
    for (const url of [
      "/v1/budget",
      "/v1/budget/periods/2026-11",
      "/v1/budget/plan-grid",
      "/v1/budget/periods/2026-11/spendable",
    ]) {
      const res = await call(mine, "GET", url);
      expect(res.statusCode, url).toBe(200);
      expect(leakText(res.body), url).not.toContain("UAH");
      expect(leakText(res.body), url).not.toContain(theirClubs);
    }
    // A category of the other space is not a line of mine in any currency.
    const b = (await call(mine, "GET", "/v1/budget")).json().budget;
    const res = await patch(mine, {
      version: b.version,
      limits: [{ categoryId: theirClubs, amount: uah("5") }],
    });
    expect(res.statusCode).toBe(400);
    const cell = await call(mine, "PUT", "/v1/budget/plan-grid/cells", {
      period: "2026-12",
      kind: "limit",
      lineId: theirClubs,
      amount: uah("5"),
      version: 0,
    });
    expect(cell.statusCode).toBe(400);
    const { rows } = await db.owner.query(`SELECT currency FROM budget.limits WHERE household_id = $1`, [
      mine.householdId,
    ]);
    expect(rows).toEqual([{ currency: "EUR" }]);
  });

  it("sec709: a month's own cell follows the limit's currency; a cell kept in the old currency after a change is still converted, and a currency-only change is stored and audited", async () => {
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
    expect((await put(eur("10"), 0)).statusCode).toBe(400);
    const set = await put(uah("3000"), 0);
    expect(set.statusCode, set.body).toBe(200);
    expect(line(await period(space, "2026-12"), clubs)).toMatchObject({
      limit: uah("3000"),
      inBudgetCurrency: { limit: eur("60") },
    });
    // Same digits, another currency: a change (the upsert must store the currency).
    const same = await patch(space, {
      version: b.version,
      limits: [{ categoryId: clubs, amount: eur("2000") }],
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(
      (
        await db.owner.query(`SELECT currency FROM budget.limits WHERE household_id = $1`, [
          space.householdId,
        ])
      ).rows,
    ).toEqual([{ currency: "EUR" }]);
    expect(line(await period(space, "2026-11"), clubs)).toMatchObject({
      limit: eur("2000"),
      inBudgetCurrency: null,
    });
    // December keeps its own 3 000 UAH, converted.
    expect(line(await period(space, "2026-12"), clubs)).toMatchObject({
      limit: uah("3000"),
      inBudgetCurrency: { limit: eur("60") },
    });
    // The cell rewritten in the new currency stores the new currency.
    const cellVersion = set.json().version as number;
    const again = await put(eur("3000"), cellVersion);
    expect(again.statusCode, again.body).toBe(200);
    expect(
      (
        await db.owner.query(
          `SELECT amount::numeric::text AS amount, currency FROM budget.plan_cells WHERE household_id = $1`,
          [space.householdId],
        )
      ).rows,
    ).toEqual([{ amount: "3000.000000000000000000", currency: "EUR" }]);
    expect(line(await period(space, "2026-12"), clubs)).toMatchObject({
      limit: eur("3000"),
      inBudgetCurrency: null,
    });
  });

  it("sec709: an income category's plan with the same digits in another currency is stored in that currency; a cell of a line in the budget's currency refuses another currency; a rate dated after today is no rate", async () => {
    await rates();
    // Tomorrow's only (a cross rate takes both sides from one date).
    await rate("2026-11-19", "PLN", "11.00");
    await rate("2026-11-19", "EUR", "50.00");
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const food = await category(space, "Продукти");
    const clubs = await newCategory(space, "Родина", "Гуртки дітей");
    const b = await createBudget(space, {
      limits: [{ categoryId: food, amount: eur("100") }],
      incomePlans: [{ categoryId: salary, amount: eur("3000") }],
    });
    const future = await patch(space, {
      version: b.version,
      limits: [{ categoryId: food, amount: { amount: "10", currency: "PLN" } }],
    });
    expect(future.statusCode, future.body).toBe(400);
    expect(future.json().errors).toEqual([
      { in: "body", path: "limits.0.amount.currency", issue: "currency" },
    ]);
    const same = await patch(space, {
      version: b.version,
      incomePlans: [{ categoryId: salary, amount: uah("3000") }],
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(
      (
        await db.owner.query(`SELECT currency FROM budget.income_plans WHERE household_id = $1`, [
          space.householdId,
        ])
      ).rows,
    ).toEqual([{ currency: "UAH" }]);
    expect(same.json().incomePlan).toEqual(eur("60"));
    expect((await period(space, "2026-11")).incomePlan).toEqual(eur("60"));
    for (const lineId of [food, clubs]) {
      const cell = await call(space, "PUT", "/v1/budget/plan-grid/cells", {
        period: "2026-12",
        kind: "limit",
        lineId,
        amount: uah("500"),
        version: 0,
      });
      expect(cell.statusCode, cell.body).toBe(400);
    }
    expect(
      (
        await db.owner.query(
          `SELECT 1 FROM budget.plan_cells WHERE household_id = $1 AND currency <> 'EUR'`,
          [space.householdId],
        )
      ).rows,
    ).toEqual([]);
  });
});

describe("sec709: a category delete keeps the stored income plan and its audit exact (BUD-01@PoC FR 12, BUD-02@PoC FR 24)", () => {
  it("sec709: deleting an income category stores the others' sum at today's rate, audits that sum and the deleted plan's own currency", async () => {
    await rates();
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
    await createBudget(space, {
      incomePlans: [
        { categoryId: salary, amount: eur("1000") },
        { categoryId: bonus, amount: eur("300") },
        { categoryId: rent, amount: uah("10000") },
      ],
    });
    const stored = async () =>
      (
        await db.owner.query<{ income_plan: string }>(
          `SELECT income_plan::text FROM budget.budgets WHERE household_id = $1`,
          [space.householdId],
        )
      ).rows[0]!.income_plan;
    const audited = async (entity: string, action: string) =>
      (
        await db.owner.query<{ changes: { field: string; before: unknown; after: unknown }[] }>(
          `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3
            ORDER BY occurred_at`,
          [space.householdId, entity, action],
        )
      ).rows.map((r) => r.changes);

    // 1 000 € and 10 000 UAH (200 € today) stay: the stored plan and its audit say 1 200 €, never 1 000 €.
    expect((await call(space, "DELETE", `/v1/categories/${bonus}?confirmLimit=true`)).statusCode).toBe(200);
    expect(await stored()).toMatch(/^1200(\.0+)?$/);
    const updates = await audited("budget.budget", "update");
    expect(updates.at(-1)).toContainEqual(expect.objectContaining({ field: "incomePlan", after: "1200" }));

    // The deleted UAH plan is audited in its own currency: 10 000 UAH, not 10 000 €.
    expect((await call(space, "DELETE", `/v1/categories/${rent}?confirmLimit=true`)).statusCode).toBe(200);
    const deletes = await audited("budget.income-plan", "delete");
    expect(deletes.at(-1)).toContainEqual(
      expect.objectContaining({ field: "currency", before: "UAH", after: null }),
    );
    expect(await stored()).toMatch(/^1000(\.0+)?$/);
  });
});

describe("sec709: a late rate converts an income plan of a finished period too (lead decision 2026-11-26, #709)", () => {
  it("sec709: a PLN income plan without a rate on the period's last day joins the snapshot's income plan once a rate appears", async () => {
    await rates();
    // A cross rate takes both sides from one date.
    await rate("2026-10-20", "EUR", "50.00");
    await rate("2026-10-20", "PLN", "12.50");
    now = at("2026-10-20");
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    const tree = await call(space, "GET", "/v1/categories");
    const incomeGroup = (tree.json().groups as { id: string; kind: string }[]).find(
      (g) => g.kind === "income",
    )!;
    const res = await call(space, "POST", "/v1/categories", {
      groupId: incomeGroup.id,
      name: "Синтетичний дохід PLN",
    });
    expect(res.statusCode, res.body).toBe(201);
    const pln = res.json().id as string;
    await createBudget(space, {
      firstPeriod: "2026-10",
      incomePlans: [
        { categoryId: salary, amount: eur("1000") },
        { categoryId: pln, amount: { amount: "1000", currency: "PLN" } },
      ],
    });
    await db.owner.query(`DELETE FROM fx_rates.rates WHERE currency = 'PLN'`);
    now = at(TODAY);
    // No PLN rate on 31 October: the line counts 0 for now.
    expect((await period(space, "2026-10")).incomePlan).toEqual(eur("1000"));
    // 1 PLN = 12.50 UAH, 1 € = 50 UAH: 1 000 PLN = 250 €, added to the finished month's income plan and kept.
    await rate("2026-11-10", "EUR", "50.00");
    await rate("2026-11-10", "PLN", "12.50");
    expect((await period(space, "2026-10")).incomePlan).toEqual(eur("1250"));
    const { rows } = await db.owner.query<{ income_plan: string }>(
      `SELECT income_plan::text FROM budget.period_snapshots WHERE household_id = $1 AND period = '2026-10-01'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.income_plan).toMatch(/^1250(\.0+)?$/);
    await db.owner.query(`DELETE FROM fx_rates.rates WHERE currency = 'PLN'`);
  });
});
