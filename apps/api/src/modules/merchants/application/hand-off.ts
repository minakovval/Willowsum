/**
 * The hand-off of a change of a merchant to the audit log (BUD-14@PoC «Обов'язково пишуться в журнал аудиту: …
 * перейменування й об'єднання мерчантів»; ARC-04 FR 2, FR 3; ADR-0015). The audit log has its own database role, so no
 * transaction spans both (ADR-0002): the merchants transaction writes the row and this job together, and the entry
 * follows once it has committed — right away by the request, and by the worker from the merchants queue (job
 * `merchants.hand-off`) if that failed. The entry is keyed by the row's version, so both runs write it once.
 *
 * The job carries identifiers only: a merchant's name comes from a bank description and may name a person, so a rename
 * is recorded as a masked change of «name» (П-10), never with the names.
 */
export interface MerchantHandOff {
  readonly merchantId: string;
  readonly actorAccountId: string;
  /** The row's version after the change: the key of its job and of its audit entry. */
  readonly version: number;
  /** «Перейменувати мерчанта», «Об'єднати з…», «Роз'єднати». */
  readonly change: "rename" | "merge" | "unmerge";
  /** The merchant it joined before and after (a merge, «Роз'єднати»); both null for a rename. */
  readonly mergedInto: { readonly before: string | null; readonly after: string | null };
}

/** The job's key (the queue's `dedupe_key`): one hand-off per version of a merchant. */
export function handOffKey(handOff: Pick<MerchantHandOff, "merchantId" | "version">): string {
  return `set:${handOff.merchantId}:${handOff.version}`;
}

/** The audit entry's key (ARC-04 FR 3). */
export function auditKey(handOff: Pick<MerchantHandOff, "merchantId" | "version">): string {
  return `merchants.${handOffKey(handOff)}`;
}

/** The space's audit log as the hand-off writes it (П-10). */
export interface MerchantAudit {
  record(householdId: string, handOff: MerchantHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(
  audit: MerchantAudit,
  householdId: string,
  handOff: MerchantHandOff,
): Promise<void> {
  return audit.record(householdId, handOff, auditKey(handOff));
}
