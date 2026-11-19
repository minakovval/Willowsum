import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { HAND_OFF_ACTIONS, handOffKey, type RecipeHandOff } from "../../application/index.ts";

// Versions and counts only: never a recipe's name or rules.
const value = z.string().max(64).nullable();

/** The payload of `import-recipes.hand-off` (application/recipes.ts `RecipeHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  entityId: z.uuid(),
  actorAccountId: z.uuid(),
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
    .max(4),
}) satisfies z.ZodType<RecipeHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a recipe's change to the audit log, in the import-recipes queue
 * (migrations/0002_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered (ADR-0014) and put
 * back daily (`import-recipes.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "import-recipes.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's import-recipes transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: RecipeHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
