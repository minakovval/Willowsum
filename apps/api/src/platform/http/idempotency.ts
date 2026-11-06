import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ModuleDatabase } from "../db/module-db.ts";

/**
 * Idempotency keys on create requests (ARC-07 FR 4). The key is stored per household and key together
 * with a hash of the request: the same key with the same request returns the stored response; the same key
 * with a different request is 409 IDEMPOTENCY_KEY_REUSED; while the first request still runs, 409
 * IDEMPOTENCY_REQUEST_IN_PROGRESS. A key lives IDEMPOTENCY_TTL_HOURS; after that it may be used again.
 *
 * Flow: `begin` reserves the key (state «pending») in its own transaction, the handler runs, `complete`
 * stores the response. A handler that fails releases the key (`abandon`), so a retry runs again. A process
 * that dies between the handler and `complete` leaves the key «pending» until it expires: a retry then
 * gets 409, never a second create.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotent-Replayed";
export const IDEMPOTENCY_TTL_HOURS = 24;
/** 1–128 visible ASCII characters (a UUID from the client is the usual choice). */
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,128}$/;

/** The migration every module with create routes adds to its schema, verbatim. */
export const IDEMPOTENCY_TABLE_SQL = readFileSync(new URL("./idempotency-keys.sql", import.meta.url), "utf8");

export type IdempotencyBegin =
  | { readonly kind: "new" }
  | { readonly kind: "replay"; readonly status: number; readonly body: string }
  | { readonly kind: "mismatch" }
  | { readonly kind: "in-progress" };

export interface IdempotencyStore {
  begin(householdId: string, key: string, requestHash: string): Promise<IdempotencyBegin>;
  complete(householdId: string, key: string, status: number, body: string): Promise<void>;
  abandon(householdId: string, key: string): Promise<void>;
}

/** JSON with object keys sorted, so the same request in another key order has the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 (hex) of the operation and its validated input. */
export function requestHash(
  operationId: string,
  input: { params: unknown; query: unknown; body: unknown },
): string {
  return createHash("sha256")
    .update(canonicalJson({ operationId, params: input.params, query: input.query, body: input.body }))
    .digest("hex");
}

/** The store in the route's own module schema (table `idempotency_keys`, IDEMPOTENCY_TABLE_SQL). */
export function moduleIdempotencyStore(db: ModuleDatabase): IdempotencyStore {
  return {
    begin: (householdId, key, hash) =>
      db.inHousehold(householdId, async (q) => {
        // A new key, or an expired one, is (re)reserved; a live one is left as it is and read below.
        const reserved = await q.query(
          `INSERT INTO idempotency_keys (household_id, key, request_hash, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(hours => $4))
           ON CONFLICT (household_id, key) DO UPDATE
             SET request_hash = EXCLUDED.request_hash, state = 'pending', response_status = NULL,
                 response_body = NULL, created_at = now(), expires_at = EXCLUDED.expires_at
             WHERE idempotency_keys.expires_at <= now()
           RETURNING 1`,
          [q.householdId, key, hash, IDEMPOTENCY_TTL_HOURS],
        );
        if (reserved.rowCount === 1) return { kind: "new" } as const;
        const { rows } = await q.query<{
          request_hash: string;
          state: string;
          response_status: number | null;
          response_body: string | null;
        }>(
          `SELECT request_hash, state, response_status, response_body FROM idempotency_keys
            WHERE household_id = $1 AND key = $2`,
          [q.householdId, key],
        );
        const row = rows[0];
        if (!row) throw new Error("idempotency key vanished while it was read");
        if (row.request_hash !== hash) return { kind: "mismatch" } as const;
        if (row.state !== "done" || row.response_status === null || row.response_body === null) {
          return { kind: "in-progress" } as const;
        }
        return { kind: "replay", status: row.response_status, body: row.response_body } as const;
      }),
    complete: (householdId, key, status, body) =>
      db.inHousehold(householdId, async (q) => {
        await q.query(
          `UPDATE idempotency_keys SET state = 'done', response_status = $3, response_body = $4
            WHERE household_id = $1 AND key = $2 AND state = 'pending'`,
          [q.householdId, key, status, body],
        );
      }),
    abandon: (householdId, key) =>
      db.inHousehold(householdId, async (q) => {
        await q.query(
          `DELETE FROM idempotency_keys WHERE household_id = $1 AND key = $2 AND state = 'pending'`,
          [q.householdId, key],
        );
      }),
  };
}
