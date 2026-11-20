import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { BarChart, CHART_PERCENT, LineChart, type BarCategory, type LineSeries } from "@willowsum/ui";

/**
 * CMP-47@PoC BarChart and CMP-42@PoC LineChart in the design-system gallery: every state of the canvas board
 * («Тренд витрат» S-133: bars, a hatched part, a stepped plan line, an income line, the tooltip table on hover or
 * focus) on synthetic values, long names, negative values, 8 series, and the loading, empty and error states.
 */
const MONTHS_UK = [
  "лист.",
  "груд.",
  "січ.",
  "лют.",
  "бер.",
  "квіт.",
  "трав.",
  "черв.",
  "лип.",
  "серп.",
  "вер.",
  "жовт.",
];
const FULL_UK = [
  "листопад 2025",
  "грудень 2025",
  "січень 2026",
  "лютий 2026",
  "березень 2026",
  "квітень 2026",
  "травень 2026",
  "червень 2026",
  "липень 2026",
  "серпень 2026",
  "вересень 2026",
  "жовтень 2026",
];
const SPENT = [
  "2486.79",
  "3637.87",
  "2628.93",
  "2496.07",
  "3288.69",
  "2513.54",
  "2743.72",
  "2737.48",
  "2375.77",
  "2931.59",
  "2455.99",
  "3144.46",
];
const GOAL = ["0", "0", "0", "0", "0", "0", "0", "0", "1450.00", "0", "0", "0"];
const INCOME = [
  "5380",
  "6920",
  "5380",
  "5380",
  "5450",
  "5450",
  "5450",
  "5450",
  "5450",
  "5550",
  "5550",
  "5550",
];
const PLAN = ["2900", "3400", "3000", "3000", "3000", "3000", "3000", "3000", "3000", "3000", "3000", "3000"];

const monthly = (): BarCategory[] =>
  MONTHS_UK.map((label, i) => ({ id: `m${i}`, label, full: FULL_UK[i] ?? label }));
const dates = (n: number, from: [number, number, number]) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(from[0], from[1] - 1, from[2] + i * 30)).toISOString().slice(0, 10),
  );
const balance = (base: number, slope: number, n = 12): { date: string; value: string }[] =>
  dates(n, [2025, 11, 30]).map((date, i) => ({
    date,
    value: (base + slope * i + ((i * 37) % 90)).toFixed(2),
  }));

