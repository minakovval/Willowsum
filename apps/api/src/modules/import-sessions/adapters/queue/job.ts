import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { HAND_OFF_ACTIONS, handOffKey, type BatchHandOff } from "../../application/index.ts";

// States, counts, formats and reason codes only: never a file's name or content (IMP-01 FR 19).
const value = z.string().max(64).nullable();

/** The payload of `import-sessions.hand-off` (application/batches.ts `BatchHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
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
    .max(4),
}) satisfies z.ZodType<BatchHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a batch's change to the audit log (IMP-01 FR 21), in the import-sessions queue
 * (migrations/0002_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered (ADR-0014) and put
 * back daily (`import-sessions.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "import-sessions.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's import-sessions transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: BatchHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
