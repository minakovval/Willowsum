import { randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
import { FLAGS } from "../src/modules/feature-flags/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringHistory,
  createRecurringServices,
} from "../src/modules/recurring/index.ts";
import {
  createBudgetTransactions,
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

/**
 * FLW-38@PoC (wave 2 row 149, the server part of S-135 «Підсумок періоду»): `GET /v1/budget/periods/{period}/summary` —
 * a finished month's income and expenses against the snapshot's plan, the net flow, the savings rate and the month's
 * regular payments with their status, through the real API on a real PostgreSQL with the real categories, accounts,
 * transactions, categorization, recurring and fx-rates modules. Every name and amount is synthetic; the clock is the
 * test's own (the budget starts on 1 October 2026, «today» is 18 November 2026, Kyiv).
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
  method: "GET" | "POST" | "PUT",
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

async function account(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний поточний",
    balance: eur("9000.00"),
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function category(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

/** A transaction of the account in `categoryName` (null — «Без категорії»). */
async function spend(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  categoryName: string | null,
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний продавець",
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

/** A regular payment added by hand on 1 October (so its October charges are its own). */
async function payment(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/recurring/payments", {
    type: "expense",
    frequency: "month",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await db.owner.query(
    `UPDATE recurring.payments SET created_on = '2026-10-01' WHERE household_id = $1 AND id = $2`,
    [space.householdId, id],
  );
  return id;
}

/** The budget from 1 October 2026 (created on that day). */
async function octoberBudget(space: Space, body: Record<string, unknown>) {
  now = at("2026-10-01");
  try {
    const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-10", ...body });
    expect(res.statusCode, res.body).toBe(201);
  } finally {
    now = at(TODAY);
  }
}

const summaryUrl = (period: string) => `/v1/budget/periods/${period}/summary`;

interface Summary {
  period: string;
  currency: string;
  window: { from: string; to: string };
  income: { actual: Money; plan: Money; difference: Money };
  expenses: { actual: Money; plan: Money; difference: Money };
  netFlow: Money;
  savingsRate: string | null;
  regularPayments: {
    count: number;
    paid: number;
    late: number;
    missed: number;
    items: {
      paymentId: string;
      categoryId: string | null;
      dueOn: string;
      expected: Money;
      status: string;
      paidOn: string | null;
      overdueDays: number | null;
    }[];
  } | null;
  approximate: { nearestRateCount: number; unavailableCount: number };
}
type Money = { amount: string; currency: string };

async function summary(space: Space, period: string): Promise<Summary> {
  const res = await call(space, "GET", summaryUrl(period));
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Summary;
}

/** The exact decimal of an amount: «900» and «900.00» are one amount. */
const value = (m: Money) => ({ amount: new Decimal(m.amount).toFixed(2), currency: m.currency });

/**
 * The October of AC5: income 4 000 € («Зарплата»), limits 3 000 € («Продукти» 2 000 €, «Кафе і ресторани» 1 000 €),
 * spent 1 800 € + 1 200 € in them and 100 € «Без категорії» (outside the plan) — 3 100 € of expenses.
 */
async function october(space: Space) {
  const groceries = await category(space, "Продукти");
  const cafes = await category(space, "Кафе і ресторани");
  await octoberBudget(space, {
    incomePlan: eur("4000.00"),
    limits: [
      { categoryId: groceries, amount: eur("2000.00") },
      { categoryId: cafes, amount: eur("1000.00") },
    ],
  });
  const acc = await account(space);
  await spend(space, acc, "4000.00", "2026-10-03", "Зарплата");
  await spend(space, acc, "-150.00", "2026-10-10", "Продукти");
  await spend(space, acc, "-1650.00", "2026-10-20", "Продукти");
  await spend(space, acc, "-1200.00", "2026-10-15", "Кафе і ресторани");
  await spend(space, acc, "-100.00", "2026-10-22", null);
  return { acc, groceries, cafes };
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  const recurring = createRecurringServices({
    history: createTransactionHistory(db.databases.for("transactions")),
    transactionCategories: createTransactionCategories(db.databases.for("categorization")),
    fx,
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    accounts,
    categories: directory,
    audit,
    clock,
    newId: randomUUID,
  });
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
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [
            createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices),
            createRecurringCategoryUsage(db.databases.for("recurring")),
          ],
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
        }),
        recurring,
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
          chargeHistory: createRecurringHistory(db.databases.for("recurring"), recurring),
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
  now = at(TODAY);
  flagsOff.clear();
});

