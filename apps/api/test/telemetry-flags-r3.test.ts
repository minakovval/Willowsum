import { SpanKind } from "@opentelemetry/api";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import {
  createFlagRuntime,
  KILL_SWITCH_MAX_DELAY_MS,
} from "../src/modules/feature-flags/application/index.ts";
import { memoryFlagStore } from "../src/modules/feature-flags/application/memory-store.test-helper.ts";
import { registerApi, type ErrorReport } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { reportServerErrorToTelemetry } from "../src/platform/telemetry/errors.ts";
import { instrumentHttp, markRequestProblem } from "../src/platform/telemetry/http.ts";
import { redactAttributes } from "../src/platform/telemetry/redaction.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { flagReloadHealthLog } from "../src/wiring.ts";
import { fakeDatabases, principalHeader, testApiOptions } from "./http.ts";

/**
 * Re-review of PR #85 (blocking): a database or flag-store outage makes every module answer 503
 * MODULE_UNAVAILABLE (fail closed, CICD-06). That 503 is an outage, not a kill switch: it is labelled
 * `ws.unavailable.reason=flags_unknown`, counted in the 5xx ratio (the alert rules leave out only
 * `kill_switch`) and reported as the server error FlagStateUnavailable. The failing reloads are logged once.
 */
const telemetry = testTelemetryForFile();
const definitions = new URL("../../../tools/observability/definitions.mjs", import.meta.url).href;

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingR3",
  summary: "x",
  access: { permission: "things.read", feature: "things" },
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

/** The server with a real flag runtime, wired the way src/api.ts wires it. */
async function serverWith(runtime: ReturnType<typeof createFlagRuntime>, reports: ErrorReport[]) {
  const wired = apiOptions({
    databases: fakeDatabases().databases,
    entitlements: "all-enabled",
    flags: runtime,
  });
  expect(wired.moduleState).toBeDefined();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([getThing], {
          moduleAvailable: wired.moduleAvailable,
          moduleState: wired.moduleState!,
          supportId: wired.supportId!,
          reportError: (report, request) => {
            reports.push(report);
            reportServerErrorToTelemetry(report, request);
          },
        }),
      ),
  });
  await app.ready();
  return app;
}

async function lastDurationPoint() {
  await telemetry.forceFlush();
  const metric = telemetry.memory
    .resourceMetrics()
    .at(-1)!
    .scopeMetrics.flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === "http.server.request.duration")!;
  return metric.dataPoints.map((p) => p.attributes).filter((a) => a["http.response.status_code"] === 503);
}

/** Does a sample with these attributes count as a server error under the alert rules' selector? */
async function countedAsError(attributes: Record<string, unknown>): Promise<boolean> {
  const { SERVER_ERROR_SELECTOR } = (await import(definitions)) as { SERVER_ERROR_SELECTOR: string };
  const labels = Object.fromEntries(
    Object.entries(attributes).map(([k, v]) => [k.replaceAll(".", "_"), String(v)]),
  );
  for (const m of SERVER_ERROR_SELECTOR.matchAll(/([a-z_]+)(=~|!=|=)"([^"]*)"/g)) {
    const value = labels[m[1]!] ?? "";
    const ok =
      m[2] === "=~" ? new RegExp(`^(${m[3]})$`).test(value) : m[2] === "!=" ? value !== m[3] : value === m[3];
    if (!ok) return false;
  }
  return true;
}

