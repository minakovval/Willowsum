import { afterAll, beforeEach } from "vitest";
import type { MemoryExporters } from "./exporters.ts";
import { startTelemetry, type Telemetry } from "./telemetry.ts";

/**
 * Tests: telemetry in `test` mode for one test file — the same redaction filter and in-memory exporters as
 * local development and CI. Memory is cleared before each test; telemetry stops after the file (the
 * OpenTelemetry globals outlive a test file's modules in a Vitest worker).
 */
export function testTelemetryForFile(): Telemetry & { readonly memory: MemoryExporters } {
  const telemetry = startTelemetry({ mode: "test", role: "api", environment: "test" });
  beforeEach(() => telemetry.memory!.reset());
  afterAll(() => telemetry.shutdown());
  return telemetry as Telemetry & { readonly memory: MemoryExporters };
}

/**
 * Everything the exporters received, as one text: span names, attributes, events, status, links, log bodies,
 * event names, metric names and data-point attributes, resources and scopes. A test asserts that no
 * personal value appears in it.
 */
export async function exportedText(
  telemetry: Telemetry & { readonly memory: MemoryExporters },
): Promise<string> {
  await telemetry.forceFlush();
  const { memory } = telemetry;
  return JSON.stringify({
    spans: memory.finishedSpans().map((s) => ({
      name: s.name,
      attributes: s.attributes,
      events: s.events.map((e) => ({ name: e.name, attributes: e.attributes })),
      status: s.status,
      links: s.links.map((l) => l.attributes),
      resource: s.resource.attributes,
      scope: s.instrumentationScope,
    })),
    logs: memory.logRecords().map((r) => ({
      body: r.body,
      eventName: r.eventName,
      severity: r.severityText,
      attributes: r.attributes,
      resource: r.resource.attributes,
      scope: r.instrumentationScope,
    })),
    metrics: memory.resourceMetrics().map((m) => ({
      resource: m.resource.attributes,
      scopes: m.scopeMetrics.map((s) => ({
        scope: s.scope,
        metrics: s.metrics.map((x) => ({
          descriptor: x.descriptor,
          points: x.dataPoints.map((p) => p.attributes),
        })),
      })),
    })),
  });
}
