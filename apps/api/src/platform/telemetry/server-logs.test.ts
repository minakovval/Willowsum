import { context, logs, metrics, trace } from "@opentelemetry/api";
import { Rng } from "@willowsum/synthetic";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PII_KINDS, piiFragments, piiValue } from "./pii.test-helper.ts";
import { logEvent } from "./signals.ts";
import { startTelemetry, TELEMETRY_SCOPE } from "./telemetry.ts";

// Mode `off` (owner's decision of 2026-11-12: no telemetry export in the PoC; NFR-10 FR 1 — structured logs on
// the server): log records pass the same redaction filter and become one JSON line each; nothing is exported.
const lines: string[] = [];
const telemetry = startTelemetry({
  mode: "off",
  role: "worker",
  environment: "production",
  writeLogLine: (line) => lines.push(line),
});
beforeEach(() => {
  lines.length = 0;
});
afterAll(() => telemetry.shutdown());

const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe("NFR-10 FR 1 in the PoC: WS_TELEMETRY=off keeps structured logs on the server", () => {
  it("a log record becomes one JSON line with time, severity, event, trace id and allow-listed attributes", async () => {
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan("job fx-rates.refresh");
    context.with(trace.setSpan(context.active(), span), () =>
      logEvent("provider.failure", "warn", {
        "ws.provider": "exchange-rates:http",
        "ws.provider.outcome": "timeout",
      }),
    );
    span.end();
    await telemetry.forceFlush();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(lines[0]!.trimEnd()).not.toContain("\n");
    const [line] = records();
    expect(line).toMatchObject({
      severity: "WARN",
      event: "provider.failure",
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
      attributes: { "ws.provider": "exchange-rates:http", "ws.provider.outcome": "timeout" },
      resource: {
        "service.name": "willowsum-api",
        "deployment.environment.name": "production",
        "ws.role": "worker",
      },
    });
    expect(Number.isNaN(Date.parse(String(line!["time"])))).toBe(false);
  });

  it("nothing is kept in memory or exported: no in-memory exporters, spans and metrics produce no lines", async () => {
    expect(telemetry.mode).toBe("off");
    expect(telemetry.memory).toBeUndefined();
    trace.getTracer(TELEMETRY_SCOPE).startSpan("GET /v1/meta").end();
    metrics.getMeter(TELEMETRY_SCOPE).createCounter("ws.test.items").add(1);
    await telemetry.forceFlush();
    expect(lines).toEqual([]);
  });

  it("random synthetic personal values in log bodies, event names and attributes never reach a line (property test)", async () => {
    const rng = new Rng("nfr10-server-logs");
    const logger = logs.getLogger(TELEMETRY_SCOPE);
    const planted: string[] = [];
    const pii = () => {
      const value = piiValue(rng, rng.pick(PII_KINDS));
      planted.push(value);
      return value;
    };
    const keys = ["http.route", "error.type", "ws.db.table", "url.full", "user.email", "amount", "ws.module"];
    const attrs = () => Object.fromEntries(keys.map((k) => [k, rng.int(0, 1) ? pii() : `x ${pii()}`]));
    for (let round = 0; round < 200; round++) {
      logger.emit({ body: `failed for ${pii()}`, eventName: pii(), attributes: attrs() });
      logger.emit({ body: { account: pii(), amount: pii() }, attributes: attrs() });
    }
    await telemetry.forceFlush();
    expect(lines).toHaveLength(400);
    // The timestamp is the only field not under test here (its digits could match a planted number).
    const text = JSON.stringify(
      records().map((record) => {
        const rest = { ...record };
        delete rest["time"];
        return rest;
      }),
    );
    for (const value of planted)
      for (const fragment of piiFragments(value)) expect(text).not.toContain(fragment);
  });
});
