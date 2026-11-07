import { ProviderError } from "./errors.ts";
import { assertOutgoing } from "./outgoing.ts";
import { pathPlaceholders, type ProviderOperation } from "./port.ts";
import type { ProviderClient } from "./provider-client.ts";

/**
 * HTTP transport for working adapters without a provider SDK (ADR-0005): the global `fetch` (or an injected
 * one in tests), under the client's time limit, retries and breaker. Outgoing fields are checked against the
 * operation before anything is sent (ARC-05 FR 5). The path is the operation's declared template, filled
 * only from declared fields, and the request never leaves the base URL or follows a redirect. Outcomes map to
 * failure kinds: a transport failure, 429 and 5xx → `unavailable` (retryable), 3xx and other 4xx → `rejected`,
 * a body that is not JSON or that `parse` refuses → `invalid-response` (counted by the breaker, as `parse`
 * runs inside the call).
 */
export type FetchFn = (input: Request) => Promise<Response>;

export interface ProviderHttpOptions {
  /** `https://…`; plain `http://` only for localhost (a local stand-in). */
  readonly baseUrl: string;
  readonly client: ProviderClient;
  readonly fetch?: FetchFn;
  /** Extra headers (e.g. an API key from a secret). Not checked as fields: they carry no user data. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ProviderHttp {
  /**
   * GET the operation's path. `values` are the outgoing fields: path placeholders take theirs, the rest become
   * query parameters. `parse` checks the answer inside the call; anything it throws is `invalid-response`.
   */
  getJson<T = unknown>(
    operation: ProviderOperation,
    values: Readonly<Record<string, string>>,
    parse?: (body: unknown) => T,
  ): Promise<T>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function checkBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Provider base URL is not a URL");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username !== "" || url.password !== "")
    throw new Error("Provider base URL must use https (http only for localhost), without credentials");
  if (url.search !== "" || url.hash !== "") throw new Error("Provider base URL has no query or fragment");
  return url;
}

/**
 * The request URL: the operation's template with encoded values, always below the base URL (a call cannot
 * change scheme, host or base path). A value of `.` or `..` or an empty one is refused.
 */
export function requestUrl(
  base: URL,
  operation: ProviderOperation,
  values: Readonly<Record<string, string>>,
): URL {
  const root = base.href.endsWith("/") ? base : new URL(`${base.href}/`);
  const used = new Set(pathPlaceholders(operation.path));
  const relative = operation.path
    .split("/")
    .map((segment) => {
      const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(segment);
      if (!m) return segment;
      const value = values[m[1]!];
      if (value === undefined || value === "" || value === "." || value === "..")
        throw new Error(`Provider path value for {${m[1]}} is missing or not a plain segment`);
      return encodeURIComponent(value);
    })
    .join("/");
  const url = new URL(relative, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    throw new Error("Provider path leaves the base URL");
  for (const [name, value] of Object.entries(values)) if (!used.has(name)) url.searchParams.set(name, value);
  return url;
}

export function createProviderHttp(options: ProviderHttpOptions): ProviderHttp {
  const base = checkBaseUrl(options.baseUrl);
  const { client } = options;
  return {
    async getJson<T>(
      operation: ProviderOperation,
      values: Readonly<Record<string, string>>,
      parse?: (body: unknown) => T,
    ): Promise<T> {
      // Both checks run before client.call: nothing is sent and the breaker is untouched.
      assertOutgoing(client.provider, operation, values);
      const url = requestUrl(base, operation, values);
      const fail = (kind: "unavailable" | "rejected" | "invalid-response", cause?: string) =>
        new ProviderError(kind, client.provider, operation.name, cause);
      return client.call(operation, async (signal) => {
        const fetchFn = options.fetch ?? ((request: Request) => globalThis.fetch(request));
        let response: Response;
        try {
          response = await fetchFn(
            new Request(url, {
              method: "GET",
              // A redirect (to http:// or another host) is never followed: a 3xx is «rejected».
              redirect: "manual",
              headers: { accept: "application/json", ...options.headers },
              signal,
            }),
          );
        } catch (error) {
          // The transport failed (DNS, refused, TLS, reset, abort): the provider was not reached.
          throw fail("unavailable", error instanceof Error ? error.name : typeof error);
        }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          throw fail("unavailable", `HTTP ${response.status}`);
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw fail("rejected", `HTTP ${response.status}`);
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw fail("invalid-response");
        }
        if (!parse) return body as T;
        try {
          return parse(body);
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw fail("invalid-response");
        }
      });
    },
  };
}
