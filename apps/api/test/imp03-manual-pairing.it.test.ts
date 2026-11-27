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
 * IMP-03@PoC FR 24 — «Позначити як переказ» (ручне поєднання), through the real API on a real PostgreSQL: the candidates
 * for the other side (7 days, ±5 % in one currency, any amount in another; AC18, AC19, AC21), what is never one, the
 * pair made with «Поєднати в пару», the rights of every role and another space; and the parts of the pairing service
 * already in place: free transactions only, found on request (FR 1, FR 23), nothing applied by the search (FR 8), no
 * rule of different owners in this release (FR 6), a confirmed transfer out of the budget (AC4). Every name and amount
 * is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-20";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;
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

const proposals = async (space: Space, principal: Principal = {}) => {
  const res = await call(space, "GET", "/v1/transfer-proposals", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    more: boolean;
    items: {
      outflow: { transactionId: string };
      inflow: { transactionId: string };
      date: string;
      pairKind: string;
      kind: string;
      bankRate: string | null;
      rateBand: string | null;
      fee: { amount: string } | null;
      converted: { amount: string; currency: string } | null;
      difference: { amount: string } | null;
      rate: { rate: string; date: string } | null;
      score: number;
      confidence: string;
      evidence: { code: string; points: number; days: number | null }[];
      ambiguousWith: { transactionId: string; score: number }[];
    }[];
  };
};

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

