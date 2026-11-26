import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { FULL_RECIPE } from "../src/modules/import-recipes/domain/recipe.test-helper.ts";
import {
  createImportRecipesReader,
  createImportRecipesServices,
  RECIPES_PER_SPACE,
  TEMPLATE_VERSIONS_KEPT,
} from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-07@PoC a) (wave 2 row 49) on a real PostgreSQL through the real API and the real parse worker: a saved recipe is
 * a template of scope «простір» or «рахунок» (FR 1), its name unique in its scope, at most 100 a space, the last 20
 * versions kept and restorable (FR 2); a save names the version it was made from (FR 3); a file of the template's format
 * is parsed with it automatically — the file's account's template first, then the space's (FR 6) — and its usage
 * is counted (FR 13). The accounts module is the test's port. Every name, file and number is synthetic; the clock is
 * the test's.
 */
const WEB = "http://localhost:5173";
const START = Date.parse("2026-11-26T10:00:00Z");
let now = START;
const clock = { now: () => now };
const SYNTHETIC_IBAN = FULL_RECIPE.account.value;

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const flags = fakeFlags();
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  /** Two EUR accounts of the space (the accounts port). */
  readonly eur: string;
  readonly card: string;
}

function addAccount(householdId: string, status: "active" | "closed" = "active"): string {
  const id = randomUUID();
  accountsOf.set(`${householdId}/${id}`, {
    accountId: id,
    kind: "current",
    status,
    subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
  });
  return id;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId, eur: addAccount(householdId), card: addAccount(householdId) };
}

function call(space: Space, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown) {
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

const SIMPLE = { schemaVersion: 1, file: { delimiter: ";" } } as const;

async function saveTemplate(
  space: Space,
  body: { name?: string; recipe?: unknown; fingerprint?: string; accountId?: string | null } = {},
): Promise<{ id: string; version: number }> {
  const res = await call(space, "POST", "/v1/import/recipes", {
    name: "Синтетичний банк",
    recipe: SIMPLE,
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().id as string, version: res.json().version as number };
}

const update = (space: Space, id: string, body: Record<string, unknown>) =>
  call(space, "PUT", `/v1/import/recipes/${id}`, { name: "Синтетичний банк", recipe: SIMPLE, ...body });

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A statement whose figures agree (1 000,00 → 1 440,00 EUR). */
const CLEAN = text([
  "Вхідний залишок:;1000.00 EUR",
  "Дата;Сума;Опис",
  "15.03.2026;500.00;Зарплата ТОВ «Вигадка»",
  "20.03.2026;-60.00;Кава «Синтетична»",
  "Кінцевий залишок:;1440.00 EUR",
]);

async function batchWith(space: Space, bytes: Buffer): Promise<{ batchId: string; fileId: string }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="berezen.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileId: (res.json().files as { id: string }[])[0]!.id };
}

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

/** Uploads CLEAN, parses it in the account without a chosen recipe and returns the file's recipe as the batch shows it. */
async function parsedRecipe(space: Space, accountId: string | null): Promise<unknown> {
  const batch = await batchWith(space, CLEAN);
  const res = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: [{ fileId: batch.fileId, ...(accountId ? { accountId } : {}) }],
  });
  expect(res.statusCode, res.body).toBe(200);
  await work(space.householdId);
  return (await call(space, "GET", `/v1/import/batches/${batch.batchId}/parse`)).json().files[0].recipe;
}

let fingerprint: string;

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
  fingerprint = (await isolatedStatementParser().parse(new Uint8Array(CLEAN))).reading.format!.fingerprint;
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
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
        }),
        importRecipes: createImportRecipesServices({ keys, audit, clock, newId: randomUUID, accounts }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => {
  now = START;
});

