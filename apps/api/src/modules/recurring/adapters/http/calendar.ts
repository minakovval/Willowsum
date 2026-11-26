import { isCalendarDate } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { REPORTING_CURRENCY } from "../../../fx-rates/index.ts";
import {
  buildCalendar,
  HISTORY_DAYS,
  trackSpace,
  type CalendarCharge,
  type LoanAccount,
} from "../../application/index.ts";
import {
  addDays,
  CALENDAR_DAYS,
  CALENDAR_MAX_DAYS,
  CHARGE_STATUSES,
  PAYMENT_TYPES,
} from "../../domain/index.ts";
import { recurringTx } from "../db/store.ts";
import { recurringServices } from "./services.ts";

/**
 * BUD-07@PoC FR 7, FR 16, FR 19 (wave 2 row 26, the rest of part b2): the calendar and the list of «Регулярні платежі» —
 * every charge from a date over 1–366 days (30 by default), with the monthly payments of «Кредит» accounts, the totals of
 * the month and the year in the reporting currency, and the current period's header of the budget card «Регулярні
 * платежі». Read only (the statuses' read writes the expected amount the charges changed). The space is the session's:
 * another space sees only its own (AC9); a scoped member — not found, as the other reads of the module.
 */
const MODULE = "recurring";
const FEATURE = "recurring.payments";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD" });

const calendarChargeSchema = z.object({
  /** `payment` — a regular payment's charge; `loan` — FR 16, the monthly payment of a «Кредит» account. */
  kind: z.enum(["payment", "loan"]),
  /** The regular payment; null for a loan's payment (not stored as a regular payment). */
  paymentId: z.uuid().nullable(),
  /** «рахунок списання» of a payment (null — none given); the «Кредит» account of a loan's payment. */
  accountId: z.uuid().nullable(),
  /** The payment's name, or the loan account's. */
  name: z.string(),
  type: z.enum(PAYMENT_TYPES),
  /** «Підписка» — the group «Підписки». */
  subscription: z.boolean(),
  /** «Змінна сума». */
  variable: z.boolean(),
  dueOn: z.string(),
  /** The amount expected for this charge, positive, in the payment's currency. */
  expectedAmount: moneySchema,
  /** As the charges of the payment (FR 9); a loan's payment is `paid`, `expected` or `overdue` only. */
  status: z.enum(CHARGE_STATUSES),
  overdueDays: z.number().int().nullable(),
  /** The transaction that paid it — for a loan, the month's first payment to the account. */
  transactionId: z.uuid().nullable(),
  paidOn: z.string().nullable(),
  /** FR 10: false — the payment is «Можливо, скасований»: shown, in no total and not in «Можна витратити». */
  counted: z.boolean(),
  /**
   * FR 16: the interest of a loan's month — the only spending of the payment: the debt before the month's first payment
   * (today's while unpaid) × the annual rate ÷ 12, to the cent half to even. Null — a regular payment, no rate, or a
   * later month.
   */
  interest: moneySchema.nullable(),
});

const presentCharge = (c: CalendarCharge): z.input<typeof calendarChargeSchema> => ({
  kind: c.kind,
  paymentId: c.paymentId,
  accountId: c.accountId,
  name: c.name,
  type: c.type,
  subscription: c.subscription,
  variable: c.variable,
  dueOn: c.dueOn,
  expectedAmount: c.expected.toJSON(),
  status: c.status,
  overdueDays: c.overdueDays,
  transactionId: c.transactionId,
  paidOn: c.paidOn,
  counted: c.counted,
  interest: c.interest?.toJSON() ?? null,
});

const loanSchema = z.object({
  accountId: z.uuid(),
  name: z.string(),
  /** Null — «Додайте ставку і платіж»: no planned payment. */
  monthlyPayment: moneySchema.nullable(),
  /** Per cent a year; null — none. */
  annualRate: z.string().nullable(),
});

const presentLoan = (l: LoanAccount): z.input<typeof loanSchema> => ({
  accountId: l.accountId,
  name: l.name,
  monthlyPayment: l.monthlyPayment?.toJSON() ?? null,
  annualRate: l.annualRate,
});

