import { z } from "zod";
import { defineProviderPort } from "../port.ts";

/**
 * Port of the erasure-request log (NFR-16@PoC FR 9, NFR-12@PoC FR 3; ADR-0013). Kept outside the main database —
 * in the deployed profile an object store in another EU region with a retention lock — so that after a restore
 * every erasure made after the copy is applied again. Append-only. A record holds only opaque ids and times: no
 * address, name or data of the person (the log outlives the data it erases).
 */
export const ERASURE_LOG_PORT = defineProviderPort("erasure-log", {
  // Not safe to repeat blindly: a retry after a timeout could add the record twice.
  append: { idempotent: false, fields: ["record"], path: "records" },
  records: { idempotent: true, fields: [], path: "records" },
});

const uuid = z.uuid();
const instant = z.iso.datetime();

export const erasureLogRecord = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("requested"),
      requestId: uuid,
      accountId: uuid,
      householdIds: z.array(uuid).max(100),
      at: instant,
      /** The deadline (NFR-12 FR 3: within 30 days of the request). */
      dueAt: instant,
    })
    .strict(),
  z
    .object({
      kind: z.literal("completed"),
      requestId: uuid,
      accountId: uuid,
      householdIds: z.array(uuid).max(100),
      at: instant,
    })
    .strict(),
]);

export type ErasureLogRecord = z.infer<typeof erasureLogRecord>;

export interface ErasureLog {
  append(record: ErasureLogRecord): Promise<void>;
  /** Every record, oldest first; refuses a log whose chain is broken. */
  records(): Promise<ErasureLogRecord[]>;
}
