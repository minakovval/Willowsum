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
import { xlsx } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  createImportRecipesReader,
  createImportRecipesServices,
} from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsHandOffRecovery,
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
  PARSE_FILE_JOB,
  PARSE_FILES_PER_HOUR,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * The parse step of import batches (IMP-01@PoC FR 5, FR 6, FR 10, FR 15, FR 19, FR 21; IMP-19@PoC FR 4, FR 5;
 * IMP-05@PoC FR 3, FR 4; IMP-06@PoC FR 1, FR 7; #624) on a real PostgreSQL through the real API and the real
 * worker queue: «Розібрати» queues each accepted file as a heavy job; the worker parses it in the isolated parse worker
 * with the chosen or matched recipe, stores the rows sealed with the space's key and records the checks with the
 * previous statement's history gap; the last file moves the batch. The accounts module is the test's port (an EUR
 * account of the space). Every file, name and number is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// Synthetic IBANs, built so no real-looking literal sits in the source.
const IBAN = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");
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

async function saveRecipe(space: Space, recipe: unknown, fingerprint?: string): Promise<string> {
  const res = await call(space, "POST", "/v1/import/recipes", {
    name: "Синтетичний банк",
    recipe,
    ...(fingerprint ? { fingerprint } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
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

describe("IMP-01@PoC FR 5, FR 10: «Розібрати» parses each file in the background", () => {
  it("IMP-01@PoC FR 5, IMP-19@PoC FR 4, FR 5: the batch is «в обробці» until the worker parsed its files, then «розібрано»; the rows come back in exact decimals", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [
      { name: "berezen.csv", bytes: CLEAN },
      { name: "berezen.tsv", bytes: Buffer.from(CLEAN.toString("utf8").replaceAll(";", "\t")) },
    ]);
    const started = await parse(space, batch.batchId, {
      files: batch.fileIds.map((fileId) => ({ fileId, accountId: space.eur })),
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().state).toBe("processing");
    // ARC-04 FR 5: one heavy job per accepted file.
    expect(
      await count(
        "import_sessions.jobs WHERE household_id = $1 AND name = $2 AND heavy",
        space.householdId,
        PARSE_FILE_JOB.name,
      ),
    ).toBe(2);
    const pending = (await view(space, batch.batchId)).json();
    expect(pending.progress).toEqual({ pending: 2, parsed: 0, failed: 0 });

    await work(space.householdId);
    const res = await view(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.batch.state).toBe("parsed");
    expect(body.progress).toEqual({ pending: 0, parsed: 2, failed: 0 });
    expect(body.files[0]).toMatchObject({
      fileId: batch.fileIds[0],
      state: "parsed",
      refusal: null,
      accountId: space.eur,
      engineVersion: "2",
      rowCount: 2,
      checks: { currency: "EUR", flags: [] },
      history: { status: "unknown" },
    });

    const rows = await call(
      space,
      "GET",
      `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows`,
    );
    expect(rows.statusCode, rows.body).toBe(200);
    expect(rows.json().items.map((r: { legs: unknown }) => r.legs)).toEqual([
      [{ amount: "500.00", currency: "EUR" }],
      [{ amount: "-60.00", currency: "EUR" }],
    ]);
    // IMP-05 business rule: an IBAN in a bank's text shows only its last 4 characters in the answer.
    expect(rows.json().items[1].description).toBe("Переказ на …4821");
    expect(leakText(rows.body)).not.toContain(OTHER_IBAN);
    const page = await call(
      space,
      "GET",
      `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows?limit=1`,
    );
    expect(page.json().items).toHaveLength(1);
    const next = await call(
      space,
      "GET",
      `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows?limit=1&cursor=${page.json().nextCursor}`,
    );
    expect(next.json()).toMatchObject({ items: [{ row: 4 }], nextCursor: null });

    // The rows are financial data: sealed with the space's key, never in the clear in the database.
    const { rows: stored } = await db.owner.query<{ sealed: Buffer }>(
      `SELECT rows_sealed AS sealed FROM import_sessions.file_parses WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(stored).toHaveLength(2);
    for (const r of stored) {
      expect(r.sealed.toString("latin1")).not.toContain("500");
      expect(r.sealed.toString("utf8")).not.toContain("Зарплата");
    }
    // The readiness of IMP-05 reads the recorded checks: nothing to decide (AC9).
    const ready = await call(space, "GET", `/v1/import/batches/${batch.batchId}/readiness`);
    expect(ready.json()).toMatchObject({ ready: true, refusals: [] });
  });

  it("IMP-01@PoC FR 6, EC1, FR 15: every accepted file refused by the parse — «не вдалося розібрати» with each reason in plain words", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [
      { name: "empty.csv", bytes: text(["Дата;Сума;Опис"]) },
      {
        name: "kniga.xlsx",
        bytes: xlsx(),
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ]);
    expect((await parse(space, batch.batchId)).statusCode).toBe(200);
    await work(space.householdId);
    const body = (await view(space, batch.batchId)).json();
    expect(body.batch.state).toBe("failed");
    expect(
      body.files.map((f: { state: string; refusal: { code: string } }) => [f.state, f.refusal.code]),
    ).toEqual([
      ["failed", "NO_TRANSACTIONS"],
      ["failed", "FORMAT_NOT_PARSED"],
    ]);
    expect(body.files[0].refusal.message.uk).toBe("У файлі немає транзакцій");
    const rows = await call(
      space,
      "GET",
      `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows`,
    );
    expect(rows.statusCode).toBe(409);
    // FR 21: a refusal that asks to parse again (`ACCOUNT_BINDING`) can be followed in the same batch.
    const again = await parse(space, batch.batchId);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().state).toBe("processing");
    expect((await view(space, batch.batchId)).json().progress).toEqual({ pending: 2, parsed: 0, failed: 0 });
  });

  it("IMP-01@PoC FR 10: a parsed file and a refused one — «потребує перегляду»; a file without an account is to review too", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [
      { name: "berezen.csv", bytes: CLEAN },
      { name: "empty.csv", bytes: text(["Дата;Сума;Опис"]) },
    ]);
    await parse(space, batch.batchId, { files: [{ fileId: batch.fileIds[0], accountId: space.eur }] });
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().batch.state).toBe("needs-review");
    // The refused file has no checks: the readiness reads the parsed one only.
    const ready = await call(space, "GET", `/v1/import/batches/${batch.batchId}/readiness`);
    expect(ready.statusCode, ready.body).toBe(200);

    const alone = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    await parse(space, alone.batchId);
    await work(space.householdId);
    const body = (await view(space, alone.batchId)).json();
    expect(body.batch.state).toBe("needs-review");
    expect(body.files[0].accountId).toBeNull();
  });

  it("IMP-01@PoC FR 21: a parsed batch is parsed again from the start — its decisions go; a batch «в обробці» refuses a second parse (409)", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    await parse(space, batch.batchId);
    expect((await parse(space, batch.batchId)).statusCode).toBe(409);
    await work(space.householdId);
    const decided = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "group", fileId: null, group: "review", action: "accept" }],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const again = await parse(space, batch.batchId, {
      files: [{ fileId: batch.fileIds[0], accountId: space.eur }],
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json()).toMatchObject({
      batch: { state: "parsed" },
      files: [{ accountId: space.eur }],
    });
  });

  it("IMP-01@PoC FR 10: two «Розібрати» of one batch at once — one starts the parse, the other is refused; one job per file", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    const both = await Promise.all([parse(space, batch.batchId), parse(space, batch.batchId)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      await count(
        "import_sessions.jobs WHERE household_id = $1 AND name = $2",
        space.householdId,
        PARSE_FILE_JOB.name,
      ),
    ).toBe(1);
  });
});

describe("IMP-06@PoC FR 1, FR 7: the chosen or matched recipe", () => {
  it("IMP-06@PoC FR 7: a file of a saved format is parsed with the space's recipe for it — «збіг»", async () => {
    const space = await newSpace();
    const probe = await isolatedStatementParser().parse(new Uint8Array(CLEAN));
    const fingerprint = probe.reading.format!.fingerprint;
    const recipeId = await saveRecipe(space, { schemaVersion: 1, file: { delimiter: ";" } }, fingerprint);
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    await parse(space, batch.batchId, { files: [{ fileId: batch.fileIds[0], accountId: space.eur }] });
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().files[0].recipe).toEqual({
      id: recipeId,
      format: "match",
    });
  });

  it("IMP-06@PoC FR 1, IMP-05@PoC FR 4: the chosen recipe's IBAN is checked in the worker; another IBAN in the file is «чужий рахунок», masked to 4 characters in the answer and the audit", async () => {
    const space = await newSpace();
    const recipeId = await saveRecipe(space, { schemaVersion: 1, account: { by: "iban", value: IBAN } });
    const file = text([
      `IBAN;${OTHER_IBAN}`,
      "Дата;Сума;Опис",
      "15.03.2026;500.00;Зарплата",
      "20.03.2026;-60.00;Кава",
    ]);
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: file }]);
    await parse(space, batch.batchId, {
      files: [{ fileId: batch.fileIds[0], recipeId, accountId: space.eur }],
    });
    await work(space.householdId);
    const res = await view(space, batch.batchId);
    const body = res.json();
    expect(body.batch.state).toBe("needs-review");
    expect(body.files[0].recipe).toEqual({ id: recipeId, format: "unknown" });
    expect(body.files[0].checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "iban", file: "…4821", account: "…7654" }],
    });
    expect(leakText(res.body)).not.toContain(OTHER_IBAN);
    expect(leakText(res.body)).not.toContain(IBAN);
    const { rows } = await db.owner.query<{ changes: string }>(
      `SELECT changes::text AS changes FROM audit.entries WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.changes).not.toContain(OTHER_IBAN.slice(4));
      expect(r.changes).not.toContain("Зарплата");
      expect(r.changes).not.toContain("500");
    }
  });
});

describe("IMP-05@PoC FR 3: the previous statement of the account", () => {
  it("IMP-05@PoC AC2: the previous applied statement ends 2026-03-31 at 2 000,00 EUR, the new one starts 2026-04-15 at 2 300,00 — a gap of 300,00", async () => {
    const space = await newSpace();
    const march = text([
      "Вхідний залишок:;1800.00 EUR",
      "Дата;Сума;Опис",
      "01.03.2026;150.00;Зарплата",
      "31.03.2026;50.00;Повернення",
      "Кінцевий залишок:;2000.00 EUR",
    ]);
    const april = text([
      "Вхідний залишок:;2300.00 EUR",
      "Дата;Сума;Опис",
      "15.04.2026;100.00;Зарплата",
      "30.04.2026;-50.00;Кава",
      "Кінцевий залишок:;2350.00 EUR",
    ]);
    const previous = await batchWith(space, [{ name: "berezen.csv", bytes: march }]);
    await parse(space, previous.batchId, { files: [{ fileId: previous.fileIds[0], accountId: space.eur }] });
    await work(space.householdId);
    await db.owner.query(`UPDATE import_sessions.batches SET state = 'applied' WHERE id = $1`, [
      previous.batchId,
    ]);
    const next = await batchWith(space, [{ name: "kviten.csv", bytes: april }]);
    await parse(space, next.batchId, { files: [{ fileId: next.fileIds[0], accountId: space.eur }] });
    await work(space.householdId);
    expect((await view(space, next.batchId)).json().files[0]).toMatchObject({
      history: {
        status: "gap",
        range: { from: "2026-04-01", to: "2026-04-14" },
        difference: "300.00",
        currency: "EUR",
      },
      previousFileId: previous.fileIds[0],
    });
  });
});

describe("IMP-01@PoC «Права доступу»: another space gets «not found»", () => {
  it("IMP-01@PoC AC7: the parse, its rows and «Розібрати» of another space's batch are not found; a scoped member sees none", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const batch = await batchWith(owner, [{ name: "berezen.csv", bytes: CLEAN }]);
    expect((await parse(stranger, batch.batchId)).statusCode).toBe(404);
    await parse(owner, batch.batchId);
    await work(owner.householdId);
    expect((await view(stranger, batch.batchId)).statusCode).toBe(404);
    const rows = `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows`;
    expect((await call(stranger, "GET", rows)).statusCode).toBe(404);
    expect((await call(owner, "GET", rows, undefined, { scoped: true })).statusCode).toBe(404);
    expect((await call(owner, "GET", rows)).statusCode).toBe(200);
  });

  it("IMP-01@PoC AC7: another space's recipe or account, or a file not of the batch, is refused like an unknown one (422); nothing is queued", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const foreignRecipe = await saveRecipe(stranger, { schemaVersion: 1 });
    const batch = await batchWith(owner, [{ name: "berezen.csv", bytes: CLEAN }]);
    for (const [request, path] of [
      [{ fileId: batch.fileIds[0], recipeId: foreignRecipe }, "files[0].recipeId"],
      [{ fileId: batch.fileIds[0], accountId: stranger.eur }, "files[0].accountId"],
      [{ fileId: randomUUID() }, "files[0].fileId"],
    ] as const) {
      const res = await parse(owner, batch.batchId, { files: [request] });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ code: "IMPORT_PARSE_INVALID", errors: [{ path }] });
    }
    expect(
      await count(
        "import_sessions.jobs WHERE household_id = $1 AND name = $2",
        owner.householdId,
        PARSE_FILE_JOB.name,
      ),
    ).toBe(0);
  });
});

