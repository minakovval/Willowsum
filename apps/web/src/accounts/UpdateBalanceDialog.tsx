import { useState } from "react";
import { Money } from "@willowsum/domain-kernel";
import { formatLocaleOf, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { AmountField, Dialog, Icon, Select } from "@willowsum/ui";
import { useAuthApi } from "../auth/api.ts";
import type { AccountDetail } from "./card.ts";
import { maskedNumber, money, negated } from "./format.ts";
import { updateBalance } from "./manage.ts";

/** «на 2 листопада» (uk), «on 2 November» (en): the day without the year. */
function longDay(locale: string, isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)),
  );
}

/**
 * S-055a «Оновити залишок» (FIN-12@PoC FR 14, FR 15, AC13–AC16; canvas PocMoneyAccBalance), on the CMP-21 a) dialog:
 * the balance in Willowsum today (read only), «Поточний залишок*» in the account's currency and the difference that
 * becomes «Коригування залишку». The difference is exact (`Money` of the domain kernel), only shown here; the server
 * posts it, changes the one adjustment or posts nothing when it is zero. An account with import explains the recount on
 * the next statement (FR 15). A multi-currency account picks the currency first.
 */
export function UpdateBalanceDialog({
  account,
  today,
  onCancel,
  onUpdated,
  onGone,
}: {
  account: AccountDetail;
  /** «Сьогодні» of the space (П-27), YYYY-MM-DD: the day of the balance the API gives. */
  today: string;
  onCancel: () => void;
  onUpdated: () => void;
  /** Not in the caller's space (FIN-12@PoC AC17) or closed meanwhile: the card reads the account again. */
  onGone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [currency, setCurrency] = useState(account.currencies[0]?.currency ?? "");
  const [value, setValue] = useState<string | null>(null);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ key: MessageKey; supportId?: string | undefined } | null>(null);

  const current = account.currencies.find((c) => c.currency === currency) ?? account.currencies[0];
  const mask = account.number ? maskedNumber(account.number.last4) : null;
  const subtitle = [mask ? `${account.name} ${mask}` : account.name, account.institution?.name]
    .filter(Boolean)
    .join(" · ");
  // A credit card's or a loan's balance is a debt, negative as the holder sees it; the field and the API take the
  // debt as a positive amount (FIN-12@PoC FR 15: «оновлює залишок боргу так само»), so both are compared as debts.
  const debt = account.group === "credit";
  // An amount outside NUMERIC(38,18) throws in the kernel: show no difference and let the server refuse it.
  let difference: Money | null = null;
  try {
    if (current && value !== null) {
      const entered = Money.of(value, current.currency);
      difference = (debt ? entered.negated() : entered).minus(
        Money.of(current.balance.amount, current.currency),
      );
    }
  } catch {
    difference = null;
  }

  const submit = async () => {
    if (!current) return;
    if (value === null) {
      setRequired(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    const o = await updateBalance(api, account.id, { amount: value, currency: current.currency });
    setBusy(false);
    if (o.ok) return onUpdated();
    if (o.kind === "problem" && (o.problem.code === "NOT_FOUND" || o.problem.code === "ACCOUNT_CLOSED"))
      return onGone();
    setFailure({
      key: "accountBalance.error.failed",
      supportId: o.kind === "problem" ? o.supportId : undefined,
    });
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t("accountBalance.title")}
      align="start"
      actions={[
        { label: t("accountBalance.cancel"), onClick: onCancel },
        {
          label: t("accountBalance.action"),
          variant: "primary",
          busyLabel: t("accountBalance.busy"),
          onClick: () => void submit(),
        },
      ]}
      busy={busy}
      error={
        failure ? (
          <>
            <p>{t(failure.key)}</p>
            {failure.supportId ? <p>{t("accounts.error.code", { code: failure.supportId })}</p> : null}
          </>
        ) : undefined
      }
    >
      <p className="ws-muted abal-subtitle">{subtitle}</p>
      {account.currencies.length > 1 ? (
        <Select
          label={t("accountBalance.currency")}
          value={currency}
          onChange={(c) => {
            setCurrency(c);
            setValue(null);
          }}
          options={account.currencies.map((c) => ({ value: c.currency, label: c.currency }))}
        />
      ) : null}
      {current ? (
        <p className="abal-now">
          <span className="ws-muted">
            {t("accountBalance.now", { date: longDay(formatLocaleOf(locale), today) })}
          </span>
          <b>{money(locale, debt ? negated(current.balance) : current.balance)}</b>
        </p>
      ) : null}
      {current ? (
        <AmountField
          key={current.currency}
          label={t("accountBalance.field")}
          required
          currency={current.currency}
          value={value}
          hint={t(debt ? "accountBalance.hint.debt" : "accountBalance.hint")}
          error={required && value === null ? t("accountBalance.error.required") : undefined}
          onChange={(v) => {
            setFailure(null);
            setValue(v);
          }}
        />
      ) : null}
      <p className="abal-diff" aria-live="polite">
        <span>{t("accountBalance.diff")}</span>
        <b>
          {difference
            ? formatMoney(locale, difference.toDecimalString(), difference.currency, { signed: true })
            : "—"}
        </b>
      </p>
      {account.source === "import" ? (
        <p className="abal-note" role="note">
          <Icon name="info" size={16} />
          <span>{t("accountBalance.import")}</span>
        </p>
      ) : null}
    </Dialog>
  );
}
