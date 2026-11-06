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
import { moduleIdempotencyStore } from "../src/platform/http/idempotency.ts";
import { requireFound } from "../src/platform/http/problem.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, householdB, principalHeader, testAuthenticate } from "./http.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * DAT-05 AC5 on a real PostgreSQL: a record of another space behaves as one that does not exist — by direct
 * link the same 404 as a missing id or an unknown path, never «no access»; in a list it is simply absent.
 * The fixture module `idem` has the table `things` under the household policy.
 */
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: FastifyInstance;
let thingOfB: string;
let thingOfA: string;

const access = { permission: "things.read", feature: "things" };
const thing = z.object({ id: z.uuid(), name: z.string() });

const getThing = defineRoute({
  module: "idem",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThing",
  summary: "One thing",
  access,
  request: { params: z.object({ thingId: z.uuid() }) },
  response: { status: 200, description: "The thing", schema: thing },
  // Filtered by id only, as a careless route might be: the household policy still hides other spaces' rows.
  handler: async ({ params }, ctx) =>
    requireFound(
      await ctx.inHousehold(async (q) => {
        const { rows } = await q.query<{ id: string; name: string }>(
          "SELECT id, name FROM things WHERE id = $1",
          [params.thingId],
        );
        return rows[0];
      }),
    ),
});

const searchThings = defineRoute({
  module: "idem",
  method: "GET",
  path: "/v1/things",
  operationId: "searchThings",
  summary: "Search things",
  access,
  request: { query: z.object({ q: z.string() }) },
  response: {
    status: 200,
    description: "Matches",
    schema: z.object({ items: z.array(thing), total: z.number() }),
  },
  handler: async ({ query }, ctx) =>
    ctx.inHousehold(async (q) => {
      const { rows } = await q.query<{ id: string; name: string }>(
        "SELECT id, name FROM things WHERE household_id = $1 AND name ILIKE $2 ORDER BY name",
        [q.householdId, `%${query.q}%`],
      );
      return { items: rows, total: rows.length };
    }),
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
  const seeded = await owner.query<{ id: string; household_id: string }>(
    `INSERT INTO idem.things (household_id, name) VALUES ($1, 'Deposit at Bank A'), ($2, 'Deposit at Bank B')
     RETURNING id, household_id`,
    [householdA, householdB],
  );
  thingOfA = seeded.rows.find((r) => r.household_id === householdA)!.id;
  thingOfB = seeded.rows.find((r) => r.household_id === householdB)!.id;
  app = Fastify({ logger: false });
  registerApi(app, {
    routes: [getThing, searchThings],
    authenticate: testAuthenticate,
    checkPermission: () => true,
    checkFeature: async () => true,
    moduleAvailable: async () => true,
    checkFlag: async () => true,
    permissions: new Set(["things.read"]),
    features: new Set(["things"]),
    flags: new Set(["things"]),
    flagRequires: () => undefined,
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

const asA = (url: string) =>
  app.inject({ method: "GET", url, headers: principalHeader({ householdId: householdA }) });

describe("DAT-05 AC5: another space's record behaves as non-existent, without «no access»", () => {
  it("by direct link: the same 404 as a missing id and an unknown path; never 403", async () => {
    expect((await asA(`/v1/things/${thingOfA}`)).statusCode).toBe(200);
    const other = await asA(`/v1/things/${thingOfB}`);
    const missing = await asA("/v1/things/00000000-0000-4000-8000-000000000000");
    const unknown = await asA("/v1/no-such-path");
    expect(other.statusCode).toBe(404);
    expect(other.body).toBe(missing.body);
    expect(other.body).toBe(unknown.body);
    expect(other.json()).toEqual({
      type: "urn:willowsum:problem:not-found",
      title: "Not found",
      status: 404,
      code: "NOT_FOUND",
    });
    expect(other.body).not.toContain(thingOfB);
  });

  it("in a search: the record is absent, and neither the list nor its count shows it", async () => {
    const res = await asA("/v1/things?q=Deposit");
    expect(res.json()).toEqual({ items: [{ id: thingOfA, name: "Deposit at Bank A" }], total: 1 });
    expect((await asA("/v1/things?q=Bank%20B")).json()).toEqual({ items: [], total: 0 });
  });
});