describe("#624: the technical ceilings of the parse step", () => {
  it("#624: a space's parse requests are bounded per hour — 429 with a retry time, never 402", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    await db.owner.query(
      `INSERT INTO import_sessions.jobs (household_id, name, dedupe_key, payload, heavy, state)
       SELECT $1, $2, 'filler:' || g, '{}', true, 'done' FROM generate_series(1, $3::int) g`,
      [space.householdId, PARSE_FILE_JOB.name, PARSE_FILES_PER_HOUR],
    );
    const res = await parse(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(429);
    expect(res.json().code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBe("3600");
    expect((await call(space, "GET", `/v1/import/batches/${batch.batchId}`)).json().state).toBe("uploaded");
  });

  it("ARC-04@PoC FR 4: a parse job in state dead goes back to the queue with the daily recovery and the batch is parsed", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [{ name: "berezen.csv", bytes: CLEAN }]);
    await parse(space, batch.batchId, { files: [{ fileId: batch.fileIds[0], accountId: space.eur }] });
    await db.owner.query(
      `UPDATE import_sessions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND name = $2`,
      [space.householdId, PARSE_FILE_JOB.name],
    );
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().batch.state).toBe("processing");
    const recovery = createImportSessionsHandOffRecovery(db.databases.for("import-sessions"), async () => [
      space.householdId,
    ]);
    expect(await recovery.run()).toBeGreaterThanOrEqual(1);
    await work(space.householdId);
    expect((await view(space, batch.batchId)).json().batch.state).toBe("parsed");
  });
});

