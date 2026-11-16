import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { handOffKey, PLAN_HAND_OFF_ACTIONS, type PlanHandOff } from "../../application/index.ts";

const value = z.string().max(2000).nullable();

/** The payload of `debt-payoff.hand-off` (application/payoff.ts `PlanHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  entityId: z.uuid(),
  actorAccountId: z.uuid(),
  action: z.enum(PLAN_HAND_OFF_ACTIONS),
  changeId: z.uuid(),
  changes: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
      }),
    )
    // The eleven fields of a plan.
    .max(20),
}) satisfies z.ZodType<PlanHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a plan's change to the audit log, in the debt-payoff queue (the schema's `jobs`,
 * migrations/0002_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered (ADR-0014) and put
 * back daily (`debt-payoff.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "debt-payoff.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's debt-payoff transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: PlanHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
