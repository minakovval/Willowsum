import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { FULL_RECIPE } from "../src/modules/import-recipes/domain/recipe.test-helper.ts";
import { createImportRecipesServices, RECIPES_PER_SPACE } from "../src/modules/import-recipes/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { kms, personWithSpace, withTestErasureDatabases } from "./erasure-helpers.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-06@PoC a) part 2 (wave 2 row 40), the module `import-recipes` through the real API on a real PostgreSQL: a space's
 * parsing recipes are saved only valid (schema, limits, safe patterns, no control characters; FR 2, FR 3, FR 14), read
 * and deleted only in their own space and by the roles that may, with the account binding's value sealed (NFR-01 FR 6),
 * each change an audit entry through the module's queue (ADR-0015), and erased with the space (NFR-12 FR 3). Applying a
 * recipe is the parse worker's (row 41). Every recipe, name and number is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const SYNTHETIC_IBAN = FULL_RECIPE.account.value;
let now = Date.parse("2026-11-19T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let flags = fakeFlags();
let app: ReturnType<typeof buildServer>;
const telemetry = testTelemetryForFile();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

type As = { readonly role?: string; readonly scoped?: boolean };

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, as: As = {}) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...as }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const save = (space: Space, recipe: unknown, name = "Синтетичний банк, CSV", as: As = {}) =>
  call(space, "POST", "/v1/import/recipes", { name, recipe }, as);