describe("IMP-05@PoC EC3: a card statement's purchases abroad through the parse step", () => {
  /** A monobank-shaped card statement (synthetic rows): the card's currency in the amount header, «Валюта» the operation's. */
  const card = (code: string) =>
    Buffer.from(
      "﻿" +
        [
          [
            "Дата i час операції",
            "Деталі операції",
            "MCC",
            `Сума в валюті картки (${code})`,
            "Сума в валюті операції",
            "Валюта",
            "Курс",
            `Сума комісій (${code})`,
            `Сума кешбеку (${code})`,
            "Залишок після операції",
          ],
          [
            "20.11.2026 18:05:11",
            "Кав'ярня Тест",
            "5814",
            "-85.00",
            "-85.00",
            "UAH",
            "—",
            "—",
            "—",
            "9330.00",
          ],
          [
            "18.11.2026 09:15:42",
            "SYNTH SHOP ONLINE",
            "5732",
            "-415.00",
            "-10.00",
            "USD",
            "41.5000",
            "—",
            "—",
            "9415.00",
          ],
          [
            "15.11.2026 14:45:10",
            "SYNTH STORE EU",
            "5999",
            "-900.00",
            "-20.00",
            "EUR",
            "45.0000",
            "—",
            "—",
            "9830.00",
          ],
          [
            "11.11.2026 07:30:00",
            "Таксі Тест",
            "4121",
            "-150.00",
            "-150.00",
            "UAH",
            "—",
            "—",
            "—",
            "10730.00",
          ],
        ]
          .map((r) => r.map((c) => `"${c}"`).join(","))
          .join("\r\n") +
        "\r\n",
      "utf8",
    );

  it("IMP-05@PoC EC3, IMP-02@PoC FR 4: a UAH card file with USD and EUR purchases on the UAH account — no «чужий рахунок»; a USD card file still is one, «валюта» USD against UAH", async () => {
    const space = await newSpace();
    const uah = randomUUID();
    accountsOf.set(`${space.householdId}/${uah}`, {
      accountId: uah,
      kind: "current",
      status: "active",
      subaccounts: [{ subaccountId: randomUUID(), currency: "UAH", ledgerAccountId: randomUUID() }],
    });
    const batch = await batchWith(space, [
      { name: "card-uah.csv", bytes: card("UAH") },
      { name: "card-usd.csv", bytes: card("USD") },
    ]);
    const started = await parse(space, batch.batchId, {
      files: batch.fileIds.map((fileId) => ({ fileId, accountId: uah })),
    });
    expect(started.statusCode, started.body).toBe(200);
    await work(space.householdId);
    const body = (await view(space, batch.batchId)).json();
    const [own, foreign] = body.files;
    expect(own.checks.account.reasons).toEqual([]);
    expect(own.checks.flags.map((f: { code: string }) => f.code)).not.toContain("foreign-account");
    expect(foreign.checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "currency", file: "USD", account: "UAH" }],
    });
    const rows = await call(
      space,
      "GET",
      `/v1/import/batches/${batch.batchId}/files/${batch.fileIds[0]}/rows`,
    );
    expect(rows.json().items[1]).toMatchObject({
      legs: [{ amount: "-415.00", currency: "UAH" }],
      original: { amount: "-10.00", currency: "USD" },
    });
    // The readiness asks to confirm the USD file's account only.
    const ready = (await call(space, "GET", `/v1/import/batches/${batch.batchId}/readiness`)).json();
    const confirm = ready.refusals.find((r: { code: string }) => r.code === "confirm-account");
    expect(confirm.files.map((f: { fileId: string }) => f.fileId)).toEqual([batch.fileIds[1]]);
  });
});
