import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
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
  createBudgetPlanSources,
  createBudgetServices,
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
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * PR #613 (BUD-17@PoC a, round 2): «Надходження» of «План» over the real module recurring (`createRecurringMonth`) on a
 * real PostgreSQL through the real API — the read stays in the caller's space, only income payments are sources,
 * nothing of a payment but its id and amount is returned, and while the release flag `budget.plan` is off «Бюджет»
 * keeps the budget's own income plan. Every name and amount is synthetic; the clock is fixed (18 November 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-18";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const clock = { now: () => NOW };
/** The flags switched off for the next requests. */
let off: string[] = [];
const FLAGS = { ...fakeFlags(), isEnabled: async (_h: string, flag: string) => !off.includes(flag) };

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

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "PUT",
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

async function createBudget(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11", ...body });
  expect(res.statusCode, res.body).toBe(201);
}

async function period(space: Space, p: string) {
  const res = await call(space, "GET", `/v1/budget/periods/${p}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

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
        flags: FLAGS,
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
            createBudgetCategoryUsage(db.databases.for("budget")),
            createRecurringCategoryUsage(db.databases.for("recurring")),
          ],
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
        }),
        recurring,
        budget: createBudgetServices({
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock,
          newId: randomUUID,
          obligations,
          planSources: createBudgetPlanSources({
            goals: { active: async () => [] },
            debts: { inMonth: async () => [] },
            fx,
            recurring: createRecurringMonth(db.databases.for("recurring"), recurring),
            planEnabled: (householdId) => FLAGS.isEnabled(householdId, "budget.plan"),
          }),
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
  off = [];
});
const income = (space: Space, name: string, amount: string, body: Record<string, unknown> = {}) =>
  payment(space, { type: "income", name, amount: eur(amount), anchorDate: "2026-11-25", ...body });
const grid = (space: Space, principal?: { role?: string; scoped?: boolean }) =>
  call(space, "GET", "/v1/budget/plan-grid", undefined, principal);
const cell = (space: Space, lineId: string, principal?: { role?: string; scoped?: boolean }) =>
  call(
    space,
    "PUT",
    "/v1/budget/plan-grid/cells",
    { period: "2026-12", kind: "income", lineId, amount: eur("5"), version: 0 },
    principal,
  );
const errors = (res: { json(): { errors?: unknown } }) => res.json().errors;

describe("sec613 round 2: «Надходження» over the real module recurring", () => {
  it("sec613 AC5, FR 1: the regular incomes are read in the caller's space only — another space's grid and period carry none of them, its payment id is «not_found» like a random one; a scoped member reads nothing", async () => {
    const a = await newSpace();
    const b = await newSpace();
    await createBudget(a, { incomePlan: eur("1000"), limits: [] });
    await createBudget(b, { incomePlan: eur("1000"), limits: [] });
    const salaryCategory = await category(a, "Зарплата");
    const salary = await income(a, "Таємна зарплата", "4321.09", { categoryId: salaryCategory });
    // An expense payment is never a source of «Надходження».
    await payment(a, { name: "Таємна підписка", amount: eur("77.77"), anchorDate: "2026-11-25" });

    const own = await grid(a);
    expect(own.statusCode, own.body).toBe(200);
    const rows = own.json().income.rows as { paymentId: string | null; cells: { amount: unknown }[] }[];
    expect(rows.map((r) => r.paymentId)).toEqual([salary]);
    expect(rows[0]!.cells[1]!.amount).toEqual(eur("4321.09"));
    expect(own.json().income.totals[1]).toEqual(eur("4321.09"));
    // Of a payment only its id and the month's amount: no name, category, due date or status.
    expect(Object.keys(rows[0]!).sort()).toEqual(["cells", "paymentId"]);
    expect(Object.keys(rows[0]!.cells[1]!).sort()).toEqual(["amount", "expected", "own", "version"]);
    for (const text of ["Таємна", salaryCategory, "77.77", "2026-11-25"])
      expect(leakText(own.body)).not.toContain(text);

    const other = await grid(b);
    expect(other.statusCode, other.body).toBe(200);
    expect(other.json().income.rows).toEqual([]);
    expect(other.json().income.totals[1]).toEqual(eur("1000"));
    const seen = leakText(other.body) + leakText(JSON.stringify(await period(b, "2026-12")));
    for (const text of [salary, "4321", "Таємна", "77.77", a.householdId, salaryCategory])
      expect(seen).not.toContain(text);
    const foreign = await cell(b, salary);
    const random = await cell(b, randomUUID());
    expect(foreign.statusCode).toBe(400);
    expect(errors(foreign)).toEqual([{ in: "body", path: "lineId", issue: "not_found" }]);
    expect(errors(random)).toEqual(errors(foreign));

    const scoped = { role: "viewer", scoped: true };
    expect((await grid(a, scoped)).statusCode).toBe(404);
    expect((await call(a, "GET", "/v1/budget/periods/2026-12", undefined, scoped)).statusCode).toBe(404);
    expect((await cell(a, salary, scoped)).statusCode).toBe(403);
    expect((await cell(a, salary, { role: "viewer" })).statusCode).toBe(403);
    const { rows: stored } = await db.owner.query(`SELECT count(*)::int AS n FROM budget.plan_cells`);
    expect(stored[0].n).toBe(0);
  });

  it("BUD-02@PoC FR 9, FR 14 (П-14): while «План» is off, a regular income does not replace the budget's income plan on «Бюджет»", async () => {
    const space = await newSpace();
    await createBudget(space, { incomePlan: eur("5600"), limits: [] });
    const first = await newSpace();
    await createBudget(first, { incomePlan: eur("3000"), limits: [], proportional: true });
    off = ["budget.plan"];
    await income(space, "Синтетична допомога", "700");
    await income(first, "Синтетична зарплата", "3000", { anchorDate: "2026-11-05" });
    expect((await grid(space)).statusCode).toBe(404);
    // «План доходу» as typed on «Бюджет»; the proportional first period keeps its share (13 of 30 days).
    expect((await period(space, "2026-11")).incomePlan).toEqual(eur("5600"));
    expect((await period(space, "2026-12")).incomePlan).toEqual(eur("5600"));
    expect((await period(first, "2026-11")).incomePlan).toEqual(eur("1300"));
    // With «План» on (BUD-17 FR 1, owner decision 2026-11-19, Q3) the income of 700 is under «План доходу»: the month's
    // plan stays 5 600 and the rest is «Інші надходження».
    off = [];
    expect((await period(space, "2026-12")).incomePlan).toEqual(eur("5600"));
    expect((await grid(space)).json().income.other[1]).toEqual(eur("4900"));
  });
});
