import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountsServices,
  createCreditAccounts,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringLoans,
  createRecurringServices,
} from "../src/modules/recurring/index.ts";
import {
  createAccountInflows,
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-07@PoC FR 7, FR 16, FR 19, AC2 (wave 2 row 26, the rest of part b2): `GET /v1/recurring/calendar` through the real
 * API on a real PostgreSQL — the charges of a range of 1–366 days, the monthly payments of «Кредит» accounts with their
 * interest (modules accounts, liabilities, transactions, ledger), the month's and the year's totals at today's NBU rate,
 * the budget card's header, another space and a scoped member. Every name and amount is synthetic; the clock is fixed
 * (18 November 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-18";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const clock = { now: () => NOW };

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

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown, scoped = false) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, scoped }),
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

async function account(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", body);
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

const current = (space: Space) =>
  account(space, {
    kind: "current",
    name: "Синтетичний поточний",
    balance: eur("5000.00"),
    balanceDate: "2026-01-01",
  });

const loan = (space: Space, name = "Синтетичний кредит") =>
  account(space, {
    kind: "loan",
    name,
    balance: eur("9000.00"),
    balanceDate: "2026-01-01",
    annualRate: "12",
    monthlyPayment: "250.00",
  });

/** A regular payment added by hand («Додати вручну») on `createdOn`. */
async function payment(
  space: Space,
  body: Record<string, unknown>,
  createdOn = "2026-11-01",
): Promise<string> {
  const res = await call(space, "POST", "/v1/recurring/payments", {
    type: "expense",
    frequency: "month",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await db.owner.query(`UPDATE recurring.payments SET created_on = $3 WHERE household_id = $1 AND id = $2`, [
    space.householdId,
    id,
    createdOn,
  ]);
  return id;
}

async function transaction(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  counterparty = "Синтетичний продавець",
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty,
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

interface CalendarItem {
  kind: string;
  paymentId: string | null;
  accountId: string | null;
  name: string;
  type: string;
  subscription: boolean;
  dueOn: string;
  expectedAmount: { amount: string; currency: string };
  status: string;
  overdueDays: number | null;
  transactionId: string | null;
  paidOn: string | null;
  counted: boolean;
  interest: { amount: string; currency: string } | null;
}

async function calendar(space: Space, query = "") {
  const res = await call(space, "GET", `/v1/recurring/calendar${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    from: string;
    to: string;
    items: CalendarItem[];
    loans: { accountId: string; name: string; monthlyPayment: unknown; annualRate: string | null }[];
    totals: Record<string, unknown>;
    period: Record<string, unknown>;
  };
}

const brief = (i: CalendarItem) => [i.dueOn, i.name, i.expectedAmount.amount, i.status];

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const recurring = createRecurringServices({
    history: createTransactionHistory(db.databases.for("transactions")),
    transactionCategories: createTransactionCategories(db.databases.for("categorization")),
    fx,
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    accounts: createAccountDirectory(db.databases.for("accounts")),
    categories: directory,
    loans: createRecurringLoans({
      credit: createCreditAccounts(db.databases.for("accounts")),
      liabilities,
      inflows: createAccountInflows(db.databases.for("transactions")),
      ledger,
    }),
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
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities,
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx,
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
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
          usage: [createRecurringCategoryUsage(db.databases.for("recurring"))],
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
        }),
        recurring,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(async () => {
  await db.owner.query(`DELETE FROM fx_rates.rates`);
});

/** Rent paid on the 5th, a cinema subscription and a gym still expected, a yearly insurance, a salary not received. */
async function household(space: Space) {
  const acc = await current(space);
  const rent = await payment(space, {
    name: "Синтетична оренда",
    amount: eur("700.00"),
    anchorDate: "2026-11-05",
  });
  const paid = await transaction(space, acc, "-700.00", "2026-11-05", "Синтетичний орендодавець");
  await payment(space, {
    name: "Синтетичне кіно",
    amount: eur("11.99"),
    anchorDate: "2026-10-30",
    subscription: true,
  });
  await payment(space, { name: "Синтетичний спортзал", amount: eur("40.00"), anchorDate: "2026-11-25" });
  await payment(space, {
    name: "Синтетична страховка",
    amount: eur("96.00"),
    frequency: "year",
    anchorDate: "2027-03-01",
  });
  await payment(space, {
    name: "Синтетична зарплата",
    type: "income",
    amount: eur("2000.00"),
    anchorDate: "2026-11-10",
  });
  return { acc, rent, paid };
}

describe("BUD-07@PoC FR 7: the calendar and the list of «Регулярні платежі»", () => {
  it("BUD-07@PoC FR 7: 30 days from today by default, by date, with the amount and the account of each charge", async () => {
    const space = await newSpace();
    const { acc } = await household(space);
    const c = await calendar(space);
    expect([c.from, c.to]).toEqual([TODAY, "2026-12-17"]);
    expect(c.items.map(brief)).toEqual([
      ["2026-11-25", "Синтетичний спортзал", "40", "expected"],
      ["2026-11-30", "Синтетичне кіно", "11.99", "expected"],
      ["2026-12-05", "Синтетична оренда", "700", "expected"],
      ["2026-12-10", "Синтетична зарплата", "2000", "expected"],
    ]);
    expect(c.items.every((i) => i.kind === "payment" && i.counted && i.interest === null)).toBe(true);
    // A payment added by hand without an account has none; the charge carries the payment's own.
    expect(c.items[0]!.accountId).toBeNull();
    void acc;
  });

  it("BUD-07@PoC FR 7: the horizon goes up to 366 days; 0, 367, not a number, or a start outside the 430 days of history is refused", async () => {
    const space = await newSpace();
    await household(space);
    const year = await calendar(space, "?days=366");
    expect(year.to).toBe("2027-11-18");
    // The yearly insurance and twelve months of rent.
    expect(year.items.filter((i) => i.name === "Синтетична страховка").map((i) => i.dueOn)).toEqual([
      "2027-03-01",
    ]);
    expect(year.items.filter((i) => i.name === "Синтетична оренда")).toHaveLength(12);
    for (const q of [
      "?days=0",
      "?days=367",
      "?days=abc",
      "?from=2025-09-14",
      "?from=2027-11-20",
      "?from=2026-02-30",
    ]) {
      const res = await call(space, "GET", `/v1/recurring/calendar${q}`);
      expect(res.statusCode, q).toBe(400);
    }
    expect((await calendar(space, "?from=2025-09-15&days=1")).items).toEqual([]);
  });

  it("BUD-07@PoC FR 7: the month's total, «Підписки», the incomes and «За рік» count the active payments", async () => {
    const space = await newSpace();
    await household(space);
    const c = await calendar(space);
    expect(c.totals).toEqual({
      currency: "EUR",
      month: "2026-11",
      // Rent (paid), the gym and the cinema of November.
      expenses: eur("751.99"),
      subscriptions: eur("11.99"),
      loans: eur("0"),
      incomes: eur("2000"),
      // 12 × 700 + 12 × 40 + 12 × 11.99 + 96.
      yearExpenses: eur("9119.88"),
      yearIncomes: eur("24000"),
      approximate: false,
    });
  });

  it("BUD-07@PoC FR 7, FR 10: a payment «Можливо, скасований» stays in the calendar, not counted, and is in no total", async () => {
    const space = await newSpace();
    await payment(
      space,
      { name: "Синтетичний басейн", amount: eur("35.00"), anchorDate: "2026-09-05" },
      "2026-09-01",
    );
    const c = await calendar(space, "?from=2026-11-01");
    expect(c.items.map((i) => [i.dueOn, i.status, i.counted])).toEqual([
      ["2026-11-05", "overdue", false],
      ["2026-12-05", "expected", false],
    ]);
    expect(c.totals).toMatchObject({ expenses: eur("0"), yearExpenses: eur("0") });
    expect(c.period).toMatchObject({ charges: 0, remaining: eur("0") });
  });

  it("BUD-07@PoC FR 7: a payment in another currency at today's rate; without today's, at the latest one «приблизно»; without any — no figure", async () => {
    const space = await newSpace();
    await payment(space, {
      name: "Синтетичний хостинг",
      amount: { amount: "10.00", currency: "USD" },
      anchorDate: "2026-11-25",
    });
    await rate(TODAY, "USD", "40");
    await rate(TODAY, "EUR", "50");
    let c = await calendar(space);
    expect(c.totals).toMatchObject({ expenses: eur("8"), yearExpenses: eur("96"), approximate: false });
    // The charge keeps its own currency.
    expect(c.items[0]!.expectedAmount).toEqual({ amount: "10", currency: "USD" });
    await db.owner.query(`DELETE FROM fx_rates.rates`);
    await rate("2026-11-10", "USD", "40");
    await rate("2026-11-10", "EUR", "50");
    c = await calendar(space);
    expect(c.totals).toMatchObject({ expenses: eur("8"), approximate: true });
    expect(c.period).toMatchObject({ remaining: eur("8"), approximate: true });
    await db.owner.query(`DELETE FROM fx_rates.rates`);
    c = await calendar(space);
    expect(c.totals).toMatchObject({ expenses: null, yearExpenses: null });
    expect(c.period).toMatchObject({ charges: 1, remaining: null });
  });
});

describe("BUD-07@PoC AC2: the screen's charges and their statuses", () => {
  it("BUD-07@PoC AC2: the month's unpaid charges are «очікується» and counted («Можна витратити»); the paid one is «сплачено» with its transaction", async () => {
    const space = await newSpace();
    const { rent, paid } = await household(space);
    const c = await calendar(space, "?from=2026-11-01");
    const november = c.items.filter((i) => i.dueOn <= "2026-11-30");
    expect(november.map(brief)).toEqual([
      ["2026-11-05", "Синтетична оренда", "700", "paid"],
      ["2026-11-10", "Синтетична зарплата", "2000", "overdue"],
      ["2026-11-25", "Синтетичний спортзал", "40", "expected"],
      ["2026-11-30", "Синтетичне кіно", "11.99", "expected"],
    ]);
    const rentCharge = november[0]!;
    expect(rentCharge).toMatchObject({ paymentId: rent, transactionId: paid, paidOn: "2026-11-05" });
    expect(november[1]).toMatchObject({ type: "income", overdueDays: 8 });
    expect(november.filter((i) => i.status === "expected").every((i) => i.counted)).toBe(true);
    // «Підписки»: the group of the list.
    expect(november.filter((i) => i.subscription).map((i) => i.name)).toEqual(["Синтетичне кіно"]);
  });
});

describe("BUD-07@PoC FR 16: the monthly payments of «Кредит» accounts", () => {
  it("BUD-07@PoC FR 16: once a month on the day of the latest payment to the account, paid by the month's first payment, never a regular payment; the interest is the debt before it × rate ÷ 12", async () => {
    const space = await newSpace();
    const credit = await loan(space);
    const october = await transaction(space, credit, "250.00", "2026-10-14");
    let c = await calendar(space, "?from=2026-10-01&days=75");
    const loans = c.items.filter((i) => i.kind === "loan");
    expect(loans.map(brief)).toEqual([
      ["2026-10-14", "Синтетичний кредит", "250", "paid"],
      ["2026-11-14", "Синтетичний кредит", "250", "overdue"],
      ["2026-12-14", "Синтетичний кредит", "250", "expected"],
    ]);
    expect(loans[0]).toMatchObject({
      paymentId: null,
      accountId: credit,
      transactionId: october,
      paidOn: "2026-10-14",
      counted: true,
      // 9 000 € owed before it × 12 % ÷ 12.
      interest: eur("90"),
    });
    // November unpaid: today's debt, 8 750 €; December not known yet.
    expect(loans[1]).toMatchObject({ overdueDays: 4, interest: eur("87.5") });
    expect(loans[2]!.interest).toBeNull();
    expect(c.loans).toEqual([
      { accountId: credit, name: "Синтетичний кредит", monthlyPayment: eur("250"), annualRate: "12" },
    ]);
    expect(c.totals).toMatchObject({ expenses: eur("250"), loans: eur("250"), yearExpenses: eur("3000") });
    // Not stored as a regular payment.
    expect((await call(space, "GET", "/v1/recurring/payments")).json().items).toEqual([]);

    // Two payments in November: the first pays the month.
    const first = await transaction(space, credit, "100.00", "2026-11-16");
    await transaction(space, credit, "150.00", "2026-11-17");
    c = await calendar(space, "?from=2026-11-01&days=60");
    const nov = c.items.find((i) => i.kind === "loan" && i.dueOn.startsWith("2026-11"))!;
    // The latest payment is on the 17th now: the day of the month's payment follows it.
    expect(nov).toMatchObject({
      dueOn: "2026-11-17",
      status: "paid",
      transactionId: first,
      interest: eur("87.5"),
    });
    expect(c.items.filter((i) => i.kind === "loan").map((i) => i.dueOn)).toEqual([
      "2026-11-17",
      "2026-12-17",
    ]);
  });

  it("BUD-07@PoC FR 16: a day the month lacks is its last day; a loan without any payment — the 1st", async () => {
    const space = await newSpace();
    const end = await loan(space, "Синтетичний кредит · кінець місяця");
    await transaction(space, end, "250.00", "2026-10-31");
    const none = await loan(space, "Синтетичний кредит · без платежів");
    const c = await calendar(space, "?from=2026-11-01&days=30");
    expect(
      c.items
        .filter((i) => i.kind === "loan")
        .map((i) => [i.accountId === end ? "end" : "none", i.dueOn, i.status]),
    ).toEqual([
      ["none", "2026-11-01", "overdue"],
      ["end", "2026-11-30", "expected"],
    ]);
    void none;
  });
});

describe("BUD-07@PoC FR 19: the budget card «Регулярні платежі» — «сплачено N з M · K прострочено · лишилось X €»", () => {
  it("BUD-07@PoC FR 19: the current month's expense charges with the loan's payment: paid, overdue and what is left", async () => {
    const space = await newSpace();
    await household(space);
    await loan(space);
    const c = await calendar(space);
    // Rent paid; the gym and the cinema expected; the loan's payment of the 1st overdue (no payment yet).
    expect(c.period).toEqual({
      month: "2026-11",
      charges: 4,
      paid: 1,
      overdue: 1,
      remaining: eur("301.99"),
      approximate: false,
    });
  });
});

describe("BUD-07@PoC AC9: another space and a scoped member", () => {
  it("BUD-07@PoC AC9: another space's calendar shows none of this space's charges, loans, counts or sums; a scoped member — not found", async () => {
    const space = await newSpace();
    await household(space);
    await loan(space, "Синтетичний чужий кредит");
    const other = await newSpace();
    const res = await call(other, "GET", "/v1/recurring/calendar?days=366");
    expect(res.statusCode).toBe(200);
    const text = leakText(res.body);
    for (const leaked of ["Синтетична оренда", "Синтетичний чужий кредит", "751.99", "9119.88", "2000"])
      expect(text).not.toContain(leaked);
    expect(res.json()).toMatchObject({ items: [], loans: [], period: { charges: 0 } });
    expect((await call(space, "GET", "/v1/recurring/calendar", undefined, true)).statusCode).toBe(404);
  });
});
