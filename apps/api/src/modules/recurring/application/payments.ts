import type { Money } from "@willowsum/domain-kernel";
import {
  addDays,
  isRejected,
  type ChargeMark,
  type Hold,
  nextDate,
  type PaymentFields,
  type PaymentIssue,
  type RejectedSeries,
} from "../domain/index.ts";
import type { Decisions, Proposal } from "./proposals.ts";

/**
 * Regular payments of the space and the decisions on the proposals (BUD-07@PoC FR 4, FR 6, «Права доступу»; wave 2
 * row 25 — part a2): a payment added by hand, a proposal confirmed with edits or rejected «Не регулярний», a category
 * merge (BUD-01 FR 8) and the audit hand-off of each change (ARC-04 FR 2, FR 3; ADR-0015). Statuses, the calendar and
 * the subscriptions group are row 26.
 */

/** A regular payment as stored (migrations/0001_payments.sql). */
export interface StoredPayment extends PaymentFields {
  readonly id: string;
  /** The merchant of the confirmed proposal; null for a payment added by hand. */
  readonly merchantId: string | null;
  readonly source: "proposal" | "manual";
  readonly createdOn: string;
  readonly version: number;
  /** FR 11: the expected amount the charges have made it; null — `expected`, as set (row 26). */
  readonly current: Money | null;
  /** FR 10 «Залишити»: misses are counted anew from this day (row 26). */
  readonly keptOn: string | null;
}

/** A user's mark on one charge (FR 20, FR 21; migrations/0004_charge_marks.sql). */
export type StoredMark = {
  readonly id: string;
  readonly paymentId: string;
  readonly dueOn: string;
} & ChargeMark;

/** FR 13: a pause or a «скасовано» mark of a payment, as stored (migrations/0005_payment_holds.sql). */
export type StoredHold = {
  readonly id: string;
  readonly paymentId: string;
} & Hold;

/** A rejected series as stored. */
export interface StoredRejection extends RejectedSeries {
  readonly id: string;
  readonly createdOn: string;
}

