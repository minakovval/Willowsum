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
 * FIN-03@PoC FR 1, FR 28 (issue #437), through the real API on a real PostgreSQL: «Переказ між рахунками» of «Нова
 * транзакція» — a transfer between two own accounts in one request (`POST /v1/transactions/transfers`): both legs and
 * one journal event or nothing, in one currency and in two (the official rate of the date, FR 8), idempotent
 * (ARC-07 FR 4), audited (FR 20), the space's own (AC11) and never on a closed account. Every name and amount is
 * synthetic; the session is the test's principal header; the clock is fixed.
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

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

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

describe("FIN-03@PoC FR 1, FR 28: «Переказ між рахунками» — a transfer between two accounts in one action", () => {
  it("FIN-03@PoC FR 28: 120 EUR from A to B — the debit and the credit as one transfer, one journal event, neither income nor expense", async () => {
    const { space, a, b } = await twoAccounts();
    const res = await transfer(space, body(a, b));
    expect(res.statusCode, res.body).toBe(201);
    const { outflow, inflow } = res.json() as Created;
    expect(outflow).toMatchObject({
      accountId: a,
      amount: { amount: "-120", currency: "EUR" },
      type: "expense",
      status: "posted",
      counterparty: "Синтетичний переказ",
      transfer: { side: "outflow", counterpartId: inflow.id, date: "2026-10-14", fee: null, rate: null },
    });
    expect(inflow).toMatchObject({
      accountId: b,
      amount: { amount: "120", currency: "EUR" },
      type: "income",
      transfer: { side: "inflow", counterpartId: outflow.id, date: "2026-10-14", fee: null, rate: null },
    });
    expect(inflow.transfer!.id).toBe(outflow.transfer!.id);
    // FR 7: one transfer event A → B; nothing leaves the space (net worth unchanged).
    expect(await liveEntries(space.householdId)).toEqual([["transfer", "2026-10-14"]]);
    expect(await externalFlow(space.householdId)).toEqual({});
    // FR 2: the balances are recounted at once.
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "120"]);
    // FR 22: both are listed under «Стан: переказ».
    const listed = (await call(space, "GET", "/v1/transactions?filter=transfer.eq:true")).json();
    expect(listed.items.map((t: Transaction) => t.id).sort()).toEqual([outflow.id, inflow.id].sort());
    expect((await get(space, inflow.id)).transfer).toMatchObject({
      side: "inflow",
      counterpartId: outflow.id,
    });
  });

  it("FIN-03@PoC FR 8: in one currency a smaller credit leaves the difference as the fee — the debit's own expense", async () => {
    const { space, a, b } = await twoAccounts();
    const res = await transfer(space, body(a, b, { received: { amount: "118.00", currency: "EUR" } }));
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Created).outflow.transfer).toMatchObject({
      fee: { amount: "-2", currency: "EUR" },
    });
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-14"],
      ["transfer", "2026-10-14"],
    ]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "118"]);
    // The credit may not exceed the debit in one currency: the difference is a fee, never a gain.
    const more = await transfer(space, body(a, b, { received: { amount: "120.01", currency: "EUR" } }));
    expect(more.statusCode).toBe(400);
    expect(more.json().errors).toEqual([{ in: "body", path: "received", issue: "amount_mismatch" }]);
  });

  it("FIN-03@PoC FR 8: across currencies the credit is the amount at the official rate of the date; one fx-transfer event", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "2000.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const res = await transfer(space, body(eur, uah, { amount: { amount: "1000.00", currency: "EUR" } }));
    expect(res.statusCode, res.body).toBe(201);
    const { outflow, inflow } = res.json() as Created;
    expect(inflow.amount).toEqual({ amount: "43500", currency: "UAH" });
    expect(outflow.transfer).toMatchObject({
      fee: null,
      rate: { rate: "0.022988505747126437", date: "2026-10-14", source: "NBU" },
    });
    expect(await liveEntries(space.householdId)).toEqual([["fx-transfer", "2026-10-14"]]);
    expect(await externalFlow(space.householdId)).toEqual({});
    expect([await balance(space, eur), await balance(space, uah)]).toEqual(["1000", "43500"]);
  });

  it("FIN-03@PoC FR 8: across currencies an entered credit keeps both actual amounts; the difference goes through «Валютна різниця»", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "2000.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const res = await transfer(
      space,
      body(eur, uah, {
        amount: { amount: "1000.00", currency: "EUR" },
        received: { amount: "42900.00", currency: "UAH" },
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Created).inflow.amount).toEqual({ amount: "42900", currency: "UAH" });
    expect([await balance(space, eur), await balance(space, uah)]).toEqual(["1000", "42900"]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM ledger.postings p
         JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'fx-difference'
                               AND a.id IN (p.debit_account_id, p.credit_account_id)
        WHERE p.household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(2);
    // The credit in a currency the account does not hold is refused.
    const wrong = await transfer(space, body(eur, uah, { received: { amount: "100.00", currency: "EUR" } }));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().errors).toEqual([
      { in: "body", path: "received.currency", issue: "currency_mismatch" },
    ]);
  });

  it("FIN-03@PoC FR 8: across currencies without an official rate of the date nothing is written", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "100.00");
    const pln = await createAccount(space, "0.00", "PLN");
    const res = await transfer(space, body(eur, pln, { amount: { amount: "10.00", currency: "EUR" } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "date", issue: "rate_unavailable" }]);
    expect(await written(space.householdId)).toEqual(NOTHING);
  });

  it("FIN-03@PoC FR 28: the form's fields are checked — another currency, one account, a negative or zero amount, a future date; nothing is written", async () => {
    const { space, a, b } = await twoAccounts();
    const cases: [Record<string, unknown>, string, string][] = [
      [{ amount: { amount: "10.00", currency: "UAH" } }, "amount.currency", "currency_mismatch"],
      [{ toAccountId: a }, "toAccountId", "same_account"],
      [{ amount: { amount: "-10.00", currency: "EUR" } }, "amount", "sign"],
      [{ amount: { amount: "0", currency: "EUR" } }, "amount", "zero"],
      [{ amount: { amount: "1.001", currency: "EUR" } }, "amount", "invalid"],
      [{ date: "2026-10-18" }, "date", "date_in_future"],
    ];
    for (const [extra, path, issue] of cases) {
      const res = await transfer(space, body(a, b, extra));
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(res.json().errors).toContainEqual({ in: "body", path, issue });
    }
    // «Очікує» is not offered for a transfer: the field is unknown.
    expect((await transfer(space, body(a, b, { status: "pending" }))).statusCode).toBe(400);
    expect((await written(space.householdId)).transactions).toBe(0);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["1000", "0"]);
  });

  it("FIN-03@PoC FR 20: the transfer's two transactions each have their create entry in the audit log with the side and the other transaction", async () => {
    const { space, a, b } = await twoAccounts();
    const { outflow, inflow } = (await transfer(space, body(a, b))).json() as Created;
    for (const [id, side, other] of [
      [outflow.id, "outflow", inflow.id],
      [inflow.id, "inflow", outflow.id],
    ] as const) {
      const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
      expect(log.map((e) => e.action)).toEqual(["create"]);
      const fields = Object.fromEntries(log[0]!.changes.map((ch) => [ch.field, [ch.before, ch.after]]));
      expect(fields).toMatchObject({
        "transfer.side": [null, side],
        "transfer.with": [null, other],
        // Free text is masked (П-10).
        counterparty: [null, expect.not.stringContaining("Синтетичний")],
      });
    }
  });
});

