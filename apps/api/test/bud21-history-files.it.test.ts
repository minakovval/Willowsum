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
import { XLSM_MAIN, xlsx } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import {
  createImportSessionsCleanup,
  createImportSessionsHandOffRecovery,
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
  PARSE_HISTORY_JOB,
} from "../src/modules/import-sessions/index.ts";
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
const DAY = 24 * 60 * 60 * 1000;
let now = Date.parse("2026-11-27T10:00:00Z");
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

const headers = (space: Space, scoped = false) => ({
  origin: WEB,
  ...principalHeader({
    userId: space.accountId,
    householdId: space.householdId,
    ...(scoped ? { role: "viewer", scoped: true } : {}),
  }),
});

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, scoped = false) {
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

const auditText = async (householdId: string) =>
  JSON.stringify(
    (await db.owner.query(`SELECT changes FROM audit.entries WHERE household_id = $1`, [householdId])).rows,
  );

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

describe("BUD-21@PoC FR 3: a history file is a batch of its own kind", () => {
  it("BUD-21@PoC FR 3: the upload stores the original as «файл історії» and reads it in the background (a heavy job); the batch is not in the history of imports", async () => {
    const space = await newSpace();
    const res = await upload(space, "istoriya.csv", HISTORY);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ existing: false, batch: { state: "processing", format: "csv" } });
    expect(
      await count(
        "import_sessions.jobs WHERE household_id = $1 AND name = $2 AND heavy",
        space.householdId,
        PARSE_HISTORY_JOB.name,
      ),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'history-file'", space.householdId),
    ).toBe(1);
    expect(
      await count("file_storage.files WHERE household_id = $1 AND kind = 'statement'", space.householdId),
    ).toBe(0);
    await work(space.householdId);
    expect((await call(space, "GET", `/v1/import/history-files/${body.batch.id}`)).json().batch.state).toBe(
      "parsed",
    );
    // Not in the history of imports, and «not found» to every statement step.
    expect((await call(space, "GET", "/v1/import/batches")).json().items).toEqual([]);
    expect((await call(space, "GET", `/v1/import/batches/${body.batch.id}`)).statusCode).toBe(404);
    expect((await call(space, "POST", `/v1/import/batches/${body.batch.id}/parse`, {})).statusCode).toBe(404);
  });

  it("BUD-21@PoC FR 3: the same file (SHA-256) as a history file still stored opens that batch; no second batch or original", async () => {
    const space = await newSpace();
    const first = await uploaded(space);
    now += DAY;
    const again = await upload(space, "insha-nazva.csv", HISTORY);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({ existing: true, batch: { id: first.batchId } });
    // Opening it again is an action with the batch (FR 24: the 30 days count from it).
    expect(again.json().batch.lastActionAt).toBe(new Date(now).toISOString());
    expect(await count("import_sessions.batches WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
  });

  it("BUD-21@PoC AC5: an XLSX book with macros is refused before its cells are read; no original, no batch, and neither the audit log nor the logs hold its content", async () => {
    const space = await newSpace();
    const res = await upload(
      space,
      "makros-istoriya.xlsx",
      xlsx({ main: XLSM_MAIN, vbaProject: true }),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe("FILE_REJECTED");
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await count("import_sessions.batches WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await auditText(space.householdId)).not.toContain("makros");
    expect(await exportedText(telemetry)).not.toContain("makros-istoriya");
  });

  it("BUD-21@PoC FR 3: an XLSX book without macros is stored as the statement's are; its read is refused as a statement's is until the Excel reader", async () => {
    const space = await newSpace();
    const res = await upload(space, "istoriya.xlsx", xlsx(), "application/vnd.ms-excel");
    expect(res.statusCode, res.body).toBe(201);
    await work(space.householdId);
    const view = (await call(space, "GET", `/v1/import/history-files/${res.json().batch.id}`)).json();
    expect(view.batch.state).toBe("failed");
    expect(view.parse.refusal.code).toBe("FORMAT_NOT_PARSED");
    expect(view.canConfirm).toBe(false);
  });

  it("BUD-21@PoC FR 3: another space's history file and a scoped member's request are «not found»", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { batchId } = await uploaded(space);
    expect((await call(other, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
    expect((await call(other, "DELETE", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
    expect(
      (await call(space, "GET", `/v1/import/history-files/${batchId}`, undefined, true)).statusCode,
    ).toBe(404);
  });
  it("BUD-21@PoC FR 3: with the release flag off the history file steps are «not found»; nothing is stored", async () => {
    const space = await newSpace();
    const off = buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags: fakeFlags({ off: ["categorization.history-rules"] }),
          authenticate: testAuthenticate,
          importSessions: createImportSessionsServices({
            files,
            audit,
            clock,
            newId: randomUUID,
            history: { keys, accounts },
          }),
          allowedOrigins: new Set([WEB]),
        }),
    });
    await off.ready();
    try {
      const res = await off.inject({
        method: "GET",
        url: `/v1/import/history-files/${randomUUID()}`,
        headers: headers(space),
      });
      expect(res.statusCode, res.body).toBe(404);
      const boundary = "ws-off";
      const up = await off.inject({
        method: "POST",
        url: "/v1/import/history-files",
        headers: { ...headers(space), "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n`,
          ),
          HISTORY,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect(up.statusCode, up.body).toBe(404);
      expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    } finally {
      await off.close();
    }
  });
});

describe("BUD-21@PoC FR 4, FR 5: the step «Перевірка розпізнавання»", () => {
  it("BUD-21@PoC FR 5: the roles with evidence and alternatives, rows as read, the file's categories, the transfer and account values and the summary", async () => {
    const space = await newSpace();
    const { view } = await uploaded(space);
    const r = view.recognition;
    expect(r.columns.map((c: { role: { chosen: { value: string } } }) => c.role.chosen.value)).toEqual([
      "date",
      "amount",
      "description",
      "category",
      "subcategory",
      "transfer-flag",
      "account",
    ]);
    expect(r.columns[3].role.evidence[0]).toMatchObject({ code: "header-word", word: "категорія" });
    expect(r.columns[3].role.alternatives.length).toBeGreaterThan(0);
    expect(r.dates.chosen.value).toMatchObject({ order: "dmy" });
    expect(r.examples[0]).toMatchObject({
      date: "2026-03-01",
      amount: "-120.50",
      description: "SILPO 1234 KYIV",
      category: "Їжа",
      subcategory: "Супермаркети",
      transfer: false,
      account: "Моно",
    });
    expect(r.labels.items).toEqual([
      { category: "Їжа", count: 2, subcategories: [{ name: "Супермаркети", count: 2 }] },
      { category: "Кав'ярні", count: 1, subcategories: [] },
    ]);
    expect(r.transfers.values).toEqual([
      { value: "витрата", count: 4, suggested: false, transfer: false },
      { value: "переказ", count: 1, suggested: true, transfer: true },
    ]);
    expect(r.accounts.values).toEqual([
      { value: "Моно", count: 3, accountId: null },
      { value: "Готівка", count: 1, accountId: null },
    ]);
    expect(r.missing).toEqual([]);
    expect(view.canConfirm).toBe(true);
  });

  it("BUD-21@PoC EC6: a row with neither a category nor a transfer mark is skipped with its reason and counted in the summary", async () => {
    const space = await newSpace();
    const { view } = await uploaded(space);
    expect(view.recognition.summary).toEqual({
      rows: 5,
      read: 4,
      transfers: 1,
      skipped: [{ reason: "no-categorisation", count: 1 }],
      tagsSkipped: 0,
    });
  });

  it("BUD-21@PoC AC3: a history file without a description and a counterparty column — the derivation is unavailable and the missing column is named", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(
      space,
      csv(["Дата;Сума;Категорія", "01.03.2026;-10,00;Кафе", "02.03.2026;-20,00;Кафе"]),
    );
    expect(view.recognition.missing).toEqual(["description"]);
    expect(view.canConfirm).toBe(false);
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: view.parseId,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: "HISTORY_NOT_READY", errors: [{ issue: "description" }] });
  });

  it("BUD-21@PoC AC4: date, amount and description but no category and no transfer mark — the derivation is unavailable: the file has no categorisation of the user", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(
      space,
      csv(["Дата;Сума;Опис", "01.03.2026;-10,00;Кава", "02.03.2026;-20,00;Хліб"]),
    );
    expect(view.recognition.missing).toEqual(["categories"]);
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: view.parseId,
    });
    expect(res.json()).toMatchObject({ code: "HISTORY_NOT_READY", errors: [{ issue: "categories" }] });
  });
});