/** The recurring schema inside one transaction of the module (adapters/db/store.ts). */
export interface RecurringTx {
  /** The space's payments, by name. */
  payments(householdId: string): Promise<StoredPayment[]>;
  payment(householdId: string, id: string): Promise<StoredPayment | null>;
  insertPayment(householdId: string, payment: StoredPayment): Promise<void>;
  /** FR 4: the merchants that are payments and the rejected series — the proposals' filter. */
  decisions(householdId: string): Promise<Decisions>;
  /** Serialises the decisions on one merchant's proposals until the commit (a confirm and a reject at once). */
  lockMerchant(householdId: string, merchantId: string): Promise<void>;
  insertRejection(householdId: string, rejection: StoredRejection): Promise<void>;
  /** BUD-01 FR 8: the payments of `sourceId` get `targetId`; returns the payments moved. */
  moveCategory(householdId: string, sourceId: string, targetId: string): Promise<StoredPayment[]>;
  categoriesInUse(householdId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** BUD-01@PoC AC 23: how many regular payments of the space have the category. */
  categoryPayments(householdId: string, categoryId: string): Promise<number>;
  enqueueHandOff(handOff: RecurringHandOff): Promise<void>;
  /** The payment, locked until the commit: the actions on one payment's charges run one after another. */
  lockPayment(householdId: string, id: string): Promise<StoredPayment | null>;
  /** The marks of the space's charges. */
  marks(householdId: string): Promise<StoredMark[]>;
  /** One mark per charge (replaced); returns its id, or null — the transaction already settles another charge. */
  saveMark(householdId: string, mark: StoredMark): Promise<string | null>;
  settledElsewhere(householdId: string, transactionId: string): Promise<boolean>;
  /** FR 10 «Залишити». */
  keep(householdId: string, id: string, today: string): Promise<StoredPayment | null>;
  /** FR 13: the holds of the space's payments. */
  holds(householdId: string): Promise<StoredHold[]>;
  /**
   * FR 13: the payment's holds become `holds` (the payment's version + 1); `keptOn` — misses are counted anew from this
   * day («Відновити»). Returns the payment.
   */
  replaceHolds(
    householdId: string,
    paymentId: string,
    holds: readonly StoredHold[],
    keptOn: string | null,
  ): Promise<StoredPayment>;
  /** FR 11: the current expected amount, if it is still `before` (compare and set); false — another read wrote it. */
  setCurrentAmount(householdId: string, id: string, before: Money | null, after: Money): Promise<boolean>;
}

/**
 * The other modules a payment names (FR 6): a category of the space's tree of the payment's type (module categories;
 * merged away — `retired`), and an account of the space (module accounts: not closed; FR 16 — never a «Кредит», whose
 * monthly payment is the account's own).
 */
export interface PaymentReferences {
  category(householdId: string, categoryId: string): Promise<{ kind: string; retired: boolean } | null>;
  account(householdId: string, accountId: string): Promise<{ kind: string; closed: boolean } | null>;
}

export interface PaymentDeps {
  readonly newId: () => string;
  /** «Сьогодні» — the Kyiv date. */
  readonly today: () => string;
  readonly references: PaymentReferences;
}

export interface Caller {
  readonly householdId: string;
  readonly accountId: string;
}

export const AUDIT_ENTITIES = ["recurring.payment", "recurring.rejection", "recurring.charge"] as const;
export const HAND_OFF_ACTIONS = ["create", "update"] as const;

/**
 * The hand-off of a recurring change to the audit log (BUD-07 «Кожна зміна пишеться в журнал аудиту»; ADR-0015): the row
 * and this job in one recurring transaction; the entry after the commit — right away, and by the worker if that failed
 * — once per key. It carries the entry's values: ids, codes, dates, amounts as decimal strings and the payment's name
 * (the space's log shows it as typed, as the goals' names).
 */
export interface RecurringHandOff {
  readonly entity: (typeof AUDIT_ENTITIES)[number];
  readonly entityId: string;
  /** Null — the system (a category merge). */
  readonly actorAccountId: string | null;
  readonly action: (typeof HAND_OFF_ACTIONS)[number];
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: RecurringHandOff): string =>
  `${h.entity}:${h.action}:${h.entityId}:${h.changeId}`;

/** The space's audit log as the hand-off writes it (П-10). */
export interface RecurringAudit {
  record(householdId: string, handOff: RecurringHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(
  audit: RecurringAudit,
  householdId: string,
  handOff: RecurringHandOff,
): Promise<void> {
  return audit.record(householdId, handOff, handOffKey(handOff));
}

/** A change and its audit hand-offs, written in one recurring transaction. */
export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly RecurringHandOff[];
}

const amountOf = (m: Money) => m.toDecimalString();

function paymentFields(p: StoredPayment): Record<string, string | null> {
  return {
    name: p.name,
    type: p.type,
    frequency: p.frequency,
    amount: amountOf(p.expected),
    currency: p.expected.currency,
    anchorDate: p.anchorDate,
    endDate: p.endDate,
    categoryId: p.categoryId,
    accountId: p.accountId,
    subscription: String(p.subscription),
    variable: String(p.variable),
    merchantId: p.merchantId,
    source: p.source,
  };
}

const created = (fields: Record<string, string | null>) =>
  Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([field, after]) => ({ field, before: null, after }));

/** FR 6: the category and the account a payment names, checked against the space's tree and accounts. */
export async function checkReferences(
  deps: PaymentDeps,
  householdId: string,
  fields: Pick<PaymentFields, "categoryId" | "accountId" | "type">,
): Promise<PaymentIssue[]> {
  const issues: PaymentIssue[] = [];
  if (fields.categoryId !== null) {
    const c = await deps.references.category(householdId, fields.categoryId);
    if (!c) issues.push({ field: "categoryId", issue: "not_found" });
    else if (c.retired) issues.push({ field: "categoryId", issue: "merged" });
    else if (c.kind !== fields.type) issues.push({ field: "categoryId", issue: "kind" });
  }
  if (fields.accountId !== null) {
    const a = await deps.references.account(householdId, fields.accountId);
    if (!a) issues.push({ field: "accountId", issue: "not_found" });
    else if (a.closed) issues.push({ field: "accountId", issue: "closed" });
    else if (a.kind === "loan") issues.push({ field: "accountId", issue: "loan" });
  }
  return issues;
}

function newPayment(deps: PaymentDeps, fields: PaymentFields, merchantId: string | null): StoredPayment {
  return {
    ...fields,
    id: deps.newId(),
    merchantId,
    source: merchantId === null ? "manual" : "proposal",
    createdOn: deps.today(),
    version: 1,
    current: null,
    keptOn: null,
  };
}

async function insertWithHandOff(
  deps: PaymentDeps,
  tx: RecurringTx,
  caller: Caller,
  payment: StoredPayment,
): Promise<Handed<StoredPayment>> {
  await tx.insertPayment(caller.householdId, payment);
  const handOff: RecurringHandOff = {
    entity: "recurring.payment",
    entityId: payment.id,
    actorAccountId: caller.accountId,
    action: "create",
    changeId: deps.newId(),
    changes: created(paymentFields(payment)),
  };
  await tx.enqueueHandOff(handOff);
  return { result: payment, handOffs: [handOff] };
}

/** FR 6: «Додати вручну» — a payment of the space with no merchant (references checked by the caller). */
export function createPayment(
  deps: PaymentDeps,
  tx: RecurringTx,
  caller: Caller,
  fields: PaymentFields,
): Promise<Handed<StoredPayment>> {
  return insertWithHandOff(deps, tx, caller, newPayment(deps, fields, null));
}

/** The proposal is not offered any more: its merchant became a payment, or the series was rejected, meanwhile. */
export const GONE = "gone" as const;

const seriesOf = (p: Proposal) => ({
  merchantId: p.merchant.id,
  type: p.type,
  frequency: p.frequency,
  variable: p.variable,
  expected: p.expectedAmount,
  transactionIds: p.transactionIds,
});

/** Under the merchant's lock: whether the proposal is still offered (FR 4) — no payment of the merchant, not rejected. */
async function stillOffered(tx: RecurringTx, householdId: string, proposal: Proposal): Promise<boolean> {
  await tx.lockMerchant(householdId, proposal.merchant.id);
  const decided = await tx.decisions(householdId);
  if (decided.merchantIds.has(proposal.merchant.id)) return false;
  return !decided.rejections.some((r) => isRejected(seriesOf(proposal), r));
}

/**
 * FR 4: the user confirms a proposal, with the fields edited or as proposed. Afterwards the merchant is a regular payment
 * and none of its series is proposed again. Two confirmations at once make one payment; the other is `gone`.
 */
export async function confirmProposal(
  deps: PaymentDeps,
  tx: RecurringTx,
  caller: Caller,
  proposal: Proposal,
  fields: PaymentFields,
): Promise<Handed<StoredPayment | typeof GONE>> {
  if (!(await stillOffered(tx, caller.householdId, proposal))) return { result: GONE, handOffs: [] };
  return insertWithHandOff(deps, tx, caller, newPayment(deps, fields, proposal.merchant.id));
}

/** FR 4 «Не регулярний»: the series is not proposed again — matched by more than its key (#315, п. 8). */
export async function rejectProposal(
  deps: PaymentDeps,
  tx: RecurringTx,
  caller: Caller,
  proposal: Proposal,
): Promise<Handed<StoredRejection | typeof GONE>> {
  if (!(await stillOffered(tx, caller.householdId, proposal))) return { result: GONE, handOffs: [] };
  const rejection: StoredRejection = { ...seriesOf(proposal), id: deps.newId(), createdOn: deps.today() };
  await tx.insertRejection(caller.householdId, rejection);
  const handOff: RecurringHandOff = {
    entity: "recurring.rejection",
    entityId: rejection.id,
    actorAccountId: caller.accountId,
    action: "create",
    changeId: deps.newId(),
    changes: created({
      merchantId: rejection.merchantId,
      type: rejection.type,
      frequency: rejection.frequency,
      variable: String(rejection.variable),
      amount: amountOf(rejection.expected),
      currency: rejection.expected.currency,
      lastDate: proposal.lastDate,
    }),
  };
  await tx.enqueueHandOff(handOff);
  return { result: rejection, handOffs: [handOff] };
}

/**
 * BUD-01 FR 8 «Категорію об'єднано»: the space's payments of the merged category get the target, each with its audit
 * entry from the system. Idempotent: only what still has the merged category moves.
 */
export async function applyCategoryMerge(
  newId: () => string,
  tx: RecurringTx,
  householdId: string,
  merge: { readonly sourceId: string; readonly targetId: string },
): Promise<void> {
  for (const before of await tx.moveCategory(householdId, merge.sourceId, merge.targetId))
    await tx.enqueueHandOff({
      entity: "recurring.payment",
      entityId: before.id,
      actorAccountId: null,
      action: "update",
      changeId: newId(),
      changes: [{ field: "categoryId", before: merge.sourceId, after: merge.targetId }],
    });
}

/**
 * The next date of a payment's schedule on or after today; null once its end date has passed. FR 13: a held date is no
 * next date — the first one after a pause; null while paused until «Відновити» or marked cancelled.
 */
export function nextPaymentDate(
  p: Pick<PaymentFields, "anchorDate" | "frequency" | "endDate">,
  today: string,
  holds: readonly Hold[] = [],
): string | null {
  let next = nextDate(p.anchorDate, p.frequency, today);
  for (;;) {
    if (p.endDate !== null && next > p.endDate) return null;
    const hold = holds.find((h) => next >= h.from && (h.until === null || next <= h.until));
    if (!hold) return next;
    if (hold.until === null) return null;
    // Past the hold in one step: a dated hold ends, so this ends too.
    next = nextDate(p.anchorDate, p.frequency, addDays(hold.until, 1));
  }
}
