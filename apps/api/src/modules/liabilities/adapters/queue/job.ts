import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { handOffKey, LIABILITY_HAND_OFF_ACTIONS, type LiabilityHandOff } from "../../application/index.ts";

const value = z.string().max(200).nullable();

/** The payload of `liabilities.hand-off` (application/hand-off.ts `LiabilityHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  liabilityId: z.uuid(),
  actorAccountId: z.uuid(),
  action: z.enum(LIABILITY_HAND_OFF_ACTIONS),
  changeId: z.uuid(),
  changes: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
      }),
    )
    // The account, the kind, the currency and four terms.
    .max(20),
}) satisfies z.ZodType<LiabilityHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a liabilities change to the audit log, in the liabilities queue (the schema's
 * `jobs`, migrations/0003_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered with an
 * «error» log event (ADR-0014) and put back daily (`liabilities.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "liabilities.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's liabilities transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: LiabilityHandOff): Promise<void> {
  // The schema checks the payload again here; the application's type is readonly, the schema's output is not.
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