const totalsSchema = z.object({
  /** The reporting currency of every figure. */
  currency: z.string(),
  /** The current month (YYYY-MM): «<сума> за <місяць>». */
  month: z.string(),
  /**
   * The month's expense charges of the counted payments (not «Пропущено») and the loans' monthly payments, at today's
   * rate. Each figure null — one of its amounts has no rate at all.
   */
  expenses: moneySchema.nullable(),
  /** «Підписки · N … / міс.». */
  subscriptions: moneySchema.nullable(),
  /** «Платежі за кредитами … / міс.». */
  loans: moneySchema.nullable(),
  /** «Регулярний дохід … / міс.». */
  incomes: moneySchema.nullable(),
  /** «За рік»: a year of each payment counted today (52, 26, 12, 4 or 1 charges) and 12 of each loan's payment. */
  yearExpenses: moneySchema.nullable(),
  yearIncomes: moneySchema.nullable(),
  /** «приблизно»: some amount at the nearest earlier rate; gone once today's rate is there. */
  approximate: z.boolean(),
});

const periodSchema = z.object({
  /** The current month (YYYY-MM) — the budget's period. */
  month: z.string(),
  /** M of «сплачено N з M»: the month's expense charges of the counted payments and the loans' payments. */
  charges: z.number().int(),
  /** N: «Сплачено» and «Сплачено із запізненням». */
  paid: z.number().int(),
  /** K of «K прострочено». */
  overdue: z.number().int(),
  /** X of «лишилось X»: the charges «Очікується» and «Прострочено», at today's rate; null — one without a rate. */
  remaining: moneySchema.nullable(),
  approximate: z.boolean(),
});

const calendarSchema = z.object({
  from: z.string(),
  /** The last day, included. */
  to: z.string(),
  /** By date, then name. */
  items: z.array(calendarChargeSchema),
  /** FR 16: the space's active «Кредит» accounts, in the order added. */
  loans: z.array(loanSchema),
  totals: totalsSchema,
  /** FR 19: the header of the budget card «Регулярні платежі». */
  period: periodSchema,
});

function invalid(path: string, issue: string): never {
  throw new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query", path, issue }] });
}

export const listRecurringCalendarRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/recurring/calendar",
  operationId: "listRecurringCalendar",
  summary:
    "The calendar of regular payments: the charges from a date over 1–366 days with the loans' monthly payments, the month's and the year's totals, the current period (BUD-07 FR 7, FR 16, FR 19)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      from: isoDate.optional().meta({
        description: "The first day, today by default; from 429 days before today to 366 days after it",
      }),
      days: z
        .string()
        .max(3)
        .optional()
        .meta({ description: "How many days, 1–366; 30 by default (FR 7 «горизонт»)" }),
    }),
  },
  response: {
    status: 200,
    description: "The charges in the range, the loans, the totals and the period, at today's rates",
    schema: calendarSchema,
  },
  handler: async ({ query }, ctx: ProtectedContext) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { tracking: deps, calendar } = recurringServices(ctx);
    const today = calendar.today();
    const from = query.from ?? today;
    if (!isCalendarDate(from)) invalid("from", "invalid");
    if (from < addDays(today, -(HISTORY_DAYS - 1)) || from > addDays(today, CALENDAR_MAX_DAYS))
      invalid("from", "out_of_range");
    const days =
      query.days === undefined ? CALENDAR_DAYS : /^\d{1,3}$/.test(query.days) ? Number(query.days) : NaN;
    if (!Number.isInteger(days)) invalid("days", "invalid");
    if (days < 1 || days > CALENDAR_MAX_DAYS) invalid("days", "out_of_range");
    const to = addDays(from, days - 1);

    const householdId = ctx.principal.householdId;
    const { payments, marks, holds } = await ctx.inHousehold(async (q) => ({
      payments: await recurringTx(q).payments(householdId),
      marks: await recurringTx(q).marks(householdId),
      holds: await recurringTx(q).holds(householdId),
    }));
    const tracking = await trackSpace(deps, householdId, payments, marks, holds);
    const result = await buildCalendar(
      calendar,
      householdId,
      payments,
      tracking,
      { from, to },
      REPORTING_CURRENCY,
    );
    const money = (m: { toJSON(): { amount: string; currency: string } } | null) => m?.toJSON() ?? null;
    return {
      from,
      to,
      items: result.items.map(presentCharge),
      loans: result.loans.map(presentLoan),
      totals: {
        currency: REPORTING_CURRENCY,
        month: result.totals.month,
        expenses: money(result.totals.expenses),
        subscriptions: money(result.totals.subscriptions),
        loans: money(result.totals.loans),
        incomes: money(result.totals.incomes),
        yearExpenses: money(result.totals.yearExpenses),
        yearIncomes: money(result.totals.yearIncomes),
        approximate: result.totals.approximate,
      },
      period: {
        month: result.period.month,
        charges: result.period.charges,
        paid: result.period.paid,
        overdue: result.period.overdue,
        remaining: money(result.period.remaining),
        approximate: result.period.approximate,
      },
    };
  },
});
