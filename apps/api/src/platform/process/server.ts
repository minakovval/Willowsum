import Fastify, { type FastifyInstance } from "fastify";

/** What the readiness probe asks: can we reach the database, and is its schema at least our version? */
export type ReadinessCheck = () => Promise<{ ready: true } | { ready: false; reason: string }>;

export interface ServerOptions {
  readonly readiness: ReadinessCheck;
  /** Mounts the HTTP API (role `api` only, ARC-07). */
  readonly api?: (app: FastifyInstance) => void;
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
    return503OnClosing: true,
  });
  // A response finished during shutdown closes its keep-alive connection, so close() is not held open by it.
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
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
