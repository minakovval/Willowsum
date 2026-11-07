import { connect, type AddressInfo } from "node:net";
import { SpanKind } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer, SHUTTING_DOWN_RETRY_AFTER_S } from "../src/platform/process/server.ts";
import { jobTraceCarrier } from "../src/platform/telemetry/jobs.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { principalHeader, testApiOptions, testWiring } from "./http.ts";

/**
 * Reviews of PR #85 (NFR-10 FR 4–5, ARC-09 FR 3): requests Fastify answers before routing, a kill switch, a
 * client that goes away and a request that arrives while the process stops — each gets a span, a duration
 * sample and, for an error, a problem with the server's support id. The context of a request survives a body
 * that arrives in pieces over a real socket.
 */
const telemetry = testTelemetryForFile();
const access = { permission: "things.read", feature: "things" };

let gate: { release: () => void; reached: Promise<void> } | undefined;
const carriers: (string | undefined)[] = [];

function newGate() {
  let release!: () => void;
  let reach!: () => void;
  const reached = new Promise<void>((r) => (reach = r));
  const open = new Promise<void>((r) => (release = r));
  gate = { release, reached };
  return { open, reach };
}
let gateWait: { open: Promise<void>; reach: () => void } | undefined;

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingR2",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => {
    if (gateWait) {
      gateWait.reach();
      await gateWait.open;
    }
    return { ok: true };
  },
});

const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThingR2",
  summary: "x",
  access,
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => {
    carriers.push(jobTraceCarrier()?.traceparent);
    return { ok: true };
  },
});

let app: FastifyInstance | undefined;

async function server(overrides: Partial<ApiOptions> = {}): Promise<FastifyInstance> {
  const wired = apiOptions(testWiring());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([getThing, createThing], {
          supportId: wired.supportId!,
          reportError: wired.reportError!,
          ...overrides,
        }),
      ),
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  gateWait = undefined;
  gate = undefined;
  await app?.close().catch(() => undefined);
  app = undefined;
});

const serverSpans = () => telemetry.memory.finishedSpans().filter((s) => s.kind === SpanKind.SERVER);

async function durationPoints() {
  await telemetry.forceFlush();
  const last = telemetry.memory.resourceMetrics().at(-1);
  const metric = last?.scopeMetrics
    .flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === "http.server.request.duration");
  return (metric?.dataPoints ?? []) as { attributes: Record<string, unknown>; value: { count: number } }[];
}

describe("NFR-10 FR 4–5: errors Fastify raises before routing are traced problems, never an echo of the path", () => {
  it("a URL that cannot be decoded and an over-long path parameter: 404 NOT_FOUND, supportId = trace id, one span and one sample each", async () => {
    const a = await server();
    const urls = ["/v1/%c0", "/v1/things/%zz-olha.kovalenko", `/v1/things/${"olha".repeat(40)}`];
    const responses = [];
    for (const url of urls)
      responses.push(await a.inject({ method: "GET", url, headers: principalHeader() }));
    const unknown = await a.inject({ method: "GET", url: "/v1/no-such-path" });
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
      const { supportId, ...rest } = res.json();
      // The same body as an unknown path (DAT-05 FR 7), apart from the support id.
      expect({ ...rest, supportId: "x" }).toEqual({ ...unknown.json(), supportId: "x" });
      expect(supportId).toMatch(/^[0-9a-f]{32}$/);
      expect(res.body).not.toContain("olha");
      expect(res.body).not.toContain("%c0");
    }
    const spans = serverSpans();
    expect(spans).toHaveLength(4);
    expect(responses.map((r) => r.json().supportId)).toEqual(
      spans.slice(0, 3).map((s) => s.spanContext().traceId),
    );
    for (const s of spans.slice(0, 3)) {
      expect(s.name).toBe("GET");
      expect(s.attributes).toMatchObject({
        "http.response.status_code": 404,
        "ws.problem.code": "NOT_FOUND",
      });
    }
    // The first test of the file: every sample so far is one of these four requests.
    const count = (await durationPoints()).reduce((n, p) => n + p.value.count, 0);
    expect(count).toBe(4);
  });
});

