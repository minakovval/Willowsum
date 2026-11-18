import { Decimal } from "@willowsum/domain-kernel";
import { formatMoney, useI18n, type Locale, type MessageParams, type Translate } from "@willowsum/i18n";
import { StatusMark } from "@willowsum/ui";
import { shortDate } from "./format.ts";
import type { Charge, Payment, Status } from "./data.ts";

/** BUD-07@PoC FR 9: the dictionary entry (DS-23 families Д and Е) and its words for one charge. */
export function chargeMark(
  locale: Locale,
  type: Payment["type"],
  charge: Charge,
): { id: string; params: MessageParams } {
  const family = type === "income" ? "e" : "d";
  const date = shortDate(locale, charge.paidOn ?? charge.dueOn);
  switch (charge.status) {
    case "paid":
      return { id: type === "income" ? "e.received" : "d.paid", params: { date } };
    case "paid-late":
      return { id: type === "income" ? "e.receivedLate" : "d.paidLate", params: { date } };
    case "overdue":
      return {
        id: type === "income" ? "e.missing" : "d.overdue",
        params: { days: charge.overdueDays ?? 0 },
      };
    case "skipped":
      return { id: `${family}.skipped`, params: {} };
    case "expected":
      return { id: `${family}.expected`, params: {} };
  }
}

export function ChargeStatus({
  type,
  charge,
  markerOnly = false,
}: {
  type: Payment["type"];
  charge: Charge;
  markerOnly?: boolean;
}) {
  const { locale } = useI18n();
  const mark = chargeMark(locale, type, charge);
  return <StatusMark id={mark.id} params={mark.params} markerOnly={markerOnly} />;
}

/**
 * FR 9: a change of the amount is a mark beside the amount, «▲ 2,00 €», with the tooltip «Сума зросла з 9,99 € (30 жовт.)».
 * The two amounts are subtracted only in one currency (a change across currencies shows no figure).
 */
export function amountChangeMark(
  t: Translate,
  locale: Locale,
  type: Payment["type"],
  change: NonNullable<Status["amountChange"]>,
): { id: string; amount: string; title: string } | null {
  if (change.from.currency !== change.to.currency) return null;
  const delta = new Decimal(change.to.amount).minus(change.from.amount);
  if (delta.isZero()) return null;
  const rose = delta.gt(0);
  const direction = rose ? "rise" : "fall";
  const id = `f.${direction}${type === "income" ? "Income" : "Expense"}`;
  const title = t(rose ? "recurring.change.rose" : "recurring.change.fell", {
    from: formatMoney(locale, change.from.amount, change.from.currency),
    date: shortDate(locale, change.on),
  });
  return { id, amount: formatMoney(locale, delta.abs().toFixed(), change.to.currency), title };
}

export function AmountChange({
  type,
  change,
}: {
  type: Payment["type"];
  change: NonNullable<Status["amountChange"]>;
}) {
  const { t, locale } = useI18n();
  const mark = amountChangeMark(t, locale, type, change);
  if (!mark) return null;
  return (
    <span className="rec-change" title={mark.title}>
      <StatusMark id={mark.id} params={{ amount: mark.amount }} spokenText={mark.title} />
    </span>
  );
}
