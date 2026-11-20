import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Money } from "@willowsum/domain-kernel";
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
  type PeriodObligations,
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
 * BUD-02@PoC c) (wave 2 row 31), the server part of «Розподіл», the totals row of «Категорії» and the plan of a future
 * month, through the real API on a real PostgreSQL with the real categories, accounts, transactions, categorization and
 * fx-rates modules. The month's regular payments and debt minimums come through the port `BudgetObligations` — a fake
 * here (the API process does not connect them yet: `bare` checks that every figure needing them is null). Every name
 * and amount is synthetic; the clock is the test's own (Kyiv).
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
let bare: ReturnType<typeof buildServer>;
let owed: (period: string, from?: string) => PeriodObligations = () => ({ recurring: [], debtMinimums: [] });
const seen: { householdId: string; period: string; currency: string; from?: string }[] = [];

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
  server = app,
) {
  return server.inject({
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
  const server = (withObligations: boolean) =>
    buildServer({
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
          categorization: createCategorizationServices({
            transactions: lookup,
            categories: directory,
            audit,
          }),
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
            ...(withObligations
              ? {
                  obligations: {
                    async month(householdId: string, period: string, currency: string, from?: string) {
                      seen.push({ householdId, period, currency, ...(from ? { from } : {}) });
                      return owed(period, from);
                    },
                  },
                }
              : {}),
          }),
          allowedOrigins: new Set([WEB]),
        }),
    });
  app = server(true);
  bare = server(false);
  await bare.ready();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await bare?.close();
  await db?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
  now = at(TODAY);
  owed = () => ({ recurring: [], debtMinimums: [] });
  seen.length = 0;
});

const m = (amount: string) => Money.of(amount, "EUR");
const preview = (space: Space, body: Record<string, unknown>, server = app) =>
  call(space, "POST", "/v1/budget/allocation", { firstPeriod: "2026-11", ...body }, {}, server);

