import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, AuditKeyConflict, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createTransactionsErasure, createTransactionsServices } from "../src/modules/transactions/index.ts";

/**
 * ARC-04@PoC FR 2, FR 3 for transactions (issue #240 item 4, #252 items 1 and 2; ADR-0015): «Нова транзакція», its
 * edit and «Видалити» write the transactions row and the hand-off job in one transactions transaction; the journal
 * event and the audit entry follow only after it commits, each idempotent, right away and — if that fails — from the
 * worker. A failure injected at each step leaves no journal event or audit entry without its transaction, and a create
 * retried with its Idempotency-Key publishes its journal event once. The audit log refuses a key reused for another
 * entity or action. Real API, real PostgreSQL, synthetic data, fixed clock.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

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

function call(
  space: Space,
  method: "POST" | "PATCH" | "GET" | "DELETE",
  url: string,
  body?: unknown,
  key?: string,
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key !== undefined ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function n(sql: string, householdId: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, [
    householdId,
  ]);
  return rows[0]!.n;
}

/** A current account of 1 000 EUR with its hand-off done (the worker ran). */
async function account(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний поточний",
    balance: { amount: "1000.00", currency: "EUR" },
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

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

/** What a transaction writes in every module of the space. */
async function written(householdId: string) {
  return {
    transactions: await n("transactions.transactions WHERE household_id = $1", householdId),
    entries: await n(
      "ledger.entries WHERE household_id = $1 AND source_module = 'transactions'",
      householdId,
    ),
    events: await n(
      "ledger.outbox_events WHERE household_id = $1 AND payload->>'eventType' IN ('transaction', 'reversal')",
      householdId,
    ),
    audit: await n(
      "audit.entries WHERE household_id = $1 AND entity_type = 'transactions.transaction'",
      householdId,
    ),
  };
}

/** Journal events and audit entries of a transaction the space has no row of (what a failure must never leave). */
async function orphans(householdId: string) {
  return {
    entries: await n(
      `ledger.entries e WHERE e.household_id = $1 AND e.source_module = 'transactions'
         AND NOT EXISTS (SELECT 1 FROM transactions.transactions t WHERE t.household_id = e.household_id
                           AND t.id = e.source_id)`,
      householdId,
    ),
    audit: await n(
      `audit.entries e WHERE e.household_id = $1 AND e.entity_type = 'transactions.transaction'
         AND NOT EXISTS (SELECT 1 FROM transactions.transactions t WHERE t.household_id = e.household_id
                           AND t.id = e.entity_id)`,
      householdId,
    ),
  };
}
const NO_ORPHANS = { entries: 0, audit: 0 };

const pendingJobs = (householdId: string) =>
  n("transactions.jobs WHERE household_id = $1 AND state <> 'done'", householdId);

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

/** Fails the first statement of the transactions module that matches `sql` (a step of its transaction). */
function failTransactionsStatement(sql: RegExp): void {
  const txDb = db.databases.for("transactions");
  const original = txDb.inHousehold.bind(txDb);
  let failed = false;
  vi.spyOn(txDb, "inHousehold").mockImplementation(((
    householdId: string,
    work: (q: HouseholdQueryRunner) => Promise<unknown>,
  ) =>
    original(householdId, (q) =>
      work({
        ...q,
        query: ((text: string, values?: readonly unknown[]) => {
          if (!failed && sql.test(text)) {
            failed = true;
            return Promise.reject(new Error("injected failure"));
          }
          return q.query(text, values);
        }) as HouseholdQueryRunner["query"],
      }),
    )) as typeof txDb.inHousehold);
}

/** The audit log's `record` of a transaction failing once. */
function failTransactionAudit(): void {
  const original = audit.record.bind(audit);
  let failed = false;
  vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
    const type = (entry as { entity?: { type?: string } }).entity?.type;
    if (!failed && type === "transactions.transaction") {
      failed = true;
      throw new Error("injected");
    }
    return original(householdId, entry);
  });
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
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
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
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

