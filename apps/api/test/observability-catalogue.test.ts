import { describe, expect, it } from "vitest";
import {
  HTTP_DURATION_BUCKETS_S,
  METRIC_EXPORT_INTERVAL_MS,
  METRICS,
} from "../src/platform/telemetry/index.ts";

/**
 * ARC-09 FR 4 / NFR-10 FR 6 (ADR-0006): the alert rules in infra/observability read the metrics the code
 * emits. tools/observability/definitions.mjs lists them by their OpenTelemetry and Prometheus names; this test
 * keeps that list, the export interval of the alert budget and the latency buckets equal to the code.
 */
const definitions = new URL("../../../tools/observability/definitions.mjs", import.meta.url).href;

describe("ARC-09: the alert rules read exactly the metrics the API emits", () => {
  it("same metric names, same export interval, buckets at the SLO thresholds", async () => {
    const defs = (await import(definitions)) as {
      METRICS: Record<string, string>;
      TIMING: { metricExportIntervalS: number };
      SLOS: readonly { id: string; thresholdS?: number }[];
    };
    expect(defs.METRICS).toEqual(
      Object.fromEntries(Object.values(METRICS).map((m) => [m.name, m.prometheus])),
    );
    expect(defs.TIMING.metricExportIntervalS * 1000).toBe(METRIC_EXPORT_INTERVAL_MS);
    for (const s of defs.SLOS)
      if (s.thresholdS !== undefined) expect(HTTP_DURATION_BUCKETS_S).toContain(s.thresholdS);
  });
});
