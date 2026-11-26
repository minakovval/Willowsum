import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
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
  createCreditAccounts,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetObligations,
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
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringMonth,
  createRecurringServices,
} from "../src/modules/recurring/index.ts";
import {
  createAccountPayments,
  createBudgetTransactions,
  createTransactionHistory,
  createTransactionLookup,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

/**
 * #567 with BUD-03@PoC a) (wave 2 row 34): the port `BudgetObligations` live — the budget's adapter over the real
 * recurring (the month's charges), accounts and liabilities (a loan's monthly payment) and transactions (whether the month
 * has a payment to the loan) modules, at today's NBU rate (fx-rates), on a real PostgreSQL through the real API: BUD-02
 * AC6, AC7, FR 3 (the bar), FR 15, FR 16 «Очікувані платежі», FR 19 and AC9 (D, E), the port in another currency
 * (BUD-03 EC4) and another space. Every name and amount is synthetic; the clock is fixed (18 November 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-18";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
let obligations: ReturnType<typeof createBudgetObligations>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
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

/** A loan (FIN-01): its debt, rate and monthly payment, in the payment's currency. */
const loan = (space: Space, payment: { amount: string; currency: string }) =>
  account(space, {
    kind: "loan",
    name: "Синтетичний кредит",
    balance: { amount: "9000.00", currency: payment.currency },
    balanceDate: "2026-01-01",
    annualRate: "12",
    monthlyPayment: payment.amount,
  });

async function category(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

/** A regular payment added by hand («Додати вручну»), on 1 November (so its November charges are its own). */
async function payment(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/recurring/payments", {
    type: "expense",
    frequency: "month",
    name: "Синтетична підписка",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await db.owner.query(
    `UPDATE recurring.payments SET created_on = '2026-11-01' WHERE household_id = $1 AND id = $2`,
    [space.householdId, id],
  );
  return id;
}

async function transaction(space: Space, accountId: string, amount: string, date: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний продавець",
  });
  expect(res.statusCode, res.body).toBe(201);
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

async function createBudget(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11", ...body });
  expect(res.statusCode, res.body).toBe(201);
}

async function period(space: Space, p: string) {
  const res = await call(space, "GET", `/v1/budget/periods/${p}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const preview = async (space: Space, body: Record<string, unknown>) => {
  const res = await call(space, "POST", "/v1/budget/allocation", { firstPeriod: "2026-11", ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

beforeAll(async () => {
  db = await setupRealModules(8);
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
    audit,
    clock,
    newId: randomUUID,
  });
  obligations = createBudgetObligations({
    recurring: createRecurringMonth(db.databases.for("recurring"), recurring),
    credit: createCreditAccounts(db.databases.for("accounts")),
    liabilities,
    payments: createAccountPayments(db.databases.for("transactions")),
    fx,
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
          obligations,
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

afterEach(async () => {
  await db.owner.query(`DELETE FROM fx_rates.rates`);
});

describe("#567: «Розподіл» with the live port (POST /v1/budget/allocation)", () => {
  it("BUD-02@PoC AC6: income 5 600 €, limits 2 860 €, no regular payments outside the limits — «не розподілено 2 740 €», a surplus (live port)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const cafes = await category(space, "Кафе і ресторани");
    // A regular payment inside a limited category is held by its limit: not outside.
    await payment(space, { amount: eur("40"), anchorDate: "2026-11-25", categoryId: groceries });
    const v = await preview(space, {
      incomePlan: eur("5600"),
      limits: [
        { categoryId: groceries, amount: eur("2000") },
        { categoryId: cafes, amount: eur("860") },
      ],
    });
    expect(v.balance).toEqual({
      recurringOutsideLimits: eur("0"),
      unallocated: eur("2740"),
      debtMinimums: eur("0"),
      // Q5 а: the goals' planned contributions (no goal here).
      goalContributions: eur("0"),
      difference: eur("2740"),
      kind: "surplus",
      amount: eur("2740"),
    });
  });

  it("BUD-02@PoC AC7: income 3 000 €, limits 3 200 € — «Звідки візьмуться 200 €?»; covered only when the options sum to 200 € (live port)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const body = { incomePlan: eur("3000"), limits: [{ categoryId: groceries, amount: eur("3200") }] };
    expect((await preview(space, body)).balance).toMatchObject({ kind: "deficit", amount: eur("200") });
    expect((await preview(space, { ...body, chosen: [eur("150")] })).choice).toMatchObject({
      status: "short",
    });
    expect((await preview(space, { ...body, chosen: [eur("150"), eur("50")] })).choice).toMatchObject({
      status: "exact",
    });
  });

  it("BUD-02@PoC FR 15: the regular payments outside the limits (FR 3 bar) and a loan's monthly payment once, as a minimum payment — never as a regular payment too (live port)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await payment(space, { amount: eur("15.99"), anchorDate: "2026-11-25" });
    await payment(space, { amount: eur("40"), anchorDate: "2026-11-25", categoryId: groceries });
    await loan(space, eur("250"));
    const v = await preview(space, {
      incomePlan: eur("1000"),
      limits: [{ categoryId: groceries, amount: eur("500") }],
    });
    expect(v.balance).toEqual({
      recurringOutsideLimits: eur("15.99"),
      unallocated: eur("484.01"),
      debtMinimums: eur("250"),
      goalContributions: eur("0"),
      difference: eur("234.01"),
      kind: "surplus",
      amount: eur("234.01"),
    });
  });

  it("BUD-02@PoC FR 15: a proportional first period counts the regular charges from its first day (live port)", async () => {
    const space = await newSpace();
    await payment(space, { amount: eur("30"), anchorDate: "2026-11-25" });
    await payment(space, { amount: eur("70"), anchorDate: "2026-11-02" });
    const v = await preview(space, { proportional: true, incomePlan: eur("300") });
    expect(v.balance.recurringOutsideLimits).toEqual(eur("30"));
  });
});

describe("#567: «Категорії» and «Очікувані платежі» with the live port (GET /v1/budget/periods/{period})", () => {
  it("BUD-02@PoC FR 19: D and E from the live port — only the mandatory categories (their rest and own unpaid payments); the loan's unpaid monthly payment is in the unpaid regular payments until the month has a payment to it (BUD-03 FR 5)", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти"); // mandatory by default
    const acc = await current(space);
    const credit = await loan(space, eur("250"));
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("500") }] });
    const spent = await transaction(space, acc, "-200.00", "2026-11-05");
    expect(
      (await call(space, "PUT", `/v1/transactions/${spent}/category`, { categoryId: groceries })).statusCode,
    ).toBe(200);
    await payment(space, { amount: eur("15.99"), anchorDate: "2026-11-25" });
    // No transaction pays it: «Очікується».
    let s = (await period(space, "2026-11")).summary;
    expect(s).toMatchObject({
      spent: eur("200"),
      limits: eur("500"),
      unpaidRecurring: eur("265.99"),
      // D: only the mandatory «Продукти»'s rest (FR 19) — the loan and the payment without a category stay out of it.
      mandatoryNeeded: eur("300"),
      free: eur("0"),
    });
    // The month's first payment to the loan account: its monthly payment is made.
    await transaction(space, credit, "250.00", "2026-11-10");
    s = (await period(space, "2026-11")).summary;
    expect(s).toMatchObject({
      unpaidRecurring: eur("15.99"),
      mandatoryNeeded: eur("300"),
      free: eur("0"),
    });
  });

  it("BUD-03@PoC FR 5: only a payment to the loan in the month pays it — not one of the month before, not a charge on the loan (a negative amount); the 1st counts", async () => {
    const space = await newSpace();
    const credit = await loan(space, eur("250"));
    await transaction(space, credit, "250.00", "2026-10-31");
    await transaction(space, credit, "-50.00", "2026-11-10");
    const paid = async () =>
      (await obligations.month(space.householdId, "2026-11", "EUR"))!.debtMinimums.map((d) => d.paid);
    expect(await paid()).toEqual([false]);
    await transaction(space, credit, "0.01", "2026-11-01");
    expect(await paid()).toEqual([true]);
  });

  it("BUD-03@PoC FR 5: a hidden payment or a merged duplicate does not pay the loan (#588 item 5)", async () => {
    const space = await newSpace();
    const credit = await loan(space, eur("250"));
    const hiddenId = await transaction(space, credit, "250.00", "2026-11-10");
    const paid = async () =>
      (await obligations.month(space.householdId, "2026-11", "EUR"))!.debtMinimums.map((d) => d.paid);
    expect(await paid()).toEqual([true]);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hiddenId]);
    expect(await paid()).toEqual([false]);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = false WHERE id = $1`, [hiddenId]);
    expect(await paid()).toEqual([true]);
    const keeper = await transaction(space, credit, "-1.00", "2026-11-11");
    await db.owner.query(`UPDATE transactions.transactions SET merged_into = $2 WHERE id = $1`, [
      hiddenId,
      keeper,
    ]);
    expect(await paid()).toEqual([false]);
  });

  it("BUD-02@PoC AC9: the totals row with the live port — «Ще потрібно на обов'язкові» and «Вільний залишок» match the categories", async () => {
    const space = await newSpace();
    const rent = await category(space, "Продукти"); // mandatory by default
    const cafes = await category(space, "Кафе і ресторани");
    const acc = await current(space);
    await createBudget(space, {
      limits: [
        { categoryId: rent, amount: eur("600") },
        { categoryId: cafes, amount: eur("100") },
      ],
    });
    for (const [amount, cat] of [
      ["-300.00", rent],
      ["-130.00", cafes],
    ] as const) {
      const id = await transaction(space, acc, amount, "2026-11-04");
      expect(
        (await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId: cat })).statusCode,
      ).toBe(200);
    }
    // Two unpaid charges of the mandatory category: 50 + 70 against its rest of 300.
    await payment(space, {
      amount: eur("50"),
      anchorDate: "2026-11-20",
      categoryId: rent,
      name: "Синтетична оренда",
    });
    await payment(space, {
      amount: eur("70"),
      anchorDate: "2026-11-28",
      categoryId: rent,
      name: "Синтетичні послуги",
    });
    expect((await period(space, "2026-11")).summary).toEqual({
      spent: eur("430"),
      limits: eur("700"),
      overspend: { amount: eur("30"), count: 1 },
      optionalLimits: eur("100"),
      mandatoryRemaining: eur("300"),
      unpaidRecurring: eur("120"),
      mandatoryNeeded: eur("300"),
      free: eur("-30"),
    });
  });

  it("BUD-02@PoC FR 16: a future month shows «Очікувані платежі» by category from the live port — every date of the schedule; a past month has none", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await createBudget(space, { limits: [{ categoryId: groceries, amount: eur("500") }] });
    await payment(space, {
      amount: eur("10"),
      frequency: "week",
      anchorDate: "2026-11-21",
      categoryId: groceries,
    });
    await payment(space, { amount: eur("15.99"), anchorDate: "2026-11-25" });
    await loan(space, eur("250"));
    const december = await period(space, "2026-12");
    expect(december.mode).toBe("future");
    // 5, 12, 19, 26 December — four weekly charges; the loan is not a regular payment of a category.
    expect(december.expectedPayments).toEqual({
      categories: [
        { categoryId: groceries, amount: eur("40") },
        { categoryId: null, amount: eur("15.99") },
      ],
      total: eur("55.99"),
    });
    const res = await call(space, "GET", "/v1/budget/periods/2026-10");
    expect(res.statusCode).toBe(404);
  });

  it("BUD-02@PoC FR 16: a past month is plan against fact — no «Очікувані платежі», no D or E, even with the live port", async () => {
    const space = await newSpace();
    await createBudget(space, { incomePlan: eur("100") });
    await db.owner.query(`UPDATE budget.budgets SET first_period = '2026-10-01' WHERE household_id = $1`, [
      space.householdId,
    ]);
    await payment(space, { amount: eur("15.99"), anchorDate: "2026-10-25" });
    const october = await period(space, "2026-10");
    expect(october.mode).toBe("past");
    expect(october.expectedPayments).toBeNull();
    expect(october.summary).toMatchObject({ unpaidRecurring: null, mandatoryNeeded: null, free: null });
  });
});

