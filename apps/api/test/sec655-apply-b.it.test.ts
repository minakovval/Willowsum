import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import {
  createImportedTransactions,
  IMPORT_WAITERS_MAX,
  ImportWriteRefused,
  ImportWriteVoided,
} from "../src/modules/transactions/index.ts";
import { lockAccounts } from "../src/modules/accounts/index.ts";
import { createImportSessionsApplyRecovery, STUCK_AFTER_MS } from "../src/modules/import-sessions/index.ts";
import { planImport } from "../src/modules/duplicate-matching/index.ts";
import { applyTx } from "../src/modules/import-sessions/adapters/db/store.ts";
import { applyBatch, type ApplyPorts } from "../src/modules/import-sessions/application/index.ts";
import { leakText } from "./leak-text.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * «Застосувати», part b (IMP-01@PoC FR 11; IMP-04@PoC FR 4, FR 7; IMP-05@PoC FR 3; #654) on a real PostgreSQL with the
 * real parse worker and module transactions: an apply stuck «in progress» is shown on the batch and settled by the daily
 * recovery; a refused attempt is given up under the import lock, so a request that joined it writes nothing under a
 * batch back in «розібрано»; ceilings of rows and of applies at once; the money lock only around the write; the text
 * planned as stored; the previous statement of the history check only of a finished apply. Synthetic data only; the
 * clock is the test's.
 */ const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// A synthetic IBAN built so no real-looking literal sits in the source.
