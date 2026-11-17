import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
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
 * Security review of PR #451 (tests the review adds; apply with fix-review-findings).
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

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

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

interface Created {
  outflow: Transaction & {
    accountId: string;
    amount: { amount: string; currency: string };
    counterparty: string;
  };
  inflow: Transaction & {
    accountId: string;
    amount: { amount: string; currency: string };
    counterparty: string;
  };
}

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

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    for (let pass = 0; pass < 10; pass++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eurBody = (a: string, b: string, amount: string, extra: Record<string, unknown> = {}) =>
  body(a, b, { amount: { amount, currency: "EUR" }, ...extra });

describe("sec451 (security review of #451): createTransfer", () => {
  it("sec451 permission: a role without household.data.write (viewer, advisor) is refused 403 and writes nothing; editor and admin may", async () => {
    const { space, a, b } = await twoAccounts();
    for (const role of ["viewer", "advisor", "nobody"]) {
      const res = await transfer(space, body(a, b), randomUUID(), { role });
      expect(res.statusCode, role).toBe(403);
    }
    expect(await written(space.householdId)).toEqual(NOTHING);
    // A scoped member, whatever the role.
    for (const role of ["owner", "admin", "editor"])
      expect((await transfer(space, body(a, b), randomUUID(), { role, scoped: true })).statusCode).toBe(403);
    expect(await written(space.householdId)).toEqual(NOTHING);
    for (const role of ["editor", "admin"])
      expect((await transfer(space, body(a, b), randomUUID(), { role })).statusCode).toBe(201);
  });

  it("sec451 isolation: another space's account answers exactly as an unknown one — also when it is closed or the amount is wrong", async () => {
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
    const strip = (s: string) => s.replace(/"(traceId|requestId|instance)":"[^"]*",?/g, "");
    const unknown = randomUUID();
    const variants: Record<string, unknown>[] = [
      {},
      { amount: { amount: "-5.00", currency: "EUR" } },
      { amount: { amount: "5.00", currency: "USD" } },
      { date: "2026-10-18" },
      { received: { amount: "999.00", currency: "EUR" } },
    ];
    for (const extra of variants) {
      for (const [foreign, side] of [
        [theirs.a, "from"],
        [theirs.a, "to"],
        [theirClosed, "from"],
        [theirClosed, "to"],
      ] as const) {
        const withForeign = await transfer(
          mine.space,
          side === "from" ? body(foreign, mine.b, extra) : body(mine.a, foreign, extra),
        );
        const withUnknown = await transfer(
          mine.space,
          side === "from" ? body(unknown, mine.b, extra) : body(mine.a, unknown, extra),
        );
        expect(withForeign.statusCode, JSON.stringify([extra, side])).toBe(404);
        expect(withUnknown.statusCode).toBe(404);
        expect(strip(withForeign.body)).toBe(strip(withUnknown.body));
        expect(withForeign.body).not.toContain(foreign);
      }
      // Own closed account on one side and a foreign one on the other: still «not found», the same as unknown.
      const closedAndForeign = await transfer(mine.space, body(mineClosed, theirs.a, extra));
      const closedAndUnknown = await transfer(mine.space, body(mineClosed, unknown, extra));
      expect(closedAndForeign.statusCode).toBe(404);
      expect(strip(closedAndForeign.body)).toBe(strip(closedAndUnknown.body));
    }
    expect(await written(mine.space.householdId)).toEqual(NOTHING);
    expect(await written(theirs.space.householdId)).toEqual(NOTHING);
  });

  it("sec451 isolation: the rows are written under the caller's space only (household_id of both legs, the pair, the jobs and the audit entries)", async () => {
    const { space, a, b } = await twoAccounts();
    const other = await twoAccounts();
    const res = await transfer(space, body(a, b));
    expect(res.statusCode).toBe(201);
    const { outflow, inflow } = res.json() as Created;
    const { rows } = await db.owner.query(
      `SELECT household_id, account_id, amount::text AS amount FROM transactions.transactions WHERE id = ANY($1::uuid[])`,
      [[outflow.id, inflow.id]],
    );
    expect(rows.map((r: { household_id: string }) => r.household_id)).toEqual([
      space.householdId,
      space.householdId,
    ]);
    // The other space cannot read either leg.
    for (const id of [outflow.id, inflow.id])
      expect((await call(other.space, "GET", `/v1/transactions/${id}`)).statusCode).toBe(404);
    expect(await written(other.space.householdId)).toEqual(NOTHING);
    // The actor of both audit entries is the caller.
    for (const id of [outflow.id, inflow.id]) {
      const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
      expect(log).toHaveLength(1);
      expect(JSON.stringify(log[0])).toContain(space.accountId);
      expect(JSON.stringify(log[0])).not.toContain("Синтетичний");
    }
  });

  it("sec451 idempotency: the key is the space's — the same key in another space is its own request; the same key on another create is refused", async () => {
    const one = await twoAccounts();
    const two = await twoAccounts();
    const key = randomUUID();
    const first = await transfer(one.space, body(one.a, one.b), key);
    expect(first.statusCode).toBe(201);
    const second = await transfer(two.space, body(two.a, two.b), key);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.json().outflow.id).not.toBe(first.json().outflow.id);
    expect(second.body).not.toContain(one.a);
    // The other space with the first space's body and key: no replay of the first space's answer.
    const stolen = await transfer(two.space, body(one.a, one.b), randomUUID());
    expect(stolen.statusCode).toBe(404);
    const replayAttempt = await transfer(two.space, body(one.a, one.b), key);
    expect(replayAttempt.statusCode).toBe(409);
    expect(replayAttempt.body).not.toContain(first.json().outflow.id);
    // The key of a transfer used for a plain transaction (same module table): refused, nothing replayed.
    const plain = await call(
      one.space,
      "POST",
      "/v1/transactions",
      { accountId: one.a, amount: { amount: "-1.00", currency: "EUR" }, date: "2026-10-14" },
      {},
      { "idempotency-key": key },
    );
    expect(plain.statusCode).toBe(409);
    expect(await written(one.space.householdId)).toEqual({ transactions: 2, transfers: 1, entries: 1 });
  });

  it("sec451 idempotency: twelve concurrent submits with one key make one transfer", async () => {
    const { space, a, b } = await twoAccounts();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => transfer(space, body(a, b), key)));
    const made = results.filter((r) => r.statusCode === 201);
    expect(made.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([201, 409]).toContain(r.statusCode);
    expect(new Set(made.map((r) => r.json().outflow.id)).size).toBe(1);
    expect(await written(space.householdId)).toEqual({ transactions: 2, transfers: 1, entries: 1 });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "120"]);
    // A refused request releases its key: the same key and body, once valid, runs.
    const k2 = randomUUID();
    off.add("transactions.transfers");
    expect((await transfer(space, body(a, b), k2)).statusCode).toBe(404);
    off.clear();
    expect((await transfer(space, body(a, b), k2)).statusCode).toBe(201);
  });

  it("sec451 limits: malformed, oversized and non-decimal amounts and unknown currencies are refused 400 — never a 500, never a number, nothing written", async () => {
    const { space, a, b } = await twoAccounts();
    const bad: Record<string, unknown>[] = [
      { amount: { amount: 120, currency: "EUR" } },
      { amount: { amount: "1e3", currency: "EUR" } },
      { amount: { amount: "NaN", currency: "EUR" } },
      { amount: { amount: "Infinity", currency: "EUR" } },
      { amount: { amount: " 1.00", currency: "EUR" } },
      { amount: { amount: "+1.00", currency: "EUR" } },
      { amount: { amount: "1.", currency: "EUR" } },
      { amount: { amount: "1,00", currency: "EUR" } },
      { amount: { amount: "0x10", currency: "EUR" } },
      { amount: { amount: "0.00", currency: "EUR" } },
      { amount: { amount: "-0", currency: "EUR" } },
      { amount: { amount: "0.001", currency: "EUR" } },
      { amount: { amount: "1".repeat(21), currency: "EUR" } },
      { amount: { amount: "9".repeat(49), currency: "EUR" } },
      { amount: { amount: "1.00", currency: "eur" } },
      { amount: { amount: "1.00", currency: "XXX" } },
      { amount: { amount: "1.00", currency: "EURO" } },
      { amount: { amount: "1.00" } },
      { received: { amount: "-1.00", currency: "EUR" } },
      { received: { amount: "0", currency: "EUR" } },
      { received: { amount: "0.001", currency: "EUR" } },
      { received: { amount: "1e2", currency: "EUR" } },
      { received: { amount: 1, currency: "EUR" } },
      { received: { amount: "120.01", currency: "EUR" } },
      { received: { amount: "1.00", currency: "USD" } },
      { received: null },
      { date: "2026-13-01" },
      { date: "1899-12-31" },
      { fromAccountId: "not-a-uuid" },
      { extra: true },
    ];
    for (const extra of bad) {
      const res = await transfer(space, body(a, b, extra));
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(await written(space.householdId)).toEqual(NOTHING);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["1000", "0"]);
  });

  it("sec451 limits: the largest amounts are exact (no float) or refused — also when the converted credit is beyond the stored size", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "0.00");
    const b = await createAccount(space, "0.00");
    // 2^53 + 1 minor units and a 20-digit amount: exact.
    const big = await transfer(space, eurBody(a, b, "90071992547409.93"));
    expect(big.statusCode, big.body).toBe(201);
    expect(big.json().inflow.amount.amount).toBe("90071992547409.93");
    const huge = await transfer(space, eurBody(a, b, "99999999999999999999.99"));
    expect([201, 400], huge.body).toContain(huge.statusCode);
    if (huge.statusCode === 201) expect(huge.json().inflow.amount.amount).toBe("99999999999999999999.99");
    // 0,1 + 0,2: decimal, not binary.
    const c = await createAccount(space, "0.00");
    const d = await createAccount(space, "0.00");
    for (const amount of ["0.10", "0.20"])
      expect((await transfer(space, eurBody(c, d, amount))).statusCode).toBe(201);
    expect([await balance(space, c), await balance(space, d)]).toEqual(["-0.3", "0.3"]);
  });

  it("sec451 rate: the credit uses the official rate of the date or the nearest earlier one, never a later one, rounded half to even", async () => {
    // 42,50 UAH per EUR from 2026-09-01; nothing earlier.
    await rate("2026-09-01", "EUR", "42.5");
    const space = await newSpace();
    const eur = await createAccount(space, "100.00");
    const uah = await createAccount(space, "0.00", "UAH");
    // Before the first rate: a later rate is never used.
    const early = await transfer(space, eurBody(eur, uah, "1.00", { date: "2026-08-31" }));
    expect(early.statusCode).toBe(400);
    expect(early.json().errors).toEqual([{ in: "body", path: "date", issue: "rate_unavailable" }]);
    expect(await written(space.householdId)).toEqual(NOTHING);
    // Half to even: 0,01 × 42,5 = 0,425 → 0,42; 0,03 × 42,5 = 1,275 → 1,28; 0,05 × 42,5 = 2,125 → 2,12.
    for (const [sent, got, date] of [
      ["0.01", "0.42", "2026-09-01"],
      ["0.03", "1.28", "2026-09-03"],
      ["0.05", "2.12", "2026-09-30"],
    ] as const) {
      const res = await transfer(space, eurBody(eur, uah, sent, { date }));
      expect(res.statusCode, res.body).toBe(201);
      const { outflow, inflow } = res.json() as Created;
      expect(inflow.amount).toEqual({ amount: got, currency: "UAH" });
      // The rate kept is the dated one: its own date, not the transfer's.
      expect(outflow.transfer!.rate).toMatchObject({ date: "2026-09-01", source: "NBU" });
    }
    // From 2026-10-14 on the rate of that date (43,5), not the earlier one.
    const later = await transfer(space, eurBody(eur, uah, "1.00", { date: "2026-10-15" }));
    expect(later.json().inflow.amount).toEqual({ amount: "43.5", currency: "UAH" });
    expect(later.json().outflow.transfer.rate).toMatchObject({ date: "2026-10-14" });
    expect([await balance(space, eur), await balance(space, uah)]).toEqual(["98.91", "47.32"]);
  });

  it("sec451 rate: across currencies without an official rate an entered credit is refused too — no transfer without its dated rate", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "100.00");
    const pln = await createAccount(space, "0.00", "PLN");
    const res = await transfer(
      space,
      eurBody(eur, pln, "10.00", { received: { amount: "43.00", currency: "PLN" } }),
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "date", issue: "rate_unavailable" }]);
    expect(await written(space.householdId)).toEqual(NOTHING);
    expect([await balance(space, eur), await balance(space, pln)]).toEqual(["100", "0"]);
  });

  // Defect (non-blocking): the converted credit beyond NUMERIC(38,18) throws in `convert` — 500 instead of a field issue.
  // Nothing is written either way. With the patch below this passes as a plain `it`.
  it("sec451 limits: an amount whose converted credit does not fit the stored size is a field issue (400), not a 500", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "0.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const over = await transfer(space, eurBody(eur, uah, "99999999999999999999.99"));
    expect(await written(space.householdId)).toEqual(NOTHING);
    expect(over.statusCode, over.body).toBe(400);
  });

  it("sec451 closed: the checks run fields first, then the closed account — a closed `from` is 409 with a valid form, 400 with field errors, like `to` and createTransaction (#456)", async () => {
    const { space, b } = await twoAccounts();
    const a = await createAccount(space, "0.00");
    expect((await call(space, "POST", `/v1/accounts/${a}/close`, { closedOn: TODAY })).statusCode).toBe(200);
    expect((await transfer(space, body(a, b))).statusCode).toBe(409);
    for (const extra of [{ amount: { amount: "-5.00", currency: "EUR" } }, { date: "2026-13-01" }])
      expect((await transfer(space, body(a, b, extra))).statusCode, JSON.stringify(extra)).toBe(400);
    // `from` = `to` on a closed account is still `same_account`.
    const same = await transfer(space, body(a, a));
    expect(same.statusCode).toBe(400);
    expect(same.json().errors).toEqual([{ in: "body", path: "toAccountId", issue: "same_account" }]);
    expect(await written(space.householdId)).toEqual(NOTHING);
  });

  it("sec451 close race: a transfer whose check passed commits while the account is being closed — both legs or none, whatever the order", async () => {
    const { space, a, b } = await twoAccounts();
    await db.owner.query(
      `CREATE OR REPLACE FUNCTION transactions.sec451_slow() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN PERFORM pg_sleep(1.5); RETURN NEW; END $$`,
    );
    await db.owner.query(
      `CREATE TRIGGER sec451_slow BEFORE INSERT ON transactions.transfers FOR EACH ROW
         WHEN (NEW.household_id = '${space.householdId}') EXECUTE FUNCTION transactions.sec451_slow()`,
    );
    let res, closed;
    try {
      const pending = transfer(space, body(a, b));
      await sleep(500);
      closed = await call(space, "POST", `/v1/accounts/${b}/close`, { closedOn: TODAY });
      res = await pending;
    } finally {
      await db.owner.query(`DROP TRIGGER sec451_slow ON transactions.transfers`);
      await db.owner.query(`DROP FUNCTION transactions.sec451_slow()`);
    }
    await runWorker(space.householdId);
    const account = (await call(space, "GET", `/v1/accounts/${b}`)).json();
    // Observed on 13f23b5d: the transfer answers 201 and the closing 200 — the account ends closed with 120 EUR on it
    // (the same open question as createTransaction, module card, FIN-01 EC4). Once the owner decides, tighten this
    // to: the transfer is 409 ACCOUNT_CLOSED, or the closing is refused.
    expect([201, 409]).toContain(res.statusCode);
    expect([200, 409]).toContain(closed.statusCode);
    expect(["active", "closed"]).toContain(account.status);
    // Whatever the order: never one leg without the other.
    const w = await written(space.householdId);
    expect([0, 2]).toContain(w.transactions);
    expect(w.transfers).toBe(w.transactions / 2);
    const [ba, bb] = [await balance(space, a), await balance(space, b)];
    expect([
      ["1000", "0"],
      ["880", "120"],
    ]).toContainEqual([ba, bb]);
  });
});
