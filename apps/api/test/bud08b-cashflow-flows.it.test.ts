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
  createCreditAccounts,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createCashflowServices } from "../src/modules/cashflow/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalFlows, createGoalSpends, createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createBudgetTransactions,
  createCashflowMovements,
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
 * BUD-08@PoC b) (wave 2 row 37, gap before plan row 134), the rest of `GET /v1/cashflow`: contributions to goals (FR 5),
 * the loan payment's interest and «Погашення боргу» (FR 7), «Залишилось на рахунках» (FR 4) and the layer «з цілей»
 * (FR 10), through the real API on a real PostgreSQL with the real goals, accounts, liabilities, ledger and transactions
 * modules. Every name and amount is synthetic; the clock is the test's own.
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
    // Until nothing is left: a ledger event becomes a goals job on one pass, its hand-off on a later one.
    for (let i = 0; i < 50; i++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
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
          movements: createCashflowMovements(db.databases.for("transactions")),
          goals: {
            ...createGoalFlows(db.databases.for("goals")),
            ...createGoalSpends(db.databases.for("goals")),
          },
          credit: createCreditAccounts(db.databases.for("accounts")),
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          ledger,
          clock,
        }),
        goals: createGoalsServices({
          accounts,
          ledger,
          transactions: lookup,
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

const post = (space: Space, url: string, body: unknown) =>
  call(space, "POST", url, body, {}, { "idempotency-key": randomUUID() });

async function transfer(
  space: Space,
  fromAccountId: string,
  toAccountId: string,
  amount: string,
  date: string,
) {
  const res = await post(space, "/v1/transactions/transfers", {
    fromAccountId,
    toAccountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний переказ",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
}

async function goal(space: Space, name: string, part?: Record<string, unknown>): Promise<string> {
  const res = await post(space, "/v1/goals", {
    template: "custom",
    name,
    target: eur("10000.00"),
    targetDate: "2027-12-01",
    ...(part ? { part } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function contribute(space: Space, goalId: string, amount: string, date: string) {
  const res = await post(space, `/v1/goals/${goalId}/contributions`, { amount: eur(amount), date });
  expect(res.statusCode, res.body).toBe(201);
}

async function loan(space: Space, debt: string, annualRate: string, monthlyPayment: string): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "loan",
    name: "Іпотека",
    balance: eur(debt),
    balanceDate: "2026-01-01",
    annualRate,
    monthlyPayment,
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

describe("BUD-08@PoC b: where the net flow went", () => {
  it("BUD-08@PoC FR 2, FR 5, FR 4, AC4: a transfer to a goal's own account and a «Внести» mark are contributions; a transfer to a savings account without a goal is not; the rest is left on the accounts", async () => {
    const space = await newSpace();
    const current = await account(space);
    const tripAccount = await account(space, "savings");
    const plain = await account(space, "savings");
    const trip = await goal(space, "Відпустка", { kind: "account", accountId: tripAccount });
    const cushion = await goal(space, "Подушка");
    await tx(space, current, "6000.00", "2026-11-02", "Зарплата");
    await tx(space, current, "-4500.00", "2026-11-03", "Продукти");
    await transfer(space, current, tripAccount, "300.00", "2026-11-19");
    await transfer(space, current, plain, "1000.00", "2026-11-19");
    await contribute(space, cushion, "200.00", "2026-11-19");
    const view = await cashflow(space, "month", "2026-11");
    expect(view.months[0]).toMatchObject({
      income: eur("6000"),
      expenses: eur("4500"),
      netFlow: eur("1500"),
      savingsRate: "25.0",
      goalContributions: {
        total: eur("500"),
        goals: [
          { goalId: trip, amount: eur("300") },
          { goalId: cushion, amount: eur("200") },
        ],
      },
      investmentContributions: eur("0"),
      investmentWithdrawals: eur("0"),
      debtRepayment: eur("0"),
      leftOnAccounts: eur("1000"),
      fromGoals: eur("0"),
    });
    expect(view.totals).toMatchObject({
      goalContributions: { total: eur("500") },
      leftOnAccounts: eur("1000"),
    });
    expect(view.loansWithoutRate).toEqual([]);
  });

  it("BUD-08@PoC AC2, FR 10: 2 900 € spent from the goal «Відпустка» in July is in July's spending and its layer «з цілей»; the year's rate counts all 12 months", async () => {
    const space = await newSpace();
    const current = await account(space);
    const vacation = await goal(space, "Відпустка", { kind: "marks", startAmount: "3000.00" });
    await tx(space, current, "6000.00", "2026-07-01", "Зарплата");
    await tx(space, current, "-100.00", "2026-07-02", "Продукти");
    const trip = await tx(space, current, "-2900.00", "2026-07-15", "Подорожі");
    await tx(space, current, "-500.00", "2026-10-02", "Продукти");
    await runWorker(space.householdId);
    const spent = await post(space, `/v1/goals/${vacation}/spends`, {
      transactions: [{ transactionId: trip, accountId: current }],
    });
    expect(spent.statusCode, spent.body).toBe(201);
    const view = await cashflow(space, "year", "2026");
    expect(view.view).toBe("monthly");
    expect(view.months).toHaveLength(12);
    const july = view.months[6];
    expect(july).toMatchObject({ month: "2026-07", expenses: eur("3000"), fromGoals: eur("2900") });
    expect(
      view.months.filter(
        (m: { fromGoals: unknown }) => JSON.stringify(m.fromGoals) !== JSON.stringify(eur("0")),
      ),
    ).toHaveLength(1);
    // (6 000 − 3 500) ÷ 6 000 over the 12 months; spending from goals is no contribution.
    expect(view.totals).toMatchObject({
      expenses: eur("3500"),
      savingsRate: "41.7",
      fromGoals: eur("2900"),
      goalContributions: { total: eur("0"), goals: [] },
    });
  });

  it("BUD-08@PoC AC7, FR 7: «Іпотека» 120 000,00 € at 4,2 %, the month's first confirmed transfer 650,00 € — 420,00 € spending, 230,00 € «Погашення боргу», the rate not lowered by it", async () => {
    const space = await newSpace();
    const current = await account(space);
    const mortgage = await loan(space, "120000.00", "4.2", "650.00");
    await tx(space, current, "6000.00", "2026-09-01", "Зарплата");
    await transfer(space, current, mortgage, "650.00", "2026-09-05");
    // The second payment of the month lowers the debt in full.
    await transfer(space, current, mortgage, "100.00", "2026-09-20");
    const view = await cashflow(space, "month", "2026-09");
    expect(view.months[0]).toMatchObject({
      income: eur("6000"),
      expenses: eur("420"),
      netFlow: eur("5580"),
      savingsRate: "93.0",
      debtRepayment: eur("330"),
      leftOnAccounts: eur("5250"),
    });
    expect(view.loansWithoutRate).toEqual([]);
  });

  it("BUD-08@PoC FR 5: another space's goals, contributions and loans are not counted", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    const current = await account(mine);
    await tx(mine, current, "1000.00", "2026-11-02", "Зарплата");
    const theirs = await account(other);
    const theirGoal = await goal(other, "Чужа ціль");
    await contribute(other, theirGoal, "700.00", "2026-11-19");
    const theirLoan = await loan(other, "50000.00", "6", "500.00");
    await transfer(other, theirs, theirLoan, "500.00", "2026-11-06");
    const view = await cashflow(mine, "month", "2026-11");
    expect(view.months[0]).toMatchObject({
      expenses: eur("0"),
      goalContributions: { total: eur("0"), goals: [] },
      debtRepayment: eur("0"),
      leftOnAccounts: eur("1000"),
    });
    expect((await cashflow(other, "month", "2026-11")).months[0]).toMatchObject({
      goalContributions: { total: eur("700") },
      debtRepayment: eur("250"),
      expenses: eur("250"),
    });
  });
});
