import type { FastifyRequest } from "fastify";

/**
 * Session cookies (NFR-15 FR 5; ADR-0007): always `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`; on HTTPS
 * the name carries the `__Secure-` prefix, so a browser accepts the cookie only from a secure origin and with
 * `Secure` — a cookie of the same name planted over plain HTTP or by a script cannot pass for it. Reading on
 * HTTPS accepts only the prefixed name. The identity module (ACC-01) sets its session cookie only through
 * these helpers. No `Domain`: the cookie stays on the API's own host.
 */
export const SECURE_COOKIE_PREFIX = "__Secure-";

/** A cookie name: an RFC 6265 token (letters, digits and `-_.`), without the prefix. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** A cookie value: RFC 6265 cookie-octets, bounded (session ids and the like, never personal data). */
const VALUE_RE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,4096}$/;

export interface CookieContext {
  /** The request came over HTTPS (the API's own TLS, or a trusted proxy's X-Forwarded-Proto), or the app is deployed. */
  readonly https: boolean;
}

/** HTTPS for cookies: always in staging and production (only served over HTTPS), else the request's protocol. */
export function cookieContext(request: FastifyRequest, deployed: boolean): CookieContext {
  return { https: deployed || request.protocol === "https" };
}

export function cookieName(name: string, context: CookieContext): string {
  if (!NAME_RE.test(name) || name.startsWith(SECURE_COOKIE_PREFIX))
    throw new Error("cookie name must be a token without the __Secure- prefix");
  return context.https ? `${SECURE_COOKIE_PREFIX}${name}` : name;
}

/** The `Set-Cookie` value of a session cookie. Without `maxAgeS` it ends with the browser session. */
export function sessionCookie(
  name: string,
  value: string,
  context: CookieContext,
  options: { readonly maxAgeS?: number } = {},
): string {
  if (!VALUE_RE.test(value)) throw new Error("cookie value has characters a cookie cannot hold");
  const maxAge = options.maxAgeS;
  if (maxAge !== undefined && (!Number.isInteger(maxAge) || maxAge < 0))
    throw new Error("cookie max-age is a non-negative integer");
  return [
    `${cookieName(name, context)}=${value}`,
    "Path=/",
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/** The `Set-Cookie` value that removes the cookie (same attributes, empty, expired). */
export function clearedSessionCookie(name: string, context: CookieContext): string {
  return [`${cookieName(name, context)}=`, "Path=/", "Max-Age=0", "HttpOnly", "Secure", "SameSite=Lax"].join(
    "; ",
  );
}

/**
 * The value of a session cookie of the request, or undefined. On HTTPS only the `__Secure-` name counts; a
 * cookie sent twice under the name (one planted by another path or subdomain) is not trusted at all.
 */
export function readSessionCookie(
  request: Pick<FastifyRequest, "headers">,
  name: string,
  context: CookieContext,
): string | undefined {
  const wanted = cookieName(name, context);
  const header = request.headers.cookie;
  if (typeof header !== "string") return undefined;
  const found: string[] = [];
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    if (pair.slice(0, at).trim() === wanted) found.push(pair.slice(at + 1).trim());
  }
  if (found.length !== 1) return undefined;
  const value = found[0]!;
  return VALUE_RE.test(value) ? value : undefined;
}
