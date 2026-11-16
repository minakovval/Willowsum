import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { handOffKey, type MerchantHandOff } from "../../application/index.ts";

/** The payload of `merchants.hand-off` (application/hand-off.ts), checked when enqueued and run: no names. */
const handOffSchema = z.strictObject({
  merchantId: z.uuid(),
  actorAccountId: z.uuid(),
  version: z.number().int().min(1),
  change: z.enum(["rename", "merge", "unmerge"]),
  mergedInto: z.strictObject({ before: z.uuid().nullable(), after: z.uuid().nullable() }),
}) satisfies z.ZodType<MerchantHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a change of a merchant to the audit log, in the merchants queue
 * (migrations/0002_queue.sql). Light; retried up to 8 times, then dead-lettered (ADR-0014) and put back daily
 * (`merchants.recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "merchants.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's merchants transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: MerchantHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