const OTHER_IBAN = ["UA", "00", "111111", "0000000", "222222", "334821"].join("");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  readonly eur: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const eur = randomUUID();
  accountsOf.set(`${householdId}/${eur}`, {
    accountId: eur,
    kind: "current",
    status: "active",
    subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
  });
  return { accountId, householdId, eur };
}

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown, scoped = false) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({
        userId: space.accountId,
        householdId: space.householdId,
        ...(scoped ? { role: "editor", scoped: true } : {}),
      }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** 1 000,00 → 1 440,00 EUR, its figures agree: nothing to review with its account. */
const CLEAN = text([
  "Вхідний залишок:;1000.00 EUR",
  "Дата;Сума;Опис",
  "15.03.2026;500.00;Зарплата ТОВ «Вигадка»",
  `20.03.2026;-60.00;Переказ на ${OTHER_IBAN}`,
  "Кінцевий залишок:;1440.00 EUR",
]);

async function batchWith(space: Space, parts: readonly { name: string; bytes: Buffer }[]) {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const body = Buffer.concat([
    ...parts.map((p) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        p.bytes,
        Buffer.from("\r\n"),
      ]),
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileIds: (res.json().files as { id: string }[]).map((f) => f.id) };
}

/** Runs the space's import queue until nothing is due (the parse jobs, then their audit hand-offs). */
async function work(householdId: string): Promise<void> {
  const worker = createWorker({
    queues: [
      createImportSessionsWorkerQueue(db.databases.for("import-sessions"), audit, {
        modules: {
          files,
          keys,
          recipes: createImportRecipesReader(db.databases.for("import-recipes")),
          accounts,
          parser: isolatedStatementParser(),
        },
        now: clock.now,
        newId: randomUUID,
      }),
    ],
    households: async () => [householdId],
    retryDelayMs: () => 0,
  });
  try {
    for (let i = 0; i < 8; i++) {
      if ((await worker.tick()) === 0) break;
      await worker.idle();
    }
  } finally {
    await worker.stop();
  }
}

/** A batch of these files parsed for the space's EUR account (or for none). */
async function parsedBatch(
  space: Space,
  parts: readonly { name: string; bytes: Buffer }[] = [{ name: "berezen.csv", bytes: CLEAN }],
  withAccount = true,
) {
  const batch = await batchWith(space, parts);
  const started = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: batch.fileIds.map((fileId) => ({ fileId, ...(withAccount ? { accountId: space.eur } : {}) })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return batch;
}

const apply = (space: Space, batchId: string, scoped = false) =>
  call(space, "POST", `/v1/import/batches/${batchId}/apply`, undefined, scoped);

async function imported(householdId: string, accountId?: string) {
  const { rows } = await db.owner.query<{
    amount: string;
    description: string | null;
    bank_description: string | null;
    source: string;
    import_batch_id: string;
    import_file_id: string;
    import_row: number;
    review: string | null;
    status: string;
  }>(
    `SELECT trim_scale(amount)::text AS amount, description, bank_description, source, import_batch_id, import_file_id,
            import_row, review, status
       FROM transactions.transactions WHERE household_id = $1 AND ($2::uuid IS NULL OR account_id = $2)
      ORDER BY import_batch_id, import_file_id, import_row`,
    [householdId, accountId ?? null],
  );
  return rows;
}

const stateOf = async (batchId: string) =>
  (
    await db.owner.query<{ state: string }>(`SELECT state FROM import_sessions.batches WHERE id = $1`, [
      batchId,
    ])
  ).rows[0]!.state;

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys,
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
          apply: {
            transactions: createImportedTransactions(db.databases.for("transactions"), {
              accounts,
              ledger: createLedger(db.databases.for("ledger")),
              audit,
              newId: randomUUID,
              now: clock.now,
            }),
          },
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

/** The apply's ports as the route wires them, with a gate before a chosen step. */
function portsOf(
  space: Space,
  gate: {
    open?: Promise<void>;
    write?: Promise<void>;
    plan?: Promise<void>;
    reached?: () => void;
    events?: (events: unknown[]) => unknown[];
  },
): ApplyPorts {
  const transactions = createImportedTransactions(db.databases.for("transactions"), {
    accounts,
    ledger: createLedger(db.databases.for("ledger")),
    audit,
    newId: randomUUID,
    now: clock.now,
  });
  return {
    run: (work) =>
      db.databases.for("import-sessions").inHousehold(space.householdId, (q) => work(applyTx(q))),
    open: async (purpose, sealed) => {
      if (gate.open) {
        gate.reached?.();
        await gate.open;
      }
      const plain = await keys.openBytes(space.householdId, purpose, sealed);
      if (!gate.events) return plain;
      const parsed = JSON.parse(new TextDecoder().decode(plain)) as { events: { events: unknown[] } };
      parsed.events.events = gate.events(parsed.events.events);
      return new TextEncoder().encode(JSON.stringify(parsed));
    },
    write: async (input, plan) => {
      if (gate.write) {
        gate.reached?.();
        await gate.write;
      }
      return transactions.write(space.householdId, input, plan);
    },
    settle: (input) => transactions.settle(space.householdId, input),
    plan: async (planDeps, request) => {
      if (gate.plan) {
        gate.reached?.();
        await gate.plan;
      }
      return planImport(planDeps, space.householdId, request);
    },
  };
}

function gated() {
  let release!: () => void;
  let reached!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const at = new Promise<void>((r) => (reached = r));
  return { wait, at, release, reached };
}

const deps = { newId: randomUUID, now: () => new Date(now) };

const outcome = <T>(p: Promise<T>) =>
  p.then(
    (r) => ({ ok: true as const, r }),
    (e: unknown) => ({ ok: false as const, e }),
  );

const applicationOf = async (batchId: string) =>
  (
    await db.owner.query<{ in_progress: boolean; result: { counts: Record<string, number> } }>(
      `SELECT in_progress, result FROM import_sessions.batch_applications WHERE batch_id = $1`,
      [batchId],
    )
  ).rows[0] ?? null;

function setStatus(space: Space, status: "active" | "closed") {
  const key = `${space.householdId}/${space.eur}`;
  accountsOf.set(key, { ...accountsOf.get(key)!, status });
}

const importedTransactions = () =>
  createImportedTransactions(db.databases.for("transactions"), {
    accounts,
    ledger: createLedger(db.databases.for("ledger")),
    audit,
    newId: randomUUID,
    now: clock.now,
  });

/** The daily recovery for one space, run at `at`. */
const recover = (space: Space, at: number) =>
  createImportSessionsApplyRecovery({
    db: db.databases.for("import-sessions"),
    transactions: importedTransactions(),
    audit,
    households: async () => [space.householdId],
    now: () => at,
    newId: randomUUID,
  }).run();

/** Step A committed, then the process ended (the request never came back): the batch «застосовано», «in progress». */
async function crashedAfterStart(space: Space, batchId: string, attemptId: string) {
  await db.owner.query(
    `INSERT INTO import_sessions.batch_applications
       (household_id, batch_id, result, applied_by, applied_at, in_progress, from_state, attempt_id)
     VALUES ($1, $2, '{"counts":{}}', $3, $4, true, 'parsed', $5)`,
    [space.householdId, batchId, space.accountId, new Date(now), attemptId],
  );
  await db.owner.query(`UPDATE import_sessions.batches SET state = 'applied' WHERE id = $1`, [batchId]);
}

/**
 * Security review of PR #655 (IMP-01@PoC FR 11, IMP-04@PoC FR 7; #654): the new table's isolation, the void / write
 * guard in every order, the ceilings per space, the recovery per space and the money lock around the write.
 */
const voidsOf = async (householdId: string) =>
  (
    await db.owner.query<{ import_batch_id: string; attempt_id: string }>(
      `SELECT import_batch_id, attempt_id FROM transactions.import_voids WHERE household_id = $1`,
      [householdId],
    )
  ).rows;

const writeInput = (space: Space, batch: { batchId: string; fileIds: string[] }, attemptId: string) => ({
  batchId: batch.batchId,
  attemptId,
  actorId: space.accountId,
  accountIds: [space.eur],
  fileIds: batch.fileIds,
});

/** Holds every import slot of the space until released. */
async function holdSlots(householdId: string) {
  const release = gated();
  const held: Promise<void>[] = [];
  const taken: Promise<void>[] = [];
  for (let slot = 0; slot < IMPORT_WAITERS_MAX; slot++) {
    let took!: () => void;
    taken.push(new Promise<void>((r) => (took = r)));
    held.push(
      db.databases.for("transactions").inHousehold(householdId, async (q) => {
        await q.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('transactions.import-slot:' || $1 || ':' || $2, 0))`,
          [householdId, String(slot)],
        );
        took();
        await release.wait;
      }),
    );
  }
  await Promise.all(taken);
  return async () => {
    release.release();
    await Promise.all(held);
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PR #655 security: import_voids is bound to its space (ARC-03 FR 2)", () => {
  it("sec655: import_voids has forced row security with the platform's policy; another space's give-ups are neither read nor written; another module's role has no access", async () => {
    const { rows } = await db.owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              ARRAY(SELECT p.polname::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c WHERE c.oid = 'transactions.import_voids'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, forced: true, policies: ["household_isolation"] });
    const a = await newSpace();
    const b = await newSpace();
    const batchId = randomUUID();
    const attemptId = randomUUID();
    await importedTransactions().settle(b.householdId, { batchId, attemptId, accountIds: [b.eur] });
    expect(await voidsOf(b.householdId)).toHaveLength(1);
    const transactions = db.databases.for("transactions");
    // Read without the SQL filter: the policy alone hides the other space's row.
    const seen = await transactions.inHousehold(a.householdId, (q) =>
      q.query(`SELECT household_id FROM import_voids`),
    );
    expect(seen.rows).toEqual([]);
    await expect(
      transactions.inHousehold(a.householdId, (q) =>
        q.query(
          `INSERT INTO import_voids (household_id, import_batch_id, attempt_id, voided_at) VALUES ($1, $2, $3, now())`,
          [b.householdId, randomUUID(), randomUUID()],
        ),
      ),
    ).rejects.toThrow();
    const gone = await transactions.inHousehold(a.householdId, (q) => q.query(`DELETE FROM import_voids`));
    expect(gone.rowCount).toBe(0);
    expect(await voidsOf(b.householdId)).toHaveLength(1);
    // Module import-sessions reaches the give-ups only through the public interface.
    await expect(
      db.databases
        .for("import-sessions")
        .inHousehold(a.householdId, (q) => q.query(`SELECT 1 FROM transactions.import_voids`)),
    ).rejects.toThrow();
    // Space B's give-up does not refuse a write of the same ids in space A (the give-up is the space's own).
    await expect(
      importedTransactions().write(
        a.householdId,
        { batchId, attemptId, actorId: a.accountId, accountIds: [a.eur], fileIds: [] },
        async () => ({ import: 0 }),
      ),
    ).resolves.toMatchObject({ first: true });
  });
});

describe("PR #655 security: a give-up and a write of the same attempt, in every order", () => {
  it("sec655: the write first (still planning) — the give-up waits for it, gives nothing up and returns its counts", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const attemptId = randomUUID();
    const g = gated();
    const writing = importedTransactions().write(
      space.householdId,
      writeInput(space, batch, attemptId),
      async () => {
        g.reached();
        await g.wait;
        return { import: 7 };
      },
    );
    await g.at;
    let settledEarly = false;
    const settling = importedTransactions()
      .settle(space.householdId, { batchId: batch.batchId, attemptId, accountIds: [space.eur] })
      .then((r) => {
        settledEarly = true;
        return r;
      });
    await pause(400);
    expect(settledEarly).toBe(false);
    g.release();
    expect(await writing).toMatchObject({ first: true, counts: { import: 7 } });
    expect(await settling).toEqual({ import: 7 });
    expect(await voidsOf(space.householdId)).toEqual([]);
  });

  it("sec655: the write waiting for the import lock while the attempt is given up — it sees the give-up once it has the lock and writes nothing", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const attemptId = randomUUID();
    const hold = gated();
    const locked = gated();
    const holder = db.databases.for("transactions").inHousehold(space.householdId, async (q) => {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('transactions.import:' || $1 || ':' || $2, 0))`,
        [space.householdId, space.eur],
      );
      locked.release();
      await hold.wait;
    });
    await locked.wait;
    let planned = false;
    const writing = outcome(
      importedTransactions().write(
        space.householdId,
        writeInput(space, batch, attemptId),
        async (context) => {
          planned = true;
          await context.create([]);
          return { import: 0 };
        },
      ),
    );
    await pause(400);
    // The give-up commits while the write waits (as `settle` does it under the lock the holder stands for).
    await db.owner.query(
      `INSERT INTO transactions.import_voids (household_id, import_batch_id, attempt_id, voided_at) VALUES ($1, $2, $3, now())`,
      [space.householdId, batch.batchId, attemptId],
    );
    hold.release();
    await holder;
    const done = await writing;
    expect(!done.ok && done.e).toBeInstanceOf(ImportWriteVoided);
    expect(planned).toBe(false);
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("sec655: a give-up of a batch already written gives nothing up — a refused late request never puts a written batch back", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const first = await apply(space, batch.batchId);
    expect(first.statusCode, first.body).toBe(200);
    const settled = await importedTransactions().settle(space.householdId, {
      batchId: batch.batchId,
      attemptId: randomUUID(),
      accountIds: [space.eur],
    });
    expect(settled).toMatchObject({ import: 2 });
    expect(await voidsOf(space.householdId)).toEqual([]);
  });

  it("sec655: a late refused request of a given-up attempt does not give up the next attempt — its result stays, the batch stays «застосовано»", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const old = randomUUID();
    await crashedAfterStart(space, batch.batchId, old);
    // The slow request of the old attempt: checked, about to write.
    const g = gated();
    const late = outcome(
      applyBatch(deps, portsOf(space, { write: g.wait, reached: g.reached }), space.accountId, batch.batchId),
    );
    await g.at;
    // The recovery gives the old attempt up; the next «Застосувати» starts another one (still in progress).
    expect(await recover(space, now + STUCK_AFTER_MS + 1)).toBe(1);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    const next = randomUUID();
    await crashedAfterStart(space, batch.batchId, next);
    // The late request is refused before the void check (no slot free): it gives up its own attempt only.
    const free = await holdSlots(space.householdId);
    g.release();
    const done = await late;
    await free();
    expect(done.ok).toBe(false);
    expect(await stateOf(batch.batchId)).toBe("applied");
    const row = await db.owner.query<{ attempt_id: string; in_progress: boolean }>(
      `SELECT attempt_id, in_progress FROM import_sessions.batch_applications WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(row.rows).toEqual([{ attempt_id: next, in_progress: true }]);
    // The next attempt is not given up: its write goes through.
    expect((await voidsOf(space.householdId)).map((v) => v.attempt_id)).toEqual([old]);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("sec655: an apply started by the previous code (no attempt id) is given up under the batch's id; its late write is refused", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    await crashedAfterStart(space, batch.batchId, randomUUID());
    await db.owner.query(
      `UPDATE import_sessions.batch_applications SET attempt_id = NULL WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(await recover(space, now + STUCK_AFTER_MS + 1)).toBe(1);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await voidsOf(space.householdId)).toEqual([
      { import_batch_id: batch.batchId, attempt_id: batch.batchId },
    ]);
    await expect(
      importedTransactions().write(space.householdId, writeInput(space, batch, batch.batchId), async () => ({
        import: 0,
      })),
    ).rejects.toBeInstanceOf(ImportWriteVoided);
  });
});

