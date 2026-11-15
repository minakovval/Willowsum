import type { Money } from "@willowsum/domain-kernel";
import {
  checkTerms,
  termsAsKind,
  type LiabilityKind,
  type LiabilityTermsInput,
  type TermsIssue,
} from "../domain/index.ts";
import type { LiabilityAuditChange, LiabilityHandOff } from "./hand-off.ts";

/**
 * Registering a liability for an account (FIN-01@PoC FR 2, FR 16): a loan or a credit card of the `accounts` module,
 * by the account's id. One liability per account; registering it again returns the one there. The audit entry follows
 * the commit (ARC-04 FR 2; application/hand-off.ts): its job is written in this transaction.
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
  /** The hand-off job of the change (ARC-04 FR 2), in this transaction; the same change twice is one job. */
  enqueueHandOff(householdId: string, handOff: LiabilityHandOff): Promise<void>;
}

export type RegisterResult =
  | { readonly kind: "registered"; readonly liability: Liability }
  | { readonly kind: "invalid"; readonly issues: readonly TermsIssue[] };

/** A use case's result and the hand-off its transaction enqueued (null when it wrote nothing). */
export interface Handed<R> {
  readonly result: R;
  readonly handOff: LiabilityHandOff | null;
}

interface Deps {
  readonly newId: () => string;
}

/** The terms as the audit entry shows them (П-10): amounts and rates are not personal data, nothing is masked. */
function auditTerms(l: Liability) {
  return {
    kind: l.kind,
    annualRate: l.annualRate,
    monthlyPayment: l.monthlyPayment?.toDecimalString() ?? null,
    creditLimit: l.creditLimit?.toDecimalString() ?? null,
    gracePeriodDays: l.gracePeriodDays === null ? null : String(l.gracePeriodDays),
  };
}

function createdChanges(l: Liability): LiabilityAuditChange[] {
  const terms = auditTerms(l);
  return [
    { field: "accountId", before: null, after: l.accountId },
    { field: "kind", before: null, after: terms.kind },
    { field: "currency", before: null, after: l.currency },
    { field: "annualRate", before: null, after: terms.annualRate },
    { field: "monthlyPayment", before: null, after: terms.monthlyPayment },
    { field: "creditLimit", before: null, after: terms.creditLimit },
    { field: "gracePeriodDays", before: null, after: terms.gracePeriodDays },
  ];
}

/** «Кредит» ↔ «Кредитна картка» (FIN-12@PoC FR 5, FR 6): the kind and every term changed, before and after. */
function changedChanges(before: Liability, after: Liability): LiabilityAuditChange[] {
  const [was, now] = [auditTerms(before), auditTerms(after)];
  return (Object.keys(was) as (keyof typeof was)[])
    .filter((field) => was[field] !== now[field])
    .map((field) => ({ field, before: was[field], after: now[field] }));
}

export async function registerLiability(
  deps: Deps,
  tx: LiabilitiesTx,
  householdId: string,
  input: { readonly actorAccountId: string; readonly accountId: string; readonly terms: LiabilityTermsInput },
): Promise<Handed<RegisterResult>> {
  const checked = checkTerms(input.terms);
  if ("issues" in checked) return { result: { kind: "invalid", issues: checked.issues }, handOff: null };
  const liability: Liability = { id: deps.newId(), accountId: input.accountId, ...checked.terms };
  if (!(await tx.insert(householdId, liability))) {
    const existing = await tx.byAccount(householdId, input.accountId);
    if (!existing) throw new Error("liability vanished after a conflicting insert");
    // Its own registration enqueued its hand-off; nothing more to write.
    return { result: { kind: "registered", liability: existing }, handOff: null };
  }
  const handOff: LiabilityHandOff = {
    liabilityId: liability.id,
    actorAccountId: input.actorAccountId,
    action: "create",
    changeId: liability.id,
    changes: createdChanges(liability),
  };
  await tx.enqueueHandOff(householdId, handOff);
  return { result: { kind: "registered", liability }, handOff };
}

export type ChangeKindResult =
  { readonly kind: "changed" | "unchanged"; readonly liability: Liability } | { readonly kind: "not-found" };

/**
 * «Кредит» ↔ «Кредитна картка» of the account (FIN-12@PoC FR 5): the liability's kind with the terms the new kind may
 * have (`termsAsKind`); whether the account has transactions is the caller's check (`accounts`). The same kind again
 * changes nothing and writes nothing, so a retry after a failure later in the caller's change finishes it. Its audit
 * entry's job is written in this transaction, with the row locked; the entry follows the commit.
 */
export async function changeLiabilityKind(
  deps: Deps,
  tx: LiabilitiesTx,
  householdId: string,
  input: { readonly actorAccountId: string; readonly accountId: string; readonly kind: LiabilityKind },
): Promise<Handed<ChangeKindResult>> {
  const before = await tx.lockByAccount(householdId, input.accountId);
  if (!before) return { result: { kind: "not-found" }, handOff: null };
  if (before.kind === input.kind) return { result: { kind: "unchanged", liability: before }, handOff: null };
  const after = termsAsKind(before, input.kind);
  await tx.update(householdId, after);
  const handOff: LiabilityHandOff = {
    liabilityId: after.id,
    actorAccountId: input.actorAccountId,
    action: "update",
    changeId: deps.newId(),
    changes: changedChanges(before, after),
  };
  await tx.enqueueHandOff(householdId, handOff);
  return { result: { kind: "changed", liability: after }, handOff };
}