const dismiss = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/not-transfer`, { counterpartId }, principal);

const pairsOf = async (space: Space) =>
  (await proposals(space)).items.map((p) => [p.outflow.transactionId, p.inflow.transactionId]);

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
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

/** The budget's read as main.ts wires it: the counted rows of `accountIds` in `from`–`to`. */
const budgetRead = (householdId: string, accountIds: string[], from: string, to: string) =>
  createBudgetTransactions(db.databases.for("transactions"), { feeCategory }).inPeriod(
    householdId,
    accountIds,
    from,
    to,
  );

interface Candidate {
  transactionId: string;
  accountId: string;
  amount: { amount: string; currency: string };
  date: string;
  counterparty: string | null;
  description: string | null;
  kind: string;
  difference: { amount: string; currency: string } | null;
  markable: boolean;
  rate: { rate: string; date: string; source: string } | null;
  converted: { amount: string; currency: string } | null;
  bankRate: string | null;
}

const candidatesRes = (space: Space, id: string, principal: Principal = {}) =>
  call(space, "GET", `/v1/transactions/${id}/transfer-candidates`, undefined, principal);

async function candidates(space: Space, id: string) {
  const res = await candidatesRes(space, id);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { transaction: { transactionId: string }; items: Candidate[]; more: boolean };
}

const amountsOf = (items: Candidate[]) => items.map((c) => `${c.amount.amount} ${c.amount.currency}`);

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

/** A space with «Поточний» and «Ощадний» (EUR). */
async function twoAccounts() {
  const space = await newSpace();
  const current = await createAccount(space, "5000.00");
  const savings = await createAccount(space, "0.00");
  return { space, current, savings };
}

describe("IMP-03@PoC FR 24: «Позначити як переказ» lists the candidates for the other side", () => {
  it("IMP-03@PoC AC19: for −2 000,00 EUR on 15 August — +1 950,00 EUR and +80 000,00 UAH are candidates, +2 300,00 EUR (over 5 %) and +1 990,00 EUR (over 7 days) are not", async () => {
    const { space, current, savings } = await twoAccounts();
    const uah = await createAccount(space, "0.00", "UAH");
    await rate("2026-08-15", "EUR", "41.0000");
    const out = await add(space, current, "-2000.00", "2026-08-15");
    await add(space, savings, "1950.00", "2026-08-18");
    await add(space, savings, "2300.00", "2026-08-19");
    await add(space, savings, "1990.00", "2026-08-25");
    await add(space, uah, "80000.00", "2026-08-20", "UAH");
    const { transaction, items, more } = await candidates(space, out.id);
    expect(transaction.transactionId).toBe(out.id);
    // Nearest in date first: +1 950,00 EUR three days after, +80 000,00 UAH five.
    expect(amountsOf(items)).toEqual(["1950 EUR", "80000 UAH"]);
    expect(more).toBe(false);
    expect(items[0]).toMatchObject({
      accountId: savings,
      date: "2026-08-18",
      counterparty: "Синтетичний переказ",
      kind: "same-currency",
      markable: true,
      rate: null,
      bankRate: null,
    });
    expect(items[1]).toMatchObject({
      accountId: uah,
      kind: "cross-currency",
      markable: true,
      rate: { date: "2026-08-15" },
      bankRate: "40",
    });
    expect(items[1]!.converted?.currency).toBe("UAH");
    expect(Number(items[1]!.converted?.amount)).toBe(82000);
    expect(Number(items[1]!.difference?.amount)).toBe(-2000);
  });

  it("IMP-03@PoC AC18: −200,00 EUR on 10 October and +199,00 EUR on 12 October — the candidate shows the 1,00 € difference for «Комісії банку», and «Поєднати в пару» makes the pair", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-200.00", "2026-10-10");
    const into = await add(space, savings, "199.00", "2026-10-12");
    const { items } = await candidates(space, out.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ transactionId: into.id, kind: "same-currency", markable: true });
    expect(Number(items[0]!.difference?.amount)).toBe(-1);
    expect(items[0]!.difference?.currency).toBe("EUR");
    const made = await mark(space, out.id, items[0]!.transactionId);
    expect(made.statusCode, made.body).toBe(200);
    const pair = (await get(space, out.id)).transfer;
    expect(pair).toMatchObject({ counterpartId: into.id });
    expect(Number(pair?.fee?.amount)).toBe(-1);
    // Paired, neither side is a candidate of anything any more.
    expect((await candidatesRes(space, out.id)).statusCode).toBe(400);
  });

  it("IMP-03@PoC AC21: −75,00 EUR with no free credit within 7 days before or after and 5 % of the amount — the list is empty", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-75.00", "2026-10-10");
    await add(space, savings, "75.00", "2026-10-18"); // 8 days after
    await add(space, savings, "75.00", "2026-10-02"); // 8 days before
    await add(space, savings, "80.00", "2026-10-11"); // 6,7 % more
    await add(space, savings, "71.00", "2026-10-11"); // 5,3 % less
    expect(await candidates(space, out.id)).toMatchObject({ items: [], more: false });
  });

  it("IMP-03@PoC FR 24: the bounds are inclusive — 7 days, the debit itself and exactly 5 % below it; a credit above the debit is no candidate; nearest date first, then the nearer amount", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-2000.00", "2026-10-10");
    await add(space, savings, "2000.01", "2026-10-10"); // above the debit (owner, 2026-11-27)
    await add(space, savings, "2050.00", "2026-10-11"); // above the debit, within 5 %
    await add(space, savings, "1899.99", "2026-10-11"); // just over 5 % below
    await add(space, savings, "1900.00", "2026-10-03");
    await add(space, savings, "1990.00", "2026-10-11");
    await add(space, savings, "2000.00", "2026-10-11");
    const { items } = await candidates(space, out.id);
    expect(amountsOf(items)).toEqual(["2000 EUR", "1990 EUR", "1900 EUR"]);
    expect(items.every((c) => c.markable)).toBe(true);
  });

  it("IMP-03@PoC FR 24: chosen on the credit side — only a debit not below the credit, at most 5 % of the credit above it", async () => {
    const { space, current, savings } = await twoAccounts();
    const into = await add(space, savings, "2000.00", "2026-10-10");
    await add(space, current, "-1999.99", "2026-10-10"); // the credit would exceed the debit
    await add(space, current, "-2100.01", "2026-10-10"); // just over 5 % above
    await add(space, current, "-2100.00", "2026-10-11");
    await add(space, current, "-2000.00", "2026-10-12");
    const { items } = await candidates(space, into.id);
    expect(amountsOf(items)).toEqual(["-2100 EUR", "-2000 EUR"]);
    expect(items.every((c) => c.markable)).toBe(true);
    expect(Number(items[0]!.difference?.amount)).toBe(-100);
  });

  it("IMP-03@PoC FR 24: chosen on the credit side — the debits are the candidates", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-300.00", "2026-10-10");
    const into = await add(space, savings, "300.00", "2026-10-11");
    const { items } = await candidates(space, into.id);
    expect(items.map((c) => c.transactionId)).toEqual([out.id]);
  });

  it("IMP-03@PoC FR 24: never a candidate — a side of a confirmed pair, the same direction, the same account in its currency; a pair called «Не пара» still is", async () => {
    const { space, current, savings } = await twoAccounts();
    const third = await createAccount(space, "0.00");
    const pairedOut = await add(space, third, "-500.00", "2026-10-09");
    const pairedIn = await add(space, savings, "500.00", "2026-10-10");
    expect((await mark(space, pairedOut.id, pairedIn.id)).statusCode).toBe(200);
    const out = await add(space, current, "-500.00", "2026-10-10");
    await add(space, current, "500.00", "2026-10-10"); // the same account and currency
    await add(space, savings, "-500.00", "2026-10-10"); // the same direction
    const free = await add(space, savings, "500.00", "2026-10-11");
    expect((await dismiss(space, out.id, free.id)).statusCode).toBe(200);
    const { items } = await candidates(space, out.id);
    expect(items.map((c) => c.transactionId)).toEqual([free.id]);
  });

  it("IMP-03@PoC FR 24: never a candidate — a pending, a hidden or a split credit; only the free one is listed", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const pending = await add(space, savings, "500.00", "2026-10-10");
    const hidden = await add(space, savings, "500.00", "2026-10-10");
    const split = await add(space, savings, "500.00", "2026-10-10");
    const free = await add(space, savings, "500.00", "2026-10-11");
    await db.owner.query(`UPDATE transactions.transactions SET status = 'pending' WHERE id = $1`, [
      pending.id,
    ]);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hidden.id]);
    await db.owner.query(`UPDATE transactions.transactions SET split_mode = 'months' WHERE id = $1`, [
      split.id,
    ]);
    const { items } = await candidates(space, out.id);
    expect(items.map((c) => c.transactionId)).toEqual([free.id]);
  });

  it("IMP-03@PoC FR 24, FR 2: another wallet of the same account is a candidate (an exchange); the same wallet is not", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Картка мультивалютна",
      balance: { amount: "5000.00", currency: "UAH" },
      balanceDate: "2026-01-01",
      extraCurrencies: [{ amount: "0.00", currency: "EUR", date: "2026-01-01" }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const card = res.json().id as string;
    // A known reference rate, so the exchange can be marked (a pair in two currencies without one is not markable);
    // in May, after the no-rate case of March below.
    await rate("2026-05-04", "EUR", "44.0000");
    const out = await add(space, card, "-1000.00", "2026-05-04", "UAH");
    await add(space, card, "1000.00", "2026-05-04", "UAH"); // the same wallet
    const into = await add(space, card, "22.50", "2026-05-04", "EUR");
    const { items } = await candidates(space, out.id);
    expect(items.map((c) => c.transactionId)).toEqual([into.id]);
    expect(items[0]).toMatchObject({ kind: "cross-currency", markable: true });
  });

  it("IMP-03@PoC FR 24: a transaction already in a transfer has no candidates — 400 `in_transfer`; an unknown one — 404", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-10");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    const res = await candidatesRes(space, out.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "path", path: "transactionId", issue: "in_transfer" }]);
    expect((await candidatesRes(space, randomUUID())).statusCode).toBe(404);
  });

  it("IMP-03@PoC FR 24: the list reads only — nothing is marked or stored", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-10");
    await candidates(space, out.id);
    expect((await get(space, out.id)).transfer).toBeNull();
    expect((await get(space, into.id)).transfer).toBeNull();
  });

  it("IMP-03@PoC FR 24: behind the flag `transactions.transfers` — off, the route is not there", async () => {
    const { space, current } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    off.add("transactions.transfers");
    expect((await candidatesRes(space, out.id)).statusCode).toBe(404);
  });
});

describe("IMP-03@PoC FR 24: rights — every role, a scoped member and another space", () => {
  it("IMP-03@PoC FR 24: owner, admin and editor list the candidates; a viewer, an advisor and a scoped member get 403; another space 404 — no records or amounts", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-512.34", "2026-10-10");
    const into = await add(space, savings, "512.34", "2026-10-10");
    for (const role of ["owner", "admin", "editor"]) {
      const res = await candidatesRes(space, out.id, { role });
      expect(res.statusCode, role).toBe(200);
      expect(res.json().items.map((c: Candidate) => c.transactionId)).toEqual([into.id]);
    }
    for (const principal of [
      { role: "viewer" },
      { role: "advisor" },
      { role: "editor", scoped: true },
      { role: "owner", scoped: true },
    ]) {
      const res = await candidatesRes(space, out.id, principal);
      expect(res.statusCode, JSON.stringify(principal)).toBe(403);
      expect(leakText(res.body)).not.toContain(into.id);
      expect(leakText(res.body)).not.toContain("512");
    }
    const other = await newSpace();
    const res = await candidatesRes(other, out.id);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain(into.id);
    expect(leakText(res.body)).not.toContain("512");
  });
});

describe("IMP-03@PoC: the pairing service already in place", () => {
  it("IMP-03@PoC FR 1: the search runs over the space's free transactions only, on request — a side of a confirmed pair is left out, a new transaction is in the next read", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-10");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    await add(space, savings, "500.00", "2026-10-11"); // could pair with `out`, which is not free
    expect(await pairsOf(space)).toEqual([]);
    const next = await add(space, current, "-500.00", "2026-10-11");
    const later = await pairsOf(space);
    expect(later).toHaveLength(1);
    expect(later[0]![0]).toBe(next.id);
  });

  it("IMP-03@PoC FR 23: «Шукати пари знову» — a repeated search over all free transactions finds the pair a removed mark set free", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-11");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect((await proposals(space)).count).toBe(0);
    expect((await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`)).statusCode).toBe(200);
    expect(await pairsOf(space)).toEqual([[out.id, into.id]]);
  });

  it("IMP-03@PoC FR 8: nothing is applied without the user's confirmation — the search marks neither side", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-10");
    expect((await proposals(space)).count).toBe(1);
    expect((await proposals(space)).count).toBe(1);
    expect((await get(space, out.id)).transfer).toBeNull();
    expect((await get(space, into.id)).transfer).toBeNull();
  });

  it("IMP-03@PoC FR 6: one owner per space in this release — no evidence of owners in a proposal", async () => {
    const { space, current, savings } = await twoAccounts();
    await add(space, current, "-500.00", "2026-10-10");
    await add(space, savings, "500.00", "2026-10-11");
    const codes = (await proposals(space)).items.flatMap((p) => p.evidence.map((e) => e.code));
    expect(codes).toEqual(["exact-amount", "days-apart"]);
  });

  it("IMP-03@PoC AC4: a confirmed transfer — neither side is in the budget's income or expenses", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10");
    const into = await add(space, savings, "500.00", "2026-10-11");
    const before = await budgetRead(space.householdId, [current, savings], "2026-10-01", "2026-10-31");
    expect(before.map((r) => r.id).sort()).toEqual([out.id, into.id].sort());
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect(await budgetRead(space.householdId, [current, savings], "2026-10-01", "2026-10-31")).toEqual([]);
  });
});

