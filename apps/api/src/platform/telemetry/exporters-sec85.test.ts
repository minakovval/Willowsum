import { logs, metrics, ROOT_CONTEXT, trace, type Link } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_LIMIT, MemoryExporters, redactSpan } from "./exporters.ts";
import { TELEMETRY_SCOPE } from "./scope.ts";
import { exportedText, testTelemetryForFile } from "./testing.ts";

/**
 * Security review of PR #85 (ARC-09 FR 2, ADR-0006 «Фільтр: allow-list»): every field of an exported item —
 * not only attributes — goes through the filter; memory of the `test` mode is bounded; trace ids never come
 * from Math.random.
 */
const telemetry = testTelemetryForFile();
const EMAIL = "olha.kovalenko@example.com";
const CARD = ["4111", "1111", "1111", "1111"].join("");

afterEach(() => vi.restoreAllMocks());

describe("sec85: every field of a span passes the filter", () => {
  it("link attributes are reduced to the allow-list", async () => {
    const other = trace.getTracer(TELEMETRY_SCOPE).startSpan("job x", {}, ROOT_CONTEXT);
    const link: Link = {
      context: other.spanContext(),
      attributes: { "user.email": EMAIL, "ws.module": CARD },
    };
    trace
      .getTracer(TELEMETRY_SCOPE)
      .startSpan("job y", { links: [link] }, ROOT_CONTEXT)
      .end();
    other.end();
    const text = await exportedText(telemetry);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(CARD);
    const linked = telemetry.memory.finishedSpans().find((s) => s.name === "job y")!;
    expect(linked.links[0]!.attributes).toEqual({ "ws.telemetry.redacted": 2 });
  });

  it("the instrumentation scope name is a technical name, otherwise «redacted»", async () => {
    trace.getTracer(`scope ${EMAIL}`).startSpan("job x").end();
    logs.getLogger(EMAIL).emit({ body: "x.y" });
    expect(await exportedText(telemetry)).not.toContain(EMAIL);
    expect(telemetry.memory.finishedSpans()[0]!.instrumentationScope.name).toBe("redacted");
  });

  it("a resource with host, process or user attributes is reduced to the allow-list", () => {
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan("job x");
    span.end();
    const exported = telemetry.memory.finishedSpans().at(-1)!;
    const tampered = {
      ...exported,
      spanContext: () => exported.spanContext(),
      resource: resourceFromAttributes({
        "service.name": "willowsum-api",
        "host.name": "synthetic-host-01",
        "process.command_args": ["node", `--email=${EMAIL}`],
        "enduser.id": "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01",
      }),
    } as ReadableSpan;
    expect(redactSpan(tampered).resource.attributes).toEqual({
      "service.name": "willowsum-api",
      "ws.telemetry.redacted": 3,
    });
  });

  it("an exception recorded from a string or with a code keeps only a class-like type", async () => {
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan("job x");
    span.recordException(`insert failed for ${EMAIL}`);
    span.recordException(Object.assign(new Error(`card ${CARD}`), { code: `E_${CARD}` }));
    span.end();
    const text = await exportedText(telemetry);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(CARD);
  });
});

describe("sec85: metric names", () => {
  it("a metric name carrying an account number is «redacted»", async () => {
    metrics.getMeter(TELEMETRY_SCOPE).createCounter(`ws.acct.${CARD}`).add(1);
    expect(await exportedText(telemetry)).not.toContain(CARD);
  });
});

describe("sec85: free-text fields outside attributes (fixed after review of PR #85)", () => {
  // Review of PR #85, fixed (was Medium): redactLogRecord copies severityText as is; OTLP exports it as a string field.
  it("a log record's severityText is a severity name, never free text", async () => {
    logs.getLogger(TELEMETRY_SCOPE).emit({ body: "x.y", severityText: `failed for ${EMAIL}` });
    expect(await exportedText(telemetry)).not.toContain(EMAIL);
  });

  // Review of PR #85, fixed (was Low): the scope wrapper keeps `version` unfiltered (traces, logs and metrics).
  it("an instrumentation scope version is a version, never free text", async () => {
    trace.getTracer(TELEMETRY_SCOPE, `1.0.0 ${EMAIL}`).startSpan("job x").end();
    expect(await exportedText(telemetry)).not.toContain(EMAIL);
  });

  // Review of PR #85, fixed (was Low): redactMetric spreads the descriptor, so description and unit are exported unfiltered.
  it("a metric description and unit are never free text", async () => {
    metrics
      .getMeter(TELEMETRY_SCOPE)
      .createCounter("ws.test.described", { description: `count for ${EMAIL}`, unit: `{${CARD}}` })
      .add(1);
    const text = await exportedText(telemetry);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(CARD);
  });
});

describe("sec85: the test mode keeps bounded memory", () => {
  it(`the process-wide test exporters keep the newest ${MEMORY_LIMIT} spans and log records`, async () => {
    const tracer = trace.getTracer(TELEMETRY_SCOPE);
    const logger = logs.getLogger(TELEMETRY_SCOPE);
    for (let i = 0; i < MEMORY_LIMIT + 25; i++) {
      tracer.startSpan(i === MEMORY_LIMIT + 24 ? "job last" : "job x").end();
      logger.emit({ body: i === MEMORY_LIMIT + 24 ? "x.last" : "x.y" });
    }
    await telemetry.forceFlush();
    expect(telemetry.memory.finishedSpans()).toHaveLength(MEMORY_LIMIT);
    expect(telemetry.memory.logRecords()).toHaveLength(MEMORY_LIMIT);
    expect(telemetry.memory.finishedSpans().at(-1)!.name).toBe("job last");
    expect(telemetry.memory.logRecords().at(-1)!.body).toBe("x.last");
  });

  it("each store (spans, logs, metrics) drops the oldest beyond its limit", () => {
    const memory = new MemoryExporters(3);
    const done = () => undefined;
    for (let i = 0; i < 5; i++) {
      memory.spans.export([{ name: `s${i}` } as never], done);
      memory.logs.export([{ body: `l${i}` } as never], done);
      memory.metrics.export({ resource: {}, scopeMetrics: [], n: i } as never, done);
    }
    expect(memory.finishedSpans().map((s) => s.name)).toEqual(["s2", "s3", "s4"]);
    expect(memory.logRecords().map((r) => r.body)).toEqual(["l2", "l3", "l4"]);
    expect(memory.resourceMetrics().map((m) => (m as unknown as { n: number }).n)).toEqual([2, 3, 4]);
  });
});

describe("sec85: NFR-10 FR 4 — trace ids never come from Math.random", () => {
  it("with Math.random fixed, the tracer still draws distinct trace and span ids", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const tracer = trace.getTracer(TELEMETRY_SCOPE);
    const traces = new Set<string>();
    const spans = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const span = tracer.startSpan("job x", {}, ROOT_CONTEXT);
      traces.add(span.spanContext().traceId);
      spans.add(span.spanContext().spanId);
      span.end();
    }
    expect(traces.size).toBe(50);
    expect(spans.size).toBe(50);
  });
});
