import { randomUUID } from "node:crypto";
import { Decimal, Money } from "@willowsum/domain-kernel";
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
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * IMP-03@PoC a) (wave 2 row 47), through the real API on a real PostgreSQL: currency exchanges between the wallets of one
 * multi-currency account — proposed in «Пари · N» with the bank's rate next to the reference one (FR 2, FR 4, FR 21,
 * AC2), confirmed by the user only (FR 8) as a transfer whose difference goes through «Валютна різниця» (FR 9),
 * «Роз'єднати» (FR 13), another space (AC13). Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-03-10";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
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

/** Each wallet's balance of one account, by currency. */
const wallets = async (space: Space, accountId: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await call(space, "GET", `/v1/accounts/${accountId}`))
      .json()
      .currencies.map((c: { currency: string; balance: { amount: string } }) => [
        c.currency,
        c.balance.amount,
      ]),
  );

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
    }[];
  };
};

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
  // AC2: 44,50 UAH per EUR (NBU) on the day of the exchange.
  await rate("2026-03-02", "EUR", "44.5");
  await rate("2026-02-20", "EUR", "44.5");
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

/** A space with «Картка мультивалютна» (wallets UAH 5 000 and EUR 0) and the exchange of AC2 on 2026-03-02. */
async function ac2() {
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
  const out = await add(space, card, "-1000.00", "2026-03-02", "UAH");
  const into = await add(space, card, "22.50", "2026-03-02", "EUR");
  return { space, card, out, into };
}

/**
 * The live postings of the space through «Валютна різниця», signed from that account's side: positive — into it
 * (it is debited), negative — out of it (credited); one per currency, by currency.
 */
async function fxDifferencePostings(householdId: string): Promise<{ currency: string; amount: string }[]> {
  const { rows } = await db.owner.query(
    `SELECT p.currency,
            (CASE WHEN p.debit_account_id = a.id THEN p.amount ELSE -p.amount END)::text AS amount
       FROM ledger.postings p
       JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'fx-difference'
                             AND a.id IN (p.debit_account_id, p.credit_account_id)
       JOIN ledger.entries e ON e.household_id = p.household_id AND e.id = p.entry_id
      WHERE p.household_id = $1 AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY p.currency`,
    [householdId],
  );
  return rows.map((r: { currency: string; amount: string }) => ({
    currency: r.currency,
    amount: Money.of(r.amount, r.currency).toDecimalString(),
  }));
}

describe("IMP-03@PoC FR 2, FR 4, FR 21: «обмін валют» between the wallets of one account is proposed with the bank's rate", () => {
  it("IMP-03@PoC AC2: −1 000 UAH and +22,50 EUR between wallets of one account the same day — the proposal is «обмін валют» and shows the rate", async () => {
    const { space, card, out, into } = await ac2();
    const found = await proposals(space);
    expect(found.count).toBe(1);
    expect(found.items[0]).toMatchObject({
      outflow: { transactionId: out.id, accountId: card, amount: { amount: "-1000", currency: "UAH" } },
      inflow: { transactionId: into.id, accountId: card, amount: { amount: "22.5", currency: "EUR" } },
      date: "2026-03-02",
      pairKind: "exchange",
      kind: "cross-currency",
      fee: null,
      // FR 21: the bank's rate (the pair's own) next to the reference rate of the day (NBU, 1 UAH in EUR).
      bankRate: "0.0225",
      rate: { date: "2026-03-02", source: "NBU" },
      converted: { currency: "EUR" },
      rateBand: "within-1",
    });
    expect(found.items[0]!.rate!.rate).toMatch(/^0\.0224719101123595/);
    // FR 8: only proposed — each side is still an expense and an income with its own journal event.
    expect([await get(space, out.id), await get(space, into.id)]).toMatchObject([
      { type: "expense", transfer: null },
      { type: "income", transfer: null },
    ]);
    expect(await liveEntries(space.householdId)).toEqual([
      ["transaction", "2026-03-02"],
      ["transaction", "2026-03-02"],
    ]);
  });

  it("IMP-03@PoC FR 2, FR 4: a transfer in two currencies between two accounts stays «transfer»; one wallet or beyond 3 % of the reference rate is no proposal", async () => {
    const space = await newSpace();
    const uah = await createAccount(space, "5000.00", "UAH");
    const eur = await createAccount(space, "0.00");
    const out = await add(space, uah, "-1000.00", "2026-03-02", "UAH");
    await add(space, eur, "22.70", "2026-03-02");
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Картка мультивалютна",
      balance: { amount: "5000.00", currency: "UAH" },
      balanceDate: "2026-01-01",
      extraCurrencies: [{ amount: "0.00", currency: "EUR", date: "2026-01-01" }],
    });
    const card = res.json().id as string;
    // One wallet: −200 / +200 UAH on the card is no pair; −2 000 UAH → +46,40 EUR is 3,25 % off the reference.
    await add(space, card, "-200.00", "2026-03-01", "UAH");
    await add(space, card, "200.00", "2026-03-01", "UAH");
    await add(space, card, "-2000.00", "2026-02-20", "UAH");
    await add(space, card, "46.40", "2026-02-20", "EUR");
    const found = await proposals(space);
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      pairKind: "transfer",
      kind: "cross-currency",
      bankRate: "0.0227",
      rateBand: "within-3",
    });
  });
});

