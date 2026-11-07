import { context, logs, metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { Rng } from "@willowsum/synthetic";
import { describe, expect, it } from "vitest";
import { PII_KINDS, piiFragments, piiValue } from "./pii.test-helper.ts";
import { logEvent, recordBankSyncRun } from "./signals.ts";
import { randomIdGenerator, startTelemetry, TELEMETRY_SCOPE } from "./telemetry.ts";
import { exportedText, testTelemetryForFile } from "./testing.ts";

const telemetry = testTelemetryForFile();

const KEYS = ["http.route", "error.type", "ws.db.table", "url.full", "user.email", "amount", "ws.module"];

describe("ARC-09 FR 2 / NFR-10 FR 1: 0 personal data in exported spans, logs and metrics (property test)", () => {
  it("random synthetic personal values in span names, attributes, events, status, logs and metric attributes never reach the exporter", async () => {
    const rng = new Rng("arc09-property-pipeline");
    const tracer = trace.getTracer(TELEMETRY_SCOPE);
    const logger = logs.getLogger(TELEMETRY_SCOPE);
    const counter = metrics.getMeter(TELEMETRY_SCOPE).createCounter("ws.test.items");
    const planted: string[] = [];
    const pii = () => {
      const value = piiValue(rng, rng.pick(PII_KINDS));
      planted.push(value);
      return value;
    };
    const attrs = () => Object.fromEntries(KEYS.map((k) => [k, rng.int(0, 1) ? pii() : `x ${pii()}`]));
    for (let round = 0; round < 200; round++) {
      const span = tracer.startSpan(rng.int(0, 1) ? pii() : `GET /v1/${pii()}`, { attributes: attrs() });
      span.addEvent(pii(), attrs());
      // What instrumentation libraries do with an error: message and stack become attributes.
      span.recordException(new Error(`insert failed: ${pii()} ${pii()}`));
      span.setStatus({ code: SpanStatusCode.ERROR, message: pii() });
      span.end();
      logger.emit({ body: `failed for ${pii()}`, eventName: pii(), attributes: attrs() });
      logger.emit({ body: { account: pii(), amount: pii() }, attributes: attrs() });
      counter.add(1, attrs());
    }
    const text = await exportedText(telemetry);
    expect(telemetry.memory.finishedSpans()).toHaveLength(200);
    expect(telemetry.memory.logRecords()).toHaveLength(400);
    for (const value of planted)
      for (const fragment of piiFragments(value)) expect(text).not.toContain(fragment);
    // The technical part stays.
    const exception = telemetry.memory.finishedSpans()[0]!.events.find((e) => e.name === "exception");
    expect(exception?.attributes).toEqual({ "exception.type": "Error", "ws.telemetry.redacted": 2 });
    expect(telemetry.memory.finishedSpans()[0]!.status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it("the technical signals pass unchanged: event names, allow-listed attributes, metric names, the resource", async () => {
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan("db.transaction feature-flags", {
      attributes: { "ws.module": "feature-flags", "db.system.name": "postgresql" },
    });
    context.with(trace.setSpan(context.active(), span), () =>
      logEvent("provider.failure", "warn", {
        "ws.provider": "exchange-rates:http",
        "ws.provider.outcome": "timeout",
      }),
    );
    span.end();
    recordBankSyncRun("failure");
    await telemetry.forceFlush();
    const [exported] = telemetry.memory.finishedSpans();
    expect(exported!.name).toBe("db.transaction feature-flags");
    expect(exported!.attributes).toEqual({ "ws.module": "feature-flags", "db.system.name": "postgresql" });
    expect(exported!.resource.attributes).toEqual({
      "service.name": "willowsum-api",
      "service.namespace": "willowsum",
      "deployment.environment.name": "test",
      "ws.role": "api",
    });
    const [record] = telemetry.memory.logRecords();
    expect(record).toMatchObject({
      body: "provider.failure",
      eventName: "provider.failure",
      severityText: "WARN",
      attributes: { "ws.provider": "exchange-rates:http", "ws.provider.outcome": "timeout" },
    });
    // The log record carries the trace it was written in.
    expect(record!.spanContext?.traceId).toBe(exported!.spanContext().traceId);
    const names = telemetry.memory
      .resourceMetrics()
      .flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics.map((x) => x.descriptor.name)));
    expect(names).toContain("ws.bank_sync.runs");
  });
});

describe("NFR-10 FR 4: request ids are drawn by the server at random", () => {
  it("trace ids are 128-bit, non-zero, from the CSPRNG and unique; span ids 64-bit", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      const id = randomIdGenerator.generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(id).not.toMatch(/^0+$/);
      ids.add(id);
    }
    expect(ids.size).toBe(2_000);
    expect(randomIdGenerator.generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a second start in the same process is refused", () => {
    expect(() => startTelemetry({ mode: "off", role: "worker", environment: "test" })).toThrow(
      /already started/,
    );
  });
});
