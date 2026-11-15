import {
  currencyInfo,
  Decimal,
  DomainError,
  isCalendarDate,
  isCurrencyCode,
  Money,
} from "@willowsum/domain-kernel";

/**
 * Savings goals (BUD-05@PoC FR 2–7, FR 10–12; wave 2 row 27): a goal of the space with a target, an optional date, a
 * start amount and exactly one part — «де лежать гроші». What is collected, the progress, the required monthly
 * contribution, the pace and the forecast date. Pure rules, no I/O; every amount is Money (never a float).
 */
export const GOAL_TEMPLATES = ["travel", "purchase", "emergency", "custom"] as const;
export type GoalTemplate = (typeof GOAL_TEMPLATES)[number];

/** «Окремий рахунок цілі», «Частина рахунку (конверт)», «Без рахунку — лише позначки» (FR 2). */
export const PART_KINDS = ["account", "envelope", "marks"] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const NAME_MAX = 60;
/** «Скільки місяців витрат» of «Подушка безпеки» (FR 10): 3 by default; 1–120 (lead decision). */
export const EMERGENCY_MONTHS_DEFAULT = 3;
export const EMERGENCY_MONTHS_MAX = 120;
/** The pace looks at the contributions of the last 3 months at most (FR 7). */
export const PACE_MONTHS = 3;
/** Days of an average month (365.25 / 12): the pace per month and the forecast date. */
const MONTH_DAYS = new Decimal("30.4375");
const DAY_MS = 24 * 60 * 60 * 1000;

const AMOUNT_RE = /^\d{1,20}(?:\.\d{1,18})?$/;

export interface GoalIssue {
  readonly field: string;
  readonly issue: string;
}

