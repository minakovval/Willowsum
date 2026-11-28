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
import { createBudgetServices } from "../src/modules/budget/index.ts";
import { createCashflowServices } from "../src/modules/cashflow/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalFlows, createGoalSpends } from "../src/modules/goals/index.ts";
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
import { createTransferProposalSides } from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * FIN-03@PoC FR 19 (wave 2 rows 15, 16 gaps), through the real API on a real PostgreSQL with the real transactions,
 * ledger, accounts, categorization, budget and cashflow modules: the budget's spending, the spending of the analytics and
 * the account's balance are read from one and the same transaction — its one journal event —, so a create, an edit and
 * a delete move all three together and never one without the others. Every name and amount is synthetic; the clock is
 * the test's own.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-18";
const clock = { now: () => Date.parse(`${TODAY}T10:00:00Z`) };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
testTelemetryForFile();

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
) {
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
    for (let i = 0; i < 20; i++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
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

/** What each reader shows for the space: the account's balance, the budget's «Продукти», the analytics' spending. */
async function readings(space: Space, accountId: string, groceries: string) {
  await runWorker(space.householdId);
  const account = await call(space, "GET", `/v1/accounts/${accountId}`);
  expect(account.statusCode, account.body).toBe(200);
  const period = await call(space, "GET", "/v1/budget/periods/2026-11");
  expect(period.statusCode, period.body).toBe(200);
  const cashflow = await call(space, "GET", "/v1/cashflow?type=month&period=2026-11");
  expect(cashflow.statusCode, cashflow.body).toBe(200);
  const line = (period.json().groups as { categories: { categoryId: string; spent: unknown }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.categoryId === groceries);
  const { rows } = await db.owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)`,
    [space.householdId],
  );
  return {
    balance: account.json().currencies[0].balance.amount as string,
    budget: line?.spent,
    analytics: cashflow.json().months[0].expenses,
    events: rows[0]!.n,
  };
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
          totals: createListTotals({ rates: officialDatedRates(rates), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
          categories: directory,
          flags: fakeFlags(),
        }),
        categories: createCategoriesServices({ audit, clock, newId: randomUUID, usage: [] }),
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
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("FIN-03@PoC FR 19: the budget and the analytics are projections of the same transactions", () => {
  it("FIN-03@PoC FR 19: −45,00 € in «Продукти» is one journal event — the balance, the budget's «Продукти» and the analytics' spending move together on a create, an edit and a delete", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний поточний",
      balance: eur("1000.00"),
      balanceDate: "2026-01-01",
    });
    expect(res.statusCode, res.body).toBe(201);
    const accountId = res.json().id as string;
    const groceries = await category(space, "Продукти");
    const budget = await call(space, "POST", "/v1/budget", {
      firstPeriod: "2026-11",
      limits: [{ categoryId: groceries, amount: eur("600.00") }],
    });
    expect(budget.statusCode, budget.body).toBe(201);
    expect(await readings(space, accountId, groceries)).toEqual({
      balance: "1000",
      budget: eur("0"),
      analytics: eur("0"),
      events: 0,
    });

    const created = await call(space, "POST", "/v1/transactions", {
      accountId,
      amount: eur("-45.00"),
      date: "2026-11-04",
      counterparty: "Синтетичний продавець",
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const set = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId: groceries });
    expect(set.statusCode, set.body).toBe(200);
    expect(await readings(space, accountId, groceries)).toEqual({
      balance: "955",
      budget: eur("45"),
      analytics: eur("45"),
      events: 1,
    });

    const edited = await call(space, "PATCH", `/v1/transactions/${id}`, { amount: eur("-50.00") });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await readings(space, accountId, groceries)).toEqual({
      balance: "950",
      budget: eur("50"),
      analytics: eur("50"),
      events: 1,
    });

    const deleted = await call(space, "DELETE", `/v1/transactions/${id}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await readings(space, accountId, groceries)).toEqual({
      balance: "1000",
      budget: eur("0"),
      analytics: eur("0"),
      events: 0,
    });
  });
});
