import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import { formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import { Badge, IconButton, merchantInitials } from "@willowsum/ui";
import type { Account, AccountsSummary, MoneyValue } from "./api.ts";
import { counted, maskedNumber, money, negated, shortDate } from "./format.ts";

const KIND: Readonly<Record<string, MessageKey>> = {
  current: "accounts.kind.current",
  savings: "accounts.kind.savings",
  deposit: "accounts.kind.deposit",
  cash: "accounts.kind.cash",
  "credit-card": "accounts.kind.creditCard",
  loan: "accounts.kind.loan",
};
const SOURCE: Readonly<Record<string, MessageKey>> = {
  manual: "accounts.source.manual",
  import: "accounts.source.import",
};

/**
 * FIN-01@PoC FR 13, FR 14, FR 16, FR 19, FR 22 (canvas PocMoneyAccounts): one group of the list — «Готівкові» with the
 * number of active accounts and the group's total from the API (#424), or «Кредитні» with the card debt (what is owed to the banks, not the sum of limits) and
 * a separate «Кредити: −<сума>» line. The heading is plain text, with no «›» and no teaser mark. Each row: the name with the
 * masked number and, under it, the institution; type; currency («N валюти» for a multi-currency account, whose row
 * opens its sub-accounts); source and the date of the last update; the balance in the profile currency with the
 * account's own amount smaller under it. No automatic «Неактивний»: only a closed account (shown with «Показати
 * закриті») carries a mark. FR 20: the «Обране» star before each account; the starred ones first, each part in the
 * order it comes in.
 */
export function AccountGroup({
  group,
  accounts,
  summary,
  favourite,
}: {
  group: "cash" | "credit";
  accounts: readonly Account[];
  summary: AccountsSummary | null;
  favourite: { toggle: (account: Account) => void; pending: ReadonlySet<string> };
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const active = accounts.filter((a) => a.status === "active").length;
  const profile =
    summary?.currency ?? accounts.find((a) => a.inProfileCurrency.total)?.inProfileCurrency.total?.currency;
  const cashTotal = summary?.cash.total ?? null;
  const cardDebt = summary?.credit.cardDebt.total ?? null;
  const loanDebt = summary?.credit.loanDebt.total ?? null;
  const hasLoans = accounts.some((a) => a.kind === "loan" && a.status === "active");
  return (
    <section className="ws-card accounts-group" aria-labelledby={titleId}>
      <header className="accounts-group-head">
        <div>
          <h2 id={titleId} className="ws-label">
            {t(group === "cash" ? "accounts.group.cash" : "accounts.group.credit")}
          </h2>
          <p className="accounts-caption ws-muted">
            {group === "cash"
              ? counted(t, locale, "accounts.activeCount", active)
              : counted(t, locale, "accounts.group.credit.count", active)}
          </p>
        </div>
        {group === "cash" && cashTotal ? (
          <div className="accounts-group-sum">
            <p className="accounts-strong">{money(locale, cashTotal)}</p>
          </div>
        ) : null}
        {group === "credit" ? (
          <div className="accounts-group-sum">
            {cardDebt ? <p className="accounts-strong">{money(locale, negated(cardDebt))}</p> : null}
            {hasLoans && loanDebt ? (
              <p className="ws-muted accounts-small">
                {t("accounts.group.loans", { amount: money(locale, loanDebt) })}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="ws-table-wrap">
        <table className="ws-table accounts-table" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">{t("accounts.col.account")}</th>
              <th scope="col">{t("accounts.col.type")}</th>
              <th scope="col">{t("accounts.col.currency")}</th>
              <th scope="col">{t("accounts.col.source")}</th>
              <th scope="col" className="accounts-num">
                {profile ? t("accounts.col.balanceIn", { currency: profile }) : t("accounts.col.balance")}
              </th>
              <th scope="col">
                <span className="ws-visually-hidden">{t("accounts.col.more")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {starredFirst(accounts).map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                onStar={() => favourite.toggle(a)}
                starBusy={favourite.pending.has(a.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** FR 20: «Обране» at the top of the group; otherwise the order stays as it comes (stable). */
function starredFirst(accounts: readonly Account[]): Account[] {
  return [...accounts.filter((a) => a.favourite), ...accounts.filter((a) => !a.favourite)];
}

function AccountRow({
  account: a,
  onStar,
  starBusy,
}: {
  account: Account;
  onStar: () => void;
  starBusy: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const subId = useId();
  const multi = a.currencies.length > 1;
  const mask = a.number ? maskedNumber(a.number.last4) : null;
  const total = a.inProfileCurrency.total;
  const single = a.currencies.length === 1 ? a.currencies[0] : undefined;
  const own = single && (!total || single.currency !== total.currency) ? single.amount : null;
  const where = [a.institution?.name, multi ? a.currencies.map((c) => c.currency).join(", ") : null]
    .filter(Boolean)
    .join(" · ");
  const closed = a.status === "closed";
  return (
    <Fragment>
      <tr className={closed ? "accounts-row accounts-row--closed" : "accounts-row"}>
        <td data-label={t("accounts.col.account")}>
          <span className="accounts-name-cell">
            <Star on={a.favourite} busy={starBusy} onToggle={onStar} />
            <span className="accounts-tile" aria-hidden="true">
              {merchantInitials(a.institution?.name ?? a.name)}
            </span>
            <span className="accounts-stack">
              <span className="accounts-name">
                <strong>{a.name}</strong>
                {mask ? <span className="ws-muted"> {mask}</span> : null}
                {closed ? <Badge label={t("accounts.closed")} /> : null}
              </span>
              {where ? <span className="ws-muted accounts-small">{where}</span> : null}
              <Terms account={a} />
            </span>
          </span>
        </td>
        <td data-label={t("accounts.col.type")}>{t(KIND[a.kind] ?? "accounts.kind.current")}</td>
        <td data-label={t("accounts.col.currency")}>
          {multi
            ? counted(t, locale, "accounts.currencyCount", a.currencies.length)
            : (single?.currency ?? "")}
        </td>
        <td data-label={t("accounts.col.source")}>
          <span className="accounts-stack">
            <span>{t(SOURCE[a.source] ?? "accounts.source.manual")}</span>
            <span className="ws-muted accounts-small">{shortDate(locale, a.updatedOn)}</span>
          </span>
        </td>
        <td data-label={t("accounts.col.balance")} className="accounts-num">
          <Balance main={total} approximate={a.inProfileCurrency.approximate} own={own} />
        </td>
        <td className="accounts-more">
          {multi ? (
            <IconButton
              icon={open ? "chevron-up" : "chevron-down"}
              label={t(open ? "accounts.sub.hide" : "accounts.sub.show")}
              onClick={() => setOpen((v) => !v)}
              expanded={open}
              controls={a.currencies.map((c) => `${subId}-${c.currency}`).join(" ")}
            />
          ) : null}
        </td>
      </tr>
      {multi && open
        ? a.currencies.map((c) => (
            <tr key={c.currency} id={`${subId}-${c.currency}`} className="accounts-subrow">
              <td data-label={t("accounts.col.account")}>{t("accounts.sub.row")}</td>
              <td data-label={t("accounts.col.type")} />
              <td data-label={t("accounts.col.currency")}>{c.currency}</td>
              <td data-label={t("accounts.col.source")} />
              <td data-label={t("accounts.col.balance")} className="accounts-num">
                <Balance main={c.equivalent} approximate={c.approximate} own={c.amount} />
              </td>
              <td />
            </tr>
          ))
        : null}
    </Fragment>
  );
}

/**
 * The «Обране» star (FR 20; canvas PocMoneyAccounts): its name and tooltip say what a press does — «Додати в обране» or
 * «Прибрати з обраного»; a starred one is drawn filled, so the state is not in a colour alone. The row moves when it
 * changes, so the focus is put back on the star if the move took it away.
 */
function Star({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  const t = useI18n().t;
  const wrap = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);
  useLayoutEffect(() => {
    if (!pressed.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    wrap.current?.querySelector("button")?.focus();
  }, [on]);
  return (
    <span ref={wrap} className={on ? "accounts-star accounts-star--on" : "accounts-star"}>
      <IconButton
        icon="star"
        label={t(on ? "accounts.favourite.remove" : "accounts.favourite.add")}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return;
          pressed.current = true;
          onToggle();
        }}
      />
    </span>
  );
}

/** The balance in the profile currency («≈» on a stale rate, EC1) with the account's own amount smaller under it. */
function Balance({
  main,
  approximate,
  own,
}: {
  main: MoneyValue | null;
  approximate: boolean;
  own: MoneyValue | null;
}) {
  const { t, locale } = useI18n();
  const top = main ? money(locale, main) : own ? money(locale, own) : "—";
  return (
    <span className="accounts-stack">
      <span className="accounts-strong">
        {main && approximate ? t("accounts.approx", { amount: top }) : top}
      </span>
      {own && main ? <span className="ws-muted accounts-small">{money(locale, own)}</span> : null}
    </span>
  );
}

/**
 * FR 16, FR 19: a credit card's limit, what is available and, when set, the grace period as the number of days the
 * server returns, with no date (FIN-01 FR 19; the model has no statement date); a loan's rate and monthly payment
 * («4,2 % · 650,00 € / міс.»). No limit or available funds on a loan.
 */
function Terms({ account: a }: { account: Account }) {
  const { t, locale } = useI18n();
  if (a.creditCard && a.creditCard.creditLimit && a.creditCard.available)
    return (
      <span className="ws-muted accounts-small">
        {t("accounts.card.terms", {
          limit: money(locale, a.creditCard.creditLimit),
          available: money(locale, a.creditCard.available),
        })}
        {a.creditCard.gracePeriodDays !== null && a.creditCard.gracePeriodDays !== undefined
          ? ` · ${t("accounts.card.grace", { days: formatNumber(locale, a.creditCard.gracePeriodDays) })}`
          : null}
      </span>
    );
  if (a.loan && a.loan.annualRate !== null && a.loan.monthlyPayment)
    return (
      <span className="ws-muted accounts-small">
        {t("accounts.loan.terms", {
          rate: formatNumber(locale, a.loan.annualRate),
          payment: money(locale, a.loan.monthlyPayment),
        })}
      </span>
    );
  return null;
}
