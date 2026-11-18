import { useI18n } from "@willowsum/i18n";
import { Icon, Tooltip } from "@willowsum/ui";
import { formatMonth, formatAmount } from "./format.ts";
import { linePath, maxBalance, monthRows, type Point } from "./model.ts";

const SIZE = { width: "640", height: "200", pad: "8" };

/**
 * BUD-19@PoC FR 10: the balance chart has one view, «Лінії» — the base and the scenario side by side. The view
 * button in the card's header is shown inactive (`aria-disabled`, tooltip and name «Вигляд: Лінії»); no view menu
 * opens. The text alternative is the table of the balance by month. The lines come from the server's schedules.
 */
export function ScheduleChart({
  base,
  scenario,
  currency,
  busy,
}: {
  base: readonly Point[];
  scenario: readonly Point[];
  currency: string;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const rows = monthRows(base, scenario);
  const months = rows.map((r) => r.month);
  const max = maxBalance(base, scenario);
  const first = months[0];
  const last = months[months.length - 1];
  return (
    <section className="ws-card debts-chart" aria-labelledby="debts-chart-title" aria-busy={busy}>
      <header className="debts-chart-head">
        <h2 id="debts-chart-title" className="debts-card-title">
          {t("debts.chart.title")}
        </h2>
        <Tooltip text={t("debts.chart.view")}>
          <button
            type="button"
            className="ws-icon-button"
            aria-disabled="true"
            aria-label={t("debts.chart.view")}
            onClick={(e) => e.preventDefault()}
          >
            <Icon name="trend" size={20} />
          </button>
        </Tooltip>
      </header>
      {busy ? (
        <p className="ws-muted debts-small" role="status">
          {t("debts.result.loading")}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="ws-muted">{t("debts.chart.empty")}</p>
      ) : (
        <>
          <div className="debts-chart-plot">
            <div className="debts-chart-scale ws-muted debts-small" aria-hidden="true">
              <span>{formatAmount(locale, max, currency)}</span>
              <span>{formatAmount(locale, "0", currency)}</span>
            </div>
            <svg
              className="debts-chart-svg"
              viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
              role="img"
              aria-label={t("debts.chart.alt")}
              preserveAspectRatio="none"
            >
              <line className="debts-gridline" x1="0" x2={SIZE.width} y1={SIZE.pad} y2={SIZE.pad} />
              <line
                className="debts-gridline"
                x1="0"
                x2={SIZE.width}
                y1={Number(SIZE.height) - Number(SIZE.pad)}
                y2={Number(SIZE.height) - Number(SIZE.pad)}
              />
              {base.length > 0 ? (
                <path
                  className="debts-line debts-line--base"
                  d={linePath(base, months, max, SIZE)}
                  fill="none"
                />
              ) : null}
              {scenario.length > 0 ? (
                <path
                  className="debts-line debts-line--scenario"
                  d={linePath(scenario, months, max, SIZE)}
                  fill="none"
                />
              ) : null}
            </svg>
          </div>
          <div className="debts-chart-axis ws-muted debts-small">
            <span>{first ? formatMonth(locale, first) : ""}</span>
            <span>{last ? formatMonth(locale, last) : ""}</span>
          </div>
          <ul className="debts-legend" aria-hidden="true">
            <li>
              <span className="debts-swatch debts-swatch--base" />
              {t("debts.result.base")}
            </li>
            <li>
              <span className="debts-swatch debts-swatch--scenario" />
              {t("debts.result.scenario")}
            </li>
          </ul>
          <details className="debts-chart-table">
            <summary>{t("debts.chart.table")}</summary>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead>
                  <tr>
                    <th scope="col">{t("debts.chart.month")}</th>
                    <th scope="col" className="debts-num">
                      {t("debts.result.base")}
                    </th>
                    <th scope="col" className="debts-num">
                      {t("debts.result.scenario")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <th scope="row">{formatMonth(locale, r.month)}</th>
                      <td className="debts-num">
                        {r.base === null ? "—" : formatAmount(locale, r.base, currency)}
                      </td>
                      <td className="debts-num">
                        {r.scenario === null ? "—" : formatAmount(locale, r.scenario, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
