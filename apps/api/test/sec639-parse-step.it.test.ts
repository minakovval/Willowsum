import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser, type StatementChecks } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  createImportRecipesReader,
  createImportRecipesServices,
} from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
  PARSE_FILE_JOB,
  PARSE_FILES_PER_HOUR,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import {
  createImportSessionsCleanup,
  createImportSessionsReview,
} from "../src/modules/import-sessions/index.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #639 (the parse step of import batches; IMP-01@PoC, ARC-06@PoC FR 4, #624) on a
 * real PostgreSQL through the real API and the real worker queue: the sealed rows are bound to their file; the hourly
 * ceiling holds for requests made at once; a file whose answer does not fit the stored ceiling is refused, not retried;
 * a job run again or queued in another space changes nothing; the rows of another batch or space are not found; the
 * rows go with their batch. Every file, name and number is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// Synthetic IBANs, built so no real-looking literal sits in the source.
const OTHER_IBAN = ["UA", "00", "111111", "0000000", "222222", "334821"].join("");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const flags = fakeFlags();
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => {
    const found = accountsOf.get(`${householdId}/${accountId}`);
    return found ?? null;
  },
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  /** The space's EUR account (the accounts port). */
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

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  options: { scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({
        userId: space.accountId,
        householdId: space.householdId,
        ...(options.scoped ? { role: "viewer", scoped: true } : {}),
      }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** The statement 1 000,00 → 1440.00 EUR whose figures agree: nothing to review with its account. */
const CLEAN = text([
  "Вхідний залишок:;1000.00 EUR",
  "Дата;Сума;Опис",
  "15.03.2026;500.00;Зарплата ТОВ «Вигадка»",
  `20.03.2026;-60.00;Переказ на ${OTHER_IBAN}`,
  "Кінцевий залишок:;1440.00 EUR",
]);

/** A batch with the files uploaded; returns its id and the batch files' ids in order. */
async function batchWith(
  space: Space,
  parts: readonly { name: string; bytes: Buffer; type?: string }[],
): Promise<{ batchId: string; fileIds: string[] }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const body = Buffer.concat([
    ...parts.map((p) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\nContent-Type: ${p.type ?? "text/csv"}\r\n\r\n`,
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

const parse = (space: Space, batchId: string, body: unknown = {}) =>
  call(space, "POST", `/v1/import/batches/${batchId}/parse`, body);
const view = (space: Space, batchId: string) => call(space, "GET", `/v1/import/batches/${batchId}/parse`);

/** Runs the space's queue until nothing is due: the parse jobs, then the audit hand-offs they queued. */
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

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await setupRealModules(6);
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
        flags,
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: {
            recipes: createImportRecipesReader(db.databases.for("import-recipes")),
            accounts,
            keys,
          },
        }),
        importRecipes: createImportRecipesServices({ keys, audit, clock, newId: randomUUID }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

const rowsUrl = (batchId: string, fileId: string, query = "") =>
  `/v1/import/batches/${batchId}/files/${fileId}/rows${query}`;
/** A second statement, told from CLEAN by its one row. */
const SECOND = text([
  "Вхідний залишок:;10.00 EUR",
  "Дата;Сума;Опис",
  "16.03.2026;7.00;Подарунок другого файлу",
  "Кінцевий залишок:;17.00 EUR",
]);
const parseJobs = (householdId: string) =>
  count("import_sessions.jobs WHERE household_id = $1 AND name = $2", householdId, PARSE_FILE_JOB.name);

async function parsedBatch(space: Space, parts: readonly { name: string; bytes: Buffer }[]) {
  const batch = await batchWith(space, parts);
  const started = await parse(space, batch.batchId, {
    files: batch.fileIds.map((fileId) => ({ fileId, accountId: space.eur })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return batch;
}

describe("ARC-06@PoC FR 4: the sealed rows open only as their own file's", () => {
  it("ARC-06@PoC FR 4: the sealed rows of one file put in another file's place (with their parse id) do not open — never another file's rows", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [
      { name: "a.csv", bytes: CLEAN },
      { name: "b.csv", bytes: SECOND },
    ]);
    // What a writer of the table can do: the two files' sealed rows change places, each with its parse id.
    await db.owner.query(
      `UPDATE import_sessions.file_parses p SET parse_id = o.parse_id, rows_sealed = o.rows_sealed
         FROM (SELECT batch_file_id, parse_id, rows_sealed FROM import_sessions.file_parses WHERE batch_id = $1) o
        WHERE p.batch_id = $1 AND o.batch_file_id <> p.batch_file_id`,
      [batch.batchId],
    );
    const res = await call(space, "GET", rowsUrl(batch.batchId, batch.fileIds[0]!));
    expect(res.statusCode, res.body).toBe(500);
    expect(leakText(res.body)).not.toContain("другого");
  });

  it("ARC-06@PoC FR 4: the sealed rows of another space do not open, and the answer holds nothing of them", async () => {
    const one = await newSpace();
    const two = await newSpace();
    const a = await parsedBatch(one, [{ name: "a.csv", bytes: CLEAN }]);
    const b = await parsedBatch(two, [{ name: "b.csv", bytes: SECOND }]);
    await db.owner.query(
      `UPDATE import_sessions.file_parses p SET parse_id = o.parse_id, rows_sealed = o.rows_sealed
         FROM (SELECT parse_id, rows_sealed FROM import_sessions.file_parses WHERE batch_id = $1) o
        WHERE p.batch_id = $2`,
      [a.batchId, b.batchId],
    );
    const res = await call(two, "GET", rowsUrl(b.batchId, b.fileIds[0]!));
    expect(res.statusCode, res.body).toBe(500);
    expect(leakText(res.body)).not.toContain("Зарплата");
    expect(leakText(res.body)).not.toContain("500.00");
  });
});

describe("IMP-01@PoC «Права доступу»: the rows of a file are the batch's and the space's", () => {
  it("IMP-01@PoC AC7: a file id of another batch or another space is not found; a scoped member sees no parse; the page is bounded", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const b1 = await parsedBatch(owner, [{ name: "a.csv", bytes: CLEAN }]);
    const b2 = await parsedBatch(owner, [{ name: "b.csv", bytes: SECOND }]);
    const bs = await parsedBatch(stranger, [{ name: "b.csv", bytes: SECOND }]);
    const status = async (s: Space, url: string, options = {}) =>
      (await call(s, "GET", url, undefined, options)).statusCode;
    // The space's own other batch: its file is not this batch's.
    const other = await call(owner, "GET", rowsUrl(b1.batchId, b2.fileIds[0]!));
    expect(other.statusCode).toBe(404);
    expect(leakText(other.body)).not.toContain("другого");
    expect(await status(owner, rowsUrl(b1.batchId, bs.fileIds[0]!))).toBe(404);
    expect(await status(owner, rowsUrl(bs.batchId, bs.fileIds[0]!))).toBe(404);
    expect(await status(stranger, rowsUrl(b1.batchId, b1.fileIds[0]!))).toBe(404);
    expect(await status(owner, `/v1/import/batches/${b1.batchId}/parse`, { scoped: true })).toBe(404);
    expect(await status(owner, rowsUrl(b1.batchId, b1.fileIds[0]!), { scoped: true })).toBe(404);
    const cursor = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
    for (const query of [
      "?limit=0",
      "?limit=-1",
      "?limit=100000",
      "?limit=1.5",
      "?cursor=zzz",
      `?cursor=${cursor({ r: -1 })}`,
      `?cursor=${cursor({ r: "1" })}`,
      `?cursor=${cursor({ r: 1.5 })}`,
    ])
      expect(await status(owner, rowsUrl(b1.batchId, b1.fileIds[0]!, query)), query).toBe(400);
  });
});

describe("#624: the hourly ceiling of parse requests", () => {
  it("#624: «Розібрати» of several batches of one space at once does not pass the ceiling; another space is not counted", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const batches = [];
    for (let i = 0; i < 8; i++) batches.push(await batchWith(space, [{ name: `f${i}.csv`, bytes: CLEAN }]));
    const theirs = await batchWith(other, [{ name: "o.csv", bytes: CLEAN }]);
    await db.owner.query(
      `INSERT INTO import_sessions.jobs (household_id, name, dedupe_key, payload, heavy, state)
       SELECT $1, $2, 'filler:' || g, '{}', true, 'done' FROM generate_series(1, $3::int) g`,
      [space.householdId, PARSE_FILE_JOB.name, PARSE_FILES_PER_HOUR - 1],
    );
    const all = await Promise.all(batches.map((b) => parse(space, b.batchId)));
    expect(all.map((r) => r.statusCode).sort()).toEqual([200, 429, 429, 429, 429, 429, 429, 429]);
    expect(await parseJobs(space.householdId)).toBe(PARSE_FILES_PER_HOUR);
    expect((await parse(other, theirs.batchId)).statusCode).toBe(200);
  });
});

describe("IMP-01@PoC FR 13: a file whose parse does not fit is refused, never retried for good", () => {
  it("IMP-01@PoC FR 13, IMP-19@PoC FR 5: an answer under the worker's 16M characters and over the stored 32 MiB as UTF-8 fails the file with a code; the batch leaves «в обробці» and the job is done", async () => {
    const space = await newSpace();
    // windows-1251: one byte a character; «€» is three bytes as UTF-8, so 12.4M characters seal as 37 MiB.
    const cp1251 = (t: string) =>
      Buffer.from(
        [...t].map((ch) => {
          const c = ch.charCodeAt(0);
          return c < 128 ? c : c - 0x410 + 0xc0;
        }),
      );
    const row = Buffer.concat([cp1251("15.03.2026;1.00;Оплата "), Buffer.alloc(1900, 0x88), cp1251("\r\n")]);
    const bytes = Buffer.concat([cp1251("Дата;Сума;Опис\r\n"), ...Array.from({ length: 6500 }, () => row)]);
    const batch = await batchWith(space, [{ name: "a.csv", bytes }]);
    expect((await parse(space, batch.batchId)).statusCode).toBe(200);
    await work(space.householdId);
    const body = (await view(space, batch.batchId)).json();
    expect(body.files[0]).toMatchObject({ state: "failed", refusal: { code: "CORRUPTED" } });
    expect(body.batch.state).toBe("failed");
    const { rows } = await db.owner.query<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM import_sessions.jobs WHERE household_id = $1 AND name = $2`,
      [space.householdId, PARSE_FILE_JOB.name],
    );
    expect(rows).toEqual([{ state: "done", attempts: 1 }]);
  }, 120_000);
});

