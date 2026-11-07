import { randomBytes } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
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
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, principalHeader, testApiOptions, testWiring } from "./http.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * Security review of PR #85, round 2 (ARC-09 FR 3): after the re-entry hooks were removed, the database span
 * of each of many concurrent requests — over real sockets, with bodies, on a pool smaller than the number of
 * requests — is a child of its own request span: traces of different requests never mix.
 */
const telemetry = testTelemetryForFile();
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const CONCURRENT = 12;

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: FastifyInstance;

const createAccount = defineRoute({
  module: "wallets",
  method: "POST",
  path: "/v1/wallets/accounts",
  operationId: "createWalletAccountSec85r2",
  summary: "x",
  access: { permission: "accounts.write", feature: "accounts" },
  request: { body: z.object({ name: z.string(), amount: z.string(), currency: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ id: z.uuid() }) },
  handler: async ({ body }, ctx) =>
    ctx.inHousehold(async (q) => {
      // Holds the connection a little, so the pool (3) queues the others.
      await q.query("SELECT pg_sleep(0.02)");
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO accounts (household_id, name, balance_amount, balance_currency)
         VALUES ($1, $2, $3::numeric, $4) RETURNING id`,
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
  await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app?.close();
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

function post(port: number, index: number): Promise<string> {
  const body = JSON.stringify({
    name: `wallet ${index} ${"x".repeat(8_000)}`,
    amount: "10.00",
    currency: "UAH",
  });
  const head =
    `POST /v1/wallets/accounts HTTP/1.1\r\nhost: x\r\nconnection: close\r\ncontent-type: application/json\r\n` +
    `content-length: ${Buffer.byteLength(body)}\r\nx-test-principal: ${principalHeader({ householdId: householdA })["x-test-principal"]}\r\n\r\n`;
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", async () => {
      socket.write(head);
      for (let i = 0; i < body.length; i += 2_000) {
        socket.write(body.slice(i, i + 2_000));
        await new Promise((r) => setTimeout(r, 1 + (index % 3)));
      }
    });
    let out = "";
    socket.on("data", (d) => (out += d.toString("utf8")));
    socket.on("close", () => resolve(out));
    socket.on("error", reject);
  });
}

describe("sec85r2: ARC-09 FR 3 — concurrent requests keep their own traces down to the database", () => {
  it(`${CONCURRENT} concurrent requests on a pool of 3: each database span is a child of its own request span`, async () => {
    telemetry.memory.reset();
    const { port } = app.server.address() as AddressInfo;
    const answers = await Promise.all(Array.from({ length: CONCURRENT }, (_, i) => post(port, i)));
    for (const a of answers) expect(a).toMatch(/^HTTP\/1\.1 201 /);
    const spans = telemetry.memory.finishedSpans();
    const requests = spans.filter((s) => s.kind === SpanKind.SERVER);
    const transactions = spans.filter((s) => s.name === "db.transaction wallets");
    expect(requests).toHaveLength(CONCURRENT);
    expect(transactions).toHaveLength(CONCURRENT);
    for (const request of requests) {
      const children = transactions.filter(
        (t) =>
          t.parentSpanContext?.spanId === request.spanContext().spanId &&
          t.spanContext().traceId === request.spanContext().traceId,
      );
      expect(children).toHaveLength(1);
    }
  });
});
