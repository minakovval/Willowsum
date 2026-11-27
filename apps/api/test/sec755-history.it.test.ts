import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { importSessionsResealPart } from "../src/modules/import-sessions/adapters/db/reseal.ts";
import { createImportedTransactions } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» a) (wave 2 row 233), modules import-sessions, file-parsers and file-storage
 * through the real API, the real worker queue and the isolated parse worker on a real PostgreSQL: a history file is a
 * batch of its own kind, stored with the statement's checks as «файл історії», read with the roles of the user's own
 * columns, corrected and confirmed — never applied. The accounts module is the test's port. Every file, label and
 * amount is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-27T10:00:00Z");
const clock = { now: () => now };
const telemetry = testTelemetryForFile();

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
  readonly mono: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const mono = randomUUID();
  accountsOf.set(`${householdId}/${mono}`, {
    accountId: mono,
    kind: "current",
    status: "active",
    subaccounts: [{ subaccountId: randomUUID(), currency: "UAH", ledgerAccountId: randomUUID() }],
  });
  return { accountId, householdId, mono };
}

type Scoped = false | "viewer" | "editor";

const headers = (space: Space, scoped: Scoped = false) => ({
  origin: WEB,
  ...principalHeader({
    userId: space.accountId,
    householdId: space.householdId,
    ...(scoped ? { role: scoped, scoped: true } : {}),
  }),
});

