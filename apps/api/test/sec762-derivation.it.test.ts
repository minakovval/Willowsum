import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker, enqueueJob, type WorkerQueue } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createCategoryDirectory, createHistoryLabels } from "../src/modules/categories/index.ts";
import {
  categorizationRulePorts,
  createCategorizationErasure,
  createCategorizationServices,
  createCategorizationWorkerQueue,
  createHistoryDerivationCleanup,
  createHistoryDerivations,
  HISTORY_DERIVATION_JOB,
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
import { createMerchantDirectory } from "../src/modules/merchants/index.ts";
import { createTransactionLookup, createTransactionRuleInputs } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
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
      derive ? { source: rowsSource(), newId: randomUUID } : undefined,
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
          history: { source: rowsSource(), newId: randomUUID },
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

/**
 * Security review of PR #762 (BUD-21@PoC c, runs and routes): the properties the PR's own suite leaves without a
 * test that fails when the guard goes. Synthetic values only; the numbers are built at run time.
 */
const digits = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String((seed + i * 7) % 10)).join("");
const IBAN = `UA${digits(27, 3)}`;
const CARD = `4${digits(15, 5)}`;

describe("sec762: BUD-21@PoC «Права доступу», hard rule «Data access»", () => {
  it("sec762 BUD-21@PoC «Права доступу»: a scoped member gets 404 on both derivation routes and starts nothing", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    const scoped = (method: "GET" | "POST", url: string, body?: unknown, role = "viewer") =>
      app.inject({
        method,
        url,
        headers: {
          origin: WEB,
          ...principalHeader({ userId: randomUUID(), householdId: space.householdId, role, scoped: true }),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
    const read = await scoped("GET", `/v1/category-rule-derivations/${confirm.derivation.id}`);
    expect(read.statusCode, read.body).toBe(404);
    expect(leakText(read.body)).not.toContain("KAVA");
    // «Запис» is not a scoped member's at all (access-scope): refused before the handler.
    for (const role of ["editor", "viewer", "advisor"]) {
      const start = await scoped("POST", "/v1/category-rule-derivations", { batchId }, role);
      expect([403, 404]).toContain(start.statusCode);
      const again = await scoped(
        "GET",
        `/v1/category-rule-derivations/${confirm.derivation.id}`,
        undefined,
        role,
      );
      expect(again.statusCode).toBe(404);
      expect(leakText(again.body)).not.toContain("KAVA");
    }
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_derivations WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
  });

  it("sec762 BUD-21@PoC «Права доступу»: a role without «запис» (viewer, advisor) cannot start a derivation", async () => {
    const space = await newSpace();
    const { batchId } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    for (const role of ["viewer", "advisor", "nobody"]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/category-rule-derivations",
        headers: {
          origin: WEB,
          ...principalHeader({ userId: randomUUID(), householdId: space.householdId, role }),
          "content-type": "application/json",
        },
        payload: JSON.stringify({ batchId }),
      });
      expect(res.statusCode, res.body).toBe(403);
    }
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_derivations WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
  });

  it("sec762 BUD-21@PoC FR 10: a start for another space's batch writes no run, no job and no audit entry in either space", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { batchId } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    const count = async (sql: string) =>
      Number((await db.owner.query<{ n: string }>(sql, [[space.householdId, other.householdId]])).rows[0]!.n);
    const before = {
      runs: await count(
        `SELECT count(*) AS n FROM categorization.history_derivations WHERE household_id = ANY($1)`,
      ),
      jobs: await count(`SELECT count(*) AS n FROM categorization.jobs WHERE household_id = ANY($1)`),
    };
    const res = await call(other, "POST", "/v1/category-rule-derivations", { batchId });
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain(batchId);
    expect({
      runs: await count(
        `SELECT count(*) AS n FROM categorization.history_derivations WHERE household_id = ANY($1)`,
      ),
      jobs: await count(`SELECT count(*) AS n FROM categorization.jobs WHERE household_id = ANY($1)`),
    }).toEqual(before);
  });

  it("sec762 BUD-21@PoC FR 10: the background job carries the run's id only, and a job of one space never runs another space's derivation", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { confirm } = await confirmed(
      space,
      history(
        times(2_100, (i) => ({
          description: `MAGAZYN ${String.fromCharCode(65 + (i % 20))} KYIV`,
          category: "Дім",
        })),
      ),
    );
    expect(confirm.derivation).toMatchObject({ status: "running", background: true });
    const { rows: jobs } = await db.owner.query<{ household_id: string; payload: unknown }>(
      `SELECT household_id, payload FROM categorization.jobs WHERE name = 'categorization.history-derivation'
          AND payload->>'derivationId' = $1`,
      [confirm.derivation.id],
    );
    expect(jobs).toEqual([
      { household_id: space.householdId, payload: { derivationId: confirm.derivation.id } },
    ]);
    // The same run named by a job of another space: that space's worker finds no such run.
    await db.databases.for("categorization").inHousehold(other.householdId, (q) =>
      enqueueJob(q, HISTORY_DERIVATION_JOB, `history-derivation:${confirm.derivation.id}`, {
        derivationId: confirm.derivation.id,
      }),
    );
    await work(other.householdId);
    const { rows } = await db.owner.query<{ status: string; n: string }>(
      `SELECT d.status, (SELECT count(*) FROM categorization.history_suggestions s) AS n
         FROM categorization.history_derivations d WHERE d.id = $1`,
      [confirm.derivation.id],
    );
    expect(rows[0]!.status).toBe("running");
    const { rows: foreign } = await db.owner.query(
      `SELECT 1 FROM categorization.history_suggestions WHERE household_id = $1
       UNION ALL SELECT 1 FROM categorization.history_derivations WHERE household_id = $1`,
      [other.householdId],
    );
    expect(foreign).toHaveLength(0);
    await work(space.householdId);
    expect((await derivation(space, confirm.derivation.id)).derivation.status).toBe("completed");
  });
});

