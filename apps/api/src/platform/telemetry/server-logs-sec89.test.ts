import { context, logs, trace, TraceFlags, createTraceState } from "@opentelemetry/api";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { Rng } from "@willowsum/synthetic";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { JsonLinesLogExporter, redactingLogRecordExporter } from "./exporters.ts";
import { PII_KINDS, piiFragments, piiValue } from "./pii.test-helper.ts";
import { ATTRIBUTE_RULES } from "./redaction.ts";
import { logEvent } from "./signals.ts";
import { startTelemetry, TELEMETRY_SCOPE } from "./telemetry.ts";

// Security review of PR #89: WS_TELEMETRY=off writes each log record as one JSON line on standard output after
// the exporter's redaction filter. These tests pin what a line may hold and that hostile values cannot forge,
// split or bloat lines.
const lines: string[] = [];
const telemetry = startTelemetry({
  mode: "off",
  role: "api",
  environment: "production",
  writeLogLine: (line) => lines.push(line),
});
beforeEach(() => {
  lines.length = 0;
});
afterAll(() => telemetry.shutdown());

const LINE_KEYS = new Set(["time", "severity", "event", "trace_id", "span_id", "resource", "attributes"]);
const HOSTILE = [
  "a\nb",
  "a\r\nb",
  'x"}\n{"event":"forged","severity":"ERROR"}',
  "\u001b[31mred\u001b[0m",
  "\u0000nul",
  "line sep para",
  "\ud800lone-surrogate",
  "x".repeat(1_000_000),
];

function parsed(): Record<string, unknown>[] {
  return lines.map((line) => {
    expect(line.endsWith("\n")).toBe(true);
    // One record = one physical line: no raw newline, carriage return or control character inside it.
    expect([...line.slice(0, -1)].filter((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)).toEqual(
      [],
    );
    return JSON.parse(line) as Record<string, unknown>;
  });
}

describe("security review PR #89: structured server log lines (WS_TELEMETRY=off)", () => {
  it("hostile values (newlines, forged JSON, ANSI, NUL, separators, lone surrogates, 1 MB) never forge, split or bloat a line", async () => {
    const logger = logs.getLogger(TELEMETRY_SCOPE);
    for (const v of HOSTILE) {
      logger.emit({
        body: v,
        eventName: v,
        severityText: v,
        attributes: { [v.slice(0, 64)]: v, "ws.module": v, "http.route": v },
      });
      logger.emit({
        body: "ok.event",
        severityText: "WARN",
        attributes: { "ws.module": v, "error.type": v },
      });
    }
    await telemetry.forceFlush();
    expect(lines).toHaveLength(HOSTILE.length * 2);
    for (const [i, record] of parsed().entries()) {
      expect(lines[i]!.length).toBeLessThan(2_048);
      expect(Object.keys(record).every((key) => LINE_KEYS.has(key))).toBe(true);
      expect(["redacted", "ok.event"]).toContain(record["event"]);
      for (const key of Object.keys(record["attributes"] as object))
        expect(Object.hasOwn(ATTRIBUTE_RULES, key)).toBe(true);
      expect(JSON.stringify(record)).not.toMatch(/forged|mred|nul|sep|para|surrogate|xxxxxxxx/);
    }
    // A severity text outside the severity grammar is dropped, never copied.
    expect(
      parsed()
        .filter((r) => "severity" in r)
        .map((r) => r["severity"]),
    ).toEqual(HOSTILE.map(() => "WARN"));
  });

  it("a line holds exactly the documented fields: no scope, observed time, event name, trace state, flags or dropped count", async () => {
    const traceState = createTraceState("vendor=user-at-example");
    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
      traceState,
    };
    context.with(trace.setSpan(context.active(), trace.wrapSpanContext(spanContext)), () =>
      logEvent("provider.failure", "error", { "ws.provider": "exchange-rates:http" }),
    );
    await telemetry.forceFlush();
    const [record] = parsed();
    expect(Object.keys(record!).sort()).toEqual([...LINE_KEYS].sort());
    expect(record!["trace_id"]).toBe(spanContext.traceId);
    expect(record!["span_id"]).toBe(spanContext.spanId);
    expect(lines[0]).not.toContain("user-at-example");
  });

  it("an invalid span context (not hex, with a newline) never reaches trace_id or span_id", async () => {
    const bad = {
      traceId: "not-a-trace\nid-0000000000000000",
      spanId: "zz\n",
      traceFlags: TraceFlags.SAMPLED,
    };
    context.with(trace.setSpan(context.active(), trace.wrapSpanContext(bad)), () =>
      logEvent("provider.failure", "warn", {}),
    );
    await telemetry.forceFlush();
    const [record] = parsed();
    expect(record).not.toHaveProperty("trace_id");
    expect(record).not.toHaveProperty("span_id");
  });

  it("an exception passed to emit (message, stack, URL with token) never reaches a line", async () => {
    const rng = new Rng("sec89-exception");
    const planted = PII_KINDS.map((kind) => piiValue(rng, kind));
    const error = new TypeError(`failed for ${planted.join(" ")}`);
    logs.getLogger(TELEMETRY_SCOPE).emit({
      body: "api.server_error",
      severityText: "ERROR",
      exception: error,
      attributes: {
        "exception.message": error.message,
        "exception.stacktrace": error.stack ?? "",
        "exception.type": "TypeError",
        "url.full": `https://api.example.test/v1/x?token=${planted[0]}`,
        "http.request.header.authorization": planted[6]!,
        "client.address": "203.0.113.7",
      },
    });
    await telemetry.forceFlush();
    const [record] = parsed();
    expect(record!["attributes"]).toEqual({ "exception.type": "TypeError", "ws.telemetry.redacted": 5 });
    for (const value of planted)
      for (const fragment of piiFragments(value)) expect(lines[0]).not.toContain(fragment);
    expect(lines[0]).not.toContain("203.0.113.7");
    expect(lines[0]).not.toContain("failed for");
  });

  it("spans and metrics stay silent even with personal data in their names and attributes", async () => {
    const span = trace
      .getTracer(TELEMETRY_SCOPE)
      .startSpan("GET /v1/x?email=a@b.example", { attributes: { "user.email": "a@b.example" } });
    span.recordException(new Error("secret"));
    span.end();
    await telemetry.forceFlush();
    expect(lines).toEqual([]);
  });
});

