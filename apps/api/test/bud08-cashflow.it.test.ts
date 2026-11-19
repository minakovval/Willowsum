import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createCashflowServices } from "../src/modules/cashflow/index.ts";
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
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import {
  createTransferMatchingServices,
  createTransferProposalSides,
} from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-08@PoC a) (wave 2 row 37), the server part of the module `cashflow`, through the real API on a real PostgreSQL with
 * the real categories, accounts, transactions, categorization, transfer-matching and fx-rates modules: income, spending,
 * net flow and the savings rate of a month and of the months of a period; transfers, pending pairs and «Переказ» left
 * out; uncategorized inflows; split transactions; rates of the date; the space's boundary. Every name and amount is
 * synthetic; the clock is the test's own.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-19";
const clock = { now: () => Date.parse(`${TODAY}T10:00:00Z`) };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
testTelemetryForFile();
/** Release flags switched off for the space while a test runs (security review, #580). */
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
  method: "GET" | "POST" | "PUT",
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
    balance: { amount: "50000.00", currency },
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
async function tx(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  categoryName: string | null,
  currency = "EUR",
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний контрагент",
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

async function cashflow(space: Space, type: string, period: string) {
  const res = await call(space, "GET", `/v1/cashflow?type=${type}&period=${period}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

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
          totals: createListTotals({ rates: officialDatedRates(rates), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
          categories: directory,
          flags: fakeFlags(),
          rates: (requests) => rates.rates(requests),
        }),
        categories: createCategoriesServices({ audit, clock, newId: randomUUID, usage: [] }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates: (requests) => rates.rates(requests),
        }),
        cashflow: createCashflowServices({
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          transfers: createTransferProposalSides({
            candidates: createTransferCandidates(db.databases.for("transactions")),
            rates: (requests) => rates.rates(requests),
          }),
          fx,
          clock,
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

describe("BUD-08@PoC: a month", () => {
  it("BUD-08@PoC FR 3, FR 12: income 6 000 €, spending 4 500 € — net flow 1 500 €, savings rate 25,0 %, in the space's currency", async () => {
    const space = await newSpace();
    const acc = await account(space);
    await tx(space, acc, "6000.00", "2026-09-05", "Зарплата");
    await tx(space, acc, "-4000.00", "2026-09-10", "Продукти");
    await tx(space, acc, "-500.00", "2026-09-30", "Продукти");
    await tx(space, acc, "-77.00", "2026-10-01", "Продукти"); // the next month
    const view = await cashflow(space, "month", "2026-09");
    expect(view).toMatchObject({ type: "month", view: "month", currency: "EUR", empty: false });
    expect(view.months).toEqual([
      {
        month: "2026-09",
        income: eur("6000"),
        expenses: eur("4500"),
        netFlow: eur("1500"),
        savingsRate: "25.0",
        uncategorizedInflows: { count: 0, amount: eur("0") },
      },
    ]);
    expect(view.totals).toMatchObject({ netFlow: eur("1500"), savingsRate: "25.0" });
  });

  it("BUD-08@PoC AC3, EC1: no income, spending 800 € — the rate «–» (null), net flow −800 €", async () => {
    const space = await newSpace();
    const acc = await account(space);
    await tx(space, acc, "-800.00", "2026-10-12", "Продукти");
    const view = await cashflow(space, "month", "2026-10");
    expect(view.months[0]).toMatchObject({ income: eur("0"), netFlow: eur("-800"), savingsRate: null });
    expect(view.totals.savingsRate).toBeNull();
    expect(view.totals.averageMonthlyRate).toBeNull();
  });

  it("BUD-08@PoC AC4: a 1 000 € transfer from the current account to a savings account of the space is neither income nor spending", async () => {
    const space = await newSpace();
    const current = await account(space);
    const savings = await account(space, "savings");
    const res = await call(
      space,
      "POST",
      "/v1/transactions/transfers",
      {
        fromAccountId: current,
        toAccountId: savings,
        amount: eur("1000.00"),
        date: "2026-09-15",
        counterparty: "Синтетичний переказ",
      },
      {},
      { "idempotency-key": randomUUID() },
    );
    expect(res.statusCode, res.body).toBe(201);
    await tx(space, current, "-100.00", "2026-09-16", "Продукти");
    const view = await cashflow(space, "month", "2026-09");
    expect(view.months[0]).toMatchObject({ income: eur("0"), expenses: eur("100"), netFlow: eur("-100") });
    expect(view.unpairedTransfers).toBe(0);
  });

  it("BUD-08@PoC FR 8: a proposed pair awaiting confirmation is left out and counted in «Перекази без пари»; «Переказ» one-sided is neither", async () => {
    const space = await newSpace();
    const current = await account(space);
    const savings = await account(space, "savings");
    // The same amount out of one own account and into another two days apart: a proposed transfer (FIN-03 FR 5).
    const out = await tx(space, current, "-400.00", "2026-09-20", null);
    await tx(space, savings, "400.00", "2026-09-21", null);
    const proposals = await call(space, "GET", "/v1/transfer-proposals");
    expect(proposals.statusCode, proposals.body).toBe(200);
    expect(
      proposals.json().items.map((p: { outflow: { transactionId: string } }) => p.outflow.transactionId),
    ).toEqual([out]);
    // A card payment, one-sided, in «Переказ» — as a bank import categorizes it (the category route refuses a service one).
    const card = await tx(space, current, "-250.00", "2026-09-22", null);
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, 'bank')`,
      [space.householdId, card, await category(space, "Переказ")],
    );
    await tx(space, current, "-60.00", "2026-09-23", "Продукти");
    const view = await cashflow(space, "month", "2026-09");
    expect(view.months[0]).toMatchObject({ income: eur("0"), expenses: eur("60") });
    // Only the budget account's side is in the screen (the savings account is not a budget account).
    expect(view.unpairedTransfers).toBe(1);
    // Confirmed: a transfer between own accounts, no longer awaiting its pair.
    const pair = proposals.json().items[0] as { inflow: { transactionId: string } };
    const marked = await call(space, "POST", `/v1/transactions/${out}/transfer`, {
      counterpartId: pair.inflow.transactionId,
    });
    expect(marked.statusCode, marked.body).toBe(200);
    const after = await cashflow(space, "month", "2026-09");
    expect(after.unpairedTransfers).toBe(0);
    expect(after.months[0].expenses).toEqual(eur("60"));
    // Both sides on budget accounts (security review, #580): neither counts — the inflow does not lower the spending.
    const cash = await account(space, "cash");
    await tx(space, current, "-700.00", "2026-08-10", null);
    await tx(space, cash, "700.00", "2026-08-10", null);
    const august = await cashflow(space, "month", "2026-08");
    expect(august.months[0]).toMatchObject({ income: eur("0"), expenses: eur("0") });
    expect(august.months[0].uncategorizedInflows.count).toBe(0);
    expect(august.unpairedTransfers).toBe(2);
  });

  it("BUD-08@PoC FR 9: an uncategorized inflow lowers spending, is not income, and the hint counts it", async () => {
    const space = await newSpace();
    const acc = await account(space);
    await tx(space, acc, "-300.00", "2026-09-03", "Продукти");
    await tx(space, acc, "45.00", "2026-09-04", null);
    await tx(space, acc, "-15.00", "2026-09-05", null);
    const view = await cashflow(space, "month", "2026-09");
    expect(view.months[0]).toMatchObject({
      income: eur("0"),
      expenses: eur("270"),
      uncategorizedInflows: { count: 1, amount: eur("45") },
    });
  });

  it("BUD-08@PoC FR 13: a split by categories counts by its parts; a split over months counts whole in the month of payment", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const groceries = await category(space, "Продукти");
    const salary = await category(space, "Зарплата");
    await tx(space, acc, "1000.00", "2026-09-01", "Зарплата");
    const byCategories = await tx(space, acc, "-186.00", "2026-09-06", null);
    const split = await call(space, "POST", `/v1/transactions/${byCategories}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries, amount: "-150.00" },
        { categoryId: await category(space, "Побутова хімія"), amount: "-36.00" },
      ],
    });
    expect(split.statusCode, split.body).toBe(200);
    const yearly = await tx(space, acc, "-1200.00", "2026-09-10", null);
    const months = await call(space, "POST", `/v1/transactions/${yearly}/split`, {
      mode: "months",
      startMonth: "2026-09",
      months: 12,
      categoryId: groceries,
    });
    expect(months.statusCode, months.body).toBe(200);
    const sept = await cashflow(space, "month", "2026-09");
    expect(sept.months[0]).toMatchObject({
      income: eur("1000"),
      expenses: eur("1386"),
      netFlow: eur("-386"),
    });
    const oct = await cashflow(space, "month", "2026-10");
    expect(oct.months[0].expenses).toEqual(eur("0"));
    expect(oct.empty).toBe(true);
    expect(salary).toBeTruthy();
  });

  it("BUD-08@PoC EC4: an amount without its date's rate counts at the nearest one «приблизно»; a currency without any rate is left out", async () => {
    const space = await newSpace();
    const eurAcc = await account(space);
    const uah = await account(space, "current", "UAH");
    const usd = await account(space, "current", "USD");
    await rate("2025-12-31", "EUR", "45.00");
    await rate("2026-09-01", "EUR", "40.00");
    await tx(space, eurAcc, "3000.00", "2026-09-01", "Зарплата");
    await tx(space, uah, "-2000.00", "2026-09-10", "Продукти", "UAH");
    await tx(space, usd, "-10.00", "2026-09-10", "Продукти", "USD");
    const approximate = await cashflow(space, "month", "2026-09");
    expect(approximate.months[0].expenses).toEqual(eur("50"));
    expect(approximate.approximate).toEqual({ nearestRateCount: 1, unavailableCount: 1 });
    await rate("2026-09-10", "EUR", "50.00");
    await rate("2026-09-10", "USD", "40.00");
    const exact = await cashflow(space, "month", "2026-09");
    // 2 000 / 50 = 40 € and 10 $ × 40 / 50 = 8 €.
    expect(exact.months[0].expenses).toEqual(eur("48"));
    expect(exact.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
  });

  it("BUD-08@PoC FR 12: only the budget's accounts count; empty — «Немає транзакцій рахунків бюджету»", async () => {
    const space = await newSpace();
    const savings = await account(space, "savings");
    await tx(space, savings, "25.00", "2026-09-30", "Зарплата");
    const view = await cashflow(space, "month", "2026-09");
    expect(view.empty).toBe(true);
    expect(view.months[0]).toMatchObject({ income: eur("0"), expenses: eur("0") });
  });
});

describe("BUD-08@PoC: the months of a period", () => {
  it("BUD-08@PoC AC5 (server part): the types month, quarter, ytd and year; «Власний» is refused; a year shows 12 months «Помісячно»", async () => {
    const space = await newSpace();
    const custom = await call(space, "GET", "/v1/cashflow?type=custom&period=2026");
    expect(custom.statusCode).toBe(400);
    const bad = await call(space, "GET", "/v1/cashflow?type=quarter&period=2026-09");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "query", path: "period", issue: "invalid" }]);
    const year = await cashflow(space, "year", "2026");
    expect(year.view).toBe("monthly");
    expect(year.months.map((m: { month: string }) => m.month)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`),
    );
    const ytd = await cashflow(space, "ytd", "2026");
    expect(ytd.months).toHaveLength(11);
    expect(ytd.empty).toBe(true);
  });

  it("BUD-08@PoC AC6: III quarter 2026 with income 18 000 € and spending 13 500 € — 3 months, the quarter's rate 25,0 %", async () => {
    const space = await newSpace();
    const acc = await account(space);
    for (const [m, spent] of [
      ["07", "-3000.00"],
      ["08", "-6000.00"],
      ["09", "-4500.00"],
    ] as const) {
      await tx(space, acc, "6000.00", `2026-${m}-01`, "Зарплата");
      await tx(space, acc, spent, `2026-${m}-15`, "Продукти");
    }
    const view = await cashflow(space, "quarter", "2026-Q3");
    expect(view.view).toBe("monthly");
    expect(view.months.map((m: { month: string; savingsRate: string }) => [m.month, m.savingsRate])).toEqual([
      ["2026-07", "50.0"],
      ["2026-08", "0.0"],
      ["2026-09", "25.0"],
    ]);
    expect(view.totals).toEqual({
      income: eur("18000"),
      expenses: eur("13500"),
      netFlow: eur("4500"),
      savingsRate: "25.0",
      averageMonthlyRate: "25.0",
      highest: "2026-07",
      lowest: "2026-08",
    });
  });
});

