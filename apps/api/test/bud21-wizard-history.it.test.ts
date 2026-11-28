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
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC FR 2, AC2 and IMP-08@PoC FR 17, server part (wave 2 row 243): the statements' wizard learns that a file
 * looks like a history file (`GET …/parse` → `historyFile`), moves one file out of its batch into a history batch of its
 * own for «вивести правила» without the client sending its bytes again (Рішення ведучого (2026-11-28), BUD-21 FR 2), or
 * parses it «як виписку» with the columns of the user's analysis not read. Real API, real worker queue, isolated parse
 * worker, real PostgreSQL; the accounts module is the test's port. Every file, label and amount is synthetic; the clock
 * is the test's.
 */
const WEB = "http://localhost:5173";
let now = Date.parse("2026-11-28T10:00:00Z");
const clock = { now: () => now };

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
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

const headers = (space: Space, scoped = false) => ({
  origin: WEB,
  ...principalHeader({
    userId: space.accountId,
    householdId: space.householdId,
    ...(scoped ? { role: "editor", scoped: true } : {}),
  }),
});

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  scoped = false,
  server: ReturnType<typeof buildServer> = app,
) {
  return server.inject({
    method,
    url,
    headers: {
      ...headers(space, scoped),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const csv = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A history file kept in the user's own table: categories, subcategories, «Тип» with transfers, tags. */
const HISTORY = csv([
  "Дата;Сума;Опис;Категорія;Підкатегорія;Тип;Теги",
  "01.03.2026;-120,50;SILPO 1234 KYIV;Їжа;Супермаркети;витрата;родина",
  "02.03.2026;-45,00;Кав'ярня «Вигадка»;Кав'ярні;;витрата;",
  "03.03.2026;-1 000,00;На свою картку;;;переказ;",
  "04.03.2026;-80,00;SILPO 0456 LVIV;Їжа;Супермаркети;витрата;родина",
]);

/** A bank's statement: nothing of the user's analysis. */
const STATEMENT = csv([
  "Дата;Сума;Опис операції;Залишок",
  "05.03.2026;-30,00;АТБ 0021 KYIV;9 970,00",
  "06.03.2026;-75,00;Аптека «Синтетична»;9 895,00",
]);

const LABELS = ["Їжа", "Супермаркети", "Кав'ярні", "родина"];

/** A statements' batch with these files uploaded; its id and its files' ids in order. */
async function batchWith(
  space: Space,
  parts: readonly { name: string; bytes: Buffer }[],
): Promise<{ batchId: string; fileIds: string[] }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: { ...headers(space), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
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
    ]),
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileIds: (res.json().files as { id: string }[]).map((f) => f.id) };
}

/** Runs the space's queue until nothing is due: the parse jobs, then the audit hand-offs they queued. */
async function work(householdId: string): Promise<void> {
  const parser = isolatedStatementParser();
  const worker = createWorker({
    queues: [
      createImportSessionsWorkerQueue(db.databases.for("import-sessions"), audit, {
        modules: {
          files,
          keys,
          recipes: createImportRecipesReader(db.databases.for("import-recipes")),
          accounts,
          parser,
          history: parser,
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

/** A statements' batch uploaded and parsed. */
async function parsedBatch(
  space: Space,
  parts: readonly { name: string; bytes: Buffer }[],
  body: unknown = {},
) {
  const b = await batchWith(space, parts);
  const res = await call(space, "POST", `/v1/import/batches/${b.batchId}/parse`, body);
  expect(res.statusCode, res.body).toBe(200);
  await work(space.householdId);
  return b;
}

const parseView = async (space: Space, batchId: string) => {
  const res = await call(space, "GET", `/v1/import/batches/${batchId}/parse`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    batch: { state: string; files: { accepted: number; rejected: number } };
    files: {
      fileId: string;
      state: string;
      historyFile?: {
        looksLikeHistory: boolean;
        columns: { column: number; role: string }[];
        asStatement: boolean;
      };
    }[];
  };
};

const moveUrl = (batchId: string, fileId: string) =>
  `/v1/import/batches/${batchId}/files/${fileId}/history-file`;

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const created = async (householdId: string) => ({
  transactions: await count("transactions.transactions WHERE household_id = $1", householdId),
  postings: await count("ledger.postings WHERE household_id = $1", householdId),
});

function server(flags = fakeFlags()) {
  return buildServer({
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
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
          history: { keys, accounts },
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
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
  app = server();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("BUD-21@PoC FR 2: the wizard learns that a file is a history file", () => {
  it("BUD-21@PoC AC2: the parse names, for each file, whether it looks like a history file — the columns of the user's analysis by number and role, never a value", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [
      { name: "istoriya.csv", bytes: HISTORY },
      { name: "vypyska.csv", bytes: STATEMENT },
    ]);
    const view = await parseView(space, batchId);
    const history = view.files.find((f) => f.fileId === fileIds[0])!;
    const statement = view.files.find((f) => f.fileId === fileIds[1])!;
    expect(history.historyFile).toEqual({
      looksLikeHistory: true,
      columns: [
        { column: 4, role: "category" },
        { column: 5, role: "subcategory" },
        { column: 6, role: "transfer-flag" },
        { column: 7, role: "tags" },
      ],
      asStatement: false,
    });
    expect(statement.historyFile).toEqual({ looksLikeHistory: false, columns: [], asStatement: false });
    const res = await call(space, "GET", `/v1/import/batches/${batchId}/parse`);
    // The checks keep no copy of the field, and no label of the file is in the answer.
    expect(res.json().files[0].checks.userColumns).toBeUndefined();
    for (const label of LABELS)
      expect(
        leakText(JSON.stringify(res.json().files.map((f: { historyFile: unknown }) => f.historyFile))),
      ).not.toContain(label);
  });
});

describe("BUD-21@PoC FR 2: «вивести правила» moves the file into a history batch of its own", () => {
  it("BUD-21@PoC AC2: the file leaves the statements' batch without being sent again, its history batch is read and opens «Перевірка розпізнавання»; the other file stays; no transaction is created", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [
      { name: "istoriya.csv", bytes: HISTORY },
      { name: "vypyska.csv", bytes: STATEMENT },
    ]);
    const before = await parseView(space, batchId);
    const res = await call(space, "POST", moveUrl(batchId, fileIds[0]!));
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      existing: false,
      batch: { state: "processing", format: "csv", fileName: "istoriya.csv" },
      statement: { id: batchId, files: { accepted: 1, rejected: 0 } },
    });
    expect(body.statement.state).toBe(before.batch.state);
    // The original is a «файл історії» now; the statement's copy of it is gone, the other statement stays.
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'history-file'", space.householdId),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'statement'", space.householdId),
    ).toBe(1);

    await work(space.householdId);
    const review = await call(space, "GET", `/v1/import/history-files/${body.batch.id}`);
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().batch.state).toBe("parsed");
    expect(review.json().recognition.missing).toEqual([]);

    // The rest of the batch goes on through the wizard: the statement's file with its parse and checks.
    const after = await parseView(space, batchId);
    expect(after.files.map((f) => f.fileId)).toEqual([fileIds[1]]);
    expect(after.files[0]!.state).toBe("parsed");
    const rows = await call(space, "GET", `/v1/import/batches/${batchId}/files/${fileIds[1]}/rows`);
    expect(rows.statusCode, rows.body).toBe(200);
    // The moved file is the statements' batch's no more.
    expect(
      (await call(space, "GET", `/v1/import/batches/${batchId}/files/${fileIds[0]}/rows`)).statusCode,
    ).toBe(404);
    expect(await created(space.householdId)).toEqual({ transactions: 0, postings: 0 });
  });

  it("IMP-08@PoC FR 17: a batch left with no file is closed; the same file already stored as a history file opens its batch", async () => {
    const space = await newSpace();
    const first = await parsedBatch(space, [{ name: "istoriya.csv", bytes: HISTORY }]);
    const moved = await call(space, "POST", moveUrl(first.batchId, first.fileIds[0]!));
    expect(moved.statusCode, moved.body).toBe(201);
    expect(moved.json().statement).toMatchObject({ state: "cancelled", files: { accepted: 0 } });

    // BUD-21 FR 3: the same file again, from another statements' batch — the history batch already stored opens.
    const second = await parsedBatch(space, [
      { name: "istoriya-kopiya.csv", bytes: HISTORY },
      { name: "vypyska.csv", bytes: STATEMENT },
    ]);
    const again = await call(space, "POST", moveUrl(second.batchId, second.fileIds[0]!));
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({ existing: true, batch: { id: moved.json().batch.id } });
    expect(again.json().statement).toMatchObject({ files: { accepted: 1 } });
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'history-file'", space.householdId),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'statement'", space.householdId),
    ).toBe(1);
    expect(
      await count("import_sessions.batches WHERE household_id = $1 AND kind = 'history'", space.householdId),
    ).toBe(1);
  });

  it("BUD-21@PoC FR 2: two moves of the same file at once — one history batch, the other answer «not found», no copy left behind", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [
      { name: "istoriya.csv", bytes: HISTORY },
      { name: "vypyska.csv", bytes: STATEMENT },
    ]);
    const [a, b] = await Promise.all([
      call(space, "POST", moveUrl(batchId, fileIds[0]!)),
      call(space, "POST", moveUrl(batchId, fileIds[0]!)),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 404]);
    expect(
      await count("import_sessions.batches WHERE household_id = $1 AND kind = 'history'", space.householdId),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'history-file'", space.householdId),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'statement'", space.householdId),
    ).toBe(1);
  });

  it("BUD-21@PoC FR 2: refused with nothing written — a batch being parsed (409), another space's batch, an unknown file, a history batch (404), a scoped member (refused as for an unknown id)", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await batchWith(space, [{ name: "istoriya.csv", bytes: HISTORY }]);
    expect((await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {})).statusCode).toBe(200);
    const busy = await call(space, "POST", moveUrl(batchId, fileIds[0]!));
    expect(busy.statusCode, busy.body).toBe(409);
    await work(space.householdId);

    const other = await newSpace();
    const foreign = await call(other, "POST", moveUrl(batchId, fileIds[0]!));
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect((await call(space, "POST", moveUrl(batchId, randomUUID()))).statusCode).toBe(404);
    // A scoped member is refused before the batch is read: one answer for a known file and an unknown one.
    const scopedKnown = await call(space, "POST", moveUrl(batchId, fileIds[0]!), undefined, true);
    const scopedUnknown = await call(space, "POST", moveUrl(randomUUID(), randomUUID()), undefined, true);
    expect([403, 404]).toContain(scopedKnown.statusCode);
    expect(scopedKnown.statusCode).toBe(scopedUnknown.statusCode);
    const moved = await call(space, "POST", moveUrl(batchId, fileIds[0]!));
    expect(moved.statusCode, moved.body).toBe(201);
    // A history batch is no statements' batch: its file does not move again.
    const historyBatch = moved.json().batch.id as string;
    const historyFile = (
      await db.owner.query<{ id: string }>(`SELECT id FROM import_sessions.batch_files WHERE batch_id = $1`, [
        historyBatch,
      ])
    ).rows[0]!.id;
    expect((await call(space, "POST", moveUrl(historyBatch, historyFile))).statusCode).toBe(404);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'history-file'", space.householdId),
    ).toBe(1);
    expect(await count("import_sessions.batches WHERE household_id = $1", other.householdId)).toBe(0);
  });

  it("BUD-21@PoC FR 2: with the release flag off the move is «not found»; the batch keeps its file", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [{ name: "istoriya.csv", bytes: HISTORY }]);
    const off = server(fakeFlags({ off: ["categorization.history-rules"] }));
    await off.ready();
    try {
      const res = await call(space, "POST", moveUrl(batchId, fileIds[0]!), undefined, false, off);
      expect(res.statusCode, res.body).toBe(404);
    } finally {
      await off.close();
    }
    expect((await parseView(space, batchId)).batch.files.accepted).toBe(1);
  });

  it("BUD-21@PoC FR 26: the move's audit entries hold kinds, states and counts — never the file's name or a label", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [{ name: "istoriya-oleny.csv", bytes: HISTORY }]);
    expect((await call(space, "POST", moveUrl(batchId, fileIds[0]!))).statusCode).toBe(201);
    await work(space.householdId);
    const { rows } = await db.owner.query<{ entity_id: string; changes: unknown }>(
      `SELECT entity_id, changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch'`,
      [space.householdId],
    );
    const text = JSON.stringify(rows);
    expect(text).toContain("files.toHistory");
    expect(text).toContain("history.from");
    for (const value of ["istoriya-oleny", ...LABELS, "SILPO", "120,50"]) expect(text).not.toContain(value);
  });
});

