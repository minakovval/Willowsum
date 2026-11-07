import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SpanKind } from "@opentelemetry/api";
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
 * NFR-10 acceptance 1 on a real PostgreSQL: «Given a request with an amount and an account name failed with a
 * database error, When the error reaches the log, Then the log has the state code and the names of the
 * constraint, table and column, but not the amount or the account name». The fixture module `wallets` has
 * `accounts` with a unique name per space, a non-negative balance and a required currency.
 */
const telemetry = testTelemetryForFile();
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));

const ACCOUNT_NAME = "Картка Золота";
const AMOUNT = "1234.56";
const NEGATIVE = "-98765.43";

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: FastifyInstance;

const createAccount = defineRoute({
  module: "wallets",
  method: "POST",
  path: "/v1/wallets/accounts",
  operationId: "createWalletAccount",
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
        testApiOptions([createAccount], {
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

const create = (body: { name: string; amount: string; currency: string }) =>
  app.inject({
    method: "POST",
    url: "/v1/wallets/accounts",
    headers: { ...principalHeader({ householdId: householdA }), "content-type": "application/json" },
    payload: body,
  });

async function failedWith(body: { name: string; amount: string; currency: string }) {
  telemetry.memory.reset();
  const res = await create(body);
  expect(res.statusCode).toBe(500);
  const record = telemetry.memory.logRecords().find((r) => r.body === "api.server_error");
  expect(record).toBeDefined();
  expect(record!.spanContext?.traceId).toBe(res.json().supportId);
  const text = (await exportedText(telemetry)) + res.body;
  for (const secret of [ACCOUNT_NAME, "Картка", AMOUNT, NEGATIVE, "98765", "Failing row", "already exists"])
    expect(text).not.toContain(secret);
  return record!.attributes;
}

describe("NFR-10 acceptance 1 / FR 2: a database error is logged as state code and names only", () => {
  it("unique violation (an account with the same name): SQLSTATE 23505, constraint, table, schema", async () => {
    expect((await create({ name: ACCOUNT_NAME, amount: AMOUNT, currency: "UAH" })).statusCode).toBe(201);
    expect(await failedWith({ name: ACCOUNT_NAME, amount: AMOUNT, currency: "UAH" })).toMatchObject({
      "http.route": "/v1/wallets/accounts",
      "ws.problem.code": "INTERNAL",
      "error.type": "DatabaseError",
      "db.response.status_code": "23505",
      "ws.db.constraint": "accounts_household_name_key",
      "ws.db.table": "accounts",
      "ws.db.schema": "wallets",
    });
  });

  it("check violation (a negative amount): SQLSTATE 23514 and the constraint", async () => {
    expect(await failedWith({ name: `${ACCOUNT_NAME} 2`, amount: NEGATIVE, currency: "UAH" })).toMatchObject({
      "db.response.status_code": "23514",
      "ws.db.constraint": "accounts_balance_not_negative",
      "ws.db.table": "accounts",
    });
  });

  it("not-null violation (no currency): SQLSTATE 23502 and the column", async () => {
    expect(await failedWith({ name: `${ACCOUNT_NAME} 3`, amount: AMOUNT, currency: "" })).toMatchObject({
      "db.response.status_code": "23502",
      "ws.db.table": "accounts",
      "ws.db.column": "balance_currency",
    });
  });

  it("the module's transaction span is a child of the request span and carries the same fields", async () => {
    await failedWith({ name: ACCOUNT_NAME, amount: AMOUNT, currency: "UAH" });
    const spans = telemetry.memory.finishedSpans();
    const request = spans.find((s) => s.kind === SpanKind.SERVER)!;
    const transaction = spans.find((s) => s.name === "db.transaction wallets")!;
    expect(transaction.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(transaction.attributes).toMatchObject({
      "ws.module": "wallets",
      "db.response.status_code": "23505",
      "ws.db.constraint": "accounts_household_name_key",
    });
  });
});
