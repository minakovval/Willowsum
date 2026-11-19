import type { Money } from "@willowsum/domain-kernel";
import type { CreditAccounts } from "../../accounts/index.ts";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { Liabilities } from "../../liabilities/index.ts";
import type { RecurringMonth } from "../../recurring/index.ts";
import type { AccountPayments } from "../../transactions/index.ts";
import type { BudgetObligations } from "../application/index.ts";
import { periodDays, type PeriodObligations } from "../domain/index.ts";

/** The most integer digits one amount of the port may have — as `parseBudgetAmount` takes a limit (#567). */
export const OBLIGATION_MAX_INTEGER_DIGITS = 15;

const tooBig = (m: Money) => m.amount.abs().truncated().toFixed().length > OBLIGATION_MAX_INTEGER_DIGITS;

/**
 * The port `BudgetObligations` over modules recurring, accounts, liabilities and transactions (#567; BUD-02@PoC FR 3,
 * FR 15, FR 16, FR 19; BUD-03@PoC FR 5):
 * - `recurring` — every expense charge of the month of an active payment (recurring's `RecurringMonth`), from `from` on
 *   for a proportional first period; `paid` — «Сплачено», «Сплачено із запізненням» or «Пропущено» (only «Очікується»
 *   and «Прострочено» are still owed, BUD-03 FR 5);
 * - `debtMinimums` — the monthly payment of each active «Кредит» account with one (liabilities; a loan without it —
 *   «Додайте ставку і платіж» — adds nothing), once a month; `paid` — the account got a payment in the month
 *   (transactions). A loan's payment is here only, never in `recurring` (recurring refuses a loan account), so
 *   «Розподіл» takes it once as a minimum payment and D adds it once while unpaid (lead decision, #567).
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
  return {
    async month(householdId, period, currency, from) {
      const days = periodDays(period);
      const charges = (await ports.recurring.chargesIn(householdId, period)).filter(
        (c) => c.type === "expense" && (from === undefined || c.dueOn >= from),
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
      const reported = await ports.fx.total(
        [...charges.map((c) => c.expected), ...loans.map((l) => l.amount)].map((amount) => ({
          amount,
          date: null,
        })),
        currency,
      );
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
        })),
        debtMinimums: loans.map((l, i) => ({
          accountId: l.accountId,
          amount: values[charges.length + i]!,
          paid: paid.has(l.accountId),
        })),
        approximate: reported.approximate,
      };
      return result;
    },
  };
}