describe("BUD-21@PoC FR 2: «імпортувати як виписку» does not read the user's analysis", () => {
  it("BUD-21@PoC FR 2: parsed «як виписку», the file's rows carry no category, subcategory, transfer mark or tag; the answer is kept for the next parse and can be taken back", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [{ name: "istoriya.csv", bytes: HISTORY }]);
    const rowsText = async () => {
      const res = await call(space, "GET", `/v1/import/batches/${batchId}/files/${fileIds[0]}/rows`);
      expect(res.statusCode, res.body).toBe(200);
      return leakText(res.body);
    };
    // Read as usual, the category column is a part of the bank's description.
    expect(await rowsText()).toContain("Супермаркети");

    let res = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
      files: [{ fileId: fileIds[0], asStatement: true }],
    });
    expect(res.statusCode, res.body).toBe(200);
    await work(space.householdId);
    let view = await parseView(space, batchId);
    expect(view.files[0]!.historyFile).toMatchObject({ looksLikeHistory: true, asStatement: true });
    let text = await rowsText();
    for (const label of [...LABELS, "витрата", "переказ"]) expect(text).not.toContain(label);
    const descriptions = (
      (await call(space, "GET", `/v1/import/batches/${batchId}/files/${fileIds[0]}/rows`)).json().items as {
        description: string;
      }[]
    ).map((r) => r.description);
    expect(descriptions).toEqual([
      "SILPO 1234 KYIV",
      "Кав'ярня «Вигадка»",
      "На свою картку",
      "SILPO 0456 LVIV",
    ]);

    // A later «Розібрати» without an answer keeps it.
    now += 60_000;
    res = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {});
    expect(res.statusCode, res.body).toBe(200);
    await work(space.householdId);
    view = await parseView(space, batchId);
    expect(view.files[0]!.historyFile!.asStatement).toBe(true);
    text = await rowsText();
    expect(text).not.toContain("Супермаркети");

    // `false` reads the columns again.
    res = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
      files: [{ fileId: fileIds[0], asStatement: false }],
    });
    expect(res.statusCode, res.body).toBe(200);
    await work(space.householdId);
    expect((await parseView(space, batchId)).files[0]!.historyFile!.asStatement).toBe(false);
    expect(await rowsText()).toContain("Супермаркети");
    expect(await created(space.householdId)).toEqual({ transactions: 0, postings: 0 });
  });

  it("IMP-08@PoC FR 17: the answer is a boolean of a file of this batch — anything else is refused", async () => {
    const space = await newSpace();
    const { batchId, fileIds } = await parsedBatch(space, [{ name: "istoriya.csv", bytes: HISTORY }]);
    const bad = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
      files: [{ fileId: fileIds[0], asStatement: "так" }],
    });
    expect(bad.statusCode, bad.body).toBe(400);
    const unknown = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
      files: [{ fileId: randomUUID(), asStatement: true }],
    });
    expect(unknown.statusCode, unknown.body).toBe(422);
  });
});