describe("FIN-03@PoC FR 1, FR 28: both legs or none", () => {
  it("FIN-03@PoC FR 28: a failure while the credit is written leaves neither leg, no pair and no journal event", async () => {
    const { space, a, b } = await twoAccounts();
    await db.owner.query(
      `CREATE OR REPLACE FUNCTION transactions.fin03_fail_credit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'injected'; END $$`,
    );
    await db.owner.query(
      `CREATE TRIGGER fin03_fail_credit BEFORE INSERT ON transactions.transactions FOR EACH ROW
         WHEN (NEW.amount > 0 AND NEW.transfer_id IS NOT NULL) EXECUTE FUNCTION transactions.fin03_fail_credit()`,
    );
    try {
      const res = await transfer(space, body(a, b));
      expect(res.statusCode).toBe(500);
    } finally {
      await db.owner.query(`DROP TRIGGER fin03_fail_credit ON transactions.transactions`);
      await db.owner.query(`DROP FUNCTION transactions.fin03_fail_credit()`);
    }
    expect(await written(space.householdId)).toEqual(NOTHING);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["1000", "0"]);
    // Nothing half-made blocks a retry.
    expect((await transfer(space, body(a, b))).statusCode).toBe(201);
  });

  it("ARC-04@PoC FR 2: the journal fails after the commit — the request answers, neither leg is in the journal until the worker posts the one event of both", async () => {
    const { space, a, b } = await twoAccounts();
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    const res = await transfer(space, body(a, b));
    expect(res.statusCode, res.body).toBe(201);
    vi.restoreAllMocks();
    expect(await liveEntries(space.householdId)).toEqual([]);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["1000", "0"]);
    await runWorker(space.householdId);
    expect(await liveEntries(space.householdId)).toEqual([["transfer", "2026-10-14"]]);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "120"]);
  });
});

