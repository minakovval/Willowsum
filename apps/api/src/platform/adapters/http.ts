import { ProviderError } from "./errors.ts";
import { assertOutgoing } from "./outgoing.ts";
import { pathPlaceholders, pathTemplateProblems, type ProviderOperation } from "./port.ts";
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
  /**
   * GET like `getJson`, but `parse` receives the body as text: for an answer whose JSON numbers must not
   * become floats (a provider that sends rates as JSON numbers reads them from the source text).
   */
  getText<T>(
    operation: ProviderOperation,
    values: Readonly<Record<string, string>>,
    parse: (text: string) => T,
  ): Promise<T>;
  /**
   * POST a JSON body to the operation's path. `pathValues` fill its placeholders only; `body` holds the other
   * outgoing fields. Both are checked against the operation before anything is sent.
   */
  postJson<T = unknown>(
    operation: ProviderOperation,
    pathValues: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
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
  // An operation may be built by hand (the type allows it): its template is checked here too.
  if (pathTemplateProblems(operation.path, operation.fields).length > 0)
    throw new Error("Provider operation path is not a valid template");
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
  const send = <T>(
    operation: ProviderOperation,
    url: URL,
    init: { method: "GET" | "POST"; body?: string; text?: boolean },
    parse?: (body: unknown) => T,
  ): Promise<T> => {
    const fail = (kind: "unavailable" | "rejected" | "invalid-response", cause?: string) =>
      new ProviderError(kind, client.provider, operation.name, cause);
    return client.call(operation, async (signal) => {
      const fetchFn = options.fetch ?? ((request: Request) => globalThis.fetch(request));
      let response: Response;
      try {
        response = await fetchFn(
          new Request(url, {
            method: init.method,
            // A redirect (to http:// or another host) is never followed: a 3xx is «rejected».
            redirect: "manual",
            headers: {
              accept: "application/json",
              ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
              ...options.headers,
            },
            ...(init.body !== undefined ? { body: init.body } : {}),
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
        body = init.text ? await response.text() : await response.json();
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
  };
  return {
    async getJson<T>(
      operation: ProviderOperation,
      values: Readonly<Record<string, string>>,
      parse?: (body: unknown) => T,
    ): Promise<T> {
      // Both checks run before client.call: nothing is sent and the breaker is untouched.
      assertOutgoing(client.provider, operation, values);
      return send(operation, requestUrl(base, operation, values), { method: "GET" }, parse);
    },
    async getText<T>(
      operation: ProviderOperation,
      values: Readonly<Record<string, string>>,
      parse: (text: string) => T,
    ): Promise<T> {
      assertOutgoing(client.provider, operation, values);
      return send(operation, requestUrl(base, operation, values), { method: "GET", text: true }, (body) =>
        parse(body as string),
      );
    },
    async postJson<T>(
      operation: ProviderOperation,
      pathValues: Readonly<Record<string, string>>,
      body: Readonly<Record<string, unknown>>,
      parse?: (body: unknown) => T,
    ): Promise<T> {
      // Path placeholders and body fields are both outgoing fields of the operation (FR 5).
      assertOutgoing(client.provider, operation, { ...pathValues, ...body });
      const url = requestUrl(base, operation, pathValues);
      // Only the template's placeholders may sit in the URL of a POST: anything else would become a query.
      if (url.search !== "") throw new Error("A POST sends its fields in the body, not in the query");
      return send(operation, url, { method: "POST", body: JSON.stringify(body) }, parse);
    },
  };
}
