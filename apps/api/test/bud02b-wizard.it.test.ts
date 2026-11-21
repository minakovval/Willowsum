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
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-02@PoC b) (wave 2 row 30), the server part of the budget wizard, through the real API on a real PostgreSQL with the
 * real categories, accounts, transactions, categorization and fx-rates modules: «Створити за моїми витратами» (the
 * 3-month average rounded to tens, the income plan, an irregular income), «Почати з нуля», the start in the middle of a
 * period and the proportional first period. Every name and amount is synthetic; the clock is the test's own (Kyiv).
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

async function wizard(space: Space) {
  const res = await call(space, "GET", "/v1/budget/wizard");
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

/** A month of history on the account: groceries, cafes and the salary, all categorized. */
async function history(
  space: Space,
  acc: string,
  p: string,
  amounts: { groceries?: string; cafes?: string; salary?: string },
) {
  if (amounts.groceries) await spend(space, acc, `-${amounts.groceries}`, `${p}-05`, "Продукти");
  if (amounts.cafes) await spend(space, acc, `-${amounts.cafes}`, `${p}-12`, "Кафе і ресторани");
  if (amounts.salary) await spend(space, acc, amounts.salary, `${p}-25`, "Зарплата");
}

describe("BUD-02@PoC: «Створити за моїми витратами»", () => {
  it("BUD-02@PoC AC1: with 3 months of history the wizard proposes limits = the 3-month average rounded to 10 € and each income category's average income rounded to 10 €; the edited plan is saved for the current month", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    await history(space, acc, "2026-08", { groceries: "596.00", cafes: "190.00", salary: "2950.00" });
    await history(space, acc, "2026-09", { groceries: "580.00", cafes: "250.00", salary: "3100.00" });
    await history(space, acc, "2026-10", { groceries: "610.00", cafes: "300.10", salary: "3000.00" });
    // The current month is not a full month: it does not count.
    await spend(space, acc, "-900.00", "2026-11-03", "Продукти");
    const w = await wizard(space);
    expect(w.fromSpending).toMatchObject({
      available: true,
      historyMonths: 3,
      incomeIrregular: false,
      // (2 950 + 3 100 + 3 000) / 3 = 3 016.67 → 3 020; the plan is the sum of the income categories' plans.
      incomePlan: eur("3020"),
      incomes: [
        {
          categoryId: await category(space, "Зарплата"),
          average: eur("3016.67"),
          plan: eur("3020"),
          irregular: false,
        },
      ],
    });
    const proposed = new Map(
      (w.fromSpending.categories as { categoryId: string; average: unknown; limit: unknown }[]).map((c) => [
        c.categoryId,
        c,
      ]),
    );
    expect(proposed.get(groceries)).toEqual({
      categoryId: groceries,
      average: eur("595.33"),
      limit: eur("600"),
    });
    expect(proposed.get(cafes)).toEqual({ categoryId: cafes, average: eur("246.7"), limit: eur("250") });
    expect(proposed.size).toBe(2);
    // Before saving every limit and the income plan can be changed: the page sends what the user left.
    const b = await createBudget(space, {
      incomePlan: eur("3000.00"),
      limits: [
        { categoryId: groceries, amount: eur("600") },
        { categoryId: cafes, amount: eur("220.00") },
      ],
    });
    expect(b).toMatchObject({ firstPeriod: "2026-11", proportional: null, incomePlan: eur("3000") });
    expect(line(await period(space, "2026-11"), cafes)).toMatchObject({ limit: eur("220"), spent: eur("0") });
    expect(line(await period(space, "2026-11"), groceries)).toMatchObject({
      limit: eur("600"),
      spent: eur("900"),
    });
  });

  it("BUD-02@PoC FR 3: the proposal reads the budget's accounts only and proposes no limit for «Без категорії»", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const savings = await account(space, "savings");
    const groceries = await category(space, "Продукти");
    for (const p of ["2026-08", "2026-09", "2026-10"]) {
      await history(space, acc, p, { groceries: "100.00", salary: "1000.00" });
      await spend(space, savings, "-5000.00", `${p}-07`, "Продукти");
      await spend(space, acc, "-77.00", `${p}-08`, null);
    }
    const w = await wizard(space);
    expect(w.fromSpending.incomePlan).toEqual(eur("1000"));
    expect(w.fromSpending.categories).toEqual([
      { categoryId: groceries, average: eur("100"), limit: eur("100") },
    ]);
  });

  it("BUD-02@PoC FR 2: with fewer than 3 full months of categorized transactions «Створити за моїми витратами» is not available", async () => {
    const space = await newSpace();
    const acc = await account(space);
    await history(space, acc, "2026-07", { groceries: "100.00" });
    await history(space, acc, "2026-09", { groceries: "100.00" });
    await history(space, acc, "2026-10", { groceries: "100.00" });
    expect((await wizard(space)).fromSpending).toEqual({
      available: false,
      historyMonths: 2,
      incomePlan: null,
      incomes: [],
      incomeIrregular: false,
      categories: [],
    });
  });

  it("BUD-02@PoC EC2: without history only «Почати з нуля» — the budget has the space's groups and no amounts", async () => {
    const space = await newSpace();
    expect((await wizard(space)).fromSpending).toMatchObject({ available: false, historyMonths: 0 });
    const b = await createBudget(space);
    expect(b).toMatchObject({ incomePlan: eur("0"), limits: [], proportional: null });
    const groups = (await call(space, "GET", "/v1/categories")).json().groups as unknown[];
    expect(groups.length).toBeGreaterThan(0);
    const view = await period(space, "2026-11");
    expect(view.totals.limits).toEqual(eur("0"));
  });

  it("BUD-02@PoC EC1: an irregular income — 2 of 6 months off the 6-month average by more than 30 % — plans the lowest month", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const salaries = {
      "2026-05": "2000.00",
      "2026-06": "2000.00",
      "2026-07": "2700.00",
      "2026-08": "2000.00",
    };
    for (const [p, salary] of Object.entries(salaries))
      await history(space, acc, p, { salary, groceries: "10.00" });
    await history(space, acc, "2026-09", { salary: "1300.00", groceries: "10.00" });
    await history(space, acc, "2026-10", { salary: "2000.00", groceries: "10.00" });
    expect((await wizard(space)).fromSpending).toMatchObject({
      available: true,
      historyMonths: 6,
      incomeIrregular: true,
      incomePlan: eur("1300"),
    });
  });
});

