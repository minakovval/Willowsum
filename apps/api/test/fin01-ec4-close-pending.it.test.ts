import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import {
  createTransactionPendingPostings,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * FIN-01@PoC EC4 («Після дати закриття є транзакції»), FIN-12@PoC FR 7 (a closing only with a zero balance on the
 * closing date), ARC-04@PoC FR 2 (the hand-off through the module's queue), ARC-02 (module boundaries; code review
 * finding 3, 2026-11-16): a transaction the transactions module has saved but whose hand-off to the journal is still in
 * its queue is not in the journal yet. The closing reads the journal only, so it used to pass with a zero balance, and
 * the posting landed later on the closed account. Now the closing first has the transactions module finish the
 * account's hand-offs (its port, never its tables) and refuses when one cannot be finished. Real API, real PostgreSQL,
 * synthetic data, fixed clock; the worker runs only where a test says so.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const CLOSED_ON = "2026-10-16";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "POST" | "PATCH" | "GET" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** One pass of the worker as main.ts wires it, until the jobs it took have ended. */
async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

/** A current account with `balance` EUR from 2026-01-01, its own hand-off done. */
async function account(space: Space, balance = "0.00"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний поточний",
    balance: { amount: balance, currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

const purchase = (accountId: string, amount = "-45.50") => ({
  accountId,
  amount: { amount, currency: "EUR" },
  date: "2026-10-15",
  counterparty: "Синтетичний магазин",
  description: "Синтетичні продукти",
});

async function transaction(space: Space, accountId: string, amount?: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", purchase(accountId, amount));
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** The account's state and its balance on the closing date, as the journal has it. */
async function onClosingDate(space: Space, accountId: string) {
  const account = (await call(space, "GET", `/v1/accounts/${accountId}`)).json();
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT ledger_account_id AS id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
    [space.householdId, accountId],
  );
  const balance = await ledger.balanceAt(space.householdId, rows[0]!.id, CLOSED_ON);
  return { status: account.status as string, balance: Number(balance.toDecimalString()) };
}

const pendingJobs = async (householdId: string) =>
  (
    await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state <> 'done'`,
      [householdId],
    )
  ).rows[0]!.n;

const auditEntries = async (householdId: string) =>
  (
    await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.entries WHERE household_id = $1`,
      [householdId],
    )
  ).rows[0]!.n;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [
            createTransactionPendingPostings(db.databases.for("transactions"), { accounts, ledger, audit }),
          ],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          // FIN-03 FR 8: the rate a transfer keeps (transfers answer 500 without it).
          rates: (requests) => fx.rates(requests),
          audit,
          clock: { now: () => NOW },
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

afterEach(() => vi.restoreAllMocks());

describe("FIN-01@PoC EC4: an account cannot be closed past a transaction whose hand-off to the journal is pending", () => {
  it("FIN-01@PoC EC4: a transaction saved but not in the journal yet — the closing does not pass with a zero balance; the posting never lands on a closed account", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    // The route's own hand-off fails: the transaction is saved, its journal event waits in the transactions queue.
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();
    expect(await pendingJobs(space.householdId)).toBe(1);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "active", balance: 0 });

    const preview = await call(space, "GET", `/v1/accounts/${accountId}/closing?closedOn=${CLOSED_ON}`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      zero: false,
      currencies: [{ currency: "EUR", balance: { amount: "-45.5", currency: "EUR" } }],
    });
    const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, { closedOn: CLOSED_ON });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_BALANCE_NOT_ZERO");

    await runWorker(space.householdId);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "active", balance: -45.5 });
  });

  it("FIN-12@PoC FR 7, FIN-01@PoC EC4: «Списати коригуванням» writes off the balance the pending transaction leaves — zero on the closing date once the worker has run", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();

    const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "closed", balance: 0 });
  });

  it("FIN-01@PoC EC4: a deleted transaction whose reversal is pending — the closing writes off nothing that the reversal later brings back", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await transaction(space, accountId);
    await runWorker(space.householdId);
    vi.spyOn(ledger, "reverse").mockRejectedValueOnce(new Error("injected"));
    expect((await call(space, "DELETE", `/v1/transactions/${id}`)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(await onClosingDate(space, accountId)).toEqual({ status: "active", balance: -45.5 });

    const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "closed", balance: 0 });
  });

  it("FIN-01@PoC EC4: a transaction moved to another account, its move pending — the old account closes at zero, the new one holds it", async () => {
    const space = await newSpace();
    const from = await account(space);
    const to = await account(space);
    const id = await transaction(space, from);
    await runWorker(space.householdId);
    vi.spyOn(ledger, "correct").mockRejectedValueOnce(new Error("injected"));
    const moved = await call(space, "PATCH", `/v1/transactions/${id}`, { accountId: to });
    expect(moved.statusCode, moved.body).toBe(200);
    vi.restoreAllMocks();
    expect(await onClosingDate(space, from)).toEqual({ status: "active", balance: -45.5 });

    const res = await call(space, "POST", `/v1/accounts/${from}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await onClosingDate(space, from)).toEqual({ status: "closed", balance: 0 });
    expect(await onClosingDate(space, to)).toEqual({ status: "active", balance: -45.5 });
  });

  it("FIN-01@PoC EC4: a transfer marked, its outflow's hand-off pending — the inflow's account closes on the balance the transfer event leaves", async () => {
    const space = await newSpace();
    const from = await account(space);
    const to = await account(space);
    const outflow = await transaction(space, from, "-100.00");
    const inflow = await transaction(space, to, "100.00");
    await runWorker(space.householdId);
    // The transfer event cannot be posted now: the outflow's own event is reversed, the transfer waits in the queue.
    const post = ledger.post.bind(ledger);
    vi.spyOn(ledger, "post").mockImplementation((householdId, input) =>
      input.event.type === "transfer" ? Promise.reject(new Error("injected")) : post(householdId, input),
    );
    const marked = await call(space, "POST", `/v1/transactions/${outflow}/transfer`, {
      counterpartId: inflow,
    });
    expect(marked.statusCode, marked.body).toBe(200);
    vi.restoreAllMocks();

    const res = await call(space, "POST", `/v1/accounts/${to}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(200);
    // One pass may not take every job of the space; the next one does.
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await onClosingDate(space, to)).toEqual({ status: "closed", balance: 0 });
    expect(await onClosingDate(space, from)).toEqual({ status: "active", balance: -100 });
  });

  it("FIN-01@PoC EC4: a hand-off that cannot finish now refuses the closing and its dialog with ACCOUNT_POSTINGS_PENDING; nothing is written", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    await transaction(space, accountId);
    const auditBefore = await auditEntries(space.householdId);

    const preview = await call(space, "GET", `/v1/accounts/${accountId}/closing?closedOn=${CLOSED_ON}`);
    expect(preview.statusCode, preview.body).toBe(409);
    expect(preview.json().code).toBe("ACCOUNT_POSTINGS_PENDING");
    for (const body of [
      { closedOn: CLOSED_ON },
      { closedOn: CLOSED_ON, settlement: { kind: "adjustment" } },
    ]) {
      const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, body);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe("ACCOUNT_POSTINGS_PENDING");
    }
    vi.restoreAllMocks();
    expect(await auditEntries(space.householdId)).toBe(auditBefore);
    expect(
      (
        await db.owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM accounts.jobs WHERE household_id = $1 AND state <> 'done'`,
          [space.householdId],
        )
      ).rows[0]!.n,
    ).toBe(0);

    await runWorker(space.householdId);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "active", balance: -45.5 });
  });

  it("FIN-01@PoC EC4, П-5: the closing finishes only its own space's hand-offs — another space's pending transaction stays queued and out of its journal", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    const accountId = await account(mine);
    const theirs = await account(other);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(other, theirs);
    vi.restoreAllMocks();
    expect(await pendingJobs(other.householdId)).toBe(1);

    const res = await call(mine, "POST", `/v1/accounts/${accountId}/close`, { closedOn: CLOSED_ON });
    expect(res.statusCode, res.body).toBe(200);
    expect(await pendingJobs(other.householdId)).toBe(1);
    expect(await onClosingDate(other, theirs)).toEqual({ status: "active", balance: 0 });
  });

  it("FIN-01@PoC EC4, ARC-04@PoC FR 4: a hand-off the worker gave up on (`dead`) is finished by the closing too — never closed past it", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );

    const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(200);
    // The daily recovery puts the job back; run again, it changes nothing (idempotent).
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'queued', attempts = 0, run_after = now() WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "closed", balance: 0 });
  });

  it("FIN-01@PoC EC4: two closings at once, a transaction pending — one closes, the other is refused; zero on the closing date", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();

    const body = { closedOn: CLOSED_ON, settlement: { kind: "adjustment" } };
    const results = await Promise.all([
      call(space, "POST", `/v1/accounts/${accountId}/close`, body),
      call(space, "POST", `/v1/accounts/${accountId}/close`, body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe("ACCOUNT_CLOSED");
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "closed", balance: 0 });
  });
});
