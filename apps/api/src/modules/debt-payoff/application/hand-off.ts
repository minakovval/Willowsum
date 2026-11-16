import { handOffKey, type PlanHandOff } from "./payoff.ts";

/** The space's audit log as the debt-payoff hand-off writes it (П-10). */
export interface PlansAudit {
  record(householdId: string, handOff: PlanHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(audit: PlansAudit, householdId: string, handOff: PlanHandOff): Promise<void> {
  return audit.record(householdId, handOff, handOffKey(handOff));
}
