import type { CategorySource } from "../domain/index.ts";

/**
 * The hand-off of a change of a transaction's category to the audit log (BUD-01@PoC «кожна зміна категорії … пишеться
 * в журнал аудиту»; ARC-04 FR 2, FR 3; ADR-0015). The audit log has its own database role, so no transaction spans both
 * (ADR-0002): the categorization transaction writes the row and this job together, and the entry follows once it has
 * committed — right away by the request, and by the worker from the categorization queue (job
 * `categorization.hand-off`) if that failed. Until then the category is set without its entry — never the other way
 * round. The entry is keyed by the row's version, so both runs write it once.
 *
 * The job carries the entry's values: category ids and source codes, no personal data, nothing to mask.
 */
export interface CategoryHandOff {
  readonly transactionId: string;
  readonly actorAccountId: string;
  /** The row's version after the change: the key of its job and of its audit entry. */
  readonly version: number;
  readonly before: { readonly categoryId: string | null; readonly source: CategorySource };
  readonly after: { readonly categoryId: string | null; readonly source: CategorySource };
}

/** The job's key (the queue's `dedupe_key`): one hand-off per version of a transaction's category. */
export function handOffKey(handOff: Pick<CategoryHandOff, "transactionId" | "version">): string {
  return `set:${handOff.transactionId}:${handOff.version}`;
}

/** The audit entry's key (ARC-04 FR 3). */
export function auditKey(handOff: Pick<CategoryHandOff, "transactionId" | "version">): string {
  return `categorization.${handOffKey(handOff)}`;
}

/** The space's audit log as the hand-off writes it (П-10). */
export interface CategoryAudit {
  record(householdId: string, handOff: CategoryHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(
  audit: CategoryAudit,
  householdId: string,
  handOff: CategoryHandOff,
): Promise<void> {
  return audit.record(householdId, handOff, auditKey(handOff));
}
