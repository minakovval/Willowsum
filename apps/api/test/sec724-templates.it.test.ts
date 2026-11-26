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

type As = { readonly role?: string; readonly scoped?: boolean };
function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  as: As = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...as }),
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

const restore = (space: Space, id: string, version: number | string, expectedVersion: number, as: As = {}) =>
  call(space, "POST", `/v1/import/recipes/${id}/versions/${version}/restore`, { expectedVersion }, as);
const versionsOf = async (id: string) =>
  (
    await db.owner.query<{ version: number; recipe: unknown; sealed: string | null }>(
      "SELECT version, recipe, account_value_sealed AS sealed FROM import_recipes.recipe_versions WHERE recipe_id = $1 ORDER BY version",
      [id],
    )
  ).rows;

describe("SEC-724: security properties of the templates API (IMP-07@PoC, wave 2 row 49)", () => {
  it("SEC-724 IMP-07@PoC «Права доступу»: a scoped member reads no versions (404) and neither saves nor restores (403); Viewer and Advisor only read", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { name: "Секретний банк", recipe: FULL_RECIPE });
    for (const role of ["editor", "viewer", "advisor"]) {
      const as = { role, scoped: true };
      const list = await call(space, "GET", `/v1/import/recipes/${id}/versions`, undefined, as);
      expect(list.statusCode, role).toBe(404);
      expect(leakText(list.body)).not.toContain("Секретний");
      const put = await call(
        space,
        "PUT",
        `/v1/import/recipes/${id}`,
        { name: "Y", recipe: SIMPLE, expectedVersion: 1 },
        as,
      );
      expect(put.statusCode, role).toBe(403);
      expect((await restore(space, id, 1, 1, as)).statusCode, role).toBe(403);
    }
    for (const role of ["viewer", "advisor"]) {
      const put = await call(
        space,
        "PUT",
        `/v1/import/recipes/${id}`,
        { name: "Y", recipe: SIMPLE, expectedVersion: 1 },
        { role },
      );
      expect(put.statusCode, role).toBe(403);
      expect((await restore(space, id, 1, 1, { role })).statusCode, role).toBe(403);
    }
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json()).toMatchObject({
      version: 1,
      name: "Секретний банк",
    });
  });

  it("SEC-724 IMP-07@PoC FR 2: a restore takes only this template's own version — never another template's of the space, never another space's", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const a = await saveTemplate(space, { name: "А" });
    const b = await saveTemplate(space, { name: "Б", recipe: FULL_RECIPE });
    for (let v = 2; v <= 3; v++)
      expect(
        (
          await update(space, b.id, {
            name: "Б",
            recipe: { schemaVersion: 1, file: { skipRows: 7 } },
            expectedVersion: v - 1,
          })
        ).statusCode,
      ).toBe(200);
    const theirs = await saveTemplate(stranger, { name: "В" });
    // A has only version 1; B has 1–3; the stranger's has only 1.
    for (const res of [
      await restore(space, a.id, 3, 1),
      await restore(stranger, theirs.id, 3, 1),
      await restore(stranger, b.id, 1, 3),
    ]) {
      expect(res.statusCode, res.body).toBe(404);
      expect(leakText(res.body)).not.toContain("skipRows");
      expect(leakText(res.body)).not.toContain("currentVersion");
    }
    expect((await call(space, "GET", `/v1/import/recipes/${a.id}`)).json()).toMatchObject({
      version: 1,
      recipe: SIMPLE,
    });
    expect((await call(stranger, "GET", `/v1/import/recipes/${theirs.id}`)).json()).toMatchObject({
      version: 1,
      recipe: SIMPLE,
    });
    expect((await call(space, "GET", `/v1/import/recipes/${b.id}`)).json().version).toBe(3);
    // The list of versions is the template's own.
    const items = (await call(space, "GET", `/v1/import/recipes/${a.id}/versions`)).json().items;
    expect(items).toHaveLength(1);
  });

  it("SEC-724 IMP-07@PoC FR 1: an edit cannot move a template to another space's account (404, nothing written); a wrong version of another space's template is 404, not 409", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { id } = await saveTemplate(space, { name: "Мій" });
    for (const accountId of [other.eur, randomUUID()]) {
      const res = await update(space, id, { name: "Мій", accountId, expectedVersion: 1 });
      expect(res.statusCode, res.body).toBe(404);
    }
    const closed = addAccount(space.householdId, "closed");
    expect(
      (await update(space, id, { name: "Мій", accountId: closed, expectedVersion: 1 })).json(),
    ).toMatchObject({ code: "ACCOUNT_CLOSED" });
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json()).toMatchObject({
      version: 1,
      scope: "space",
      accountId: null,
    });
    const wrong = await update(other, id, { name: "Мій", expectedVersion: 7 });
    expect(wrong.statusCode).toBe(404);
    expect(leakText(wrong.body)).not.toContain("currentVersion");
    const wrongRestore = await restore(other, id, 1, 7);
    expect(wrongRestore.statusCode).toBe(404);
    expect(leakText(wrongRestore.body)).not.toContain("currentVersion");
    // The other space may take the same name: names are compared only within a space.
    expect(
      (await call(other, "POST", "/v1/import/recipes", { name: "Мій", recipe: SIMPLE })).statusCode,
    ).toBe(201);
  });

  it("SEC-724 IMP-07@PoC FR 6: a file is never matched with another space's template of the same format, and another space's parse counts no use", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const theirs = await saveTemplate(other, { name: "Чужий", fingerprint });
    expect(await parsedRecipe(space, space.eur)).toBeNull();
    const reader = createImportRecipesReader(db.databases.for("import-recipes"));
    expect(await reader.forFormat(space.householdId, fingerprint, null)).toBeNull();
    await reader.recordUse(space.householdId, theirs.id, randomUUID(), new Date(now));
    expect((await call(other, "GET", `/v1/import/recipes/${theirs.id}`)).json()).toMatchObject({
      useCount: 0,
      lastUsedAt: null,
    });
  });

  it("SEC-724 IMP-07@PoC FR 2 (NFR-01 FR 6): the account value is never in a version row, a versions list, or a 409/422 body of a save", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space, { name: "Секретний банк", recipe: FULL_RECIPE });
    const loaded = (await call(space, "GET", `/v1/import/recipes/${id}`)).json();
    expect(
      (await update(space, id, { name: "Секретний банк", recipe: loaded.recipe, expectedVersion: 1 }))
        .statusCode,
    ).toBe(200);
    const digits = SYNTHETIC_IBAN.replace(/\s+/g, "");
    for (const row of await versionsOf(id)) {
      expect((row.recipe as { account: unknown }).account).toEqual({ by: "iban" });
      expect(row.sealed).not.toBeNull();
      expect(row.sealed).not.toContain(SYNTHETIC_IBAN);
      expect(row.sealed).not.toContain(digits);
    }
    const list = await call(space, "GET", `/v1/import/recipes/${id}/versions`);
    expect(leakText(list.body)).not.toContain(SYNTHETIC_IBAN);
    expect(leakText(list.body)).not.toContain("sealed");
    const stale = await update(space, id, {
      name: "Секретний банк",
      recipe: FULL_RECIPE,
      expectedVersion: 1,
    });
    expect(stale.json()).toMatchObject({ code: "TEMPLATE_CHANGED", currentVersion: 2 });
    await saveTemplate(space, { name: "Зайнята" });
    const taken = await update(space, id, { name: "зайнята", recipe: FULL_RECIPE, expectedVersion: 2 });
    expect(taken.json()).toMatchObject({ status: 409, code: "TEMPLATE_NAME_TAKEN" });
    const invalid = await update(space, id, {
      name: "Секретний банк",
      recipe: { ...FULL_RECIPE, extract: [{ column: 3, pattern: "(a+)+$", group: 1, target: "reference" }] },
      expectedVersion: 2,
    });
    expect(invalid.json()).toMatchObject({ status: 422, code: "RECIPE_INVALID" });
    for (const res of [stale, taken, invalid]) {
      expect(leakText(res.body)).not.toContain(SYNTHETIC_IBAN);
      expect(leakText(res.body)).not.toContain(digits);
      expect(leakText(res.body)).not.toContain("Зайнята");
    }
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().version).toBe(2);
  });

  it("SEC-724 IMP-06@PoC FR 2, FR 14: an edit is checked like a save — an oversized recipe, a `__proto__` key and a missing value without a sealed one are 422; nothing is written", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    const big = {
      schemaVersion: 1,
      filters: { ignoreRows: Array.from({ length: 40 }, (_, i) => `^${"a".repeat(990)}${i}`) },
    };
    const proto =
      '{"schemaVersion":1,"__proto__":{"polluted":true},"account":{"by":"iban","__proto__":{"polluted":true}}}';
    const protoKeep = '{"schemaVersion":1,"account":{"by":"iban","__proto__":{"value":"UA00"}}}';
    for (const recipe of [
      big,
      proto,
      protoKeep,
      { schemaVersion: 1, account: { by: "iban" } },
      "not json",
      7,
      null,
    ]) {
      const res = await update(space, id, { recipe, expectedVersion: 1 });
      expect(res.statusCode, res.body).toBe(422);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).json().version).toBe(1);
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it("SEC-724 IMP-07@PoC FR 2, FR 13: saving one template drops no other template's versions, and a parse counts only its own template, once", async () => {
    const space = await newSpace();
    const quiet = await saveTemplate(space, { name: "Тихий", fingerprint });
    now += 60_000;
    const busy = await saveTemplate(space, { name: "Жвавий", fingerprint });
    for (let v = 2; v <= TEMPLATE_VERSIONS_KEPT + 2; v++)
      expect(
        (
          await update(space, busy.id, {
            name: "Жвавий",
            fingerprint,
            recipe: { schemaVersion: 1, file: { skipRows: v } },
            expectedVersion: v - 1,
          })
        ).statusCode,
      ).toBe(200);
    expect((await versionsOf(quiet.id)).map((v) => v.version)).toEqual([1]);
    expect((await restore(space, quiet.id, 1, 1)).statusCode).toBe(200);
    const reader = createImportRecipesReader(db.databases.for("import-recipes"));
    const parseId = randomUUID();
    await reader.recordUse(space.householdId, busy.id, parseId, new Date(now));
    await reader.recordUse(space.householdId, busy.id, parseId, new Date(now));
    expect((await call(space, "GET", `/v1/import/recipes/${busy.id}`)).json().useCount).toBe(1);
    expect((await call(space, "GET", `/v1/import/recipes/${quiet.id}`)).json()).toMatchObject({
      useCount: 0,
      lastUsedAt: null,
    });
  });

  it("SEC-724 IMP-07@PoC FR 2: a version above the current one (even beyond a 32-bit integer) is «not found», not a server error", async () => {
    const space = await newSpace();
    const { id } = await saveTemplate(space);
    for (const version of [2, 2147483648, 9007199254740991])
      expect((await restore(space, id, version, 1)).statusCode, String(version)).toBe(404);
    expect((await restore(space, id, 1, 2147483648)).statusCode).toBe(409);
    expect((await update(space, id, { expectedVersion: 2147483648 })).statusCode).toBe(409);
  });
});
