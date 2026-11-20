import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { PLAN_EXISTING_MAX } from "../src/modules/duplicate-matching/index.ts";
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
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { deleteTransaction, applyHandOff } from "../src/modules/transactions/application/index.ts";
import { transactionsTx } from "../src/modules/transactions/adapters/index.ts";
import { transactionRows } from "../src/modules/transactions/adapters/queue/hand-off.ts";
import { transactionAudit } from "../src/modules/transactions/adapters/http/services.ts";
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

describe("IMP-01@PoC FR 11: «Застосувати» writes the batch's rows once", () => {
  it("IMP-01@PoC FR 11, AC4: nothing is written before the apply; then each row is one imported transaction in «До розбору» with the bank's text kept apart and masked", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await imported(space.householdId)).toEqual([]);

    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      batch: { id: batch.batchId, state: "applied" },
      result: { counts: { import: 2, duplicate: 0, "already-imported": 0, excluded: 0, files: 1 } },
      first: true,
    });
    const rows = await imported(space.householdId);
    expect(rows).toEqual([
      expect.objectContaining({
        amount: "500",
        source: "imported",
        import_batch_id: batch.batchId,
        import_file_id: batch.fileIds[0],
        import_row: 3,
        review: "queued",
        status: "posted",
      }),
      expect.objectContaining({
        amount: "-60",
        import_row: 4,
        // IMP-05 business rule: an IBAN in a bank's text keeps only its last 4 characters, in the books too.
        description: "Переказ на …4821",
        bank_description: "Переказ на …4821",
      }),
    ]);
    // ARC-04 FR 2: each transaction's journal event and audit entry go by its hand-off job.
    const { rows: jobs } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND name = 'transactions.hand-off'`,
      [space.householdId],
    );
    expect(jobs[0]!.n).toBe(2);
  });

  it("IMP-04@PoC AC9, IMP-01@PoC AC5: a second apply of an applied batch returns the stored result and writes nothing", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const first = await apply(space, batch.batchId);
    expect(first.statusCode, first.body).toBe(200);
    const again = await apply(space, batch.batchId);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ first: false, result: first.json().result });
    expect(again.json().appliedAt).toBe(first.json().appliedAt);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-04@PoC AC10: the audit entry of the apply holds the engine's version and the counts of rows", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
    const { rows } = await db.owner.query<{ changes: { field: string; after: string | null }[] }>(
      `SELECT changes FROM audit.entries
        WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2`,
      [space.householdId, batch.batchId],
    );
    expect(rows.flatMap((r) => r.changes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "state", before: "parsed", after: "applied" }),
        expect.objectContaining({ field: "engine", after: "1" }),
        expect.objectContaining({ field: "rows.import", after: "2" }),
        expect.objectContaining({ field: "rows.duplicate", after: "0" }),
      ]),
    );
  });
});

describe("IMP-05@PoC FR 6: «знак картки» of a credit card (owner decision 2026-11-20 item 6)", () => {
  /** The space with an EUR credit card as the account its files are parsed for. */
  async function cardSpace(): Promise<Space> {
    const space = await newSpace();
    const card = randomUUID();
    accountsOf.set(`${space.householdId}/${card}`, {
      accountId: card,
      kind: "credit-card",
      status: "active",
      subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
    });
    return { ...space, eur: card };
  }

  it("IMP-05@PoC FR 6, IMP-01@PoC FR 11: an open «знак картки» refuses the apply through readiness — 409 IMPORT_NOT_READY «flags», nothing written", async () => {
    const space = await cardSpace();
    // Purchases printed positive: the printed chain holds, so it confirms no debt basis.
    const batch = await parsedBatch(space, [
      {
        name: "kartka.csv",
        bytes: text([
          "Вхідний залишок:;100,00",
          "Дата;Сума;Залишок;Опис",
          "15.03.2026;50,00;150,00;Магазин",
          "20.03.2026;20,00;170,00;Кафе",
          "25.03.2026;-30,00;140,00;Погашення",
          "Кінцевий залишок:;140,00",
        ]),
      },
    ]);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: "IMPORT_NOT_READY", errors: [{ issue: "flags" }] });
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-05@PoC FR 6, IMP-01@PoC FR 11: a debt basis the chain confirms is applied — amounts as printed, the balance after each row in the inverted (debt) basis readiness showed", async () => {
    const space = await cardSpace();
    const batch = await parsedBatch(space, [
      {
        name: "kartka.csv",
        bytes: text([
          "Вхідний залишок:;100,00",
          "Дата;Сума;Залишок;Опис",
          "15.03.2026;-50,00;150,00;Магазин",
          "20.03.2026;-20,00;170,00;Кафе",
          "25.03.2026;30,00;140,00;Погашення",
          "Кінцевий залишок:;140,00",
        ]),
      },
    ]);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = await db.owner.query<{ amount: string; balance_after: string }>(
      `SELECT trim_scale(amount)::text AS amount, trim_scale(balance_after)::text AS balance_after
         FROM transactions.transactions WHERE household_id = $1 ORDER BY import_row`,
      [space.householdId],
    );
    expect(rows).toEqual([
      { amount: "-50", balance_after: "-150" },
      { amount: "-20", balance_after: "-170" },
      { amount: "30", balance_after: "-140" },
    ]);
  });
});

describe("IMP-04@PoC FR 9: an imported transaction is hidden, never deleted (review #647 B1)", () => {
  /** The live journal entries of the space from module transactions (not reversed). */
  async function liveEntries(householdId: string): Promise<number> {
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger.entries e
        WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                            AND r.reverses_entry_id = e.id)`,
      [householdId],
    );
    return rows[0]!.n;
  }

  it("FIN-03@PoC AC9, IMP-04@PoC FR 9: «Видалити» of an imported row hides it — the row and its journal entry stay, and the same statement applied again adds nothing", async () => {
    const space = await newSpace();
    // The account's journal account exists (as module accounts opens it), so the rows' entries are posted.
    const sub = accountsOf.get(`${space.householdId}/${space.eur}`)!.subaccounts[0]!;
    await createLedger(db.databases.for("ledger")).openAccount(
      space.householdId,
      { module: "accounts", id: sub.subaccountId },
      { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
    );
    const batch = await parsedBatch(space);
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
    const before = await liveEntries(space.householdId);
    expect(before).toBe(2);
    const { rows: ids } = await db.owner.query<{ id: string }>(
      `SELECT id FROM transactions.transactions WHERE household_id = $1 AND import_row = 3`,
      [space.householdId],
    );
    const ledger = createLedger(db.databases.for("ledger"));
    const deps = {
      accounts,
      ledger,
      audit: transactionAudit(audit),
      newId: randomUUID,
      today: () => "2026-11-20",
      statesEnabled: async () => true,
      duplicates: null,
    };
    const caller = { householdId: space.householdId, accountId: space.accountId };
    const result = await db.databases
      .for("transactions")
      .inHousehold(space.householdId, (q) => deleteTransaction(deps, transactionsTx(q), caller, ids[0]!.id));
    expect(result).toMatchObject({ kind: "ok", shown: [] });
    if (result.kind !== "ok" || result.handOff === null) throw new Error("expected a hide hand-off");
    expect(result.handOff.action).toBe("hide");
    await applyHandOff(
      deps,
      transactionRows((work) => db.databases.for("transactions").inHousehold(space.householdId, work)),
      space.householdId,
      result.handOff,
    );
    const { rows } = await db.owner.query<{ hidden: boolean }>(
      `SELECT hidden FROM transactions.transactions WHERE household_id = $1 ORDER BY import_row`,
      [space.householdId],
    );
    expect(rows).toEqual([{ hidden: true }, { hidden: false }]);
    expect(await liveEntries(space.householdId)).toBe(before);
    // «Видалити» again: already hidden — nothing changes.
    const again = await db.databases
      .for("transactions")
      .inHousehold(space.householdId, (q) => deleteTransaction(deps, transactionsTx(q), caller, ids[0]!.id));
    expect(again).toEqual({ kind: "ok", handOff: null, shown: [] });
    // The same statement in a new batch finds the hidden row: nothing new is written.
    const next = await parsedBatch(space);
    const res = await apply(space, next.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ import: 0 });
    expect(await imported(space.householdId)).toHaveLength(2);
    const { rows: after } = await db.owner.query<{ hidden: boolean }>(
      `SELECT hidden FROM transactions.transactions WHERE household_id = $1 ORDER BY import_batch_id = $2, import_row`,
      [space.householdId, batch.batchId],
    );
    expect(after.filter((r) => r.hidden)).toHaveLength(1);
  });
});