/** A non-negative amount as typed, with at most the currency's minor units; null when it is not one. */
export function parseAmount(text: string, currency: string): Money | null {
  if (!AMOUNT_RE.test(text) || !isCurrencyCode(currency)) return null;
  const amount = new Decimal(text);
  if (amount.decimalPlaces() > currencyInfo(currency).minorUnits) return null;
  try {
    return Money.of(amount, currency);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/** The goal as «Нова ціль» or «Змінити ціль» sends it (FR 2). */
export interface GoalInput {
  readonly template: GoalTemplate;
  readonly name: string;
  readonly target: { readonly amount: string; readonly currency: string };
  readonly targetDate?: string | null | undefined;
  readonly emergencyMonths?: number | null | undefined;
  readonly part?:
    | {
        readonly kind: PartKind;
        readonly accountId?: string | null | undefined;
        readonly startAmount?: string | undefined;
      }
    | undefined;
}

/** A goal's fields, checked. */
export interface GoalFields {
  readonly template: GoalTemplate;
  readonly name: string;
  readonly target: Money;
  readonly targetDate: string | null;
  readonly emergencyMonths: number | null;
  readonly partKind: PartKind;
  readonly accountId: string | null;
  readonly startAmount: Money;
}

/**
 * Checks a goal (FR 2). Without a part — the goal was created without opening step 2 — it has one part «Без рахунку —
 * лише позначки» with the start amount 0. `previousDate`: the stored date of a goal being changed, which may stay in the
 * past (FR 12 offers to extend it); a new or changed date is never before `today`.
 */
export function checkGoal(
  input: GoalInput,
  today: string,
  previousDate?: string | null,
):
  | { readonly kind: "ok"; readonly fields: GoalFields }
  | { readonly kind: "invalid"; readonly issues: GoalIssue[] } {
  const issues: GoalIssue[] = [];
  const name = input.name.trim();
  if (name.length === 0) issues.push({ field: "name", issue: "required" });
  else if ([...name].length > NAME_MAX || /[\r\n]/.test(name))
    issues.push({ field: "name", issue: "too_long" });
  const currency = input.target.currency;
  const target = parseAmount(input.target.amount, currency);
  if (target === null || target.isZero()) issues.push({ field: "target.amount", issue: "invalid" });
  const targetDate = input.targetDate ?? null;
  if (targetDate !== null) {
    if (!isCalendarDate(targetDate)) issues.push({ field: "targetDate", issue: "invalid" });
    else if (targetDate < today && targetDate !== previousDate)
      issues.push({ field: "targetDate", issue: "past" });
  }
  let emergencyMonths: number | null = null;
  if (input.template === "emergency") {
    emergencyMonths = input.emergencyMonths ?? EMERGENCY_MONTHS_DEFAULT;
    if (!Number.isInteger(emergencyMonths) || emergencyMonths < 1 || emergencyMonths > EMERGENCY_MONTHS_MAX)
      issues.push({ field: "emergencyMonths", issue: "invalid" });
  } else if (input.emergencyMonths !== undefined && input.emergencyMonths !== null)
    issues.push({ field: "emergencyMonths", issue: "not_emergency" });
  const part = input.part ?? { kind: "marks" as const };
  const accountId = part.accountId ?? null;
  if (part.kind === "marks" && accountId !== null)
    issues.push({ field: "part.accountId", issue: "marks_only" });
  if (part.kind !== "marks" && accountId === null)
    issues.push({ field: "part.accountId", issue: "required" });
  const startText = part.startAmount ?? "0";
  const start = isCurrencyCode(currency) ? parseAmount(startText, currency) : null;
  if (start === null) issues.push({ field: "part.startAmount", issue: "invalid" });
  else if (part.kind === "account" && !start.isZero())
    // Collected of an own account is its balance (FR 2): a start amount would count twice.
    issues.push({ field: "part.startAmount", issue: "account_part" });
  if (issues.length > 0 || target === null || start === null) return { kind: "invalid", issues };
  return {
    kind: "ok",
    fields: {
      template: input.template,
      name,
      target,
      targetDate,
      emergencyMonths,
      partKind: part.kind,
      accountId,
      startAmount: start,
    },
  };
}

/** A contribution «Внести» as sent (FR 6): a positive amount in the goal's currency, today or an earlier day. */
export function checkContribution(
  input: {
    readonly amount: { readonly amount: string; readonly currency: string };
    readonly date?: string | undefined;
  },
  goal: { readonly currency: string; readonly createdOn: string },
  today: string,
):
  | { readonly kind: "ok"; readonly amount: Money; readonly date: string }
  | { readonly kind: "invalid"; readonly issues: GoalIssue[] } {
  const issues: GoalIssue[] = [];
  const amount =
    input.amount.currency === goal.currency ? parseAmount(input.amount.amount, goal.currency) : null;
  if (input.amount.currency !== goal.currency)
    issues.push({ field: "amount.currency", issue: "goal_currency" });
  else if (amount === null || amount.isZero()) issues.push({ field: "amount.amount", issue: "invalid" });
  const date = input.date ?? today;
  if (!isCalendarDate(date)) issues.push({ field: "date", issue: "invalid" });
  else if (date > today) issues.push({ field: "date", issue: "future" });
  else if (date < goal.createdOn) issues.push({ field: "date", issue: "before_goal" });
  if (issues.length > 0 || amount === null) return { kind: "invalid", issues };
  return { kind: "ok", amount, date };
}

/**
 * FR 3: the envelopes of an account never exceed its balance. `reserved` — every envelope on the account with the one
 * being saved; returns by how much they exceed it («Сума конвертів перевищує залишок рахунку на N €»), or null.
 */
export function envelopeExcess(balance: Money, reserved: Money): Money | null {
  const excess = reserved.minus(balance);
  return excess.isNegative() || excess.isZero() ? null : excess;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Whole calendar months from this month to the month of the date — at least 1 (lead decision). */
export function monthsUntil(targetDate: string, today: string): number {
  return Math.max(1, monthIndex(targetDate) - monthIndex(today));
}

/**
 * FR 5: (target − collected) ÷ months until the date, rounded up to a whole unit of the currency (assumption of
 * BUD-05: 3 000 € ÷ 9 = 333,33 € → 334 €); 0 once collected. Null without a date (FR 12) or when the date has passed.
 */
export function requiredMonthly(
  target: Money,
  collected: Money,
  targetDate: string | null,
  today: string,
): Money | null {
  if (targetDate === null || targetDate < today) return null;
  const remaining = target.minus(collected);
  if (remaining.isNegative() || remaining.isZero()) return Money.zero(target.currency);
  const monthly = remaining.amount
    .div(String(monthsUntil(targetDate, today)))
    .toDecimalPlaces(0, Decimal.ROUND_CEIL);
  return Money.of(monthly, target.currency);
}

/** The progress in percent, rounded down to one decimal (lead decision: never «100 %» before the target). */
export function progressPercent(collected: Money, target: Money): string {
  const share = collected.amount.isNegative()
    ? new Decimal("0")
    : collected.amount.times("100").div(target.amount);
  return share.toDecimalPlaces(1, Decimal.ROUND_DOWN).toFixed(1);
}

/** The day `days` after a date (negative — before). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from one date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * FR 7: the first day of the pace's window — 3 calendar months back from today (the day after the same day three
 * months before), never before the goal was created.
 */
export function paceWindowStart(createdOn: string, today: string): string {
  const [y, m, d] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10))];
  const back = new Date(Date.UTC(y, m - 1 - PACE_MONTHS, 1));
  const lastDay = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(d, lastDay));
  const start = addDays(back.toISOString().slice(0, 10), 1);
  return start > createdOn ? start : createdOn;
}

