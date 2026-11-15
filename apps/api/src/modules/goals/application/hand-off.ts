import { auditKey, type GoalHandOff } from "./goals.ts";

/** The space's audit log as the goals hand-off writes it (П-10). */
export interface GoalsAudit {
  record(householdId: string, handOff: GoalHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(audit: GoalsAudit, householdId: string, handOff: GoalHandOff): Promise<void> {
  return audit.record(householdId, handOff, auditKey(handOff));
}
