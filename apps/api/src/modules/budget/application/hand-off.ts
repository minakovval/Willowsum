import { handOffKey, type BudgetHandOff } from "./budget.ts";

/** The space's audit log as the budget hand-off writes it (П-10). */
export interface BudgetAudit {
  record(householdId: string, handOff: BudgetHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(audit: BudgetAudit, householdId: string, handOff: BudgetHandOff): Promise<void> {
  return audit.record(householdId, handOff, handOffKey(handOff));
}