describe("IMP-04@PoC FR 7: two requests at once, and a retry after a crash", () => {
  it("IMP-04@PoC FR 7: two applies of one batch at once write each row once and return one result", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const [a, b] = await Promise.all([apply(space, batch.batchId), apply(space, batch.batchId)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    expect([a.json().first, b.json().first].sort()).toEqual([false, true]);
    expect(a.json().result).toEqual(b.json().result);
    expect(await imported(space.householdId)).toHaveLength(2);
    const again = await apply(space, batch.batchId);
    expect(again.json()).toMatchObject({ first: false, result: { counts: { import: 2 } } });
  });

  it("IMP-04@PoC FR 4: two batches of one account applied at once — the second plans after the first is written, so its rows are duplicates", async () => {
    const space = await newSpace();
    const one = await parsedBatch(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    // The same rows in another format (TSV): another file by content, the same operations.
    const two = await parsedBatch(space, [
      { name: "berezen.tsv", bytes: Buffer.from(CLEAN.toString("utf8").replaceAll(";", "\t")) },
    ]);
    const [a, b] = await Promise.all([apply(space, one.batchId), apply(space, two.batchId)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    const counts = [a.json().result.counts, b.json().result.counts];
    expect(counts.map((c) => c.import).sort()).toEqual([0, 2]);
    expect(counts.map((c) => c.duplicate).sort()).toEqual([0, 2]);
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-04@PoC FR 4: two copies of one statement in one batch — the second file is planned after the first is written", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [
      { name: "berezen.csv", bytes: CLEAN },
      { name: "berezen.tsv", bytes: Buffer.from(CLEAN.toString("utf8").replaceAll(";", "\t")) },
    ]);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ import: 2, duplicate: 2, files: 2 });
    expect(await imported(space.householdId)).toHaveLength(2);
  });

  it("IMP-04@PoC FR 7: a crash after the result was stored «in progress», before the write — the next apply writes the rows once and finishes it", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    // Step A committed, then the process ended: the batch «застосовано», its result «in progress», nothing written.
    await db.owner.query(
      `INSERT INTO import_sessions.batch_applications
         (household_id, batch_id, result, applied_by, applied_at, in_progress, from_state)
       VALUES ($1, $2, '{"counts":{}}', $3, now(), true, 'parsed')`,
      [space.householdId, batch.batchId, space.accountId],
    );
    await db.owner.query(`UPDATE import_sessions.batches SET state = 'applied' WHERE id = $1`, [
      batch.batchId,
    ]);
    // The batch is closed to every other step meanwhile.
    expect((await call(space, "POST", `/v1/import/batches/${batch.batchId}/cancel`)).statusCode).toBe(409);

    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ first: true, result: { counts: { import: 2 } } });
    expect(await imported(space.householdId)).toHaveLength(2);
    expect((await apply(space, batch.batchId)).json()).toMatchObject({ first: false });
  });

  it("IMP-04@PoC FR 7: a crash after the rows were written, before the result's counts — the next apply writes nothing and stores the counts of the write", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const first = await apply(space, batch.batchId);
    expect(first.statusCode, first.body).toBe(200);
    // As if step C never ran: the result still «in progress».
    await db.owner.query(
      `UPDATE import_sessions.batch_applications SET in_progress = true, result = '{"counts":{}}' WHERE batch_id = $1`,
      [batch.batchId],
    );
    const retried = await apply(space, batch.batchId);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json().result).toEqual(first.json().result);
    expect(await imported(space.householdId)).toHaveLength(2);
    // The unique key on the transactions' side refuses a second write of the same row outright.
    const row = (await imported(space.householdId))[0]!;
    await expect(
      db.owner.query(
        `INSERT INTO transactions.transactions
           (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, status, source,
            import_batch_id, import_file_id, import_row)
         VALUES ($1, gen_random_uuid(), $2, $2, -1, 'EUR', '2026-03-01', 'posted', 'imported', $3, $4, $5)`,
        [space.householdId, space.eur, row.import_batch_id, row.import_file_id, row.import_row],
      ),
    ).rejects.toThrow(/transactions_import_row/u);
  });
});