describe("#567: the port in another currency and another space", () => {
  it("BUD-03@PoC EC4: a regular payment and a loan in another currency — converted at today's rate; without today's, at the nearest one «приблизно»; without any rate — no figure", async () => {
    const space = await newSpace();
    await payment(space, { amount: { amount: "10.00", currency: "USD" }, anchorDate: "2026-11-25" });
    await loan(space, { amount: "100.00", currency: "USD" });
    await rate(TODAY, "USD", "40");
    await rate(TODAY, "EUR", "50");
    let o = await obligations.month(space.householdId, "2026-11", "EUR");
    expect(o).not.toBeNull();
    expect(o!.recurring.map((r) => r.amount.toDecimalString())).toEqual(["8"]);
    expect(o!.debtMinimums.map((d) => [d.amount.toDecimalString(), d.paid])).toEqual([["80", false]]);
    expect(o!.approximate).toBe(false);
    // Through the route: «Розподіл» takes the converted amounts.
    expect((await preview(space, { incomePlan: eur("1000") })).balance).toMatchObject({
      recurringOutsideLimits: eur("8"),
      debtMinimums: eur("80"),
      difference: eur("912"),
    });
    await db.owner.query(`DELETE FROM fx_rates.rates`);
    await rate("2026-11-10", "USD", "40");
    await rate("2026-11-10", "EUR", "50");
    o = await obligations.month(space.householdId, "2026-11", "EUR");
    expect(o!.approximate).toBe(true);
    expect(o!.recurring[0]!.amount.toDecimalString()).toBe("8");
    await db.owner.query(`DELETE FROM fx_rates.rates`);
    expect(await obligations.month(space.householdId, "2026-11", "EUR")).toBeNull();
    const v = await preview(space, { incomePlan: eur("1000") });
    expect(v.balance).toBeNull();
    expect(v.choice).toBeNull();
  });

  it("#567 comment 7003240884: amounts over the cap from the real modules — two loans, two regular payments, one loan in a dearer currency — give no figure (null), never 500, on the period read and on «Розподіл»", async () => {
    const big = "9".repeat(20);
    const twoLoans = await newSpace();
    await loan(twoLoans, eur(big));
    await loan(twoLoans, eur(big));
    const twoPayments = await newSpace();
    await payment(twoPayments, { amount: eur(big), anchorDate: "2026-11-25" });
    await payment(twoPayments, { amount: eur(big), anchorDate: "2026-11-26" });
    const dearer = await newSpace();
    await rate(TODAY, "GBP", "60");
    await rate(TODAY, "EUR", "50");
    await loan(dearer, { amount: big, currency: "GBP" });
    for (const space of [twoLoans, twoPayments, dearer]) {
      const v = await preview(space, { incomePlan: eur("1000") });
      expect([v.balance, v.choice]).toEqual([null, null]);
      await createBudget(space, {});
      const p = await period(space, "2026-11");
      expect(p.expectedPayments).toBeNull();
      expect(p.summary).toMatchObject({ unpaidRecurring: null, mandatoryNeeded: null, free: null });
    }
  });

  it("#567 space isolation: the port answers only from the space it is asked for — another space's payments, loans and loan payments are never counted", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    await payment(other, { amount: eur("15.99"), anchorDate: "2026-11-25" });
    const theirs = await loan(other, eur("250"));
    const myLoan = await loan(mine, eur("100"));
    // The other space pays its own loan; it pays nothing of mine.
    await transaction(other, theirs, "250.00", "2026-11-10");
    const o = await obligations.month(mine.householdId, "2026-11", "EUR");
    expect(o).toEqual({
      recurring: [],
      debtMinimums: [{ accountId: myLoan, amount: expect.anything(), paid: false }],
      approximate: false,
      incomeExpected: Money.zero("EUR"),
      incomeApproximate: false,
    });
    expect(o!.debtMinimums[0]!.amount.toDecimalString()).toBe("100");
    // A space's id that is not the caller's: the period read through the API is the caller's own.
    await createBudget(mine, {});
    expect((await period(mine, "2026-11")).summary).toMatchObject({ unpaidRecurring: eur("100") });
    await createBudget(other, {});
    expect((await period(other, "2026-11")).summary).toMatchObject({ unpaidRecurring: eur("15.99") });
    // The databases' policy: the recurring and transactions reads under one space see none of another's rows.
    expect(await obligations.month(randomUUID(), "2026-11", "EUR")).toEqual({
      recurring: [],
      debtMinimums: [],
      approximate: false,
      incomeExpected: Money.zero("EUR"),
      incomeApproximate: false,
    });
  });
});