describe("BUD-08@PoC: access", () => {
  it("BUD-08@PoC «Права доступу»: another space sees none of this space's sums; a scoped member — not found, as the budget", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const acc = await account(owner);
    await tx(owner, acc, "6000.00", "2026-09-05", "Зарплата");
    await tx(owner, acc, "-4500.00", "2026-09-10", "Продукти");
    const theirs = await cashflow(other, "month", "2026-09");
    expect(theirs.empty).toBe(true);
    expect(theirs.months[0]).toMatchObject({ income: eur("0"), expenses: eur("0") });
    expect(theirs.unpairedTransfers).toBe(0);
    const scoped = await call(owner, "GET", "/v1/cashflow?type=month&period=2026-09", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(Object.keys(scoped.json()).sort()).toEqual(
      Object.keys((await call(owner, "GET", "/v1/nothing-here")).json()).sort(),
    );
    expect(scoped.json().code).toBe("NOT_FOUND");
    // The release flag off for the space (it ships off): the route is not there, for the owner too (security review, #580).
    flagsOff.add("budget.cashflow");
    try {
      const off = await call(owner, "GET", "/v1/cashflow?type=month&period=2026-09");
      expect(off.statusCode).toBe(404);
      expect(off.json().code).toBe("NOT_FOUND");
      expect(off.body).not.toContain("6000");
    } finally {
      flagsOff.delete("budget.cashflow");
    }
  });
});