describe("IMP-01@PoC FR 11: refusals — nothing written, the batch as it was", () => {
  it("IMP-01@PoC AC11: a batch of another space is «not found» and nothing is written in either space", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const batch = await parsedBatch(other);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(404);
    expect(leakText(res.body)).not.toContain("500.00");
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await imported(other.householdId)).toEqual([]);
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-01@PoC FR 11: a scoped member (who may not see the account) is refused; nothing is written", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const res = await apply(space, batch.batchId, true);
    // The role's write is refused before the route (403); a scoped one with it is «not found» (the route's owner check).
    expect([403, 404], res.body).toContain(res.statusCode);
    expect(await stateOf(batch.batchId)).toBe("parsed");
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-01@PoC FR 11: a file without an account is never applied — 409 IMPORT_NOT_READY «confirm-account» (#637 item 1)", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, undefined, false);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({
      code: "IMPORT_NOT_READY",
      errors: [{ in: "path", path: "batchId", issue: "confirm-account" }],
    });
    expect(await stateOf(batch.batchId)).toBe("needs-review");
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-01@PoC FR 11: a row with more decimals than the currency has is refused by its number, never rounded; excluded, the rest is applied (#637 item 1)", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [
      {
        name: "kviten.csv",
        bytes: text([
          "Вхідний залишок:;1000.00 EUR",
          "Дата;Сума;Опис",
          "15.04.2026;-10.5555;Синтетика",
          "20.04.2026;-3.00;Кава",
          "Кінцевий залишок:;986.4445 EUR",
        ]),
      },
    ]);
    const before = await stateOf(batch.batchId);
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({
      code: "IMPORT_ROWS_REFUSED",
      errors: [{ path: `files[${batch.fileIds[0]}].rows[3]`, issue: "too-precise" }],
    });
    expect(await stateOf(batch.batchId)).toBe(before);
    expect(await imported(space.householdId)).toEqual([]);

    const decided = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "row", fileId: batch.fileIds[0], row: 3, action: "exclude" }],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const ok = await apply(space, batch.batchId);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().result.counts).toMatchObject({ import: 1, excluded: 1 });
    expect((await imported(space.householdId)).map((r) => r.amount)).toEqual(["-3"]);
  });

  it("IMP-01@PoC FR 11: a closed account refuses the apply — the batch goes back to its state, its result removed, nothing written", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    const key = `${space.householdId}/${space.eur}`;
    accountsOf.set(key, { ...accountsOf.get(key)!, status: "closed" });
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_CLOSED");
    expect(await stateOf(batch.batchId)).toBe("parsed");
    const { rows } = await db.owner.query(
      `SELECT 1 FROM import_sessions.batch_applications WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(rows).toEqual([]);
    expect(await imported(space.householdId)).toEqual([]);
  });

  it("IMP-04@PoC FR 1: an account with more transactions in the batch's dates than one plan reads — 422 IMPORT_PLAN_TOO_LARGE, nothing written (#637 comment item 8)", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space);
    await db.owner.query(
      `INSERT INTO transactions.transactions
         (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, status, source)
       SELECT $1, gen_random_uuid(), $2, $2, -1, 'EUR', DATE '2026-03-15' + (i % 5), 'posted', 'manual'
         FROM generate_series(1, $3::int) AS i`,
      [space.householdId, space.eur, PLAN_EXISTING_MAX + 1],
    );
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe("IMPORT_PLAN_TOO_LARGE");
    expect(await stateOf(batch.batchId)).toBe("parsed");
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1 AND source = 'imported'`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
  });
});
