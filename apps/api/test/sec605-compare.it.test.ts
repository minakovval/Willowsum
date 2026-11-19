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
 * Security review of #605 (BUD-06@PoC a): guards the mutants of the review survived. The server part of «Порівняння»: spending and income of the budget's accounts by
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

const get = (space: Space, url: string) => call(space, "GET", url);
const YEAR_URL = "/v1/budget/compare/year?year=2026";
const MONTH_URL = "/v1/budget/compare?type=month&period=2026-11";

describe("BUD-06@PoC (security review of #605): the guards of «Порівняння»", () => {
  it("BUD-06@PoC «Права доступу»: with the flag `budget.compare` off «Рік: план і факт» is not found either", async () => {
    const space = await newSpace();
    await createBudget(space);
    const acc = await account(space);
    await spend(space, acc, "-1234.00", "2026-11-03", "Продукти");
    expect((await get(space, YEAR_URL)).statusCode).toBe(200);
    flagsOff.add("budget.compare");
    try {
      for (const url of [YEAR_URL, MONTH_URL]) {
        const off = await get(space, url);
        expect(off.statusCode, url).toBe(404);
        expect(leakText(off.body)).not.toContain("1234");
      }
    } finally {
      flagsOff.delete("budget.compare");
    }
  });

  it("BUD-06@PoC FR 5: the history starts at the first transaction the budget counts — not an account outside the budget, a hidden one or a transfer", async () => {
    const space = await newSpace();
    await createBudget(space);
    const current = await account(space);
    const cash = await account(space, "cash");
    const outside = await account(space, "savings");
    await spend(space, current, "-10.00", "2026-11-03", "Продукти");
    const noHistory = async (step: string) => {
      const view = await compare(space, "type=month&period=2026-11");
      expect(view.finishedPeriods, step).toBe(0);
      expect(
        view.bases.filter((b) => b.available),
        step,
      ).toEqual([]);
      expect(view.base, step).toMatchObject({ available: false, window: null });
    };
    await noHistory("only this month");
    await spend(space, outside, "-7777.00", "2025-01-10", "Продукти");
    await noHistory("an account outside the budget");
    const hidden = await spend(space, current, "-70.00", "2026-03-03", "Продукти");
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, hidden],
    );
    await noHistory("a hidden transaction");
    const transfer = await call(
      space,
      "POST",
      "/v1/transactions/transfers",
      {
        fromAccountId: current,
        toAccountId: cash,
        amount: eur("700.00"),
        date: "2026-05-04",
        counterparty: "Синтетичний переказ",
      },
      {},
      { "idempotency-key": randomUUID() },
    );
    expect(transfer.statusCode, transfer.body).toBe(201);
    await noHistory("a transfer between own accounts");
    // A counted transaction does move the start.
    await spend(space, current, "-5.00", "2026-09-20", "Продукти");
    expect((await compare(space, "type=month&period=2026-11")).finishedPeriods).toBe(2);
  });

  it("BUD-06@PoC FR 1: a share «На кілька місяців» counts once, in its own month — in the window, in the base and in the year", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space);
    const acc = await account(space);
    const yearly = await spend(space, acc, "-1200.00", "2026-09-10", null);
    const split = await call(space, "POST", `/v1/transactions/${yearly}/split`, {
      mode: "months",
      startMonth: "2026-09",
      months: 12,
      categoryId: groceries,
    });
    expect(split.statusCode, split.body).toBe(200);
    const view = await compare(space, "type=month&period=2026-11");
    expect(value(rowOf(view.expenses.categories, groceries)?.current)).toBe("100.00");
    expect(value(rowOf(view.expenses.categories, groceries)?.base)).toBe("100.00");
    expect(value(view.expenses.overall.current)).toBe("100.00");
    const quarter = await compare(space, "type=quarter&period=2026-Q3");
    expect(value(quarter.expenses.overall.current)).toBe("100.00");
    const year = (await get(space, YEAR_URL)).json() as {
      expenses: { cells: { fact: Money | null }[]; total: Money };
    };
    expect(year.expenses.cells.map((c) => value(c.fact) ?? null)).toEqual([
      ...Array.from({ length: 8 }, () => "0.00"),
      "100.00",
      "100.00",
      "100.00",
      null,
    ]);
    expect(value(year.expenses.total)).toBe("200.00");
  });

  // Defect N1 (security review of #605): year 0000 is no date of PostgreSQL — fixed by `isCompareYear`.
  it("BUD-06@PoC FR 1: a year the calendar does not have is 400, never 500", async () => {
    const space = await newSpace();
    await createBudget(space);
    for (const url of [
      "/v1/budget/compare/year?year=0000",
      "/v1/budget/compare?type=year&period=0000",
      "/v1/budget/compare?type=month&period=0000-01",
      "/v1/budget/compare?type=quarter&period=0000-Q1",
    ])
      expect((await get(space, url)).statusCode, url).toBe(400);
  });
});
