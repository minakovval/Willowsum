import { handOffKey, type BatchHandOff } from "./batches.ts";

/** The space's audit log as the import-sessions hand-off writes it (FR 21, П-10). */
export interface BatchesAudit {
  record(householdId: string, handOff: BatchHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(audit: BatchesAudit, householdId: string, handOff: BatchHandOff): Promise<void> {
  return audit.record(householdId, handOff, handOffKey(handOff));
}
