import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { logEvent } from "./signals.ts";
import { TELEMETRY_SCOPE } from "./scope.ts";

/**
 * The trace of a request travels into the background jobs it starts (ARC-09 FR 3, ADR-0006). A job keeps
 * the request's trace id, so the support code a user quotes leads to the job too. The carrier is written by
 * our own code into our own queue (ARC-04) — unlike a header from the public internet, which is never read
 * (http.ts). Scheduled tasks start a trace of their own.
 */
export interface JobTraceCarrier {
  /** W3C `traceparent` of the context that enqueued the job. */
  readonly traceparent: string;
}

const propagator = new W3CTraceContextPropagator();
const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

/** The carrier of the current trace, to store with a job when it is enqueued; undefined outside a trace. */
export function jobTraceCarrier(from: Context = context.active()): JobTraceCarrier | undefined {
  const carrier: Record<string, string> = {};
  propagator.inject(from, carrier, {
    set: (target, key, value) => {
      target[key] = value;
    },
  });
  const traceparent = carrier["traceparent"];
  return traceparent && TRACEPARENT_RE.test(traceparent) ? { traceparent } : undefined;
}

function parentOf(carrier: JobTraceCarrier | undefined): Context {
  if (!carrier || typeof carrier.traceparent !== "string" || !TRACEPARENT_RE.test(carrier.traceparent))
    return ROOT_CONTEXT;
  return propagator.extract(
    ROOT_CONTEXT,
    { traceparent: carrier.traceparent },
    {
      get: (source, key) => source[key as keyof typeof source],
      keys: (source) => Object.keys(source),
    },
  );
}

async function inSpan<T>(span: Span, parent: Context, name: string, work: () => Promise<T>): Promise<T> {
  try {
    const result = await context.with(trace.setSpan(parent, span), work);
    return result;
  } catch (error) {
    const errorClass = error instanceof Error ? error.constructor.name || error.name : typeof error;
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute("error.type", errorClass);
    logEvent(
      "job.failed",
      "error",
      { "ws.job.name": name, "error.type": errorClass },
      trace.setSpan(parent, span),
    );
    throw error;
  } finally {
    span.end();
  }
}

/** Runs a background job (worker role) inside the trace of the request that enqueued it. */
export function runJob<T>(
  name: string,
  carrier: JobTraceCarrier | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const parent = parentOf(carrier);
  const span = trace
    .getTracer(TELEMETRY_SCOPE)
    .startSpan(`job ${name}`, { kind: SpanKind.CONSUMER, attributes: { "ws.job.name": name } }, parent);
  return inSpan(span, parent, name, work);
}

/** Runs a scheduled task (scheduler role) as a trace of its own. */
export function runScheduled<T>(name: string, work: () => Promise<T>): Promise<T> {
  const span = trace
    .getTracer(TELEMETRY_SCOPE)
    .startSpan(
      `schedule ${name}`,
      { kind: SpanKind.INTERNAL, attributes: { "ws.job.name": name } },
      ROOT_CONTEXT,
    );
  return inSpan(span, ROOT_CONTEXT, name, work);
}
