import { useId, type ReactNode } from "react";
import { formatDate, formatMoney, formatNumber, speakMoney, useI18n } from "@willowsum/i18n";
import { importPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import type { TransactionDetail } from "./detail.ts";

/**
 * IMP-02@PoC FR 4 in S-047 (canvas PocMoneyTxDetail, row «Опис у банку»; «Тексти» PocMoneyTxDetailTexts): what the
 * statement said about the transaction, read-only. The bank's description stays as printed (wrapped, never clamped,
 * GRID-00 FR 33); empty fields are not shown, so a hand-entered transaction (all of them `null`) shows nothing.
 */
export function BankDescriptionRow({ transaction }: { transaction: TransactionDetail }) {
  const { t } = useI18n();
  if (!transaction.bankDescription) return null;
  return (
    <div>
      <dt>{t("txDetail.bankDescription")}</dt>
      <dd>
        <span className="txd-bank-text">{transaction.bankDescription}</span>
      </dd>
    </div>
  );
}

export function StatementFacts({ transaction: tx }: { transaction: TransactionDetail }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const money = (m: { amount: string; currency: string }) => (
    <span aria-label={speakMoney(locale, m.amount, m.currency)}>
      {formatMoney(locale, m.amount, m.currency)}
    </span>
  );
  const rows: { key: string; label: string; value: ReactNode }[] = [];
  if (tx.originalAmount) {
    rows.push({ key: "original", label: t("txDetail.statement.original"), value: money(tx.originalAmount) });
    if (tx.exchangeRate)
      rows.push({
        key: "rate",
        label: t("txDetail.statement.rate"),
        value: formatNumber(locale, tx.exchangeRate),
      });
    // The settlement amount is the transaction's own amount: shown next to the original one it converts.
    rows.push({ key: "settled", label: t("txDetail.statement.settled"), value: money(tx.amount) });
  }
  if (tx.valueDate)
    rows.push({
      key: "value",
      label: t("txDetail.statement.valueDate"),
      value: formatDate(locale, tx.valueDate),
    });
  if (tx.balanceAfter)
    rows.push({ key: "balance", label: t("txDetail.statement.balance"), value: money(tx.balanceAfter) });
  if (tx.bankReference)
    rows.push({
      key: "reference",
      label: t("txDetail.statement.reference"),
      value: <span className="txd-bank-text">{tx.bankReference}</span>,
    });
  if (tx.importedFrom)
    rows.push({
      key: "origin",
      label: t("txDetail.statement.origin"),
      value: (
        <a href={hrefFor(importPath(tx.importedFrom.batchId, "result"))}>
          {t("txDetail.statement.row", { row: String(tx.importedFrom.row) })}
        </a>
      ),
    });
  if (rows.length === 0) return null;
  return (
    <section className="txd-statement" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-text-heading-3">
        {t("txDetail.statement.title")}
      </h2>
      <dl className="txd-facts">
        {rows.map((r) => (
          <div key={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
