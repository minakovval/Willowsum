import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createHistoryLabels, HISTORY_GROUP_NAMES } from "../src/modules/categories/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { answersPurpose, type HistoryAnswers } from "../src/modules/import-sessions/application/index.ts";
import { rowCategories } from "../src/modules/import-sessions/domain/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» b) (wave 2 row 234), module categories through import-sessions' history
 * routes on a real PostgreSQL: the labels of a history file matched with the space's tree on the step «Перевірка
 * розпізнавання», the missing categories created at the confirmation with one audit entry, the matching remembered for
 * the next file. Every file and label is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
let now = Date.parse("2026-11-27T10:00:00Z");
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

const headers = (space: Space) => ({
  origin: WEB,
  ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
});

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

/** AC6's file: «Авто · Пальне» (55), «Авто · Мийка» (9), «Їжа · Супермаркети» (212), «Кав'ярні» (30). */
const AC6 = history([
  ...times(55, ["Авто", "Пальне", "-900,00"]),
  ...times(9, ["Авто", "Мийка", "-250,00"]),
  ...times(212, ["Їжа", "Супермаркети", "-480,50"]),
  ...times(30, ["Кав'ярні", "", "-95,00"]),
]);

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
            keys,
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

describe("BUD-21@PoC FR 7: the file's labels and the space's tree", () => {
  it("BUD-21@PoC AC6: «Авто · Пальне» shows the match with «Пальне», the other three that they are to be created, and no category is created before the confirmation", async () => {
    const space = await newSpace();
    const { view } = await uploaded(space, AC6);
    const before = (await categories(space.householdId)).length;
    expect(mapped(view, "Авто", "Пальне")).toMatchObject({
      rows: 55,
      outcome: { action: "category", name: "Пальне", source: "name" },
    });
    expect(mapped(view, "Авто", "Мийка").outcome).toMatchObject({ action: "create", name: "Мийка" });
    expect(mapped(view, "Їжа", "Супермаркети")).toMatchObject({
      rows: 212,
      outcome: {
        action: "create",
        name: "Супермаркети",
        kind: "expense",
        group: { kind: "new", name: "Їжа" },
      },
    });
    expect(mapped(view, "Кав'ярні").outcome).toMatchObject({
      action: "create",
      group: { kind: "history", name: HISTORY_GROUP_NAMES.expense },
    });
    expect(view.recognition.mapping.historyGroups).toEqual([
      { kind: "expense", name: HISTORY_GROUP_NAMES.expense },
    ]);
    expect(await named(space.householdId, "Мийка")).toBeUndefined();
    expect(await named(space.householdId, "Супермаркети")).toBeUndefined();
    expect((await categories(space.householdId)).length).toBe(before);
  });

  it("BUD-21@PoC AC7: the confirmation creates «Мийка», «Супермаркети» (in the group of «Їжа») and «Кав'ярні» (in the history group), all «витрата», with one audit entry", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, AC6);
    const res = await confirm(space, batchId, view.parseId);
    expect(res.statusCode, res.body).toBe(200);
    expect(await named(space.householdId, "Мийка")).toMatchObject({
      group_name: "Авто",
      kind: "expense",
      state: "active",
    });
    expect(await named(space.householdId, "Супермаркети")).toMatchObject({
      group_name: "Їжа",
      kind: "expense",
    });
    expect(await named(space.householdId, "Кав'ярні")).toMatchObject({
      group_name: HISTORY_GROUP_NAMES.expense,
      history_kind: "expense",
      kind: "expense",
    });
    // One entry of the module categories for the whole confirmation: counts and the batch, no label.
    const entries = await auditOf(space.householdId, "categories.history");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("create");
    expect(Object.fromEntries(entries[0]!.changes.map((c) => [c.field, c.after]))).toEqual({
      groupsCreated: "3",
      categoriesCreated: "3",
      categoriesShown: "0",
      labelsMatched: "4",
    });
    expect(JSON.stringify(entries)).not.toMatch(/Мийка|Супермаркети|Кав'ярні|Авто|Їжа/);
    expect(await auditOf(space.householdId, "categories.category")).toEqual([]);
    expect(await auditOf(space.householdId, "categories.group")).toEqual([]);
    // After the confirmation the step shows what was confirmed: the created categories.
    const after = (await call(space, "GET", `/v1/import/history-files/${batchId}`)).json();
    expect(mapped(after, "Авто", "Мийка").outcome).toMatchObject({ action: "category", name: "Мийка" });
    // The derivation starts after the confirmation — BUD-21 c (row 235).
  });

  it("BUD-21@PoC AC8: «Їжа · Супермаркети» matched with «Продукти» before the confirmation — «Супермаркети» is not created, its 212 rows have «Продукти»", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, AC6);
    const groceries = (await named(space.householdId, "Продукти"))!;
    const res = await confirm(space, batchId, view.parseId, {
      labels: [
        { category: "Їжа", subcategory: "Супермаркети", action: "category", categoryId: groceries.id },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await named(space.householdId, "Супермаркети")).toBeUndefined();
    // No category of «Їжа» is created: neither is its group.
    expect((await categories(space.householdId)).some((c) => c.group_name === "Їжа")).toBe(false);
    expect(mapped(res.json(), "Їжа", "Супермаркети")).toMatchObject({
      rows: 212,
      outcome: { action: "category", categoryId: groceries.id, name: "Продукти" },
    });
    // The confirmed answers the derivation reads: each of the label's rows gets «Продукти».
    const { rows } = await db.owner.query<{
      batch_file_id: string;
      parse_id: string;
      answers_sealed: Buffer;
    }>(
      `SELECT batch_file_id, parse_id, answers_sealed FROM import_sessions.history_parses WHERE household_id = $1`,
      [space.householdId],
    );
    const answers = JSON.parse(
      new TextDecoder().decode(
        await keys.openBytes(
          space.householdId,
          answersPurpose(rows[0]!.batch_file_id, rows[0]!.parse_id),
          new Uint8Array(rows[0]!.answers_sealed),
        ),
      ),
    ) as HistoryAnswers;
    const of = rowCategories(answers.labels!);
    expect(of({ category: "Їжа", subcategory: "Супермаркети" })).toMatchObject({
      action: "category",
      categoryId: groceries.id,
    });
  });

  it("BUD-21@PoC FR 7: a choice the file or the tree does not have — or another space's category — is refused and nothing is created", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, AC6);
    const res = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Дім", subcategory: null, action: "create" }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: "HISTORY_ANSWER_INVALID",
      errors: [{ path: "labels[0]", issue: "unknown-label" }],
    });
    const other = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: randomUUID() }],
    });
    expect(other.json()).toMatchObject({ errors: [{ path: "labels[0]", issue: "unknown-category" }] });
    // Another space's category is not known here (П-5): the same answer, nothing of it shown.
    const stranger = await newSpace();
    await uploaded(stranger, AC6);
    const theirs = (await named(stranger.householdId, "Продукти"))!;
    const foreign = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: theirs.id }],
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json()).toMatchObject({ errors: [{ path: "labels[0]", issue: "unknown-category" }] });
    expect(await named(space.householdId, "Мийка")).toBeUndefined();
    expect(await auditOf(space.householdId, "categories.history")).toEqual([]);
  });

  it("BUD-21@PoC FR 7: a label too long to be a category's name is a question; the confirmation is refused until it is matched", async () => {
    const space = await newSpace();
    const long = "Дуже довга назва категорії, яку користувач колись написав у своїй таблиці";
    const { batchId, view } = await uploaded(space, history(times(3, [long, "", "-10,00"])));
    expect(mapped(view, long)).toMatchObject({
      outcome: { action: "create", name: null },
      questions: ["name-invalid"],
    });
    const res = await confirm(space, batchId, view.parseId);
    expect(res.json()).toMatchObject({ errors: [{ path: "labels", issue: "name-invalid" }] });
    const other = (await named(space.householdId, "Інші витрати"))!;
    const ok = await confirm(space, batchId, view.parseId, {
      labels: [{ category: long, subcategory: null, action: "category", categoryId: other.id }],
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe("BUD-21@PoC FR 8: labels that are transfers", () => {
  it("BUD-21@PoC FR 8: a label the user marks as a transfer creates no category; its rows count as transfers", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(space, AC6);
    const res = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Кав'ярні", subcategory: null, action: "transfer" }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await named(space.householdId, "Кав'ярні")).toBeUndefined();
    expect(res.json().recognition.summary).toMatchObject({ read: 306, transfers: 30 });
  });
});

describe("BUD-21@PoC FR 25: the next history file", () => {
  it("BUD-21@PoC AC27: «Їжа · Супермаркети» confirmed as «Продукти» for the first file — the second file's step already shows «Продукти», open to change", async () => {
    const space = await newSpace();
    const first = await uploaded(space, AC6);
    const groceries = (await named(space.householdId, "Продукти"))!;
    await confirm(space, first.batchId, first.view.parseId, {
      labels: [
        { category: "Їжа", subcategory: "Супермаркети", action: "category", categoryId: groceries.id },
      ],
    });
    // FR 24: the matching stays when the first file goes.
    expect((await call(space, "DELETE", `/v1/import/history-files/${first.batchId}`)).statusCode).toBe(200);
    now += 60_000;
    const second = await uploaded(
      space,
      history(
        [...times(4, ["ЇЖА", "супермаркети", "-50,00"]), ...times(2, ["Авто", "Мийка", "-300,00"])],
        "Інший",
      ),
    );
    expect(mapped(second.view, "ЇЖА", "супермаркети").outcome).toMatchObject({
      action: "category",
      categoryId: groceries.id,
      source: "remembered",
    });
    // «Мийка» was created for the first file: now it is matched by name.
    expect(mapped(second.view, "Авто", "Мийка").outcome).toMatchObject({ action: "category", name: "Мийка" });
    const changed = await confirm(space, second.batchId, second.view.parseId, {
      labels: [{ category: "ЇЖА", subcategory: "супермаркети", action: "create" }],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await named(space.householdId, "супермаркети")).toMatchObject({ group_name: "ЇЖА" });
  });
});

describe("BUD-21@PoC edge cases of labels", () => {
  it("BUD-21@PoC EC1: «Продукти» and «продукти » are one label, matched with «Продукти»", async () => {
    const space = await newSpace();
    const { view } = await uploaded(
      space,
      history([...times(3, ["Продукти", "", "-10,00"]), ...times(2, ["продукти ", "", "-12,00"])]),
    );
    expect(view.recognition.mapping.labels).toHaveLength(1);
    expect(view.recognition.mapping.labels[0]).toMatchObject({
      rows: 5,
      outcome: { action: "category", name: "Продукти" },
    });
  });

  it("BUD-21@PoC EC2: «Авто · Інше» and «Дім · Інше» — the second is created as «Інше (Дім)», and the step shows it", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(
      space,
      history([...times(5, ["Авто", "Інше", "-10,00"]), ...times(2, ["Дім", "Інше", "-20,00"])]),
    );
    expect(mapped(view, "Дім", "Інше")).toMatchObject({
      outcome: { action: "create", name: "Інше (Дім)" },
      questions: ["duplicate-name"],
    });
    expect((await confirm(space, batchId, view.parseId)).statusCode).toBe(200);
    expect(await named(space.householdId, "Інше")).toMatchObject({ group_name: "Авто" });
    expect(await named(space.householdId, "Інше (Дім)")).toMatchObject({ group_name: "Дім" });
  });

  it("BUD-21@PoC EC3: a label of a hidden category takes it and offers to show it again; shown at the confirmation, in the same audit entry", async () => {
    const space = await newSpace();
    const { batchId } = await uploaded(space, history(times(4, ["Сад", "", "-100,00"])));
    await db.owner.query(
      `UPDATE categories.categories SET state = 'hidden' WHERE household_id = $1 AND system_key = 'garden'`,
      [space.householdId],
    );
    const view = (await call(space, "GET", `/v1/import/history-files/${batchId}`)).json();
    const garden = (await named(space.householdId, "Сад"))!;
    expect(mapped(view, "Сад")).toMatchObject({
      outcome: { action: "category", categoryId: garden.id, hidden: true, show: false },
      questions: ["hidden-category"],
    });
    const res = await confirm(space, batchId, view.parseId, {
      labels: [{ category: "Сад", subcategory: null, action: "category", categoryId: garden.id, show: true }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await named(space.householdId, "Сад"))!.state).toBe("active");
    const entries = await auditOf(space.householdId, "categories.history");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.changes.find((c) => c.field === "categoriesShown")!.after).toBe("1");
  });

  it("BUD-21@PoC EC4: as many positive as negative amounts — the new category is «витрата», and the step asks", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(
      space,
      history([...times(2, ["Каса", "", "-10,00"]), ...times(2, ["Каса", "", "10,00"])]),
    );
    expect(mapped(view, "Каса")).toMatchObject({
      outcome: { action: "create", kind: "expense" },
      questions: ["equal-signs"],
    });
    await confirm(space, batchId, view.parseId);
    expect(await named(space.householdId, "Каса")).toMatchObject({ kind: "expense" });
  });

  it("BUD-21@PoC EC5: a row with a category and a transfer mark is a transfer; its category is not created", async () => {
    const space = await newSpace();
    const bytes = Buffer.from(
      [
        "Дата;Сума;Опис;Категорія;Тип",
        "01.03.2026;-500,00;На свою картку;Заощадження;переказ",
        "02.03.2026;-40,00;Кава;Кав'ярні;витрата",
      ].join("\r\n") + "\r\n",
    );
    const { batchId, view } = await uploaded(space, bytes);
    expect(view.recognition.mapping.labels.map((l: MappedLabel) => l.category)).toEqual(["Кав'ярні"]);
    await confirm(space, batchId, view.parseId);
    expect(await named(space.householdId, "Заощадження")).toBeUndefined();
  });

  it("BUD-21@PoC EC12: the label «Переказ» is marked as a transfer; rows of «Коригування» are skipped as a service category and counted in the summary", async () => {
    const space = await newSpace();
    const { batchId, view } = await uploaded(
      space,
      history([
        ...times(3, ["Переказ", "", "-1000,00"]),
        ...times(2, ["коригування", "", "15,00"]),
        ...times(4, ["Кав'ярні", "", "-50,00"]),
      ]),
    );
    expect(mapped(view, "Переказ").outcome).toEqual({ action: "transfer", source: "service" });
    expect(mapped(view, "коригування").outcome).toEqual({ action: "skip", reason: "service-category" });
    expect(view.recognition.summary).toEqual({
      rows: 9,
      read: 7,
      transfers: 3,
      skipped: [{ reason: "service-category", count: 2 }],
      tagsSkipped: 0,
    });
    const res = await confirm(space, batchId, view.parseId);
    expect(res.statusCode, res.body).toBe(200);
    const names = (await categories(space.householdId)).map((c) => c.name);
    expect(names.filter((n) => /переказ|коригування/i.test(n))).toEqual(["Переказ", "Коригування"]);
  });
});
