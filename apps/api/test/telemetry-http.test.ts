import { SpanKind } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { jobTraceCarrier, runJob, type JobTraceCarrier } from "../src/platform/telemetry/jobs.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { principalHeader, testApiOptions, testWiring } from "./http.ts";

/**
 * ARC-09 FR 2–3, NFR-10 FR 1, 2, 4, 5 through the real server (buildServer) and the API wiring of src/api.ts:
 * every request is traced, every problem carries the server-drawn trace id as its support id, client ids
 * are ignored, the trace follows into background jobs, and server errors are reported without values.
 */
const telemetry = testTelemetryForFile();

const access = { permission: "things.read", feature: "things" };
const carriers: JobTraceCarrier[] = [];
const SECRET_NAME = "Картка Золота";
const SECRET_EMAIL = "olha.kovalenko@example.com";
const SECRET_AMOUNT = "-1234.56";

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingTraced",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThingTraced",
  summary: "x",
  access,
  request: { body: z.object({ name: z.string(), amount: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  // A create that starts a background job: the job's carrier is taken after the body was read.
  handler: async () => {
    const carrier = jobTraceCarrier();
    if (carrier) carriers.push(carrier);
    return { ok: true };
  },
});

const failThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things/{thingId}/sync",
  operationId: "syncThingTraced",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }), body: z.object({ note: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async ({ params }) => {
    if (params.thingId === "db") {
      // What node-postgres throws for a unique violation: the message and detail repeat the values.
      const error = new pg.DatabaseError(
        `duplicate key value violates unique constraint "accounts_household_id_name_key"`,
        0,
        "error",
      );
      Object.assign(error, {
        severity: "ERROR",
        code: "23505",
        detail: `Key (household_id, name)=(3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01, ${SECRET_NAME}) already exists.`,
        constraint: "accounts_household_id_name_key",
        table: "accounts",
        schema: "wallets",
        where: `amount ${SECRET_AMOUNT}`,
      });
      throw error;
    }
    throw new Error(`sync of ${SECRET_NAME} for ${SECRET_EMAIL} (${SECRET_AMOUNT} UAH) failed`);
  },
});

let app: FastifyInstance;

beforeAll(async () => {
  const routes = [getThing, createThing, failThing];
  // The defaults of src/api.ts: supportId = the trace id, server errors → telemetry.
  const wired = apiOptions(testWiring());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions(routes, { supportId: wired.supportId!, reportError: wired.reportError! }),
      ),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const serverSpans = () => telemetry.memory.finishedSpans().filter((s) => s.kind === SpanKind.SERVER);

describe("NFR-10 FR 5: distributed tracing covers 100 % of API requests", () => {
  it("every request — success, client error, unknown path, server error — is one server span and one duration sample; probes are not", async () => {
    const requests = [
      { method: "GET" as const, url: "/v1/things/a", headers: principalHeader() },
      {
        method: "POST" as const,
        url: "/v1/things",
        headers: { ...principalHeader(), "content-type": "application/json" },
        payload: { name: "n", amount: "1" },
      },
      { method: "POST" as const, url: "/v1/things", headers: principalHeader(), payload: "{" },
      { method: "GET" as const, url: "/v1/things/a" },
      { method: "GET" as const, url: "/v1/no-such-path" },
      {
        method: "POST" as const,
        url: "/v1/things/x/sync",
        headers: { ...principalHeader(), "content-type": "application/json" },
        payload: { note: "n" },
      },
    ];
    const statuses = [];
    for (const r of requests) statuses.push((await app.inject(r)).statusCode);
    expect(statuses).toEqual([200, 201, 415, 401, 404, 500]);
    await app.inject({ method: "GET", url: "/health/live" });
    await app.inject({ method: "GET", url: "/health/ready" });
    await telemetry.forceFlush();
    const spans = serverSpans();
    expect(spans.map((s) => [s.name, s.attributes["http.response.status_code"]])).toEqual([
      ["GET /v1/things/:thingId", 200],
      ["POST /v1/things", 201],
      ["POST /v1/things", 415],
      ["GET /v1/things/:thingId", 401],
      ["GET", 404],
      ["POST /v1/things/:thingId/sync", 500],
    ]);
    // Only 5xx marks the span as failed (OpenTelemetry HTTP server convention).
    expect(spans.map((s) => s.status.code)).toEqual([0, 0, 0, 0, 0, 2]);
    const histogram = telemetry.memory
      .resourceMetrics()
      .at(-1)!
      .scopeMetrics.flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === "http.server.request.duration")!;
    const count = histogram.dataPoints.reduce((n, p) => n + (p.value as { count: number }).count, 0);
    expect(count).toBe(requests.length);
    for (const p of histogram.dataPoints)
      expect(Object.keys(p.attributes).sort()).toEqual(
        p.attributes["http.route"]
          ? ["http.request.method", "http.response.status_code", "http.route"]
          : ["http.request.method", "http.response.status_code"],
      );
  });
});

