import { readdirSync, readFileSync, statSync } from "node:fs";
import { connect, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { context, ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { createFlagRuntimeFor } from "../src/modules/feature-flags/index.ts";
import type { ModuleDatabase } from "../src/platform/db/module-db.ts";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { requestTraceId } from "../src/platform/telemetry/http.ts";
import { TELEMETRY_SCOPE } from "../src/platform/telemetry/scope.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { principalHeader, testApiOptions, testWiring } from "./http.ts";

/**
 * Security review of PR #85, round 2 (NFR-10 FR 4–6, ARC-09 FR 3, ADR-0006 «Навмисні 503»): only a deliberate
 * 503 is left out of the 5xx ratio; a request's trace never joins a context the process happened to be in; the
 * context of concurrent requests never mixes.
 */
const telemetry = testTelemetryForFile();
const access = { permission: "things.read", feature: "things" };
const definitions = new URL("../../../tools/observability/definitions.mjs", import.meta.url).href;

const seen: { name: string; trace: string | undefined }[] = [];

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingSec85r2",
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
  operationId: "createThingSec85r2",
  summary: "x",
  access,
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async ({ body }) => {
    await new Promise((r) => setTimeout(r, 5));
    seen.push({ name: body.name.slice(0, 1), trace: trace.getSpan(context.active())?.spanContext().traceId });
    return { ok: true };
  },
});

let app: FastifyInstance | undefined;

async function server(overrides: Partial<ApiOptions> = {}, extra?: (a: FastifyInstance) => void) {
  const wired = apiOptions(testWiring());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => {
      extra?.(a);
      registerApi(
        a,
        testApiOptions([getThing, createThing], {
          supportId: wired.supportId!,
          reportError: wired.reportError!,
          ...overrides,
        }),
      );
    },
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  telemetry.memory.reset();
});

const serverSpans = () => telemetry.memory.finishedSpans().filter((s) => s.kind === SpanKind.SERVER);

/**
 * The numerator of ws:api_error_ratio (infra/observability/rules.yaml): SERVER_ERROR_SELECTOR evaluated on one
 * sample's labels, as Prometheus would (a missing label is the empty string; regex matchers are anchored).
 */
async function countsAsServerError(attributes: Record<string, unknown>): Promise<boolean> {
  const { SERVER_ERROR_SELECTOR } = (await import(definitions)) as { SERVER_ERROR_SELECTOR: string };
  const labels = new Map(Object.entries(attributes).map(([k, v]) => [k.replaceAll(".", "_"), String(v)]));
  return SERVER_ERROR_SELECTOR.split(/,\s*/).every((matcher) => {
    const m = /^([a-z_]+)(=~|!~|!=|=)"(.*)"$/.exec(matcher);
    if (!m) throw new Error(`unparsed matcher ${matcher}`);
    const [, name, op, value] = m as unknown as [string, string, string, string];
    const actual = labels.get(name) ?? "";
    const re = new RegExp(`^(?:${value})$`);
    return op === "="
      ? actual === value
      : op === "!="
        ? actual !== value
        : op === "=~"
          ? re.test(actual)
          : !re.test(actual);
  });
}

async function durationSamples() {
  await telemetry.forceFlush();
  const last = telemetry.memory.resourceMetrics().at(-1);
  const metric = last?.scopeMetrics
    .flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === "http.server.request.duration");
  return (metric?.dataPoints ?? []) as { attributes: Record<string, unknown>; value: { count: number } }[];
}

/** Samples whose count grew while `act` ran (the duration metric is cumulative over the file). */
async function samplesOf(act: () => Promise<unknown>) {
  const key = (p: { attributes: Record<string, unknown> }) =>
    JSON.stringify(Object.entries(p.attributes).sort());
  const before = new Map((await durationSamples()).map((p) => [key(p), p.value.count]));
  await act();
  return (await durationSamples()).filter((p) => p.value.count > (before.get(key(p)) ?? 0));
}