describe("BUD-21@PoC FR 6: corrections and the confirmation", () => {
  const US = csv([
    "Date;Amount;Description;Category",
    "01/02/2026;-10.00;Coffee;Cafe",
    "03/04/2026;-20.00;Bread;Groceries",
    "05/06/2026;-30.00;Fuel;Car",
  ]);

  it("BUD-21@PoC AC9: dates read as month-day, the user picks day-month and confirms — the rows are read again with the new format", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, US);
    // No day over 12: the engine assumed an order; the user tells it.
    const before = view.recognition.examples.map((e: { date: string }) => e.date);
    const order = view.recognition.dates.chosen.value.order as string;
    const wanted = order === "dmy" ? "mdy" : "dmy";
    const reread = await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, {
      dateOrder: wanted,
    });
    expect(reread.statusCode, reread.body).toBe(200);
    expect(reread.json().batch.state).toBe("processing");
    // The read shown before is not the one confirmed.
    const stale = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: view.parseId,
    });
    expect(stale.statusCode, stale.body).toBe(409);
    await work(space.householdId);
    const after = (await call(space, "GET", `/v1/import/history-files/${batchId}`)).json();
    expect(after.recognition.dates.chosen.value.order).toBe(wanted);
    expect(after.recognition.examples.map((e: { date: string }) => e.date)).toEqual(
      before.map((d: string) => `${d.slice(0, 4)}-${d.slice(8, 10)}-${d.slice(5, 7)}`),
    );
    const confirmed = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: after.parseId,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().confirmed).not.toBeNull();
    expect(confirmed.json().recognition.examples[0].date).toBe(after.recognition.examples[0].date);
    // Confirmed: nothing more is corrected.
    const late = await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, {
      dateOrder: order,
    });
    expect(late.statusCode, late.body).toBe(409);
  });

  it("BUD-21@PoC FR 6: a column's role corrected in one step; the file is read again with it", async () => {
    const space = await newSpace();
    const { batchId } = await uploaded(space);
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, {
      columns: [{ column: 5, role: "ignore" }],
    });
    expect(res.statusCode, res.body).toBe(200);
    await work(space.householdId);
    const view = (await call(space, "GET", `/v1/import/history-files/${batchId}`)).json();
    expect(view.recognition.columns[4].role.chosen.value).toBe("ignore");
    expect(view.recognition.columns[4].role.evidence[0]).toMatchObject({ code: "user-choice" });
    expect(view.recognition.labels.items[0]).toEqual({ category: "Їжа", count: 2, subcategories: [] });
  });

  it("BUD-21@PoC FR 6: the encoding, the delimiter and the header row corrected; the file is read again with them", async () => {
    const space = await newSpace();
    const { batchId } = await uploaded(space);
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, {
      encoding: "windows-1251",
      delimiter: ",",
      headerRow: 1,
    });
    expect(res.statusCode, res.body).toBe(200);
    await work(space.householdId);
    const view = (await call(space, "GET", `/v1/import/history-files/${batchId}`)).json();
    expect(view.recognition.encoding.chosen.value).toBe("windows-1251");
    expect(view.recognition.delimiter.chosen.value).toBe(",");
    expect(view.recognition.table.headerRow).toBe(1);
    expect(
      (await call(space, "POST", `/v1/import/history-files/${batchId}/reading`, { delimiter: "x" }))
        .statusCode,
    ).toBe(400);
  });

  it("BUD-21@PoC FR 6: the transfer values and the accounts the user answers are kept; a value the file does not have, or another space's account, is refused", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { batchId, view } = await uploaded(space);
    const confirm = (body: object) =>
      call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, { parseId: view.parseId, ...body });
    expect((await confirm({ transferValues: ["інше"] })).json()).toMatchObject({
      code: "HISTORY_ANSWER_INVALID",
      errors: [{ path: "transferValues[0]" }],
    });
    expect((await confirm({ accounts: [{ value: "Моно", accountId: other.mono }] })).statusCode).toBe(422);
    expect((await confirm({ accounts: [{ value: "Картка", accountId: space.mono }] })).statusCode).toBe(422);
    const res = await confirm({
      transferValues: [],
      accounts: [
        { value: "Моно", accountId: space.mono },
        { value: "Готівка", accountId: null },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json().recognition;
    // No value marks a transfer now: the «переказ» row has no category, so it is skipped (EC6).
    expect(r.summary).toMatchObject({
      read: 3,
      transfers: 0,
      skipped: [{ reason: "no-categorisation", count: 2 }],
    });
    expect(r.accounts.values).toEqual([
      { value: "Моно", count: 2, accountId: space.mono },
      { value: "Готівка", count: 1, accountId: null },
    ]);
    expect((await confirm({})).statusCode).toBe(409);
  });

  it("BUD-21@PoC FR 1, AC10: a confirmed history file creates no transaction and is never applied — balances, budget and «До розбору» stay as they were", async () => {
    const space = await newSpace();
    const before = {
      transactions: await count("transactions.transactions WHERE household_id = $1", space.householdId),
      postings: await count("ledger.postings WHERE household_id = $1", space.householdId),
      categories: await count("categories.categories WHERE household_id = $1", space.householdId),
    };
    const { batchId, view } = await uploaded(space);
    const res = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
      parseId: view.parseId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call(space, "POST", `/v1/import/batches/${batchId}/apply`, {})).statusCode).toBe(404);
    expect({
      transactions: await count("transactions.transactions WHERE household_id = $1", space.householdId),
      postings: await count("ledger.postings WHERE household_id = $1", space.householdId),
      categories: await count("categories.categories WHERE household_id = $1", space.householdId),
    }).toEqual(before);
  });

  it("BUD-21@PoC EC9: closed without a confirmation — nothing is created and the file stays an unapplied batch to come back to", async () => {
    const space = await newSpace();
    const categories = await count("categories.categories WHERE household_id = $1", space.householdId);
    const { batchId } = await uploaded(space);
    now += 29 * DAY;
    const later = await call(space, "GET", `/v1/import/history-files/${batchId}`);
    expect(later.statusCode).toBe(200);
    expect(later.json()).toMatchObject({ confirmed: null, canConfirm: true, batch: { state: "parsed" } });
    expect(await count("categories.categories WHERE household_id = $1", space.householdId)).toBe(categories);
    expect(await count("transactions.transactions WHERE household_id = $1", space.householdId)).toBe(0);
  });
});

