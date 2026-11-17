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
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * Security review of PR #456 (tests the review adds; apply with fix-review-findings).
 * FIN-03@PoC FR 1, FR 28 (issue #437), through the real API on a real PostgreSQL: «Переказ між рахунками» of «Нова
 * транзакція» — a transfer between two own accounts in one request (`POST /v1/transactions/transfers`): both legs and
 * one journal event or nothing, in one currency and in two (the official rate of the date, FR 8), audited (FR 20),
 * the space's own (AC11) and never on a closed account; idempotent by the Idempotency-Key (ARC-07@PoC FR 4). Every
 * name and amount is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
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
  extra: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      ...extra,
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
  // 43,50 UAH per EUR on 2026-10-14 (official NBU rate, VAL-04).
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

const transfer = (
  space: Space,
  body: Record<string, unknown>,
  key: string = randomUUID(),
  principal: Principal = {},
) => call(space, "POST", "/v1/transactions/transfers", body, principal, { "idempotency-key": key });

/** A space with A (1 000 EUR) and B (0 EUR). */
async function twoAccounts() {
  const space = await newSpace();
  const a = await createAccount(space, "1000.00");
  const b = await createAccount(space, "0.00");
  return { space, a, b };
}

const body = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  fromAccountId: from,
  toAccountId: to,
  amount: { amount: "120.00", currency: "EUR" },
  date: "2026-10-14",
  counterparty: "Синтетичний переказ",
  ...extra,
});

/** The space's transactions and transfers as stored, and its journal entries from the transactions module. */
async function written(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT (SELECT count(*)::int FROM transactions.transactions WHERE household_id = $1) AS transactions,
            (SELECT count(*)::int FROM transactions.transfers WHERE household_id = $1) AS transfers`,
    [householdId],
  );
  return { ...rows[0], entries: (await liveEntries(householdId)).length } as {
    transactions: number;
    transfers: number;
    entries: number;
  };
}

const NOTHING = { transactions: 0, transfers: 0, entries: 0 };

const eurBody = (a: string, b: string, amount: string, extra: Record<string, unknown> = {}) =>
  body(a, b, { amount: { amount, currency: "EUR" }, ...extra });

const stored = async (householdId: string) => {
  const w = await written(householdId);
  const { rows } = await db.owner.query(
    `SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1 AND source_module = 'transactions'
        AND event_type IN ('transfer', 'fx-transfer')`,
    [householdId],
  );
  return { ...w, transferEntries: rows[0].n as number };
};

describe("sec456 (security review of #456): createTransfer at the stored size and the order of its refusals", () => {
  it("sec456 limits: a converted credit of exactly 20 integer digits is stored with its journal event; one cent more is 400 and nothing is written", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "0.00");
    const uah = await createAccount(space, "0.00", "UAH");
    // 2298850574712643678.17 × 43.5 = 100000000000000000000.395; 2298850574712643678.16 × 43.5 = 99999999999999999999.96.
    const over = await transfer(space, eurBody(eur, uah, "2298850574712643678.17"));
    expect(over.statusCode, over.body).toBe(400);
    expect(await written(space.householdId)).toEqual(NOTHING);
    const max = await transfer(space, eurBody(eur, uah, "2298850574712643678.16"));
    expect(max.statusCode, max.body).toBe(201);
    expect(max.json().inflow.amount.amount).toBe("99999999999999999999.96");
    expect(await stored(space.householdId)).toEqual({
      transactions: 2,
      transfers: 1,
      entries: 1,
      transferEntries: 1,
    });
  });

  // Defect (non-blocking, from #451): an entered credit whose value in the debit's currency is beyond NUMERIC(38,18)
  // is stored (201) but its journal event can never be posted. With the patch this passes as written.
  it("sec456 limits: an entered credit the journal cannot convert into the debit's currency is a field issue (400) — never two rows without their journal event", async () => {
    const space = await newSpace();
    const uah = await createAccount(space, "0.00", "UAH");
    const eur = await createAccount(space, "0.00");
    const res = await transfer(
      space,
      body(uah, eur, {
        amount: { amount: "1.00", currency: "UAH" },
        received: { amount: "99999999999999999999.99", currency: "EUR" },
      }),
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(await stored(space.householdId)).toEqual({ ...NOTHING, transferEntries: 0 });
    // The largest entered credit the journal can keep: 2298850574712643678.16 EUR is 99999999999999999999.96 UAH.
    const fits = await transfer(
      space,
      body(uah, eur, {
        amount: { amount: "1.00", currency: "UAH" },
        received: { amount: "2298850574712643678.16", currency: "EUR" },
      }),
    );
    expect(fits.statusCode, fits.body).toBe(201);
    expect((await stored(space.householdId)).transferEntries).toBe(1);
  });

  it("sec456 limits: the largest debit with the smallest entered credit is stored with its journal event", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "0.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const res = await transfer(
      space,
      body(eur, uah, {
        amount: { amount: "99999999999999999999.99", currency: "EUR" },
        received: { amount: "0.01", currency: "UAH" },
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect((await stored(space.householdId)).transferEntries).toBe(1);
  });

  it("sec456 order: permission and space isolation are answered before the account's state — a closed account of another space is 404, a reader gets 403", async () => {
    const mine = await twoAccounts();
    const theirs = await twoAccounts();
    const theirClosed = await createAccount(theirs.space, "0.00");
    expect(
      (await call(theirs.space, "POST", `/v1/accounts/${theirClosed}/close`, { closedOn: TODAY })).statusCode,
    ).toBe(200);
    const mineClosed = await createAccount(mine.space, "0.00");
    expect(
      (await call(mine.space, "POST", `/v1/accounts/${mineClosed}/close`, { closedOn: TODAY })).statusCode,
    ).toBe(200);
    const status = async (b: Record<string, unknown>, principal: Principal = {}) =>
      (await transfer(mine.space, b, randomUUID(), principal)).statusCode;
    expect(await status(body(theirClosed, mine.b))).toBe(404);
    expect(await status(body(theirClosed, theirClosed))).toBe(404);
    expect(await status(body(theirClosed, mine.b, { date: "2026-13-01" }))).toBe(404);
    expect(await status(body(mineClosed, theirs.a))).toBe(404);
    expect(await status(body(mineClosed, theirClosed))).toBe(404);
    expect(await status(body(mineClosed, mine.b), { role: "viewer" })).toBe(403);
    expect(await status(body(theirClosed, mine.b), { role: "viewer" })).toBe(403);
    expect(await status(body(mineClosed, mine.b), { role: "editor", scoped: true })).toBe(403);
    expect(await written(mine.space.householdId)).toEqual(NOTHING);
    expect(await written(theirs.space.householdId)).toEqual(NOTHING);
  });
});
