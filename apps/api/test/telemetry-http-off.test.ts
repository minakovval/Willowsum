import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { startTelemetry } from "../src/platform/telemetry/telemetry.ts";
import { principalHeader, testApiOptions, testWiring } from "./http.ts";

/**
 * ARC-09@PoC FR 1 and 3, NFR-10@PoC FR 1 and 4 in `WS_TELEMETRY=off` (the PoC in production, owner 2026-11-12): the
 * support code a user sees on an error (supportId) is the trace_id of the server's JSON log line for that
 * request, so the owner finds the line from the code.
 */
const lines: string[] = [];
const telemetry = startTelemetry({
  mode: "off",
  role: "api",
  environment: "production",
  writeLogLine: (line) => lines.push(line),
});

const failing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things/{thingId}/sync",
  operationId: "syncThingOff",
  summary: "x",
  access: { permission: "things.read", feature: "things" },
  request: { params: z.object({ thingId: z.string() }), body: z.object({ note: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => {
    throw new Error("synthetic failure");
  },
});

let app: FastifyInstance;

beforeAll(async () => {
  const wired = apiOptions(testWiring());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([failing], { supportId: wired.supportId!, reportError: wired.reportError! }),
      ),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await telemetry.shutdown();
});

describe("WS_TELEMETRY=off: the error's support code finds its server log line", () => {
  it("a 500 response's supportId equals trace_id of the api.server_error line on stdout", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/things/a/sync",
      headers: { ...principalHeader(), "content-type": "application/json" },
      payload: { note: "n" },
    });
    expect(res.statusCode).toBe(500);
    await telemetry.forceFlush();
    const supportId = res.json().supportId as string;
    expect(supportId).toMatch(/^[0-9a-f]{32}$/);
    const records = lines.map(
      (l) => JSON.parse(l) as { event?: string; trace_id?: string; severity?: string },
    );
    const error = records.find((r) => r.event === "api.server_error");
    expect(error).toMatchObject({ severity: "ERROR", trace_id: supportId });
  });
});
