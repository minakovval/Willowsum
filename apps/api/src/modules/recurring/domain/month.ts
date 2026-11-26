import type { Money } from "@willowsum/domain-kernel";
import type { PaymentFields } from "./payments.ts";
import { daysBetween, FREQUENCY_RULES, scheduleDate } from "./schedule.ts";
import { heldOn, type ChargeStatus, type Tracking } from "./tracking.ts";

/**
 * The charges of a payment expected in one calendar month (BUD-03@PoC FR 5, BUD-02@PoC FR 16; BUD-07@PoC FR 17: a
 * charge is a projection of the schedule): the tracked ones with their status, and the schedule's later dates of the
 * month — «Очікується» at the expected amount now. No I/O.
 */
export interface MonthCharge {
  readonly paymentId: string;
  readonly type: PaymentFields["type"];
  readonly categoryId: string | null;
  readonly dueOn: string;
  /** In the payment's currency: the expected amount of the charge (not what a transaction paid). */
  readonly expected: Money;
  readonly status: ChargeStatus;
  readonly overdueDays: number | null;
  /** The transaction that paid it (FR 9 «з посиланням на транзакцію»); null — not paid. */
  readonly transactionId: string | null;
  /** The paying transaction's date; null — not paid. */
  readonly paidOn: string | null;
}

/** The dates of the schedule from `from` to `to`, both included (before the anchor too, as the tracking counts). */
export function scheduleBetween(
  anchor: string,
  frequency: PaymentFields["frequency"],
  from: string,
  to: string,
): string[] {
  const step = FREQUENCY_RULES[frequency].step;
  const stepDays = "days" in step ? step.days : step.months * 30.4375;
  let k = Math.round(daysBetween(anchor, from) / stepDays);
  while (scheduleDate(anchor, frequency, k - 1) >= from) k -= 1;
  while (scheduleDate(anchor, frequency, k) < from) k += 1;
  const out: string[] = [];
  for (let d = scheduleDate(anchor, frequency, k); d <= to; d = scheduleDate(anchor, frequency, ++k))
    out.push(d);
  return out;
}

const lastDay = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * BUD-03@PoC FR 5: the month's charges of one payment. A payment «Можливо, скасований» has none (FR 5 counts only an
 * active one), nor one after its end date; BUD-07 FR 13: nor a date it holds — paused, or from the month it was marked
 * cancelled (a paid charge stays: the tracking shows it). While paused, «його списання і частка в «Можна витратити»
 * зникають» (BUD-03 FR 5 «не призупиненого»): an unpaid charge due before the pause began is left out too — it stays
 * in the payment's history only; a date after a dated pause counts again. A date the tracking covers takes its status (a charge before the day the
 * payment was added, without a payment, is not shown — BUD-07 EC4); a later date (after today) is «Очікується» at the expected amount.
 */
export function chargesInMonth(
  payment: Pick<PaymentFields, "frequency" | "anchorDate" | "endDate" | "type" | "categoryId"> & {
    readonly id: string;
  },
  tracking: Tracking,
  month: string,
  today: string,
): MonthCharge[] {
  return chargesBetween(payment, tracking, `${month}-01`, lastDay(month), today);
}

/**
 * `chargesInMonth` for any dates from `from` to `to`, both included (BUD-07@PoC FR 7: the calendar and the list of 30 to
 * 366 days). `flagged: "shown"` keeps the charges of a payment «Можливо, скасований» (FR 10: «лишається в списку»; the
 * calendar shows them, the totals do not count them); a hold still hides what it hides (FR 13).
 */
export function chargesBetween(
  payment: Pick<PaymentFields, "frequency" | "anchorDate" | "endDate" | "type" | "categoryId"> & {
    readonly id: string;
  },
  tracking: Tracking,
  from: string,
  to: string,
  today: string,
  options: { readonly flagged?: "left-out" | "shown" } = {},
): MonthCharge[] {
  // The pause that holds today: unpaid charges due up to its end are out of the month while it lasts.
  const pause =
    tracking.hold === "paused"
      ? tracking.holds.find(
          (h) => h.kind === "pause" && h.from <= today && (h.until === null || h.until >= today),
        )
      : undefined;
  // «Можливо, скасований» has no charges — but the end of a dated pause counts the misses anew, so its later dates do.
  const flagged = tracking.state === "possibly-cancelled";
  if (flagged && options.flagged !== "shown" && (!pause || pause.until === null)) return [];
  const tracked = new Map(tracking.charges.map((c) => [c.dueOn, c]));
  const covered = tracking.charges.reduce((last, c) => (c.dueOn > last ? c.dueOn : last), "");
  const end = payment.endDate !== null && payment.endDate < to ? payment.endDate : to;
  const out: MonthCharge[] = [];
  for (const dueOn of scheduleBetween(payment.anchorDate, payment.frequency, from, end)) {
    const c = tracked.get(dueOn);
    if (!c && (dueOn <= covered || dueOn <= today || heldOn(tracking.holds, dueOn))) continue;
    if (
      pause &&
      (pause.until === null || dueOn <= pause.until) &&
      (flagged || !c || c.status === "expected" || c.status === "overdue")
    )
      continue;
    out.push({
      paymentId: payment.id,
      type: payment.type,
      categoryId: payment.categoryId,
      dueOn,
      expected: c?.expected ?? tracking.expected,
      status: c?.status ?? "expected",
      overdueDays: c?.overdueDays ?? null,
      transactionId: c?.transactionId ?? null,
      paidOn: c?.paidOn ?? null,
    });
  }
  return out;
}

/** A charge of a finished month as «Підсумок періоду» shows it: its status now and the day it was paid. */
export type FinishedMonthCharge = MonthCharge;

/**
 * FLW-38@PoC FR 1 (S-135 «Підсумок періоду», card «Регулярні платежі»): the charges of a finished month of one payment,
 * as its history is — whatever the payment's state is now («Можливо, скасований» or ended later keeps the charges it had
 * in that month). Only the charges the tracking covers: one before the day the payment was added, without a payment, is
 * not shown (BUD-07 EC4). No I/O.
 */
export function chargesOfFinishedMonth(
  payment: Pick<PaymentFields, "type" | "categoryId"> & { readonly id: string },
  tracking: Pick<Tracking, "charges">,
  month: string,
): FinishedMonthCharge[] {
  return tracking.charges
    .filter((c) => c.dueOn.slice(0, 7) === month)
    .map((c) => ({
      paymentId: payment.id,
      type: payment.type,
      categoryId: payment.categoryId,
      dueOn: c.dueOn,
      expected: c.expected,
      status: c.status,
      overdueDays: c.overdueDays,
      transactionId: c.transactionId,
      paidOn: c.paidOn,
    }));
}