describe("sec762: what of the file reaches a response and the tables", () => {
  it("sec762 BUD-21@PoC FR 14: an IBAN or a card number of a description is masked in «винятки у файлі» and is in no condition, stored or shown", async () => {
    const space = await newSpace();
    const { confirm } = await confirmed(
      space,
      history(
        mixed(
          times(14, (i) => ({ description: `SILPO KYIV ${IBAN} chek ${i}`, category: "Продукти" })),
          [{ description: `SILPO KYIV ${CARD} chek 99`, category: "Дім" }],
        ),
      ),
    );
    const res = await call(space, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { suggestions: Suggestion[] };
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.some((s) => s.exceptions.items.length > 0)).toBe(true);
    const bare = res.body.replace(/[\s.-]/g, "");
    expect(bare).not.toContain(IBAN);
    expect(bare).not.toContain(CARD);
    const { rows } = await db.owner.query<{ text: string }>(
      `SELECT conditions::text || tags::text AS text FROM categorization.history_suggestions WHERE household_id = $1`,
      [space.householdId],
    );
    for (const r of rows) {
      expect(r.text).not.toContain(IBAN);
      expect(r.text).not.toContain(CARD);
    }
  });

  it("sec762 BUD-21@PoC FR 14: a suggestion lists at most 100 evidence rows and 100 exceptions; the counts stay whole", async () => {
    const space = await newSpace();
    const { confirm } = await confirmed(
      space,
      history(
        mixed(
          times(1_200, () => ({ description: "ATB MARKET", category: "Продукти" })),
          times(125, () => ({ description: "ATB MARKET", category: "Дім" })),
        ),
      ),
    );
    const { suggestions } = await derivation(space, confirm.derivation.id);
    const atb = suggestions.find((s) => s.matched === 1_325);
    expect(atb).toBeDefined();
    expect(atb!.evidence.rows).toHaveLength(100);
    expect(atb!.evidence.more).toBe(true);
    expect(atb!.exceptions.items).toHaveLength(100);
    expect(atb!.exceptions.count).toBe(125);
  });

  it("sec762 BUD-21@PoC FR 24: after «Видалити файл» a start for the file is not found and writes nothing", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    expect((await call(space, "DELETE", `/v1/import/history-files/${batchId}`)).statusCode).toBe(200);
    expect((await call(space, "POST", "/v1/category-rule-derivations", { batchId })).statusCode).toBe(404);
    const gone = await call(space, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`);
    expect(gone.statusCode).toBe(404);
    expect(leakText(gone.body)).not.toContain("KAVA");
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_derivations WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
  });

  it("sec762 BUD-21@PoC FR 10: a file read but not confirmed derives nothing", async () => {
    const space = await newSpace();
    const res = await upload(space, history(times(4, () => ({ description: "KAVA", category: "Кафе" }))));
    const batchId = res.json().batch.id as string;
    await work(space.householdId, false);
    expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).json().parseId).toBeTruthy();
    expect((await call(space, "POST", "/v1/category-rule-derivations", { batchId })).statusCode).toBe(404);
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_derivations WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(0);
  });

  it("sec762 BUD-21@PoC FR 24: a file whose deletion has begun is gone for the derivation — nothing shown, and the daily sweep takes its suggestions", async () => {
    const space = await newSpace();
    const { batchId, confirm } = await confirmed(
      space,
      history(times(4, () => ({ description: "KAVA", category: "Кафе" }))),
    );
    await db.owner.query(
      `UPDATE import_sessions.batches SET deleting_at = now() WHERE household_id = $1 AND id = $2`,
      [space.householdId, batchId],
    );
    const gone = await call(space, "GET", `/v1/category-rule-derivations/${confirm.derivation.id}`);
    expect(gone.statusCode).toBe(404);
    expect((await call(space, "POST", "/v1/category-rule-derivations", { batchId })).statusCode).toBe(404);
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

  it("sec762 NFR-12@PoC FR 3: the erasure of a space takes its derivations and suggestions; the neighbour keeps its own", async () => {
    const space = await newSpace();
    const neighbour = await newSpace();
    const file = () => history(times(4, () => ({ description: "KAVA", category: "Кафе" })));
    await confirmed(space, file());
    await confirmed(neighbour, file());
    const left = async (householdId: string) => {
      const out: Record<string, number> = {};
      for (const table of ["history_derivations", "history_suggestions"]) {
        const { rows } = await db.owner.query<{ n: string }>(
          `SELECT count(*) AS n FROM categorization.${table} WHERE household_id = $1`,
          [householdId],
        );
        out[table] = Number(rows[0]!.n);
      }
      return out;
    };
    expect(await left(space.householdId)).toEqual({ history_derivations: 1, history_suggestions: 1 });
    await createCategorizationErasure(db.databases.for("categorization")).eraseHousehold(space.householdId);
    expect(await left(space.householdId)).toEqual({ history_derivations: 0, history_suggestions: 0 });
    expect(await left(neighbour.householdId)).toEqual({ history_derivations: 1, history_suggestions: 1 });
  });
});