async function newRecipe(space: Space, recipe: unknown = FULL_RECIPE): Promise<string> {
  const res = await save(space, recipe);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const recipes = (householdId: string) => n("import_recipes.recipes WHERE household_id = $1", householdId);
const recipeAudit = (householdId: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'import-recipes.recipe' AND action = $2",
    householdId,
    action,
  );

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: {
          isModuleAvailable: (m) => flags.isModuleAvailable(m),
          moduleState: (m) => flags.moduleState(m),
          isEnabled: (h, f) => flags.isEnabled(h, f),
        },
        authenticate: testAuthenticate,
        importRecipes: createImportRecipesServices({
          keys: createSpaceKeys(db.databases.for("household"), audit, kms),
          audit,
          clock,
          newId: randomUUID,
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

afterEach(() => {
  vi.restoreAllMocks();
  flags = fakeFlags();
  now = Date.parse("2026-11-19T10:00:00Z");
});

describe("IMP-06@PoC: recipes of a space", () => {
  it("IMP-06@PoC FR 1: a recipe of every group of rules is saved, listed and read back; the account value only masked", async () => {
    const space = await newSpace();
    const fingerprint = `fp1:${"ab".repeat(32)}`;
    const res = await call(space, "POST", "/v1/import/recipes", {
      name: "  Синтетичний банк, CSV ",
      recipe: FULL_RECIPE,
      fingerprint,
    });
    expect(res.statusCode, res.body).toBe(201);
    const { account, ...rest } = FULL_RECIPE;
    expect(res.json()).toMatchObject({
      name: "Синтетичний банк, CSV",
      schemaVersion: 1,
      fingerprint,
      createdAt: new Date(now).toISOString(),
      accountValueLast4: "0000",
      recipe: { ...rest, account: { by: account.by } },
    });
    const id = res.json().id as string;
    const got = await call(space, "GET", `/v1/import/recipes/${id}`);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(res.json());
    expect(leakText(got.body)).not.toContain(SYNTHETIC_IBAN);
    const list = await call(space, "GET", "/v1/import/recipes");
    expect(list.json()).toEqual({
      items: [
        { id, name: "Синтетичний банк, CSV", schemaVersion: 1, fingerprint, createdAt: res.json().createdAt },
      ],
      nextCursor: null,
    });

    // NFR-01 FR 6: the IBAN is sealed with the space's key, never in the recipe's JSON.
    const { rows } = await db.owner.query<{ recipe: string; sealed: string }>(
      "SELECT recipe::text AS recipe, account_value_sealed AS sealed FROM import_recipes.recipes WHERE id = $1",
      [id],
    );
    expect(rows[0]!.recipe).not.toContain("UA00");
    expect(rows[0]!.sealed).not.toContain("UA00");
    const keys = createSpaceKeys(db.databases.for("household"), audit, kms);
    expect(await keys.open(space.householdId, "importRecipes.accountValue", rows[0]!.sealed)).toBe(
      SYNTHETIC_IBAN,
    );
  });

  it("IMP-06@PoC FR 1: the list pages newest first; a deleted recipe is gone", async () => {
    const space = await newSpace();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      now += 1000;
      ids.push(await newRecipe(space, { schemaVersion: 1, sign: { mode: "invert" } }));
    }
    const first = await call(space, "GET", "/v1/import/recipes?limit=2");
    expect(first.json().items.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    const second = await call(space, "GET", `/v1/import/recipes?limit=2&cursor=${first.json().nextCursor}`);
    expect(second.json()).toMatchObject({ items: [{ id: ids[0] }], nextCursor: null });
    const del = await call(space, "DELETE", `/v1/import/recipes/${ids[1]}`);
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    expect((await call(space, "GET", `/v1/import/recipes/${ids[1]}`)).statusCode).toBe(404);
    expect((await call(space, "DELETE", `/v1/import/recipes/${ids[1]}`)).statusCode).toBe(404);
    expect(await recipes(space.householdId)).toBe(2);
  });
});

describe("IMP-06@PoC FR 2, FR 3, FR 14: what is refused, with its code and path; nothing stored", () => {
  async function refused(space: Space, recipe: unknown) {
    const res = await save(space, recipe);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe("RECIPE_INVALID");
    return res.json().recipeErrors as unknown[];
  }

  it("IMP-06@PoC AC2: a field the schema does not have is refused «невідоме поле» with its path", async () => {
    const space = await newSpace();
    expect(
      await refused(space, { schemaVersion: 1, columns: [{ column: 4, role: "amount", colour: "red" }] }),
    ).toEqual([{ code: "UNKNOWN_FIELD", path: "columns[0].colour" }]);
    expect(await recipes(space.householdId)).toBe(0);
  });

  it("IMP-06@PoC AC3: a pattern with a back-reference is refused «небезпечний шаблон»", async () => {
    const space = await newSpace();
    expect(await refused(space, { schemaVersion: 1, filters: { ignoreRows: [String.raw`(\d)\1`] } })).toEqual(
      [{ code: "UNSAFE_PATTERN", path: "filters.ignoreRows[0]", reason: "backreference" }],
    );
  });

  it("IMP-06@PoC AC4: a recipe of 40 KB is refused «рецепт завеликий», not by the body limit", async () => {
    const space = await newSpace();
    // 20 000 Cyrillic letters: 40 000 bytes of UTF-8, under the request's own limit of 64 KiB.
    const forty = { schemaVersion: 1, columns: [{ column: 1, role: "date", header: "я".repeat(20_000) }] };
    expect(new TextEncoder().encode(JSON.stringify(forty)).length).toBeGreaterThan(40_000);
    expect(await refused(space, forty)).toEqual([{ code: "RECIPE_TOO_LARGE", path: "" }]);
    // The request itself over its own limit (64 KiB) is 413.
    const huge = await save(space, { schemaVersion: 1, extra: "x".repeat(70_000) });
    expect(huge.statusCode).toBe(413);
    expect(await recipes(space.householdId)).toBe(0);
  });

  it("IMP-06@PoC FR 2: 65 column rules and 21 pattern rules are over the limits; another schema version is refused", async () => {
    const space = await newSpace();
    const columns = Array.from({ length: 65 }, (_, i) => ({ column: i + 1, role: "ignore" }));
    expect(await refused(space, { schemaVersion: 1, columns })).toEqual([
      { code: "TOO_MANY_COLUMN_RULES", path: "columns" },
    ]);
    const ignoreRows = Array.from({ length: 21 }, (_, i) => `^Разом ${i}`);
    expect(await refused(space, { schemaVersion: 1, filters: { ignoreRows } })).toEqual([
      { code: "TOO_MANY_PATTERNS", path: "" },
    ]);
    expect(await refused(space, { schemaVersion: 2 })).toEqual([
      { code: "UNSUPPORTED_SCHEMA_VERSION", path: "schemaVersion" },
    ]);
    expect(await refused(space, "not a recipe")).toEqual([{ code: "RECIPE_NOT_JSON", path: "" }]);
    expect(await refused(space, [FULL_RECIPE])).toEqual([{ code: "INVALID_VALUE", path: "" }]);
    expect(await recipes(space.householdId)).toBe(0);
  });

  it("IMP-06@PoC FR 14: U+0000 and other control characters in a label or the name are refused before storage", async () => {
    const space = await newSpace();
    expect(
      await refused(space, {
        schemaVersion: 1,
        sign: { mode: "indicator", column: 7, outValues: ["Деб\u0000ет"], inValues: ["К"] },
      }),
    ).toEqual([{ code: "INVALID_CHARACTER", path: "sign.outValues[0]" }]);
    expect(
      await refused(space, {
        schemaVersion: 1,
        columns: [{ column: 1, role: "date", header: "Дата\u001b[2J" }],
      }),
    ).toEqual([{ code: "INVALID_CHARACTER", path: "columns[0].header" }]);
    // A lone surrogate would fail in PostgreSQL's jsonb: refused by the module, never a 500.
    expect(await refused(space, { schemaVersion: 1, file: { sheet: "\ud800" } })).toEqual([
      { code: "INVALID_CHARACTER", path: "file.sheet" },
    ]);
    for (const name of [
      "Банк\u0000",
      "Банк\u0007 CSV",
      `Банк${String.fromCharCode(0x2028)}CSV`,
      "x".repeat(121),
    ]) {
      const res = await save(space, FULL_RECIPE, name);
      expect(res.statusCode, JSON.stringify(name)).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
    const badFingerprint = await call(space, "POST", "/v1/import/recipes", {
      name: "Банк",
      recipe: FULL_RECIPE,
      fingerprint: "fp1:not-a-hash",
    });
    expect(badFingerprint.statusCode).toBe(400);
    expect(await recipes(space.householdId)).toBe(0);
  });

  it(`Lead decision 2026-11-19 (recipe storage, technical ceiling): a space holds at most ${RECIPES_PER_SPACE} recipes (a technical ceiling, never 402); two saves at once never pass it`, async () => {
    const space = await newSpace();
    await db.owner.query(
      `INSERT INTO import_recipes.recipes (household_id, id, name, schema_version, recipe, created_by)
       SELECT $1, gen_random_uuid(), 'Рецепт ' || i, 1, '{"schemaVersion":1}', $2
       FROM generate_series(1, $3::int) AS i`,
      [space.householdId, space.accountId, RECIPES_PER_SPACE - 1],
    );
    const both = await Promise.all([
      save(space, { schemaVersion: 1 }, "A"),
      save(space, { schemaVersion: 1 }, "B"),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    const over = both.find((r) => r.statusCode === 422)!;
    expect(over.json()).toMatchObject({ code: "LIMIT_REACHED", limit: RECIPES_PER_SPACE });
    expect(await recipes(space.householdId)).toBe(RECIPES_PER_SPACE);
    // Still readable at the ceiling.
    expect((await call(space, "GET", "/v1/import/recipes")).statusCode).toBe(200);
  });
});

describe("IMP-06@PoC «Права доступу»: the space's boundary and the roles", () => {
  it("IMP-06@PoC «Права доступу»: another space's member can neither read nor delete a recipe, nor see it listed", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    const id = await newRecipe(mine);
    expect((await call(other, "GET", `/v1/import/recipes/${id}`)).statusCode).toBe(404);
    expect((await call(other, "DELETE", `/v1/import/recipes/${id}`)).statusCode).toBe(404);
    expect((await call(other, "GET", "/v1/import/recipes")).json().items).toEqual([]);
    expect(await recipes(mine.householdId)).toBe(1);
    expect(await recipeAudit(other.householdId, "delete")).toBe(0);
    // The row policy, under the module's own role: the other space sees no row.
    const seen = await db.databases
      .for("import-recipes")
      .inHousehold(
        other.householdId,
        async (q) => (await q.query("SELECT 1 FROM recipes WHERE id = $1", [id])).rowCount,
      );
    expect(seen).toBe(0);
  });

  it("IMP-06@PoC «Права доступу»: a scoped member of any role neither reads nor changes a recipe (404)", async () => {
    const space = await newSpace();
    const id = await newRecipe(space);
    for (const role of ["editor", "viewer", "advisor"]) {
      const as = { role, scoped: true };
      expect((await call(space, "GET", "/v1/import/recipes", undefined, as)).statusCode, role).toBe(404);
      const one = await call(space, "GET", `/v1/import/recipes/${id}`, undefined, as);
      expect(one.statusCode, role).toBe(404);
      expect(leakText(one.body)).not.toContain("Синтетичний");
      // A scoped member holds only the read permission: writes are 403 before the route runs.
      expect((await save(space, FULL_RECIPE, "Scoped", as)).statusCode, role).toBe(403);
      expect((await call(space, "DELETE", `/v1/import/recipes/${id}`, undefined, as)).statusCode, role).toBe(
        403,
      );
    }
    expect(await recipes(space.householdId)).toBe(1);
  });

  it("IMP-06@PoC «Права доступу»: Owner, Admin and Editor save and delete; Viewer and Advisor only read", async () => {
    const space = await newSpace();
    for (const role of ["owner", "admin", "editor"]) {
      const res = await save(space, FULL_RECIPE, `Рецепт ${role}`, { role });
      expect(res.statusCode, role).toBe(201);
      const id = res.json().id as string;
      expect(
        (await call(space, "GET", `/v1/import/recipes/${id}`, undefined, { role })).statusCode,
        role,
      ).toBe(200);
      expect(
        (await call(space, "DELETE", `/v1/import/recipes/${id}`, undefined, { role })).statusCode,
        role,
      ).toBe(200);
    }
    const id = await newRecipe(space);
    for (const role of ["viewer", "advisor"]) {
      expect(
        (await call(space, "GET", "/v1/import/recipes", undefined, { role })).json().items,
        role,
      ).toHaveLength(1);
      expect(
        (await call(space, "GET", `/v1/import/recipes/${id}`, undefined, { role })).statusCode,
        role,
      ).toBe(200);
      expect((await save(space, FULL_RECIPE, "Ні", { role })).statusCode, role).toBe(403);
      expect(
        (await call(space, "DELETE", `/v1/import/recipes/${id}`, undefined, { role })).statusCode,
        role,
      ).toBe(403);
    }
    expect(await recipes(space.householdId)).toBe(1);
  });

  it("IMP-06@PoC «Права доступу»: with the release flag `data.import` off the routes do not exist (404)", async () => {
    const space = await newSpace();
    const id = await newRecipe(space);
    flags = fakeFlags({ off: ["data.import"] });
    expect((await call(space, "GET", "/v1/import/recipes")).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/import/recipes/${id}`)).statusCode).toBe(404);
    expect((await save(space, FULL_RECIPE)).statusCode).toBe(404);
    expect((await call(space, "DELETE", `/v1/import/recipes/${id}`)).statusCode).toBe(404);
    expect(await recipes(space.householdId)).toBe(1);
  });
});

describe("IMP-06@PoC: audit entries through the module's queue (ADR-0015)", () => {
  it("IMP-06@PoC FR 1: saving and deleting a recipe are audit entries, without its name, rules or account value", async () => {
    const space = await newSpace();
    const id = await newRecipe(space);
    expect(await recipeAudit(space.householdId, "create")).toBe(1);
    await call(space, "DELETE", `/v1/import/recipes/${id}`);
    expect(await recipeAudit(space.householdId, "delete")).toBe(1);
    const { rows } = await db.owner.query<{ e: string }>(
      "SELECT row_to_json(a)::text AS e FROM audit.entries a WHERE household_id = $1 AND entity_type = 'import-recipes.recipe'",
      [space.householdId],
    );
    for (const { e } of rows) {
      expect(e).not.toContain("Синтетичний");
      expect(e).not.toContain("UA00");
      expect(e).not.toContain("Разом");
    }
    expect(
      await n(
        "import_recipes.jobs WHERE household_id = $1 AND name = 'import-recipes.hand-off'",
        space.householdId,
      ),
    ).toBe(2);
  });

  it("ARC-04@PoC FR 4: an import-recipes audit job in state dead goes back to the queue with the daily recovery", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "import-recipes.recipe") throw new Error("injected");
      return original(householdId, entry);
    });
    await newRecipe(space);
    expect(await recipeAudit(space.householdId, "create")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "import_recipes.hand_off_deferred")).toBe(
      true,
    );
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE import_recipes.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await recipeAudit(space.householdId, "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("import-recipes.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await tasks.find((t) => t.name === "import-recipes.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await n("import_recipes.jobs WHERE household_id = $1 AND state = 'done'", space.householdId)).toBe(
      1,
    );
    expect(await recipeAudit(space.householdId, "create")).toBe(1);
  });
});

describe("NFR-12@PoC FR 3: erasure of a space takes its recipes", () => {
  it("NFR-12@PoC FR 3: the erasure run deletes the space's recipes, sealed values and queue rows; the neighbour keeps its own", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-erasure-recipes-"));
    try {
      const person = await personWithSpace(db, "recipes");
      const neighbour = await personWithSpace(db, "recipes-neighbour");
      const as = (p: { accountId: string; householdId: string }) => ({
        accountId: p.accountId,
        householdId: p.householdId,
      });
      await newRecipe(as(person));
      await newRecipe(as(neighbour));
      expect(await recipes(person.householdId)).toBe(1);
      const t = now;
      await withTestErasureDatabases(db, async (erasureDatabases) => {
        const erasure = createDataErasure({
          databases: db.databases,
          erasureDatabases,
          log: localErasureLog({ dir }),
          now: () => t,
        });
        const request = await erasure.request({ accountId: person.accountId });
        await erasure.run(request.requestId);
      });
      for (const table of ["recipes", "jobs", "outbox_events", "idempotency_keys"])
        expect(await n(`import_recipes.${table} WHERE household_id = $1`, person.householdId), table).toBe(0);
      expect(await recipes(neighbour.householdId)).toBe(1);
      const steps = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
        type: "import-recipes.records",
        id: person.householdId,
      });
      expect(steps.map((e) => [e.action, e.changes[0]!.after])).toEqual([["delete", "erasure-request"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
