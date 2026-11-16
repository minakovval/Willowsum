import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { categoryMerged } from "../../../categories/index.ts";
import {
  AUDIT_ENTITIES,
  HAND_OFF_ACTIONS,
  handOffKey,
  type RecurringHandOff,
} from "../../application/index.ts";

const value = z.string().max(400).nullable();

/** The payload of `recurring.hand-off` (application/payments.ts `RecurringHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  entity: z.enum(AUDIT_ENTITIES),
  entityId: z.uuid(),
  actorAccountId: z.uuid().nullable(),
  action: z.enum(HAND_OFF_ACTIONS),
  changeId: z.uuid(),
  changes: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
      }),
    )
    // The thirteen fields of a payment at most.
    .max(20),
}) satisfies z.ZodType<RecurringHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a recurring change to the audit log, in the recurring queue
 * (migrations/0003_queue.sql). Light; retried up to 8 times, then dead-lettered (ADR-0014) and put back daily
 * (`recurring.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "recurring.hand-off", schema: handOffSchema });

/**
 * BUD-01 FR 8: «Категорію об'єднано» of module categories (`categories.merged` v1), one job per merge — the space's
 * payments of the merged category get the target. Light; dead jobs go back daily with the hand-offs.
 */
export const CATEGORY_MERGED_JOB = defineJob({
  name: "recurring.category-merged",
  schema: categoryMerged.schema,
});

/** Enqueues the hand-off in the caller's recurring transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: RecurringHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
