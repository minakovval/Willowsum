import { Money } from "@willowsum/domain-kernel";
import {
  addDays,
  canSettle,
  canSkip,
  holdAction,
  trackPayment,
  type Candidate,
  type ChargeMark,
  type Hold,
  type TrackedCharge,
  type Tracking,
} from "../domain/index.ts";
import type {
  Caller,
  RecurringHandOff,
  RecurringTx,
  StoredHold,
  StoredMark,
  StoredPayment,
} from "./payments.ts";
import { HISTORY_DAYS, HISTORY_MAX, type ProposalDeps } from "./proposals.ts";

/**
 * The statuses of the space's regular payments (BUD-07@PoC FR 8–12, FR 17, FR 20, FR 21, «Права доступу»; wave 2 row 26 —
 * part b1): every payment's charges matched each time they are read to the space's transactions of the last 430 days as
 * they are now (FR 17: a charge is a projection, never a record), the user's marks «Позначити пропущеним» and «Зарахувати
 * за <місяць>», «Залишити», and the audit entry of each change — the system's too when a read finds that the charges
 * changed the expected amount (FR 11 «пишеться без автора»).
 */

/** A transaction as module transactions gives it for matching: shown, no side of a transfer, merged into none. */
export interface MatchingCharge {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  /** Signed in `currency`: minus — an expense. */
  readonly amount: string;
  readonly currency: string;
  /** Null — none (matched by its category only). */
  readonly counterparty: string | null;
}

export interface TrackingDeps {
  /** Module transactions' `TransactionHistory`: the space's transactions in a period, newest first. */
  readonly history: {
    matching(
      householdId: string,
      query: { readonly from: string; readonly to: string; readonly limit: number },
    ): Promise<readonly MatchingCharge[]>;
  };
  /** Module merchants' `MerchantDirectory`. */
  readonly merchants: ProposalDeps["merchants"];
  /** Module categorization's `TransactionCategories`: the category of each categorised transaction. */
  readonly categories: {
    categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  };
  /**
   * FR 12: amounts in another currency at the rate of each one's date (module fx-rates), in the order given — every rate
   * read in one query, however many amounts: `approximate` — the nearest earlier rate; null — no rate at all.
   */
  readonly convert: (
    amounts: readonly { readonly amount: Money; readonly date: string }[],
    currency: string,
  ) => Promise<readonly ({ readonly value: Money; readonly approximate: boolean } | null)[]>;
  readonly today: () => string;
  readonly newId: () => string;
}

export interface SpaceTracking {
  readonly byPayment: ReadonlyMap<string, Tracking>;
  /** Each transaction that pays a charge → its payment. */
  readonly used: ReadonlyMap<string, string>;
  /** The transactions read, by id. */
  readonly history: ReadonlyMap<string, MatchingCharge>;
}

const typeOf = (c: MatchingCharge) => (c.amount.startsWith("-") ? "expense" : "income");

/**
 * FR 8: the space's payments matched to its transactions. A transaction pays one charge of one payment: the user's
 * («Зарахувати») first, then the payments of a merchant, then the others, oldest first.
 */
