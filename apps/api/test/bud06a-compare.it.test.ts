import { randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
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
import { FLAGS } from "../src/modules/feature-flags/index.ts";
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
 * BUD-06@PoC a) (wave 2 row 36), the server part of «Порівняння»: spending and income of the budget's accounts by
 * category against a base (the previous period on the same date, the same period last year, the average of 3 / 6 / 12
 * finished months) and against the plan by the snapshot, the three largest changes, «Рік: план і факт». Through the real
 * API on a real PostgreSQL with the real categories, accounts, transactions, categorization and fx-rates modules. Every
 * name and amount is synthetic; the clock is the test's own.
 */
const WEB = "http://localhost:5173";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
const TODAY = "2026-11-12";
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
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
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
    balanceDate: "2024-01-01",
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

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  const rates = createFxRates({ db: db.databases.for("fx-rates"), now: clock.now });
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
          // FIN-03 FR 5: a transfer between own accounts in two currencies needs the dated rates.
          rates: (requests) => rates.rates(requests),
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

type Money = { amount: string; currency: string };
interface Row {
  categoryId: string | null;
  current: Money;
  plan: Money | null;
  planDifference: { amount: Money; percent: string | null; direction: string; tone: string } | null;
  base: Money | null;
  difference: { amount: Money; percent: string | null; direction: string; tone: string } | null;
  transactions: { current: number; base: number | null };
}
interface Compare {
  currency: string;
  type: string;
  window: { from: string; to: string };
  inProgress: boolean;
  finished: boolean;
  year: string;
  finishedPeriods: number;
  bases: { base: string; available: boolean; reason: string | null; months: number | null }[];
  base: {
    base: string;
    available: boolean;
    window: { from: string; to: string } | null;
    months: number | null;
    full: boolean;
  };
  expenses: { overall: Row; categories: Row[] };
  income: { overall: Row; categories: Row[] };
  largest: {
    categoryId: string | null;
    difference: Money;
    transactions: { current: number; base: number | null };
  }[];
  approximate: { nearestRateCount: number; unavailableCount: number };
}