describe("ARC-07@PoC FR 4: «Переказ між рахунками» is idempotent", () => {
  it("ARC-07@PoC FR 4: the same Idempotency-Key and body again returns the first transfer; no second one is made", async () => {
    const { space, a, b } = await twoAccounts();
    const key = randomUUID();
    const first = await transfer(space, body(a, b), key);
    const again = await transfer(space, body(a, b), key);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json().outflow.id).toBe(first.json().outflow.id);
    // The same key with another body is refused.
    const other = await transfer(space, body(a, b, { amount: { amount: "1.00", currency: "EUR" } }), key);
    expect(other.statusCode).toBe(409);
    expect(await written(space.householdId)).toEqual({ transactions: 2, transfers: 1, entries: 1 });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "120"]);
  });

  it("FIN-03@PoC FR 28: a concurrent double submit with one Idempotency-Key makes one transfer", async () => {
    const { space, a, b } = await twoAccounts();
    const key = randomUUID();
    const results = await Promise.all([transfer(space, body(a, b), key), transfer(space, body(a, b), key)]);
    const codes = results.map((r) => r.statusCode).sort();
    // One makes it; the other replays it or is told the first is still running — never a second transfer.
    expect(codes[0]).toBe(201);
    expect([201, 409]).toContain(codes[1]);
    const ids = results.filter((r) => r.statusCode === 201).map((r) => r.json().outflow.id);
    expect(new Set(ids).size).toBe(1);
    expect(await written(space.householdId)).toEqual({ transactions: 2, transfers: 1, entries: 1 });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["880", "120"]);
  });

  it("FIN-03@PoC FR 28: two different transfers from one account at once both count — no lost update", async () => {
    const { space, a, b } = await twoAccounts();
    const results = await Promise.all([transfer(space, body(a, b)), transfer(space, body(a, b))]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(await written(space.householdId)).toEqual({ transactions: 4, transfers: 2, entries: 2 });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["760", "240"]);
  });
});

describe("FIN-03@PoC «Права доступу»: a transfer is the space's own", () => {
  it("FIN-03@PoC AC11: an account of another space, as either side, is «not found» (404); nothing is written in either space", async () => {
    const mine = await twoAccounts();
    const theirs = await twoAccounts();
    for (const [from, to] of [
      [mine.a, theirs.b],
      [theirs.a, mine.b],
      [theirs.a, theirs.b],
      [mine.a, randomUUID()],
    ] as const) {
      const res = await transfer(mine.space, body(from, to));
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(theirs.space.householdId);
    }
    expect(await written(mine.space.householdId)).toEqual(NOTHING);
    expect(await written(theirs.space.householdId)).toEqual(NOTHING);
    expect([await balance(theirs.space, theirs.a), await balance(theirs.space, theirs.b)]).toEqual([
      "1000",
      "0",
    ]);
  });

  it("FIN-03@PoC «Права доступу»: from or to a closed account the transfer is refused (409); nothing is written", async () => {
    const { space, a, b } = await twoAccounts();
    const c = await createAccount(space, "0.00");
    const closed = await call(space, "POST", `/v1/accounts/${c}/close`, { closedOn: TODAY });
    expect(closed.statusCode, closed.body).toBe(200);
    for (const [from, to] of [
      [c, b],
      [a, c],
    ] as const) {
      const res = await transfer(space, body(from, to, { amount: { amount: "1.00", currency: "EUR" } }));
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("ACCOUNT_CLOSED");
    }
    expect(await written(space.householdId)).toEqual(NOTHING);
  });

  it("FIN-03@PoC «Права доступу»: a scoped member may not write (403); with the flag `transactions.transfers` off the route is not there (404)", async () => {
    const { space, a, b } = await twoAccounts();
    // «Транзакції» are closed to a scoped member, who never has `household.data.write` (routes.ts).
    expect((await transfer(space, body(a, b), randomUUID(), { scoped: true })).statusCode).toBe(403);
    off.add("transactions.transfers");
    expect((await transfer(space, body(a, b))).statusCode).toBe(404);
    expect(await written(space.householdId)).toEqual(NOTHING);
  });
});
