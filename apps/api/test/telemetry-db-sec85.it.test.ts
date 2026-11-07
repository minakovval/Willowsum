import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, principalHeader, testApiOptions, testWiring } from "./http.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * Security review of PR #85 — NFR-10 FR 2 on a real PostgreSQL for the fields the unit tests only fake: an
 * error raised inside an internally executed query (`internalQuery`), a bad parameter (`where` with the
 * parameter value) and a parse error (`detail` with the input). Based on telemetry-db.it.test.ts.
 *
 * NFR-10 acceptance 1 on a real PostgreSQL: «Given a request with an amount and an account name failed with a
 * database error, When the error reaches the log, Then the log has the state code and the names of the
 * constraint, table and column, but not the amount or the account name». The fixture module `wallets` has
 * `accounts` with a unique name per space, a non-negative balance and a required currency.
 */
const telemetry = testTelemetryForFile();
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: FastifyInstance;

const createAccount = defineRoute({
  module: "wallets",
  method: "POST",
  path: "/v1/wallets/accounts",
  operationId: "createWalletAccountSec85",
  summary: "x",
  access: { permission: "accounts.write", feature: "accounts" },
  request: { body: z.object({ name: z.string(), amount: z.string(), currency: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ id: z.uuid() }) },
  handler: async ({ body }, ctx) =>
    ctx.inHousehold(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO accounts (household_id, name, balance_amount, balance_currency)
         VALUES ($1, $2, $3::numeric, NULLIF($4, '')) RETURNING id`,
        [q.householdId, body.name, body.amount, body.currency],
      );
      return rows[0]!;
    }),
});

const probe = defineRoute({
  module: "wallets",
  method: "POST",
  path: "/v1/wallets/probe",
  operationId: "probeWalletSec85",
  summary: "x",
  access: { permission: "accounts.write", feature: "accounts" },
  request: { body: z.object({ kind: z.enum(["internal", "param", "detail"]), value: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async ({ body }, ctx) =>
    ctx.inHousehold(async (q) => {
      const sql = {
        internal: "SELECT query_to_xml(format('select %L::int', $1::text), true, false, '')",
        param: "SELECT $1::numeric",
        detail: "SELECT xmlparse(document $1::text)",
      }[body.kind];
      await q.query(sql, [body.value]);
      return { ok: true };
    }),
});

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: ["wallets"], modulesDir: fixtures });
  const password = randomBytes(12).toString("hex");
  await enableModuleLogin(owner, "wallets", password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
  });
  const wired = apiOptions(testWiring());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([createAccount, probe], {
          databases,
          supportId: wired.supportId!,
          reportError: wired.reportError!,
        }),
      ),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

const SECRET = "Картка Золота 1 234,56 грн olha.kovalenko@example.com";

describe("sec85: NFR-10 FR 2 — internalQuery, where (parameter value) and detail never leave", () => {
  it.each([
    ["internal", "22P02"],
    ["param", "22P02"],
    ["detail", "2200M"],
  ] as const)("%s → SQLSTATE %s only", async (kind, sqlState) => {
    telemetry.memory.reset();
    const value = kind === "detail" ? `<a>${SECRET}` : SECRET;
    const res = await app.inject({
      method: "POST",
      url: "/v1/wallets/probe",
      headers: { ...principalHeader({ householdId: householdA }), "content-type": "application/json" },
      payload: { kind, value },
    });
    expect(res.statusCode).toBe(500);
    const record = telemetry.memory.logRecords().find((r) => r.body === "api.server_error")!;
    expect(record.attributes["db.response.status_code"]).toBe(sqlState);
    const text = (await exportedText(telemetry)) + res.body;
    for (const fragment of [
      "Картка",
      "234,56",
      "грн",
      "olha",
      "query_to_xml",
      "portal",
      "Premature",
      "invalid input",
    ])
      expect(text).not.toContain(fragment);
  });
});
