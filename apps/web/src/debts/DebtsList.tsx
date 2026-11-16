import { formatNumber, formatPercent, useI18n } from "@willowsum/i18n";
import { Icon, Tooltip } from "@willowsum/ui";
import { accountSettingsPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import type { Debt } from "./api.ts";
import { formatMonth, laterMonth, money } from "./format.ts";
import { DebtName, Disclaimer, PaidBar, tabPath } from "./parts.tsx";

/**
 * S-143 «Борги» (BUD-19@PoC FR 1, FR 2, FR 3, FR 10, FR 11): the summary, a note for each debt that does not
 * decrease, and the table of debts with the terms from «Гроші», the payoff month of the base calculation and
 * «Погашено». Each row has «›» «Відкрити рахунок» to the account's settings, where the rate and the payment
 * change (AC9).
 */
export function DebtsList({ debts }: { debts: readonly Debt[] }) {
  const { t } = useI18n();
  const stuck = debts.filter((d) => d.base?.status === "not-decreasing");
  return (
    <>
      <Summary debts={debts} />
      {stuck.map((d) => (
        <div key={d.accountId} className="debts-warning" role="note">
          <Icon name="warning" size={20} />
          <p>{t("debts.warning", { name: d.name })}</p>
          <a className="ws-button" href={hrefFor(tabPath("plan"))}>
            {t("debts.warning.action")}
          </a>
        </div>
      ))}
      <div className="ws-card debts-table ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              <th scope="col">{t("debts.col.debt")}</th>
              <th scope="col" className="debts-num">
                {t("debts.col.balance")}
              </th>
              <th scope="col" className="debts-num">
                {t("debts.col.rate")}
              </th>
              <th scope="col" className="debts-num">
                {t("debts.col.payment")}
              </th>
              <th scope="col">{t("debts.col.payoff")}</th>
              <th scope="col">{t("debts.col.paid")}</th>
              <th scope="col">
                <span className="ws-visually-hidden">{t("debts.col.open")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d) => (
              <DebtRow key={d.accountId} debt={d} />
            ))}
          </tbody>
        </table>
      </div>
      <Disclaimer />
    </>
  );
}

function DebtRow({ debt }: { debt: Debt }) {
  const { t, locale } = useI18n();
  return (
    <tr>
      <td data-label={t("debts.col.debt")}>
        <DebtName debt={debt} />
      </td>
      <td data-label={t("debts.col.balance")} className="debts-num debts-strong">
        {money(locale, debt.balance)}
      </td>
      <td data-label={t("debts.col.rate")} className="debts-num">
        {debt.annualRate === null ? "—" : formatPercent(locale, debt.annualRate, { digits: 1 })}
      </td>
      <td data-label={t("debts.col.payment")} className="debts-num">
        {debt.monthlyPayment === null ? "—" : money(locale, debt.monthlyPayment)}
      </td>
      <td data-label={t("debts.col.payoff")}>
        <Payoff debt={debt} />
      </td>
      <td data-label={t("debts.col.paid")}>
        <PaidBar debt={debt} />
      </td>
      <td className="debts-open">
        <Tooltip text={t("debts.openAccount")}>
          <a
            className="ws-icon-button"
            href={hrefFor(accountSettingsPath(debt.accountId))}
            aria-label={t("debts.openAccount.named", { name: debt.name })}
          >
            <Icon name="chevron-right" size={20} />
          </a>
        </Tooltip>
      </td>
    </tr>
  );
}

/** FR 2, FR 3, AC4, AC5: the payoff month, or why there is none. */
function Payoff({ debt }: { debt: Debt }) {
  const { t, locale } = useI18n();
  const base = debt.base;
  if (debt.termsMissing || base === null)
    return <span className="debts-badge debts-badge--muted">{t("debts.termsMissing.badge")}</span>;
  if (base.status === "not-decreasing")
    return <span className="debts-badge debts-badge--warning">{t("debts.notDecreasing.badge")}</span>;
  if (base.status === "over-limit")
    return <span className="debts-badge debts-badge--warning">{t("debts.overLimit.badge")}</span>;
  return (
    <span className="debts-stack">
      <span>{base.payoffMonth ? formatMonth(locale, base.payoffMonth) : "—"}</span>
      <span className="ws-muted debts-small">
        {t("debts.payoffIn", { months: formatNumber(locale, String(base.months ?? 0)) })}
      </span>
    </span>
  );
}

/**
 * The number of debts and «Без боргів». «Загальний борг» and «Платежі на місяць» of the board need a total in the
 * reporting currency (FR 9), which the API does not return yet: no sum is made in the browser.
 */
function Summary({ debts }: { debts: readonly Debt[] }) {
  const { t, locale } = useI18n();
  let lastMonth: string | null = null;
  let maxMonths = 0;
  const except: string[] = [];
  for (const d of debts) {
    if (d.base?.status === "paid" && d.base.payoffMonth !== null) {
      lastMonth = laterMonth(lastMonth, d.base.payoffMonth);
      maxMonths = Math.max(maxMonths, d.base.months ?? 0);
    } else except.push(d.name);
  }
  const debtFreeHint = [
    lastMonth === null ? null : t("debts.payoffIn", { months: formatNumber(locale, String(maxMonths)) }),
    except.length > 0 && lastMonth !== null ? t("debts.summary.except", { names: except.join(", ") }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="ws-card debts-summary" aria-label={t("debts.summary.label")}>
      <dl>
        <div>
          <dt>{t("debts.summary.debts")}</dt>
          <dd className="debts-figure">{formatNumber(locale, String(debts.length))}</dd>
        </div>
        <div>
          <dt>{t("debts.summary.debtFree")}</dt>
          <dd className="debts-figure">
            {lastMonth === null ? t("debts.summary.never") : formatMonth(locale, lastMonth, "long")}
          </dd>
          {debtFreeHint ? <dd className="ws-muted debts-small">{debtFreeHint}</dd> : null}
        </div>
      </dl>
    </section>
  );
}