describe("PR #655 security: the recovery works space by space and settles once", () => {
  it("sec655: a run for one space leaves another space's stuck apply alone; a second run changes nothing", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchA = await parsedBatch(a);
    const batchB = await parsedBatch(b);
    await crashedAfterStart(a, batchA.batchId, randomUUID());
    await crashedAfterStart(b, batchB.batchId, randomUUID());
    const at = now + STUCK_AFTER_MS + 1;
    expect(await recover(a, at)).toBe(1);
    expect(await stateOf(batchA.batchId)).toBe("parsed");
    expect(await stateOf(batchB.batchId)).toBe("applied");
    expect((await applicationOf(batchB.batchId))?.in_progress).toBe(true);
    expect(await voidsOf(b.householdId)).toEqual([]);
    const versionOf = async (id: string) =>
      (
        await db.owner.query<{ version: number }>(
          `SELECT version FROM import_sessions.batches WHERE id = $1`,
          [id],
        )
      ).rows[0]!.version;
    const version = await versionOf(batchA.batchId);
    expect(await recover(a, at)).toBe(0);
    expect(await versionOf(batchA.batchId)).toBe(version);
    expect(await voidsOf(a.householdId)).toHaveLength(1);
    // Space A's port cannot give up space B's attempt: the give-up is keyed by the caller's space.
    const stuckB = await db.owner.query<{ attempt_id: string }>(
      `SELECT attempt_id FROM import_sessions.batch_applications WHERE batch_id = $1`,
      [batchB.batchId],
    );
    await importedTransactions().settle(a.householdId, {
      batchId: batchB.batchId,
      attemptId: stuckB.rows[0]!.attempt_id,
      accountIds: [b.eur],
    });
    const res = await apply(b, batchB.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(await imported(b.householdId)).toHaveLength(2);
    expect(await imported(a.householdId)).toEqual([]);
  });
});

