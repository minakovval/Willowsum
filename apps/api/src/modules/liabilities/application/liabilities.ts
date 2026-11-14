import type { Money } from "@willowsum/domain-kernel";
import {
  checkTerms,
  termsAsKind,
  type LiabilityKind,
  type LiabilityTermsInput,
  type TermsIssue,
} from "../domain/index.ts";

/**
 * Registering a liability for an account (FIN-01@PoC FR 2, FR 16): a loan or a credit card of the `accounts` module,
 * by the account's id. One liability per account; registering it again returns the one there. The audit entry is
 * written inside the transaction, before it commits (П-10): a failed audit write leaves no liability behind.
 */
export interface Liability {
  readonly id: string;
  /** The `accounts` record this liability belongs to (its debt is that account's ledger balance). */
  readonly accountId: string;
  readonly kind: LiabilityKind;
  readonly currency: string;
  readonly annualRate: string | null;
  readonly monthlyPayment: Money | null;
  readonly creditLimit: Money | null;
  readonly gracePeriodDays: number | null;
}

/** One transaction of the liabilities schema, bound to the caller's space. */
export interface LiabilitiesTx {
  /** Inserts the liability unless the account has one; true when inserted. */
  insert(householdId: string, liability: Liability): Promise<boolean>;
  byAccount(householdId: string, accountId: string): Promise<Liability | null>;
  /** The account's liability, locked until the transaction ends. */
  lockByAccount(householdId: string, accountId: string): Promise<Liability | null>;
  /** Replaces the kind and terms of the liability with this id. */
  update(householdId: string, liability: Liability): Promise<void>;
}

/** The space's audit log (П-10): who registered which terms. */
export interface LiabilityAudit {
  liabilityCreated(householdId: string, actorAccountId: string, liability: Liability): Promise<void>;
  /** «Кредит» ↔ «Кредитна картка» (FIN-12@PoC FR 5, FR 6): the kind and every term before and after. */
  liabilityChanged(
    householdId: string,
    actorAccountId: string,
    before: Liability,
    after: Liability,
  ): Promise<void>;
}

export type RegisterResult =
  | { readonly kind: "registered"; readonly liability: Liability }
  | { readonly kind: "invalid"; readonly issues: readonly TermsIssue[] };

export async function registerLiability(
  deps: { readonly audit: LiabilityAudit; readonly newId: () => string },
  tx: LiabilitiesTx,
  householdId: string,
  input: { readonly actorAccountId: string; readonly accountId: string; readonly terms: LiabilityTermsInput },
): Promise<RegisterResult> {
  const checked = checkTerms(input.terms);
  if ("issues" in checked) return { kind: "invalid", issues: checked.issues };
  const liability: Liability = { id: deps.newId(), accountId: input.accountId, ...checked.terms };
  if (!(await tx.insert(householdId, liability))) {
    const existing = await tx.byAccount(householdId, input.accountId);
    if (!existing) throw new Error("liability vanished after a conflicting insert");
    return { kind: "registered", liability: existing };
  }
  await deps.audit.liabilityCreated(householdId, input.actorAccountId, liability);
  return { kind: "registered", liability };
}

export type ChangeKindResult =
  { readonly kind: "changed" | "unchanged"; readonly liability: Liability } | { readonly kind: "not-found" };

/**
 * «Кредит» ↔ «Кредитна картка» of the account (FIN-12@PoC FR 5): the liability's kind with the terms the new kind may
 * have (`termsAsKind`); whether the account has transactions is the caller's check (`accounts`). The same kind again
 * changes nothing and writes nothing, so a retry after a failure later in the caller's change finishes it. Audited in
 * this transaction, before it commits.
 */
export async function changeLiabilityKind(
  deps: { readonly audit: LiabilityAudit },
  tx: LiabilitiesTx,
  householdId: string,
  input: { readonly actorAccountId: string; readonly accountId: string; readonly kind: LiabilityKind },
): Promise<ChangeKindResult> {
  const before = await tx.lockByAccount(householdId, input.accountId);
  if (!before) return { kind: "not-found" };
  if (before.kind === input.kind) return { kind: "unchanged", liability: before };
  const after = termsAsKind(before, input.kind);
  await tx.update(householdId, after);
  await deps.audit.liabilityChanged(householdId, input.actorAccountId, before, after);
  return { kind: "changed", liability: after };
}
