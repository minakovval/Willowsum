import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { categoryMerged } from "../../../categories/index.ts";
import { handOffKey, type CategoryHandOff } from "../../application/index.ts";
import { CATEGORY_SOURCES } from "../../domain/index.ts";

const side = z.strictObject({ categoryId: z.uuid().nullable(), source: z.enum(CATEGORY_SOURCES) });

/** The payload of `categorization.hand-off` (application/hand-off.ts), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  transactionId: z.uuid(),
  actorAccountId: z.uuid(),
  version: z.number().int().min(1),
  before: side,
  after: side,
}) satisfies z.ZodType<CategoryHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a change of a transaction's category to the audit log, in the categorization
 * queue (migrations/0002_queue.sql). Light; retried up to 8 times, then dead-lettered (ADR-0014) and put back daily
 * (`categorization.recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "categorization.hand-off", schema: handOffSchema });

/**
 * BUD-01 FR 8: «Категорію об'єднано» of module categories (`categories.merged` v1), one job per event (its id is the
 * key): the transactions of the merged category take the target.
 */
export const CATEGORY_MERGED_JOB = defineJob({
  name: "categorization.category-merged",
  schema: categoryMerged.schema,
});

/** Enqueues the hand-off in the caller's categorization transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: CategoryHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
