import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { IDEMPOTENCY_REPLAYED_HEADER, moduleIdempotencyStore } from "../src/platform/http/idempotency.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, householdB, principalHeader, testAuthenticate } from "./http.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * ARC-07 FR 4 on a real PostgreSQL: idempotency keys stored per household and key with the request hash, in
 * the route module's own schema under the household row policy (the fixture module `idem` ships the
 * platform's idempotency_keys migration verbatim, as every module with create routes must).
 */
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: FastifyInstance;
let fail = false;

const createThing = defineRoute({
  module: "idem",
  method: "POST",
  path: "/v1/things",
  operationId: "createThing",
  summary: "Create a thing",
  access: { permission: "things.write", feature: "things" },
  create: true,
  request: { body: z.strictObject({ name: z.string().min(1) }) },
  response: { status: 201, description: "Created", schema: z.object({ id: z.uuid(), name: z.string() }) },
  handler: async ({ body }, ctx) => {
    if (fail) throw new Error("boom");
    return ctx.inHousehold(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        "INSERT INTO things (household_id, name) VALUES ($1, $2) RETURNING id",
        [q.householdId, body.name],
      );
      return { id: rows[0]!.id, name: body.name };
    });
  },
});

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: ["idem"], modulesDir: fixtures });
  const password = randomBytes(12).toString("hex");
  await enableModuleLogin(owner, "idem", password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
  });
  app = Fastify({ logger: false });
  registerApi(app, {
    routes: [createThing],
    authenticate: testAuthenticate,
    checkPermission: () => true,
    checkFeature: async () => true,
    permissions: new Set(["things.write"]),
    features: new Set(["things"]),
    databases,
    idempotency: (module) => moduleIdempotencyStore(databases.for(module)),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

const post = (name: string, key?: string, householdId = householdA) =>
  app.inject({
    method: "POST",
    url: "/v1/things",
    headers: {
      "content-type": "application/json",
      ...principalHeader({ householdId }),
      ...(key ? { "idempotency-key": key } : {}),
    },
    payload: { name },
  });

async function count(householdId: string): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM idem.things WHERE household_id = $1",
    [householdId],
  );
  return Number(rows[0]!.n);
}

describe("ARC-07 FR 4: idempotency keys on create requests (PostgreSQL)", () => {
  it("the same key and the same body return the same response; one row is created", async () => {
    const before = await count(householdA);
    const first = await post("Rent", "k-same");
    const again = await post("Rent", "k-same");
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.body).toBe(first.body);
    expect(again.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
    expect(await count(householdA)).toBe(before + 1);
  });

  it("the same key with a different body is 409 IDEMPOTENCY_KEY_REUSED and creates nothing", async () => {
    await post("Rent", "k-diff");
    const before = await count(householdA);
    const res = await post("Food", "k-diff");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    expect(await count(householdA)).toBe(before);
  });

  it("keys are stored per household: the same key in another household is its own request", async () => {
    const a = await post("Rent", "k-shared", householdA);
    const b = await post("Rent", "k-shared", householdB);
    expect(b.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
    expect(b.json().id).not.toBe(a.json().id);
  });

  it("the stored response is under the household row policy: another household's transaction sees no key", async () => {
    const rows = await databases
      .for("idem")
      .inHousehold(householdB, (q) => q.query("SELECT key FROM idempotency_keys WHERE key = 'k-same'"));
    expect(rows.rowCount).toBe(0);
    const { rows: stored } = await owner.query<{ request_hash: string; state: string }>(
      "SELECT request_hash, state FROM idem.idempotency_keys WHERE household_id = $1 AND key = 'k-same'",
      [householdA],
    );
    expect(stored).toEqual([{ request_hash: expect.stringMatching(/^[0-9a-f]{64}$/), state: "done" }]);
  });

  it("concurrent requests with one key create one row; the others replay it or are told it is still running", async () => {
    const before = await count(householdA);
    const results = await Promise.all(Array.from({ length: 5 }, () => post("Parallel", "k-race")));
    expect(await count(householdA)).toBe(before + 1);
    for (const r of results) {
      if (r.statusCode === 409) expect(r.json().code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
      else expect(r.statusCode).toBe(201);
    }
    expect(new Set(results.filter((r) => r.statusCode === 201).map((r) => r.json().id)).size).toBe(1);
  });

  it("a failed create releases the key: the retry runs and succeeds", async () => {
    fail = true;
    expect((await post("Retry", "k-fail")).statusCode).toBe(500);
    fail = false;
    const retry = await post("Retry", "k-fail");
    expect(retry.statusCode).toBe(201);
    expect(retry.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("an expired key may be used again for a new request", async () => {
    await post("Old", "k-expired");
    await owner.query(
      "UPDATE idem.idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = 'k-expired'",
    );
    const res = await post("New", "k-expired");
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("New");
  });
});