describe("ARC-04@PoC FR 3: a parse job run again, or queued in another space, changes nothing", () => {
  it("ARC-04@PoC FR 3: a job with this space's ids in another space's queue parses nothing; the same jobs run twice leave one parse, one check and the same audit per file", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const batch = await batchWith(owner, [
      { name: "a.csv", bytes: CLEAN },
      { name: "b.csv", bytes: SECOND },
    ]);
    await parse(owner, batch.batchId, {
      files: batch.fileIds.map((fileId) => ({ fileId, accountId: owner.eur })),
    });
    await db.owner.query(
      `INSERT INTO import_sessions.jobs (household_id, name, dedupe_key, payload, heavy)
       SELECT $1, name, 'forged:' || dedupe_key, payload, true FROM import_sessions.jobs
        WHERE household_id = $2 AND name = $3`,
      [stranger.householdId, owner.householdId, PARSE_FILE_JOB.name],
    );
    await work(stranger.householdId);
    expect((await view(owner, batch.batchId)).json().progress).toEqual({ pending: 2, parsed: 0, failed: 0 });
    expect(await count("import_sessions.file_parses WHERE household_id = $1", stranger.householdId)).toBe(0);
    expect(await count("import_sessions.file_checks WHERE household_id = $1", stranger.householdId)).toBe(0);

    await work(owner.householdId);
    const stored = () =>
      db.owner.query(
        `SELECT batch_file_id, parse_id, md5(rows_sealed) AS sealed, row_count FROM import_sessions.file_parses
          WHERE batch_id = $1 ORDER BY 1`,
        [batch.batchId],
      );
    const before = (await stored()).rows;
    const audited = await count("audit.entries WHERE household_id = $1", owner.householdId);
    await db.owner.query(
      `UPDATE import_sessions.jobs SET state = 'queued', attempts = 0, finished_at = NULL
        WHERE household_id = $1 AND name = $2`,
      [owner.householdId, PARSE_FILE_JOB.name],
    );
    await work(owner.householdId);
    expect((await stored()).rows).toEqual(before);
    expect(await count("import_sessions.file_checks WHERE batch_id = $1", batch.batchId)).toBe(2);
    expect(await count("audit.entries WHERE household_id = $1", owner.householdId)).toBe(audited);
    const first = (await call(owner, "GET", rowsUrl(batch.batchId, batch.fileIds[0]!))).json().items;
    const second = (await call(owner, "GET", rowsUrl(batch.batchId, batch.fileIds[1]!))).json().items;
    expect(first).toHaveLength(2);
    expect(second.map((r: { description: string }) => r.description)).toEqual(["Подарунок другого файлу"]);
  });

  it("IMP-01@PoC FR 21: the job of an older «Розібрати» parses nothing of the new one; a parsed file's job run again while the batch is «в обробці» leaves its sealed rows as they are", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [
      { name: "a.csv", bytes: CLEAN },
      { name: "b.csv", bytes: SECOND },
    ]);
    const setJobs = (state: string, where: string, ...values: unknown[]) =>
      db.owner.query(
        `UPDATE import_sessions.jobs SET state = '${state}', attempts = 0, finished_at = ${state === "done" ? "now()" : "NULL"}
          WHERE household_id = $1 AND name = $2 AND ${where}`,
        [space.householdId, PARSE_FILE_JOB.name, ...values],
      );
    // «Розібрати» again: the new jobs are held back, the first request's jobs come back to the queue.
    const { rows: old } = await db.owner.query<{ id: string }>(
      `SELECT id::text AS id FROM import_sessions.jobs WHERE household_id = $1 AND name = $2`,
      [space.householdId, PARSE_FILE_JOB.name],
    );
    const again = await parse(space, batch.batchId, {
      files: batch.fileIds.map((fileId) => ({ fileId, accountId: space.eur })),
    });
    expect(again.statusCode, again.body).toBe(200);
    const oldIds = old.map((r) => r.id);
    await setJobs("done", "NOT (id::text = ANY($3))", oldIds);
    await setJobs("queued", "id::text = ANY($3)", oldIds);
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().progress).toEqual({ pending: 2, parsed: 0, failed: 0 });

    // The first file's own job runs; the second stays pending, so the batch is still «в обробці».
    const first = `parse:${batch.fileIds[0]}:%`;
    await setJobs("queued", "NOT (id::text = ANY($3)) AND dedupe_key LIKE $4", oldIds, first);
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().progress).toEqual({ pending: 1, parsed: 1, failed: 0 });
    const sealed = async () =>
      (
        await db.owner.query<{ h: string }>(
          `SELECT md5(rows_sealed) AS h FROM import_sessions.file_parses WHERE batch_file_id = $1`,
          [batch.fileIds[0]],
        )
      ).rows[0]!.h;
    const before = await sealed();
    await setJobs("queued", "NOT (id::text = ANY($3)) AND dedupe_key LIKE $4", oldIds, first);
    await work(space.householdId);
    expect(await sealed()).toBe(before);
    expect(await count("import_sessions.file_checks WHERE batch_id = $1", batch.batchId)).toBe(1);
  });

  it("ADR-0015: the queue and the stored checks hold ids, states and masked values — nothing of the rows", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [{ name: "a.csv", bytes: CLEAN }]);
    const { rows } = await db.owner.query<{ t: string }>(
      `SELECT payload::text AS t FROM import_sessions.jobs WHERE household_id = $1
       UNION ALL SELECT checks::text FROM import_sessions.file_checks WHERE batch_id = $2
       UNION ALL SELECT changes::text FROM audit.entries WHERE household_id = $1`,
      [space.householdId, batch.batchId],
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      expect(r.t).not.toContain(OTHER_IBAN.slice(4));
      expect(r.t).not.toContain("Зарплата");
      expect(r.t).not.toContain("Вигадка");
    }
  });
});