export async function trackSpace(
  deps: TrackingDeps,
  householdId: string,
  payments: readonly StoredPayment[],
  marks: readonly StoredMark[],
  holds: readonly StoredHold[] = [],
): Promise<SpaceTracking> {
  const today = deps.today();
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const found =
    payments.length === 0
      ? []
      : await deps.history.matching(householdId, { from, to: today, limit: HISTORY_MAX });
  const history = new Map(found.map((h) => [h.id, h]));
  const counterparties = [
    ...new Set(found.flatMap((h) => (h.counterparty === null ? [] : [h.counterparty]))),
  ];
  const merchants =
    counterparties.length === 0
      ? new Map()
      : await deps.merchants.shownMerchants(householdId, counterparties);
  const categories =
    found.length === 0 ? new Map() : await deps.categories.categoriesOf(householdId, [...history.keys()]);

  const marksOf = new Map<string, Map<string, ChargeMark>>();
  const taken = new Set<string>();
  for (const m of marks) {
    const own = marksOf.get(m.paymentId) ?? new Map<string, ChargeMark>();
    own.set(m.dueOn, m);
    marksOf.set(m.paymentId, own);
    if (m.kind === "settled") taken.add(m.transactionId);
  }

  const holdsOf = new Map<string, Hold[]>();
  for (const h of holds)
    holdsOf.set(h.paymentId, [
      ...(holdsOf.get(h.paymentId) ?? []),
      { kind: h.kind, from: h.from, until: h.until },
    ]);

  const order = [...payments].sort(
    (a, b) =>
      Number(a.merchantId === null) - Number(b.merchantId === null) ||
      a.createdOn.localeCompare(b.createdOn) ||
      a.id.localeCompare(b.id),
  );
  // FR 8: a transaction of a payment's merchant is that payment's — never another payment's by the category.
  const paymentMerchants = new Set(payments.flatMap((p) => (p.merchantId === null ? [] : [p.merchantId])));
  // FR 12: every transaction in another currency than a payment's, converted once per currency of a payment — one
  // call (one query of rates) per currency, never one per transaction.
  const converted = new Map<string, { value: Money; approximate: boolean } | null>();
  for (const currency of new Set(payments.map((p) => p.expected.currency))) {
    const foreign = found.filter((h) => h.currency !== currency);
    if (foreign.length === 0) continue;
    const values = await deps.convert(
      foreign.map((h) => ({ amount: Money.of(h.amount.replace(/^-/, ""), h.currency), date: h.date })),
      currency,
    );
    foreign.forEach((h, i) => converted.set(`${h.id}:${currency}`, values[i] ?? null));
  }
  const byPayment = new Map<string, Tracking>();
  const used = new Map<string, string>();
  for (const p of order) {
    const own = marksOf.get(p.id) ?? new Map<string, ChargeMark>();
    const settled = new Set(
      [...own.values()].flatMap((m) => (m.kind === "settled" ? [m.transactionId] : [])),
    );
    const currency = p.expected.currency;
    const candidates: Candidate[] = [];
    for (const h of found) {
      if (typeOf(h) !== p.type) continue;
      const ofMerchant: string | undefined =
        h.counterparty === null ? undefined : merchants.get(h.counterparty)?.id;
      const merchant = p.merchantId !== null && ofMerchant === p.merchantId;
      const category =
        !merchant &&
        (ofMerchant === undefined || !paymentMerchants.has(ofMerchant)) &&
        p.categoryId !== null &&
        categories.get(h.id) === p.categoryId;
      if (!settled.has(h.id) && (taken.has(h.id) || (!merchant && !category))) continue;
      const amount = Money.of(h.amount.replace(/^-/, ""), h.currency);
      let value: Money | null = amount;
      let approximate = false;
      if (h.currency !== currency) {
        const c = converted.get(`${h.id}:${currency}`) ?? null;
        value = c?.value ?? null;
        approximate = c?.approximate ?? false;
      }
      candidates.push({
        id: h.id,
        date: h.date,
        amount,
        value,
        converted: h.currency !== currency,
        approximate,
        merchant,
        category,
      });
    }
    candidates.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const tracking = trackPayment({
      frequency: p.frequency,
      anchorDate: p.anchorDate,
      endDate: p.endDate,
      createdOn: p.createdOn,
      keptOn: p.keptOn,
      holds: holdsOf.get(p.id) ?? [],
      type: p.type,
      base: p.expected,
      variable: p.variable,
      marks: own,
      candidates,
      from,
      today,
    });
    for (const id of tracking.used) {
      taken.add(id);
      used.set(id, p.id);
    }
    byPayment.set(p.id, tracking);
  }
  return { byPayment, used, history };
}

/** The expected amount a payment shows: the one the charges made it, else the one set. */
export const currentAmount = (p: Pick<StoredPayment, "current" | "expected">): Money =>
  p.current ?? p.expected;

/**
 * FR 11 «автоматичне оновлення очікуваної суми пишеться без автора»: the payments whose expected amount the charges
 * changed since it was last written get it, each with its audit entry from the system. Compare and set: of two reads
 * that find the same change, one writes it.
 */
export async function recordAmounts(
  deps: Pick<TrackingDeps, "newId">,
  tx: RecurringTx,
  householdId: string,
  payments: readonly StoredPayment[],
  tracked: SpaceTracking,
): Promise<RecurringHandOff[]> {
  const handOffs: RecurringHandOff[] = [];
  for (const p of payments) {
    const t = tracked.byPayment.get(p.id);
    if (!t || t.expected.equals(currentAmount(p))) continue;
    if (!(await tx.setCurrentAmount(householdId, p.id, p.current, t.expected))) continue;
    const handOff: RecurringHandOff = {
      entity: "recurring.payment",
      entityId: p.id,
      actorAccountId: null,
      action: "update",
      changeId: deps.newId(),
      changes: [
        {
          field: "expectedAmount",
          before: currentAmount(p).toDecimalString(),
          after: t.expected.toDecimalString(),
        },
      ],
    };
    await tx.enqueueHandOff(handOff);
    handOffs.push(handOff);
  }
  return handOffs;
}

