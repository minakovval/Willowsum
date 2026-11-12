import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { guardApiRoutes } from "../http/api.ts";
import { API_BODY_LIMIT_BYTES } from "../http/limits.ts";
import {
  API_SECURITY_HEADERS,
  applySecurityHeaders,
  HSTS_HEADER,
  HSTS_VALUE,
  installSecurityHeaders,
} from "../http/security-headers.ts";
import { PROBLEM_CONTENT_TYPE, problemBody, type ProblemCode } from "../http/problem.ts";
import {
  finishRequestTrace,
  instrumentHttp,
  markRequestProblem,
  requestTraceId,
  traceRequest,
} from "../telemetry/http.ts";

/** What the readiness probe asks: can we reach the database, and is its schema at least our version? */
export type ReadinessCheck = () => Promise<{ ready: true } | { ready: false; reason: string }>;

export interface ServerOptions {
  readonly readiness: ReadinessCheck;
  /** Mounts the HTTP API (role `api` only, ARC-07). */
  readonly api?: (app: FastifyInstance) => void;
  /**
   * HSTS on every answer: staging and production only (NFR-14 table), from the configuration. Default off.
   */
  readonly hsts?: boolean;
  /**
   * Proxies in front of the API whose `X-Forwarded-For` / `X-Forwarded-Proto` are trusted (NFR-14 FR 8;
   * `WS_TRUSTED_PROXY_HOPS`). 0 (default): the client's address is the socket's, forwarded headers are ignored.
   */
  readonly trustedProxyHops?: number;
}

/** Seconds a client waits before retrying a request that arrived while this process was stopping. */
export const SHUTTING_DOWN_RETRY_AFTER_S = 5;

function sendProblem(request: FastifyRequest, reply: FastifyReply, code: ProblemCode): FastifyReply {
  markRequestProblem(request, code);
  const body = problemBody(code, { supportId: requestTraceId(request) });
  return reply.code(body.status).header("content-type", PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

/**
 * The HTTP server every role runs (ARC-02 FR 1, FR 4). `api` mounts its routes on it (ARC-07); `worker`
 * and `scheduler` serve only the probes. The probes return no data: «готовий» says only why it is not.
 */
export function buildServer(options: ServerOptions): FastifyInstance {
  const hops = options.trustedProxyHops ?? 0;
  if (!Number.isInteger(hops) || hops < 0) throw new Error("trustedProxyHops is a non-negative integer");
  const headers = { hsts: options.hsts ?? false };
  const app = Fastify({
    logger: false,
    // NFR-15 FR 17: request bodies up to 1 MiB (Fastify's default, made explicit); larger → 413.
    bodyLimit: API_BODY_LIMIT_BYTES,
    // NFR-14 FR 8: the client's address (request.ip, request.protocol) comes from forwarded headers only
    // through the configured number of trusted proxies (hop 0 is the socket peer); without them, never.
    trustProxy: hops === 0 ? false : (_address: string, hop: number) => hop < hops,
    // On shutdown, idle keep-alive connections are closed at once; requests in flight are finished.
    forceCloseConnections: "idle",
    // Requests that still arrive while stopping (on a busy keep-alive connection) are answered below with a
    // traced problem, not with Fastify's raw 503 (ARC-09 FR 3, NFR-10 FR 4).
    return503OnClosing: false,
    // Errors Fastify raises before routing and without any hook — a URL it cannot decode (FST_ERR_BAD_URL), a
    // path parameter over the length limit (FST_ERR_MAX_PARAM_LENGTH): traced here and answered with the
    // NOT_FOUND problem and its support id, never Fastify's own body, which echoes the path. NOT_FOUND, as for
    // an unknown path, so such a URL does not tell existing and unknown routes apart (DAT-05 FR 7). Every
    // framework error lands here, also FST_ERR_ASYNC_CONSTRAINT (no async route constraints are used today):
    // if one ever is, map it to its own problem.
    // Requests Node cannot parse (a malformed request line or header, headers over the size limit, a request
    // timeout) are answered on the socket before Fastify sees them: with the security headers too (NFR-14 FR 1).
    clientErrorHandler: (error: Error & { code?: string }, socket) => {
      if (error.code === "ECONNRESET" || socket.destroyed) return;
      const [status, reason] =
        error.code === "HPE_HEADER_OVERFLOW"
          ? [431, "Request Header Fields Too Large"]
          : error.code === "ERR_HTTP_REQUEST_TIMEOUT"
            ? [408, "Request Timeout"]
            : [400, "Bad Request"];
      const body = JSON.stringify({ status, title: reason });
      const lines = [
        `HTTP/1.1 ${status} ${reason}`,
        "content-type: application/json; charset=utf-8",
        `content-length: ${Buffer.byteLength(body)}`,
        "connection: close",
        ...Object.entries(API_SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
        ...(headers.hsts ? [`${HSTS_HEADER}: ${HSTS_VALUE}`] : []),
      ];
      if (socket.writable && socket.bytesWritten === 0) socket.write(`${lines.join("\r\n")}\r\n\r\n${body}`);
      socket.destroy(error);
    },
    frameworkErrors: (_error, request, frameworkReply) => {
      const reply = frameworkReply as unknown as FastifyReply;
      traceRequest(request);
      applySecurityHeaders(reply, headers);
      void sendProblem(request, reply, "NOT_FOUND");
      finishRequestTrace(request, reply);
    },
  });
  // Before any route: nothing under /v1 is served unless the API layer mounted it with its checks (ARC-07).
  guardApiRoutes(app);
  // NFR-14 FR 1: the security headers on every answer (probes, problems, 404, the 503 while stopping).
  installSecurityHeaders(app, headers);
  // Every request except the probes is traced; its trace id is the support id of its problems (ARC-09).
  instrumentHttp(app);
  // A response finished during shutdown closes its keep-alive connection, so close() is not held open by it.
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
  });
  // After instrumentHttp's hook, so the answer carries the request's trace id.
  app.addHook("onRequest", async (request, reply) => {
    if (!closing) return;
    void reply.header("retry-after", String(SHUTTING_DOWN_RETRY_AFTER_S));
    return sendProblem(request, reply, "SERVICE_UNAVAILABLE");
  });
  app.addHook("onSend", async (_request, reply) => {
    if (closing) reply.header("connection", "close");
  });
  app.get("/health/live", async () => ({ status: "live" }));
  // The probe is reachable from the internet (the PoC «alive» check) and never rate-limited: concurrent probes
  // share one in-flight check, so a burst costs one query on the probe pool, not one per request.
  let inFlight: ReturnType<ReadinessCheck> | undefined;
  const readiness = () =>
    (inFlight ??= options.readiness().finally(() => {
      inFlight = undefined;
    }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      const result = await readiness();
      if (result.ready) return { status: "ready" };
      return reply.code(503).send({ status: "not-ready", reason: result.reason });
    } catch {
      return reply.code(503).send({ status: "not-ready", reason: "database-unreachable" });
    }
  });
  options.api?.(app);
  return app;
}
