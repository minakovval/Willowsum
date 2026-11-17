import { randomUUID } from "node:crypto";
import pg from "pg";
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
import {
  createAccountDirectory,
  createAccountsServices,
  lockAccounts,
} from "../src/modules/accounts/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import {
  createTransactionPendingPostings,
  createTransactionsServices,
  createTransactionWalletUsage,
} from "../src/modules/transactions/index.ts";

/**
 * FIN-01@PoC EC4 («Після дати закриття є транзакції»), FIN-12@PoC FR 7 (a closing only with a zero balance on the
 * closing date), FR 8 (a closed account is read only), FR 14 («Оновити залишок»: the balance entered), IMP-02@PoC
 * FR 15 (a wallet with transactions stays) — wave 2 row 198, #455, #409 items 1 and 4, #240, #290 item 4: one lock
 * of the account's money (`lockAccounts`) shared by the accounts module's changes of an account and every write of
 * module transactions on it. Each race below is the one an issue saw: one request is slowed inside its database
 * transaction (a trigger that sleeps, for this test's space only) while the other runs; before the lock both passed.
 * Real API, real PostgreSQL, synthetic data, fixed clock.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const TODAY = "2026-10-17";
const CLOSED_ON = "2026-10-16";
/** How long a slowed request sleeps inside its transaction, and when the other one starts. */
const SLOW_SECONDS = 1.5;
const HEAD_START_MS = 400;

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "POST" | "PATCH" | "GET" | "DELETE",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
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

const purchase = (accountId: string, amount = "-45.50", date = "2026-10-15", currency = "EUR") => ({
  accountId,
  amount: { amount, currency },
  date,
  counterparty: "Синтетичний магазин",
  description: "Синтетичні продукти",
});