describe("security review PR #89: the wrapped line exporter on a batch", () => {
  it("every record of a batch becomes its own line, the resource is filtered too, and the export reports success", () => {
    const out: string[] = [];
    const exporter = redactingLogRecordExporter(new JsonLinesLogExporter((line) => out.push(line)));
    const resource = resourceFromAttributes({
      "service.name": "willowsum-api",
      "host.name": "alice-laptop",
      "service.version": "1.0.0-4111111111111111",
    });
    const records = [0, 1, 2].map((i) => ({ ...fakeRecord(i), resource }) as unknown as ReadableLogRecord);
    let result: number | undefined;
    exporter.export(records, (r) => {
      result = r.code;
    });
    expect(result).toBe(ExportResultCode.SUCCESS);
    expect(out).toHaveLength(3);
    for (const line of out) {
      expect(JSON.parse(line).resource).toEqual({
        "service.name": "willowsum-api",
        "ws.telemetry.redacted": 2,
      });
      expect(line).not.toMatch(/alice|4111/);
    }
  });
});

// ---- Defects found by the review: the default sink (process.stdout) ----
function fakeRecord(i: number): ReadableLogRecord {
  return {
    hrTime: [1_700_000_000, i],
    hrTimeObserved: [1_700_000_000, i],
    severityText: "INFO",
    body: "provider.failure",
    resource: { attributes: { "service.name": "willowsum-api" } },
    instrumentationScope: { name: TELEMETRY_SCOPE },
    attributes: { "ws.provider": "exchange-rates:http", "ws.provider.outcome": "timeout" },
    droppedAttributesCount: 0,
  } as unknown as ReadableLogRecord;
}

describe("security review PR #89: the default stdout sink is bounded and flushed (defects)", () => {
  let pending = 0;
  let accepted = 0;
  beforeEach(() => {
    pending = 0;
    accepted = 0;
    // A stalled reader (a full pipe): nothing drains, every write is buffered in the process.
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      pending += Buffer.byteLength(chunk);
      accepted += Buffer.byteLength(chunk);
      return false;
    }) as never);
    vi.spyOn(process.stdout, "writableLength", "get").mockImplementation(() => pending);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a stalled stdout never buffers more than 1 MiB of log lines in the process (no unbounded memory)", () => {
    const exporter = new JsonLinesLogExporter();
    for (let i = 0; i < 20_000; i++) exporter.export([fakeRecord(i)], () => undefined);
    expect(accepted).toBeLessThanOrEqual(1024 * 1024 + 4096);
  });

  it("forceFlush and shutdown wait until stdout has drained, so process.exit after stop loses no line", async () => {
    const exporter = new JsonLinesLogExporter();
    for (let i = 0; i < 10; i++) exporter.export([fakeRecord(i)], () => undefined);
    expect(pending).toBeGreaterThan(0);
    setTimeout(() => {
      pending = 0;
    }, 50);
    await exporter.forceFlush();
    expect(pending).toBe(0);
    for (let i = 0; i < 10; i++) exporter.export([fakeRecord(i)], () => undefined);
    setTimeout(() => {
      pending = 0;
    }, 50);
    await exporter.shutdown();
    expect(pending).toBe(0);
  });
});