describe("Lead's decision (review of PR #85): a kill switch is marked, not counted as a server error", () => {
  it("a 503 MODULE_UNAVAILABLE carries ws.problem.code on its span and duration sample", async () => {
    const a = await server({ moduleAvailable: async () => false });
    const res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    expect(res.statusCode).toBe(503);
    expect(res.json().supportId).toBe(serverSpans()[0]!.spanContext().traceId);
    // Metrics are cumulative over the file: the 503 point is this test's.
    const points = (await durationPoints()).filter((p) => p.attributes["http.response.status_code"] === 503);
    expect(points.map((p) => p.attributes)).toEqual([
      {
        "http.request.method": "GET",
        "http.route": "/v1/things/:thingId",
        "http.response.status_code": 503,
        "ws.problem.code": "MODULE_UNAVAILABLE",
      },
    ]);
  });
});

describe("ARC-02 FR 5 / NFR-10 FR 4: graceful stop and aborted requests", () => {
  it("a request that arrives while the process stops gets a 503 SERVICE_UNAVAILABLE problem with its support id, not Fastify's raw 503", async () => {
    const a = await server();
    await a.listen({ host: "127.0.0.1", port: 0 });
    const { port } = a.server.address() as AddressInfo;
    // A connection that has started a request (not idle) when the stop begins: it is not closed at once, and
    // its request is read only after the stop began.
    let raw = "";
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((r) => socket.once("connect", () => r()));
    const ended = new Promise<void>((r) => socket.on("close", () => r()));
    socket.on("data", (d) => (raw += d.toString("utf8")));
    socket.write("GET /v1/things/b HTTP/1.1\r\nhost: x\r\n");
    await new Promise((r) => setTimeout(r, 20));
    const closed = a.close();
    await new Promise((r) => setTimeout(r, 20));
    socket.write(`x-test-principal: ${principalHeader()["x-test-principal"]}\r\n\r\n`);
    await ended;
    await closed;
    expect(raw).toMatch(/^HTTP\/1\.1 503 /);
    expect(raw.toLowerCase()).toContain(`retry-after: ${SHUTTING_DOWN_RETRY_AFTER_S}`);
    expect(raw.toLowerCase()).toContain("connection: close");
    const body = JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
    const spans = serverSpans();
    expect(spans).toHaveLength(1);
    expect(body["supportId"]).toBe(spans[0]!.spanContext().traceId);
    expect(spans[0]!.attributes).toMatchObject({ "ws.problem.code": "SERVICE_UNAVAILABLE" });
  });

  it("a client that goes away before the answer still ends its span, as aborted", async () => {
    const a = await server();
    await a.listen({ host: "127.0.0.1", port: 0 });
    const { port } = a.server.address() as AddressInfo;
    gateWait = (() => {
      const g = newGate();
      return { open: g.open, reach: g.reach };
    })();
    const socket = connect(port, "127.0.0.1", () =>
      socket.write(
        `GET /v1/things/a HTTP/1.1\r\nhost: x\r\nx-test-principal: ${principalHeader()["x-test-principal"]}\r\n\r\n`,
      ),
    );
    await gate!.reached;
    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    const [span] = serverSpans();
    expect(span).toBeDefined();
    expect(span!.attributes["error.type"]).toBe("RequestAborted");
    expect(span!.attributes["http.response.status_code"]).toBeUndefined();
    gate!.release();
  });
});

describe("ARC-09 FR 3: the request's context survives a body that arrives in pieces over a socket", () => {
  it("a job carrier taken in the handler belongs to the request's trace", async () => {
    const a = await server();
    await a.listen({ host: "127.0.0.1", port: 0 });
    const { port } = a.server.address() as AddressInfo;
    carriers.length = 0;
    const body = JSON.stringify({ name: "n".repeat(20_000) });
    const head =
      `POST /v1/things HTTP/1.1\r\nhost: x\r\nconnection: close\r\ncontent-type: application/json\r\n` +
      `content-length: ${Buffer.byteLength(body)}\r\nx-test-principal: ${principalHeader()["x-test-principal"]}\r\n\r\n`;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", async () => {
        socket.write(head);
        for (let i = 0; i < body.length; i += 4_000) {
          socket.write(body.slice(i, i + 4_000));
          await new Promise((r) => setTimeout(r, 10));
        }
      });
      let out = "";
      socket.on("data", (d) => (out += d.toString("utf8")));
      socket.on("close", () => resolve(out));
      socket.on("error", reject);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 201 /);
    const [span] = serverSpans();
    expect(carriers).toHaveLength(1);
    expect(carriers[0]).toContain(span!.spanContext().traceId);
  });
});