async function transaction(space: Space, accountId: string, amount?: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", purchase(accountId, amount));
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const transferBody = (from: string, to: string) => ({
  fromAccountId: from,
  toAccountId: to,
  amount: { amount: "120.00", currency: "EUR" },
  date: "2026-10-14",
  counterparty: "Синтетичний переказ",
});
const transfer = (space: Space, from: string, to: string) =>
  call(space, "POST", "/v1/transactions/transfers", transferBody(from, to), {
    "idempotency-key": randomUUID(),
  });

/** The account's state and its EUR balance on `date`, as the journal has it. */
async function stateOn(space: Space, accountId: string, date = CLOSED_ON) {
  const account = (await call(space, "GET", `/v1/accounts/${accountId}`)).json();
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT ledger_account_id AS id FROM accounts.subaccounts
      WHERE household_id = $1 AND account_id = $2 AND currency = 'EUR'`,
    [space.householdId, accountId],
  );
  const balance = await ledger.balanceAt(space.householdId, rows[0]!.id, date);
  return { status: account.status as string, balance: balance.toDecimalString() };
}

/**
 * `table`'s rows of the space wait `SLOW_SECONDS` before they are written (`when`: a further condition on NEW), so the
 * request writing them holds its transaction open meanwhile. Returns the clean-up.
 */
async function slowed(space: Space, table: string, event: "INSERT" | "UPDATE", when = "true") {
  const name = `row198_slow_${randomUUID().replaceAll("-", "")}`;
  const [schema] = table.split(".");
  await db.owner.query(
    `CREATE FUNCTION ${schema}.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN PERFORM pg_sleep(${SLOW_SECONDS}); RETURN NEW; END $$`,
  );
  await db.owner.query(
    `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW
       WHEN (NEW.household_id = '${space.householdId}' AND ${when}) EXECUTE FUNCTION ${schema}.${name}()`,
  );
  return async () => {
    await db.owner.query(`DROP TRIGGER ${name} ON ${table}`);
    await db.owner.query(`DROP FUNCTION ${schema}.${name}()`);
  };
}

/** `first` starts and is slowed inside its transaction; `second` starts while it is; both answers. */
async function race<A, B>(
  slow: () => Promise<() => Promise<void>>,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const cleanUp = await slow();
  try {
    const one = first();
    await sleep(HEAD_START_MS);
    const two = await second();
    return [await one, two];
  } finally {
    await cleanUp();
  }
}

/**
 * `run` while another session holds the lock of `accountIds` (as a write of another module would): whether it was
 * still waiting when the lock was let go, and its answer.
 */
async function whileLocked<T>(space: Space, accountIds: readonly string[], run: () => Promise<T>) {
  const holder = new pg.Client({ connectionString: db.url });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await lockAccounts(holder, space.householdId, accountIds);
    let done = false;
    const pending = run().finally(() => {
      done = true;
    });
    await sleep(HEAD_START_MS);
    const waited = !done;
    await holder.query("COMMIT");
    return { waited, res: await pending };
  } finally {
    await holder.end();
  }
}

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
          walletUsage: [createTransactionWalletUsage(db.databases.for("transactions"))],
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
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
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

describe("FIN-01@PoC EC4, FIN-12@PoC FR 7: a write on the account and its closing run one after the other", () => {
  it("FIN-01@PoC EC4 (#240, #455): a transaction after the closing date, created while the account closes — the closing waits for it and is refused «Після дати закриття є транзакції»", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const [created, closed] = await race(
      () => slowed(space, "transactions.transactions", "INSERT"),
      () => call(space, "POST", "/v1/transactions", purchase(accountId, "-45.50", TODAY)),
      () =>
        call(space, "POST", `/v1/accounts/${accountId}/close`, {
          closedOn: CLOSED_ON,
          settlement: { kind: "adjustment" },
        }),
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(closed.statusCode, closed.body).toBe(409);
    expect(closed.json().code).toBe("ACCOUNT_ACTIVITY_AFTER_CLOSE");
    await runWorker(space.householdId);
    expect(await stateOn(space, accountId, TODAY)).toEqual({ status: "active", balance: "-45.5" });
  });

  it("FIN-12@PoC FR 7 (#455): a transfer of 120 EUR into the account, created while it closes — the closing is refused, never a closed account with 120 EUR", async () => {
    const space = await newSpace();
    const from = await account(space, "1000.00");
    const to = await account(space);
    const [moved, closed] = await race(
      () => slowed(space, "transactions.transfers", "INSERT"),
      () => transfer(space, from, to),
      () => call(space, "POST", `/v1/accounts/${to}/close`, { closedOn: CLOSED_ON }),
    );
    expect(moved.statusCode, moved.body).toBe(201);
    expect(closed.statusCode, closed.body).toBe(409);
    expect(closed.json().code).toBe("ACCOUNT_BALANCE_NOT_ZERO");
    await runWorker(space.householdId);
    expect(await stateOn(space, to)).toEqual({ status: "active", balance: "120" });
    expect(await stateOn(space, from)).toEqual({ status: "active", balance: "880" });
  });

  it("FIN-12@PoC FR 7 (#240): a transaction created while the account closes with «Списати коригуванням» — the write-off counts it: zero on the closing date", async () => {
    const space = await newSpace();
    const accountId = await account(space, "100.00");
    const [created, closed] = await race(
      () => slowed(space, "transactions.transactions", "INSERT"),
      () => call(space, "POST", "/v1/transactions", purchase(accountId)),
      () =>
        call(space, "POST", `/v1/accounts/${accountId}/close`, {
          closedOn: CLOSED_ON,
          settlement: { kind: "adjustment" },
        }),
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(closed.statusCode, closed.body).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await stateOn(space, accountId)).toEqual({ status: "closed", balance: "0" });
  });

  it("FIN-12@PoC FR 8 (#409 item 1): a transaction created while a closing commits — it waits and is refused ACCOUNT_CLOSED; nothing is written on the closed account", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const [closed, created] = await race(
      () => slowed(space, "accounts.accounts", "UPDATE", "NEW.status = 'closed'"),
      () => call(space, "POST", `/v1/accounts/${accountId}/close`, { closedOn: CLOSED_ON }),
      () => call(space, "POST", "/v1/transactions", purchase(accountId)),
    );
    expect(closed.statusCode, closed.body).toBe(200);
    expect(created.statusCode, created.body).toBe(409);
    expect(created.json().code).toBe("ACCOUNT_CLOSED");
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
    await runWorker(space.householdId);
    expect(await stateOn(space, accountId)).toEqual({ status: "closed", balance: "0" });
  });

  it("FIN-12@PoC FR 8 (#455, markTransfer): a transfer marked while the inflow's account closes — the mark waits and is refused ACCOUNT_CLOSED", async () => {
    const space = await newSpace();
    const from = await account(space, "1000.00");
    const to = await account(space);
    const outflow = await transaction(space, from, "-120.00");
    const inflow = await transaction(space, to, "120.00");
    await runWorker(space.householdId);
    const [closed, marked] = await race(
      () => slowed(space, "accounts.accounts", "UPDATE", "NEW.status = 'closed'"),
      () =>
        call(space, "POST", `/v1/accounts/${to}/close`, {
          closedOn: CLOSED_ON,
          settlement: { kind: "adjustment" },
        }),
      () => call(space, "POST", `/v1/transactions/${outflow}/transfer`, { counterpartId: inflow }),
    );
    expect(closed.statusCode, closed.body).toBe(200);
    expect(marked.statusCode, marked.body).toBe(409);
    expect(marked.json().code).toBe("ACCOUNT_CLOSED");
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transfers WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe("IMP-02@PoC FR 15: a wallet with a transaction stays, also when both requests run at once", () => {
  it("IMP-02@PoC FR 15 (#290 item 4): a transaction created on the UAH wallet while the wallet is removed — the removal waits for it and is refused", async () => {
    const space = await newSpace();
    const accountId = await account(space, "100.00");
    const added = await call(space, "POST", `/v1/accounts/${accountId}/wallets`, {
      balance: { amount: "0.00", currency: "UAH" },
      balanceDate: "2026-10-01",
    });
    expect(added.statusCode, added.body).toBe(200);
    await runWorker(space.householdId);
    const [created, removed] = await race(
      () => slowed(space, "transactions.transactions", "INSERT"),
      () => call(space, "POST", "/v1/transactions", purchase(accountId, "-100.00", "2026-10-15", "UAH")),
      () => call(space, "DELETE", `/v1/accounts/${accountId}/wallets/UAH`),
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(removed.statusCode, removed.body).toBe(409);
    expect(removed.json().code).toBe("ACCOUNT_CURRENCY_HAS_TRANSACTIONS");
    const view = (await call(space, "GET", `/v1/accounts/${accountId}`)).json();
    expect(view.currencies.map((c: { currency: string }) => c.currency)).toEqual(["EUR", "UAH"]);
  });
});

describe("FIN-12@PoC FR 14: «Оновити залишок» reads the balance under the account's lock, with every saved transaction in it", () => {
  it("FIN-12@PoC FR 14 (#409 item 4): a transaction whose hand-off to the journal is still queued — the balance entered is the balance once the worker has run", async () => {
    const space = await newSpace();
    const accountId = await account(space, "1000.00");
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await transaction(space, accountId);
    vi.restoreAllMocks();
    const res = await call(space, "POST", `/v1/accounts/${accountId}/balance`, {
      balance: { amount: "500.00", currency: "EUR" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, balance: { amount: "500", currency: "EUR" } });
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await stateOn(space, accountId, TODAY)).toEqual({ status: "active", balance: "500" });
  });

  it("FIN-12@PoC FR 14 (#298, #409 item 4): a transaction created while the balance is updated — the update waits for it; the balance is the one entered", async () => {
    const space = await newSpace();
    const accountId = await account(space, "1000.00");
    const [created, updated] = await race(
      () => slowed(space, "transactions.transactions", "INSERT"),
      () => call(space, "POST", "/v1/transactions", purchase(accountId)),
      () =>
        call(space, "POST", `/v1/accounts/${accountId}/balance`, {
          balance: { amount: "500.00", currency: "EUR" },
        }),
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(updated.statusCode, updated.body).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await stateOn(space, accountId, TODAY)).toEqual({ status: "active", balance: "500" });
  });
});

describe("FIN-12@PoC FR 8: every change of an account's money takes the account's one lock", () => {
  /** A space with two accounts, A (1 000 EUR) and B (0 EUR), and what each case needs on them. */
  async function twoAccounts() {
    const space = await newSpace();
    const a = await account(space, "1000.00");
    const b = await account(space);
    return { space, a, b };
  }

  const cases: {
    readonly name: string;
    readonly status: number;
    /** The request, and the accounts whose lock it must wait for. */
    readonly arrange: () => Promise<{
      readonly locked: string[];
      readonly space: Space;
      readonly run: () => ReturnType<typeof call>;
    }>;
  }[] = [
    {
      name: "«Додати транзакцію»",
      status: 201,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        return { space, locked: [a], run: () => call(space, "POST", "/v1/transactions", purchase(a)) };
      },
    },
    {
      name: "an edit that moves a transaction to another account (both accounts)",
      status: 200,
      arrange: async () => {
        const { space, a, b } = await twoAccounts();
        const id = await transaction(space, a);
        return {
          space,
          locked: [b],
          run: () => call(space, "PATCH", `/v1/transactions/${id}`, { accountId: b }),
        };
      },
    },
    {
      name: "an edit of the amount",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const id = await transaction(space, a);
        return {
          space,
          locked: [a],
          run: () =>
            call(space, "PATCH", `/v1/transactions/${id}`, { amount: { amount: "-50.00", currency: "EUR" } }),
        };
      },
    },
    {
      name: "«Видалити»",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const id = await transaction(space, a);
        return { space, locked: [a], run: () => call(space, "DELETE", `/v1/transactions/${id}`) };
      },
    },
    {
      name: "a transfer between own accounts (its inflow's account)",
      status: 201,
      arrange: async () => {
        const { space, a, b } = await twoAccounts();
        return { space, locked: [b], run: () => transfer(space, a, b) };
      },
    },
    {
      name: "marking two transactions as a transfer",
      status: 200,
      arrange: async () => {
        const { space, a, b } = await twoAccounts();
        const outflow = await transaction(space, a, "-120.00");
        const inflow = await transaction(space, b, "120.00");
        return {
          space,
          locked: [b],
          run: () => call(space, "POST", `/v1/transactions/${outflow}/transfer`, { counterpartId: inflow }),
        };
      },
    },
    {
      name: "removing a transfer's mark",
      status: 200,
      arrange: async () => {
        const { space, a, b } = await twoAccounts();
        const outflow = await transaction(space, a, "-120.00");
        const inflow = await transaction(space, b, "120.00");
        const marked = await call(space, "POST", `/v1/transactions/${outflow}/transfer`, {
          counterpartId: inflow,
        });
        expect(marked.statusCode, marked.body).toBe(200);
        return {
          space,
          locked: [b],
          run: () => call(space, "DELETE", `/v1/transactions/${outflow}/transfer`),
        };
      },
    },
    {
      name: "«Об'єднати» two duplicates",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const kept = await transaction(space, a);
        const duplicate = await transaction(space, a);
        return {
          space,
          locked: [a],
          run: () => call(space, "POST", `/v1/transactions/${kept}/merge`, { duplicateId: duplicate }),
        };
      },
    },
    {
      name: "«Роз'єднати»",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const kept = await transaction(space, a);
        const duplicate = await transaction(space, a);
        const merged = await call(space, "POST", `/v1/transactions/${kept}/merge`, {
          duplicateId: duplicate,
        });
        expect(merged.statusCode, merged.body).toBe(200);
        return { space, locked: [a], run: () => call(space, "DELETE", `/v1/transactions/${kept}/merge`) };
      },
    },
    {
      name: "«Не дубль»",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const one = await transaction(space, a);
        const two = await transaction(space, a);
        return {
          space,
          locked: [a],
          run: () => call(space, "POST", `/v1/transactions/${one}/not-duplicate`, { counterpartId: two }),
        };
      },
    },
    {
      name: "«Закрити рахунок» (and the account it transfers the balance to)",
      status: 200,
      arrange: async () => {
        const { space, a, b } = await twoAccounts();
        return {
          space,
          locked: [b],
          run: () =>
            call(space, "POST", `/v1/accounts/${a}/close`, {
              closedOn: CLOSED_ON,
              settlement: { kind: "transfer", toAccountId: b },
            }),
        };
      },
    },
    {
      name: "«Відкрити знову»",
      status: 200,
      arrange: async () => {
        const { space, b } = await twoAccounts();
        const closed = await call(space, "POST", `/v1/accounts/${b}/close`, { closedOn: CLOSED_ON });
        expect(closed.statusCode, closed.body).toBe(200);
        return { space, locked: [b], run: () => call(space, "POST", `/v1/accounts/${b}/reopen`) };
      },
    },
    {
      name: "«Оновити залишок»",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        return {
          space,
          locked: [a],
          run: () =>
            call(space, "POST", `/v1/accounts/${a}/balance`, {
              balance: { amount: "900.00", currency: "EUR" },
            }),
        };
      },
    },
    {
      name: "removing a wallet",
      status: 200,
      arrange: async () => {
        const { space, a } = await twoAccounts();
        const added = await call(space, "POST", `/v1/accounts/${a}/wallets`, {
          balance: { amount: "0.00", currency: "UAH" },
          balanceDate: "2026-10-01",
        });
        expect(added.statusCode, added.body).toBe(200);
        await runWorker(space.householdId);
        return { space, locked: [a], run: () => call(space, "DELETE", `/v1/accounts/${a}/wallets/UAH`) };
      },
    },
  ];

  it.each(cases)("FIN-12@PoC FR 8: $name waits while another module holds the account's lock", async (c) => {
    const { space, locked, run } = await c.arrange();
    await runWorker(space.householdId);
    const { waited, res } = await whileLocked(space, locked, run);
    expect(res.statusCode, res.body).toBe(c.status);
    expect(waited).toBe(true);
  });

  it("FIN-12@PoC FR 8, П-5: another space's lock of an account with the same id never holds this space's write", async () => {
    const { space, a } = await twoAccounts();
    const other = await newSpace();
    const { waited, res } = await whileLocked(other, [a], () =>
      call(space, "POST", "/v1/transactions", purchase(a)),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(waited).toBe(false);
  });
});