/** The outcome of an action on a charge or a payment. */
export type ChargeOutcome<R> =
  | { readonly kind: "done"; readonly result: R; readonly handOffs: readonly RecurringHandOff[] }
  | { readonly kind: "not-found" }
  /** The charge or the payment is not in the status the action needs (`RECURRING_CHARGE_STATE`). */
  | { readonly kind: "state" }
  /** The transaction pays a charge already, or cannot pay this one (`RECURRING_TRANSACTION_TAKEN`). */
  | { readonly kind: "taken" };

/** The space tracked as it is now, read inside the module's transaction. */
async function trackLocked(deps: TrackingDeps, tx: RecurringTx, householdId: string): Promise<SpaceTracking> {
  return trackSpace(
    deps,
    householdId,
    await tx.payments(householdId),
    await tx.marks(householdId),
    await tx.holds(householdId),
  );
}

/** Under the payment's lock: the space tracked as it is now, and the payment's charge of `dueOn`. */
async function lockedCharge(
  deps: TrackingDeps,
  tx: RecurringTx,
  householdId: string,
  paymentId: string,
  dueOn: string,
): Promise<{ payment: StoredPayment; tracked: SpaceTracking; charge: TrackedCharge } | null> {
  const payment = await tx.lockPayment(householdId, paymentId);
  if (!payment) return null;
  const tracked = await trackLocked(deps, tx, householdId);
  const charge = tracked.byPayment.get(paymentId)?.charges.find((c) => c.dueOn === dueOn);
  return charge ? { payment, tracked, charge } : null;
}

const chargeHandOff = (
  deps: Pick<TrackingDeps, "newId">,
  caller: Caller,
  markId: string,
  action: RecurringHandOff["action"],
  changes: RecurringHandOff["changes"],
): RecurringHandOff => ({
  entity: "recurring.charge",
  entityId: markId,
  actorAccountId: caller.accountId,
  action,
  changeId: deps.newId(),
  changes,
});

/**
 * FR 21 «Позначити пропущеним»: an overdue charge becomes «Пропущено» — no transaction pays it by itself any more, and
 * it is still paid by «Зарахувати за <місяць>». Audited.
 */
export async function skipCharge(
  deps: TrackingDeps,
  tx: RecurringTx,
  caller: Caller,
  paymentId: string,
  dueOn: string,
): Promise<ChargeOutcome<TrackedCharge>> {
  const found = await lockedCharge(deps, tx, caller.householdId, paymentId, dueOn);
  if (!found) return { kind: "not-found" };
  if (!canSkip(found.charge)) return { kind: "state" };
  const today = deps.today();
  const id = await tx.saveMark(caller.householdId, {
    id: deps.newId(),
    paymentId,
    dueOn,
    kind: "skipped",
    markedOn: today,
  });
  if (id === null) return { kind: "state" };
  const handOff = chargeHandOff(deps, caller, id, "create", [
    { field: "paymentId", before: null, after: paymentId },
    { field: "dueOn", before: null, after: dueOn },
    { field: "status", before: "overdue", after: "skipped" },
  ]);
  await tx.enqueueHandOff(handOff);
  return {
    kind: "done",
    result: { ...found.charge, status: "skipped", overdueDays: null, markedOn: today },
    handOffs: [handOff],
  };
}

/**
 * FR 20 «Зарахувати за <місяць>»: a transaction no charge took pays an overdue or skipped charge of the payment —
 * «Сплачено із запізненням»; the misses are counted again. It is of the payment's type (an expense pays an expense)
 * and within the transactions analysed. Audited.
 */
export async function settleCharge(
  deps: TrackingDeps,
  tx: RecurringTx,
  caller: Caller,
  paymentId: string,
  dueOn: string,
  transactionId: string,
): Promise<ChargeOutcome<TrackedCharge>> {
  const found = await lockedCharge(deps, tx, caller.householdId, paymentId, dueOn);
  if (!found) return { kind: "not-found" };
  if (!canSettle(found.charge)) return { kind: "state" };
  const h = found.tracked.history.get(transactionId);
  if (!h || typeOf(h) !== found.payment.type || found.tracked.used.has(transactionId))
    return { kind: "taken" };
  if (await tx.settledElsewhere(caller.householdId, transactionId)) return { kind: "taken" };
  const before = (await tx.marks(caller.householdId)).find(
    (m) => m.paymentId === paymentId && m.dueOn === dueOn,
  );
  const today = deps.today();
  const id = await tx.saveMark(caller.householdId, {
    id: before?.id ?? deps.newId(),
    paymentId,
    dueOn,
    kind: "settled",
    transactionId,
    markedOn: today,
  });
  if (id === null) return { kind: "taken" };
  const handOff = chargeHandOff(
    deps,
    caller,
    id,
    before ? "update" : "create",
    before
      ? [
          { field: "status", before: "skipped", after: "paid-late" },
          { field: "transactionId", before: null, after: transactionId },
        ]
      : [
          { field: "paymentId", before: null, after: paymentId },
          { field: "dueOn", before: null, after: dueOn },
          { field: "status", before: "overdue", after: "paid-late" },
          { field: "transactionId", before: null, after: transactionId },
        ],
  );
  await tx.enqueueHandOff(handOff);
  return {
    kind: "done",
    result: {
      ...found.charge,
      status: "paid-late",
      transactionId,
      paidOn: h.date,
      amount: Money.of(h.amount.replace(/^-/, ""), h.currency),
      overdueDays: null,
      markedOn: today,
    },
    handOffs: [handOff],
  };
}

