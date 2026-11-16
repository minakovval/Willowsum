import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import { VARIABLE_AVERAGE_OF } from "./detect.ts";
import type { PaymentType } from "./payments.ts";
import { addDays, daysBetween, FREQUENCY_RULES, scheduleDate, type Frequency } from "./schedule.ts";

/**
 * The statuses of a regular payment's charges (BUD-07@PoC FR 8–12, FR 17, FR 20, FR 21; wave 2 row 26 — part b1). A
 * charge is a projection of the payment's schedule, never a journal record (FR 17): it is matched each time it is read
 * to the space's transactions as they are now, and only the user's own marks are stored — «Позначити пропущеним»
 * (FR 21), «Зарахувати за <місяць>» (FR 20) and «Залишити» (FR 10). Pure rules, no I/O; every amount is Money.
 */

/** FR 8: «± 3 дні від дати» — the matching window around a charge's date, both ends included. */
export const WINDOW_DAYS = 3;
/** FR 8: a charge of the payment's merchant pays from half to twice the expected amount («підвищення ціни — оплата»). */
export const MERCHANT_RATIO = { low: new Decimal("0.5"), high: new Decimal("2") };
/** FR 8, FR 12: without the merchant (by the category), and any charge in another currency — ± 10 %. */
export const CLOSE_TOLERANCE = new Decimal("0.1");
/** FR 11: a matched charge more than 5 % off the expected amount becomes the expected amount. */
export const UPDATE_THRESHOLD = new Decimal("0.05");

/**
 * FR 9 «Статус списання»: `paid` — «✓ Сплачено <дата>» («Отримано» for income); `paid-late` — «✓ Сплачено із
 * запізненням · <дата>»; `expected` — «• Очікується»; `overdue` — «! Прострочено на N дн.» («Дохід не надійшов · N дн.»);
 * `skipped` — «! Пропущено» (only by «Позначити пропущеним»).
 */
