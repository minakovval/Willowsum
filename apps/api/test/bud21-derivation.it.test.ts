import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker, type WorkerQueue } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createCategoryDirectory, createHistoryLabels } from "../src/modules/categories/index.ts";
import {
  categorizationRulePorts,
  createCategorizationRecovery,
  createCategorizationServices,
  createCategorizationWorkerQueue,
  createHistoryDerivationCleanup,
  createHistoryDerivations,
} from "../src/modules/categorization/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createHistoryBatchDirectory,
  createHistoryDerivationRows,
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createMerchantDirectory, normalizeDescription } from "../src/modules/merchants/index.ts";
import { createTransactionLookup, createTransactionRuleInputs } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» c) (wave 2 row 235): the derivation of rules from a confirmed history file on
 * a real PostgreSQL — started by the confirmation, up to 2 000 rows in the request and more in the background with
 * progress, a second start while one runs, the merchants by module merchants' cleaning (none born), the account
 * condition only for a matched account, «винятки у файлі», tags, the same suggestions twice, 20 000 rows within 60
 * seconds, a dead job and its daily recovery, another space and the flag off, the audit entry without the file's
 * content, and the daily sweep after «Видалити файл». Every file, merchant and amount is synthetic.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-28T10:00:00Z");
const clock = { now: () => NOW };
const FLAG = "categorization.history-rules";
const off = new Set<string>();
const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;

/** «Моно» of the space: an active account in UAH. Any other id is not the space's. */
const MONO = randomUUID();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (_householdId, accountId) =>
    accountId === MONO
      ? ({
          accountId: MONO,
          kind: "cash",
          status: "active",
          subaccounts: [{ subaccountId: randomUUID(), currency: "UAH", ledgerAccountId: randomUUID() }],
        } as unknown as PostingAccount)
      : null,
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

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

function upload(space: Space, bytes: Buffer) {
  const boundary = `ws-${randomUUID()}`;
  return app.inject({
    method: "POST",
    url: "/v1/import/history-files",
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="istoriya.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

interface Line {
  readonly description: string;
  readonly category: string;
  readonly amount?: string;
  readonly account?: string;
  readonly tags?: string;
}

/** A history file: one row a day from 1 January 2025 (dates as «дд.мм.рррр»), in the order given. */
function history(lines: readonly Line[]): Buffer {
  const out = ["Дата;Сума;Опис;Категорія;Рахунок;Теги"];
  lines.forEach((l, i) => {
    const day = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
    const date = `${String(day.getUTCDate()).padStart(2, "0")}.${String(day.getUTCMonth() + 1).padStart(2, "0")}.${day.getUTCFullYear()}`;
    out.push(
      `${date};${l.amount ?? "-120,00"};${l.description};${l.category};${l.account ?? ""};${l.tags ?? ""}`,
    );
  });
  return Buffer.from(out.join("\r\n") + "\r\n", "utf8");
}

const times = (n: number, line: (i: number) => Line) => Array.from({ length: n }, (_, i) => line(i));
/** By turns, so no category ends the file (no change of habit, FR 15). */
function mixed(...groups: Line[][]): Line[] {
  const out: Line[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++)
    for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out;
}

const transferDirectory = () =>
  createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
const rowsSource = () =>
  createHistoryDerivationRows({ db: db.databases.for("import-sessions"), keys, accounts });
const merchantNames = () =>
  categorizationRulePorts({
    accounts: accounts as AccountDirectory,
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    inputs: createTransactionRuleInputs(db.databases.for("transactions")),
  }).merchants;

function queues(derive = true): WorkerQueue[] {
  const parser = isolatedStatementParser();
  return [
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
    createCategorizationWorkerQueue(
      db.databases.for("categorization"),
      audit,
      createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID }),
      categorizationRulePorts({
        accounts: accounts as AccountDirectory,
        merchants: createMerchantDirectory(db.databases.for("merchants")),
        inputs: createTransactionRuleInputs(db.databases.for("transactions")),
      }),
      { isEnabled },
      clock,
      derive ? { source: rowsSource(), newId: randomUUID, transfers: transferDirectory() } : undefined,
    ),
  ];
}

async function work(householdId: string, derive = true): Promise<void> {
  const worker = createWorker({
    queues: queues(derive),
    households: async () => [householdId],
    retryDelayMs: () => 0,
  });
  try {
    for (let i = 0; i < 12; i++) {
      if ((await worker.tick()) === 0) break;
      await worker.idle();
    }
  } finally {
    await worker.stop();
  }
}

/** Uploaded, read by the worker and confirmed with the engine's suggestions (and `extra`). */
async function confirmed(space: Space, bytes: Buffer, extra: object = {}) {
  const res = await upload(space, bytes);
  expect(res.statusCode, res.body).toBe(201);
  const batchId = res.json().batch.id as string;
  await work(space.householdId, false);
  const view = await call(space, "GET", `/v1/import/history-files/${batchId}`);
  expect(view.statusCode, view.body).toBe(200);
  const done = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
    parseId: view.json().parseId,
    ...extra,
  });
  expect(done.statusCode, done.body).toBe(200);
  return { batchId, view: view.json(), confirm: done.json() };
}

