import { useState } from "react";
import {
  formatDelta,
  formatLocaleOf,
  formatMoney,
  formatPercent,
  useI18n,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import { formatPeriodRange, Icon, Skeleton, StatusMark } from "@willowsum/ui";
import { failureOf } from "../../auth/failure.ts";
import { useLoad } from "../../recurring/data.ts";
import { chargeMark } from "../../recurring/status.tsx";
import { shortDate } from "../../recurring/format.ts";
import { childPath } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { BudgetError } from "../budget/BudgetError.tsx";
import { PlanRegion } from "../PlanGrid.tsx";
import { txClause } from "../compare/ComparePage.tsx";
import "./period.css";
import {
  isRefusal,
  loadLargest,
  loadSummary,
  type Charge,
  type Money,
  type Summary,
  type SummaryData,
} from "./model.ts";

/** How many charges the card shows before «Показати всі»: the rest of a long month is one click away. */
export const PAYMENT_ROWS = 8;

const monthKey = (period: string, suffix = "") =>
  `planning.budget.month.${period.slice(5, 7)}${suffix}` as MessageKey;

/** «1–31 жовтня» (a whole month or a part of it), else the range of dates as the period picker writes it. */
function rangeText(t: Translate, locale: Locale, from: string, to: string): string {
  if (from.slice(0, 7) !== to.slice(0, 7)) return formatPeriodRange(locale, from, to);
  return `${Number(from.slice(8))}–${Number(to.slice(8))} ${t(monthKey(to, ".gen"))}`;
}

/** «31 жовтня 2026». */
function longDate(locale: Locale, isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** «липень–вересень 2026» (the window of the average): the months in the words of the catalogue. */
function monthsRange(t: Translate, locale: Locale, from: string, to: string): string {
  const name = (p: string) => (locale === "uk" ? t(monthKey(p)).toLocaleLowerCase("uk-UA") : t(monthKey(p)));
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return sameYear
    ? `${name(from)}–${name(to)} ${to.slice(0, 4)}`
    : `${name(from)} ${from.slice(0, 4)}–${name(to)} ${to.slice(0, 4)}`;
}

/**
 * The change of a figure against its plan or its base, as DS-04 writes it («▲ 50,00 €», the arrow is the direction).
 * `worse` names the direction that is bad for the figure (spending above the plan, income below it): the colour is the
 * reading, the arrow and the spoken label keep it without the colour (NFR-08 FR 4).
 */
function Delta({ amount, worse }: { amount: Money; worse: "up" | "down" }) {
  const { locale } = useI18n();
  const f = formatDelta(locale, { amount: { value: amount.amount, currency: amount.currency, digits: 2 } });
  const tone = f.direction === "none" ? "none" : f.direction === worse ? "loss" : "gain";
  return (
    <span className={`per-tone per-tone--${tone}`}>
      <span aria-hidden="true">{f.text}</span>
      <span className="ws-visually-hidden">{f.label}</span>
    </span>
  );
}

/**
 * FLW-38@PoC FR 1, AC5, EC1 and BUD-02@PoC FR 16, S-135 «Підсумок періоду» (template Dashboard): over the categories of a
 * finished month — «Дохід» and «Витрати» against the plan of the snapshot, «Чистий потік» and «Норма заощаджень», the three
 * largest changes against the 3-month average and the month's regular payments with their status. Every figure and every
 * word of a status is the API's; the page only lays them out. A month that is not over (`400 not_finished`) or that
 * the budget did not exist in (`404`) is a note, a failure is the budget's error card with the API's code.
 */
export function PeriodSummary({ period }: { period: string }) {
  const { t } = useI18n();
  const { result, reload } = useLoad((api) => loadSummary(api, period), period);
  if (result.state === "error")
    return (
      <PlanRegion name="summary" span={12}>
        <BudgetError failure={result.failure} onRetry={reload} />
      </PlanRegion>
    );
  if (result.state === "loading")
    return (
      <PlanRegion name="summary" span={12}>
        <section className="ws-card bud-card" aria-label={t("planning.period.title")} aria-busy="true">
          <Skeleton variant="row" lines={4} />
        </section>
      </PlanRegion>
    );
  const data = result.data;
  if (isRefusal(data))
    return (
      <PlanRegion name="summary" span={12}>
        <section className="ws-card bud-card">
          <p role="status">
            {t(
              data.refusal === "notFinished" ? "planning.period.notFinished" : "planning.budget.beforeStart",
            )}
          </p>
        </section>
      </PlanRegion>
    );
  return (
    <PlanRegion name="summary" span={12}>
      <Ready data={data} />
    </PlanRegion>
  );
}

function Ready({ data }: { data: SummaryData }) {
  const { t, locale } = useI18n();
  const { summary } = data;
  return (
    <div className="per-stack">
      <p className="per-subtitle ws-muted">
        {t("planning.period.subtitle", {
          range: rangeText(t, locale, summary.window.from, summary.window.to),
        })}
        <br />
        {t("planning.period.snapshot", { date: longDate(locale, summary.window.to) })}
      </p>
      <Figures summary={summary} />
      <div className="per-columns">
        <Largest period={summary.period} />
        <Payments period={summary.period} regular={summary.regularPayments} names={data.names} />
      </div>
    </div>
  );
}

/** The four figures of the month (FLW-38 FR 1): none of them is calculated here, the net flow and the rate come from the API. */
function Figures({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const rate = summary.savingsRate;
  return (
    <section className="ws-card per-figures" aria-label={t("planning.period.title")}>
      <div className="per-figure" data-figure="income">
        <span className="ws-muted">{t("planning.budget.income.title")}</span>
        <b className="per-value ws-tabular">{money(summary.income.actual)}</b>
        <span className="ws-muted per-hint">
          {t("planning.period.plan", { amount: money(summary.income.plan) })} ·{" "}
          <Delta amount={summary.income.difference} worse="down" />
        </span>
      </div>
      <div className="per-figure" data-figure="expenses">
        <span className="ws-muted">{t("flow.kpi.expenses")}</span>
        <b className="per-value ws-tabular">{money(summary.expenses.actual)}</b>
        <span className="ws-muted per-hint">
          {t("planning.period.plan", { amount: money(summary.expenses.plan) })} ·{" "}
          <Delta amount={summary.expenses.difference} worse="up" />
        </span>
      </div>
      <div className="per-figure" data-figure="net">
        <span className="ws-muted">{t("flow.kpi.net")}</span>
        <b className="per-value ws-tabular">{money(summary.netFlow)}</b>
        <span className="ws-muted per-hint">{t("flow.kpi.net.hint")}</span>
      </div>
      <div className="per-figure" data-figure="rate">
        <span className="ws-muted">{t("flow.kpi.rate")}</span>
        <b className="per-value ws-tabular">
          {rate === null ? t("flow.kpi.rate.none") : formatPercent(locale, rate, { digits: 1 })}
        </b>
        <span className="ws-muted per-hint">
          {rate === null ? t("flow.kpi.rate.noIncome") : t("flow.kpi.rate.hint")}
        </span>
      </div>
    </section>
  );
}

/** «Порівняно з середнім за 3 міс.» (FLW-38 FR 3, AC1): the three largest changes of the month's categories. */
function Largest({ period }: { period: string }) {
  const { t, locale } = useI18n();
  const { result, reload } = useLoad((api) => loadLargest(api, period), period);
  const title = (
    <h2 className="ws-text-heading-3 per-title" id="per-largest-title">
      {t("planning.period.compare.title")}
    </h2>
  );
  if (result.state !== "ready") {
    return (
      <section
        className="ws-card per-card"
        aria-labelledby="per-largest-title"
        aria-busy={result.state === "loading"}
      >
        {title}
        {result.state === "loading" ? (
          <Skeleton variant="row" lines={3} />
        ) : (
          <div role="alert">
            <p className="ws-muted">{t("planning.compare.error.text")}</p>
            <p>
              <button type="button" className="ws-button" onClick={reload}>
                {t("planning.budget.error.retry")}
              </button>
            </p>
            {failureOf(result.failure).code ? (
              <p className="ws-muted">
                {t("planning.budget.error.code", { code: failureOf(result.failure).code ?? "" })}
              </p>
            ) : null}
          </div>
        )}
      </section>
    );
  }
  const { compare, names } = result.data;
  const base = compare.base;
  const open = hrefFor(`${childPath("budgetCompare")}?type=month&period=${period}&base=avg3`);
  const usable = base.available && compare.largest.length > 0;
  return (
    <section className="ws-card per-card" aria-labelledby="per-largest-title">
      <div className="per-head">
        {title}
        <a
          className="ws-icon-button"
          href={open}
          aria-label={t("planning.period.compare.open")}
          title={t("planning.period.compare.open")}
        >
          <Icon name="chevron-right" size={16} />
        </a>
      </div>
      {usable && base.window ? (
        <p className="ws-muted per-sub">
          {monthsRange(t, locale, base.window.from.slice(0, 7), base.window.to.slice(0, 7))}
          {base.months !== null && base.months < 3 ? (
            <>
              {" · "}
              <StatusMark id="g.months" params={{ count: base.months }} />
            </>
          ) : null}
        </p>
      ) : null}
      {usable ? (
        <ul className="per-list">
          {compare.largest.map((l, i) => {
            const diff = l.transactions.base === null ? 0 : l.transactions.current - l.transactions.base;
            const f = formatDelta(locale, {
              amount: { value: l.difference.amount, currency: l.difference.currency, digits: 2 },
            });
            const text = t("planning.compare.largest.item", {
              category:
                l.categoryId === null ? t("planning.budget.uncategorized") : (names.get(l.categoryId) ?? ""),
              change: f.text,
              vs: t("planning.compare.vs.avg"),
              tx: diff === 0 ? "" : txClause(t, locale, diff),
            });
            const at = text.indexOf(f.text);
            const tone = f.direction === "none" ? "none" : f.direction === "up" ? "loss" : "gain";
            return (
              <li key={i}>
                {at < 0 ? (
                  text
                ) : (
                  <>
                    <strong>{text.slice(0, at)}</strong>
                    <span className={`per-tone per-tone--${tone}`}>
                      <span aria-hidden="true">{f.text}</span>
                      <span className="ws-visually-hidden">{f.label}</span>
                    </span>
                    {text.slice(at + f.text.length)}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ws-muted" role="status">
          {t("planning.period.compare.empty")}
        </p>
      )}
    </section>
  );
}

/** «Регулярні платежі» of the month (BUD-07 FR 9): `null` is «поки невідомі», never an empty card. */
function Payments({
  period,
  regular,
  names,
}: {
  period: string;
  regular: Summary["regularPayments"];
  names: ReadonlyMap<string, string>;
}) {
  const { t, locale } = useI18n();
  const [all, setAll] = useState(false);
  const month = locale === "uk" ? t(monthKey(period)).toLocaleLowerCase("uk-UA") : t(monthKey(period));
  const sub =
    regular === null
      ? null
      : [
          t("planning.period.payments.sub", { month, paid: regular.paid, count: regular.count }),
          ...(regular.late > 0 ? [t("planning.period.payments.late", { count: regular.late })] : []),
          ...(regular.missed > 0 ? [t("planning.period.payments.missed", { count: regular.missed })] : []),
        ].join(" · ");
  const items = regular?.items ?? [];
  const shown = all ? items : items.slice(0, PAYMENT_ROWS);
  return (
    <section className="ws-card per-card" aria-labelledby="per-payments-title" data-card="payments">
      <h2 className="ws-text-heading-3 per-title" id="per-payments-title">
        {t("planning.period.payments.title")}
      </h2>
      {sub ? <p className="ws-muted per-sub">{sub}</p> : null}
      {regular === null ? (
        <p className="ws-muted" role="status">
          {t("planning.period.payments.unknown")}
        </p>
      ) : items.length === 0 ? (
        <p className="ws-muted" role="status">
          {t("planning.period.payments.empty")}
        </p>
      ) : (
        <>
          <ul className="per-payments">
            {shown.map((c) => (
              <PaymentRow key={`${c.paymentId}:${c.dueOn}`} charge={c} name={names.get(c.paymentId)} />
            ))}
          </ul>
          {items.length > PAYMENT_ROWS ? (
            <button
              type="button"
              className="ws-button per-more"
              aria-expanded={all}
              onClick={() => setAll(!all)}
            >
              {all
                ? t("planning.period.payments.showLess")
                : t("planning.period.payments.showAll", { count: items.length })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function PaymentRow({ charge, name }: { charge: Charge; name: string | undefined }) {
  const { t, locale } = useI18n();
  const mark = chargeMark(locale, "expense", {
    status: charge.status,
    dueOn: charge.dueOn,
    paidOn: charge.paidOn,
    overdueDays: charge.overdueDays,
  } as Parameters<typeof chargeMark>[2]);
  return (
    <li className="per-payment" data-status={charge.status}>
      <span className="per-date ws-muted">{shortDate(locale, charge.dueOn)}</span>
      <span className="per-name">{name || t("planning.period.payments.unnamed")}</span>
      <span className="per-amount ws-tabular">
        {formatMoney(locale, charge.expected.amount, charge.expected.currency)}
      </span>
      <span className="per-status">
        <StatusMark id={mark.id} params={mark.params} />
      </span>
    </li>
  );
}