function call(
  space: Space,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
  scoped: Scoped = false,
) {
  return app.inject({
    method,
    url,
    headers: {
      ...headers(space, scoped),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

function upload(space: Space, name: string, bytes: Buffer, type = "text/csv") {
  const boundary = `ws-${randomUUID()}`;
  return app.inject({
    method: "POST",
    url: "/v1/import/history-files",
    headers: { ...headers(space), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

const csv = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A history file: date, amount, description, the user's category, subcategory, «Тип» and account; one row without a category. */
const HISTORY = csv([
  "Дата;Сума;Опис;Категорія;Підкатегорія;Тип;Рахунок",
  "01.03.2026;-120,50;SILPO 1234 KYIV;Їжа;Супермаркети;витрата;Моно",
  "02.03.2026;-45,00;Кав'ярня «Вигадка»;Кав'ярні;;витрата;Готівка",
  "03.03.2026;-1 000,00;На свою картку;;;переказ;Моно",
  "04.03.2026;-80,00;SILPO 0456 LVIV;Їжа;Супермаркети;витрата;Моно",
  "05.03.2026;-60,00;Невідомо;;;витрата;Моно",
]);

/** Runs the space's queue until nothing is due: the read jobs, then the audit hand-offs they queued. */
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

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

/** Uploads the file and reads it: the batch id and the view. */
async function uploaded(space: Space, bytes: Buffer = HISTORY, name = "istoriya.csv") {
  const res = await upload(space, name, bytes);
  expect(res.statusCode, res.body).toBe(201);
  const batchId = res.json().batch.id as string;
  await work(space.householdId);
  const view = await call(space, "GET", `/v1/import/history-files/${batchId}`);
  expect(view.statusCode, view.body).toBe(200);
  return { batchId, upload: res.json(), view: view.json() };
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
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
          history: { keys, accounts },
          // The statement's apply, wired as in production: a history batch is never found by it (AC10).
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

const STATEMENT_STEPS = (
  id: string,
  fileId: string,
): readonly ["GET" | "POST" | "DELETE", string, unknown?][] => [
  ["GET", `/v1/import/batches/${id}`],
  ["POST", `/v1/import/batches/${id}/cancel`, {}],
  ["DELETE", `/v1/import/batches/${id}`],
  ["POST", `/v1/import/batches/${id}/files/${fileId}/link`, {}],
  ["POST", `/v1/import/batches/${id}/decisions`, { decisions: [{ kind: "account", fileId }] }],
  ["GET", `/v1/import/batches/${id}/decisions`],
  ["GET", `/v1/import/batches/${id}/readiness`],
  ["POST", `/v1/import/batches/${id}/parse`, {}],
  ["GET", `/v1/import/batches/${id}/parse`],
  ["GET", `/v1/import/batches/${id}/files/${fileId}/rows`],
  ["GET", `/v1/import/batches/${id}/files/${fileId}/review`],
  ["GET", `/v1/import/batches/${id}/files/${fileId}/review/rows`],
  ["GET", `/v1/import/batches/${id}/files/${fileId}/duplicates`],
  ["POST", `/v1/import/batches/${id}/apply`, {}],
  ["GET", `/v1/import/batches/${id}/result`],
  ["POST", `/v1/import/batches/${id}/rollback`, {}],
  ["GET", `/v1/import/batches/${id}/rollback`],
];

describe("sec755: BUD-21@PoC a — security properties of the history file", () => {
  it("sec755 BUD-21@PoC FR 3: the same file in another space never opens the first space's batch — a batch and an original of its own", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const first = await uploaded(a);
    const res = await upload(b, "istoriya.csv", HISTORY);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().existing).toBe(false);
    expect(res.json().batch.id).not.toBe(first.batchId);
    expect(await count("import_sessions.batches WHERE household_id = $1", b.householdId)).toBe(1);
    expect(await count("file_storage.files WHERE household_id = $1", b.householdId)).toBe(1);
    expect(await count("file_storage.files WHERE household_id = $1", a.householdId)).toBe(1);
    // The first space's batch took no action from it.
    const mine = (await call(a, "GET", `/v1/import/history-files/${first.batchId}`)).json();
    expect(mine.batch.lastActionAt).toBe(first.view.batch.lastActionAt);
  });

  it("sec755 BUD-21@PoC FR 3: another space cannot correct, confirm or delete the history file; it stays as it was", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const { batchId, view } = await uploaded(a);
    const base = `/v1/import/history-files/${batchId}`;
    expect((await call(b, "POST", `${base}/reading`, { dateOrder: "mdy" })).statusCode).toBe(404);
    expect((await call(b, "POST", `${base}/confirm`, { parseId: view.parseId })).statusCode).toBe(404);
    expect((await call(b, "DELETE", base)).statusCode).toBe(404);
    const after = (await call(a, "GET", base)).json();
    expect(after).toMatchObject({ parseId: view.parseId, confirmed: null, batch: { state: "parsed" } });
    expect(await count("file_storage.files WHERE household_id = $1", a.householdId)).toBe(1);
  });

  it("sec755 BUD-21@PoC «Права доступу»: a scoped member takes no step of a history file — upload, correction, confirmation, deletion are «not found» and nothing is stored", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space);
    const base = `/v1/import/history-files/${batchId}`;
    // A scoped member's request is refused before the batch is read: one answer for a known id and an unknown one.
    // An Editor holds `household.data.write`, so for a scoped Editor the routes' own check is the only guard.
    const unknown = `/v1/import/history-files/${randomUUID()}`;
    for (const role of ["viewer", "editor"] as const) {
      for (const [method, path, body] of [
        ["GET", "", undefined],
        ["POST", "/reading", {}],
        ["POST", "/confirm", { parseId: view.parseId }],
        ["DELETE", "", undefined],
      ] as const) {
        const known = await call(space, method, `${base}${path}`, body, role);
        const other = await call(space, method, `${unknown}${path}`, body, role);
        expect([403, 404], `${role} ${method} ${path}`).toContain(known.statusCode);
        expect(known.statusCode, `${role} ${method} ${path}`).toBe(other.statusCode);
        expect(known.json().code).toBe(other.json().code);
      }
      const boundary = `ws-scoped-${role}`;
      const up = await app.inject({
        method: "POST",
        url: "/v1/import/history-files",
        headers: { ...headers(space, role), "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="b.csv"\r\nContent-Type: text/csv\r\n\r\n`,
          ),
          csv(["Дата;Сума;Опис;Категорія", "01.03.2026;-10,00;Кава;Кафе"]),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect([403, 404], `${role} upload`).toContain(up.statusCode);
    }
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("import_sessions.batches WHERE household_id = $1", space.householdId)).toBe(1);
    expect((await call(space, "GET", base)).json()).toMatchObject({ confirmed: null, parseId: view.parseId });
  });

  it("sec755 BUD-21@PoC FR 3: every statement step answers «not found» for a history file's batch, confirmed or not, and leaves it as it was", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space);
    const fileId = (
      await db.owner.query<{ id: string }>(
        `SELECT id FROM import_sessions.batch_files WHERE household_id = $1 AND batch_id = $2`,
        [space.householdId, batchId],
      )
    ).rows[0]!.id;
    const unknownId = randomUUID();
    for (const round of ["open", "confirmed"]) {
      for (const [method, url, body] of STATEMENT_STEPS(batchId, fileId)) {
        const res = await call(space, method, url, body);
        // The same answer as for a batch that does not exist .
        const none = await call(space, method, url.replace(batchId, unknownId), body);
        expect(res.statusCode, `${round} ${method} ${url} ${res.body}`).toBe(none.statusCode);
        expect(res.json().code, `${round} ${method} ${url}`).toBe(none.json().code);
        // Steps whose services this harness does not wire answer 500 for any id; every other one is «not found».
        if (none.statusCode !== 500)
          expect(res.statusCode, `${round} ${method} ${url} ${res.body}`).toBe(404);
      }
      const boundary = "ws-stmt";
      const add = await app.inject({
        method: "POST",
        url: `/v1/import/batches/${batchId}/files`,
        headers: { ...headers(space), "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="s.csv"\r\nContent-Type: text/csv\r\n\r\n`,
          ),
          csv(["Дата;Сума;Опис", "01.03.2026;-10,00;Кава"]),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect(add.statusCode, add.body).toBe(404);
      if (round === "open")
        expect(
          (
            await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
              parseId: view.parseId,
            })
          ).statusCode,
        ).toBe(200);
    }
    expect(await count("import_sessions.batch_files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("import_sessions.file_parses WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await count("transactions.transactions WHERE household_id = $1", space.householdId)).toBe(0);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(200);
  });

  it("sec755 BUD-21@PoC FR 24, «Бізнес-правила»: the rows as read and the answers are stored sealed — no cell of the file in the module's tables, the queue or the logs; the original is of kind «файл історії»", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, HISTORY, "taemna-istoriya.csv");
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: view.parseId,
      transferValues: ["переказ"],
      accounts: [{ value: "Моно", accountId: space.mono }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const dump = async (table: string) =>
      (
        await db.owner.query<{ t: string }>(
          `SELECT convert_from(convert_to(x::text, 'UTF8'), 'UTF8') AS t FROM ${table} x WHERE household_id = $1`,
          [space.householdId],
        )
      ).rows
        .map((r) => r.t)
        .join("\n");
    const stored = (await dump("import_sessions.history_parses")) + (await dump("import_sessions.jobs"));
    const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
    for (const secret of ["SILPO", "Супермаркети", "Моно", "переказ", "Вигадка", "120,50", "120.50"]) {
      expect(stored, secret).not.toContain(secret);
      expect(stored, secret).not.toContain(hex(secret));
    }
    const { rows } = await db.owner.query<{ p: boolean; a: boolean }>(
      `SELECT octet_length(parse_sealed) > 0 AS p, octet_length(answers_sealed) > 0 AS a
         FROM import_sessions.history_parses WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([{ p: true, a: true }]);
    expect(
      (
        await db.owner.query(`SELECT kind FROM file_storage.files WHERE household_id = $1`, [
          space.householdId,
        ])
      ).rows,
    ).toEqual([{ kind: "history-file" }]);
    const logs = await exportedText(telemetry);
    for (const secret of ["SILPO", "Супермаркети", "Вигадка", "taemna"]) expect(logs).not.toContain(secret);
  });

  it("sec755 ARC-03@PoC FR 2: history_parses has the space's row policy, forced, and the application role reads no row of another space", async () => {
    const { rows } = await db.owner.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      n: number;
    }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS n
         FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = 'import_sessions' AND c.relname = 'history_parses'`,
    );
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(rows[0]!.n).toBeGreaterThan(0);
    const a = await newSpace();
    const b = await newSpace();
    await uploaded(a);
    const seen = await db.databases
      .for("import-sessions")
      .inHousehold(b.householdId, (q) =>
        q.query<{ n: number }>(
          `SELECT (SELECT count(*)::int FROM history_parses) + (SELECT count(*)::int FROM batches) AS n`,
        ),
      );
    expect(seen.rows[0]!.n).toBe(0);
  });

  it("sec755 BUD-21@PoC FR 24: after «Видалити файл» the same file is a new batch — the deleted one is never opened again, and its late read job does nothing", async () => {
    const space = await newSpace();
    const res = await upload(space, "istoriya.csv", HISTORY);
    const batchId = res.json().batch.id as string;
    expect((await call(space, "DELETE", `/v1/import/history-files/${batchId}`)).statusCode).toBe(200);
    await work(space.householdId);
    expect(await count("import_sessions.history_parses WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    const again = await upload(space, "istoriya.csv", HISTORY);
    expect(again.json()).toMatchObject({ existing: false });
    expect(again.json().batch.id).not.toBe(batchId);
  });

  it("sec755 BUD-21@PoC FR 3: the history file steps answer «not found» for a statement's batch and leave it as it was", async () => {
    const space = await newSpace();
    const created = await call(space, "POST", "/v1/import/batches", {});
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const base = `/v1/import/history-files/${id}`;
    expect((await call(space, "GET", base)).statusCode).toBe(404);
    expect((await call(space, "POST", `${base}/reading`, {})).statusCode).toBe(404);
    expect((await call(space, "POST", `${base}/confirm`, { parseId: randomUUID() })).statusCode).toBe(404);
    expect((await call(space, "DELETE", base)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/import/batches/${id}`)).statusCode).toBe(200);
  });

  it("sec755 BUD-21@PoC FR 3 (IMP-01 FR 13): a history file's reads count against the space's hourly ceiling of parses with the statements' — past it an upload stores nothing and a correction reads nothing", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space);
    // 199 statement parses of the last hour beside the history file's one: the ceiling (200) is reached.
    await db.owner.query(
      `INSERT INTO import_sessions.jobs (household_id, name, dedupe_key, payload, heavy, state, finished_at)
       SELECT $1, 'import-sessions.parse-file', 'sec755:' || n, '{}'::jsonb, true, 'done', now()
         FROM generate_series(1, 199) AS n`,
      [space.householdId],
    );
    const res = await upload(
      space,
      "druha.csv",
      csv(["Дата;Сума;Опис;Категорія", "01.03.2026;-10,00;Кава;Кафе"]),
    );
    expect(res.statusCode, res.body).toBe(429);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("import_sessions.batches WHERE household_id = $1", space.householdId)).toBe(1);
    const again = await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, {
      dateOrder: "mdy",
    });
    expect(again.statusCode, again.body).toBe(429);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).json()).toMatchObject({
      parseId: view.parseId,
      batch: { state: "parsed" },
    });
    // The same file again opens its batch: no new read, so no ceiling.
    expect((await upload(space, "istoriya.csv", HISTORY)).json()).toMatchObject({ existing: true });
  });

  it("sec755 BUD-21@PoC FR 6: «Підтвердити» names the read the user saw — after a correction the older read is refused and nothing is confirmed", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space);
    const base = `/v1/import/history-files/${batchId}`;
    expect((await call(space, "POST", `${base}/reading`, { sign: "invert" })).statusCode).toBe(200);
    await work(space.householdId);
    const stale = await call(space, "POST", `${base}/confirm`, { parseId: view.parseId });
    expect(stale.statusCode, stale.body).toBe(409);
    const now2 = (await call(space, "GET", base)).json();
    expect(now2.confirmed).toBeNull();
    expect(now2.parseId).not.toBe(view.parseId);
    expect((await call(space, "POST", `${base}/confirm`, { parseId: now2.parseId })).statusCode).toBe(200);
  });

  it("sec755 BUD-21@PoC FR 3: the same file uploaded several times at once is one batch and one original", async () => {
    const space = await newSpace();
    const all = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => upload(space, `istoriya-${n}.csv`, HISTORY)));
    expect(all.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(all.map((r) => r.json().batch.id)).size).toBe(1);
    expect(all.filter((r) => r.json().existing === false)).toHaveLength(1);
    expect(await count("import_sessions.batches WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
  });

  it("sec755 NFR-01@PoC FR 3: the data-key replacement walks the history file's read and answers of the space only, each under the purpose it was sealed for, and writes each to its own row", async () => {
    const part = importSessionsResealPart(db.databases.for("import-sessions"));
    const space = await newSpace();
    const other = await newSpace();
    const first = await uploaded(space);
    await call(space, "POST", `/v1/import/history-files/${first.batchId}/confirm`, {
      parseId: first.view.parseId,
    });
    const second = await uploaded(space, csv(["Дата;Сума;Опис;Категорія", "01.03.2026;-10,00;Кава;Кафе"]));
    const theirs = await uploaded(other);
    expect(await part.count(space.householdId)).toBe(3);
    const seen: { purpose: string; sealed: Buffer }[] = [];
    const looked = await part.reseal(
      space.householdId,
      {
        field: () => null,
        bytes: (purpose, sealed) => {
          seen.push({ purpose, sealed: Buffer.from(sealed) });
          return null;
        },
      },
      100,
    );
    expect(looked).toBe(0);
    expect(seen).toHaveLength(3);
    // Every value opens under the purpose the walk names for it (a wrong purpose does not open).
    const opened: Record<string, unknown>[] = [];
    for (const v of seen)
      opened.push(
        JSON.parse(
          new TextDecoder().decode(await keys.openBytes(space.householdId, v.purpose, v.sealed)),
        ) as Record<string, unknown>,
      );
    expect(opened.filter((o) => Array.isArray(o["rows"]))).toHaveLength(2);
    expect(opened.filter((o) => Array.isArray(o["transferValues"]))).toHaveLength(1);
    const digest = async (householdId: string) =>
      (
        await db.owner.query<{ batch_id: string; p: string; a: string | null }>(
          `SELECT batch_id, md5(parse_sealed) AS p, md5(answers_sealed) AS a FROM import_sessions.history_parses
            WHERE household_id = $1 ORDER BY batch_id`,
          [householdId],
        )
      ).rows;
    const before = { mine: await digest(space.householdId), theirs: await digest(other.householdId) };
    // The write: every value goes back to the row it was read from, and no row of another space is touched.
    const written = await part.reseal(
      space.householdId,
      { field: () => null, bytes: (_purpose, sealed) => Buffer.from(sealed) },
      100,
    );
    expect(written).toBe(3);
    expect({ mine: await digest(space.householdId), theirs: await digest(other.householdId) }).toEqual(
      before,
    );
    for (const [who, id] of [
      [space, first.batchId],
      [space, second.batchId],
      [other, theirs.batchId],
    ] as const)
      expect((await call(who, "GET", `/v1/import/history-files/${id}`)).statusCode).toBe(200);
  });

  it("sec755 IMP-05@PoC «Бізнес-правила»: an IBAN and a card number in the file's texts are shown masked on the review step — in the rows as read and in the examples of every decision", async () => {
    const iban = ["UA21", "3223", "1300", "0002", "6007", "2335", "6600", "1"].join("");
    const card = ["4149", "4999", "9123", "4567"].join("");
    const space = await newSpace();
    const { view } = await uploaded(
      space,
      csv([
        "Дата;Сума;Опис;Контрагент;Категорія",
        `01.03.2026;-120,50;Оплата ${iban};Картка ${card};Їжа`,
        `02.03.2026;-45,00;Переказ ${iban};Картка ${card};Кафе`,
        `03.03.2026;-80,00;Платіж ${iban};Картка ${card};Їжа`,
      ]),
    );
    const text = JSON.stringify(view);
    expect(text).not.toContain(iban);
    expect(text).not.toContain(card);
    expect(view.recognition.examples[0].description).toBe("Оплата …6001");
    expect(view.recognition.columns[2].role.chosen.examples[0].cell).toBe("Оплата …6001");
  });
});
