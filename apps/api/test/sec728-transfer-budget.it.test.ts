import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import {
  createCategoriesServices,
  createCategoryDirectory,
  FEE_CATEGORY_KEY,
  type CategoryDirectory,
} from "../src/modules/categories/index.ts";
import {
  createBudgetTransactions,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * FIN-03@PoC FR 8, AC31; IMP-03@PoC FR 9, FR 21 (owner, 2026-11-26, decision 11; #722 A), through the real API on a real
 * PostgreSQL: the difference of a transfer between currencies against the official rate of the date is a loss (an
 * expense) or a gain (an income) of the budget in «Комісії банку», shown on the transfer (`currencyDifference`); the
 * journal keeps it on «Валютна різниця»; in one currency the fee is that expense. The budget's read
 * (`createBudgetTransactions`, as main.ts wires it with «Комісії банку») counts the difference, never the two sides.
 * Every name and amount is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
let directory: CategoryDirectory;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Transaction {
  id: string;
  type: string;
  hidden: boolean;
  transfer: {
    id: string;
    side: string;
    counterpartId: string;
    date: string;
    fee: { amount: string; currency: string } | null;
    rate: { rate: string; date: string; source: string } | null;
  } | null;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  principal: Principal = {},
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

async function createAccount(space: Space, amount: string, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency} ${randomUUID().slice(0, 6)}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string, date: string, currency = "EUR") {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний переказ",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Transaction;
}

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
        }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates: (requests) => fx.rates(requests),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  // AC31: 43,50 UAH per EUR on the day of the transfer.
  await rate("2026-10-14", "EUR", "43.5");
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

const feeCategory = async (householdId: string) =>
  (await directory.categories(householdId)).find((c) => c.systemKey === FEE_CATEGORY_KEY)?.id ?? null;

/** The budget's read as main.ts wires it: the period's counted rows of `accountIds`. */
const budgetRead = (householdId: string, accountIds: string[]) =>
  createBudgetTransactions(db.databases.for("transactions"), { feeCategory }).inPeriod(
    householdId,
    accountIds,
    "2026-10-01",
    "2026-10-31",
  );

const plain = (rows: Awaited<ReturnType<typeof budgetRead>>) =>
  rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    amount: r.amount.toDecimalString(),
    currency: r.amount.currency,
    date: r.date,
    parts: r.parts?.map((p) => ({ categoryId: p.categoryId, amount: p.amount.toDecimalString() })) ?? null,
  }));

/** The space's EUR and UAH accounts and a confirmed transfer of −100,00 EUR / `credit` UAH on 2026-10-14. */
async function crossCurrency(credit: string) {
  const space = await newSpace();
  const eur = await createAccount(space, "500.00");
  const uah = await createAccount(space, "0.00", "UAH");
  const out = await add(space, eur, "-100.00", "2026-10-14");
  const into = await add(space, uah, credit, "2026-10-14", "UAH");
  const res = await mark(space, out.id, into.id);
  expect(res.statusCode, res.body).toBe(200);
  return { space, eur, uah, out, into, transfer: res.json().transfer as { id: string } };
}

/** Security review of PR #728 (money): what the budget's read counts of a marked transfer, once and in one period. */
const read = (householdId: string, accountIds: string[], from: string, to: string) =>
  createBudgetTransactions(db.databases.for("transactions"), { feeCategory }).inPeriod(
    householdId,
    accountIds,
    from,
    to,
  );

describe("FIN-03@PoC FR 8: the fee of a transfer is counted once (security review #728)", () => {
  it("FIN-03@PoC FR 8, edge case 1: sides in two months — the fee is in the earlier side's month only, never in both", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-500.00", "2026-09-30");
    const into = await add(space, b, "498.00", "2026-10-01");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    const september = plain(await read(space.householdId, [a, b], "2026-09-01", "2026-09-30"));
    expect(september.map((r) => [r.accountId, r.amount, r.date])).toEqual([[a, "-2", "2026-09-30"]]);
    expect(await read(space.householdId, [a, b], "2026-10-01", "2026-10-31")).toEqual([]);
    // Both months in one read (BUD-06's window): still one row.
    expect(await read(space.householdId, [a, b], "2026-09-01", "2026-10-31")).toHaveLength(1);
  });

  it("FIN-03@PoC FR 8, edge case 1: the credit dated first — the fee is dated by it, in its month only", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    const into = await add(space, b, "498.00", "2026-09-30");
    const out = await add(space, a, "-500.00", "2026-10-01");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect(
      plain(await read(space.householdId, [a, b], "2026-09-01", "2026-09-30")).map((r) => r.date),
    ).toEqual(["2026-09-30"]);
    expect(await read(space.householdId, [a, b], "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("FIN-03@PoC FR 8: the fee belongs to the debit's account — a budget with only the credit's account counts none; with only the debit's, the fee", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-500.00", "2026-10-13");
    const into = await add(space, b, "498.00", "2026-10-13");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect(await budgetRead(space.householdId, [b])).toEqual([]);
    expect(plain(await budgetRead(space.householdId, [a])).map((r) => [r.accountId, r.amount])).toEqual([
      [a, "-2"],
    ]);
    // Removing the mark removes the fee row: the two sides come back, nothing else.
    expect((await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`)).statusCode).toBe(200);
    expect(
      plain(await budgetRead(space.householdId, [a, b]))
        .map((r) => r.amount)
        .sort(),
    ).toEqual(["-500", "498"]);
  });

  it("FIN-03@PoC FR 8: two transfers of a day and a transfer of another space — each of the space's counted once, the other's never", async () => {
    const one = await crossCurrency("4320.00");
    const other = await crossCurrency("4000.00");
    const out = await add(one.space, one.eur, "-10.00", "2026-10-14");
    const into = await add(one.space, one.uah, "400.00", "2026-10-14", "UAH");
    expect((await mark(one.space, out.id, into.id)).statusCode).toBe(200);
    const rows = plain(await budgetRead(one.space.householdId, [one.eur, one.uah, other.eur, other.uah]));
    expect(rows.map((r) => r.amount).sort()).toEqual(["-30", "-35"]);
    expect(rows.every((r) => r.accountId === one.uah)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(other.transfer.id);
  });

  it("FIN-03@PoC FR 8: the difference is never a number on its way — 9 999 999 999,99 EUR at 43,50 less one kopeck", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "0.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const out = await add(space, eur, "-9999999999.99", "2026-10-14");
    const into = await add(space, uah, "434999999999.55", "2026-10-14", "UAH");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    // At the kept rate (1 UAH = 1 ÷ 43,5 EUR at 18 decimals) the debit is 434 999 999 999,56 UAH.
    expect(res.json().transfer.currencyDifference).toEqual({ amount: "-0.01", currency: "UAH" });
  });
  // The credit is counted at the forward rate (100,01 × 43,5 = 4 350,435 → 4 350,44, half to even), the kept opposite
  // rate gives 4 350,43: within half a minor unit — no difference (Рішення ведучого 2026-11-26, #728).
  it("FIN-03@PoC FR 8: «Переказ між рахунками» without «Отримано» — the credit the server counted at the official rate shows no difference and adds nothing to the budget", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "500.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const res = await app.inject({
      method: "POST",
      url: "/v1/transactions/transfers",
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: JSON.stringify({
        fromAccountId: eur,
        toAccountId: uah,
        amount: { amount: "100.01", currency: "EUR" },
        date: "2026-10-14",
        counterparty: "Синтетичний переказ",
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await budgetRead(space.householdId, [eur, uah])).toEqual([]);
  });
});