describe("sec85r2: a real outage is never labelled as a deliberate 503", () => {
  it("a module that is switched off on purpose is left out of the 5xx ratio (the lead's decision)", async () => {
    const a = await server({ moduleAvailable: async () => false, moduleState: async () => "killed" });
    let res!: Awaited<ReturnType<FastifyInstance["inject"]>>;
    const samples = await samplesOf(async () => {
      res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    });
    expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE", status: 503 });
    expect(samples).toHaveLength(1);
    for (const p of samples) expect(await countsAsServerError(p.attributes)).toBe(false);
  });

  // Found in round 2 on e6232dd (blocking), fixed in 7d56a8a: with the flag state unknown (the flags store is
  // down, ADR-0004 fail closed) every module answers MODULE_UNAVAILABLE. That is an outage, not a kill switch: it
  // counts as 5xx and reaches the error log. Goes through apiOptions, i.e. the production wiring of main.ts.
  it("flags that could not be loaded (fail closed): the 503 counts as a server error and is reported", async () => {
    const down = {
      transaction: async () => {
        throw new Error("connection refused");
      },
      inHousehold: async () => {
        throw new Error("connection refused");
      },
    } as unknown as ModuleDatabase;
    const flags = createFlagRuntimeFor(down);
    const wired = apiOptions(testWiring(flags as never));
    expect(wired.moduleState).toBeDefined();
    const a = await server({ moduleAvailable: wired.moduleAvailable, moduleState: wired.moduleState! });
    let res!: Awaited<ReturnType<FastifyInstance["inject"]>>;
    const samples = await samplesOf(async () => {
      res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    });
    // The client still sees «temporarily unavailable» (ADR-0004, CICD-06 FR 3).
    expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE", status: 503 });
    expect(samples).toHaveLength(1);
    expect(await countsAsServerError(samples[0]!.attributes)).toBe(true);
    expect(telemetry.memory.logRecords().some((r) => r.body === "api.server_error")).toBe(true);
  });

  // Review of PR #85, round 2 (non-blocking): the problem code is recorded when the problem is built, not when
  // it is sent. If sending it fails (an onSend hook throws), Fastify's own fallback handler answers — and its
  // answer still carries the deliberate code, so a fault is left out of the 5xx ratio.
  it("an answer Fastify sends itself after a kill-switch problem failed to send is not labelled deliberate", async () => {
    const a = await server(
      { moduleAvailable: async () => false, moduleState: async () => "killed" },
      (instance) =>
        instance.addHook("onSend", async (_request, reply) => {
          if (reply.statusCode === 503) throw new Error("encoder bug");
        }),
    );
    let res!: Awaited<ReturnType<FastifyInstance["inject"]>>;
    const samples = await samplesOf(async () => {
      res = await a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    });
    // Not our problem body: Fastify's fallback answered.
    expect(res.json()).not.toHaveProperty("supportId");
    expect(samples).toHaveLength(1);
    expect(await countsAsServerError(samples[0]!.attributes)).toBe(true);
  });

  it("a 503 SERVICE_UNAVAILABLE during a graceful stop counts as a server error (a restart loop must show)", async () => {
    const a = await server();
    await a.listen({ host: "127.0.0.1", port: 0 });
    const { port } = a.server.address() as AddressInfo;
    const samples = await samplesOf(async () => {
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
      expect(raw).toContain('"code":"SERVICE_UNAVAILABLE"');
    });
    expect(samples).toHaveLength(1);
    expect(await countsAsServerError(samples[0]!.attributes)).toBe(true);
  });

  it("only the API layer's kill-switch branch labels a request kill_switch", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(src);
    const calls = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/markUnavailableReason\([^)]*\)/g)].map(
        (m) => `${f.slice(src.length + 1)}: ${m[0]}`,
      ),
    );
    expect(calls.filter((c) => c.includes("kill_switch"))).toEqual([
      'platform/http/api.ts: markUnavailableReason(request, "kill_switch")',
    ]);
    // Every call (the definition, with its type annotation, aside) passes one of the two literals.
    expect(
      calls
        .filter((c) => !c.includes(": FastifyRequest"))
        .every((c) => /"(kill_switch|flags_unknown)"\)$/.test(c)),
    ).toBe(true);
  });

  it("only the kill-switch check and the shutdown hook can produce the deliberate codes", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(src);
    const producers = files.filter((f) =>
      /["'`](MODULE_UNAVAILABLE|SERVICE_UNAVAILABLE)["'`]/.test(
        readFileSync(f, "utf8").replace(/^\s*(\/\/|\*).*$/gm, ""),
      ),
    );
    expect(producers.map((f) => f.slice(src.length + 1)).sort()).toEqual([
      "platform/http/api.ts",
      "platform/process/server.ts",
    ]);
  });
});

