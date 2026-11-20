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
import { schedulerDailyTasks } from "../src/wiring.ts";
import { planImport } from "../src/modules/duplicate-matching/index.ts";
import { applyTx } from "../src/modules/import-sessions/adapters/db/store.ts";
import {
  applyBatch,
  APPLY_ROWS_MAX,
  ApplyTooLarge,
  BatchStateErrorFor,
  type ApplyPorts,
} from "../src/modules/import-sessions/application/index.ts";
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

const applyingOf = async (space: Space, batchId: string) => {
  const res = await call(space, "GET", `/v1/import/batches/${batchId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().applying as boolean;
};

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

describe("IMP-04@PoC FR 7: an apply stuck «in progress» after a crash (#654)", () => {
  it("IMP-04@PoC FR 7: the batch read says «applying»; the daily recovery gives up a stuck apply that wrote nothing — the batch back in «розібрано», a late write of it refused", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const attemptId = randomUUID();
    await crashedAfterStart(space, batch.batchId, attemptId);
    expect(await applyingOf(space, batch.batchId)).toBe(true);

    // Not stuck yet: its request may still be on its way.
    expect(await recover(space, now + 60_000)).toBe(0);
    expect((await applicationOf(batch.batchId))?.in_progress).toBe(true);

    // The dead apply: settled by the recovery.
    expect(await recover(space, now + STUCK_AFTER_MS + 1)).toBe(1);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await applicationOf(batch.batchId)).toBeNull();
    expect(await applyingOf(space, batch.batchId)).toBe(false);

    // A write of the given-up attempt that comes after (its request was only slow) writes nothing.
    await expect(
      importedTransactions().write(
        space.householdId,
        {
          batchId: batch.batchId,
          attemptId,
          actorId: space.accountId,
          accountIds: [space.eur],
          fileIds: batch.fileIds,
        },
        async () => ({ import: 0 }),
      ),
    ).rejects.toBeInstanceOf(ImportWriteVoided);
    expect(await imported(space.householdId)).toEqual([]);

    // «Застосувати» again: a new attempt, the rows written once.
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      first: true,
      result: { counts: { import: 2 } },
      batch: { applying: false },
    });
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-04@PoC FR 7, AC10: a dead apply whose rows were written is finished by the daily recovery — the write's counts and the audit entry, nothing written twice", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const first = await apply(space, batch.batchId);
    expect(first.statusCode, first.body).toBe(200);
    // As if the process ended after step B, before the counts.
    await db.owner.query(
      `UPDATE import_sessions.batch_applications SET in_progress = true, result = '{"counts":{}}' WHERE batch_id = $1`,
      [batch.batchId],
    );
    const countEntries = async () =>
      (
        await db.owner.query<{ actor_id: string; changes: { field: string; after: string }[] }>(
          `SELECT actor_id, changes FROM audit.entries
            WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2`,
          [space.householdId, batch.batchId],
        )
      ).rows;
    const before = (await countEntries()).filter((r) =>
      r.changes.some((c) => c.field === "rows.import"),
    ).length;
    expect(await applyingOf(space, batch.batchId)).toBe(true);

    expect(await recover(space, now + STUCK_AFTER_MS + 1)).toBe(1);
    expect(await applicationOf(batch.batchId)).toMatchObject({
      in_progress: false,
      result: first.json().result,
    });
    expect(await stateOf(batch.batchId)).toBe("applied");
    expect(await imported(space.householdId)).toHaveLength(2);
    // The recovery's entry: by the person who applied, with the counts of the write.
    const counted = (await countEntries()).filter((r) =>
      r.changes.some((c) => c.field === "rows.import" && c.after === "2"),
    );
    expect(counted).toHaveLength(before + 1);
    expect(counted.map((r) => r.actor_id)).toEqual(counted.map(() => space.accountId));
    // Settled: the next run has nothing to do.
    expect(await recover(space, now + 2 * STUCK_AFTER_MS)).toBe(0);
  });

  it("IMP-04@PoC FR 7: the recovery is one of the scheduler's daily tasks", () => {
    const names = schedulerDailyTasks({ databases: db.databases, audit, spaces }).map((t) => t.name);
    expect(names).toContain("import-sessions.apply-recovery");
  });
});

describe("IMP-04@PoC FR 7: a refusal and a request that joined the same apply (#654)", () => {
  it("IMP-04@PoC FR 7: the first request refused while a joiner waits — the batch back in «розібрано», the joiner writes nothing (409), no server error", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g1 = gated();
    const first = outcome(
      applyBatch(
        deps,
        portsOf(space, { write: g1.wait, reached: g1.reached }),
        space.accountId,
        batch.batchId,
      ),
    );
    await g1.at;
    // The joiner: checked the apply «in progress», about to write with it.
    const g2 = gated();
    const joiner = outcome(
      applyBatch(
        deps,
        portsOf(space, { write: g2.wait, reached: g2.reached }),
        space.accountId,
        batch.batchId,
      ),
    );
    await g2.at;
    setStatus(space, "closed");
    g1.release();
    const one = await first;
    expect(one.ok).toBe(false);
    expect(!one.ok && one.e).toBeInstanceOf(ImportWriteRefused);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await applicationOf(batch.batchId)).toBeNull();

    setStatus(space, "active");
    g2.release();
    const two = await joiner;
    expect(two.ok).toBe(false);
    expect(!two.ok && two.e).toBeInstanceOf(BatchStateErrorFor);
    expect(await imported(space.householdId)).toEqual([]);
    expect(await stateOf(batch.batchId)).toBe("parsed");

    const again = await apply(space, batch.batchId);
    expect(again.statusCode, again.body).toBe(200);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-04@PoC FR 7: a refused joiner gives the apply up and puts the batch back where it was; the request it joined writes nothing", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g1 = gated();
    const first = outcome(
      applyBatch(
        deps,
        portsOf(space, { write: g1.wait, reached: g1.reached }),
        space.accountId,
        batch.batchId,
      ),
    );
    await g1.at;
    setStatus(space, "closed");
    const refused = await apply(space, batch.batchId);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe("ACCOUNT_CLOSED");
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await applyingOf(space, batch.batchId)).toBe(false);

    setStatus(space, "active");
    g1.release();
    const one = await first;
    expect(!one.ok && one.e).toBeInstanceOf(BatchStateErrorFor);
    expect(await imported(space.householdId)).toEqual([]);
    expect(await stateOf(batch.batchId)).toBe("parsed");
  });
});

describe("IMP-01@PoC FR 11: the apply's ceilings and locks (#654)", () => {
  it("IMP-01@PoC FR 11: a batch over the rows one apply writes — 422 IMPORT_PLAN_TOO_LARGE before anything is stored", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const many = (events: unknown[]) =>
      Array.from({ length: APPLY_ROWS_MAX + 1 }, (_, i) => ({ ...(events[0] as object), row: i + 1 }));
    await expect(
      applyBatch(deps, portsOf(space, { events: many }), space.accountId, batch.batchId),
    ).rejects.toBeInstanceOf(ApplyTooLarge);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await applicationOf(batch.batchId)).toBeNull();
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-01@PoC FR 11: more applies of a space at once than the write takes — 429 RATE_LIMITED, nothing written, the batch as it was", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const release = gated();
    const held: Promise<void>[] = [];
    const taken: Promise<void>[] = [];
    for (let slot = 0; slot < IMPORT_WAITERS_MAX; slot++) {
      let took!: () => void;
      taken.push(new Promise<void>((r) => (took = r)));
      held.push(
        db.databases.for("transactions").inHousehold(space.householdId, async (q) => {
          await q.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('transactions.import-slot:' || $1 || ':' || $2, 0))`,
            [space.householdId, String(slot)],
          );
          took();
          await release.wait;
        }),
      );
    }
    await Promise.all(taken);
    const res = await apply(space, batch.batchId);
    release.release();
    await Promise.all(held);
    expect(res.statusCode, res.body).toBe(429);
    expect(res.json().code).toBe("RATE_LIMITED");
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await applicationOf(batch.batchId)).toBeNull();
    expect(await imported(space.householdId)).toEqual([]);
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
  });

  it("IMP-01@PoC FR 11: the account's money lock is free while the batch is planned; the account closed meanwhile refuses the write under it, nothing written", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g = gated();
    const running = outcome(
      applyBatch(deps, portsOf(space, { plan: g.wait, reached: g.reached }), space.accountId, batch.batchId),
    );
    await g.at;
    // Another writer of the account (a manual transaction, a closing) takes the money lock at once.
    const started = Date.now();
    await db.databases
      .for("accounts")
      .inHousehold(space.householdId, (q) => lockAccounts(q, space.householdId, [space.eur]));
    expect(Date.now() - started).toBeLessThan(4_000);
    setStatus(space, "closed");
    g.release();
    const done = await running;
    expect(!done.ok && done.e instanceof ImportWriteRefused && done.e.issue).toBe("account-closed");
    expect(await imported(space.householdId)).toEqual([]);
    expect(await stateOf(batch.batchId)).toBe("parsed");
  });

  it("IMP-01@PoC FR 11: a wallet of the account replaced while the batch is planned — refused under the money lock, nothing written", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g = gated();
    const running = outcome(
      applyBatch(deps, portsOf(space, { plan: g.wait, reached: g.reached }), space.accountId, batch.batchId),
    );
    await g.at;
    const key = `${space.householdId}/${space.eur}`;
    const account = accountsOf.get(key)!;
    accountsOf.set(key, {
      ...account,
      subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
    });
    g.release();
    const done = await running;
    expect(!done.ok && done.e instanceof ImportWriteRefused && done.e.issue).toBe("account-changed");
    expect(await imported(space.householdId)).toEqual([]);
    expect(await stateOf(batch.batchId)).toBe("parsed");
  });
});

