import { propagation, SpanKind } from "@opentelemetry/api";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { principalHeader, testApiOptions, testWiring } from "./http.ts";

/**
 * Security review of PR #85 (NFR-10 FR 1, FR 4; ARC-09 FR 3): client trace headers of every format are
 * ignored even when a global propagator is registered; headers, cookies, client address, user agent, query
 * and path values never reach telemetry; every error response carries the server's trace id.
 */
const telemetry = testTelemetryForFile();
const join = (...parts: string[]) => parts.join("");
const access = { permission: "things.read", feature: "things" };

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingSec85",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const failThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things/{thingId}/fail",
  operationId: "failThingSec85",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }), body: z.object({ note: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async ({ params, body }) => {
    throw new Error(`failed for ${params.thingId}: ${body.note}`);
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
        testApiOptions([getThing, failThing], {
          supportId: wired.supportId!,
          reportError: wired.reportError!,
        }),
      ),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => propagation.disable());

const serverSpans = () => telemetry.memory.finishedSpans().filter((s) => s.kind === SpanKind.SERVER);
const CLIENT_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("sec85: NFR-10 FR 4 — no client id is ever accepted", () => {
  it("traceparent, tracestate, baggage, b3, x-b3-*, uber-trace-id, x-request-id are ignored even with a global propagator", async () => {
    // A later change (or a library) may register a global propagator: the request span must stay a root.
    propagation.setGlobalPropagator(
      new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/things/a",
      headers: {
        traceparent: `00-${CLIENT_TRACE}-00f067aa0ba902b7-01`,
        tracestate: "vendor=olha",
        baggage: "user.email=olha%40example.com,household=3b9d7f0e",
        b3: `${CLIENT_TRACE}-00f067aa0ba902b7-1`,
        "x-b3-traceid": CLIENT_TRACE,
        "x-b3-spanid": "00f067aa0ba902b7",
        "uber-trace-id": `${CLIENT_TRACE}:00f067aa0ba902b7:0:1`,
        "x-request-id": CLIENT_TRACE,
        "x-amzn-trace-id": `Root=1-5759e988-${CLIENT_TRACE.slice(8)}`,
      },
    });
    const [span] = serverSpans();
    expect(span!.parentSpanContext).toBeUndefined();
    expect(span!.spanContext().traceId).not.toBe(CLIENT_TRACE);
    expect(span!.spanContext().traceState).toBeUndefined();
    expect(res.json().supportId).toBe(span!.spanContext().traceId);
    const text = await exportedText(telemetry);
    for (const value of [CLIENT_TRACE, "olha", "3b9d7f0e"]) expect(text).not.toContain(value);
  });

  it("supportId is exactly the 32-hex trace id on 401, 404, 405-like, 415, 500 — and absent on probes", async () => {
    const responses = [
      await app.inject({ method: "GET", url: "/v1/things/a" }),
      await app.inject({ method: "GET", url: "/v1/nothing" }),
      await app.inject({ method: "DELETE", url: "/v1/things/a", headers: principalHeader() }),
      await app.inject({
        method: "POST",
        url: "/v1/things/a/fail",
        headers: principalHeader(),
        payload: "x",
      }),
      await app.inject({
        method: "POST",
        url: "/v1/things/a/fail",
        headers: { ...principalHeader(), "content-type": "application/json" },
        payload: { note: "n" },
      }),
    ];
    const ids = responses.map((r) => r.json().supportId as string);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(ids).toEqual(serverSpans().map((s) => s.spanContext().traceId));
    const probe = await app.inject({ method: "GET", url: "/health/live" });
    expect(probe.body).not.toContain("supportId");
  });

  // Review of PR #85, fixed (was Low): a URL Fastify cannot decode answers with Fastify's own body (which echoes
  // the URL) before any hook: no span, no supportId — against NFR-10 FR 4 «every error response» and FR 5.
  it("a malformed URL still gets a problem with the server's supportId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/things/%zz-olha" });
    // NOT_FOUND, as for an unknown path (DAT-05 FR 7; lead's decision on review of PR #85).
    expect(res.statusCode).toBe(404);
    expect(res.json().supportId).toMatch(/^[0-9a-f]{32}$/);
    expect(res.body).not.toContain("olha");
    expect(serverSpans()).toHaveLength(1);
  });
});

describe("sec85: NFR-10 FR 1 — request data never reaches telemetry", () => {
  it("headers, cookies, client address, user agent, query and path values are absent from every signal", async () => {
    const token = join("ey", "JhbGciOiJIUzI1NiJ9.", "c3ludGhldGlj.c2ln");
    const basic = Buffer.from(join("olha", ":", "synthetic-pass")).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: `/v1/things/${encodeURIComponent("Картка Золота")}/fail?iban=UA213223130000026007233566001&lat=50.4501`,
      remoteAddress: "203.0.113.77",
      headers: {
        ...principalHeader(),
        "content-type": "application/json",
        authorization: `Basic ${basic}`,
        "x-api-key": join("sk", "_test_", "Zx9", "Qw8Er7Ty6Ui5Op4"),
        cookie: `session=${token}`,
        "user-agent": "Mozilla/5.0 (SyntheticOS 99) OlhaBrowser/1.0",
        "x-forwarded-for": "198.51.100.23",
        referer: "https://app.example/accounts/olha.kovalenko@example.com",
      },
      payload: { note: "1 234,56 грн for olha.kovalenko@example.com, вул. Хрещатик, 22" },
    });
    expect(res.statusCode).toBe(500);
    const text = await exportedText(telemetry);
    expect(text).toContain("/v1/things/:thingId/fail");
    for (const value of [
      "Картка",
      "%D0",
      "UA2132",
      "50.4501",
      "203.0.113.77",
      "198.51.100.23",
      basic,
      "Zx9Qw8",
      "c3ludGhldGlj",
      "Mozilla",
      "OlhaBrowser",
      "olha",
      "1 234,56",
      "Хрещатик",
      "app.example",
    ])
      expect(text).not.toContain(value);
  });
});