describe("sec85r2: NFR-10 FR 4 — a request's trace is always a new root", () => {
  it("a server started inside an active span still gives each request a root span (no parent)", async () => {
    const outer = trace.getTracer(TELEMETRY_SCOPE).startSpan("job startup", {}, ROOT_CONTEXT);
    const a = await server();
    await context.with(trace.setSpan(ROOT_CONTEXT, outer), () => a.listen({ host: "127.0.0.1", port: 0 }));
    const { port } = a.server.address() as AddressInfo;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = context.with(trace.setSpan(ROOT_CONTEXT, outer), () =>
        connect(port, "127.0.0.1", () =>
          socket.write("GET /v1/%zz HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n"),
        ),
      );
      let out = "";
      socket.on("data", (d) => (out += d.toString("utf8")));
      socket.on("close", () => resolve(out));
      socket.on("error", reject);
    });
    // A bad URL (frameworkErrors) and a routed request, both from inside the outer context.
    const routed = await context.with(trace.setSpan(ROOT_CONTEXT, outer), () =>
      a.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() }),
    );
    outer.end();
    expect(raw).toMatch(/^HTTP\/1\.1 404 /);
    expect(routed.statusCode).toBe(200);
    const spans = serverSpans();
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      expect(s.parentSpanContext).toBeUndefined();
      expect(s.spanContext().traceId).not.toBe(outer.spanContext().traceId);
    }
  });
});

describe("sec85r2: ARC-09 FR 3 — the context of concurrent requests never mixes", () => {
  it("three keep-alive connections, two requests each, bodies interleaved: each handler runs in its own trace", async () => {
    seen.length = 0;
    const truth = new Map<string, string[]>();
    const a = await server({}, (instance) =>
      instance.addHook("preHandler", async (request) => {
        const name = (request.body as { name?: string } | undefined)?.name?.slice(0, 1);
        if (!name) return;
        truth.set(name, [...(truth.get(name) ?? []), requestTraceId(request)!]);
      }),
    );
    await a.listen({ host: "127.0.0.1", port: 0 });
    const { port } = a.server.address() as AddressInfo;
    const request = (letter: string) => {
      const body = JSON.stringify({ name: letter.repeat(20_000) });
      const head =
        `POST /v1/things HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\n` +
        `content-length: ${Buffer.byteLength(body)}\r\nx-test-principal: ${principalHeader()["x-test-principal"]}\r\n\r\n`;
      return { head, body };
    };
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const sockets: Socket[] = [];
    const answers: string[] = ["", "", ""];
    for (let i = 0; i < 3; i++) {
      const s = connect(port, "127.0.0.1");
      await new Promise((r) => s.once("connect", r));
      s.on("data", (d) => (answers[i] += d.toString("utf8")));
      sockets.push(s);
    }
    const requests = ["a", "b", "c"].map(request);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 3; i++) sockets[i]!.write(requests[i]!.head);
      for (let offset = 0; offset < requests[0]!.body.length; offset += 3_000)
        for (let i = 2; i >= 0; i--) {
          sockets[i]!.write(requests[i]!.body.slice(offset, offset + 3_000));
          await pause(2);
        }
      await pause(100);
    }
    for (const s of sockets) s.destroy();
    for (const answer of answers) expect(answer.match(/HTTP\/1\.1 201 /g)).toHaveLength(2);
    expect(seen).toHaveLength(6);
    for (const letter of ["a", "b", "c"]) {
      const inHandler = seen.filter((s) => s.name === letter).map((s) => s.trace);
      expect(inHandler.every((t) => t !== undefined)).toBe(true);
      expect([...inHandler].sort()).toEqual([...truth.get(letter)!].sort());
    }
    expect(new Set(seen.map((s) => s.trace)).size).toBe(6);
  });
});