describe("IMP-05@PoC «Бізнес-правила»: the stored account evidence is masked at the boundary (#637 item 3)", () => {
  it("IMP-05@PoC FR 4: checks that arrive with a whole IBAN are stored with its last 4 characters only", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [{ name: "a.csv", bytes: CLEAN }]);
    const { rows } = await db.owner.query<{ checks: StatementChecks }>(
      `SELECT checks FROM import_sessions.file_checks WHERE batch_id = $1`,
      [batch.batchId],
    );
    await db.owner.query(`UPDATE import_sessions.batches SET state = 'processing' WHERE id = $1`, [
      batch.batchId,
    ]);
    const whole = ["UA", "00", "333333", "0000000", "444444", "557654"].join("");
    const review = createImportSessionsReview({
      db: db.databases.for("import-sessions"),
      audit,
      now: clock.now,
      newId: randomUUID,
    });
    await review.record(space.householdId, {
      actorId: space.accountId,
      batchId: batch.batchId,
      batchFileId: batch.fileIds[0]!,
      account: { id: space.eur, currency: "EUR" },
      checks: {
        ...rows[0]!.checks,
        account: { status: "mismatch", reasons: [{ kind: "iban", file: OTHER_IBAN, account: whole }] },
      },
    });
    const stored = await db.owner.query<{ t: string }>(
      `SELECT checks::text AS t FROM import_sessions.file_checks WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(stored.rows[0]!.t).toContain("…4821");
    expect(stored.rows[0]!.t).toContain("…7654");
    expect(stored.rows[0]!.t).not.toContain(OTHER_IBAN.slice(4, 20));
    expect(stored.rows[0]!.t).not.toContain(whole.slice(4, 20));
  });
});

describe("IMP-01@PoC FR 12, FR 20: the sealed rows go with their batch", () => {
  it("IMP-01@PoC FR 12, FR 20: «Видалити» and the cleanup 30 days after the last action leave no parse and no checks of the batch", async () => {
    const space = await newSpace();
    const gone = await parsedBatch(space, [{ name: "a.csv", bytes: CLEAN }]);
    const stale = await parsedBatch(space, [{ name: "b.csv", bytes: SECOND }]);
    const left = (batchId: string) =>
      Promise.all([
        count("import_sessions.file_parses WHERE batch_id = $1", batchId),
        count("import_sessions.file_checks WHERE batch_id = $1", batchId),
      ]);
    expect(await left(gone.batchId)).toEqual([1, 1]);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/import/batches/${gone.batchId}`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await left(gone.batchId)).toEqual([0, 0]);

    await db.owner.query(
      `UPDATE import_sessions.batches SET last_action_at = last_action_at - interval '31 days' WHERE id = $1`,
      [stale.batchId],
    );
    const cleanup = createImportSessionsCleanup({
      db: db.databases.for("import-sessions"),
      files,
      audit,
      households: async () => [space.householdId],
      now: clock.now,
      newId: randomUUID,
    });
    expect(await cleanup.run()).toBe(1);
    expect(await left(stale.batchId)).toEqual([0, 0]);
  });
});
