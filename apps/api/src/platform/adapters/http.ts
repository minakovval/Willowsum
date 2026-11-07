import { ProviderError } from "./errors.ts";
import { assertOutgoing } from "./outgoing.ts";
import type { ProviderOperation } from "./port.ts";
import type { ProviderClient } from "./provider-client.ts";

/**
 * HTTP transport for working adapters without a provider SDK (ADR-0005): the global `fetch` (or an injected
 * one in tests), under the client's time limit, retries and breaker. Outgoing fields are checked against the
 * operation before anything is sent (ARC-05 FR 5). Statuses map to failure kinds: 429 and 5xx →
 * `unavailable` (retryable), other 4xx → `rejected`, a body that is not JSON → `invalid-response`.
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
  getJson(
    operation: ProviderOperation,
    path: string,
    query: Readonly<Record<string, string>>,
  ): Promise<unknown>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function checkBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Provider base URL is not a URL");
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url;
  throw new Error("Provider base URL must use https (http only for localhost)");
}

export function createProviderHttp(options: ProviderHttpOptions): ProviderHttp {
  const base = checkBaseUrl(options.baseUrl);
  const { client } = options;
  return {
    async getJson(operation, path, query) {
      assertOutgoing(client.provider, operation, query);
      const url = new URL(path.replace(/^\//, ""), base.href.endsWith("/") ? base : new URL(`${base.href}/`));
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      return client.call(operation, async (signal) => {
        const fetchFn = options.fetch ?? ((request: Request) => globalThis.fetch(request));
        const response = await fetchFn(
          new Request(url, {
            method: "GET",
            headers: { accept: "application/json", ...options.headers },
            signal,
          }),
        );
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          throw new ProviderError("unavailable", client.provider, operation.name, `HTTP ${response.status}`);
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError("rejected", client.provider, operation.name, `HTTP ${response.status}`);
        }
        try {
          return (await response.json()) as unknown;
        } catch {
          throw new ProviderError("invalid-response", client.provider, operation.name);
        }
      });
    },
  };
}
