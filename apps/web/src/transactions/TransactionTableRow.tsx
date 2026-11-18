import { formatLocaleOf, useI18n, type Locale } from "@willowsum/i18n";
import { TransactionRow, type TransactionCategory } from "@willowsum/ui";
import { hrefFor } from "../routing/useHashPath.ts";
import { transactionPath } from "../routing/routes.ts";
import type { TransactionItem } from "./list.ts";

/**
 * One row of the transactions table (CMP-28 `table` form, columns Контрагент · Категорія · Рахунок · Дата і час · Сума).
 * GRID-02@PoC FR 6, AC3: the list «Транзакції» and the «Транзакції» block of «Картка рахунку» render their rows here,
 * so the two tables have the same columns and behaviour. Without `onSelectedChange` the row has no checkbox.
 */
export function TransactionTableRow({
  item,
  category,
  account,
  selected = false,
  onSelectedChange,
}: {
  item: TransactionItem;
  category: TransactionCategory | null;
  account: string | undefined;
  selected?: boolean;
  onSelectedChange?: ((selected: boolean) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <TransactionRow
      layout="table"
      selected={selected}
      onSelectedChange={onSelectedChange}
      withAsset={false}
      merchant={item.counterparty ?? t("accountCard.tx.noCounterparty")}
      date={item.date}
      time={timeOf(locale, item.recordedAt)}
      category={category}
      account={account}
      amount={{ value: item.amount.amount, currency: item.amount.currency }}
      pending={item.status === "pending"}
      transfer={item.transfer !== null}
      split={item.split ? (item.split.mode === "months" ? item.split.parts.length : true) : undefined}
      tags={item.tags.map((tag) => tag.name)}
      note={item.note !== null && item.note !== ""}
      href={hrefFor(transactionPath(item.id))}
    />
  );
}

/** The time under the date: when the transaction was recorded, in the browser's time zone («09:14»). */
function timeOf(locale: Locale, instant: string): string | undefined {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return undefined;
  return new Intl.DateTimeFormat(formatLocaleOf(locale), { hour: "2-digit", minute: "2-digit" }).format(at);
}