export function ChartsDemo() {
  const { t } = useI18n();
  const [clicked, setClicked] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const retry = { onRetry: () => setRetries((n) => n + 1), code: "req-7f3a" };
  const categories = monthly();
  const long =
    "Подорожі й відпустки — дуже довга назва категорії без розривів ПодорожіІВідпусткиДужеДовгаНазва";
  const seven: LineSeries[] = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`,
    name: i === 0 ? t("gallery.charts.longName") : t("gallery.charts.account", { n: String(i + 1) }),
    points: balance(1000 + i * 600, 40 + i * 10),
  }));
  const case_ = (id: string, caption: string, body: React.ReactNode) => (
    <figure className="gallery-charts__case" data-case={id}>
      <figcaption className="ws-text-label ws-muted">{caption}</figcaption>
      <div className="ws-card">{body}</div>
    </figure>
  );

  return (
    <div className="gallery-charts">
      <p className="ws-muted">{t("gallery.charts.intro")}</p>
      {case_(
        "bar-trend",
        t("gallery.charts.barTrend"),
        <BarChart
          label={t("gallery.charts.spendLabel")}
          categories={categories}
          series={[
            {
              id: "spent",
              name: t("gallery.charts.spent"),
              values: SPENT,
              tone: "brand-2",
              goodWhen: "down",
            },
            {
              id: "goal",
              name: t("gallery.charts.fromGoals"),
              values: GOAL,
              tone: "brand-2",
              hatched: true,
              goodWhen: "down",
            },
          ]}
          lines={[
            {
              id: "income",
              name: t("gallery.charts.income"),
              values: INCOME,
              tone: "chart-group-income-2",
              marker: "square",
              goodWhen: "up",
            },
            {
              id: "plan",
              name: t("gallery.charts.plan"),
              values: PLAN,
              dash: [12, 4],
              marker: "diamond",
              step: true,
            },
          ]}
          currency="EUR"
          changeLabel={t("gallery.charts.changeLabel")}
          onBarClick={(i) => setClicked(FULL_UK[i] ?? null)}
        />,
      )}
      <p className="ws-muted" role="status" data-testid="clicked">
        {clicked ? t("gallery.charts.clicked", { period: clicked }) : t("gallery.charts.clickHint")}
      </p>
      <div className="gallery-charts__grid">
        {case_(
          "bar-single",
          t("gallery.charts.barSingle"),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={categories.slice(7)}
            series={[{ id: "spent", name: t("gallery.charts.spent"), values: SPENT.slice(7) }]}
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "bar-negative",
          t("gallery.charts.barNegative"),
          <BarChart
            label={t("gallery.charts.balanceLabel")}
            categories={categories.slice(6, 11)}
            series={[
              {
                id: "net",
                name: t("gallery.charts.balance"),
                values: ["1840.50", "-420.00", "960.25", "-1310.80", "310.00"],
              },
            ]}
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "bar-dotted",
          t("gallery.charts.barDotted"),
          <BarChart
            label={t("gallery.charts.balanceLabel")}
            categories={categories.slice(6, 11)}
            series={[
              {
                id: "net",
                name: t("gallery.charts.balance"),
                values: ["2751.07", "2883.93", "1624.23", "2618.41", "3094.01"],
                tone: "brand-2",
              },
              {
                id: "goal",
                name: t("gallery.charts.fromGoals"),
                values: [null, null, "1450.00", null, null],
                tone: "brand-2",
                dotted: true,
              },
            ]}
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "bar-percent",
          t("gallery.charts.barPercent"),
          <BarChart
            label={t("gallery.charts.rateLabel")}
            categories={categories.slice(6, 11)}
            series={[]}
            lines={[
              {
                id: "rate",
                name: t("gallery.charts.rate"),
                values: ["51.1", "53.6", null, "47.2", "55.7"],
                tone: "brand-2",
                goodWhen: "up",
              },
            ]}
            currency={CHART_PERCENT}
            height={240}
          />,
        )}
        {case_(
          "bar-other",
          t("gallery.charts.barOther"),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={categories.slice(8)}
            series={Array.from({ length: 8 }, (_, i) => ({
              id: `c${i}`,
              name: t("gallery.charts.category", { n: String(i + 1) }),
              values: [0, 1, 2, 3].map((k) => String((8 - i) * 100 + k * 15)),
            }))}
            mode="stacked"
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "bar-long",
          t("gallery.charts.barLong"),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={[
              { id: "a", label: long },
              { id: "b", label: t("gallery.charts.food") },
              { id: "c", label: long.slice(0, 24) },
            ]}
            series={[
              { id: "spent", name: t("gallery.charts.longName"), values: ["1250000.00", "642.10", "88.40"] },
            ]}
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "bar-loading",
          t("gallery.charts.loading"),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={[]}
            series={[]}
            currency="EUR"
            height={160}
            loading
          />,
        )}
        {case_(
          "bar-empty",
          t("gallery.charts.empty"),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={[]}
            series={[]}
            currency="EUR"
            height={160}
          />,
        )}
        {case_(
          "bar-error",
          t("gallery.charts.error", { count: String(retries) }),
          <BarChart
            label={t("gallery.charts.spendLabel")}
            categories={[]}
            series={[]}
            currency="EUR"
            height={160}
            error={retry}
          />,
        )}
      </div>
      {case_(
        "line-three",
        t("gallery.charts.lineThree"),
        <LineChart
          label={t("gallery.charts.accountsLabel")}
          series={[
            { id: "a", name: t("gallery.charts.main"), points: balance(1800, 60) },
            { id: "b", name: t("gallery.charts.savings"), points: balance(2400, 25) },
            { id: "c", name: t("gallery.charts.cash"), points: balance(900, -15) },
          ]}
          currency="EUR"
          height={280}
          events={[
            {
              id: "e1",
              date: "2026-03-15",
              label: t("gallery.charts.eventLoan"),
              detail: t("gallery.charts.eventLoanDetail"),
            },
            {
              id: "e2",
              date: "2026-08-10",
              label: t("gallery.charts.eventRepay"),
              detail: t("gallery.charts.eventRepayDetail"),
            },
          ]}
        />,
      )}
      {case_(
        "line-six",
        t("gallery.charts.lineSix"),
        <LineChart label={t("gallery.charts.accountsLabel")} series={seven} currency="EUR" height={280} />,
      )}
      <div className="gallery-charts__grid">
        {case_(
          "line-area",
          t("gallery.charts.lineArea"),
          <LineChart
            label={t("gallery.charts.accountsLabel")}
            series={[{ id: "a", name: t("gallery.charts.main"), points: balance(1800, 60) }]}
            currency="EUR"
            height={240}
            area
          />,
        )}
        {case_(
          "line-target",
          t("gallery.charts.lineTarget"),
          <LineChart
            label={t("gallery.charts.goalLabel")}
            series={[
              { id: "g", name: t("gallery.charts.saved"), points: balance(400, 220, 8), tone: "goal-55" },
            ]}
            currency="EUR"
            height={240}
            target={{ value: "3000", label: t("gallery.charts.goalTarget") }}
          />,
        )}
        {case_(
          "line-one",
          t("gallery.charts.lineOne"),
          <LineChart
            label={t("gallery.charts.accountsLabel")}
            series={[
              { id: "a", name: t("gallery.charts.main"), points: [{ date: "2026-10-31", value: "1250.50" }] },
            ]}
            currency="EUR"
            height={240}
          />,
        )}
        {case_(
          "line-loading",
          t("gallery.charts.loading"),
          <LineChart
            label={t("gallery.charts.accountsLabel")}
            series={[]}
            currency="EUR"
            height={160}
            loading
          />,
        )}
        {case_(
          "line-empty",
          t("gallery.charts.empty"),
          <LineChart label={t("gallery.charts.accountsLabel")} series={[]} currency="EUR" height={160} />,
        )}
        {case_(
          "line-error",
          t("gallery.charts.error", { count: String(retries) }),
          <LineChart
            label={t("gallery.charts.accountsLabel")}
            series={[]}
            currency="EUR"
            height={160}
            error={retry}
          />,
        )}
      </div>
    </div>
  );
}
