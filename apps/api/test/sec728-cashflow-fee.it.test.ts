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
import {
  createCategoriesServices,
  createCategoryDirectory,
  FEE_CATEGORY_KEY,
} from "../src/modules/categories/index.ts";
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
          // As main.ts wires it (FIN-03@PoC FR 8): the fee of a transfer is an expense «Комісії банку».
          transactions: createBudgetTransactions(db.databases.for("transactions"), {
            feeCategory: async (householdId) =>
              (await directory.categories(householdId)).find((c) => c.systemKey === FEE_CATEGORY_KEY)?.id ??
              null,
          }),
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

/**
 * Security review of PR #728 (money): with the fee of a transfer counted as spending (FIN-03@PoC FR 8), «Грошовий потік»
 * must not take it a second time inside the contribution to a goal (BUD-08@PoC FR 4, FR 5).
 */
describe("BUD-08@PoC FR 4: the fee of a transfer to a goal is counted once (security review #728)", () => {
  it("BUD-08@PoC FR 4, FIN-03@PoC FR 8: −300,00 € to a goal's own account, +298,00 € received — 2,00 € is spending, 298,00 € the contribution; what is left on the accounts is what the account really kept", async () => {
    const space = await newSpace();
    const current = await account(space);
    const tripAccount = await account(space, "savings");
    const trip = await goal(space, "Відпустка", { kind: "account", accountId: tripAccount });
    await tx(space, current, "6000.00", "2026-11-02", "Зарплата");
    await tx(space, current, "-4500.00", "2026-11-03", "Продукти");
    const res = await post(space, "/v1/transactions/transfers", {
      fromAccountId: current,
      toAccountId: tripAccount,
      amount: eur("300.00"),
      received: eur("298.00"),
      date: "2026-11-19",
      counterparty: "Синтетичний переказ",
    });
    expect(res.statusCode, res.body).toBe(201);
    await runWorker(space.householdId);
    const month = (await cashflow(space, "month", "2026-11")).months[0];
    // The budget account: +6 000 − 4 500 − 300 = 1 200 left. The fee is spending once.
    expect(month.expenses).toEqual(eur("4502"));
    expect(month.netFlow).toEqual(eur("1498"));
    expect(month.goalContributions.goals).toEqual([{ goalId: trip, amount: eur("298") }]);
    expect(month.leftOnAccounts).toEqual(eur("1200"));
  });
});
