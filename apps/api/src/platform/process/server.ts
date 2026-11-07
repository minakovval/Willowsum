import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { guardApiRoutes } from "../http/api.ts";
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
  const app = Fastify({
    logger: false,
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
    frameworkErrors: (_error, request, frameworkReply) => {
      const reply = frameworkReply as unknown as FastifyReply;
      traceRequest(request);
      void sendProblem(request, reply, "NOT_FOUND");
      finishRequestTrace(request, reply);
    },
  });
  // Before any route: nothing under /v1 is served unless the API layer mounted it with its checks (ARC-07).
  guardApiRoutes(app);
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
  app.get("/health/ready", async (_request, reply) => {
    try {
      const result = await options.readiness();
      if (result.ready) return { status: "ready" };
      return reply.code(503).send({ status: "not-ready", reason: result.reason });
    } catch {
      return reply.code(503).send({ status: "not-ready", reason: "database-unreachable" });
    }
  });
  options.api?.(app);
  return app;
}