describe("BUD-02@PoC: «Розподіл» (POST /v1/budget/allocation)", () => {
  it("BUD-02@PoC AC6: income 5 600 €, limits 2 860 €, regular payments outside limits 0 € — «не розподілено 2 740 €» and a surplus to allocate (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    const res = await preview(space, {
      incomePlan: eur("5600.00"),
      limits: [
        { categoryId: groceries, amount: eur("2000.00") },
        { categoryId: cafes, amount: eur("860") },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      period: "2026-11",
      incomePlan: eur("5600"),
      limits: eur("2860"),
      balance: {
        recurringOutsideLimits: eur("0"),
        unallocated: eur("2740"),
        debtMinimums: eur("0"),
        // Q5 а: the goals' planned contributions (no goal here).
        goalContributions: eur("0"),
        difference: eur("2740"),
        kind: "surplus",
        amount: eur("2740"),
      },
      choice: null,
      // AC6: «Можна витратити в листопаді ≈ 3 600 €» — 5 600 − nothing spent yet − «Продукти» (mandatory) 2 000 still needed.
      spendable: { period: "2026-11", amount: eur("3600"), missing: [] },
    });
    expect(seen).toEqual([{ householdId: space.householdId, period: "2026-11", currency: "EUR" }]);
    // Read only: nothing is saved.
    expect((await call(space, "GET", "/v1/budget")).json()).toEqual({ budget: null });
  });

  it("BUD-02@PoC AC7: income 3 000 €, limits 3 200 € — «Звідки візьмуться 200 €?»; «Створити бюджет» stays inactive until the options sum to 200 € (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const body = {
      incomePlan: eur("3000"),
      limits: [{ categoryId: groceries, amount: eur("3200") }],
    };
    const short = (await preview(space, { ...body, chosen: [eur("150"), eur("49.99")] })).json();
    expect(short.balance).toMatchObject({ kind: "deficit", difference: eur("-200"), amount: eur("200") });
    expect(short.choice).toEqual({ chosen: eur("199.99"), rest: eur("0.01"), status: "short" });
    const exact = (await preview(space, { ...body, chosen: [eur("150"), eur("50.00")] })).json();
    expect(exact.choice).toEqual({ chosen: eur("200"), rest: eur("0"), status: "exact" });
    const over = (await preview(space, { ...body, chosen: [eur("250")] })).json();
    expect(over.choice).toMatchObject({ status: "over", rest: eur("-50") });
    // Only the plan: no transfer, no budget, no audit entry.
    expect(await n("budget.budgets WHERE household_id = $1", space.householdId)).toBe(0);
    expect(
      await n("audit.entries WHERE household_id = $1 AND entity_type LIKE 'budget.%'", space.householdId),
    ).toBe(0);
  });

  it("BUD-02@PoC FR 15: regular payments outside the limits and the debts' minimum payments lower the difference; a payment in a limited category does not (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    owed = () => ({
      recurring: [
        { categoryId: null, amount: m("15.99"), paid: false },
        { categoryId: groceries, amount: m("40"), paid: false },
      ],
      debtMinimums: [{ accountId: randomUUID(), amount: m("120.01"), paid: false }],
    });
    const res = await preview(space, {
      incomePlan: eur("1000"),
      limits: [{ categoryId: groceries, amount: eur("900.00") }],
    });
    expect(res.json().balance).toEqual({
      recurringOutsideLimits: eur("15.99"),
      unallocated: eur("84.01"),
      debtMinimums: eur("120.01"),
      goalContributions: eur("0"),
      difference: eur("-36"),
      kind: "deficit",
      amount: eur("36"),
    });
  });

  it("BUD-02@PoC FR 15 boundary: zero — an empty plan has nothing to allocate (fake port; live after #567)", async () => {
    const space = await newSpace();
    const res = await preview(space, { chosen: [] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().balance).toMatchObject({ kind: "balanced", amount: eur("0"), difference: eur("0") });
    expect(res.json().choice).toEqual({ chosen: eur("0"), rest: eur("0"), status: "exact" });
  });

  it("BUD-02@PoC FR 14: a start in the middle of the month — the proportional plan × 13/30 and the payments from today (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const res = await preview(space, {
      proportional: true,
      incomePlan: eur("3000"),
      limits: [{ categoryId: groceries, amount: eur("600") }],
    });
    expect(res.statusCode, res.body).toBe(200);
    // 3000 × 13 / 30 = 1300; 600 × 13 / 30 = 260.
    expect(res.json()).toMatchObject({ incomePlan: eur("1300"), limits: eur("260") });
    expect(res.json().balance.unallocated).toEqual(eur("1040"));
    expect(seen).toEqual([
      { householdId: space.householdId, period: "2026-11", currency: "EUR", from: "2026-11-18" },
    ]);
    // «З наступного місяця»: the whole December plan, no share.
    const next = await preview(space, { firstPeriod: "2026-12", incomePlan: eur("3000") });
    expect(next.json()).toMatchObject({ period: "2026-12", incomePlan: eur("3000") });
  });

  it("BUD-02@PoC FR 1: one currency — an amount in another currency is refused with 400; a start the wizard does not offer too", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    for (const [body, path] of [
      [{ incomePlan: { amount: "10", currency: "UAH" } }, "incomePlan.currency"],
      [
        { limits: [{ categoryId: groceries, amount: { amount: "1", currency: "USD" } }] },
        "limits.0.amount.currency",
      ],
      [{ chosen: [{ amount: "1", currency: "UAH" }] }, "chosen.0.currency"],
      [{ chosen: [eur("-1")] }, "chosen.0"],
      [{ firstPeriod: "2027-01" }, "firstPeriod"],
      [{ proportional: true, firstPeriod: "2026-12" }, "proportional"],
    ] as const) {
      const res = await preview(space, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().errors.map((e: { path: string }) => e.path)).toContain(path);
    }
  });

  it("BUD-02@PoC FR 15: without the regular payments and debts connected, no difference is shown — never one without them", async () => {
    const space = await newSpace();
    const res = await preview(space, { incomePlan: eur("5600"), chosen: [eur("1")] }, bare);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      period: "2026-11",
      incomePlan: eur("5600"),
      limits: eur("0"),
      balance: null,
      choice: null,
      // AC6: no «Можна витратити в листопаді ≈ …» without the month's payments either.
      spendable: { period: "2026-11", amount: null, missing: ["obligations"] },
    });
  });
});

