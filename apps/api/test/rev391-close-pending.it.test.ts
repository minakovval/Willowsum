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

beforeAll(async () => {
  db = await setupRealModules(3);
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

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

describe("rev391: reviewer probes", () => {
  it("rev391 EC4 literal: a pending transaction dated after the closing date refuses with ACCOUNT_ACTIVITY_AFTER_CLOSE", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const res0 = await call(space, "POST", "/v1/transactions", {
      ...purchase(accountId),
      date: "2026-10-17",
    });
    expect(res0.statusCode, res0.body).toBe(201);
    vi.restoreAllMocks();
    const preview = await call(space, "GET", `/v1/accounts/${accountId}/closing?closedOn=${CLOSED_ON}`);
    expect(preview.statusCode, preview.body).toBe(409);
    expect(preview.json().code).toBe("ACCOUNT_ACTIVITY_AFTER_CLOSE");
    const res = await call(space, "POST", `/v1/accounts/${accountId}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_ACTIVITY_AFTER_CLOSE");
  });

  it("rev391 (b): the worker and the closing run the same pending hand-off at once — one journal event, zero on the closing date", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();
    const [res] = await Promise.all([
      call(space, "POST", `/v1/accounts/${accountId}/close`, {
        closedOn: CLOSED_ON,
        settlement: { kind: "adjustment" },
      }),
      runWorker(space.householdId),
    ]);
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await onClosingDate(space, accountId)).toEqual({ status: "closed", balance: 0 });
  });

  it("rev391 pool: three closing dialogs at once (API pool of 3, a pending hand-off) all answer — the accounts pool is not wedged", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();
    const all = Promise.all(
      [1, 2, 3].map(() => call(space, "GET", `/v1/accounts/${accountId}/closing?closedOn=${CLOSED_ON}`)),
    );
    const result = await within(all, 10_000);
    expect(result).not.toBe("timeout");
  }, 30_000);
});
