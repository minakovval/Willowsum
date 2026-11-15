import type { Money } from "@willowsum/domain-kernel";
import {
  checkTerms,
  checkTermsChange,
  sameTerms,
  termsAsKind,
  type LiabilityKind,
  type LiabilityTermsInput,
  type TermsChangeInput,
  type TermsIssue,
  type TermsPeriod,
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
  /**
   * The dated history of the terms (FIN-12@PoC AC10; migrations/0004_terms_history.sql): the periods recorded, by date
   * and then in the order written; empty for a liability whose terms never changed.
   */
  termsHistory(householdId: string, liabilityId: string): Promise<readonly TermsPeriod<Liability>[]>;
  /**
   * Adds the period of `terms` from `validFrom` (null — since the registration; written once per liability, a second
   * one is ignored).
   */
  recordTerms(householdId: string, period: TermsPeriod<Liability>): Promise<void>;
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
  /** Today's date (UTC, YYYY-MM-DD): the date a kind change's terms apply from. */
  readonly today: () => string;
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
  await newPeriod(tx, householdId, before, after, deps.today());
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

/**
 * The history of a change (FIN-12@PoC AC10): on the first change, the terms before it as the period since the
 * registration; then the terms after it from `date`, never before a period already recorded (a clock behind the last
 * change dates the new terms on that change's day, so the history stays in order). Returns the date used.
 */
async function newPeriod(
  tx: LiabilitiesTx,
  householdId: string,
  before: Liability,
  after: Liability,
  date: string,
): Promise<string> {
  const history = await tx.termsHistory(householdId, before.id);
  if (history.length === 0) await tx.recordTerms(householdId, { validFrom: null, terms: before });
  const latest = history.reduce<string | null>(
    (d, p) => (p.validFrom !== null && (d === null || p.validFrom > d) ? p.validFrom : d),
    null,
  );
  const validFrom = latest !== null && latest > date ? latest : date;
  await tx.recordTerms(householdId, { validFrom, terms: after });
  return validFrom;
}

/** The periods of a liability's terms, the last one in effect now (one period while they never changed). */
export async function liabilityTermsHistory(
  tx: Pick<LiabilitiesTx, "byAccount" | "termsHistory">,
  householdId: string,
  accountId: string,
): Promise<readonly TermsPeriod<Liability>[] | null> {
  const current = await tx.byAccount(householdId, accountId);
  if (!current) return null;
  const history = await tx.termsHistory(householdId, current.id);
  return history.length === 0 ? [{ validFrom: null, terms: current }] : history;
}

export type ChangeTermsResult =
  | {
      readonly kind: "changed";
      readonly liability: Liability;
      /** The date the new terms apply from. */
      readonly validFrom: string;
    }
  | { readonly kind: "unchanged"; readonly liability: Liability }
  | { readonly kind: "not-found" }
  | { readonly kind: "invalid"; readonly issues: readonly TermsIssue[] };

/**
 * «Реквізити» of a loan or a credit card (FIN-12@PoC FR 4, AC10; owner decision 2026-11-13): a loan's rate and monthly
 * payment, a card's credit limit, which apply from the date of the change (`validFrom`, the caller's today). With the
 * row locked: the change is checked against the terms in effect (`checkTermsChange`) — nothing is written for a refusal
 * or the same terms; then the history (`newPeriod`), the row (the terms now) and the audit entry's job (every changed
 * term before and after, and the date), in this transaction; the entry follows the commit. A loan that gets both its
 * rate and payment loses «Додайте ставку і платіж» (`termsMissing`, the store's `terms_pending`).
 */
export async function changeLiabilityTerms(
  deps: Deps,
  tx: LiabilitiesTx,
  householdId: string,
  input: {
    readonly actorAccountId: string;
    readonly accountId: string;
    readonly change: TermsChangeInput;
    readonly validFrom: string;
  },
): Promise<Handed<ChangeTermsResult>> {
  const before = await tx.lockByAccount(householdId, input.accountId);
  if (!before) return { result: { kind: "not-found" }, handOff: null };
  const checked = checkTermsChange(before, input.change);
  if ("issues" in checked) return { result: { kind: "invalid", issues: checked.issues }, handOff: null };
  const after = checked.terms;
  if (sameTerms(before, after)) return { result: { kind: "unchanged", liability: before }, handOff: null };
  const validFrom = await newPeriod(tx, householdId, before, after, input.validFrom);
  await tx.update(householdId, after);
  const handOff: LiabilityHandOff = {
    liabilityId: after.id,
    actorAccountId: input.actorAccountId,
    action: "update",
    changeId: deps.newId(),
    changes: [...changedChanges(before, after), { field: "validFrom", before: null, after: validFrom }],
  };
  await tx.enqueueHandOff(householdId, handOff);
  return { result: { kind: "changed", liability: after, validFrom }, handOff };
}