describe("BUD-02@PoC: the start of the first period", () => {
  it("BUD-02@PoC AC15: on 18 November the wizard has no period type; «Ви починаєте посеред періоду» offers three starts and none is chosen", async () => {
    const space = await newSpace();
    const w = await wizard(space);
    expect(w).toMatchObject({ today: "2026-11-18", midPeriod: true });
    expect(w.starts).toEqual([
      {
        start: "period-start",
        firstPeriod: "2026-11",
        from: "2026-11-01",
        to: "2026-11-30",
        days: null,
        daysInPeriod: null,
      },
      {
        start: "next-period",
        firstPeriod: "2026-12",
        from: "2026-12-01",
        to: "2026-12-31",
        days: null,
        daysInPeriod: null,
      },
      {
        start: "proportional",
        firstPeriod: "2026-11",
        from: "2026-11-18",
        to: "2026-11-30",
        days: 13,
        daysInPeriod: 30,
      },
    ]);
    // «Далі» needs a choice: the server has no default start either.
    const none = await call(space, "POST", "/v1/budget", {});
    expect(none.statusCode).toBe(400);
    expect(await n("budget.budgets WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-02@PoC EC3: in the middle of a month each of the three starts can be chosen — from the 1st, from the next month, proportionally", async () => {
    for (const [body, firstPeriod] of [
      [{ firstPeriod: "2026-11" }, "2026-11"],
      [{ firstPeriod: "2026-12" }, "2026-12"],
      [{ firstPeriod: "2026-11", proportional: true }, "2026-11"],
    ] as const) {
      const space = await newSpace();
      expect(await createBudget(space, body)).toMatchObject({ firstPeriod });
    }
  });

  it("BUD-02@PoC FR 5: on the 1st of a month the first period is the current one — no mid-period block, no other start", async () => {
    now = at("2026-12-01");
    const space = await newSpace();
    const w = await wizard(space);
    expect(w).toMatchObject({ midPeriod: false });
    expect(w.starts).toEqual([
      {
        start: "period-start",
        firstPeriod: "2026-12",
        from: "2026-12-01",
        to: "2026-12-31",
        days: null,
        daysInPeriod: null,
      },
    ]);
    for (const body of [{ firstPeriod: "2027-01" }, { firstPeriod: "2026-12", proportional: true }]) {
      const res = await call(space, "POST", "/v1/budget", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await createBudget(space, { firstPeriod: "2026-12" })).toMatchObject({ firstPeriod: "2026-12" });
  });

  it("BUD-02@PoC FR 14: «Пропорційно на 18–30 листопада (13/30)» — November's limits, income plan × 13/30 and spending from the 18th; December is whole", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    const b = await createBudget(space, {
      proportional: true,
      incomePlan: eur("3000.00"),
      limits: [
        { categoryId: groceries, amount: eur("600.00") },
        { categoryId: cafes, amount: eur("250.00") },
      ],
    });
    const share = { from: "2026-11-18", to: "2026-11-30", days: 13, daysInPeriod: 30 };
    expect(b).toMatchObject({ firstPeriod: "2026-11", proportional: share, incomePlan: eur("3000") });
    await spend(space, acc, "-80.00", "2026-11-10", "Продукти");
    await spend(space, acc, "-45.00", "2026-11-18", "Продукти");
    await spend(space, acc, "1000.00", "2026-11-05", "Зарплата");
    await spend(space, acc, "-12.00", "2026-11-18", "Подорожі");
    const nov = await period(space, "2026-11");
    expect(nov).toMatchObject({
      mode: "current",
      proportional: share,
      incomePlan: eur("1300"),
      incomeActual: eur("0"),
    });
    expect(line(nov, groceries)).toMatchObject({
      limit: eur("260"),
      spent: eur("45"),
      remaining: eur("215"),
    });
    // 250 × 13 / 30 = 108.333… — half up to cents (lead decision).
    expect(line(nov, cafes)).toMatchObject({ limit: eur("108.33") });
    expect(nov.totals.limits).toEqual(eur("368.33"));
    expect(nov.outsidePlan.total).toEqual(eur("12"));
    const dec = await period(space, "2026-12");
    expect(dec).toMatchObject({ mode: "future", proportional: null, incomePlan: eur("3000") });
    expect(line(dec, groceries)).toMatchObject({ limit: eur("600") });
    // When November is over its snapshot keeps the proportional plan; December is whole.
    now = at("2026-12-05");
    const past = await period(space, "2026-11");
    expect(past).toMatchObject({ mode: "past", incomePlan: eur("1300") });
    expect(line(past, groceries)).toMatchObject({ limit: eur("260"), spent: eur("45") });
    expect(line(await period(space, "2026-12"), groceries)).toMatchObject({ limit: eur("600") });
    // The audit entry of the budget keeps the proportional start.
    const { rows } = await db.owner.query<{ changes: unknown }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'budget.budget' AND action = 'create'`,
      [space.householdId],
    );
    expect(JSON.stringify(rows[0]!.changes)).toContain("2026-11-18");
  });

  it("BUD-02@PoC FR 14: a proportional start is the current month only — not the next one", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-12", proportional: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "proportional", issue: "invalid" }]);
  });

  it("BUD-02@PoC FR 14: two proportional creations at once make one budget; the other is «Бюджет уже існує»", async () => {
    const space = await newSpace();
    const body = { firstPeriod: "2026-11", proportional: true, incomePlan: eur("3000.00") };
    const both = await Promise.all([
      call(space, "POST", "/v1/budget", body),
      call(space, "POST", "/v1/budget", { ...body, proportional: false }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await n("budget.budgets WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await budgetAudit(space.householdId, "budget.budget", "create")).toBe(1);
  });
});

describe("BUD-02@PoC: the wizard and the space's boundary", () => {
  it("BUD-02@PoC «Права доступу»: the wizard reads only the caller's space; a scoped member gets «not found»", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const acc = await account(owner);
    for (const p of ["2026-08", "2026-09", "2026-10"])
      await history(owner, acc, p, { groceries: "4321.00", salary: "9876.00" });
    expect((await wizard(owner)).fromSpending.available).toBe(true);
    const other = await call(stranger, "GET", "/v1/budget/wizard");
    expect(other.statusCode).toBe(200);
    expect(other.json().fromSpending).toMatchObject({ available: false, historyMonths: 0, categories: [] });
    expect(other.body).not.toContain("4321");
    const scoped = await call(owner, "GET", "/v1/budget/wizard", undefined, { role: "viewer", scoped: true });
    expect(scoped.statusCode).toBe(404);
    expect(scoped.body).not.toContain("4321");
  });
});