describe("FLW-38@PoC FR 1: «Підсумок періоду» of a finished month (GET /v1/budget/periods/{period}/summary)", () => {
  it("FLW-38@PoC AC5: income 4 000 € and expenses 3 100 € — net flow 900 €, savings rate 22,5 %; plan against fact with «Поза планом» in the expenses", async () => {
    const space = await newSpace();
    await october(space);
    const s = await summary(space, "2026-10");
    expect(s).toMatchObject({
      period: "2026-10",
      currency: "EUR",
      window: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect([value(s.income.actual), value(s.income.plan), value(s.income.difference)]).toEqual([
      eur("4000.00"),
      eur("4000.00"),
      eur("0.00"),
    ]);
    expect([value(s.expenses.actual), value(s.expenses.plan), value(s.expenses.difference)]).toEqual([
      eur("3100.00"),
      eur("3000.00"),
      eur("100.00"),
    ]);
    expect(value(s.netFlow)).toEqual(eur("900.00"));
    expect(s.savingsRate).toBe("22.5");
    expect(s.approximate).toEqual({ nearestRateCount: 0, unavailableCount: 0 });
    // The same plan and fact as the categories table of the period (BUD-02 FR 16: the snapshot's plan, the live fact).
    const p = (await call(space, "GET", "/v1/budget/periods/2026-10")).json();
    expect(p.mode).toBe("past");
    expect(value(p.totals.limits)).toEqual(value(s.expenses.plan));
    expect(
      new Decimal(p.totals.spent.amount).plus(p.outsidePlan.total.amount).equals(s.expenses.actual.amount),
    ).toBe(true);
    expect(value(p.incomeActual)).toEqual(value(s.income.actual));
  });

  it("FLW-38@PoC FR 1: the card «Регулярні платежі» — «сплачено 2 з 3 · 1 із запізненням», each charge with its status and the day paid", async () => {
    const space = await newSpace();
    const { acc, groceries } = await october(space);
    // Paid on its date by the «Продукти» transaction of 150 € (same category, ± 10 %).
    const food = await payment(space, {
      name: "Синтетична доставка",
      amount: eur("150.00"),
      anchorDate: "2026-10-10",
      categoryId: groceries,
    });
    // Unpaid in October, paid in November by «Зарахувати за жовтень» — «Сплачено із запізненням».
    const subscription = await payment(space, {
      name: "Синтетична підписка",
      amount: eur("9.99"),
      anchorDate: "2026-10-05",
    });
    // Never paid — «Прострочено».
    const gym = await payment(space, {
      name: "Синтетичний спортзал",
      amount: eur("40.00"),
      anchorDate: "2026-10-14",
    });
    const late = await spend(space, acc, "-9.99", "2026-11-12", null);
    const settled = await call(
      space,
      "POST",
      `/v1/recurring/payments/${subscription}/charges/2026-10-05/settle`,
      {
        transactionId: late,
      },
    );
    expect(settled.statusCode, settled.body).toBe(200);
    const r = (await summary(space, "2026-10")).regularPayments!;
    expect({ count: r.count, paid: r.paid, late: r.late, missed: r.missed }).toEqual({
      count: 3,
      paid: 2,
      late: 1,
      missed: 1,
    });
    expect(r.items.map((c) => [c.paymentId, c.dueOn, c.status, c.paidOn])).toEqual([
      [subscription, "2026-10-05", "paid-late", "2026-11-12"],
      [food, "2026-10-10", "paid", "2026-10-10"],
      [gym, "2026-10-14", "overdue", null],
    ]);
    expect(r.items[1]).toMatchObject({ categoryId: groceries, expected: { currency: "EUR" } });
    expect(value(r.items[1]!.expected)).toEqual(eur("150.00"));
    expect(r.items[2]!.overdueDays).toBeGreaterThan(0);
    // November's charges are no part of October's summary; the late payment counts in November's fact, not October's.
    expect(r.items.every((c) => c.dueOn.startsWith("2026-10"))).toBe(true);
    expect(value((await summary(space, "2026-10")).expenses.actual)).toEqual(eur("3100.00"));
  });

  it("FLW-38@PoC EC1: a month without income — the savings rate is «–» (null), the net flow negative", async () => {
    const space = await newSpace();
    await octoberBudget(space, { incomePlan: eur("1000.00") });
    const acc = await account(space);
    await spend(space, acc, "-800.00", "2026-10-07", "Продукти");
    const s = await summary(space, "2026-10");
    expect(s.savingsRate).toBeNull();
    expect(value(s.netFlow)).toEqual(eur("-800.00"));
    expect(value(s.income.difference)).toEqual(eur("-1000.00"));
    // No regular payments — an empty card, not an unknown one.
    expect(s.regularPayments).toEqual({ count: 0, paid: 0, late: 0, missed: 0, items: [] });
  });

  it("FLW-38@PoC FR 1: only a finished month — the current or a later one is 400 `not_finished`, a month before the budget 404, a malformed one 400", async () => {
    const space = await newSpace();
    expect((await call(space, "GET", summaryUrl("2026-10"))).statusCode).toBe(404);
    await octoberBudget(space, {});
    for (const period of ["2026-11", "2026-12"]) {
      const res = await call(space, "GET", summaryUrl(period));
      expect(res.statusCode, period).toBe(400);
      expect(res.json().errors).toEqual([{ in: "path", path: "period", issue: "not_finished" }]);
    }
    const before = await call(space, "GET", summaryUrl("2026-09"));
    expect([before.statusCode, before.json().code]).toEqual([404, "BUDGET_PERIOD_BEFORE_START"]);
    for (const period of ["2026-13", "26-10", "2026-1"]) {
      const res = await call(space, "GET", summaryUrl(period));
      expect(res.statusCode, period).toBe(400);
    }
    expect((await call(space, "GET", summaryUrl("2026-100000"))).statusCode).toBe(400);
  });

  it("FLW-38@PoC FR 1 (isolation): another space sees none of the sums or charges; a scoped member and the flags off — not found", async () => {
    const owner = await newSpace();
    const { groceries } = await october(owner);
    const paymentId = await payment(owner, {
      name: "Синтетична доставка",
      amount: eur("150.00"),
      anchorDate: "2026-10-10",
      categoryId: groceries,
    });
    const other = await newSpace();
    const theirs = await call(other, "GET", summaryUrl("2026-10"));
    expect(theirs.statusCode).toBe(404);
    expect(leakText(theirs.body)).not.toContain("4000");
    // With a budget of its own, the other space reads its own month only.
    await octoberBudget(other, { incomePlan: eur("77.00") });
    const own = await summary(other, "2026-10");
    expect(value(own.income.plan)).toEqual(eur("77.00"));
    expect(value(own.expenses.actual)).toEqual(eur("0.00"));
    expect(own.regularPayments!.items).toEqual([]);
    const ownBody = leakText((await call(other, "GET", summaryUrl("2026-10"))).body);
    expect(ownBody).not.toContain(paymentId);
    expect(ownBody).not.toMatch(/"amount":"-?(?:4000|3100|1650|150)(?:\.0*)?"/);
    // A scoped member: «бюджет і цілі» closed.
    const scoped = await call(owner, "GET", summaryUrl("2026-10"), undefined, {
      role: "viewer",
      scoped: true,
    });
    expect([scoped.statusCode, scoped.json().code]).toEqual([404, "NOT_FOUND"]);
    expect(leakText(scoped.body)).not.toContain("4000");
    // The release flag (it requires `budget.period`: off with the budget — flw38-summary-flag.test.ts).
    expect(FLAGS["budget.summary"]).toMatchObject({ kind: "release", requires: "budget.period" });
    for (const flag of ["budget.summary"]) {
      flagsOff.add(flag);
      const off = await call(owner, "GET", summaryUrl("2026-10"));
      expect(off.statusCode, flag).toBe(404);
      expect(leakText(off.body)).not.toContain("4000");
      flagsOff.delete(flag);
    }
  });
});
