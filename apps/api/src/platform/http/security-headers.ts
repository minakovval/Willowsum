import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Security headers of every API response (NFR-14 FR 1, table «Заголовки API»; ADR-0007): the routes of the
 * API, its problems (also 404 and Fastify's own errors), the health probes and the 503 while stopping. The
 * web CSP (NFR-14 FR 3) is never sent by the API: its own policy forbids every source.
 */
export const API_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
});

/** HSTS: only in staging and production (NFR-14 table), where the API is served over HTTPS only. */
export const HSTS_HEADER = "strict-transport-security";
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Headers a route may set to its own value, which then wins over the default (NFR-14 FR 1): e.g. a stricter
 * CSP with `sandbox` for a signed file, `SAMEORIGIN` for a file the app shows in its own viewer, or
 * `private, max-age=300` for a schema of asset types. `nosniff` and HSTS are never relaxed by a route.
 */
export const ROUTE_OVERRIDABLE_HEADERS = [
  "cache-control",
  "content-security-policy",
  "x-frame-options",
  "cross-origin-resource-policy",
  "referrer-policy",
] as const;
export type RouteHeaderName = (typeof ROUTE_OVERRIDABLE_HEADERS)[number];
export type RouteHeaders = Readonly<Partial<Record<RouteHeaderName, string>>>;

/** A header value a route may declare: visible ASCII and spaces, no line breaks, bounded. */
export const ROUTE_HEADER_VALUE_RE = /^[\x21-\x7e]([\x20-\x7e]{0,510}[\x21-\x7e])?$/;

export interface SecurityHeaderOptions {
  /** Send HSTS (staging and production only). */
  readonly hsts: boolean;
}

/** Sets every security header the reply does not carry yet (a route's own value, set earlier, is kept). */
export function applySecurityHeaders(reply: FastifyReply, options: SecurityHeaderOptions): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
    if (!reply.hasHeader(name)) void reply.header(name, value);
  // nosniff is not overridable: whatever was set before, it is the platform's value.
  void reply.header("x-content-type-options", API_SECURITY_HEADERS["x-content-type-options"]);
  if (options.hsts) void reply.header(HSTS_HEADER, HSTS_VALUE);
  else void reply.removeHeader(HSTS_HEADER);
}

const installed = new WeakSet<FastifyInstance>();

/**
 * Adds the security headers to every response of the app: in `onSend`, which runs for every answer sent
 * through Fastify (routes, not-found and error handlers, problems answered from hooks). Fastify's errors
 * before routing (`frameworkErrors`) call `applySecurityHeaders` themselves (process/server.ts).
 */
export function installSecurityHeaders(app: FastifyInstance, options: SecurityHeaderOptions): void {
  if (installed.has(app)) return;
  installed.add(app);
  app.addHook("onSend", async (_request, reply, payload) => {
    applySecurityHeaders(reply, options);
    return payload;
  });
}