describe("ARC-04@PoC FR 2: «Нова транзакція» hands its journal event and audit entry over atomically", () => {
  it.each([
    ["the transaction", /^\s*INSERT INTO transactions\b/],
    ["the hand-off job", /^\s*INSERT INTO jobs\b/],
  ])(
    "ARC-04@PoC FR 2: a failure at %s rolls the create back and leaves nothing in the journal or the audit log",
    async (_step, sql) => {
      const space = await newSpace();
      const accountId = await account(space);
      failTransactionsStatement(sql);
      const res = await call(space, "POST", "/v1/transactions", purchase(accountId));
      expect(res.statusCode).toBe(500);
      expect(await written(space.householdId)).toEqual({ transactions: 0, entries: 0, events: 0, audit: 0 });
      expect(await pendingJobs(space.householdId)).toBe(0);
      expect(await balance(space, accountId)).toBe("1000");
    },
  );

  it.each([
    ["ledger.post", () => void vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"))],
    ["audit.record", failTransactionAudit],
  ])(
    "ARC-04@PoC FR 2: a failure at %s after the commit leaves the transaction whole once the worker hands it over",
    async (_step, inject) => {
      const space = await newSpace();
      const accountId = await account(space);
      inject();
      const res = await call(space, "POST", "/v1/transactions", purchase(accountId));
      // The transaction is created: its hand-off is in the transactions queue, committed with it.
      expect(res.statusCode, res.body).toBe(201);
      expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
      expect(await pendingJobs(space.householdId)).toBe(1);

      vi.restoreAllMocks();
      await runWorker(space.householdId);
      expect(await pendingJobs(space.householdId)).toBe(0);
      expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 1, events: 1, audit: 1 });
      expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
      expect(await balance(space, accountId)).toBe("954.5");
    },
  );

  it("ARC-04@PoC FR 3: the hand-off done right away and again by the worker writes everything once", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const res = await call(space, "POST", "/v1/transactions", purchase(accountId));
    expect(res.statusCode).toBe(201);
    expect(await balance(space, accountId)).toBe("954.5");
    const before = await written(space.householdId);
    expect(before).toEqual({ transactions: 1, entries: 1, events: 1, audit: 1 });
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await written(space.householdId)).toEqual(before);
  });

  it("ARC-04@PoC FR 3: a create retried with its Idempotency-Key after a failure publishes its journal event once", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const key = randomUUID();
    // The last write of the transactions transaction fails: the journal has not been touched yet.
    failTransactionsStatement(/^\s*INSERT INTO jobs\b/);
    expect((await call(space, "POST", "/v1/transactions", purchase(accountId), key)).statusCode).toBe(500);
    vi.restoreAllMocks();
    const retry = await call(space, "POST", "/v1/transactions", purchase(accountId), key);
    expect(retry.statusCode).toBe(201);
    const replay = await call(space, "POST", "/v1/transactions", purchase(accountId), key);
    expect(replay.json().id).toBe(retry.json().id);
    await runWorker(space.householdId);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger.outbox_events
        WHERE household_id = $1 AND event_name = 'ledger.entry-recorded' AND payload->>'eventType' = 'transaction'`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(1);
    expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 1, events: 1, audit: 1 });
    expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
    expect(await balance(space, accountId)).toBe("954.5");
  });

  it("ARC-04@PoC FR 2: the hand-off's journal event waits for the account's own hand-off (ledger account not opened yet)", async () => {
    const space = await newSpace();
    // The account's hand-off fails right away: its ledger account is not opened until the worker runs.
    vi.spyOn(ledger, "openAccount").mockRejectedValueOnce(new Error("injected"));
    const created = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний поточний",
      balance: { amount: "1000.00", currency: "EUR" },
      balanceDate: "2026-01-01",
    });
    expect(created.statusCode).toBe(201);
    vi.restoreAllMocks();
    const res = await call(space, "POST", "/v1/transactions", purchase(created.json().id));
    expect(res.statusCode, res.body).toBe(201);
    expect(await pendingJobs(space.householdId)).toBe(1);
    await runWorker(space.householdId);
    // One pass may run the transaction's hand-off before the account's; the next one finishes it.
    if ((await pendingJobs(space.householdId)) > 0) {
      await db.owner.query(`UPDATE transactions.jobs SET run_after = now() WHERE household_id = $1`, [
        space.householdId,
      ]);
      await runWorker(space.householdId);
    }
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 1, events: 1, audit: 1 });
    expect(await balance(space, created.json().id)).toBe("954.5");
  });
});

describe("ARC-04@PoC FR 2: the edit and «Видалити» of a transaction hand their journal change and audit entry over atomically", () => {
  async function created(space: Space, accountId: string) {
    const res = await call(space, "POST", "/v1/transactions", purchase(accountId));
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it("ARC-04@PoC FR 2: a failure in the transactions transaction of an edit leaves the journal and the audit log as they were", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    await runWorker(space.householdId);
    const before = await written(space.householdId);
    failTransactionsStatement(/^\s*INSERT INTO jobs\b/);
    const res = await call(space, "PATCH", `/v1/transactions/${id}`, {
      amount: { amount: "-100", currency: "EUR" },
    });
    expect(res.statusCode).toBe(500);
    expect(await written(space.householdId)).toEqual(before);
    expect(await balance(space, accountId)).toBe("954.5");
    expect((await call(space, "GET", `/v1/transactions/${id}`)).json().amount.amount).toBe("-45.5");
  });

  it("ARC-04@PoC FR 2: a failure of the correction after the commit is finished by the worker", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    vi.spyOn(ledger, "correct").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "PATCH", `/v1/transactions/${id}`, {
      amount: { amount: "-100", currency: "EUR" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().amount.amount).toBe("-100");
    expect(await pendingJobs(space.householdId)).toBeGreaterThan(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("900");
    // The create, the correction (its reversal and the new entry): three entries; two audit entries.
    expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 3, events: 3, audit: 2 });
  });

  it("ARC-04@PoC FR 3: a late hand-off of an earlier edit never undoes a later one", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    // The first edit's hand-off fails right away; the second goes through, then the worker runs the first.
    vi.spyOn(ledger, "correct").mockRejectedValueOnce(new Error("injected"));
    expect(
      (await call(space, "PATCH", `/v1/transactions/${id}`, { amount: { amount: "-100", currency: "EUR" } }))
        .statusCode,
    ).toBe(200);
    vi.restoreAllMocks();
    expect(
      (await call(space, "PATCH", `/v1/transactions/${id}`, { amount: { amount: "-20", currency: "EUR" } }))
        .statusCode,
    ).toBe(200);
    expect(await balance(space, accountId)).toBe("980");
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("980");
    const live = await ledger.liveEntries(space.householdId, { module: "transactions", id }, "transaction");
    expect(live).toHaveLength(1);
    // Create and both edits are in the log, each once.
    expect((await written(space.householdId)).audit).toBe(3);
  });

  it("ARC-04@PoC FR 2: a failure of the reversal after «Видалити» is finished by the worker; the balance is as before", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    vi.spyOn(ledger, "reverse").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "DELETE", `/v1/transactions/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("1000");
    expect(
      await ledger.liveEntries(space.householdId, { module: "transactions", id }, "transaction"),
    ).toEqual([]);
    // The entry and its reversal; the audit entries of the create and the delete.
    expect(await written(space.householdId)).toMatchObject({ transactions: 0, entries: 2, audit: 2 });
  });

  it("ARC-04@PoC FR 3: a deferred create whose transaction is deleted first never posts its journal event", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const id = await created(space, accountId);
    vi.restoreAllMocks();
    expect((await call(space, "DELETE", `/v1/transactions/${id}`)).statusCode).toBe(200);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("1000");
    expect(await written(space.householdId)).toMatchObject({ transactions: 0, entries: 0, audit: 2 });
  });

  it("ARC-04@PoC FR 2: the hand-off's audit entries carry the masked texts only; the job's payload holds no free text", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    const { rows } = await db.owner.query<{ payload: unknown }>(
      `SELECT payload FROM transactions.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    const payload = JSON.stringify(rows.map((r) => r.payload));
    expect(payload).not.toContain("Синтетичний магазин");
    expect(payload).not.toContain("Синтетичні продукти");
    const [entry] = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    expect(entry!.changes).toContainEqual({
      field: "counterparty",
      before: null,
      after: AUDIT_MASK,
      masked: true,
    });
    expect(entry!.changes).toContainEqual({ field: "amount", before: null, after: "-45.5", masked: false });
  });

  it("ARC-04@PoC FR 2: the space's erasure takes the transactions queue's rows with its transactions", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    await created(space, accountId);
    const erased = await createTransactionsErasure(db.databases.for("transactions")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ transactions: 1, idempotencyKeys: 0, jobs: 1 });
    expect(await n("transactions.jobs WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 4: a hand-off the worker gave up on goes back to the transactions queue with the daily recovery", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    await created(space, accountId);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [space.householdId],
    );
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    const recovery = tasks.find((t) => t.name === "transactions.hand-off-recovery");
    expect(recovery).toBeDefined();
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("transactions.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await recovery!.run();
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("954.5");
  });
});

describe("ARC-04@PoC FR 3 (#252 item 2): an audit key is one entry — of one entity and one action", () => {
  const entry = (space: Space, entityId: string, key: string) => ({
    actor: { kind: "user" as const, id: space.accountId },
    channel: "web" as const,
    entity: { type: "transactions.transaction", id: entityId },
    action: "create" as const,
    changes: [{ field: "amount", before: null, after: "-45.5", sensitive: false }],
    key,
  });

  it("ARC-04@PoC FR 3: an identical replay of a keyed entry appends nothing and returns the entry made", async () => {
    const space = await newSpace();
    const id = randomUUID();
    const first = await audit.record(space.householdId, entry(space, id, `transactions.create:${id}:1`));
    const again = await audit.record(space.householdId, entry(space, id, `transactions.create:${id}:1`));
    expect(again.id).toBe(first.id);
    expect(await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })).toHaveLength(
      1,
    );
  });

  it("ARC-04@PoC FR 3: the same key for another entity or another action fails loudly and appends nothing", async () => {
    const space = await newSpace();
    const id = randomUUID();
    const key = `transactions.create:${id}:1`;
    await audit.record(space.householdId, entry(space, id, key));
    const other = randomUUID();
    await expect(audit.record(space.householdId, entry(space, other, key))).rejects.toBeInstanceOf(
      AuditKeyConflict,
    );
    await expect(
      audit.record(space.householdId, { ...entry(space, id, key), entity: { type: "accounts.account", id } }),
    ).rejects.toBeInstanceOf(AuditKeyConflict);
    await expect(
      audit.record(space.householdId, { ...entry(space, id, key), action: "delete" }),
    ).rejects.toBeInstanceOf(AuditKeyConflict);
    expect(await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })).toHaveLength(
      1,
    );
    expect(
      await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: other }),
    ).toEqual([]);
    expect(await audit.entriesFor(space.householdId, { type: "accounts.account", id })).toEqual([]);
  });
});
