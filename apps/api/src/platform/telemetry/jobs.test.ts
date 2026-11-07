import { context, SpanKind, trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { jobTraceCarrier, runJob, runScheduled } from "./jobs.ts";
import { TELEMETRY_SCOPE } from "./scope.ts";
import { testTelemetryForFile } from "./testing.ts";

const telemetry = testTelemetryForFile();

describe("ARC-09 FR 3: the trace id travels into background jobs", () => {
  it("a job enqueued inside a trace runs in that trace, as a child of the span that enqueued it", async () => {
    const parent = trace.getTracer(TELEMETRY_SCOPE).startSpan("api.enqueue");
    const carrier = context.with(trace.setSpan(context.active(), parent), () => jobTraceCarrier());
    parent.end();
    expect(carrier?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    // The carrier is plain data: it survives a round trip through a queue row.
    const stored = JSON.parse(JSON.stringify(carrier)) as typeof carrier;
    await runJob("bank-sync", stored, async () => undefined);
    const job = telemetry.memory.finishedSpans().find((s) => s.name === "job bank-sync")!;
    expect(job.kind).toBe(SpanKind.CONSUMER);
    expect(job.attributes).toEqual({ "ws.job.name": "bank-sync" });
    expect(job.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(job.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it("outside a trace there is no carrier; a job without one, or with a malformed one, starts its own trace", async () => {
    expect(jobTraceCarrier()).toBeUndefined();
    await runJob("cleanup", undefined, async () => undefined);
    await runJob("cleanup", { traceparent: "00-zzzz-1-01" }, async () => undefined);
    const jobs = telemetry.memory.finishedSpans();
    expect(jobs.map((s) => s.parentSpanContext)).toEqual([undefined, undefined]);
    expect(jobs[0]!.spanContext().traceId).not.toBe(jobs[1]!.spanContext().traceId);
  });

  it("a scheduled task is a trace of its own; a failing job is logged by class, never by message, and rethrown", async () => {
    await runScheduled("weekly-digest", async () => undefined);
    const [scheduled] = telemetry.memory.finishedSpans();
    expect(scheduled!.name).toBe("schedule weekly-digest");
    expect(scheduled!.parentSpanContext).toBeUndefined();
    class SyncFailed extends Error {}
    await expect(
      runJob("bank-sync", undefined, async () => {
        throw new SyncFailed("account UA213223130000026007233566001 of olha@example.com");
      }),
    ).rejects.toBeInstanceOf(SyncFailed);
    const [record] = telemetry.memory.logRecords();
    expect(record!.body).toBe("job.failed");
    expect(record!.attributes).toEqual({ "ws.job.name": "bank-sync", "error.type": "SyncFailed" });
    expect(JSON.stringify(record!.attributes)).not.toContain("olha");
  });
});