describe("IMP-07@PoC FR 1: templates of scope «рахунок» and «простір»", () => {
  it("IMP-07@PoC AC13: the Owner saves a template of scope «рахунок» for an account of the space", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/import/recipes", {
      name: "Картка, CSV",
      recipe: SIMPLE,
      accountId: space.card,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      scope: "account",
      accountId: space.card,
      version: 1,
      stale: false,
      useCount: 0,
      lastUsedAt: null,
      updatedAt: new Date(START).toISOString(),
    });
    const list = await call(space, "GET", "/v1/import/recipes");
    expect(list.json().items[0]).toMatchObject({
      id: res.json().id,
      scope: "account",
      accountId: space.card,
    });
  });

  it("IMP-07@PoC AC14: a template without an account is of scope «простір» and belongs to the space", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    const got = await call(space, "GET", `/v1/import/recipes/${id}`);
    expect(got.json()).toMatchObject({ scope: "space", accountId: null, version: 1 });
    const { rows } = await db.owner.query<{ household_id: string; account_id: string | null }>(
      "SELECT household_id, account_id FROM import_recipes.recipes WHERE id = $1",
      [id],
    );
    expect(rows).toEqual([{ household_id: space.householdId, account_id: null }]);
  });

  it("IMP-07@PoC FR 1: another space's or an unknown account is «not found»; a closed one is refused; nothing is saved", async () => {
    const space = await newSpace();
    const other = await newSpace();
    for (const accountId of [other.eur, randomUUID()]) {
      const res = await call(space, "POST", "/v1/import/recipes", { name: "Х", recipe: SIMPLE, accountId });
      expect(res.statusCode).toBe(404);
    }
    const closed = addAccount(space.householdId, "closed");
    const res = await call(space, "POST", "/v1/import/recipes", {
      name: "Х",
      recipe: SIMPLE,
      accountId: closed,
    });
    expect(res.json()).toMatchObject({ status: 409, code: "ACCOUNT_CLOSED" });
    expect(await count("import_recipes.recipes WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("IMP-07@PoC AC12: a request from someone not of the space is «not found» and shows nothing of it", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const { id } = await saveTemplate(space, { name: "Секретний банк", recipe: FULL_RECIPE });
    for (const res of [
      await call(stranger, "GET", `/v1/import/recipes/${id}`),
      await update(stranger, id, { expectedVersion: 1 }),
      await call(stranger, "GET", `/v1/import/recipes/${id}/versions`),
      await call(stranger, "POST", `/v1/import/recipes/${id}/versions/1/restore`, { expectedVersion: 1 }),
      await call(stranger, "POST", "/v1/import/recipes", { name: "Х", recipe: SIMPLE, accountId: space.eur }),
    ]) {
      expect(res.statusCode, res.body).toBe(404);
      expect(leakText(res.body)).not.toContain("Секретний");
      expect(leakText(res.body)).not.toContain(id);
    }
    expect((await call(stranger, "GET", "/v1/import/recipes")).json().items).toEqual([]);
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().version).toBe(1);
  });
});

describe("IMP-07@PoC FR 2: names, the ceiling and versions", () => {
  it("IMP-07@PoC FR 2: a name is unique within its scope and account (without case); another scope may repeat it", async () => {
    const space = await newSpace();
    await saveTemplate(space, { name: "Банк" });
    const again = await call(space, "POST", "/v1/import/recipes", { name: "БАНК", recipe: SIMPLE });
    expect(again.json()).toMatchObject({ status: 409, code: "TEMPLATE_NAME_TAKEN" });
    await saveTemplate(space, { name: "Банк", accountId: space.eur });
    await saveTemplate(space, { name: "Банк", accountId: space.card });
    const sameAccount = await call(space, "POST", "/v1/import/recipes", {
      name: "банк",
      recipe: SIMPLE,
      accountId: space.card,
    });
    expect(sameAccount.json().code).toBe("TEMPLATE_NAME_TAKEN");
    const other = await saveTemplate(space, { name: "Інший" });
    const rename = await update(space, other.id, { name: "Банк", expectedVersion: 1 });
    expect(rename.json().code).toBe("TEMPLATE_NAME_TAKEN");
    expect(await count("import_recipes.recipes WHERE household_id = $1", space.householdId)).toBe(4);
  });

  it(`IMP-07@PoC AC9: a space with ${RECIPES_PER_SPACE} templates refuses one more with the limit (422 LIMIT_REACHED, never 402); the list still reads`, async () => {
    const space = await newSpace();
    await db.owner.query(
      `INSERT INTO import_recipes.recipes (household_id, id, name, schema_version, recipe, created_by)
       SELECT $1, gen_random_uuid(), 'Шаблон ' || i, 1, '{"schemaVersion":1}', $2
       FROM generate_series(1, $3::int) AS i`,
      [space.householdId, space.accountId, RECIPES_PER_SPACE],
    );
    const res = await call(space, "POST", "/v1/import/recipes", { name: "Ще один", recipe: SIMPLE });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 100 });
    expect(await count("import_recipes.recipes WHERE household_id = $1", space.householdId)).toBe(100);
    expect((await call(space, "GET", "/v1/import/recipes")).statusCode).toBe(200);
  });

  it("IMP-07@PoC AC11: a template with 5 versions — restoring version 2 makes version 6 with version 2's recipe", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { recipe: { schemaVersion: 1, file: { skipRows: 1 } } });
    for (let v = 2; v <= 5; v++) {
      now += 60_000;
      const res = await update(space, id, {
        recipe: { schemaVersion: 1, file: { skipRows: v } },
        expectedVersion: v - 1,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().version).toBe(v);
    }
    const versions = await call(space, "GET", `/v1/import/recipes/${id}/versions`);
    expect(versions.json().items.map((v: { version: number }) => v.version)).toEqual([5, 4, 3, 2, 1]);
    const restored = await call(space, "POST", `/v1/import/recipes/${id}/versions/2/restore`, {
      expectedVersion: 5,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({
      version: 6,
      recipe: { schemaVersion: 1, file: { skipRows: 2 } },
    });
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().version).toBe(6);
    // A version never kept is «not found»; a restore from an outdated version is refused like a save.
    expect(
      (await call(space, "POST", `/v1/import/recipes/${id}/versions/9/restore`, { expectedVersion: 6 }))
        .statusCode,
    ).toBe(404);
    const stale = await call(space, "POST", `/v1/import/recipes/${id}/versions/1/restore`, {
      expectedVersion: 5,
    });
    expect(stale.json()).toMatchObject({ status: 409, code: "TEMPLATE_CHANGED", currentVersion: 6 });
  });

  it(`IMP-07@PoC FR 2: only the last ${TEMPLATE_VERSIONS_KEPT} versions are kept`, async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    for (let v = 2; v <= TEMPLATE_VERSIONS_KEPT + 3; v++) {
      const res = await update(space, id, {
        recipe: { schemaVersion: 1, file: { skipRows: v } },
        expectedVersion: v - 1,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    const items = (await call(space, "GET", `/v1/import/recipes/${id}/versions`)).json().items as {
      version: number;
    }[];
    expect(items).toHaveLength(TEMPLATE_VERSIONS_KEPT);
    expect(items[0]!.version).toBe(TEMPLATE_VERSIONS_KEPT + 3);
    expect(items.at(-1)!.version).toBe(4);
    expect(await count("import_recipes.recipe_versions WHERE recipe_id = $1", id)).toBe(
      TEMPLATE_VERSIONS_KEPT,
    );
    // A deleted template goes with its versions.
    expect((await call(space, "DELETE", `/v1/import/recipes/${id}`)).statusCode).toBe(200);
    expect(await count("import_recipes.recipe_versions WHERE recipe_id = $1", id)).toBe(0);
  });
});

