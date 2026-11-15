/**
 * The hand-off of a liabilities change to the audit log (ARC-04 FR 2, FR 3; ADR-0015; issue #252 item 3, #263). The
 * audit log has its own database role, so no transaction spans both (ADR-0002); instead the liabilities transaction
 * writes the row and the hand-off job together (`LiabilitiesTx.enqueueHandOff`), and the audit entry follows only once
 * it has committed — right away, by the caller of `register` or `changeKind`, and by the worker from the liabilities
 * queue (job `liabilities.hand-off`) if that failed or the process ended. Until then the liability exists without its
 * audit entry — never the other way round. The entry is written once per key, so both runs write it once.
 *
 * The job carries the entry's values (the terms before and after: ids, codes, amounts and rates as decimal strings —
 * no personal data, nothing to mask), because a kind change's terms before are gone once it has committed.
 */
export interface LiabilityHandOff {
  readonly liabilityId: string;
  readonly actorAccountId: string;
  /** `create` — `register` (FIN-01 FR 2); `update` — «Кредит» ↔ «Кредитна картка» (FIN-12 FR 5). */
  readonly action: (typeof LIABILITY_HAND_OFF_ACTIONS)[number];
  /** New for each change: the key of its job and of its audit entry. */
  readonly changeId: string;
  readonly changes: readonly LiabilityAuditChange[];
}

export const LIABILITY_HAND_OFF_ACTIONS = ["create", "update"] as const;

export interface LiabilityAuditChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** The job's key (the queue's `dedupe_key`): one hand-off per liability created, one per kind change. */
export function handOffKey(handOff: LiabilityHandOff): string {
  return handOff.action === "create"
    ? `create:${handOff.liabilityId}`
    : `update:${handOff.liabilityId}:${handOff.changeId}`;
}

/** The audit entry's key (ARC-04 FR 3): written once per change. */
export function auditKey(handOff: LiabilityHandOff): string {
  return `liabilities.${handOffKey(handOff)}`;
}

/** The space's audit log as the hand-off writes it (П-10). */
export interface LiabilityAudit {
  record(householdId: string, handOff: LiabilityHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(
  audit: LiabilityAudit,
  householdId: string,
  handOff: LiabilityHandOff,
): Promise<void> {
  return audit.record(householdId, handOff, auditKey(handOff));
}
