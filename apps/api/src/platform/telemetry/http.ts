import {
  context,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logEvent, recordHttpRequest } from "./signals.ts";
import { TELEMETRY_SCOPE } from "./scope.ts";

/**
 * Tracing of every HTTP request (NFR-10 FR 5, ARC-09 FR 3, ADR-0006). Each request except the health probes
 * gets a new root span with a trace id the server draws at random. An incoming `traceparent`, `tracestate`,
 * `x-request-id` or any other client id is never read: a request from the public internet cannot choose or
 * join a trace (NFR-10 FR 4). The trace id is the request's support id, sent in every problem response and
 * shown by clients as the error code.
 *
 * The span records only the method, the route template and the status; never the URL, its query, the
 * headers, the body or the client's address.
 */
interface RequestTrace {
  readonly span: Span;
  readonly context: Context;
  readonly started: number;
  ended: boolean;
  /** The problem code of the answer, if it is a problem (a closed set: ProblemCode). */
  problem?: string;
}

const traces = new WeakMap<FastifyRequest, RequestTrace>();

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function method(request: FastifyRequest): string {
  return METHODS.has(request.method) ? request.method : "_OTHER";
}

/** The route template Fastify matched (`/v1/things/:thingId`), or undefined for an unknown path. */
function routeOf(request: FastifyRequest): string | undefined {
  return request.is404 ? undefined : request.routeOptions.url;
}

function isProbe(request: FastifyRequest): boolean {
  return routeOf(request)?.startsWith("/health/") ?? false;
}

/** The support id (= trace id) of a request, or undefined when it is not traced (health probes). */
export function requestTraceId(request: FastifyRequest): string | undefined {
  const spanContext = traces.get(request)?.span.spanContext();
  // Before telemetry starts the tracer is a no-op whose ids are all zeros: no support id then.
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

/** The trace context of a request, for log records that belong to it. */
export function requestContext(request: FastifyRequest): Context | undefined {
  return traces.get(request)?.context;
}

/** Marks the request span as failed with value-free attributes (error class, problem code, database fields). */
export function annotateRequestError(request: FastifyRequest, attributes: Attributes): void {
  const found = traces.get(request);
  if (!found || found.ended) return;
  found.span.setAttributes(attributes);
}

/**
 * Records the problem code of the answer (`ws.problem.code` on the span and the duration metric). The codes are
 * a closed set; the alert rules leave the deliberate 503s out of the 5xx ratio: MODULE_UNAVAILABLE (a kill
 * switch, CICD-06) and SERVICE_UNAVAILABLE (a graceful stop) — ADR-0006.
 */
export function markRequestProblem(request: FastifyRequest, code: string): void {
  const found = traces.get(request);
  if (found && !found.ended) found.problem = code;
}

/** Ends the request's span with the reply's status (also called directly for a reply sent outside the hooks). */
export function finishRequestTrace(request: FastifyRequest, reply: FastifyReply | undefined): void {
  const found = traces.get(request);
  if (!found || found.ended) return;
  found.ended = true;
  const route = routeOf(request);
  const status = reply?.statusCode;
  const attributes: Attributes = {
    "http.request.method": method(request),
    ...(route ? { "http.route": route } : {}),
    ...(status !== undefined ? { "http.response.status_code": status } : {}),
    ...(found.problem !== undefined ? { "ws.problem.code": found.problem } : {}),
  };
  if (route) found.span.updateName(`${method(request)} ${route}`);
  found.span.setAttributes(attributes);
  // OpenTelemetry HTTP server convention: only 5xx is a server-side error; an aborted request has no status.
  if (status === undefined || status >= 500) {
    found.span.setStatus({ code: SpanStatusCode.ERROR });
    if (status === undefined) found.span.setAttribute("error.type", "RequestAborted");
  }
  found.span.end();
  recordHttpRequest(
    status === undefined ? { ...attributes, "error.type": "RequestAborted" } : attributes,
    (performance.now() - found.started) / 1000,
  );
}

/**
 * Starts the root span of a request (once) and returns its context. Also used for requests Fastify answers
 * before any hook (a URL it cannot decode, process/server.ts), so they too get a trace and a support id.
 */
export function traceRequest(request: FastifyRequest): Context {
  const found = traces.get(request);
  if (found) return found.context;
  const span = trace.getTracer(TELEMETRY_SCOPE).startSpan(
    method(request),
    { kind: SpanKind.SERVER, attributes: { "http.request.method": method(request) } },
    // A new root: incoming trace headers are ignored on purpose (NFR-10 FR 4).
    ROOT_CONTEXT,
  );
  const ctx = trace.setSpan(ROOT_CONTEXT, span);
  traces.set(request, { span, context: ctx, started: performance.now(), ended: false });
  return ctx;
}

export function instrumentHttp(app: FastifyInstance): void {
  // The rest of the request's lifecycle (body, validation, handler, error handler) continues in this context:
  // tests over a real socket with a body arriving in pieces show it (no re-entry in later hooks is needed).
  app.addHook("onRequest", (request, _reply, done) => {
    if (isProbe(request)) return done();
    context.with(traceRequest(request), done);
  });
  app.addHook("onResponse", (request, reply, done) => {
    finishRequestTrace(request, reply);
    done();
  });
  // The client went away before the answer: the span still ends (no status).
  app.addHook("onRequestAbort", (request, done) => {
    finishRequestTrace(request, undefined);
    done();
  });
}

/** Logs an event for a request, carrying its trace. */
export function logRequestEvent(
  request: FastifyRequest,
  event: string,
  severity: "info" | "warn" | "error",
  attributes: Attributes,
): void {
  const ctx = requestContext(request);
  logEvent(event, severity, attributes, ctx);
}
