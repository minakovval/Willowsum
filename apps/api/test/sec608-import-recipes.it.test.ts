import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createImportRecipesServices } from "../src/modules/import-recipes/index.ts";
import { requestHash } from "../src/platform/http/idempotency.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { kms, personWithSpace, withTestErasureDatabases } from "./erasure-helpers.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #608 (IMP-06@PoC a, part 2): the account binding's value never leaves the sealed column — not in
 * the idempotency hash, the queue, the audit log, the logs or an answer; the row policy holds on every table of the
 * schema; hostile recipe input is refused without a 500. Every value is synthetic and built at runtime.
 */
const WEB = "http://localhost:5173";
// A synthetic account number built at runtime (no bank has it): 2 letters, 27 digits.
const ACCOUNT = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");
const TAIL = ACCOUNT.slice(-4);
const BODY = ACCOUNT.slice(0, -4);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const flags = fakeFlags();
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
function post(space: Space, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/import/recipes",
    headers: {
      origin: WEB,
      "content-type": "application/json",
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...headers,
    },
    payload: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const withAccount = (value: string, by = "iban") => ({ schemaVersion: 1, account: { by, value } });

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags,
        authenticate: testAuthenticate,
        importRecipes: createImportRecipesServices({
          keys: createSpaceKeys(db.databases.for("household"), audit, kms),
          audit,
          clock: { now: () => Date.parse("2026-11-19T10:00:00Z") },
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

describe("SEC-608: the account binding's value stays sealed", () => {
  it("SEC-608 NFR-01@PoC FR 6: the idempotency hash of a save cannot be searched for the account value", async () => {
    const space = await newSpace();
    const body = { name: "Банк", recipe: withAccount(ACCOUNT) };
    const key = randomUUID();
    const res = await post(space, body, { "idempotency-key": key });
    expect(res.statusCode, res.body).toBe(201);
    const { rows } = await db.owner.query<{ request_hash: string; response_body: string }>(
      "SELECT request_hash, response_body FROM import_recipes.idempotency_keys WHERE household_id = $1",
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.response_body).not.toContain(BODY);
    // What a reader of the table can do: take the stored recipe and name, try candidate values, compare the hash.
    const stored = await db.owner.query<{ name: string; recipe: { account: object } }>(
      "SELECT name, recipe FROM import_recipes.recipes WHERE household_id = $1",
      [space.householdId],
    );
    const guess = (value: string) =>
      requestHash("createImportRecipe", {
        params: undefined,
        query: undefined,
        body: {
          name: stored.rows[0]!.name,
          recipe: { ...stored.rows[0]!.recipe, account: { ...stored.rows[0]!.recipe.account, value } },
        },
      });
    expect(guess(ACCOUNT)).not.toBe(rows[0]!.request_hash);
    // The same key with the same request still replays.
    const again = await post(space, body, { "idempotency-key": key });
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(res.json().id);
    expect(leakText(again.body)).not.toContain(BODY);
  });

  it("SEC-608 NFR-01@PoC FR 6: the value is in no answer, queue row, audit entry, log line or span", async () => {
    const space = await newSpace();
    const ok = await post(space, { name: "Банк", recipe: withAccount(ACCOUNT) });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().accountValueLast4).toBe(TAIL);
    expect(leakText(ok.body)).not.toContain(BODY);
    // A refused recipe that carries the value: nothing of it in the answer.
    const bad = await post(space, { name: "Банк", recipe: { ...withAccount(ACCOUNT), colour: ACCOUNT } });
    expect(bad.statusCode).toBe(422);
    expect(leakText(bad.body)).not.toContain(BODY);
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/import/recipes/${ok.json().id}`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
    });
    expect(del.statusCode).toBe(200);
    for (const table of ["import_recipes.jobs", "import_recipes.outbox_events", "audit.entries"]) {
      const { rows } = await db.owner.query<{ t: string }>(
        `SELECT row_to_json(x)::text AS t FROM ${table} x WHERE household_id = $1`,
        [space.householdId],
      );
      for (const { t } of rows) {
        expect(t, table).not.toContain(BODY);
        expect(t, table).not.toContain("Банк");
      }
    }
    const text = await exportedText(telemetry);
    expect(text).not.toContain(BODY);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain("Банк");
  });

  it("SEC-608 NFR-01@PoC FR 6: a short value is not shown whole", async () => {
    const space = await newSpace();
    for (const value of ["1234", "12", "A1 B2"]) {
      // IMP-07 FR 2: a name is unique in its scope.
      const res = await post(space, { name: `Банк ${value}`, recipe: withAccount(value, "account-number") });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().accountValueLast4, value).not.toBe(value.replace(/\s+/g, ""));
    }
  });

  it("SEC-608: the database refuses a recipe row whose JSON holds the account value", async () => {
    const space = await newSpace();
    await expect(
      db.owner.query(
        `INSERT INTO import_recipes.recipes (household_id, id, name, schema_version, recipe, created_by)
         VALUES ($1, gen_random_uuid(), 'x', 1, $2::jsonb, $3)`,
        [space.householdId, JSON.stringify(withAccount(ACCOUNT)), space.accountId],
      ),
    ).rejects.toThrow();
  });
});

describe("SEC-608: the row policy on every table of import_recipes", () => {
  it("SEC-608 ARC-03@PoC FR 2: every table has a forced row policy; another space reads and writes nothing", async () => {
    const { rows } = await db.owner.query<{ t: string; rls: boolean; forced: boolean; policies: number }>(
      `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'import_recipes' AND c.relkind = 'r' ORDER BY 1`,
    );
    const tables = rows.filter((r) => !r.t.includes("migration"));
    expect(tables.map((r) => r.t)).toEqual([
      "idempotency_keys",
      "jobs",
      "outbox_events",
      "recipe_versions",
      "recipes",
    ]);
    for (const r of tables) expect(r, r.t).toMatchObject({ rls: true, forced: true, policies: 1 });

    const mine = await newSpace();
    const other = await newSpace();
    const res = await post(
      mine,
      { name: "Банк", recipe: withAccount(ACCOUNT) },
      { "idempotency-key": "k-1" },
    );
    expect(res.statusCode).toBe(201);
    const moduleDb = db.databases.for("import-recipes");
    for (const table of ["recipes", "recipe_versions", "jobs", "idempotency_keys"]) {
      const seen = await moduleDb.inHousehold(other.householdId, async (q) => {
        const read = (await q.query(`SELECT 1 FROM ${table}`)).rowCount;
        const explicit = (await q.query(`SELECT 1 FROM ${table} WHERE household_id = $1`, [mine.householdId]))
          .rowCount;
        const removed = (await q.query(`DELETE FROM ${table} WHERE household_id = $1`, [mine.householdId]))
          .rowCount;
        return [read, explicit, removed];
      });
      expect(seen, table).toEqual([0, 0, 0]);
    }
    // A row for another space cannot be written from this one.
    await expect(
      moduleDb.inHousehold(other.householdId, (q) =>
        q.query(
          `INSERT INTO recipes (household_id, id, name, schema_version, recipe, created_by)
           VALUES ($1, gen_random_uuid(), 'x', 1, '{"schemaVersion":1}', $2)`,
          [mine.householdId, other.accountId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // The same idempotency key in another space is another key: no replay of the first space's answer.
    const replay = await post(
      other,
      { name: "Банк", recipe: withAccount(ACCOUNT) },
      { "idempotency-key": "k-1" },
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).not.toBe(res.json().id);
  });
});

describe("SEC-608: hostile recipe input", () => {
  it("SEC-608 IMP-06@PoC FR 2, FR 14: deep nesting, prototype keys and control characters are refused, never a 500", async () => {
    const space = await newSpace();
    let deep: unknown = "x";
    for (let i = 0; i < 7; i++) deep = { a: deep };
    const cases: [string, unknown, number][] = [
      ["7 levels", { schemaVersion: 1, file: deep }, 422],
      ["value with U+0000", withAccount("12\u000034"), 422],
      ["value with a lone surrogate", withAccount("12\ud80034"), 422],
      ["value of 65 characters", withAccount("1".repeat(65)), 422],
      ["a key with U+0000", { schemaVersion: 1, numbers: { currencySymbols: { "\u0000": "USD" } } }, 422],
      ["an unknown key with U+0000", { schemaVersion: 1, "a\u0000": 1 }, 422],
      // The body parser refuses a prototype key before the route runs.
      ["constructor key", { schemaVersion: 1, constructor: { prototype: { x: 1 } } }, 400],
      ["a number as a recipe", 5, 422],
      ["null", null, 422],
    ];
    for (const [label, recipe, status] of cases) {
      const res = await post(space, { name: "Банк", recipe });
      expect(res.statusCode, `${label}: ${res.body}`).toBe(status);
      expect(leakText(res.body), label).not.toContain("\\u0000");
    }
    // 5 000 levels in the raw body: refused, the process answers.
    const raw = `{"name":"x","recipe":${"[".repeat(5000)}${"]".repeat(5000)}}`;
    expect((await post(space, raw)).statusCode).toBe(422);
    const proto = await post(space, '{"name":"x","recipe":{"schemaVersion":1,"__proto__":{"a":1}}}');
    expect([400, 422]).toContain(proto.statusCode);
    expect(
      (
        await db.owner.query("SELECT 1 FROM import_recipes.recipes WHERE household_id = $1", [
          space.householdId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("SEC-608 IMP-06@PoC FR 14: the database refuses a name with a control character", async () => {
    const space = await newSpace();
    for (const name of [
      "a\u0001",
      "a\u001f",
      "a\u007f",
      "a\u0085",
      `a${String.fromCharCode(0x2028)}`,
      "a\nb",
    ])
      await expect(
        db.owner.query(
          `INSERT INTO import_recipes.recipes (household_id, id, name, schema_version, recipe, created_by)
           VALUES ($1, gen_random_uuid(), $2, 1, '{"schemaVersion":1}', $3)`,
          [space.householdId, name, space.accountId],
        ),
        JSON.stringify(name),
      ).rejects.toThrow(/check constraint/);
  });
});

describe("SEC-608: erasure takes the stored answers too", () => {
  it("SEC-608 NFR-12@PoC FR 3: the erasure run deletes the space's idempotency keys (the stored answer holds the recipe)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-sec608-"));
    try {
      const person = await personWithSpace(db, "sec608");
      const neighbour = await personWithSpace(db, "sec608-neighbour");
      const keys = (householdId: string) =>
        db.owner
          .query("SELECT 1 FROM import_recipes.idempotency_keys WHERE household_id = $1", [householdId])
          .then((r) => r.rowCount);
      for (const p of [person, neighbour]) {
        const res = await post(
          { accountId: p.accountId, householdId: p.householdId },
          { name: "Банк", recipe: withAccount(ACCOUNT) },
          { "idempotency-key": randomUUID() },
        );
        expect(res.statusCode, res.body).toBe(201);
        expect(await keys(p.householdId)).toBe(1);
      }
      const t = Date.parse("2026-11-19T10:00:00Z");
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
      expect(await keys(person.householdId)).toBe(0);
      expect(await keys(neighbour.householdId)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
