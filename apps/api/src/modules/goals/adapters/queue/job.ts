import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { entryRecorded } from "../../../ledger/index.ts";
import {
  GOAL_AUDIT_ENTITIES,
  GOAL_HAND_OFF_ACTIONS,
  handOffKey,
  type GoalHandOff,
} from "../../application/index.ts";

const value = z.string().max(400).nullable();

/** The payload of `goals.hand-off` (application/goals.ts `GoalHandOff`), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  entity: z.enum(GOAL_AUDIT_ENTITIES),
  entityId: z.uuid(),
  actorAccountId: z.uuid().nullable(),
  action: z.enum(GOAL_HAND_OFF_ACTIONS),
  changeId: z.uuid(),
  changes: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
        before: value,
        after: value,
      }),
    )
    // The nine fields of a goal at most.
    .max(20),
}) satisfies z.ZodType<GoalHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a goals change to the audit log, in the goals queue (the schema's `jobs`,
 * migrations/0003_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered (ADR-0014) and put
 * back daily (`goals.hand-off-recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "goals.hand-off", schema: handOffSchema });

/**
 * AC5, edge case 5: «Проводку записано» of module ledger (`ledger.entry-recorded` v1), one job per event (its id is the
 * key). A reversal of a transaction's event — the transaction changed or deleted by hand or by a repeated import —
 * cancels the spends made on the reversed event. Light; dead jobs go back daily with the hand-offs.
 */
export const ENTRY_RECORDED_JOB = defineJob({ name: "goals.entry-recorded", schema: entryRecorded.schema });

/**
 * #306 item 2: the check of a new spend's journal event, enqueued with the spend: if the transaction's event is no
 * longer in effect (changed or deleted while the spend was saved), the spend is cancelled. Light; dead jobs go back daily.
 */
export const SPEND_CHECK_JOB = defineJob({
  name: "goals.spend-check",
  schema: z.strictObject({ transactionId: z.uuid(), entryId: z.uuid() }),
});

/** Enqueues the spend's check in the caller's goals transaction; the same entry twice is one job. */
export async function enqueueSpendCheck(
  q: HouseholdQueryRunner,
  check: { readonly transactionId: string; readonly entryId: string },
): Promise<void> {
  await enqueueJob(q, SPEND_CHECK_JOB, `spend-check:${check.entryId}`, check);
}

/** Enqueues the hand-off in the caller's goals transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: GoalHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}
