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
import { createBudgetCategoryUsage, createBudgetServices } from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createBudgetTransactions,
  createGoalTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-06@PoC FR 8, AC4 and FLW-38@PoC FR 4, AC3: «Одноразова витрата» — the switch in the transaction's details
 * (`PUT /v1/transactions/{id}/one-off`). A marked expense stays in the fact of its period, but leaves the averages: the
 * base «Середнє за 3 / 6 / 12 міс.» of «Порівняння», the template «Створити за моїми витратами» and the average expenses
 * of «Подушка безпеки». Real API on a real PostgreSQL with the real transactions, categories, categorization, accounts,
 * fx-rates, budget and goals modules; the flag runtime is the test's own (`transactions.one-off` on unless switched off),
 * so is the clock (12 November 2026, Kyiv). Every name and amount is synthetic.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-12T10:00:00Z");
const clock = { now: () => NOW };
const ONE_OFF = "transactions.one-off";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
/** Release flags switched off while a test runs (the API's runtime and the reads' switch read the same set). */
const flagsOff = new Set<string>();
const isEnabled = async (_h: string, flag: string) => !flagsOff.has(flag);

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

async function account(space: Space, kind = "current"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind}`,
    balance: { amount: "50000.00", currency: "EUR" },
    balanceDate: "2024-01-01",
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

async function spend(space: Space, accountId: string, amount: string, date: string, categoryId: string) {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: eur(amount),
    date,
    counterparty: "Синтетичний продавець",
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  const set = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId });
  expect(set.statusCode, set.body).toBe(200);
  return id;
}

const mark = (space: Space, id: string, oneOff: boolean, principal = {}) =>
  call(space, "PUT", `/v1/transactions/${id}/one-off`, { oneOff }, principal);

/**
 * The scenario of AC4: «Дім» 100 € a month from May to October 2026 and the roof repair 3 500 € on 14 August; the space's
 * history starts in 2025, so every month of the window is a finished month with data.
 */
async function roofRepair(space: Space) {
  const acc = await account(space);
  const home = await category(space, "Дім");
  await spend(space, acc, "-5.00", "2025-09-02", home);
  for (const m of ["05", "06", "07", "08", "09", "10"])
    await spend(space, acc, "-100.00", `2026-${m}-03`, home);
  const roof = await spend(space, acc, "-3500.00", "2026-08-14", home);
  const budget = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11" });
  expect(budget.statusCode, budget.body).toBe(201);
  return { acc, home, roof };
}

type Money = { amount: string; currency: string };
interface Row {
  categoryId: string | null;
  current: Money;
  base: Money | null;
  transactions: { current: number; base: number | null };
}
async function compareRow(space: Space, query: string, categoryId: string): Promise<Row> {
  const res = await call(space, "GET", `/v1/budget/compare?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().expenses.categories as Row[]).find((r) => r.categoryId === categoryId)!;
}
async function wizardAverage(space: Space, categoryId: string) {
  const res = await call(space, "GET", "/v1/budget/wizard");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().fromSpending.categories as { categoryId: string; average: Money; limit: Money }[]).find(
    (c) => c.categoryId === categoryId,
  );
}
async function cushion(space: Space) {
  const res = await call(space, "GET", "/v1/goals/emergency-average");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { average: Money | null; months: number };
}
/** Money compared by value: «100» and «100.00» are the same amount. */
const value = (m: Money | null | undefined) => (m ? new Decimal(m.amount).toFixed(2) : m);

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
  const oneOffEnabled = (householdId: string) => isEnabled(householdId, ONE_OFF);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabled },
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
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [createBudgetCategoryUsage(db.databases.for("budget"))],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        budget: createBudgetServices({
          planEnabled: async () => true,
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions"), { oneOffEnabled }),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock,
          newId: randomUUID,
        }),
        goals: createGoalsServices({
          accounts,
          ledger,
          transactions: lookup,
          reads: {
            transactions: createGoalTransactions(db.databases.for("transactions"), { oneOffEnabled }),
            fx,
            categorization: createTransactionCategories(db.databases.for("categorization")),
            categories: directory,
          },
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
  flagsOff.clear();
});