interface Suggestion {
  kind: string;
  conditions: { field: string; operator: string; value: unknown }[];
  categoryId: string;
  matched: number;
  agreeing: number;
  since: string | null;
  tags: string[];
  evidence: { rows: number[]; more: boolean };
  exceptions: {
    items: { row: number; date: string; amount: string; description: string | null }[];
    count: number;
  };
}

async function derivation(space: Space, id: string) {
  const res = await call(space, "GET", `/v1/category-rule-derivations/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    derivation: { status: string; processed: number; count: number };
    suggestions: Suggestion[];
  };
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM categories.categories WHERE household_id = $1 AND name = $2`,
    [householdId, name],
  );
  return rows[0]!.id;
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
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabled },
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          history: {
            keys,
            accounts,
            labels: createHistoryLabels({
              db: db.databases.for("categories"),
              audit,
              newId: randomUUID,
              clock,
            }),
            derivation: createHistoryDerivations({
              db: db.databases.for("categorization"),
              source: rowsSource(),
              merchants: merchantNames(),
              transfers: transferDirectory(),
              audit,
              newId: randomUUID,
              clock,
            }),
          },
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
          rules: categorizationRulePorts({
            accounts: accounts as AccountDirectory,
            merchants: createMerchantDirectory(db.databases.for("merchants")),
            inputs: createTransactionRuleInputs(db.databases.for("transactions")),
          }),
          clock,
          history: { source: rowsSource(), newId: randomUUID, transfers: transferDirectory() },
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