describe("IMP-03@PoC FR 9, FR 13: the user confirms an exchange; it is a transfer through «Валютна різниця»", () => {
  it("IMP-03@PoC FR 9: «Підтвердити» the exchange — both sides «Переказ», out of income and expenses; the journal has one fx-transfer between the wallets and the difference through «Валютна різниця»", async () => {
    const { space, card, out, into } = await ac2();
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer).toMatchObject({
      side: "outflow",
      counterpartId: into.id,
      date: "2026-03-02",
      fee: null,
      rate: { rate: "44.5", date: "2026-03-02", source: "NBU" },
    });
    expect((await get(space, into.id)).transfer).toMatchObject({ side: "inflow", counterpartId: out.id });
    expect(await liveEntries(space.householdId)).toEqual([["fx-transfer", "2026-03-02"]]);
    // Neither income nor expense: nothing goes through «Зовнішні кошти».
    expect(await externalFlow(space.householdId)).toEqual({});
    // «Валютна різниця»: 1 000 UAH come in from the UAH wallet, 22,50 EUR go out to the EUR wallet. At the reference
    // rate of the date (44,50 UAH per EUR) the UAH side is worth 22,4719… EUR, so the account gives 0,0281 EUR more
    // than it takes: the difference of FR 9 (positive for the space), never an expense «Комісії банку».
    const fx = await fxDifferencePostings(space.householdId);
    expect(fx).toEqual([
      { currency: "EUR", amount: "-22.5" },
      { currency: "UAH", amount: "1000" },
    ]);
    const atReference = new Decimal(fx[1]!.amount).dividedBy("44.5");
    expect(new Decimal(fx[0]!.amount).negated().minus(atReference).toDecimalPlaces(6).toFixed()).toBe(
      "0.02809",
    );
    // Both actual amounts stay on their wallets.
    expect(await wallets(space, card)).toEqual({ UAH: "4000", EUR: "22.5" });
    expect((await proposals(space)).count).toBe(0);
    const listed = (await call(space, "GET", "/v1/transactions?filter=transfer.eq:false")).json();
    expect(listed.count).toBe(0);
  });

  it("IMP-03@PoC FR 13: «Роз'єднати» the exchange — both sides are an expense and an income again and it is proposed again", async () => {
    const { space, card, out, into } = await ac2();
    expect((await mark(space, into.id, out.id)).statusCode).toBe(200);
    const res = await call(space, "DELETE", `/v1/transactions/${into.id}/transfer`);
    expect(res.statusCode, res.body).toBe(200);
    expect([await get(space, out.id), await get(space, into.id)]).toMatchObject([
      { type: "expense", transfer: null },
      { type: "income", transfer: null },
    ]);
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-03-02"],
      ["transaction", "2026-03-02"],
    ]);
    expect(await fxDifferencePostings(space.householdId)).toEqual([]);
    expect(await wallets(space, card)).toEqual({ UAH: "4000", EUR: "22.5" });
    expect((await proposals(space)).items).toMatchObject([{ pairKind: "exchange" }]);
  });

  it("IMP-03@PoC FR 9: two simultaneous «Підтвердити» of one exchange make one transfer — one answers 200, the other is refused; one fx-transfer", async () => {
    const { space, out, into } = await ac2();
    const [first, second] = await Promise.all([mark(space, out.id, into.id), mark(space, into.id, out.id)]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).not.toBe(200);
    expect([400, 409]).toContain(codes[1]);
    expect(await liveEntries(space.householdId)).toEqual([["fx-transfer", "2026-03-02"]]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transfers WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("IMP-03@PoC AC13: another space sees and confirms nothing", () => {
  it("IMP-03@PoC AC13: a user of another space gets none of the exchange's proposals, and confirming its sides answers not found; nothing written", async () => {
    const { space, out, into } = await ac2();
    const other = await newSpace();
    expect(await proposals(other)).toEqual({ items: [], count: 0, more: false });
    const res = await mark(other, out.id, into.id);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain(into.id);
    expect(leakText(res.body)).not.toContain("22.5");
    expect((await get(space, out.id)).transfer).toBeNull();
    // A scoped member does not see the space's proposals (the visibility policy's default).
    const scoped = await call(space, "GET", "/v1/transfer-proposals", undefined, {
      role: "editor",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect((await proposals(space)).count).toBe(1);
  });
});
