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
import { createImportedTransactions } from "../src/modules/transactions/index.ts";
import { planImport } from "../src/modules/duplicate-matching/index.ts";
import { applyTx } from "../src/modules/import-sessions/adapters/db/store.ts";
import { applyBatch, type ApplyPorts } from "../src/modules/import-sessions/application/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * «Застосувати» (IMP-01@PoC FR 11; IMP-04@PoC FR 3, FR 4, FR 7, AC9, AC10; #637) on a real PostgreSQL through the real
 * API, the real parse worker and module transactions: nothing is written before the apply; the apply writes each row
 * once (batch, file, row) under the import lock of the account — also for two applies of one batch, or two batches of
 * one account, at once; a retry after a crash goes on where it stopped and writes nothing twice; another space and a
 * scoped member are «not found». The accounts module is the test's port (an EUR account). Synthetic data only; the
 * clock is the test's.
 */
const WEB = "http://localhost:5173";
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
  gate: { open?: Promise<void>; write?: Promise<void>; reached?: () => void },
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
      return keys.openBytes(space.householdId, purpose, sealed);
    },
    write: async (input, plan) => {
      if (gate.write) {
        gate.reached?.();
        await gate.write;
      }
      return transactions.write(space.householdId, input, plan);
    },
    settle: (input) => transactions.settle(space.householdId, input),
    plan: (planDeps, request) => planImport(planDeps, space.householdId, request),
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

describe("sec647: an apply that joins another one writes what that one checked", () => {
  it("IMP-01@PoC FR 11, IMP-05@PoC FR 11: a request whose checks are older than a decision never writes the row that decision excluded", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    // Request 1 has read the batch and its decisions (both rows to write) and is opening the sealed rows.
    const g1 = gated();
    const stale = applyBatch(
      deps,
      portsOf(space, { open: g1.wait, reached: g1.reached }),
      space.accountId,
      batch.batchId,
    ).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await g1.at;
    // The person excludes the row of -60.00 and applies again (request 2): checked with the decision, stored
    // «in progress», about to write.
    const decided = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "row", fileId: batch.fileIds[0], row: 4, action: "exclude" }],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const g2 = gated();
    const fresh = applyBatch(
      deps,
      portsOf(space, { write: g2.wait, reached: g2.reached }),
      space.accountId,
      batch.batchId,
    );
    await g2.at;
    // Request 1 goes on: it must not write its older reading of the batch.
    g1.release();
    const first = await stale;
    g2.release();
    const second = await fresh;
    expect((await imported(space.householdId)).map((r) => r.amount)).toEqual(["500"]);
    expect(second.result.application.result.counts).toMatchObject({ import: 1, excluded: 1 });
    expect(first.ok).toBe(false);
  });

  it("IMP-04@PoC FR 7: a request that joins an apply of the same checks still gets its result (the guard refuses only older checks)", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g1 = gated();
    const joiner = applyBatch(
      deps,
      portsOf(space, { open: g1.wait, reached: g1.reached }),
      space.accountId,
      batch.batchId,
    );
    await g1.at;
    const g2 = gated();
    const starter = applyBatch(
      deps,
      portsOf(space, { write: g2.wait, reached: g2.reached }),
      space.accountId,
      batch.batchId,
    );
    await g2.at;
    g1.release();
    const a = await joiner;
    g2.release();
    const b = await starter;
    expect(a.result.application.result.counts).toMatchObject({ import: 2 });
    expect(b.result.application.result.counts).toEqual(a.result.application.result.counts);
    expect(await imported(space.householdId)).toHaveLength(2);
  });
});

describe("sec647: the gate, the version and the account of the apply", () => {
  const BARE = text(["Дата;Сума;Опис", "15.04.2026;-1.00;Синтетика", "20.04.2026;-3.00;Кава"]);

  it("IMP-05@PoC FR 11: a batch with a flag not confirmed is refused (409 IMPORT_NOT_READY «flags»), nothing written; confirmed — applied", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [{ name: "bare.csv", bytes: BARE }]);
    expect(await stateOf(batch.batchId)).toBe("needs-review");
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: "IMPORT_NOT_READY", errors: [{ issue: "flags" }] });
    expect(await stateOf(batch.batchId)).toBe("needs-review");
    expect(await imported(space.householdId)).toEqual([]);
    const decided = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "flag", fileId: batch.fileIds[0], code: "balance-not-checked" }],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-01@PoC FR 11: a decision between an apply's checks and its start refuses that apply (the version moved); nothing written, the batch as it was", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g = gated();
    const stale = applyBatch(
      deps,
      portsOf(space, { open: g.wait, reached: g.reached }),
      space.accountId,
      batch.batchId,
    ).then(
      () => "applied",
      (e: Error) => e.name,
    );
    await g.at;
    const decided = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "row", fileId: batch.fileIds[0], row: 4, action: "exclude" }],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    g.release();
    expect(await stale).toMatch(/^BatchState/u);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-01@PoC AC11: a file that names an account of another space is refused with no data of it; nothing written in either space, the batch as it was", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const batch = await parsedBatch(space);
    await db.owner.query(`UPDATE import_sessions.file_checks SET account_id = $2 WHERE household_id = $1`, [
      space.householdId,
      other.eur,
    ]);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({
      code: "IMPORT_ROWS_REFUSED",
      errors: [{ path: "batchId", issue: "account" }],
    });
    expect(leakText(res.body)).not.toContain(other.eur);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await imported(other.householdId)).toEqual([]);
    expect(await imported(space.householdId)).toEqual([]);
    const { rows } = await db.owner.query(
      `SELECT 1 FROM transactions.import_writes WHERE household_id IN ($1, $2)`,
      [space.householdId, other.eur],
    );
    expect(rows).toEqual([]);
  });

  it("IMP-01@PoC FR 11: the apply writes under the account's money lock — while another change of the account holds it, nothing is written; then the apply goes on", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const g = gated();
    // Another change of the account (module accounts' own transaction) holds its money lock.
    const holder = db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('accounts.money:' || $1 || ':' || $2, 0))`,
        [space.householdId, space.eur],
      );
      g.reached();
      await g.wait;
    });
    await g.at;
    const pending = apply(space, batch.batchId).then((r) => r.statusCode);
    const early = await Promise.race([
      pending,
      new Promise<string>((r) => setTimeout(() => r("waiting"), 1500)),
    ]);
    expect(early).toBe("waiting");
    expect(await imported(space.householdId)).toEqual([]);
    g.release();
    await holder;
    expect(await pending).toBe(200);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("NFR-12@PoC FR 3, П-5: the write record of a batch is the space's own — forced row security, unseen from another space", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const batch = await parsedBatch(space);
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'transactions' AND c.relname = 'import_writes'`,
    );
    expect(rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const seen = (household: string) =>
      db.databases
        .for("transactions")
        .inHousehold(
          household,
          async (q) => (await q.query(`SELECT count(*)::int AS n FROM import_writes`)).rows[0]!.n,
        );
    expect(await seen(other.householdId)).toBe(0);
    expect(await seen(space.householdId)).toBe(1);
  });
});