describe("BUD-21@PoC FR 10: the derivation after the confirmation", () => {
  it("BUD-21@PoC AC11: the confirmation derives a confident «Мерчант дорівнює Сільпо → Продукти» over 15 rows, 14 agreeing, the «Дім» row an exception in the file with its date, amount and description", async () => {
    const space = await newSpace();
    const lines = [
      ...times(7, () => ({ description: "SILPO", category: "Продукти" })),
      { description: "SILPO", category: "Дім", amount: "-640,00" },
      ...times(7, () => ({ description: "SILPO", category: "Продукти" })),
    ];
    const { confirm } = await confirmed(space, history(lines));
    expect(confirm.derivation).toMatchObject({
      status: "completed",
      background: false,
      count: 15,
      processed: 15,
    });
    const { suggestions } = await derivation(space, confirm.derivation.id);
    expect(suggestions).toHaveLength(1);
    const [s] = suggestions;
    expect(s).toMatchObject({
      kind: "confident",
      conditions: [{ field: "merchant", operator: "equals" }],
      categoryId: await categoryNamed(space.householdId, "Продукти"),
      matched: 15,
      agreeing: 14,
      since: null,
    });
    expect(s!.exceptions).toEqual({
      count: 1,
      items: [
        {
          row: 9,
          date: "2025-01-08",
          amount: "-640.00",
          currency: null,
          description: "SILPO",
          categoryId: await categoryNamed(space.householdId, "Дім"),
        },
      ],
    });
    expect(s!.evidence.rows).toHaveLength(14);
  });

  it("BUD-21@PoC AC12: «SILPO 1234 KYIV», «SILPO 0456 LVIV» and the like are one merchant by the cleaning of descriptions, one suggestion, and no merchant is created in the space", async () => {
    const space = await newSpace();
    const texts = [
      "SILPO 1234 KYIV",
      "SILPO 0456 LVIV",
      "SILPO 0789 ODESA",
      "SILPO 1111 KYIV",
      "SILPO 2222 LVIV",
      "SILPO 3333 DNIPRO",
    ];
    const { confirm } = await confirmed(
      space,
      history(texts.map((description) => ({ description, category: "Продукти" }))),
    );
    const { suggestions } = await derivation(space, confirm.derivation.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      matched: 6,
      conditions: [{ field: "merchant", operator: "equals" }],
    });
    const { rows } = await db.owner.query(`SELECT 1 FROM merchants.merchants WHERE household_id = $1`, [
      space.householdId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("BUD-21@PoC FR 9: the merchant comes from the counterparty column when the file has one (the descriptions differ), by the same cleaning, read only", async () => {
    const space = await newSpace();
    const out = ["Дата;Сума;Опис;Контрагент;Категорія"];
    for (let i = 0; i < 5; i++)
      out.push(`0${i + 1}.02.2025;-310,00;Покупка товарів ${i};ТОВ «НОВА ЛІНІЯ»;Дім`);
    const { confirm } = await confirmed(space, Buffer.from(out.join("\r\n") + "\r\n", "utf8"));
    const { suggestions } = await derivation(space, confirm.derivation.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.conditions).toEqual([
      { field: "merchant", operator: "equals", value: normalizeDescription("ТОВ «НОВА ЛІНІЯ»")!.name },
    ]);
    const { rows } = await db.owner.query(`SELECT 1 FROM merchants.merchants WHERE household_id = $1`, [
      space.householdId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("BUD-21@PoC AC13: «Рахунок дорівнює» only for «Моно», the value matched with the space's account; «Готівка» gets no such condition", async () => {
    const space = await newSpace();
    const lines = mixed(
      times(6, () => ({ description: "RYNOK", category: "Продукти", account: "Моно" })),
      times(6, () => ({ description: "RYNOK", category: "Дім", account: "Готівка" })),
    );
    const { confirm } = await confirmed(space, history(lines), {
      accounts: [
        { value: "Моно", accountId: MONO },
        { value: "Готівка", accountId: null },
      ],
    });
    const { suggestions } = await derivation(space, confirm.derivation.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "confident",
      matched: 6,
      categoryId: await categoryNamed(space.householdId, "Продукти"),
      conditions: [{ field: "merchant" }, { field: "account", operator: "equals", value: MONO }],
    });
  });

  it("BUD-21@PoC AC19: 9 of 10 «Netflix» rows of «Підписки» tagged «родина» give the actions «категорія Підписки» and «тег родина»; a value over 60 characters is no tag and counts in the summary", async () => {
    const space = await newSpace();
    const long = "д".repeat(61);
    const lines = [
      ...times(9, (i) => ({
        description: "NETFLIX",
        category: "Підписки",
        tags: i === 0 ? `родина, ${long}` : "Родина",
      })),
      { description: "NETFLIX", category: "Підписки" },
    ];
    const { confirm, view } = await confirmed(space, history(lines));
    expect(view.recognition.summary.tagsSkipped).toBe(1);
    const { suggestions } = await derivation(space, confirm.derivation.id);
    expect(suggestions[0]).toMatchObject({
      categoryId: await categoryNamed(space.householdId, "Підписки"),
      tags: ["родина"],
    });
  });

  it("BUD-21@PoC AC29: the same file, answers and rules derived twice give the same suggestions, numbers and order", async () => {
    const space = await newSpace();
    const lines = mixed(
      times(16, (i) => ({ description: "SHELL", category: "Пальне", amount: `-${900 + i},00` })),
      times(8, () => ({ description: "SHELL", category: "Кафе", amount: "-95,00" })),
      times(12, (i) => ({ description: `Внесок ОСББ ${i}`, category: "Комунальні" })),
    );
    const { batchId, confirm } = await confirmed(space, history(lines));
    const first = await derivation(space, confirm.derivation.id);
    const again = await call(space, "POST", "/v1/category-rule-derivations", { batchId });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({ started: true, derivation: { status: "completed" } });
    const second = await derivation(space, again.json().derivation.id);
    expect(second.suggestions).toEqual(first.suggestions);
    expect(first.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("BUD-21@PoC FR 26: the start of a derivation is in the audit log — its batch and the number of rows, nothing of the file", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(5, () => ({ description: "АПТЕКА ДОБРОГО ДНЯ", category: "Здоров'я" }))),
    );
    const { rows } = await db.owner.query<{
      action: string;
      changes: { field: string; after: string | null }[];
    }>(
      `SELECT action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'categorization.history-derivation'
          AND entity_id = $2`,
      [space.householdId, confirm.derivation.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("create");
    expect(Object.fromEntries(rows[0]!.changes.map((c) => [c.field, c.after]))).toEqual({
      batchId,
      count: "5",
      status: "running",
    });
    const { rows: all } = await db.owner.query<{ text: string }>(
      `SELECT changes::text AS text FROM audit.entries WHERE household_id = $1`,
      [space.householdId],
    );
    expect(all.some((r) => /АПТЕКА|Здоров/u.test(r.text))).toBe(false);
  });
});

describe("BUD-21@PoC FR 10: in the background with progress", () => {
  /** A file of `n` rows over 50 merchants of 5 categories (one category each). */
  const big = (n: number) =>
    history(
      times(n, (i) => ({
        description: `MAGAZYN ${String.fromCharCode(65 + (i % 25))}${String.fromCharCode(65 + ((i * 7) % 2))} KYIV`,
        category: `Категорія ${i % 5}`,
      })),
    );

  it("BUD-21@PoC EC10: a start while the derivation runs starts nothing and shows the first one's progress; the worker then completes it", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(space, big(2_500));
    expect(confirm.derivation).toMatchObject({
      status: "running",
      background: true,
      count: 2_500,
      processed: 0,
    });
    const second = await call(space, "POST", "/v1/category-rule-derivations", { batchId });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json()).toMatchObject({
      started: false,
      derivation: { id: confirm.derivation.id, status: "running" },
    });
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_derivations WHERE household_id = $1 AND batch_id = $2`,
      [space.householdId, batchId],
    );
    expect(rows).toHaveLength(1);
    await work(space.householdId);
    const done = await derivation(space, confirm.derivation.id);
    expect(done.derivation).toMatchObject({ status: "completed", processed: 2_500 });
    expect(done.suggestions.length).toBeGreaterThan(0);
    // Two starts at once after it: one new run; the other shows it.
    const both = await Promise.all([
      call(space, "POST", "/v1/category-rule-derivations", { batchId }),
      call(space, "POST", "/v1/category-rule-derivations", { batchId }),
    ]);
    expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(both.map((r) => r.json().started as boolean).sort()).toEqual([false, true]);
    expect(new Set(both.map((r) => r.json().derivation.id as string)).size).toBe(1);
  });

  it("BUD-21@PoC AC31: a file of 20 000 rows (the header and 19 999) is derived in the background with progress and completes within 60 seconds", async () => {
    const space = await newSpace();
    const { confirm } = await confirmed(space, big(19_999));
    expect(confirm.derivation).toMatchObject({ status: "running", background: true, count: 19_999 });
    // «оброблено X з N»: what the run committed while it read the merchants, part by part.
    const seen: number[] = [];
    const names = merchantNames();
    const watching = {
      async knownNames(householdId: string, texts: readonly string[]) {
        const { rows } = await db.owner.query<{ processed: number }>(
          `SELECT processed FROM categorization.history_derivations WHERE household_id = $1 AND id = $2`,
          [householdId, confirm.derivation.id],
        );
        seen.push(rows[0]!.processed);
        return names.knownNames(householdId, texts);
      },
      names: names.names,
    };
    const started = performance.now();
    const worker = createWorker({
      queues: [
        createCategorizationWorkerQueue(
          db.databases.for("categorization"),
          audit,
          createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID }),
          {
            ...categorizationRulePorts({
              accounts: accounts as AccountDirectory,
              merchants: createMerchantDirectory(db.databases.for("merchants")),
              inputs: createTransactionRuleInputs(db.databases.for("transactions")),
            }),
            merchants: watching,
          },
          { isEnabled },
          clock,
          { source: rowsSource(), newId: randomUUID, transfers: transferDirectory() },
        ),
      ],
      households: async () => [space.householdId],
      retryDelayMs: () => 0,
    });
    try {
      for (let i = 0; i < 4; i++) {
        if ((await worker.tick()) === 0) break;
        await worker.idle();
      }
    } finally {
      await worker.stop();
    }
    expect(performance.now() - started).toBeLessThan(60_000);
    expect(seen).toHaveLength(20);
    expect(seen.slice(1)).toEqual(Array.from({ length: 19 }, (_, i) => (i + 1) * 1000));
    const done = await derivation(space, confirm.derivation.id);
    expect(done.derivation).toMatchObject({ status: "completed", processed: 19_999, count: 19_999 });
  }, 180_000);

  it("BUD-21@PoC FR 10: a derivation job in state `dead` goes back with the daily recovery and completes the run", async () => {
    const space = await newSpace();
    const { confirm } = await confirmed(space, big(2_100));
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'categorization.history-derivation'`,
      [space.householdId],
    );
    await work(space.householdId);
    expect((await derivation(space, confirm.derivation.id)).derivation.status).toBe("running");
    const requeued = await createCategorizationRecovery(db.databases.for("categorization"), async () => [
      space.householdId,
    ]).run();
    expect(requeued).toBeGreaterThanOrEqual(1);
    await work(space.householdId);
    expect((await derivation(space, confirm.derivation.id)).derivation).toMatchObject({
      status: "completed",
      processed: 2_100,
    });
  });
});

describe("BUD-21@PoC FR 24, «Права доступу»: the space, the flag and the file gone", () => {
  it("BUD-21@PoC FR 10: another space's batch or derivation is not found; a batch not confirmed has nothing to derive from", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(3, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    expect((await call(other, "POST", "/v1/category-rule-derivations", { batchId })).statusCode).toBe(404);
    expect(
      (await call(other, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`)).statusCode,
    ).toBe(404);
    const res = await upload(space, history(times(3, () => ({ description: "CHAI", category: "Кафе" }))));
    const pending = res.json().batch.id as string;
    expect(
      (await call(space, "POST", "/v1/category-rule-derivations", { batchId: pending })).statusCode,
    ).toBe(404);
    expect(
      (await call(space, "POST", "/v1/category-rule-derivations", { batchId: randomUUID() })).statusCode,
    ).toBe(404);
  });

  it("BUD-21@PoC FR 10: with the flag `categorization.history-rules` off the derivation routes are not found", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(3, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    off.add(FLAG);
    try {
      expect((await call(space, "POST", "/v1/category-rule-derivations", { batchId })).statusCode).toBe(404);
      expect(
        (await call(space, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`)).statusCode,
      ).toBe(404);
    } finally {
      off.delete(FLAG);
    }
  });

  it("BUD-21@PoC FR 24: after «Видалити файл» the suggestions are not shown, and the daily sweep removes the derivation with them", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    expect((await derivation(space, confirm.derivation.id)).suggestions).toHaveLength(1);
    expect((await call(space, "DELETE", `/v1/import/history-files/${batchId}`)).statusCode).toBe(200);
    expect(
      (await call(space, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`)).statusCode,
    ).toBe(404);
    const forgotten = await createHistoryDerivationCleanup({
      db: db.databases.for("categorization"),
      source: createHistoryBatchDirectory(db.databases.for("import-sessions")),
      households: async () => [space.householdId],
    }).run();
    expect(forgotten).toBe(1);
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_suggestions WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(0);
  });
});