describe("BUD-21@PoC FR 24, FR 26: keeping and deleting the file, the audit log", () => {
  const cleanup = (householdId: string) =>
    createImportSessionsCleanup({
      db: db.databases.for("import-sessions"),
      files,
      audit,
      households: async () => [householdId],
      now: clock.now,
      newId: randomUUID,
    }).run();

  it("BUD-21@PoC AC30: a history file analysed 31 days ago goes with the daily cleanup — its original and its rows — and the audit log has the system's entry", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space);
    await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, { parseId: view.parseId });
    const recent = await uploaded(space, csv(["Дата;Сума;Опис;Категорія", "01.03.2026;-10,00;Кава;Кафе"]));
    now += 31 * DAY;
    await call(space, "GET", `/v1/import/history-files/${recent.batchId}`);
    await call(space, "POST", `/v1/import/history-files/${recent.batchId}/reading`, {});
    await work(space.householdId);
    expect(await cleanup(space.householdId)).toBe(1);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
    expect(
      await count(
        "import_sessions.history_parses WHERE household_id = $1 AND batch_id = $2",
        space.householdId,
        batchId,
      ),
    ).toBe(0);
    expect(
      await count(
        "import_sessions.batch_files WHERE household_id = $1 AND batch_id = $2",
        space.householdId,
        batchId,
      ),
    ).toBe(0);
    // The recent one stays (its re-read is an action).
    expect((await call(space, "GET", `/v1/import/history-files/${recent.batchId}`)).statusCode).toBe(200);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    const { rows } = await db.owner.query<{ changes: unknown }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch'
         AND entity_id = $2 AND action = 'delete' AND actor_kind = 'system'`,
      [space.householdId, batchId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "kind", before: "history", after: null })]),
    );
  });

  it("BUD-21@PoC FR 24: «Видалити файл» removes the original and the rows now; the user's entry is in the audit log", async () => {
    const space = await newSpace();
    const { batchId } = await uploaded(space);
    const res = await call(space, "DELETE", `/v1/import/history-files/${batchId}`);
    expect(res.statusCode, res.body).toBe(200);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
    expect(await count("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await count("import_sessions.history_parses WHERE household_id = $1", space.householdId)).toBe(0);
    expect(
      await count(
        "audit.entries WHERE household_id = $1 AND entity_id = $2 AND action = 'delete' AND actor_kind = 'user'",
        space.householdId,
        batchId,
      ),
    ).toBe(1);
  });

  it("BUD-21@PoC FR 26: the upload, the read and the confirmation are audit entries — kinds, states and counts, never the file's name, labels, descriptions or amounts", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, HISTORY, "taemna-istoriya.csv");
    await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, { parseId: view.parseId });
    const { rows } = await db.owner.query<{ action: string; changes: { field: string }[] }>(
      `SELECT action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch'
       ORDER BY occurred_at, id`,
      [space.householdId],
    );
    expect(rows.map((r) => r.changes.map((c) => c.field))).toEqual([
      ["kind", "state", "files.accepted"],
      ["state", "history.rows", "history.missing"],
      ["history.confirmed", "history.read", "history.transfers", "history.skipped"],
    ]);
    const text = await auditText(space.householdId);
    for (const secret of ["taemna", "SILPO", "Супермаркети", "Моно", "120.50", "120,50", "Вигадка"])
      expect(text).not.toContain(secret);
    const logs = await exportedText(telemetry);
    for (const secret of ["taemna", "SILPO", "Супермаркети"]) expect(logs).not.toContain(secret);
  });

  it("ARC-04@PoC FR 4: a history file's read job in state dead goes back to the queue with the daily recovery and the file is read", async () => {
    const space = await newSpace();
    const res = await upload(space, "istoriya.csv", HISTORY);
    const batchId = res.json().batch.id as string;
    await db.owner.query(
      `UPDATE import_sessions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND name = $2`,
      [space.householdId, PARSE_HISTORY_JOB.name],
    );
    await work(space.householdId);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).json().batch.state).toBe(
      "processing",
    );
    const recovery = createImportSessionsHandOffRecovery(db.databases.for("import-sessions"), async () => [
      space.householdId,
    ]);
    expect(await recovery.run()).toBeGreaterThanOrEqual(1);
    await work(space.householdId);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).json().batch.state).toBe(
      "parsed",
    );
  });
});
