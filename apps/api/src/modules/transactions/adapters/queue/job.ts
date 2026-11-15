import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { HAND_OFF_ACTIONS, handOffKey, type TransactionHandOff } from "../../application/index.ts";

const value = z.string().max(1000).nullable();

/** The payload of `transactions.hand-off` (application/hand-off.ts `TransactionHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  transactionId: z.uuid(),
  actorAccountId: z.uuid(),
  action: z.enum(HAND_OFF_ACTIONS),
  version: z.number().int().min(1),
  transferId: z.uuid().optional(),
  audit: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
        sensitive: z.boolean(),
      }),
    )
    // The form's fields, «прихована», and a split's mode and parts (up to 60 shares of «На кілька місяців»).
    .max(100),
}) satisfies z.ZodType<TransactionHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a transactions change to the journal and the audit log, in the transactions queue
 * (the schema's `jobs`, migrations/0003_queue.sql). Light; the worker retries it up to 8 times, then it is
 * dead-lettered with an «error» log event (ADR-0014) and put back daily (`transactions.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "transactions.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's transactions transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: TransactionHandOff): Promise<void> {
  // The schema checks the payload again here; the application's type is readonly, the schema's output is not.
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