describe("BUD-02@PoC: the totals row and the future month (GET /v1/budget/periods/{period})", () => {
  it("BUD-02@PoC AC9: the totals row — spent of limits, overspend in N categories, still needed for mandatory, free rest (negative with «−») (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти"); // mandatory
    const cafes = await category(space, "Кафе і ресторани");
    const clothes = await category(space, "Одяг");
    const travel = await category(space, "Подорожі");
    await createBudget(space, {
      limits: [
        { categoryId: groceries, amount: eur("700.00") },
        { categoryId: cafes, amount: eur("200") },
        { categoryId: clothes, amount: eur("150") },
      ],
    });
    const acc = await account(space);
    await spend(space, acc, "-682.50", "2026-11-03", "Продукти");
    await spend(space, acc, "-230.05", "2026-11-04", "Кафе і ресторани");
    await spend(space, acc, "-170.00", "2026-11-05", "Одяг");
    owed = () => ({
      recurring: [
        { categoryId: travel, amount: m("250"), paid: false },
        { categoryId: null, amount: m("50"), paid: false },
        { categoryId: null, amount: m("30"), paid: true },
        // In the mandatory «Продукти», more than its rest of 17.50: D takes the payment, not the rest (BUD-03 п. 14).
        { categoryId: groceries, amount: m("99"), paid: false },
      ],
      debtMinimums: [],
    });
    const view = await period(space, "2026-11");
    // B 1050, A 1082.55, C 50.05 in 2; every unpaid payment 250 + 50 + 99 = 399; D = max(0, 17.50 − 99) + 99 = 99 — only
    // the mandatory category's own unpaid payment (FR 19); E = 1050 − 1082.55 − 99 = −131.55.
    expect(view.summary).toEqual({
      spent: eur("1082.55"),
      limits: eur("1050"),
      overspend: { amount: eur("50.05"), count: 2 },
      optionalLimits: eur("350"),
      mandatoryRemaining: eur("17.5"),
      unpaidRecurring: eur("399"),
      mandatoryNeeded: eur("99"),
      free: eur("-131.55"),
    });
    expect(view.expectedPayments).toEqual({
      categories: [
        { categoryId: travel, amount: eur("250") },
        { categoryId: null, amount: eur("80") },
        { categoryId: groceries, amount: eur("99") },
      ],
      total: eur("429"),
    });
    // Without the regular payments connected: D and E are null, the rest stays.
    const res = await call(space, "GET", "/v1/budget/periods/2026-11", undefined, {}, bare);
    expect(res.json().summary).toMatchObject({
      overspend: { amount: eur("50.05"), count: 2 },
      unpaidRecurring: null,
      mandatoryNeeded: null,
      free: null,
    });
    expect(res.json().expectedPayments).toBeNull();
  });

  it("BUD-02@PoC FR 19 boundary: zero — a budget without limits or spending shows 0, never «-0» (fake port; live after #567)", async () => {
    const space = await newSpace();
    await createBudget(space);
    const view = await period(space, "2026-11");
    expect(view.summary).toEqual({
      spent: eur("0"),
      limits: eur("0"),
      overspend: { amount: eur("0"), count: 0 },
      optionalLimits: eur("0"),
      mandatoryRemaining: eur("0"),
      unpaidRecurring: eur("0"),
      mandatoryNeeded: eur("0"),
      free: eur("0"),
    });
  });

  it("BUD-02@PoC AC8: the next month is the plan only — no spending, no totals row, the expected payments of that month (fake port; live after #567)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("700") }] });
    owed = (p) => ({
      recurring: p === "2026-12" ? [{ categoryId: null, amount: m("12.34"), paid: false }] : [],
      debtMinimums: [],
    });
    const december = await period(space, "2026-12");
    expect(december).toMatchObject({ mode: "future", incomeActual: null, summary: null });
    expect(december.totals).toEqual({ limits: eur("700"), spent: null, remaining: null });
    expect(december.expectedPayments).toEqual({
      categories: [{ categoryId: null, amount: eur("12.34") }],
      total: eur("12.34"),
    });
    expect(seen.at(-1)).toEqual({ householdId: space.householdId, period: "2026-12", currency: "EUR" });
  });

  it("BUD-02@PoC FR 14: a proportional first period asks for the payments from its first day", async () => {
    const space = await newSpace();
    await createBudget(space, { proportional: true });
    await period(space, "2026-11");
    expect(seen.at(-1)).toMatchObject({ period: "2026-11", from: "2026-11-18" });
  });

  it("BUD-02@PoC «Права доступу»: another space gets 404 on the period and its numbers stay out of the body; a scoped member gets 404 on «Розподіл»", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    await createBudget(owner, { incomePlan: eur("98765.43") });
    const res = await call(stranger, "GET", "/v1/budget/periods/2026-11");
    expect(res.statusCode).toBe(404);
    // The random supportId is dropped before the leak check (#563).
    const problem = { ...(res.json() as Record<string, unknown>), supportId: undefined };
    expect(JSON.stringify(problem)).not.toContain("98765");
    expect(seen.filter((s) => s.householdId === owner.householdId)).toEqual([]);
    const scoped = await call(
      owner,
      "POST",
      "/v1/budget/allocation",
      { firstPeriod: "2026-11" },
      { role: "viewer", scoped: true },
    );
    expect(scoped.statusCode).toBe(404);
  });
});