describe("ARC-09 FR 3 / NFR-10 FR 4: the trace id is the error code; client ids are not accepted", () => {
  it("every problem carries supportId = the trace id the server drew for that request; each request a new one", async () => {
    const problems = [
      await app.inject({ method: "GET", url: "/v1/things/a" }),
      await app.inject({ method: "GET", url: "/v1/no-such-path" }),
      await app.inject({ method: "POST", url: "/v1/things", headers: principalHeader(), payload: "{" }),
      await app.inject({
        method: "POST",
        url: "/v1/things/x/sync",
        headers: { ...principalHeader(), "content-type": "application/json" },
        payload: { note: "n" },
      }),
    ];
    const spans = serverSpans();
    const ids = problems.map((p) => p.json().supportId as string);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(spans.map((s) => s.spanContext().traceId));
  });

  it("an incoming traceparent, tracestate or request id is ignored: a new root trace, a new id", async () => {
    const clientTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const res = await app.inject({
      method: "GET",
      url: "/v1/things/a",
      headers: {
        traceparent: `00-${clientTrace}-00f067aa0ba902b7-01`,
        tracestate: "vendor=abc",
        "x-request-id": "client-chosen-id",
        "x-correlation-id": "client-chosen-id-2",
        "request-id": clientTrace,
      },
    });
    const [span] = serverSpans();
    expect(span!.parentSpanContext).toBeUndefined();
    expect(res.json().supportId).toBe(span!.spanContext().traceId);
    expect(res.json().supportId).not.toBe(clientTrace);
    expect(res.body).not.toContain("client-chosen-id");
    expect(res.headers["traceparent"]).toBeUndefined();
  });

  it("the trace follows into a background job started by the request (also after the body was read)", async () => {
    carriers.length = 0;
    await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...principalHeader(), "content-type": "application/json" },
      payload: { name: "n", amount: "1" },
    });
    expect(carriers).toHaveLength(1);
    let inside: string | undefined;
    await runJob("thing-indexing", carriers[0], async () => {
      inside = jobTraceCarrier()?.traceparent;
    });
    const request = serverSpans()[0]!;
    const job = telemetry.memory.finishedSpans().find((s) => s.name === "job thing-indexing")!;
    expect(job.kind).toBe(SpanKind.CONSUMER);
    expect(job.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(job.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(inside).toContain(request.spanContext().traceId);
  });
});

describe("ARC-09 FR 2 / NFR-10 FR 1–2: error reports without personal data", () => {
  it("a server error is logged as api.server_error in its trace with the route template, code and class only", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/things/${encodeURIComponent(SECRET_EMAIL)}/sync?amount=${SECRET_AMOUNT}&name=${encodeURIComponent(SECRET_NAME)}`,
      headers: {
        ...principalHeader(),
        "content-type": "application/json",
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.c3ludGhldGlj.c2lnbmF0dXJl",
        cookie: "session=synthetic-session-0001",
      },
      payload: { note: `${SECRET_NAME} ${SECRET_AMOUNT}` },
    });
    expect(res.statusCode).toBe(500);
    const [record] = telemetry.memory.logRecords();
    expect(record).toMatchObject({
      body: "api.server_error",
      severityText: "ERROR",
      attributes: {
        "http.request.method": "POST",
        "http.route": "/v1/things/:thingId/sync",
        "http.response.status_code": 500,
        "ws.problem.code": "INTERNAL",
        "error.type": "Error",
      },
    });
    expect(record!.spanContext?.traceId).toBe(res.json().supportId);
    const text = await exportedText(telemetry);
    for (const secret of [
      SECRET_NAME,
      SECRET_EMAIL,
      "1234.56",
      "eyJhbGciOiJIUzI1NiJ9",
      "synthetic-session",
      "?amount",
    ])
      expect(text).not.toContain(secret);
  });

  it("NFR-10 FR 2: a database error is reported as SQLSTATE, constraint, table and schema — never the message or detail", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/things/db/sync",
      headers: { ...principalHeader(), "content-type": "application/json" },
      payload: { note: "n" },
    });
    expect(res.statusCode).toBe(500);
    const [record] = telemetry.memory.logRecords();
    expect(record!.attributes).toEqual({
      "http.request.method": "POST",
      "http.route": "/v1/things/:thingId/sync",
      "http.response.status_code": 500,
      "ws.problem.code": "INTERNAL",
      "error.type": "DatabaseError",
      "db.system.name": "postgresql",
      "db.response.status_code": "23505",
      "ws.db.constraint": "accounts_household_id_name_key",
      "ws.db.table": "accounts",
      "ws.db.schema": "wallets",
    });
    const [span] = serverSpans();
    expect(span!.attributes["db.response.status_code"]).toBe("23505");
    const text = await exportedText(telemetry);
    for (const secret of [SECRET_NAME, "1234.56", "duplicate key", "already exists", "3b9d7f0e"])
      expect(text).not.toContain(secret);
  });
});
