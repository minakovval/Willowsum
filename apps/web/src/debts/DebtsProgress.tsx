import { formatNumber, useI18n } from "@willowsum/i18n";
import type { Debt } from "./api.ts";
import { formatMonth, laterMonth, money } from "./format.ts";
import { DebtName, Disclaimer, PaidBar } from "./parts.tsx";

/**
 * S-146 «Прогрес» (BUD-19@PoC FR 7, FR 8, AC8): «Залишилось N міс.» by the regular payments and, for each debt,
 * «Погашено N %» as a bar (no ring) and the column «План» against the saved payoff plan. No «Поділитися» and no
 * sharing as an image.
 */
export function DebtsProgress({ debts }: { debts: readonly Debt[] }) {
  const { t, locale } = useI18n();
  let remaining: number | null = null;
  let lastMonth: string | null = null;
  const except: string[] = [];
  for (const d of debts) {
    if (d.progress.remainingMonths === null) {
      except.push(d.name);
      continue;
    }
    remaining = Math.max(remaining ?? 0, d.progress.remainingMonths);
    if (d.base?.payoffMonth) lastMonth = laterMonth(lastMonth, d.base.payoffMonth);
  }
  const hint = [
    lastMonth === null ? null : formatMonth(locale, lastMonth, "long"),
    except.length > 0 && remaining !== null ? t("debts.summary.except", { names: except.join(", ") }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <section className="ws-card debts-remaining" aria-labelledby="debts-remaining-title">
        <p className="ws-muted" id="debts-remaining-title">
          {t("debts.progress.remainingTitle")}
        </p>
        <p className="debts-big">
          {remaining === null
            ? t("debts.summary.never")
            : t("debts.progress.remaining", { months: formatNumber(locale, String(remaining)) })}
        </p>
        {hint ? <p className="ws-muted">{hint}</p> : null}
      </section>
      <section className="ws-card debts-table ws-table-wrap" aria-labelledby="debts-by-debt">
        <h2 id="debts-by-debt" className="debts-card-title">
          {t("debts.progress.byDebt")}
        </h2>
        <p className="ws-muted debts-small">{t("debts.progress.byDebtHint")}</p>
        <table className="ws-table">
          <thead>
            <tr>
              <th scope="col">{t("debts.col.debt")}</th>
              <th scope="col" className="debts-num">
                {t("debts.col.balance")}
              </th>
              <th scope="col">{t("debts.col.paid")}</th>
              <th scope="col" className="debts-num">
                {t("debts.col.remaining")}
              </th>
              <th scope="col">{t("debts.col.plan")}</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d) => (
              <tr key={d.accountId}>
                <td data-label={t("debts.col.debt")}>
                  <DebtName debt={d} />
                </td>
                <td data-label={t("debts.col.balance")} className="debts-num debts-strong">
                  {money(locale, d.balance)}
                </td>
                <td data-label={t("debts.col.paid")}>
                  <PaidBar debt={d} />
                </td>
                <td data-label={t("debts.col.remaining")} className="debts-num">
                  {d.progress.remainingMonths === null
                    ? "—"
                    : t("debts.months", { months: formatNumber(locale, String(d.progress.remainingMonths)) })}
                </td>
                <td data-label={t("debts.col.plan")}>
                  <PlanStatus debt={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Disclaimer />
    </>
  );
}

/** FR 7: «▲ Випереджає план · N €», «— За планом», «▼ Відстає від плану · N €» or the badge «Плану немає». */
function PlanStatus({ debt }: { debt: Debt }) {
  const { t, locale } = useI18n();
  const { status, amount } = debt.progress.plan;
  const sum = amount ? money(locale, amount) : "";
  if (status === "ahead")
    return <span className="debts-plan--better">{t("debts.plan.ahead", { amount: sum })}</span>;
  if (status === "behind")
    return <span className="debts-plan--worse">{t("debts.plan.behind", { amount: sum })}</span>;
  if (status === "on-track") return <span className="debts-plan--even">{t("debts.plan.onTrack")}</span>;
  return <span className="debts-badge debts-badge--muted">{t("debts.plan.none")}</span>;
}