describe("BUD-02@PoC: sizes and space isolation of «Розподіл» and the totals row (security review)", () => {
  it("BUD-02@PoC FR 15 boundary: more than 100 chosen amounts, more than 300 limits or an unknown field is refused with 400", async () => {
    const space = await newSpace();
    const many = Array.from({ length: 101 }, () => eur("1"));
    expect((await preview(space, { chosen: many.slice(1) })).statusCode).toBe(200);
    expect((await preview(space, { chosen: many })).statusCode).toBe(400);
    expect((await preview(space, { plannedSavings: eur("1") })).statusCode).toBe(400);
    const limits = Array.from({ length: 301 }, () => ({ categoryId: randomUUID(), amount: eur("1") }));
    const paths = (await preview(space, { limits })).json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(["limits"]);
  });

  it("BUD-02@PoC «Права доступу»: two spaces with budgets — a period carries its own space's numbers only, and the payments are asked for that space", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const groceries = await category(owner, "Продукти");
    await createBudget(owner, {
      incomePlan: eur("98765.43"),
      limits: [{ categoryId: groceries, amount: eur("4321.09") }],
    });
    await spend(owner, await account(owner), "-5555.55", "2026-11-03", "Продукти");
    await createBudget(other, { incomePlan: eur("11") });
    // The leak check below can fail: the owner's own view does carry these numbers.
    const own = await period(owner, "2026-11");
    expect(JSON.stringify(own)).toMatch(/98765\.43.*4321\.09/);
    expect(own.summary.spent).toEqual(eur("5555.55"));
    seen.length = 0;
    const view = await period(other, "2026-11");
    expect(JSON.stringify(view)).not.toMatch(/98765|4321|5555/);
    expect(view.summary).toMatchObject({ spent: eur("0"), limits: eur("0"), free: eur("0") });
    expect(seen).toEqual([{ householdId: other.householdId, period: "2026-11", currency: "EUR" }]);
    const scoped = { role: "viewer", scoped: true };
    expect((await call(other, "GET", "/v1/budget/periods/2026-11", undefined, scoped)).statusCode).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it("BUD-02@PoC FR 15 boundary: amounts whose sum does not fit NUMERIC(38,18) are refused with 400, not 500", async () => {
    const space = await newSpace();
    const max = eur("9".repeat(20));
    const limits = [
      { categoryId: await category(space, "Продукти"), amount: max },
      { categoryId: await category(space, "Одяг"), amount: max },
    ];
    expect((await preview(space, { incomePlan: max, limits })).statusCode).toBe(400);
    expect((await preview(space, { chosen: [max, max] })).statusCode).toBe(400);
    // 15 integer digits is the most an amount has; 300 of them still sum within NUMERIC(38,18).
    const top = eur("9".repeat(15) + ".99");
    expect((await preview(space, { incomePlan: top, chosen: [top, top] })).statusCode).toBe(200);
    expect(
      (await preview(space, { incomePlan: eur("1" + "0".repeat(15)) }))
        .json()
        .errors.map((e: { path: string }) => e.path),
    ).toEqual(["incomePlan"]);
    // The same cap on saving: a plan whose totals would overflow cannot be stored (and then fail the period's GET).
    const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11", limits });
    expect(res.statusCode, res.body).toBe(400);
    expect(await n("budget.budgets WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-02@PoC FR 1: a payment or a debt minimum the source gives in another currency yields no figure at all (fake port)", async () => {
    const space = await newSpace();
    await createBudget(space, { incomePlan: eur("100") });
    const usd = Money.of("7", "USD");
    for (const o of [
      { recurring: [{ categoryId: null, amount: usd, paid: false }], debtMinimums: [] },
      { recurring: [], debtMinimums: [{ accountId: randomUUID(), amount: usd, paid: false }] },
    ]) {
      owed = () => o;
      const res = await preview(space, { incomePlan: eur("100") });
      expect(res.statusCode).toBe(500);
      expect(res.json()).not.toHaveProperty("balance");
    }
    owed = () => ({ recurring: [{ categoryId: null, amount: usd, paid: false }], debtMinimums: [] });
    for (const p of ["2026-11", "2026-12"]) {
      const res = await call(space, "GET", `/v1/budget/periods/${p}`);
      expect(res.statusCode, p).toBe(500);
      expect(res.json()).not.toHaveProperty("summary");
    }
  });

  it("BUD-02@PoC FR 16: a past month is plan against fact — the totals row has no «Ще потрібно на обов'язкові» or «Вільний залишок» (fake port)", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: groceries, amount: eur("500") }],
    });
    const acc = await account(space);
    await spend(space, acc, "-620.00", "2026-10-03", "Продукти");
    now = at(TODAY);
    owed = () => ({ recurring: [{ categoryId: null, amount: m("40"), paid: false }], debtMinimums: [] });
    const october = await period(space, "2026-10");
    expect(october.mode).toBe("past");
    expect(october.summary).toEqual({
      spent: eur("620"),
      limits: eur("500"),
      overspend: { amount: eur("120"), count: 1 },
      optionalLimits: eur("0"),
      mandatoryRemaining: eur("0"),
      unpaidRecurring: null,
      mandatoryNeeded: null,
      free: null,
    });
    // The current month keeps D and E (the payment without a category is not «на обов'язкові», FR 19).
    expect((await period(space, "2026-11")).summary).toMatchObject({
      unpaidRecurring: eur("40"),
      mandatoryNeeded: eur("500"),
      free: eur("0"),
    });
  });
});