describe("IMP-03@PoC FR 24: security — the candidates of one space, the cap and the flag", () => {
  it("IMP-03@PoC FR 24: another space's credit that would match is never a candidate — no id, account or amount of it", async () => {
    const { space, current } = await twoAccounts();
    const out = await add(space, current, "-612.34", "2026-10-10");
    const other = await newSpace();
    const otherAccount = await createAccount(other, "0.00");
    const theirs = await add(other, otherAccount, "612.34", "2026-10-10");
    const res = await candidatesRes(space, out.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(leakText(res.body)).not.toContain(theirs.id);
    expect(leakText(res.body)).not.toContain(otherAccount);
  });

  it("IMP-03@PoC FR 24: a hidden or pending transaction is never a candidate, and a pending chosen one has none", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-400.00", "2026-10-12");
    const dup = await add(space, savings, "400.00", "2026-10-12");
    await add(space, savings, "400.00", "2026-10-12"); // FR 18: its copy, so it may be hidden
    expect((await call(space, "POST", `/v1/transactions/${dup.id}/hide`)).statusCode).toBe(200);
    const pending = await call(space, "POST", "/v1/transactions", {
      accountId: savings,
      amount: { amount: "400.00", currency: "EUR" },
      date: "2026-10-12",
      status: "pending",
    });
    expect(pending.statusCode, pending.body).toBe(201);
    const ids = (await candidates(space, out.id)).items.map((c) => c.transactionId);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(dup.id);
    expect(ids).not.toContain(pending.json().id);
    const res = await candidatesRes(space, pending.json().id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "path", path: "transactionId", issue: "pending" }]);
  });

  it("IMP-03@PoC FR 24: equal amounts are markable (no fee); 50 candidates — `more` false, 51 — 50 listed and `more` true", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-1000.00", "2026-10-10");
    for (let i = 0; i < 50; i++) await add(space, savings, "1000.00", "2026-10-11");
    const fifty = await candidates(space, out.id);
    expect(fifty.items).toHaveLength(50);
    expect(fifty.more).toBe(false);
    expect(fifty.items[0]).toMatchObject({ kind: "same-currency", markable: true });
    expect(Number(fifty.items[0]!.difference?.amount)).toBe(0);
    await add(space, savings, "1000.00", "2026-10-12");
    const more = await candidates(space, out.id);
    expect(more.items).toHaveLength(50);
    expect(more.more).toBe(true);
  });
});