export const CHARGE_STATUSES = ["paid", "paid-late", "expected", "overdue", "skipped"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** FR 9, FR 10: the payment's own state — «Можливо, скасований» after misses in a row. */
export const PAYMENT_STATES = ["active", "possibly-cancelled"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** FR 10: misses in a row that make a payment «Можливо, скасований» (a weekly one — three). */
export const missesToFlag = (frequency: Frequency): number => (frequency === "week" ? 3 : 2);

/** A user's mark on one charge of the payment, by the charge's date. */
export type ChargeMark =
  | { readonly kind: "skipped"; readonly markedOn: string }
  | { readonly kind: "settled"; readonly transactionId: string; readonly markedOn: string };

/** A transaction that may pay one of the payment's charges, as the application found it for this payment. */
export interface Candidate {
  readonly id: string;
  readonly date: string;
  /** The amount as charged, positive, in the transaction's currency. */
  readonly amount: Money;
  /** FR 12: in the payment's currency (converted at the rate of the transaction's date); null — no rate at all. */
  readonly value: Money | null;
  /** In another currency than the payment's. */
  readonly converted: boolean;
  /** FR 12: converted at the nearest earlier rate («приблизно»). */
  readonly approximate: boolean;
  /** Of the payment's merchant. */
  readonly merchant: boolean;
  /** Of the payment's category. */
  readonly category: boolean;
}

export interface TrackInput {
  readonly frequency: Frequency;
  readonly anchorDate: string;
  readonly endDate: string | null;
  /** EC4: no miss is counted before the day the payment was added. */
  readonly createdOn: string;
  /** FR 10 «Залишити»: misses are counted anew from this day. */
  readonly keptOn: string | null;
  readonly type: PaymentType;
  /** The expected amount as the user set it (or the proposal gave it). */
  readonly base: Money;
  readonly variable: boolean;
  /** By the charge's date. */
  readonly marks: ReadonlyMap<string, ChargeMark>;
  /** By date, then id; none another payment has taken. */
  readonly candidates: readonly Candidate[];
  /** The first day of transactions read: no charge before it. */
  readonly from: string;
  readonly today: string;
}

export interface AmountChange {
  readonly from: Money;
  readonly to: Money;
  /** The date of the charge that changed it. */
  readonly on: string;
  readonly transactionId: string;
}

export interface TrackedCharge {
  /** The charge's date in the schedule. */
  readonly dueOn: string;
  /** The amount expected for this charge, positive. */
  readonly expected: Money;
  readonly status: ChargeStatus;
  /** The transaction that paid it (FR 9 «з посиланням на транзакцію»). */
  readonly transactionId: string | null;
  readonly paidOn: string | null;
  /** The transaction's amount as charged (positive, its currency). */
  readonly amount: Money | null;
  /** «Прострочено на N дн.»: days from the charge's date to today. */
  readonly overdueDays: number | null;
  /** The day of the user's mark (FR 20, FR 21). */
  readonly markedOn: string | null;
  /** FR 12: paid in another currency, converted at the nearest earlier rate. */
  readonly approximate: boolean;
  /** FR 9, FR 11: this charge changed the expected amount («▲» / «▼»). */
  readonly amountChange: AmountChange | null;
}

export interface Tracking {
  /** Oldest first: the charges within the transactions read, through the next one after today (if any). */
  readonly charges: readonly TrackedCharge[];
  /** FR 11: the expected amount now. */
  readonly expected: Money;
  /** FR 9: the change the latest paid charge made to the expected amount; null when it made none. */
  readonly amountChange: AmountChange | null;
  /** Every change of the expected amount, oldest first (FR 11; the audit log records each). */
  readonly changes: readonly AmountChange[];
  /** FR 10: charges without a payment in a row, counted from the day added or «Залишити». */
  readonly missesInRow: number;
  readonly state: PaymentState;
  /** FR 12: some charge was converted at the nearest earlier rate. */
  readonly approximate: boolean;
  /** The transactions this payment took (no other payment's charge may take them). */
  readonly used: readonly string[];
}

interface Slot {
  readonly dueOn: string;
  /** The schedule's index: below 0 — before the anchor date. */
  readonly k: number;
  /** The next date of the schedule (the late payment's window ends 3 days after it). */
  readonly nextDue: string;
  expected: Money;
  status: ChargeStatus;
  paid: Candidate | null;
  markedOn: string | null;
  amountChange: AmountChange | null;
}

function ratio(value: Money, expected: Money): Decimal {
  return value.amount.div(expected.amount);
}

function close(value: Money, expected: Money): boolean {
  const r = ratio(value, expected);
  return (
    r.greaterThanOrEqualTo(Decimal.sub(1, CLOSE_TOLERANCE)) &&
    r.lessThanOrEqualTo(Decimal.add(1, CLOSE_TOLERANCE))
  );
}

/**
 * FR 8, FR 12: whether a transaction pays a charge expected at `expected`. On time — of the merchant at 0,5–2 of the
 * amount, else of the category within ± 10 %; late (an overdue charge) — of the merchant only. In another currency —
 * after the conversion, within ± 10 %; without a rate it pays nothing.
 */
export function pays(c: Candidate, expected: Money, late: boolean): boolean {
  if (c.value === null) return false;
  if (c.converted) return (c.merchant || (!late && c.category)) && close(c.value, expected);
  if (c.merchant) {
    const r = ratio(c.value, expected);
    return r.greaterThanOrEqualTo(MERCHANT_RATIO.low) && r.lessThanOrEqualTo(MERCHANT_RATIO.high);
  }
  return !late && c.category && close(c.value, expected);
}

/** The schedule's dates from `from` on, through the first one after today (and never after the end date). */
function slots(input: TrackInput): Slot[] {
  // Near the first date by arithmetic, then exact by steps: an anchor centuries away costs no more than one near today.
  const step = FREQUENCY_RULES[input.frequency].step;
  const stepDays = "days" in step ? step.days : step.months * 30.4375;
  let k = Math.round(daysBetween(input.anchorDate, input.from) / stepDays);
  while (scheduleDate(input.anchorDate, input.frequency, k - 1) >= input.from) k -= 1;
  while (scheduleDate(input.anchorDate, input.frequency, k) < input.from) k += 1;
  const out: Slot[] = [];
  for (; ; k += 1) {
    const dueOn = scheduleDate(input.anchorDate, input.frequency, k);
    if (input.endDate !== null && dueOn > input.endDate) break;
    out.push({
      dueOn,
      k,
      nextDue: scheduleDate(input.anchorDate, input.frequency, k + 1),
      expected: input.base,
      status: "expected",
      paid: null,
      markedOn: null,
      amountChange: null,
    });
    if (dueOn > input.today) break;
  }
  return out;
}

const distance = (c: Candidate, dueOn: string) => Math.abs(daysBetween(dueOn, c.date));

function averageOf(amounts: readonly Money[]): Money {
  const last = amounts.slice(-VARIABLE_AVERAGE_OF);
  const currency = last[0]!.currency;
  const sum = last.reduce((total, m) => total.plus(m.amount), new Decimal("0"));
  return Money.of(
    sum.div(last.length).toDecimalPlaces(currencyInfo(currency).minorUnits, Decimal.ROUND_HALF_EVEN),
    currency,
  );
}

/**
 * FR 11: the expected amount walked over the paid charges, oldest first. Only a charge the user had not seen yet changes
 * it — after the anchor date, paid on or after the day the payment was added; a charge in another currency never does
 * (FR 12). A variable payment's is the average of its last 3 charges once it has 3.
 */
function amountWalk(input: TrackInput) {
  const paidAmounts: Money[] = [];
  const state = {
    expected: input.base,
    changes: [] as AmountChange[],
    learn(slot: Slot): AmountChange | null {
      const c = slot.paid;
      if (!c || c.converted || c.value === null) return null;
      paidAmounts.push(c.value);
      if (slot.k < 1 || c.date < input.createdOn) return null;
      const current = state.expected;
      const next = input.variable
        ? paidAmounts.length >= VARIABLE_AVERAGE_OF
          ? averageOf(paidAmounts)
          : current
        : c.value.minus(current).amount.abs().greaterThan(current.amount.times(UPDATE_THRESHOLD))
          ? c.value
          : current;
      if (next.equals(current)) return null;
      const change: AmountChange = { from: current, to: next, on: c.date, transactionId: c.id };
      state.changes.push(change);
      state.expected = next;
      return change;
    },
  };
  return state;
}

/**
 * FR 8–12, FR 20, FR 21: the payment's charges with their statuses, the expected amount now and the payment's state.
 *
 * - On time (FR 8): each charge takes the closest free transaction within ± 3 days that pays it; a transaction pays one
 *   charge (the windows of two charges never overlap: the shortest step is 7 days).
 * - Late (FR 8): an overdue charge takes the earliest free transaction of the merchant that came after its window and
 *   until the window of the next charge closes, once the next charge has taken its own — «Сплачено із запізненням».
 * - «Зарахувати за <місяць>» (FR 20) pays the charge with the user's transaction; «Позначити пропущеним» (FR 21) makes
 *   it «Пропущено», and it takes no transaction by itself any more.
 * - FR 9: a charge without a payment is «Очікується» until the last day of its window, then «Прострочено на N дн.»
 *   (N — days from its date; it stays so, it never becomes «Пропущено» by itself). EC4: a charge before the day the
 *   payment was added, without a payment, is not shown and is no miss.
 * - FR 11: a charge after the anchor date, paid on or after the day added, more than 5 % off the expected amount, is the
 *   expected amount from then on; a variable payment's is the average of its last 3 charges. A charge in another
 *   currency changes nothing (FR 12).
 * - FR 10: overdue or skipped charges in a row («Сплачено із запізненням» is no miss), counted from the day added or
 *   «Залишити»: two (a weekly payment — three) make the payment «Можливо, скасований».
 */
export function trackPayment(input: TrackInput): Tracking {
  const all = slots(input);
  const free = new Map(input.candidates.map((c) => [c.id, c]));
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const take = (slot: Slot, c: Candidate, status: ChargeStatus) => {
    slot.paid = c;
    slot.status = status;
    free.delete(c.id);
  };

  // FR 20: the user's transactions first — no other charge takes them.
  for (const slot of all) {
    const mark = input.marks.get(slot.dueOn);
    if (mark?.kind === "settled") {
      const c = byId.get(mark.transactionId);
      if (c) {
        take(slot, c, "paid-late");
        slot.markedOn = mark.markedOn;
      }
    } else if (mark?.kind === "skipped") {
      slot.status = "skipped";
      slot.markedOn = mark.markedOn;
    }
  }

  // FR 8: on time, oldest first, each charge with the expected amount the charges before it left (FR 11).
  let walk = amountWalk(input);
  for (const slot of all) {
    slot.expected = walk.expected;
    if (!slot.paid && slot.status !== "skipped") {
      let best: Candidate | null = null;
      for (const c of free.values()) {
        if (c.date > input.today || distance(c, slot.dueOn) > WINDOW_DAYS) continue;
        if (!pays(c, slot.expected, false)) continue;
        // FR 8 «а без збігу мерчанта — тієї ж категорії»: the merchant's transaction first, then the closest.
        if (
          !best ||
          (c.merchant && !best.merchant) ||
          (c.merchant === best.merchant && distance(c, slot.dueOn) < distance(best, slot.dueOn))
        )
          best = c;
      }
      if (best) take(slot, best, "paid");
    }
    walk.learn(slot);
  }

  // FR 8: an unpaid charge may take a later transaction of the merchant — after its window, until the next one's closes.
  for (const slot of all) {
    // EC4: a charge before the day the payment was added is no miss — and is not paid late either.
    if (slot.paid || slot.status === "skipped" || slot.dueOn < input.createdOn) continue;
    const after = addDays(slot.dueOn, WINDOW_DAYS);
    const until = addDays(slot.nextDue, WINDOW_DAYS);
    for (const c of free.values())
      if (c.date > after && c.date <= until && c.date <= input.today && pays(c, slot.expected, true)) {
        take(slot, c, "paid-late");
        break;
      }
  }

  // FR 11: the expected amount once more over every payment, on time and late, oldest first.
  walk = amountWalk(input);
  for (const slot of all) {
    slot.expected = walk.expected;
    slot.amountChange = walk.learn(slot);
  }
  const { expected, changes } = walk;

  // FR 9, EC4: the statuses of the charges without a payment.
  const shown: Slot[] = [];
  for (const slot of all) {
    if (!slot.paid && slot.status !== "skipped") {
      if (slot.dueOn < input.createdOn) continue;
      slot.status = input.today >= addDays(slot.dueOn, WINDOW_DAYS) ? "overdue" : "expected";
    }
    shown.push(slot);
  }

  // FR 10: misses in a row, the latest first, since the day added or «Залишити».
  const countFrom = input.keptOn !== null && input.keptOn > input.createdOn ? input.keptOn : input.createdOn;
  let missesInRow = 0;
  for (let i = shown.length - 1; i >= 0; i -= 1) {
    const s = shown[i]!;
    if (s.status === "expected") continue;
    if (s.dueOn < countFrom || s.status === "paid" || s.status === "paid-late") break;
    missesInRow += 1;
  }

  const charges: TrackedCharge[] = shown.map((s) => ({
    dueOn: s.dueOn,
    expected: s.expected,
    status: s.status,
    transactionId: s.paid?.id ?? null,
    paidOn: s.paid?.date ?? null,
    amount: s.paid?.amount ?? null,
    overdueDays: s.status === "overdue" ? daysBetween(s.dueOn, input.today) : null,
    markedOn: s.markedOn,
    approximate: s.paid?.approximate ?? false,
    amountChange: s.amountChange,
  }));
  const latestPaid = [...shown].reverse().find((s) => s.paid !== null);
  return {
    charges,
    expected,
    amountChange: latestPaid?.amountChange ?? null,
    changes,
    missesInRow,
    state: missesInRow >= missesToFlag(input.frequency) ? "possibly-cancelled" : "active",
    approximate: charges.some((c) => c.approximate),
    used: shown.flatMap((s) => (s.paid ? [s.paid.id] : [])),
  };
}

/** FR 20, FR 21: what the user may do with a charge — mark an overdue one skipped, pay an overdue or skipped one. */
export function canSkip(charge: Pick<TrackedCharge, "status">): boolean {
  return charge.status === "overdue";
}

export function canSettle(charge: Pick<TrackedCharge, "status">): boolean {
  return charge.status === "overdue" || charge.status === "skipped";
}