describe("BUD-06@PoC FR 8: «Одноразова витрата»", () => {
  it("BUD-06@PoC AC4: the roof repair 3 500 € marked «Одноразова витрата» stays in the fact of August, but leaves the averages, the budget template and «Подушка безпеки»", async () => {
    const space = await newSpace();
    const { home, roof } = await roofRepair(space);
    // Before the mark: the repair distorts every average of «Дім».
    expect(value((await compareRow(space, "type=month&period=2026-11&base=avg6", home)).base)).toBe("683.33");
    expect(value((await wizardAverage(space, home))?.average)).toBe("1266.67");
    expect(value((await cushion(space)).average)).toBe("683.33");

    const res = await mark(space, roof, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: roof, oneOff: true });

    // The fact of its period keeps it: August of «Порівняння» (and its row of the list).
    const august = await compareRow(space, "type=month&period=2026-08&full=true", home);
    expect(value(august.current)).toBe("3600.00");
    expect(august.transactions.current).toBe(2);
    // The averages leave it out: «Середнє за 6 міс.» of «Порівняння» — 6 months of 100 €, the 6 months still counted.
    const avg6 = await call(space, "GET", "/v1/budget/compare?type=month&period=2026-11&base=avg6");
    expect(avg6.json().base).toMatchObject({ base: "avg6", available: true, months: 6 });
    const row = (avg6.json().expenses.categories as Row[]).find((r) => r.categoryId === home)!;
    expect(value(row.base)).toBe("100.00");
    expect(value((await compareRow(space, "type=month&period=2026-11&base=avg3", home)).base)).toBe("100.00");
    // «Попередній період» is no average: September's base is August with the repair.
    expect(value((await compareRow(space, "type=month&period=2026-09&full=true", home)).base)).toBe(
      "3600.00",
    );
    // The template «Створити за моїми витратами»: the 3-month average of «Дім» without it.
    expect(await wizardAverage(space, home)).toEqual({
      categoryId: home,
      average: eur("100"),
      limit: eur("100"),
    });
    // «Подушка безпеки»: the average expenses of the 6 months without it.
    expect(await cushion(space)).toMatchObject({ average: eur("100"), months: 6 });
  });

  it("FLW-38@PoC AC3: «Ремонт даху» 3 500 € marked «Одноразова витрата» — the average of 6 months leaves it out, the fact of its period keeps it; unmarked, it counts again", async () => {
    const space = await newSpace();
    const { home, roof } = await roofRepair(space);
    expect((await mark(space, roof, true)).statusCode).toBe(200);
    expect(value((await compareRow(space, "type=month&period=2026-11&base=avg6", home)).base)).toBe("100.00");
    expect(value((await compareRow(space, "type=month&period=2026-08", home)).current)).toBe("3600.00");
    const off = await mark(space, roof, false);
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().oneOff).toBe(false);
    expect(value((await compareRow(space, "type=month&period=2026-11&base=avg6", home)).base)).toBe("683.33");
  });

  it("BUD-06@PoC FR 8: the mark is a data change — one audit entry `oneOff` per change, none for the same value; the transaction and the list show it", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const home = await category(space, "Дім");
    const id = await spend(space, acc, "-3500.00", "2026-08-14", home);
    const entries = () => audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    const before = (await entries()).length;
    expect((await mark(space, id, true)).statusCode).toBe(200);
    const log = await entries();
    expect(log).toHaveLength(before + 1);
    expect(
      log.find((e) => e.action === "update" && e.changes.some((c) => c.field === "oneOff"))!.changes,
    ).toEqual([expect.objectContaining({ field: "oneOff", before: null, after: "true" })]);
    // The same value again: nothing changes, no entry.
    const again = await mark(space, id, true);
    expect(again.statusCode).toBe(200);
    expect(await entries()).toHaveLength(before + 1);
    expect((await call(space, "GET", `/v1/transactions/${id}`)).json()).toMatchObject({ oneOff: true });
    const list = await call(space, "GET", "/v1/transactions");
    expect((list.json().items as { id: string; oneOff: boolean }[]).find((t) => t.id === id)?.oneOff).toBe(
      true,
    );
    // Taken off: `oneOff` «true» → null.
    expect((await mark(space, id, false)).json().oneOff).toBe(false);
    const last = (await entries()).filter((e) => e.changes.some((c) => c.field === "oneOff"));
    expect(last).toHaveLength(2);
    expect(last.map((e) => e.changes.find((c) => c.field === "oneOff")!.after).sort()).toEqual(
      [null, "true"].sort(),
    );
  });

  it("BUD-06@PoC FR 8: only an expense is marked — an income is 400 `oneOff: not_expense`, a side of a transfer 409; unmarking an income is no change", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const savings = await account(space, "savings");
    const income = await call(space, "POST", "/v1/transactions", {
      accountId: acc,
      amount: eur("2000.00"),
      date: "2026-10-01",
      counterparty: "Синтетичний роботодавець",
    });
    const incomeId = income.json().id as string;
    const refused = await mark(space, incomeId, true);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errors).toEqual([{ in: "body", path: "oneOff", issue: "not_expense" }]);
    expect((await mark(space, incomeId, false)).json().oneOff).toBe(false);
    const transfer = await call(space, "POST", "/v1/transactions/transfers", {
      fromAccountId: acc,
      toAccountId: savings,
      amount: eur("300.00"),
      date: "2026-10-02",
    });
    expect(transfer.statusCode, transfer.body).toBe(201);
    const outflow = (transfer.json() as { outflow?: { id: string }; items?: { id: string }[] }).outflow?.id;
    const sideId =
      outflow ??
      (
        (await call(space, "GET", "/v1/transactions")).json().items as { id: string; transfer: unknown }[]
      ).find((t) => t.transfer !== null)!.id;
    const side = await mark(space, sideId, true);
    expect(side.statusCode).toBe(409);
    expect(side.json().code).toBe("TRANSACTION_IN_TRANSFER");
    // A body that is not the switch: 400.
    expect(
      (await call(space, "PUT", `/v1/transactions/${sideId}/one-off`, { oneOff: "yes" })).statusCode,
    ).toBe(400);
  });

  it("BUD-06@PoC FR 8: another space's transaction is «not found», unchanged; a scoped member — 403; the switch off — the route is off and the marks act nowhere", async () => {
    const owner = await newSpace();
    const { home, roof } = await roofRepair(owner);
    const stranger = await newSpace();
    const foreign = await mark(stranger, roof, true);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(roof);
    expect((await call(owner, "GET", `/v1/transactions/${roof}`)).json().oneOff).toBe(false);
    // A scoped member: «Транзакції» are closed — a write is refused before the row is read (as BUD-13's).
    expect((await mark(owner, roof, true, { role: "editor", scoped: true })).statusCode).toBe(403);
    expect((await call(owner, "GET", `/v1/transactions/${roof}`)).json().oneOff).toBe(false);

    expect((await mark(owner, roof, true)).statusCode).toBe(200);
    flagsOff.add(ONE_OFF);
    expect((await mark(owner, roof, false)).statusCode).toBe(404);
    // Off for the space: the stored mark leaves no average.
    expect(value((await compareRow(owner, "type=month&period=2026-11&base=avg6", home)).base)).toBe("683.33");
    expect(value((await wizardAverage(owner, home))?.average)).toBe("1266.67");
    expect(value((await cushion(owner)).average)).toBe("683.33");
    flagsOff.clear();
    expect(value((await cushion(owner)).average)).toBe("100.00");
  });

  it("BUD-06@PoC FR 8: two simultaneous marks of one transaction — one change, one version, one audit entry", async () => {
    const space = await newSpace();
    const acc = await account(space);
    const home = await category(space, "Дім");
    const id = await spend(space, acc, "-3500.00", "2026-08-14", home);
    const version = (await call(space, "GET", `/v1/transactions/${id}`)).json().version as number;
    const [a, b] = await Promise.all([mark(space, id, true), mark(space, id, true)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const now = (await call(space, "GET", `/v1/transactions/${id}`)).json();
    expect(now).toMatchObject({ oneOff: true, version: version + 1 });
    const marks = (
      await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })
    ).filter((e) => e.changes.some((c) => c.field === "oneOff"));
    expect(marks).toHaveLength(1);
    // Off and on at once: each request sees the row the other left (no lost update) — the row, its version and its
    // log agree: every entry is a real change, so the mark is on exactly when the count of entries is odd.
    const [off, on] = await Promise.all([mark(space, id, false), mark(space, id, true)]);
    expect([off.statusCode, on.statusCode]).toEqual([200, 200]);
    const final = (await call(space, "GET", `/v1/transactions/${id}`)).json();
    const log = (await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })).filter(
      (e) => e.changes.some((c) => c.field === "oneOff"),
    );
    expect(log.length === 1 || log.length === 3).toBe(true);
    expect(final.oneOff).toBe(log.length % 2 === 1);
    expect(final.version).toBe(version + log.length);
  });
});