describe("IMP-03@PoC FR 24: security — a split transaction is no side", () => {
  it("IMP-03@PoC FR 24: a split debit is never a candidate", async () => {
    const { space, current, savings } = await twoAccounts();
    const into = await add(space, savings, "300.00", "2026-10-11");
    const split = await add(space, current, "-300.00", "2026-10-10");
    const free = await add(space, current, "-300.00", "2026-10-12");
    const food = (await call(space, "GET", "/v1/categories"))
      .json()
      .groups.flatMap((g: { categories: { id: string; kind: string }[] }) => g.categories)
      .find((c: { kind: string }) => c.kind === "expense").id;
    const res = await call(space, "POST", `/v1/transactions/${split.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: food,
    });
    expect(res.statusCode, res.body).toBe(200);
    const ids = (await candidates(space, into.id)).items.map((c) => c.transactionId);
    expect(ids).toEqual([free.id]);
  });
});

describe("IMP-03@PoC FR 24: security — `markable` tells what «Поєднати в пару» answers", () => {
  it("IMP-03@PoC FR 24: a candidate in another currency with no known rate is listed but not markable — the mark answers `rate_unavailable`", async () => {
    const { space, current } = await twoAccounts();
    const uah = await createAccount(space, "0.00", "UAH");
    const out = await add(space, current, "-100.00", "2026-03-10");
    const into = await add(space, uah, "4100.00", "2026-03-11", "UAH");
    const { items } = await candidates(space, out.id);
    expect(items.map((c) => c.transactionId)).toEqual([into.id]);
    expect(items[0]).toMatchObject({ kind: "cross-currency", rate: null, difference: null });
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "rate_unavailable" }]);
    expect(items[0]!.markable).toBe(false);
  });
});
