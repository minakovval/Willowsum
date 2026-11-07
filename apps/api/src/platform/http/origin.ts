import type { FastifyRequest } from "fastify";

/**
 * The Origin check of write requests (NFR-15 FR 5; ADR-0007). A browser sends `Origin` with every POST, PUT,
 * PATCH and DELETE (same-origin too), so a write from a page of another site carries that site's origin and
 * is refused (403 ORIGIN_NOT_ALLOWED) before anything else of the request runs. Reads are not checked: they
 * change nothing, and the API's CORP and frame headers keep their answers from other sites.
 *
 * Without `Origin` the request does not come from a page script or form of a current browser: a mobile app,
 * a server or a command-line client, none of which a third-party site can drive into sending the user's
 * cookies. Such a request is allowed — unless the browser's own `Sec-Fetch-Site` says it is cross-site,
 * which only a browser sets and a page cannot forge. `Origin: null` (a sandboxed frame, a file, some
 * redirects) is never trusted.
 */
export const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * An origin the configuration may list: `https://host[:port]` exactly as a browser serialises it, or
 * `http://` only for this machine (local development).
 */
export function isAllowedOriginValue(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return (
    (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
    url.origin === value &&
    // A host name or an address literal: no wildcard or other pattern.
    /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/.test(
      url.hostname,
    ) &&
    url.username === "" &&
    url.password === ""
  );
}

/** Parses `WS_ALLOWED_ORIGINS` (comma-separated); undefined when an entry is not a valid origin. */
export function parseAllowedOrigins(value: string): ReadonlySet<string> | undefined {
  const entries = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (entries.length === 0 || !entries.every(isAllowedOriginValue)) return undefined;
  return new Set(entries);
}

/** Origins of the web app's own dev and preview servers (Vite), the default outside staging and production. */
export const LOCAL_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
]);

/** Does this request pass the Origin check? Reads always do; writes only from an allowed origin (or none). */
export function originAllowed(request: FastifyRequest, allowed: ReadonlySet<string>): boolean {
  if (!WRITE_METHODS.has(request.method)) return true;
  const origin = request.headers.origin;
  if (origin === undefined) {
    const site = request.headers["sec-fetch-site"];
    return site === undefined || site === "same-origin" || site === "none";
  }
  // Several Origin headers, an empty one or `null`: not a single trusted origin.
  return typeof origin === "string" && origin !== "null" && allowed.has(origin);
}