describe("PR #655 security: the ceilings are the space's own", () => {
  it("sec655: every import slot of one space taken — another space applies as usual; the 429 names no account, space or batch; another space reads 404 for an applying batch", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchA = await parsedBatch(a);
    const batchB = await parsedBatch(b);
    const free = await holdSlots(a.householdId);
    const other = await apply(b, batchB.batchId);
    const busy = await apply(a, batchA.batchId);
    await free();
    expect(other.statusCode, other.body).toBe(200);
    expect(busy.statusCode, busy.body).toBe(429);
    for (const secret of [a.eur, a.householdId, a.accountId, batchA.batchId])
      expect(leakText(busy.body)).not.toContain(secret);
    await crashedAfterStart(a, batchA.batchId, randomUUID());
    const foreign = await call(b, "GET", `/v1/import/batches/${batchA.batchId}`);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(leakText(foreign.body)).not.toContain("applying");
    expect((await apply(b, batchA.batchId)).statusCode).toBe(404);
  });
});

describe("PR #655 security: the money lock around the write, the import lock around the plan", () => {
  it("sec655: the write waits for the account's money lock before it records the batch — a holder of it (a closing) comes first", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g = gated();
    const running = outcome(
      applyBatch(deps, portsOf(space, { plan: g.wait, reached: g.reached }), space.accountId, batch.batchId),
    );
    await g.at;
    const hold = gated();
    const locked = gated();
    const holder = db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
      await lockAccounts(q, space.householdId, [space.eur]);
      locked.release();
      await hold.wait;
    });
    await locked.wait;
    let finished = false;
    void running.then(() => (finished = true));
    g.release();
    await pause(600);
    expect(finished).toBe(false);
    expect(await imported(space.householdId)).toEqual([]);
    // The holder closes the account and commits: the write, next under the lock, is refused.
    setStatus(space, "closed");
    hold.release();
    await holder;
    const done = await running;
    expect(!done.ok && done.e instanceof ImportWriteRefused && done.e.issue).toBe("account-closed");
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("sec655: two batches of the same file on one account applied at once — the second plans after the first is written: its rows are duplicates, nothing twice", async () => {
    const space = await newSpace();
    const one = await parsedBatch(space);
    const two = await parsedBatch(space, [{ name: "berezen-kopiia.csv", bytes: CLEAN }]);
    const g = gated();
    const first = outcome(
      applyBatch(deps, portsOf(space, { plan: g.wait, reached: g.reached }), space.accountId, one.batchId),
    );
    await g.at;
    const second = outcome(applyBatch(deps, portsOf(space, {}), space.accountId, two.batchId));
    await pause(600);
    g.release();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    const rows = await imported(space.householdId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.import_batch_id))).toEqual(new Set([one.batchId]));
  });
});
