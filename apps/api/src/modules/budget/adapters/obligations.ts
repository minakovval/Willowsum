import { AmountOutOfRangeError, Money } from "@willowsum/domain-kernel";
import type { CreditAccounts } from "../../accounts/index.ts";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { Liabilities } from "../../liabilities/index.ts";
import type { RecurringMonth } from "../../recurring/index.ts";
import type { AccountPayments } from "../../transactions/index.ts";
import type { BudgetObligations } from "../application/index.ts";
import { periodDays, type PeriodObligations } from "../domain/index.ts";
import { BUDGET_MAX_INTEGER_DIGITS, overBudgetCap as tooBig } from "./money-range.ts";

/** The most integer digits one amount of the port may have — as `parseBudgetAmount` takes a limit (#567). */
export const OBLIGATION_MAX_INTEGER_DIGITS = BUDGET_MAX_INTEGER_DIGITS;

/**
 * The port `BudgetObligations` over modules recurring, accounts, liabilities and transactions (#567; BUD-02@PoC FR 3,
 * FR 15, FR 16, FR 19; BUD-03@PoC FR 5):
 * - `recurring` — every expense charge of the month of an active payment (recurring's `RecurringMonth`), from `from` on
 *   for a proportional first period; `paid` — «Сплачено», «Сплачено із запізненням» or «Пропущено» (only «Очікується»
 *   and «Прострочено» are still owed, BUD-03 FR 5);
 * - `debtMinimums` — the monthly payment of each active «Кредит» account with one (liabilities; a loan without it —
 *   «Додайте ставку і платіж» — adds nothing), once a month; `paid` — the account got a payment in the month
 *   (transactions). A loan's payment is here only, never in `recurring` (recurring refuses a loan account), so
 *   «Розподіл» takes it once as a minimum payment and D adds it once while unpaid (lead decision, #567);
 * - `incomeExpected` — the income charges of the month still to come (BUD-03@PoC FR 3), from `from` on as well; null —
 *   one has no rate (only «Можна витратити» needs it, so the rest of the month's figures stay).
 * Every amount in `currency` at today's rate (BUD-03 «Суми в інших валютах — за поточним курсом»; the nearest one —
 * `approximate`). Null — some amount has no rate at all, or one is over 15 integer digits: no figure beats a wrong one,
 * and no sum overflows the money type.
 */
export function createBudgetObligations(ports: {
  readonly recurring: RecurringMonth;
  readonly credit: Pick<CreditAccounts, "list">;
  readonly liabilities: Pick<Liabilities, "forAccount">;
  readonly payments: AccountPayments;
  readonly fx: Pick<FxReporting, "total">;
}): BudgetObligations {
  /** The incomes' sum in `currency` at today's rate; null — one without a rate or out of range (their own figure only). */
  async function incomeSum(amounts: readonly Money[], currency: string): Promise<Money | null> {
    const zero = Money.zero(currency);
    if (amounts.length === 0) return zero;
    if (amounts.some(tooBig)) return null;
    try {
      const reported = await ports.fx.total(
        amounts.map((amount) => ({ amount, date: null })),
        currency,
      );
      let total = zero;
      for (const item of reported.items) {
        if (item.kind === "rate-unavailable" || tooBig(item.value)) return null;
        total = total.plus(item.value);
      }
      return tooBig(total) ? null : total;
    } catch (error) {
      if (error instanceof AmountOutOfRangeError) return null;
      throw error;
    }
  }
  return {
    async month(householdId, period, currency, from) {
      const days = periodDays(period);
      const month = (await ports.recurring.chargesIn(householdId, period)).filter(
        (c) => from === undefined || c.dueOn >= from,
      );
      const charges = month.filter((c) => c.type === "expense");
      // BUD-03@PoC FR 3: the regular incomes not come yet — only «Очікується» and «Прострочено» are still to come.
      const incomes = month.filter(
        (c) => c.type === "income" && (c.status === "expected" || c.status === "overdue"),
      );
      const loans: { accountId: string; amount: Money }[] = [];
      for (const a of await ports.credit.list(householdId)) {
        if (a.kind !== "loan") continue;
        const terms = await ports.liabilities.forAccount(householdId, a.accountId);
        if (terms?.monthlyPayment) loans.push({ accountId: a.accountId, amount: terms.monthlyPayment });
      }
      const paid =
        loans.length === 0
          ? new Set<string>()
          : await ports.payments.paidIn(
              householdId,
              loans.map((l) => l.accountId),
              days.from,
              days.to,
            );
      // The cap before any sum or conversion: the rates' reader adds the amounts up itself (#567).
      const amounts = [...charges.map((c) => c.expected), ...loans.map((l) => l.amount)];
      if (amounts.some(tooBig)) return null;
      let reported: Awaited<ReturnType<typeof ports.fx.total>>;
      try {
        reported = await ports.fx.total(
          amounts.map((amount) => ({ amount, date: null })),
          currency,
        );
      } catch (error) {
        // Many capped amounts at a big rate can still leave the money type: no figure, never a 500.
        if (error instanceof AmountOutOfRangeError) return null;
        throw error;
      }
      const values: Money[] = [];
      for (const item of reported.items) {
        if (item.kind === "rate-unavailable" || tooBig(item.value)) return null;
        values.push(item.value);
      }
      const result: PeriodObligations = {
        recurring: charges.map((c, i) => ({
          categoryId: c.categoryId,
          amount: values[i]!,
          paid: c.status !== "expected" && c.status !== "overdue",
          paymentId: c.paymentId,
          dueOn: c.dueOn,
          overdueDays: c.status === "overdue" ? c.overdueDays : null,
        })),
        debtMinimums: loans.map((l, i) => ({
          accountId: l.accountId,
          amount: values[charges.length + i]!,
          paid: paid.has(l.accountId),
        })),
        approximate: reported.approximate,
        incomeExpected: await incomeSum(
          incomes.map((c) => c.expected),
          currency,
        ),
      };
      return result;
    },
  };
}