describe("IMP-04@PoC FR 4: the text planned is the text stored (#654)", () => {
  it("IMP-04@PoC FR 4: a bank description over 1 000 characters — the overlapping statement's rows are duplicates, never written twice", async () => {
    const space = await newSpace();
    const long = `Оплата ${"довгий опис ".repeat(100)}`;
    const statement = text([
      "Вхідний залишок:;1000.00 EUR",
      "Дата;Сума;Опис",
      `15.03.2026;500.00;${long}`,
      "20.03.2026;-60.00;Кава",
      "Кінцевий залишок:;1440.00 EUR",
    ]);
    const one = await parsedBatch(space, [{ name: "berezen.csv", bytes: statement }]);
    const a = await apply(space, one.batchId);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().result.counts).toMatchObject({ import: 2 });
    const stored = await imported(space.householdId);
    expect([...stored.find((r) => r.amount === "500")!.bank_description!]).toHaveLength(1000);

    const two = await parsedBatch(space, [
      { name: "berezen.tsv", bytes: Buffer.from(statement.toString("utf8").replaceAll(";", "\t")) },
    ]);
    const b = await apply(space, two.batchId);
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json().result.counts).toMatchObject({ import: 0, duplicate: 2, "possible-duplicate": 0 });
    expect(await imported(space.householdId)).toHaveLength(2);
  });
});

describe("IMP-05@PoC FR 3: the previous statement is one whose apply finished (#654)", () => {
  const previousOf = async (fileId: string) =>
    (
      await db.owner.query<{ previous_file_id: string | null }>(
        `SELECT previous_file_id FROM import_sessions.file_checks WHERE batch_file_id = $1`,
        [fileId],
      )
    ).rows[0]!.previous_file_id;

  it("IMP-05@PoC FR 3: an apply still «in progress» is not the previous statement of the account; once finished it is", async () => {
    const space = await newSpace();
    const one = await parsedBatch(space);
    await crashedAfterStart(space, one.batchId, randomUUID());
    const two = await parsedBatch(space, [{ name: "kviten.csv", bytes: CLEAN }]);
    expect(await previousOf(two.fileIds[0]!)).toBeNull();

    await db.owner.query(
      `UPDATE import_sessions.batch_applications SET in_progress = false WHERE batch_id = $1`,
      [one.batchId],
    );
    const three = await parsedBatch(space, [{ name: "traven.csv", bytes: CLEAN }]);
    expect(await previousOf(three.fileIds[0]!)).toBe(one.fileIds[0]);
  });
});
