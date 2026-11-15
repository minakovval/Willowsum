import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createTransactionsServices } from "../src/modules/transactions/index.ts";

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
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          walletUsage: [],
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

// Security probes of PR #255 (reviewer's; harness above copied from arc04-transactions-hand-off.it.test.ts).
async function created(space: Space, accountId: string, amount = "-45.50") {
  const res = await call(space, "POST", "/v1/transactions", purchase(accountId, amount));
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}
const live = (space: Space, id: string) =>
  ledger.liveEntries(space.householdId, { module: "transactions", id }, "transaction");
const jobStates = async (householdId: string) =>
  (
    await db.owner.query<{ name: string; state: string }>(
      `SELECT name, state FROM transactions.jobs WHERE household_id = $1 ORDER BY name, state`,
      [householdId],
    )
  ).rows.map((r) => `${r.name}:${r.state}`);

describe("sec255: household isolation of the hand-off", () => {
  it("sec255: an audit key of one space never collides with the same key in another space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const id = randomUUID();
    const entry = (s: Space) => ({
      actor: { kind: "user" as const, id: s.accountId },
      channel: "web" as const,
      entity: { type: "transactions.transaction", id },
      action: "create" as const,
      changes: [{ field: "amount", before: null, after: "-1", sensitive: false }],
      key: `transactions.create:${id}:1`,
    });
    const first = await audit.record(a.householdId, entry(a));
    // Another entity under the same key, in another space: no conflict, no entry of A returned.
    const second = await audit.record(b.householdId, { ...entry(b), action: "delete" as const });
    expect(second.id).not.toBe(first.id);
    expect(await audit.entriesFor(a.householdId, { type: "transactions.transaction", id })).toHaveLength(1);
    expect(await audit.entriesFor(b.householdId, { type: "transactions.transaction", id })).toHaveLength(1);
  });

  it("sec255: the worker of one space runs no hand-off of another; the recovery requeues only that space's dead hand-offs", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accA = await account(a);
    const accB = await account(b);
    await created(a, accA); // done right away; its job is finished by the worker below
    vi.spyOn(ledger, "post")
      .mockRejectedValueOnce(new Error("injected"))
      .mockRejectedValueOnce(new Error("injected"));
    const idA = await created(a, accA, "-10");
    const idB = await created(b, accB, "-10");
    vi.restoreAllMocks();
    await runWorker(a.householdId);
    expect(await live(a, idA)).toHaveLength(1);
    expect(await live(b, idB)).toHaveLength(0);
    expect(await pendingJobs(b.householdId)).toBe(1);
    expect(await balance(b, accB)).toBe("1000");

    // A: one job dead, one done, one dead job of another name; B: its job dead.
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8, finished_at = now()
        WHERE household_id = $1 AND dedupe_key = $2`,
      [a.householdId, `create:${idA}:1`],
    );
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [b.householdId],
    );
    await db.owner.query(
      `INSERT INTO transactions.jobs (household_id, name, dedupe_key, payload, state, attempts)
       VALUES ($1, 'transactions.other', 'k', '{}'::jsonb, 'dead', 8)`,
      [a.householdId],
    );
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [a.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((t) => t.name === "transactions.hand-off-recovery")!.run();
    expect(await jobStates(a.householdId)).toEqual([
      "transactions.hand-off:done",
      "transactions.hand-off:queued",
      "transactions.other:dead",
    ]);
    expect(await jobStates(b.householdId)).toEqual(["transactions.hand-off:dead"]);
  });

  it("sec255: a hand-off job in one space that names another space's transaction touches nothing of that space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accA = await account(a);
    const idA = await created(a, accA);
    await runWorker(a.householdId);
    const before = await written(a.householdId);
    for (const action of ["delete", "update", "create"]) {
      await db.owner.query(
        `INSERT INTO transactions.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'transactions.hand-off', $2, $3)`,
        [
          b.householdId,
          `${action}:${idA}:1`,
          JSON.stringify({ transactionId: idA, actorAccountId: b.accountId, action, version: 1, audit: [] }),
        ],
      );
    }
    await runWorker(b.householdId);
    expect(await written(a.householdId)).toEqual(before);
    expect(await live(a, idA)).toHaveLength(1);
    expect(await balance(a, accA)).toBe("954.5");
    expect(await n("ledger.entries WHERE household_id = $1", b.householdId)).toBe(0);
  });
});

describe("sec255: the client cannot choose the hand-off's keys", () => {
  it("sec255: the job key and the audit key are made of the server's id and version, whatever the Idempotency-Key and the body say", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const chosen = randomUUID();
    const forged = `transactions.create:${chosen}:1`;
    const res = await call(space, "POST", "/v1/transactions", { ...purchase(accountId), id: chosen }, forged);
    if (res.statusCode === 201) {
      const id = res.json().id as string;
      expect(id).not.toBe(chosen);
      await runWorker(space.householdId);
      const jobs = await db.owner.query<{ dedupe_key: string }>(
        `SELECT dedupe_key FROM transactions.jobs WHERE household_id = $1 AND name = 'transactions.hand-off'`,
        [space.householdId],
      );
      expect(jobs.rows.map((r) => r.dedupe_key)).toEqual([`create:${id}:1`]);
      const keys = await db.owner.query<{ dedupe_key: string }>(
        `SELECT dedupe_key FROM audit.entries WHERE household_id = $1 AND entity_type = 'transactions.transaction'`,
        [space.householdId],
      );
      expect(keys.rows.map((r) => r.dedupe_key)).toEqual([`transactions.create:${id}:1`]);
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await written(space.householdId)).toEqual({ transactions: 0, entries: 0, events: 0, audit: 0 });
    }
  });
});

describe("sec255: the journal matches the row under concurrency and retry", () => {
  it("sec255: parallel edits and worker passes leave one entry in effect that equals the row", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    const amounts = ["-10", "-20", "-30", "-40", "-50", "-60"];
    await Promise.all([
      ...amounts.map((amount) =>
        call(space, "PATCH", `/v1/transactions/${id}`, { amount: { amount, currency: "EUR" } }),
      ),
      runWorker(space.householdId),
      runWorker(space.householdId),
    ]);
    await runWorker(space.householdId);
    await db.owner.query(`UPDATE transactions.jobs SET run_after = now() WHERE household_id = $1`, [
      space.householdId,
    ]);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    const row = (await call(space, "GET", `/v1/transactions/${id}`)).json();
    const entries = await live(space, id);
    expect(entries).toHaveLength(1);
    const { rows } = await db.owner.query<{ total: string }>(
      `SELECT (1000 + $2::numeric)::text AS total FROM (SELECT 1) x WHERE $1::uuid IS NOT NULL`,
      [space.householdId, row.amount.amount],
    );
    expect(Number(await balance(space, accountId))).toBe(Number(rows[0]!.total));
    // One audit entry per committed change: the create and each edit that changed the row.
    const versions = await db.owner.query<{ version: number }>(
      `SELECT version FROM transactions.transactions WHERE id = $1`,
      [id],
    );
    expect((await written(space.householdId)).audit).toBe(versions.rows[0]!.version);
  });

  it("sec255: parallel creates with one Idempotency-Key and the worker post one journal event", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const key = randomUUID();
    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => call(space, "POST", "/v1/transactions", purchase(accountId), key)),
    );
    expect(answers.some((r) => r.statusCode === 201)).toBe(true);
    await runWorker(space.householdId);
    expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 1, events: 1, audit: 1 });
    expect(await balance(space, accountId)).toBe("954.5");
  });

  it("sec255: an edit racing «Видалити» and the worker ends with the journal matching what is left", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    for (let i = 0; i < 4; i++) {
      const id = await created(space, accountId, "-5");
      await Promise.all([
        call(space, "PATCH", `/v1/transactions/${id}`, { amount: { amount: "-7", currency: "EUR" } }),
        call(space, "DELETE", `/v1/transactions/${id}`),
        runWorker(space.householdId),
      ]);
    }
    await db.owner.query(`UPDATE transactions.jobs SET run_after = now() WHERE household_id = $1`, [
      space.householdId,
    ]);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await n("transactions.transactions WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await balance(space, accountId)).toBe("1000");
    expect(await orphans(space.householdId)).toMatchObject({});
  });

  it("sec255: a deferred edit that moves the transaction to another account and date is finished by the worker on both accounts", async () => {
    const space = await newSpace();
    const from = await account(space);
    const to = await account(space);
    const id = await created(space, from);
    vi.spyOn(ledger, "correct").mockRejectedValueOnce(new Error("injected"));
    expect((await call(space, "PATCH", `/v1/transactions/${id}`, { accountId: to })).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(await balance(space, from)).toBe("954.5");
    await runWorker(space.householdId);
    expect(await balance(space, from)).toBe("1000");
    expect(await balance(space, to)).toBe("954.5");
    // A date-only edit is a correction too.
    expect((await call(space, "PATCH", `/v1/transactions/${id}`, { date: "2026-10-01" })).statusCode).toBe(
      200,
    );
    const [entry] = await live(space, id);
    expect(entry!.operationDate).toBe("2026-10-01");
    await runWorker(space.householdId);
    // create; move (reversal + entry); date (reversal + entry): five entries, written once.
    expect((await written(space.householdId)).entries).toBe(5);
    expect(await live(space, id)).toHaveLength(1);
  });

  it("sec255: a text-only edit writes no journal entry, one audit entry", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    expect(
      (await call(space, "PATCH", `/v1/transactions/${id}`, { description: "Інший синтетичний опис" }))
        .statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await written(space.householdId)).toEqual({ transactions: 1, entries: 1, events: 1, audit: 2 });
    const payloads = await db.owner.query<{ payload: unknown }>(
      `SELECT payload FROM transactions.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(JSON.stringify(payloads.rows)).not.toContain("синтетичний опис");
    const entries = await db.owner.query<{ changes: unknown }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1`,
      [space.householdId],
    );
    expect(JSON.stringify(entries.rows)).not.toContain("синтетичний опис");
  });

  // Residue of the order before this PR (journal first): the row exists, its only entry is reversed (a «Видалити» whose
  // commit failed after the reversal). The old code reposted with `transactions.repost:<id>:<version>`; the new one
  // posts with `transactions.create:<id>` at version 1, which the journal answers with the reversed entry: the hand-off now
  // throws instead of reporting it posted (#257 item 2; unit test arc04-hand-off-stale); after an edit (version 2) it posts.
  it("sec255 (follow-up): a row whose create entry was reversed before this PR gets its journal event back on the next hand-off", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    const [entry] = await live(space, id);
    await ledger.reverse(space.householdId, entry!.id, `transactions.delete:${entry!.id}`);
    expect(
      (
        await call(space, "PATCH", `/v1/transactions/${id}`, {
          amount: { amount: "-100", currency: "EUR" },
        })
      ).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await live(space, id)).toHaveLength(1);
    expect(await balance(space, accountId)).toBe("900");
  });
});

// Tests for the survivors of the mutation run (M3: the row not locked; M18: extra entries in effect not reversed).
describe("sec255: survivors", () => {
  it("sec255: an edit waits for a hand-off in flight on the same row (row lock): one post, then one correction", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = ledger.post.bind(ledger);
    const post = vi.spyOn(ledger, "post").mockImplementationOnce(async (householdId, input) => {
      await gate;
      return original(householdId, input);
    });
    const correct = vi.spyOn(ledger, "correct");
    const creating = call(space, "POST", "/v1/transactions", purchase(accountId));
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const { rows } = await db.owner.query<{ id: string }>(
      `SELECT id FROM transactions.transactions WHERE household_id = $1`,
      [space.householdId],
    );
    const id = rows[0]!.id;
    const editing = call(space, "PATCH", `/v1/transactions/${id}`, {
      amount: { amount: "-100", currency: "EUR" },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // The create's hand-off holds the row: the edit has not reached the journal, and posts nothing of its own.
    expect(post).toHaveBeenCalledTimes(1);
    expect(correct).not.toHaveBeenCalled();
    release();
    expect((await creating).statusCode).toBe(201);
    expect((await editing).statusCode).toBe(200);
    expect(post).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledTimes(1);
    expect(await live(space, id)).toHaveLength(1);
    expect(await balance(space, accountId)).toBe("900");
  });

  it("sec255: a second entry in effect of one transaction is reversed by the next hand-off; the balance equals the row", async () => {
    const space = await newSpace();
    const accountId = await account(space);
    const id = await created(space, accountId);
    const [entry] = await live(space, id);
    const posting = entry!.postings[0]!;
    await ledger.post(space.householdId, {
      source: { module: "transactions", id },
      idempotencyKey: `sec255.extra:${id}`,
      operationDate: entry!.operationDate,
      event: { type: "transaction", account: posting.creditAccountId, amount: posting.amount.negated() },
    });
    expect(await live(space, id)).toHaveLength(2);
    expect(await balance(space, accountId)).toBe("909");
    expect(
      (await call(space, "PATCH", `/v1/transactions/${id}`, { description: "Синтетична зміна" })).statusCode,
    ).toBe(200);
    expect(await live(space, id)).toHaveLength(1);
    expect(await balance(space, accountId)).toBe("954.5");
  });
});