describe("IMP-07@PoC FR 3: a save names the version it was made from", () => {
  it("IMP-07@PoC AC10: the same template open in two windows — the second window's save of the old version is refused «Шаблон змінено, оновіть»", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    const first = await update(space, id, {
      recipe: { schemaVersion: 1, file: { skipRows: 1 } },
      expectedVersion: 1,
    });
    expect(first.statusCode, first.body).toBe(200);
    const second = await update(space, id, {
      recipe: { schemaVersion: 1, file: { skipRows: 9 } },
      expectedVersion: 1,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "TEMPLATE_CHANGED", currentVersion: 2 });
    const got = (await call(space, "GET", `/v1/import/recipes/${id}`)).json();
    expect(got).toMatchObject({ version: 2, recipe: { file: { skipRows: 1 } } });
  });

  it("IMP-07@PoC FR 3: two saves of the same version at once — one is the next version, the other is refused", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    const both = await Promise.all([
      update(space, id, { recipe: { schemaVersion: 1, file: { skipRows: 1 } }, expectedVersion: 1 }),
      update(space, id, { recipe: { schemaVersion: 1, file: { skipRows: 2 } }, expectedVersion: 1 }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await count("import_recipes.recipe_versions WHERE recipe_id = $1", id)).toBe(2);
  });

  it("IMP-07@PoC FR 3: an edited template that binds the account the same way without a value keeps the sealed one; the value never comes back", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { recipe: FULL_RECIPE });
    const loaded = (await call(space, "GET", `/v1/import/recipes/${id}`)).json();
    expect(loaded.recipe.account).toEqual({ by: "iban" });
    const res = await update(space, id, {
      recipe: { ...loaded.recipe, file: { ...loaded.recipe.file, skipRows: 4 } },
      expectedVersion: loaded.version,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, accountValueLast4: "0000" });
    expect(leakText(res.body)).not.toContain(SYNTHETIC_IBAN);
    const { rows } = await db.owner.query<{ sealed: string }>(
      "SELECT account_value_sealed AS sealed FROM import_recipes.recipes WHERE id = $1",
      [id],
    );
    expect(await keys.open(space.householdId, "importRecipes.accountValue", rows[0]!.sealed)).toBe(
      SYNTHETIC_IBAN,
    );
    // Another binding without a value is still incomplete.
    const other = await update(space, id, {
      recipe: { schemaVersion: 1, account: { by: "mask" } },
      expectedVersion: 2,
    });
    expect(other.json()).toMatchObject({ code: "RECIPE_INVALID" });
  });

  it("IMP-07@PoC FR 13: each change of a template is an audit entry with versions and counts, never the name or the rules", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { name: "Синтетичний банк «Вигадка»", recipe: FULL_RECIPE });
    await update(space, id, { name: "Синтетичний банк «Вигадка»", recipe: SIMPLE, expectedVersion: 1 });
    await call(space, "POST", `/v1/import/recipes/${id}/versions/1/restore`, { expectedVersion: 2 });
    const { rows } = await db.owner.query<{ action: string; changes: unknown }>(
      `SELECT action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'import-recipes.recipe'
       ORDER BY occurred_at, action`,
      [space.householdId],
    );
    expect(rows.map((r) => r.action).sort()).toEqual(["create", "update", "update"]);
    const all = JSON.stringify(rows);
    expect(all).toContain('"restoredVersion"');
    expect(all).not.toContain("Вигадка");
    expect(all).not.toContain("UA00");
    expect(all).not.toContain("DD.MM");
  });
});