describe("re-review of PR #85: an unknown flag state is an outage, a kill switch is a decision", () => {
  it("flag store down (never loaded): 503 MODULE_UNAVAILABLE to the client, but flags_unknown, counted as 5xx and reported", async () => {
    const store = memoryFlagStore();
    store.fail = true;
    const health: (string | undefined)[] = [];
    const runtime = createFlagRuntime(store, { onReloadHealth: (f) => health.push(f) });
    const reports: ErrorReport[] = [];
    const a = await serverWith(runtime, reports);
    const res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE" });
    expect(res.headers["retry-after"]).toBe("60");
    const [point] = await lastDurationPoint();
    expect(point).toMatchObject({
      "ws.problem.code": "MODULE_UNAVAILABLE",
      "ws.unavailable.reason": "flags_unknown",
    });
    expect(await countedAsError(point!)).toBe(true);
    expect(reports).toEqual([
      expect.objectContaining({
        code: "MODULE_UNAVAILABLE",
        status: 503,
        errorClass: "FlagStateUnavailable",
      }),
    ]);
    const record = telemetry.memory.logRecords().find((r) => r.body === "api.server_error")!;
    expect(record.attributes["error.type"]).toBe("FlagStateUnavailable");
    expect(record.spanContext?.traceId).toBe(res.json().supportId);
    expect(health).toEqual(["Error"]);
  });

  it("state older than 60 s after the store failed: the same — an outage, not a kill switch", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store);
    expect(await runtime.moduleState("things")).toBe("on");
    store.fail = true;
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS);
    expect(await runtime.moduleState("things")).toBe("unknown");
  });

  it("a module switched off on purpose: kill_switch, left out of the 5xx ratio, not reported", async () => {
    const store = memoryFlagStore();
    await store.setKillSwitch("things", true);
    const runtime = createFlagRuntime(store);
    const reports: ErrorReport[] = [];
    const a = await serverWith(runtime, reports);
    const res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE" });
    const points = await lastDurationPoint();
    const killed = points.find((p) => p["ws.unavailable.reason"] === "kill_switch")!;
    expect(killed).toMatchObject({ "ws.problem.code": "MODULE_UNAVAILABLE" });
    expect(await countedAsError(killed)).toBe(false);
    expect(reports).toEqual([]);
    expect(await runtime.moduleState("things")).toBe("killed");
    expect(await runtime.moduleState("audit")).toBe("on");
  });
});

describe("re-review of PR #85: reload failures are logged once per change of state, by class only", () => {
  it("failing → one flags.reload_failed; more failures → nothing; recovery → one flags.reload_recovered", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store, { onReloadHealth: flagReloadHealthLog });
    store.fail = true;
    for (let i = 0; i < 5; i++) await runtime.refresh();
    store.fail = false;
    await runtime.refresh();
    store.fail = true;
    await runtime.refresh();
    const records = telemetry.memory.logRecords().map((r) => [r.body, r.severityText, r.attributes]);
    expect(records).toEqual([
      ["flags.reload_failed", "ERROR", { "ws.module": "feature-flags", "error.type": "Error" }],
      ["flags.reload_recovered", "INFO", { "ws.module": "feature-flags" }],
      ["flags.reload_failed", "ERROR", { "ws.module": "feature-flags", "error.type": "Error" }],
    ]);
    // The message of the store's error («database unreachable») never reaches the log.
    expect(JSON.stringify(records)).not.toContain("unreachable");
  });
});

describe("re-review of PR #85, non-blocking: closed labels and consistent marks", () => {
  it("ws.problem.code and ws.unavailable.reason accept only their closed sets", () => {
    expect(redactAttributes({ "ws.problem.code": "OLHA_KOVALENKO" })).toEqual({ "ws.telemetry.redacted": 1 });
    expect(redactAttributes({ "ws.problem.code": "MODULE_UNAVAILABLE" })).toEqual({
      "ws.problem.code": "MODULE_UNAVAILABLE",
    });
    expect(redactAttributes({ "ws.unavailable.reason": "flags_unknown" })).toEqual({
      "ws.unavailable.reason": "flags_unknown",
    });
    expect(redactAttributes({ "ws.unavailable.reason": "maintenance" })).toEqual({
      "ws.telemetry.redacted": 1,
    });
  });

  it("a problem code is put on the sample only when the answer has that code's status", async () => {
    const plain = Fastify({ logger: false });
    instrumentHttp(plain);
    plain.get("/x", async (request, reply) => {
      markRequestProblem(request, "MODULE_UNAVAILABLE");
      return reply.code(500).send({});
    });
    await plain.ready();
    await plain.inject({ method: "GET", url: "/x" });
    await plain.close();
    const span = telemetry.memory.finishedSpans().find((s) => s.kind === SpanKind.SERVER)!;
    expect(span.attributes["http.response.status_code"]).toBe(500);
    expect(span.attributes["ws.problem.code"]).toBeUndefined();
  });
});

describe("re-review of PR #85, non-blocking: the deliberate 503s stay where they are decided", () => {
  it("only the API layer (kill switch), the server (graceful stop) and the telemetry labels name them", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|test-helper\.ts$/.test(entry.name))
          files.push(rel);
      }
    };
    walk("src");
    walk("scripts");
    // problem.ts declares the codes as object keys; anything that answers or labels with them is listed here.
    const naming = files
      .filter((f) =>
        /"(MODULE_UNAVAILABLE|SERVICE_UNAVAILABLE|kill_switch)"/.test(readFileSync(join(root, f), "utf8")),
      )
      .sort();
    expect(naming).toEqual([
      "src/platform/http/api.ts",
      "src/platform/process/server.ts",
      "src/platform/telemetry/http.ts",
    ]);
  });
});