async function compare(space: Space, query: string): Promise<Compare> {
  const res = await call(space, "GET", `/v1/budget/compare?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Compare;
}
const rowOf = (rows: Row[], id: string | null) => rows.find((r) => r.categoryId === id);
/** Money compared by value: «60» and «60.00» are the same amount. */
const value = (m: Money | null | undefined) => (m ? new Decimal(m.amount).toFixed(2) : m);

describe("BUD-06@PoC: «Порівняння» (server part)", () => {
  it("BUD-06@PoC AC1 (server part): on the 12th, «Попередній період» is days 1–12 of October; «Повний попередній період» — all of October", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-5.00", "2025-09-02", "Продукти");
    await spend(space, acc, "-100.00", "2026-10-05", "Продукти");
    await spend(space, acc, "-70.00", "2026-10-25", "Продукти");
    await spend(space, acc, "-130.00", "2026-11-04", "Продукти");
    const view = await compare(space, "type=month&period=2026-11");
    expect(view).toMatchObject({
      currency: "EUR",
      type: "month",
      window: { from: "2026-11-01", to: "2026-11-12" },
      inProgress: true,
      finished: false,
      base: {
        base: "previous",
        available: true,
        window: { from: "2026-10-01", to: "2026-10-12" },
        full: false,
      },
    });
    const groceries = await category(space, "Продукти");
    expect(rowOf(view.expenses.categories, groceries)).toMatchObject({
      current: eur("130"),
      base: eur("100"),
      difference: { amount: eur("30"), percent: "30.0", direction: "up", tone: "loss" },
    });
    // No mini-chart of the dynamics: nothing but the row's figures.
    expect(Object.keys(rowOf(view.expenses.categories, groceries)!).sort()).toEqual(
      ["base", "categoryId", "current", "difference", "plan", "planDifference", "transactions"].sort(),
    );
    const whole = await compare(space, "type=month&period=2026-11&full=true");
    expect(whole.base).toMatchObject({ window: { from: "2026-10-01", to: "2026-10-31" }, full: true });
    expect(rowOf(whole.expenses.categories, groceries)).toMatchObject({ base: eur("170") });
    expect(view.finishedPeriods).toBe(14);
  });

  it("BUD-06@PoC AC2 (server part): «Середнє за 6 міс.» — the average of six finished months, sorted by the absolute difference, the three largest changes with «на 6 транзакцій більше»", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-5.00", "2025-09-02", "Подарунки");
    for (const m of ["05", "06", "07", "08", "09", "10"]) {
      await spend(space, acc, "-43.10", `2026-${m}-07`, "Кафе і ресторани");
      await spend(space, acc, "-300.00", `2026-${m}-08`, "Продукти");
      await spend(space, acc, "-60.00", `2026-${m}-09`, "Пальне");
    }
    // A month outside the six is not in the average.
    await spend(space, acc, "-999.00", "2026-04-07", "Кафе і ресторани");
    await spend(space, acc, "-43.10", "2026-11-02", "Кафе і ресторани");
    for (let i = 0; i < 6; i++) await spend(space, acc, "-40.00", `2026-11-0${i + 3}`, "Кафе і ресторани");
    await spend(space, acc, "-310.00", "2026-11-09", "Продукти");
    const view = await compare(space, "type=month&period=2026-11&base=avg6");
    expect(view.base).toMatchObject({
      base: "avg6",
      available: true,
      window: { from: "2026-05-01", to: "2026-10-31" },
      months: 6,
    });
    const [cafes, fuel, groceries] = [
      await category(space, "Кафе і ресторани"),
      await category(space, "Пальне"),
      await category(space, "Продукти"),
    ];
    expect(view.expenses.categories.map((r) => r.categoryId)).toEqual([cafes, fuel, groceries]);
    expect(value(rowOf(view.expenses.categories, cafes)!.base)).toBe("43.10");
    expect(view.largest).toHaveLength(3);
    expect(view.largest[0]).toMatchObject({ categoryId: cafes, transactions: { current: 7, base: 1 } });
    expect(value(view.largest[0]!.difference)).toBe("240.00");
    expect(view.largest.map((l) => [l.categoryId, value(l.difference)])).toEqual([
      [cafes, "240.00"],
      [fuel, "-60.00"],
      [groceries, "10.00"],
    ]);
    // Facts only: numbers and codes, no sentence.
    expect(JSON.stringify(view)).not.toMatch(/транзакц|більше|середн/i);
  });

  it("BUD-06@PoC AC5 (server part): 90 days of history — «Той самий період минулого року» unavailable with a reason, the average over the months there are («за 2 міс.»)", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-20.00", "2026-08-14", "Продукти");
    await spend(space, acc, "-30.00", "2026-09-14", "Продукти");
    await spend(space, acc, "-50.00", "2026-10-14", "Продукти");
    await spend(space, acc, "-45.00", "2026-11-03", "Продукти");
    const view = await compare(space, "type=month&period=2026-11&base=avg6");
    expect(view.bases).toEqual([
      { base: "previous", available: true, reason: null, months: null },
      { base: "last-year", available: false, reason: "no_history", months: null },
      { base: "avg3", available: true, reason: null, months: 2 },
      { base: "avg6", available: true, reason: null, months: 2 },
      { base: "avg12", available: true, reason: null, months: 2 },
    ]);
    const groceries = await category(space, "Продукти");
    expect(view.base).toMatchObject({ months: 2, window: { from: "2026-09-01", to: "2026-10-31" } });
    expect(value(rowOf(view.expenses.categories, groceries)!.base)).toBe("40.00");
    const lastYear = await compare(space, "type=month&period=2026-11&base=last-year");
    expect(lastYear.base).toMatchObject({ base: "last-year", available: false, window: null });
    expect(rowOf(lastYear.expenses.categories, groceries)).toMatchObject({ base: null, difference: null });
    expect(lastYear.largest).toEqual([]);
  });

  it("BUD-06@PoC FR 5: «Той самий період минулого року» is available once there is data a year ago", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-25.00", "2025-11-03", "Продукти");
    await spend(space, acc, "-35.00", "2026-11-03", "Продукти");
    const view = await compare(space, "type=month&period=2026-11&base=last-year");
    expect(view.bases.find((b) => b.base === "last-year")).toEqual({
      base: "last-year",
      available: true,
      reason: null,
      months: null,
    });
    expect(view.base.window).toEqual({ from: "2025-11-01", to: "2025-11-12" });
    expect(rowOf(view.expenses.categories, await category(space, "Продукти"))).toMatchObject({
      current: eur("35"),
      base: eur("25"),
    });
  });

  it("BUD-06@PoC FR 4: a finished month without a statement is not in the average — «Сер. за 12 міс.» over 9 months", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    for (const m of ["01", "02", "03", "05", "06", "07", "08", "09", "10"])
      await spend(space, acc, "-90.00", `2026-${m}-05`, "Продукти");
    await spend(space, acc, "-5.00", "2025-12-20", "Продукти");
    await spend(space, acc, "-100.00", "2026-11-05", "Продукти");
    const view = await compare(space, "type=month&period=2026-11&base=avg12");
    expect(view.bases.find((b) => b.base === "avg12")).toMatchObject({ available: true, months: 9 });
    expect(view.base).toMatchObject({ months: 9, window: { from: "2026-01-01", to: "2026-10-31" } });
    // April (no statement) is not a 0 in the average: 810 € ÷ 9, not ÷ 10.
    expect(value(rowOf(view.expenses.categories, await category(space, "Продукти"))!.base)).toBe("90.00");
  });

  it("BUD-06@PoC FR 1: a proportional first period — «План» and «± до плану» are the figures of «Бюджет» (BUD-02 FR 14); the base columns the whole month", async () => {
    now = at("2026-10-18");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2026-10",
      proportional: true,
      limits: [{ categoryId: groceries, amount: eur("300.00") }],
    });
    now = at(TODAY);
    const acc = await account(space);
    await spend(space, acc, "-170.00", "2026-10-05", "Продукти");
    await spend(space, acc, "-120.00", "2026-10-20", "Продукти");
    const period = (await call(space, "GET", "/v1/budget/periods/2026-10")).json();
    const line = period.groups.flatMap((g: { categories: unknown[] }) => g.categories)[0] as {
      limit: Money;
      spent: Money;
    };
    expect(value(line.spent)).toBe("120.00");
    const view = await compare(space, "type=month&period=2026-10");
    const row = rowOf(view.expenses.categories, groceries)!;
    expect(value(row.plan)).toBe(value(line.limit));
    expect(new Decimal(row.planDifference!.amount.amount).toFixed(2)).toBe(
      new Decimal(line.spent.amount).minus(line.limit.amount).toFixed(2),
    );
    expect(row.planDifference!.direction).toBe("down");
    // «Порівняння» itself shows the whole month's spending against the base.
    expect(value(row.current)).toBe("290.00");
    const year = (await call(space, "GET", "/v1/budget/compare/year?year=2026")).json();
    const cell = year.groups
      .flatMap((g: { categories: { categoryId: string; cells: unknown[] }[] }) => g.categories)
      .find((c: { categoryId: string }) => c.categoryId === groceries).cells[9] as {
      fact: Money;
      plan: Money;
      difference: { amount: Money };
    };
    expect(value(cell.fact)).toBe(value(line.spent));
    expect(value(cell.plan)).toBe(value(line.limit));
    expect(value(cell.difference.amount)).toBe(value(row.planDifference!.amount));
  });

  it("BUD-06@PoC AC6: on 31 March the base «Попередній період» is 1–28 February", async () => {
    now = at("2027-03-31");
    const space = await newSpace();
    await createBudget(space, { firstPeriod: "2027-03" });
    const acc = await account(space);
    await spend(space, acc, "-10.00", "2027-02-28", "Продукти");
    await spend(space, acc, "-15.00", "2027-03-30", "Продукти");
    const view = await compare(space, "type=month&period=2027-03");
    expect(view.base.window).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(rowOf(view.expenses.categories, await category(space, "Продукти"))).toMatchObject({
      base: eur("10"),
    });
  });

  it("BUD-06@PoC AC7: «Подарунки» with a zero base and 80 € now — «+80 €» without a percent", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-12.00", "2026-10-02", "Продукти");
    await spend(space, acc, "-80.00", "2026-11-05", "Подарунки");
    const view = await compare(space, "type=month&period=2026-11");
    expect(rowOf(view.expenses.categories, await category(space, "Подарунки"))).toMatchObject({
      current: eur("80"),
      base: eur("0"),
      difference: { amount: eur("80"), percent: null, direction: "up", tone: "loss" },
    });
  });

  it("BUD-06@PoC AC8: a category merged into «Кафе і ресторани» — every period counts its transactions there", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-30.00", "2026-10-03", "Доставка їжі");
    await spend(space, acc, "-20.00", "2026-10-04", "Кафе і ресторани");
    await spend(space, acc, "-25.00", "2026-11-03", "Доставка їжі");
    const [delivery, cafes] = [
      await category(space, "Доставка їжі"),
      await category(space, "Кафе і ресторани"),
    ];
    const merged = await call(space, "POST", `/v1/categories/${delivery}/merge`, { targetId: cafes });
    expect(merged.statusCode, merged.body).toBe(200);
    await runWorker(space.householdId);
    const view = await compare(space, "type=month&period=2026-11&full=true");
    expect(view.expenses.categories.map((r) => r.categoryId)).toEqual([cafes]);
    expect(rowOf(view.expenses.categories, cafes)).toMatchObject({
      current: eur("25"),
      base: eur("50"),
      transactions: { current: 1, base: 2 },
    });
  });

  it("BUD-06@PoC AC9 (server part): October's snapshot limit of «Кафе і ресторани» 200 € and 248,60 € spent — «▲ 48,60 €» saturated red; «Подорожі» no plan", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const [cafes, travel] = [await category(space, "Кафе і ресторани"), await category(space, "Подорожі")];
    const budget = await createBudget(space, {
      firstPeriod: "2026-10",
      limits: [{ categoryId: cafes, amount: eur("200.00") }],
    });
    now = at(TODAY);
    const acc = await account(space);
    await spend(space, acc, "-200.00", "2026-10-06", "Кафе і ресторани");
    await spend(space, acc, "-48.60", "2026-10-20", "Кафе і ресторани");
    await spend(space, acc, "-120.00", "2026-10-21", "Подорожі");
    // A change of the plan in November leaves October's snapshot as it was (BUD-02 FR 11).
    const patch = await call(space, "PATCH", "/v1/budget/plan", {
      version: budget.version,
      limits: [{ categoryId: cafes, amount: eur("300.00") }],
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const view = await compare(space, "type=month&period=2026-10");
    expect(view).toMatchObject({ inProgress: false, finished: true });
    expect(rowOf(view.expenses.categories, cafes)).toMatchObject({
      current: eur("248.6"),
      plan: eur("200"),
      planDifference: { amount: eur("48.6"), percent: "24.3", direction: "up", tone: "loss" },
    });
    expect(rowOf(view.expenses.categories, travel)).toMatchObject({ plan: null, planDifference: null });
    expect(view.expenses.overall).toMatchObject({ current: eur("368.6"), plan: eur("200") });
    // November's plan is the live one.
    const november = await compare(space, "type=month&period=2026-11");
    expect(rowOf(november.expenses.categories, cafes)).toMatchObject({ plan: eur("300") });
  });

  it("BUD-06@PoC AC10 (server part): «З початку року» — January to today, the default base «Той самий період минулого року»", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-10.00", "2025-01-03", "Продукти");
    await spend(space, acc, "-20.00", "2025-11-12", "Продукти");
    await spend(space, acc, "-99.00", "2025-11-13", "Продукти");
    await spend(space, acc, "-40.00", "2026-02-03", "Продукти");
    const view = await compare(space, "type=ytd");
    expect(view).toMatchObject({
      type: "ytd",
      window: { from: "2026-01-01", to: "2026-11-12" },
      year: "2026",
      base: { base: "last-year", available: true, window: { from: "2025-01-01", to: "2025-11-12" } },
    });
    expect(view.bases.map((b) => b.base)).toEqual(["last-year"]);
    expect(rowOf(view.expenses.categories, await category(space, "Продукти"))).toMatchObject({
      current: eur("40"),
      base: eur("30"),
    });
    const res = await call(space, "GET", "/v1/budget/compare?type=ytd&base=avg3");
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([expect.objectContaining({ path: "base", issue: "not_for_type" })]);
  });

  it("BUD-06@PoC AC11 (server part): «Рік: план і факт» for 2026 in November — 12 months, December the plan only, «Разом за рік», «План», «Різниця», «Дохід» on top", async () => {
    now = at("2026-10-05");
    const space = await newSpace();
    const cafes = await category(space, "Кафе і ресторани");
    await createBudget(space, {
      firstPeriod: "2026-10",
      incomePlan: eur("3000.00"),
      limits: [{ categoryId: cafes, amount: eur("200.00") }],
    });
    now = at(TODAY);
    const acc = await account(space);
    await spend(space, acc, "-50.00", "2026-03-06", "Кафе і ресторани");
    await spend(space, acc, "-210.00", "2026-10-06", "Кафе і ресторани");
    await spend(space, acc, "3100.00", "2026-10-07", "Зарплата");
    await spend(space, acc, "-15.00", "2026-10-08", null);
    await spend(space, acc, "-30.00", "2026-11-06", "Кафе і ресторани");
    const res = await call(space, "GET", "/v1/budget/compare/year?year=2026");
    expect(res.statusCode, res.body).toBe(200);
    const y = res.json();
    expect(y.months).toHaveLength(12);
    expect(y.months[11]).toEqual({ period: "2026-12", mode: "future" });
    expect(y.income.cells[11]).toEqual({ fact: null, plan: eur("3000"), difference: null });
    expect(y.income.cells[9]).toMatchObject({
      fact: eur("3100"),
      plan: eur("3000"),
      difference: { tone: "gain-soft" },
    });
    expect(y.income.cells[2]).toEqual({ fact: eur("0"), plan: null, difference: null });
    expect(y.income).toMatchObject({ total: eur("3100"), plan: eur("3000") });
    const rows = y.groups.flatMap((g: { categories: { categoryId: string | null }[] }) => g.categories);
    const cafesRow = rows.find((r: { categoryId: string | null }) => r.categoryId === cafes);
    expect(cafesRow.cells[11]).toEqual({ fact: null, plan: eur("200"), difference: null });
    expect(cafesRow.cells[10]).toMatchObject({
      fact: eur("30"),
      plan: eur("200"),
      difference: { direction: "down" },
    });
    expect(cafesRow.cells[2]).toEqual({ fact: eur("50"), plan: null, difference: null });
    // «Разом за рік», «План», «Різниця» — over the finished months (January to October).
    expect(cafesRow).toMatchObject({
      total: eur("260"),
      plan: eur("200"),
      difference: { amount: eur("60") },
    });
    expect(y.groups.at(-1)).toMatchObject({ groupId: null, total: eur("15") });
    expect(y.expenses).toMatchObject({ total: eur("275"), plan: eur("200") });
  });

  it("BUD-06@PoC AC14 (server part): «III квартал 2026» — the comparison names the year 2026 for «Рік: план і факт»", async () => {
    const space = await newSpace();
    await createBudget(space);
    const view = await compare(space, "type=quarter&period=2026-Q3");
    expect(view).toMatchObject({
      type: "quarter",
      window: { from: "2026-07-01", to: "2026-09-30" },
      year: "2026",
    });
    expect(view.bases.map((b) => b.base)).toEqual(["previous", "last-year", "avg3", "avg6", "avg12"]);
  });

  it("BUD-06@PoC AC13 (server part): the chosen base comes back by its code, so the columns are named by it", async () => {
    const space = await newSpace();
    await createBudget(space);
    for (const base of ["previous", "last-year", "avg12"])
      expect((await compare(space, `type=month&period=2026-10&base=${base}`)).base.base).toBe(base);
  });

  it("BUD-06@PoC EC3: a transfer between own accounts is in neither spending nor income; only the budget's accounts count", async () => {
    const space = await newSpace();
    await createBudget(space);
    const current = await account(space);
    const cash = await account(space, "cash");
    const out = await account(space, "savings");
    const transfer = await call(
      space,
      "POST",
      "/v1/transactions/transfers",
      {
        fromAccountId: current,
        toAccountId: cash,
        amount: eur("700.00"),
        date: "2026-11-04",
        counterparty: "Синтетичний переказ",
      },
      {},
      { "idempotency-key": randomUUID() },
    );
    expect(transfer.statusCode, transfer.body).toBe(201);
    await spend(space, current, "-40.00", "2026-11-05", "Продукти");
    await spend(space, current, "10.00", "2026-11-06", "Продукти");
    await spend(space, out, "-7777.00", "2026-11-06", "Продукти");
    await spend(space, out, "8888.00", "2026-11-06", "Зарплата");
    const res = await call(space, "GET", "/v1/budget/compare?type=month&period=2026-11");
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json() as Compare;
    expect(view.expenses.overall.current).toEqual(eur("30"));
    expect(view.income.overall.current).toEqual(eur("0"));
    expect(leakText(res.body)).not.toMatch(/"amount":"-?(?:700|7777|8888)(?:\.0*)?"/);
  });

  it("#586 cap: an expense past the money range is left out and counted as approximate, never 500", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-" + "9".repeat(20), "2026-11-03", "Продукти");
    await spend(space, acc, "-45.00", "2026-11-05", "Продукти");
    await spend(space, acc, "-12.00", "2026-10-04", "Продукти");
    const view = await compare(space, "type=month&period=2026-11");
    expect(view.expenses.overall).toMatchObject({ current: eur("45"), base: eur("12") });
    expect(view.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 1 });
    // Each amount over 15 integer digits in the base's dates is left out too; one outside them is not counted.
    await spend(space, acc, "-" + "9".repeat(18), "2026-06-03", "Продукти");
    await spend(space, acc, "-" + "9".repeat(18), "2026-09-03", "Продукти");
    for (const m of ["07", "08", "09"]) await spend(space, acc, "-1.00", `2026-${m}-02`, "Продукти");
    const avg = await compare(space, "type=month&period=2026-11&base=avg12");
    expect(avg.base).toMatchObject({ months: 4, window: { from: "2026-07-01", to: "2026-10-31" } });
    expect(avg.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 2 });
    expect(avg.expenses.overall.current).toEqual(eur("45"));
    const year = await call(space, "GET", "/v1/budget/compare/year?year=2026");
    expect(year.statusCode, year.body).toBe(200);
  });

  it("BUD-06@PoC FR 4 (#609 item 1): «Сер. за 3 міс.» counts only its own months in approximate", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"])
      await spend(space, acc, "-1.00", `2026-${m}-02`, "Продукти");
    await spend(space, acc, "-" + "9".repeat(18), "2026-03-03", "Продукти");
    await spend(space, acc, "-5.00", "2026-11-05", "Продукти");
    const v = await compare(space, "type=month&period=2026-11&base=avg3");
    expect(v.base).toMatchObject({ months: 3, window: { from: "2026-08-01", to: "2026-10-31" } });
    expect(v.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
    // «Сер. за 6 міс.» does not reach March either; «Сер. за 12 міс.» does.
    const six = await compare(space, "type=month&period=2026-11&base=avg6");
    expect(six.base).toMatchObject({ months: 6, window: { from: "2026-05-01", to: "2026-10-31" } });
    expect(six.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
    const twelve = await compare(space, "type=month&period=2026-11&base=avg12");
    expect(twelve.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 1 });
  });

  it("BUD-06@PoC AC10 (server part): a past year's «З початку року» — 1 January to the same date of that year, against the year before on that date", async () => {
    now = at("2026-11-19");
    const space = await newSpace();
    await createBudget(space, { firstPeriod: "2026-11" });
    const acc = await account(space);
    await spend(space, acc, "-10.00", "2024-03-03", "Продукти");
    await spend(space, acc, "-99.00", "2024-11-20", "Продукти");
    await spend(space, acc, "-30.00", "2025-11-19", "Продукти");
    await spend(space, acc, "-77.00", "2025-11-20", "Продукти");
    const view = await compare(space, "type=ytd&period=2025");
    expect(view).toMatchObject({
      type: "ytd",
      window: { from: "2025-01-01", to: "2025-11-19" },
      inProgress: false,
      year: "2025",
      base: { base: "last-year", available: true, window: { from: "2024-01-01", to: "2024-11-19" } },
    });
    expect(rowOf(view.expenses.categories, await category(space, "Продукти"))).toMatchObject({
      current: eur("30"),
      base: eur("10"),
    });
    // 2023 has no data before it: its base is unavailable, the period itself is served.
    const older = await compare(space, "type=ytd&period=2024");
    expect(older.window).toEqual({ from: "2024-01-01", to: "2024-11-19" });
    expect(older.base).toMatchObject({ available: false, window: null });
    const res = await call(space, "GET", "/v1/budget/compare?type=ytd&period=2027");
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([expect.objectContaining({ path: "period", issue: "future" })]);
  });

  it("BUD-06@PoC FR 1: the period, the base and the dates are checked — 400 with the field and the issue", async () => {
    const space = await newSpace();
    await createBudget(space);
    const issue = async (query: string) => {
      const res = await call(space, "GET", `/v1/budget/compare?${query}`);
      expect(res.statusCode, res.body).toBe(400);
      return res.json().errors.map((e: { path: string; issue: string }) => `${e.path}: ${e.issue}`);
    };
    expect(await issue("type=month&period=2026-12")).toEqual(["period: future"]);
    expect(await issue("type=month&period=2026-13")).toEqual(["period: invalid"]);
    expect(await issue("type=year&period=2026&base=previous")).toEqual(["base: not_for_type"]);
    // «Власний» is MVP (owner decision 2026-11-19, #606): not a type of this release.
    const custom = await call(space, "GET", "/v1/budget/compare?type=custom&from=2026-10-01&to=2026-10-09");
    expect(custom.statusCode).toBe(400);
    const res = await call(space, "GET", "/v1/budget/compare/year?year=26");
    expect(res.statusCode).toBe(400);
  });

  it("BUD-06@PoC «Права доступу»: another space sees none of the sums; its categories are no rows here; a scoped member and the flag off — not found", async () => {
    const owner = await newSpace();
    const groceries = await category(owner, "Продукти");
    await createBudget(owner, { limits: [{ categoryId: groceries, amount: eur("4321.00") }] });
    const acc = await account(owner);
    await spend(owner, acc, "-1234.00", "2026-11-03", "Продукти");
    const other = await newSpace();
    for (const url of ["/v1/budget/compare?type=month&period=2026-11", "/v1/budget/compare/year?year=2026"]) {
      const theirs = await call(other, "GET", url);
      expect(theirs.statusCode).toBe(404);
      expect(leakText(theirs.body)).not.toContain("4321");
    }
    await createBudget(other);
    const otherAcc = await account(other);
    await spend(other, otherAcc, "-5.00", "2026-11-04", "Продукти");
    const own = await call(other, "GET", "/v1/budget/compare?type=month&period=2026-11");
    expect(own.statusCode, own.body).toBe(200);
    expect(leakText(own.body)).not.toMatch(/"amount":"-?(?:4321|1234)(?:\.0*)?"/);
    // The other space's «Продукти» is its own category: the owner's id is no row of it, and back.
    expect(leakText(own.body)).not.toContain(groceries);
    const mine = await call(owner, "GET", "/v1/budget/compare?type=month&period=2026-11");
    expect(leakText(mine.body)).not.toContain(await category(other, "Продукти"));
    for (const url of ["/v1/budget/compare?type=month&period=2026-11", "/v1/budget/compare/year?year=2026"]) {
      const scoped = await call(owner, "GET", url, undefined, { role: "viewer", scoped: true });
      expect(scoped.statusCode).toBe(404);
      expect(scoped.json().code).toBe("NOT_FOUND");
      expect(leakText(scoped.body)).not.toContain("4321");
      expect(leakText(scoped.body)).not.toContain("1234");
    }
    // The flag requires `budget.period`: off with the budget (as N1 of #603 for the trend).
    expect(FLAGS["budget.compare"]).toMatchObject({ kind: "release", requires: "budget.period" });
    for (const flag of ["budget.compare"]) {
      flagsOff.add(flag);
      try {
        const off = await call(owner, "GET", "/v1/budget/compare?type=month&period=2026-11");
        expect(off.statusCode, flag).toBe(404);
        expect(leakText(off.body)).not.toContain("1234");
      } finally {
        flagsOff.delete(flag);
      }
    }
  });

  it("BUD-06@PoC «Стани інтерфейсу» (server part): without history — no finished periods to compare, every base unavailable; without a budget — not found", async () => {
    const space = await newSpace();
    expect((await call(space, "GET", "/v1/budget/compare?type=month&period=2026-11")).statusCode).toBe(404);
    await createBudget(space);
    const view = await compare(space, "type=month&period=2026-11");
    expect(view.finishedPeriods).toBe(0);
    expect(view.bases.every((b) => !b.available)).toBe(true);
    expect(view.expenses).toEqual({
      overall: expect.objectContaining({ current: eur("0"), base: null }),
      categories: [],
    });
  });
});

describe("BUD-06@PoC (security review of #625): the edges of a past year's «З початку року»", () => {
  const total = (v: Compare) => ({
    current: value(v.expenses.overall.current),
    base: value(v.expenses.overall.base),
    n: v.expenses.overall.transactions,
  });

  it("BUD-06@PoC AC10 (server part): a past year's «З початку року» counts 1 January and the same date, nothing a day outside — in the period and in its base", async () => {
    now = at("2026-11-19");
    const space = await newSpace();
    await createBudget(space, { firstPeriod: "2026-11" });
    const acc = await account(space);
    // The base year 2024: its first day, the same date, the day after, its last day; the day before it.
    await spend(space, acc, "-1000.00", "2023-12-31", "Продукти");
    await spend(space, acc, "-1.00", "2024-01-01", "Продукти");
    await spend(space, acc, "-2.00", "2024-11-19", "Продукти");
    await spend(space, acc, "-4.00", "2024-11-20", "Продукти");
    await spend(space, acc, "-8.00", "2024-12-31", "Продукти");
    // The year 2025: the same four days.
    await spend(space, acc, "-16.00", "2025-01-01", "Продукти");
    await spend(space, acc, "-32.00", "2025-11-19", "Продукти");
    await spend(space, acc, "-64.00", "2025-11-20", "Продукти");
    await spend(space, acc, "-128.00", "2025-12-31", "Продукти");
    // This year: its first day and today.
    await spend(space, acc, "-256.00", "2026-01-01", "Продукти");
    await spend(space, acc, "-512.00", "2026-11-19", "Продукти");

    const past = await compare(space, "type=ytd&period=2025");
    expect(past.base.window).toEqual({ from: "2024-01-01", to: "2024-11-19" });
    expect(total(past)).toEqual({ current: "48.00", base: "3.00", n: { current: 2, base: 2 } });
    const full = await compare(space, "type=ytd&period=2025&full=true");
    expect(full.window).toEqual({ from: "2025-01-01", to: "2025-11-19" });
    expect(full.base.window).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(total(full)).toEqual({ current: "48.00", base: "15.00", n: { current: 2, base: 4 } });
    // The years do not overlap: this year's «З початку року» has neither 31 December nor the cut days of 2025.
    const nowYear = await compare(space, "type=ytd");
    expect(total(nowYear)).toEqual({ current: "768.00", base: "48.00", n: { current: 2, base: 2 } });
    // «Рік» of the same year is the whole of it: the past «З початку року» is its part, never more.
    const year = await compare(space, "type=year&period=2025");
    expect(total(year)).toEqual({ current: "240.00", base: "15.00", n: { current: 4, base: 4 } });
    // 2024 against 2023 on the same date: 31 December 2023 is after it.
    const older = await compare(space, "type=ytd&period=2024");
    expect(total(older)).toEqual({ current: "3.00", base: null, n: { current: 2, base: null } });
    // The history starts on 31 December 2023, after the base's dates: no base, and nothing of that day in it.
    expect(older.base).toMatchObject({ available: false, window: null });
  });

  it("BUD-06@PoC EC1: on 29 February 2028 a past year's «З початку року» counts up to 28 February of a common year and 29 February of a leap one", async () => {
    now = at("2028-02-29");
    const space = await newSpace();
    await createBudget(space, { firstPeriod: "2028-02" });
    const acc = await account(space);
    await spend(space, acc, "-1.00", "2026-02-28", "Продукти");
    await spend(space, acc, "-2.00", "2026-03-01", "Продукти");
    await spend(space, acc, "-4.00", "2027-02-28", "Продукти");
    await spend(space, acc, "-8.00", "2027-03-01", "Продукти");
    await spend(space, acc, "-16.00", "2024-02-29", "Продукти");
    await spend(space, acc, "-32.00", "2024-03-01", "Продукти");
    await spend(space, acc, "-64.00", "2028-02-29", "Продукти");
    const past = await compare(space, "type=ytd&period=2027");
    expect(past.window).toEqual({ from: "2027-01-01", to: "2027-02-28" });
    expect(past.base.window).toEqual({ from: "2026-01-01", to: "2026-02-28" });
    expect(total(past)).toEqual({ current: "4.00", base: "1.00", n: { current: 1, base: 1 } });
    const leap = await compare(space, "type=ytd&period=2024");
    expect(leap.window).toEqual({ from: "2024-01-01", to: "2024-02-29" });
    expect(total(leap).current).toBe("16.00");
    const thisYear = await compare(space, "type=ytd");
    expect(thisYear.base.window).toEqual({ from: "2027-01-01", to: "2027-02-28" });
    expect(total(thisYear)).toEqual({ current: "64.00", base: "4.00", n: { current: 1, base: 1 } });
  });

  it("BUD-06@PoC FR 4 (#609 item 1): the own read of «Сер. за 3 міс.» is the space's — another space's amounts and its «Курс недоступний» count are not in it", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    await createBudget(mine);
    await createBudget(other);
    const acc = await account(mine);
    const theirs = await account(other);
    for (const m of ["01", "08", "09", "10"]) {
      await spend(mine, acc, "-3.00", `2026-${m}-02`, "Продукти");
      await spend(other, theirs, "-7000.00", `2026-${m}-02`, "Продукти");
    }
    await spend(other, theirs, "-" + "9".repeat(18), "2026-09-03", "Продукти");
    const v = await compare(mine, "type=month&period=2026-11&base=avg3");
    expect(v.base).toMatchObject({ months: 3, window: { from: "2026-08-01", to: "2026-10-31" } });
    expect(value(v.expenses.overall.base)).toBe("3.00");
    expect(v.expenses.overall.transactions.base).toBe(1);
    expect(v.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
    // The other space sees its own, with its own count.
    const o = await compare(other, "type=month&period=2026-11&base=avg3");
    expect(o.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 1 });
    // A scoped member of the space gets 404 for a past year's «З початку року» too, with no figures.
    const scoped = await call(mine, "GET", "/v1/budget/compare?type=ytd&period=2025", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(scoped.body).not.toMatch(/amount|window/);
  });

  it("BUD-06@PoC FR 1: the period of «З початку року» is a year from 1900 that has begun — anything else is 400, never 500 or a wide read", async () => {
    const space = await newSpace();
    await createBudget(space);
    for (const [period, issue] of [
      ["1899", "invalid"],
      ["0000", "invalid"],
      ["9999", "future"],
      ["2027", "future"],
      ["2025-01", "invalid"],
      ["2025-Q1", "invalid"],
      ["+2025", "invalid"],
      ["20 25", "invalid"],
      ["२०२५", "invalid"],
      ["", "invalid"],
    ] as const) {
      const res = await call(
        space,
        "GET",
        `/v1/budget/compare?type=ytd&period=${encodeURIComponent(period)}`,
      );
      expect(res.statusCode, `${period}: ${res.body}`).toBe(400);
      expect(res.json().errors, period).toEqual([expect.objectContaining({ path: "period", issue })]);
    }
    const long = await call(space, "GET", "/v1/budget/compare?type=ytd&period=20250000");
    expect(long.statusCode).toBe(400);
    // The oldest year allowed is served, with no base before the history.
    const oldest = await compare(space, "type=ytd&period=1900");
    expect(oldest.window).toEqual({ from: "1900-01-01", to: "1900-11-12" });
    expect(oldest.base).toMatchObject({ available: false, window: null });
  });

  // B1 of the security review of #625 (fixed): the plan fact of a proportional first period stops on the window's last day.
  it("BUD-06@PoC AC10 (server part): a past year's «З початку року» that ends inside a proportional first period — «± до плану» counts the same days as the row, not the days after the same date", async () => {
    now = at("2025-11-10");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2025-11",
      proportional: true,
      limits: [{ categoryId: groceries, amount: eur("300.00") }],
    });
    now = at("2026-11-19");
    const acc = await account(space);
    await spend(space, acc, "-10.00", "2025-11-12", "Продукти");
    await spend(space, acc, "-500.00", "2025-11-25", "Продукти");
    const v = await compare(space, "type=ytd&period=2025");
    expect(v.window).toEqual({ from: "2025-01-01", to: "2025-11-19" });
    for (const r of [rowOf(v.expenses.categories, groceries)!, v.expenses.overall]) {
      expect(value(r.current)).toBe("10.00");
      expect(value(r.plan)).toBe("210.00");
      // 10 − 210: the 500 of 25 November is after the window, in no figure of the row.
      expect(value(r.planDifference!.amount)).toBe("-200.00");
      expect(r.planDifference!.direction).toBe("down");
    }
  });
});

describe("BUD-06@PoC (#625 follow-up): the last day the plan fact of a proportional first period counts", () => {
  it("BUD-06@PoC AC10 (server part): «± до плану» of a past year's «З початку року» counts the window's last day and not the day after", async () => {
    now = at("2025-11-10");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2025-11",
      proportional: true,
      limits: [{ categoryId: groceries, amount: eur("300.00") }],
    });
    now = at("2026-11-19");
    const acc = await account(space);
    await spend(space, acc, "-10.00", "2025-11-12", "Продукти");
    await spend(space, acc, "-20.00", "2025-11-19", "Продукти");
    await spend(space, acc, "-40.00", "2025-11-20", "Продукти");
    const v = await compare(space, "type=ytd&period=2025");
    const r = rowOf(v.expenses.categories, groceries)!;
    expect(value(r.current)).toBe("30.00");
    expect(value(r.plan)).toBe("210.00");
    // 10 + 20 − 210: 19 November is in, 20 November is not.
    expect(value(r.planDifference!.amount)).toBe("-180.00");
  });

  it("BUD-06@PoC AC10 (server part): a proportional first period before the window's last month is read to its own last day — a later month's amounts are counted once", async () => {
    now = at("2025-10-10");
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, {
      firstPeriod: "2025-10",
      proportional: true,
      limits: [{ categoryId: groceries, amount: eur("300.00") }],
    });
    now = at("2026-11-19");
    const acc = await account(space);
    await spend(space, acc, "-7.00", "2025-10-05", "Продукти");
    await spend(space, acc, "-10.00", "2025-10-12", "Продукти");
    await spend(space, acc, "-100.00", "2025-11-05", "Продукти");
    await spend(space, acc, "-500.00", "2025-11-25", "Продукти");
    const v = await compare(space, "type=ytd&period=2025");
    const r = rowOf(v.expenses.categories, groceries)!;
    expect(value(r.current)).toBe("117.00");
    // The plan fact: October from the 10th (10) and November up to the 19th (100), each once.
    expect(new Decimal(r.planDifference!.amount.amount).toFixed(2)).toBe(
      new Decimal("110").minus(r.plan!.amount).toFixed(2),
    );
  });
});