describe("IMP-07@PoC FR 6: a file of a template's format is parsed with it (user templates; the library is a later part)", () => {
  it("IMP-07@PoC AC1: a template of scope «рахунок» is applied to the next file of its format in that account; its use is counted", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { fingerprint, accountId: space.eur });
    now += 30 * 86_400_000;
    expect(await parsedRecipe(space, space.eur)).toEqual({ id, format: "match" });
    const got = (await call(space, "GET", `/v1/import/recipes/${id}`)).json();
    expect(got).toMatchObject({ useCount: 1, lastUsedAt: new Date(now).toISOString() });
  });

  it("IMP-07@PoC FR 6: the file's account's template comes before a newer one of the space; another account's template is never used", async () => {
    const space = await newSpace();
    const mine = await saveTemplate(space, { name: "Рахунок", fingerprint, accountId: space.eur });
    now += 60_000;
    const forSpace = await saveTemplate(space, { name: "Простір", fingerprint });
    now += 60_000;
    await saveTemplate(space, { name: "Картка", fingerprint, accountId: space.card });
    expect(await parsedRecipe(space, space.eur)).toEqual({ id: mine.id, format: "match" });
    // A file without an account, or of an account without its own template: the space's template.
    expect(await parsedRecipe(space, null)).toEqual({ id: forSpace.id, format: "match" });
  });

  it("IMP-07@PoC FR 6: among the space's templates of the format the most recently updated is applied", async () => {
    const space = await newSpace();
    const older = await saveTemplate(space, { name: "Перший", fingerprint });
    now += 60_000;
    await saveTemplate(space, { name: "Другий", fingerprint });
    now += 60_000;
    const res = await update(space, older.id, { name: "Перший", fingerprint, expectedVersion: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await parsedRecipe(space, null)).toEqual({ id: older.id, format: "match" });
  });

  it("IMP-07@PoC FR 4, EC2: a template without a fingerprint is never applied automatically", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    expect(await parsedRecipe(space, null)).toBeNull();
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().useCount).toBe(0);
  });

  it("IMP-07@PoC FR 5, EC1: a stale template (an older schema version) is never matched, and choosing it is refused until it is saved again", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { fingerprint });
    // A template of schema version 0 cannot be made today: the row is set as a previous engine would have left it.
    await db.owner.query("ALTER TABLE import_recipes.recipes DROP CONSTRAINT recipes_schema_version_check");
    try {
      await db.owner.query("UPDATE import_recipes.recipes SET schema_version = 0 WHERE id = $1", [id]);
      expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().stale).toBe(true);
      expect(await parsedRecipe(space, null)).toBeNull();
      const batch = await batchWith(space, CLEAN);
      const chosen = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
        files: [{ fileId: batch.fileId, recipeId: id }],
      });
      expect(chosen.json()).toMatchObject({ status: 409, code: "TEMPLATE_STALE" });
      // Saved again from the editor (the current schema): applied again.
      const saved = await update(space, id, { fingerprint, expectedVersion: 1 });
      expect(saved.json()).toMatchObject({ stale: false, version: 2 });
      expect(await parsedRecipe(space, null)).toEqual({ id, format: "match" });
    } finally {
      await db.owner.query("UPDATE import_recipes.recipes SET schema_version = 1 WHERE schema_version < 1");
      await db.owner.query(
        "ALTER TABLE import_recipes.recipes ADD CONSTRAINT recipes_schema_version_check CHECK (schema_version >= 1)",
      );
    }
  });
});
