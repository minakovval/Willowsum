import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import {
  BUDGET_AUDIT_ENTITIES,
  BUDGET_HAND_OFF_ACTIONS,
  handOffKey,
  type BudgetHandOff,
} from "../../application/index.ts";

const value = z.string().max(400).nullable();

/** The payload of `budget.hand-off` (application/budget.ts `BudgetHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  entity: z.enum(BUDGET_AUDIT_ENTITIES),
  entityId: z.uuid(),
  actorAccountId: z.uuid(),
  action: z.enum(BUDGET_HAND_OFF_ACTIONS),
  changeId: z.uuid(),
  changes: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
      }),
    )
    .max(10),
}) satisfies z.ZodType<BudgetHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a budget change to the audit log, in the budget queue (the schema's `jobs`,
 * migrations/0003_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered (ADR-0014) and put
 * back daily (`budget.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "budget.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's budget transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: BudgetHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
