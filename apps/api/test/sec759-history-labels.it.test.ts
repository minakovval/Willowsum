import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createHistoryLabels } from "../src/modules/categories/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #759 (the harness of bud21-label-matching.it.test.ts).
 * BUD-21@PoC «Правила з історії розбору» b) (wave 2 row 234), module categories through import-sessions' history
 * routes on a real PostgreSQL: the labels of a history file matched with the space's tree on the step «Перевірка
 * розпізнавання», the missing categories created at the confirmation with one audit entry, the matching remembered for
 * the next file. Every file and label is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-27T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const accounts: Pick<AccountDirectory, "postingAccount"> = { postingAccount: async () => null };

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

type Who = { role?: "owner" | "admin" | "editor" | "viewer"; scoped?: boolean };
let who: Who = {};
const headers = (space: Space) => ({
  origin: WEB,
  ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...who } as never),
});
/** Fails the sealing of the confirmation's answers: the batch's transaction rolls back after module categories committed. */
let failAnswersSeal = 0;

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { ...headers(space), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

function upload(space: Space, bytes: Buffer) {
  const boundary = `ws-${randomUUID()}`;
  return app.inject({
    method: "POST",
    url: "/v1/import/history-files",
    headers: { ...headers(space), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="istoriya.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

/** A file of rows `[category, subcategory, amount]` (amounts as printed), one day each. */
function history(rows: readonly (readonly [string, string, string])[], description = "Покупка"): Buffer {
  const lines = ["Дата;Сума;Опис;Категорія;Підкатегорія"];
  rows.forEach(([category, subcategory, amount], i) => {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    const date = `${String(day.getUTCDate()).padStart(2, "0")}.${String(day.getUTCMonth() + 1).padStart(2, "0")}.${day.getUTCFullYear()}`;
    lines.push(`${date};${amount};${description} ${i};${category};${subcategory}`);
  });
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}

const times = (n: number, row: readonly [string, string, string]) => Array.from({ length: n }, () => row);

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

async function uploaded(space: Space, bytes: Buffer) {
  const res = await upload(space, bytes);
  expect(res.statusCode, res.body).toBe(201);
  const batchId = res.json().batch.id as string;
  await work(space.householdId);
  const view = await call(space, "GET", `/v1/import/history-files/${batchId}`);
  expect(view.statusCode, view.body).toBe(200);
  return { batchId, view: view.json() };
}

interface MappedLabel {
  category: string;
  subcategory: string | null;
  rows: number;
  outcome: Record<string, unknown> & { action: string };
  questions: string[];
}
const mapped = (
  view: { recognition: { mapping: { labels: MappedLabel[] } } },
  category: string,
  sub: string | null = null,
) => view.recognition.mapping.labels.find((l) => l.category === category && l.subcategory === sub)!;

async function categories(householdId: string) {
  const { rows } = await db.owner.query<{
    id: string;
    name: string;
    group_name: string;
    kind: string;
    state: string;
    history_kind: string | null;
  }>(
    `SELECT c.id, c.name, g.name AS group_name, c.kind, c.state, g.history_kind
       FROM categories.categories c JOIN categories.category_groups g ON g.household_id = c.household_id AND g.id = c.group_id
      WHERE c.household_id = $1`,
    [householdId],
  );
  return rows;
}
const named = async (householdId: string, name: string) =>
  (await categories(householdId)).find((c) => c.name === name);

async function auditOf(householdId: string, entityType: string) {
  const { rows } = await db.owner.query<{
    action: string;
    changes: { field: string; after: string | null }[];
  }>(`SELECT action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = $2`, [
    householdId,
    entityType,
  ]);
  return rows;
}

const confirm = (space: Space, batchId: string, parseId: string, extra: object = {}) =>
  call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, { parseId, ...extra });

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
          history: {
            keys: {
              openBytes: (h: string, p: string, b: Uint8Array) => keys.openBytes(h, p, b),
              sealBytes: async (h: string, p: string, b: Uint8Array) => {
                if (p.startsWith("history-answers:") && failAnswersSeal > 0) {
                  failAnswersSeal -= 1;
                  throw new Error("sec759: key service unavailable");
                }
                return keys.sealBytes(h, p, b);
              },
            },
            accounts,
            labels: createHistoryLabels({
              db: db.databases.for("categories"),
              audit,
              newId: randomUUID,
              clock,
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

const FILE = history([
  ...times(6, ["Авто", "Мийка", "-250,00"]),
  ...times(5, ["Кав'ярні", "", "-95,00"]),
  ...times(4, ["Продукти", "", "-10,00"]),
]);
const mappings = async (householdId: string) =>
  (
    await db.owner.query<{ label_hash: string; category_id: string | null }>(
      `SELECT label_hash, category_id FROM categories.history_label_mappings WHERE household_id = $1`,
      [householdId],
    )
  ).rows;

describe("sec759: who may match labels and create categories", () => {
  it("sec759 П-5: a scoped member gets «not found» on the step and no confirmation; nothing is created or kept", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    who = { role: "editor", scoped: true };
    try {
      expect((await call(space, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
      // A scoped member never has `household.data.write`: the change is refused before the batch is read.
      const res = await confirm(space, batchId, view.parseId);
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toMatch(/Мийка|Кав/);
    } finally {
      who = {};
    }
    expect(await named(space.householdId, "Мийка")).toBeUndefined();
    expect(await mappings(space.householdId)).toEqual([]);
    expect(await auditOf(space.householdId, "categories.history")).toEqual([]);
  });

  it("sec759 П-5: a viewer (no `household.data.write`) cannot confirm; nothing is created", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    who = { role: "viewer" };
    try {
      const res = await confirm(space, batchId, view.parseId);
      expect(res.statusCode).toBe(403);
    } finally {
      who = {};
    }
    expect(await named(space.householdId, "Мийка")).toBeUndefined();
    expect(await mappings(space.householdId)).toEqual([]);
  });

  it("sec759 П-5: another space's batch is «not found» for the step and the confirmation; neither space gets a category", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const { batchId, view } = await uploaded(owner, FILE);
    await uploaded(stranger, history(times(3, ["Чуже", "", "-1,00"])));
    const before = (await categories(stranger.householdId)).length;
    expect((await call(stranger, "GET", `/v1/import/history-files/${batchId}`)).statusCode).toBe(404);
    const res = await confirm(stranger, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "create" }],
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/Кав|Мийка/);
    expect((await categories(stranger.householdId)).length).toBe(before);
    expect(await named(owner.householdId, "Мийка")).toBeUndefined();
    expect(await mappings(stranger.householdId)).toEqual([]);
    expect(await auditOf(stranger.householdId, "categories.history")).toEqual([]);
  });
});

describe("sec759: the remembered matching belongs to its space", () => {
  it("sec759 FR 25: a matching confirmed in one space is not offered in another space for the same label", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const first = await uploaded(a, FILE);
    const target = (await named(a.householdId, "Продукти"))!;
    const ok = await confirm(a, first.batchId, first.view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: target.id }],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await mappings(a.householdId)).length).toBe(3);
    const { view } = await uploaded(b, FILE);
    const label = mapped(view, "Кав'ярні");
    expect(label.outcome).toMatchObject({ action: "create", source: "new" });
    expect(JSON.stringify(view)).not.toContain(target.id);
    expect(await mappings(b.householdId)).toEqual([]);
  });

  it("sec759 ARC-03 FR 2: the table of matchings has row-level security, and the module's role sees only the bound space", async () => {
    const { rows } = await db.owner.query<{ relrowsecurity: boolean; n: string }>(
      `SELECT c.relrowsecurity,
              (SELECT count(*) FROM pg_policies p
                WHERE p.schemaname = 'categories' AND p.tablename = 'history_label_mappings') AS n
         FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = 'categories' AND c.relname = 'history_label_mappings'`,
    );
    expect(rows[0]).toMatchObject({ relrowsecurity: true });
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    const a = await newSpace();
    const b = await newSpace();
    const up = await uploaded(a, FILE);
    expect((await confirm(a, up.batchId, up.view.parseId)).statusCode).toBe(200);
    // No household filter in the SQL: the policy alone hides space A's rows from a transaction bound to space B.
    const all = `SELECT household_id FROM history_label_mappings`;
    const categoriesDb = db.databases.for("categories");
    const seen = await categoriesDb.inHousehold(b.householdId, async (q) => (await q.query(all)).rows);
    expect(seen).toEqual([]);
    const own = await categoriesDb.inHousehold(a.householdId, async (q) => (await q.query(all)).rows);
    expect(own.length).toBe(3);
  });

  it("sec759 FR 25, «Бізнес-правила»: the matching is kept as a hash — no label text in the table or in the audit log", async () => {
    const space = await newSpace();
    const up = await uploaded(space, FILE);
    expect((await confirm(space, up.batchId, up.view.parseId)).statusCode).toBe(200);
    const kept = await mappings(space.householdId);
    expect(kept.length).toBe(3);
    expect(kept.every((m) => /^[0-9a-f]{64}$/.test(m.label_hash))).toBe(true);
    const entries = await db.owner.query<{ t: string }>(
      `SELECT row_to_json(e)::text AS t FROM audit.entries e WHERE household_id = $1`,
      [space.householdId],
    );
    expect(entries.rows.map((r) => r.t).join("\n")).not.toMatch(/Мийка|Кав'ярні|Покупка/);
  });
});

describe("sec759: choices of categories", () => {
  it("sec759 FR 6: the service category and a retired category cannot be chosen; nothing is created", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    const service = (await categories(space.householdId)).find((c) => c.kind === "service")!;
    const res = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: service.id }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ errors: [{ path: "labels[0]", issue: "unknown-category" }] });
    const retired = (await named(space.householdId, "Продукти"))!;
    await db.owner.query(
      `UPDATE categories.categories SET state = 'retired', system_key = NULL, merged_into = $3 WHERE household_id = $1 AND id = $2`,
      [space.householdId, retired.id, (await named(space.householdId, "Пальне"))!.id],
    );
    const gone = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: retired.id }],
    });
    expect(gone.statusCode).toBe(422);
    expect(await named(space.householdId, "Мийка")).toBeUndefined();
    expect(await mappings(space.householdId)).toEqual([]);
  });

  it("sec759 EC3: a hidden category matched by name stays hidden unless the user chose to show it", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    const hidden = (await named(space.householdId, "Продукти"))!;
    await db.owner.query(
      `UPDATE categories.categories SET state = 'hidden' WHERE household_id = $1 AND id = $2`,
      [space.householdId, hidden.id],
    );
    const res = await confirm(space, batchId, view.parseId);
    expect(res.statusCode, res.body).toBe(200);
    expect((await named(space.householdId, "Продукти"))!.state).toBe("hidden");
    const entry = (await auditOf(space.householdId, "categories.history"))[0]!;
    expect(entry.changes.find((c) => c.field === "categoriesShown")?.after).toBe("0");
  });

  it("sec759 FR 7: one label that cannot be a name refuses the whole confirmation — no partial creation", async () => {
    const space = await newSpace();
    const long = "Д".repeat(61);
    const { batchId, view } = await uploaded(
      space,
      history([...times(5, ["Авто", "Мийка", "-1,00"]), ...times(3, [long, "", "-1,00"])]),
    );
    const before = (await categories(space.householdId)).length;
    const res = await confirm(space, batchId, view.parseId);
    expect(res.statusCode).toBe(422);
    expect((await categories(space.householdId)).length).toBe(before);
    expect(await mappings(space.householdId)).toEqual([]);
    expect(await auditOf(space.householdId, "categories.history")).toEqual([]);
  });
});

describe("sec759: a confirmation that fails after the categories were created", () => {
  it("sec759 FR 7: retried without choices — nothing is created twice", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    failAnswersSeal = 1;
    const failed = await confirm(space, batchId, view.parseId);
    expect(failed.statusCode).toBe(500);
    failAnswersSeal = 0;
    const after = (await categories(space.householdId)).map((c) => c.name).sort();
    const again = await confirm(space, batchId, view.parseId);
    expect(again.statusCode, again.body).toBe(200);
    expect((await categories(space.householdId)).map((c) => c.name).sort()).toEqual(after);
  });

  it("sec759 FR 7: retried with the same «створити нову» choice — the category is not created a second time", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, FILE);
    const body = { labels: [{ category: "Кав'ярні", subcategory: null, action: "create" }] };
    failAnswersSeal = 1;
    const failed = await confirm(space, batchId, view.parseId, body);
    expect(failed.statusCode).toBe(500);
    failAnswersSeal = 0;
    const again = await confirm(space, batchId, view.parseId, body);
    expect(again.statusCode, again.body).toBe(200);
    const names = (await categories(space.householdId)).map((c) => c.name).filter((n) => n.startsWith("Кав"));
    expect(names).toEqual(["Кав'ярні"]);
  });
});