/** FR 10 «Залишити»: a payment «Можливо, скасований» stays; its misses are counted anew from today. Audited. */
export async function keepPayment(
  deps: TrackingDeps,
  tx: RecurringTx,
  caller: Caller,
  paymentId: string,
): Promise<ChargeOutcome<StoredPayment>> {
  const payment = await tx.lockPayment(caller.householdId, paymentId);
  if (!payment) return { kind: "not-found" };
  const tracked = await trackLocked(deps, tx, caller.householdId);
  if (tracked.byPayment.get(paymentId)?.state !== "possibly-cancelled") return { kind: "state" };
  const today = deps.today();
  const kept = (await tx.keep(caller.householdId, paymentId, today))!;
  const handOff: RecurringHandOff = {
    entity: "recurring.payment",
    entityId: paymentId,
    actorAccountId: caller.accountId,
    action: "update",
    changeId: deps.newId(),
    changes: [{ field: "keptOn", before: payment.keptOn, after: today }],
  };
  await tx.enqueueHandOff(handOff);
  return { kind: "done", result: kept, handOffs: [handOff] };
}

/** FR 13: «Призупинити» (`until` — the last day paused, after today; null — until «Відновити»), «Позначити
 * скасованим», «Відновити». */
export type HoldRequest =
  | { readonly kind: "pause"; readonly until: string | null }
  | { readonly kind: "cancel" }
  | { readonly kind: "resume" };

const HOLD_STATE = { pause: "paused", cancel: "cancelled", resume: "active" } as const;

/**
 * FR 13: a pause, a «скасовано» mark (only in the app: nothing is cancelled at the provider) or «Відновити» of a payment
 * — its charges of the span held leave the schedule and «Можна витратити», the history of its paid ones stays, and
 * «Відновити» counts the misses anew from today. Pause: an active payment or one «Можливо, скасований»; «Позначити
 * скасованим»: any not marked yet; «Відновити»: a paused or marked one. Under the payment's lock; audited. A hold that
 * ended before the 430 days analysed is dropped (no charge before them is tracked).
 */
export async function holdPayment(
  deps: TrackingDeps,
  tx: RecurringTx,
  caller: Caller,
  paymentId: string,
  request: HoldRequest,
): Promise<ChargeOutcome<StoredPayment>> {
  const payment = await tx.lockPayment(caller.householdId, paymentId);
  if (!payment) return { kind: "not-found" };
  const today = deps.today();
  if (request.kind === "pause" && request.until !== null && request.until <= today) return { kind: "state" };
  const tracked = await trackLocked(deps, tx, caller.householdId);
  const state = tracked.byPayment.get(paymentId)?.state ?? "active";
  const own = (await tx.holds(caller.householdId)).filter((h) => h.paymentId === paymentId);
  const next = holdAction(own, state, request, today);
  if (next === null) return { kind: "state" };
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const kept: StoredHold[] = next
    .filter((h) => h.until === null || h.until >= from)
    .map((h) => ("id" in h ? h : { ...h, paymentId, id: deps.newId() }));
  // «відновлення перезапускає лічильник пропусків»: from today, as «Залишити» (FR 10).
  const keptOn = request.kind === "resume" ? today : null;
  const saved = await tx.replaceHolds(caller.householdId, paymentId, kept, keptOn);
  const changes: RecurringHandOff["changes"][number][] = [
    { field: "state", before: state, after: HOLD_STATE[request.kind] },
  ];
  if (keptOn !== null) changes.push({ field: "keptOn", before: payment.keptOn, after: keptOn });
  if (request.kind === "pause" && request.until !== null)
    changes.push({ field: "pausedUntil", before: null, after: request.until });
  const handOff: RecurringHandOff = {
    entity: "recurring.payment",
    entityId: paymentId,
    actorAccountId: caller.accountId,
    action: "update",
    changeId: deps.newId(),
    changes,
  };
  await tx.enqueueHandOff(handOff);
  return { kind: "done", result: saved, handOffs: [handOff] };
}
