import { useId } from "react";
import { formatMoney, speakMoney, useI18n } from "@willowsum/i18n";
import type { TransactionDetail } from "./detail.ts";

/**
 * FIN-03@PoC FR 8, AC31 and IMP-03@PoC FR 21 in S-047: a transfer between two currencies keeps the actual amounts, and the
 * difference between the credited amount and the amount at the NBU rate of the date is a loss (an expense of the budget)
 * or a gain (an income), one category «Комісії банку» (owner, 2026-11-26, decision 11). The server gives it as
 * `transfer.currencyDifference` (negative — a loss); the screen only shows it, with no arithmetic. Nothing is shown for a
 * transaction that is no transfer, a transfer in one currency or one with no difference.
 */
export function TransferDifference({ transaction }: { transaction: TransactionDetail }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const difference = transaction.transfer?.currencyDifference;
  // A zero (or no) difference is no difference: nothing to show. The amount is read as text, never as a number.
  if (!difference || /^[-+]?0*(\.0*)?$/.test(difference.amount)) return null;
  const loss = difference.amount.startsWith("-");
  return (
    <section className="txd-statement txd-transfer-difference" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-text-heading-3">
        {t("txDetail.transfer.title")}
      </h2>
      <dl className="txd-facts">
        <div>
          <dt>{t(loss ? "txDetail.transfer.loss" : "txDetail.transfer.gain")}</dt>
          <dd>
            <span aria-label={speakMoney(locale, difference.amount, difference.currency, { signed: true })}>
              {formatMoney(locale, difference.amount, difference.currency, { signed: true })}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("txDetail.transfer.budget")}</dt>
          <dd>{t(loss ? "txDetail.transfer.budget.expense" : "txDetail.transfer.budget.income")}</dd>
        </div>
      </dl>
    </section>
  );
}