/**
 * FR 7: the pace per month — what came in during the window (contributions; for an own account the growth of its
 * balance) over the window's months, at least one month (lead decision: a goal of a few days does not extrapolate a
 * single contribution). Null without growth.
 */
export function pacePerMonth(cameIn: Money, windowStart: string, today: string): Money | null {
  if (cameIn.isNegative() || cameIn.isZero()) return null;
  const months = Decimal.max("1", new Decimal(String(daysBetween(windowStart, today) + 1)).div(MONTH_DAYS));
  return Money.of(cameIn.amount.div(months), cameIn.currency);
}

/** FR 7: the forecast date at the pace; null once collected, without a pace or beyond 100 years. */
export function forecastDate(remaining: Money, pace: Money | null, today: string): string | null {
  if (pace === null || remaining.isNegative() || remaining.isZero()) return null;
  const days = remaining.amount.div(pace.amount).times(MONTH_DAYS).toDecimalPlaces(0, Decimal.ROUND_CEIL);
  if (days.greaterThan(36_525)) return null;
  // A count of days, not an amount.
  return addDays(today, Number.parseInt(days.toFixed(0), 10));
}

/** What a goal shows (FR 4, FR 5, FR 7, FR 12, FR 13). */
export interface GoalProgress {
  readonly collected: Money;
  readonly progressPercent: string;
  /** «✓ Досягнуто» (FR 4): collected reached the target. */
  readonly achieved: boolean;
  /** «+ N € понад ціль»; null unless over the target. */
  readonly overTarget: Money | null;
  readonly requiredMonthly: Money | null;
  /** FR 12: the date has passed before the target was reached — offer to extend it, change the amount or close. */
  readonly overdue: boolean;
  readonly pace: Money | null;
  readonly forecastDate: string | null;
}

export function goalProgress(input: {
  readonly target: Money;
  readonly targetDate: string | null;
  readonly collected: Money;
  /** What came in during the pace's window (FR 7). */
  readonly cameIn: Money;
  readonly windowStart: string;
  readonly today: string;
}): GoalProgress {
  const { target, collected, today } = input;
  const remaining = target.minus(collected);
  const achieved = remaining.isNegative() || remaining.isZero();
  const pace = pacePerMonth(input.cameIn, input.windowStart, today);
  return {
    collected,
    progressPercent: progressPercent(collected, target),
    achieved,
    overTarget: remaining.isNegative() ? remaining.negated() : null,
    requiredMonthly: requiredMonthly(target, collected, input.targetDate, today),
    overdue: input.targetDate !== null && input.targetDate < today && !achieved,
    pace,
    forecastDate: forecastDate(remaining, pace, today),
  };
}
