import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
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

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

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

/** The live journal entries of the space from the transactions module: [event type, operation date]. */
async function liveEntries(householdId: string): Promise<[string, string][]> {
  const { rows } = await db.owner.query(
    `SELECT e.event_type, e.operation_date::text AS d FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.recorded_at`,
    [householdId],
  );
  return rows.map((r: { event_type: string; d: string }) => [r.event_type, r.d]);
}

/**
 * What went through «Зовнішні кошти» from the space's transactions — every income and expense in effect, gross, per
 * currency (reversed entries and their reversals cancel out in pairs, so they are left out).
 */
async function externalFlow(householdId: string): Promise<Record<string, string>> {
  const { rows } = await db.owner.query(
    `SELECT p.currency, sum(p.amount)::text AS net
       FROM ledger.postings p
       JOIN ledger.entries e ON e.household_id = p.household_id AND e.id = p.entry_id
       JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'external-funds'
                             AND a.id IN (p.debit_account_id, p.credit_account_id)
      WHERE p.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      GROUP BY p.currency`,
    [householdId],
  );
  return Object.fromEntries(rows.map((r: { currency: string; net: string }) => [r.currency, r.net]));
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

describe("FIN-03@PoC FR 8: the currency difference of a transfer is «Комісії банку» of the budget", () => {
  it("FIN-03@PoC AC31: −100,00 EUR / +4 320,00 UAH at 43,50 — a loss of 30,00 UAH, an expense «Комісії банку» shown on the transfer; the sides are neither income nor expense", async () => {
    const { space, eur, uah, out, into, transfer } = await crossCurrency("4320.00");
    for (const id of [out.id, into.id])
      expect((await call(space, "GET", `/v1/transactions/${id}`)).json().transfer).toMatchObject({
        id: transfer.id,
        fee: null,
        currencyDifference: { amount: "-30", currency: "UAH" },
      });
    const fees = await feeCategory(space.householdId);
    expect(fees).not.toBeNull();
    // Only the difference is counted, on the credit's account, dated by the transfer; the two sides stay out.
    expect(plain(await budgetRead(space.householdId, [eur, uah]))).toEqual([
      {
        id: transfer.id,
        accountId: uah,
        amount: "-30",
        currency: "UAH",
        date: "2026-10-14",
        parts: [{ categoryId: fees, amount: "-30" }],
      },
    ]);
    // A budget without the credit's account counts none of it.
    expect(await budgetRead(space.householdId, [eur])).toEqual([]);
    // IMP-03@PoC FR 9: the journal still posts the difference through «Валютна різниця», not «Зовнішні кошти».
    expect(await liveEntries(space.householdId)).toEqual([["fx-transfer", "2026-10-14"]]);
    expect(await externalFlow(space.householdId)).toEqual({});
  });

  it("FIN-03@PoC AC31: +4 380,00 UAH for the same −100,00 EUR — a gain of 30,00 UAH, an income in the same «Комісії банку»", async () => {
    const { space, eur, uah, out, transfer } = await crossCurrency("4380.00");
    expect(
      (await call(space, "GET", `/v1/transactions/${out.id}`)).json().transfer.currencyDifference,
    ).toEqual({
      amount: "30",
      currency: "UAH",
    });
    const fees = await feeCategory(space.householdId);
    expect(plain(await budgetRead(space.householdId, [eur, uah]))).toEqual([
      {
        id: transfer.id,
        accountId: uah,
        amount: "30",
        currency: "UAH",
        date: "2026-10-14",
        parts: [{ categoryId: fees, amount: "30" }],
      },
    ]);
  });

  it("FIN-03@PoC FR 8: exactly at the official rate — no difference; removing the mark brings the two sides back, without it", async () => {
    const { space, eur, uah, out, into } = await crossCurrency("4350.00");
    expect(
      (await call(space, "GET", `/v1/transactions/${into.id}`)).json().transfer.currencyDifference,
    ).toBeNull();
    expect(await budgetRead(space.householdId, [eur, uah])).toEqual([]);
    expect((await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`)).statusCode).toBe(200);
    expect(
      plain(await budgetRead(space.householdId, [eur, uah]))
        .map((r) => r.id)
        .sort(),
    ).toEqual([out.id, into.id].sort());
  });

  it("FIN-03@PoC FR 8: in one currency the fee is that expense «Комісії банку», on the debit's account", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-500.00", "2026-10-13");
    const into = await add(space, b, "498.00", "2026-10-15");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer).toMatchObject({
      fee: { amount: "-2", currency: "EUR" },
      currencyDifference: null,
    });
    const fees = await feeCategory(space.householdId);
    expect(plain(await budgetRead(space.householdId, [a, b]))).toEqual([
      {
        id: res.json().transfer.id,
        accountId: a,
        amount: "-2",
        currency: "EUR",
        date: "2026-10-13",
        parts: [{ categoryId: fees, amount: "-2" }],
      },
    ]);
  });

  it("FIN-03@PoC FR 8: another space reads none of the transfer — its budget read and the transaction (404)", async () => {
    const { eur, uah, out, transfer } = await crossCurrency("4320.00");
    const other = await newSpace();
    expect(await budgetRead(other.householdId, [eur, uah])).toEqual([]);
    const res = await call(other, "GET", `/v1/transactions/${out.id}`);
    expect(res.statusCode).toBe(404);
    // Neither the transfer nor its difference nor the counterparty shows in the refusal.
    for (const secret of [transfer.id, "currencyDifference", "Синтетичний переказ"])
      expect(leakText(res.body)).not.toContain(secret);
  });
});

describe("BUD-01@PoC FR 7: a found pair is only proposed — «Переказ» comes with the user's confirmation", () => {
  it("BUD-01@PoC AC22: −300 € on a current account and +300 € on another a day later — proposed in «Пари», no «Переказ»; until confirmed both stay an expense and an income of the budget", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-300.00", "2026-10-13");
    const into = await add(space, b, "300.00", "2026-10-14");
    const found = (await call(space, "GET", "/v1/transfer-proposals")).json();
    expect(found.count).toBe(1);
    expect(found.items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      inflow: { transactionId: into.id },
    });
    expect([await get(space, out.id), await get(space, into.id)]).toMatchObject([
      { type: "expense", transfer: null },
      { type: "income", transfer: null },
    ]);
    // The budget counts both sides as they are, with no category of their own («Переказ» is never set by the search).
    const counted = plain(await budgetRead(space.householdId, [a, b]));
    expect(counted.map((r) => [r.id, r.amount, r.parts])).toEqual([
      [out.id, "-300", null],
      [into.id, "300", null],
    ]);
    // «Підтвердити» in «Пари» — the same mark: both leave the budget.
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect(await budgetRead(space.householdId, [a, b])).toEqual([]);
    expect((await call(space, "GET", "/v1/transfer-proposals")).json().count).toBe(0);
  });
});
