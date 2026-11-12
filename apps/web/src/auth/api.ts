import { createContext, useContext } from "react";
import {
  createApiClient,
  isProblem,
  problemSupportCode,
  type ApiClient,
  type Problem,
} from "@willowsum/api-contract";

/**
 * The identity calls of the sign-up, confirmation and sign-in screens (ACC-01@PoC, ADR-0009) through the typed
 * client of the contract. The API lives on the web app's own origin (`/v1/…`; the CSP allows `connect-src 'self'`
 * only, NFR-14), so the client needs no address of its own. Tests inject a client with a fake `fetch`.
 */
export function createAuthClient(fetchImpl?: typeof fetch): ApiClient {
  return createApiClient({
    baseUrl: window.location.origin,
    credentials: "same-origin",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

const ApiContext = createContext<ApiClient | null>(null);
export const AuthApiProvider = ApiContext.Provider;

let defaultClient: ApiClient | undefined;
export function useAuthApi(): ApiClient {
  const injected = useContext(ApiContext);
  if (injected) return injected;
  defaultClient ??= createAuthClient();
  return defaultClient;
}

/** What a screen needs to know about an answer. */
export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly kind: "problem";
      readonly problem: Problem;
      /** Seconds from `Retry-After` (429), when the server sent it. */
      readonly retryAfterS?: number;
      /** The problem's `supportId` (ARC-09 FR 3), shown as «Код: …». */
      readonly supportId?: string;
    }
  | { readonly ok: false; readonly kind: "network" };

/** The function is switched off (flag `identity.sign-in`: 404 as an unknown path) or its module is (503). */
export const isUnavailable = (o: Outcome<unknown>): boolean =>
  !o.ok &&
  o.kind === "problem" &&
  (o.problem.code === "NOT_FOUND" || o.problem.code === "MODULE_UNAVAILABLE");

function retryAfter(response: Response | undefined): number | undefined {
  const raw = response?.headers.get("retry-after");
  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

/** Turns an openapi-fetch call into an outcome; a failed connection is `network`, never an exception. */
export async function outcome<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<Outcome<T>> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    return { ok: false, kind: "network" };
  }
  if (result.data !== undefined && result.response.ok) return { ok: true, data: result.data };
  const problem: Problem = isProblem(result.error)
    ? result.error
    : {
        type: "about:blank",
        title: result.response.statusText,
        status: result.response.status,
        code: result.response.status === 404 ? "NOT_FOUND" : "INTERNAL",
      };
  const retryAfterS = retryAfter(result.response);
  const supportId = problemSupportCode(result.error);
  return {
    ok: false,
    kind: "problem",
    problem,
    ...(retryAfterS !== undefined ? { retryAfterS } : {}),
    ...(supportId !== undefined ? { supportId } : {}),
  };
}
