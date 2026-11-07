/**
 * The typed client of the Willowsum API (ARC-07 FR 2, FR 5): generated from the committed OpenAPI
 * contract, shared by the web app, the admin panel and the mobile app. Clients call only the operations
 * the contract documents (NFR-05 FR 1): paths outside it do not type-check.
 */
import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { components, paths } from "./schema.ts";

export type { components, operations, paths } from "./schema.ts";

/** RFC 9457 problem details with a machine `code` (ARC-07 FR 4). */
export type Problem = components["schemas"]["Problem"];
export type ProblemCode = Problem["code"];
export type ApiClient = Client<paths>;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function createApiClient(options: ClientOptions = {}): ApiClient {
  return createClient<paths>(options);
}

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["code"] === "string" && typeof v["status"] === "number" && typeof v["type"] === "string";
}

/**
 * The error code a screen shows for a failed request (ARC-09 FR 3; CMP-24 «Код: …»): the problem's
 * `supportId`, the trace id the server drew for that request. Undefined when the answer is not a problem or
 * carries no id (then the screen shows no code).
 */
export function problemSupportCode(value: unknown): string | undefined {
  if (!isProblem(value)) return undefined;
  const id = (value as { supportId?: unknown }).supportId;
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id) ? id : undefined;
}

/** A fresh idempotency key for a create request; repeat it when retrying the same request. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
