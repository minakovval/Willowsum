import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ApiClient } from "@willowsum/api-contract";
import { formatDelta, formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import {
  BarChart,
  IconButton,
  Select,
  StatusMark,
  Table,
  type BarCategory,
  type TableColumn,
  type TableRow,
} from "@willowsum/ui";
import { failureOf } from "../../auth/failure.ts";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { kyivToday, type Load } from "../../recurring/data.ts";
import { TRANSACTIONS } from "../../routing/routes.ts";
import {
  DEFAULT_RANGE,
  RANGES,
  difference,
  extremes,
  loadTrend,
  monthBounds,
  type Range,
  type TrendData,
  type TrendMonth,
} from "./model.ts";
import "./trend.css";

/** The expense categories the filter offers: not hidden, in the order of the tree. */
async function loadCategories(api: ApiClient): Promise<{ id: string; name: string }[]> {
  const o = await outcome(api.GET("/v1/categories"));
  if (!o.ok) return [];
  return o.data.groups
    .filter((g) => g.kind === "expense")
    .flatMap((g) => g.categories)
    .filter((c) => c.kind === "expense" && !c.hidden)
    .map((c) => ({ id: c.id, name: c.name }));
}

const monthName = (t: Translate, period: string): string =>
  t(`planning.budget.month.${period.slice(5, 7)}` as MessageKey);
/** «Листопад 2025». */
const monthYear = (t: Translate, period: string): string => `${monthName(t, period)} ${period.slice(0, 4)}`;

type State = { key: string; result: Load<TrendData> };

/**
 * The trend for a range and a category. The result belongs to its request: after a change the screen is `loading`
 * until the answer of the new one arrives (no stale chart under a new switch position).
 */
function useTrend(range: Range, categoryId: string, today: string) {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${range}|${categoryId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", result: { state: "loading" } });
  useEffect(() => {
    let live = true;
    const failed: Load<TrendData> = { state: "error", failure: { ok: false, kind: "network" } };
    void (async () => loadTrend(api, range, categoryId || null, today))().then(
      (result) => live && setState({ key, result }),
      () => live && setState({ key, result: failed }),
    );
    return () => {
      live = false;
    };
  }, [api, range, categoryId, today, key]);
  const result: Load<TrendData> = state.key === key ? state.result : { state: "loading" };
  return { result, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

type SortKey = "period" | "spent" | "plan" | "diff" | "income";
const COLUMNS: readonly { key: SortKey; label: MessageKey; amount: boolean }[] = [
  { key: "period", label: "trend.col.period", amount: false },
  { key: "spent", label: "trend.col.spent", amount: true },
  { key: "plan", label: "trend.col.plan", amount: true },
  { key: "diff", label: "trend.col.diff", amount: true },
  { key: "income", label: "trend.col.income", amount: true },
];

const valueOf = (m: TrendMonth, key: SortKey): string | null =>
  key === "period"
    ? m.period
    : key === "diff"
      ? difference(m)
      : (m[key as "spent" | "plan" | "income"]?.amount ?? null);

/**
 * BUD-16@PoC b) (row 133), S-133 «Тренд» (PocPlanTrend): the spending of the completed periods as columns with the
 * lines of income and budget, a category filter, the period switch «1М · 3М · 1Р · Усе» and the table of the same
 * numbers. Facts only (BUD-16 FR 5). A column and a row open the transactions of their month.
 *
 * The hatched part «з цілей» of a column is not drawn: the server does not return it yet (owner question in the PR);
 * `BarChart` takes it as a second, `hatched` series next to «Витрати» — add it to `series` below.
 */
export function TrendScreen({ today = kyivToday() }: { today?: string }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" } | undefined>(undefined);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const group = useId();
  useEffect(() => {
    let live = true;
    void loadCategories(api).then((list) => live && setCategories(list));
    return () => {
      live = false;
    };
  }, [api]);

  const { result, retry } = useTrend(range, categoryId, today);
  const data = result.state === "ready" ? result.data : null;
  const view = data?.kind === "ready" ? data : null;
  const months = useMemo(() => view?.months ?? [], [view]);
  const currency = view?.currency ?? "EUR";
  const money = (amount: string) => formatMoney(locale, amount, currency);
  const label = (m: TrendMonth) => monthYear(t, m.period);
  const open = (period: string) => {
    const { from, to } = monthBounds(period);
    window.location.hash = `${TRANSACTIONS.path}?from=${from}&to=${to}`;
  };

  const short = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", {
      month: "short",
      timeZone: "UTC",
    });
    return (period: string) => f.format(new Date(`${period}-01T00:00:00Z`));
  }, [locale]);
  const categoriesOfChart: BarCategory[] = months.map((m) => ({
    id: m.period,
    label: months.length > 12 ? `${short(m.period)} ${m.period.slice(2, 4)}` : short(m.period),
    full: label(m),
  }));
  const values = (pick: (m: TrendMonth) => { amount: string } | null) =>
    months.map((m) => pick(m)?.amount ?? null);

  const ends = extremes(months);
  const first = months[0];
  const last = months.at(-1);
  const failure = result.state === "error" ? failureOf(result.failure) : null;

  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    label: t(c.label),
    sortable: true,
    ...(c.amount ? { type: "amount" as const, align: "end" as const } : {}),
  }));
  const sorted = useMemo(() => {
    // The board lists the latest period first; the chart keeps time left to right.
    if (!sort) return [...months].reverse();
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...months].sort((a, b) => {
      const x = valueOf(a, sort.key);
      const y = valueOf(b, sort.key);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sort.key === "period" ? dir * x.localeCompare(y) : dir * (Number(x) - Number(y));
    });
  }, [months, sort]);
  const dash = t("chart.dash");
  const cell = (m: { amount: string } | null) => (m ? money(m.amount) : dash);
  const rows: TableRow[] = sorted.map((m) => {
    const diff = difference(m);
    return {
      id: m.period,
      label: t("trend.row.open", { period: label(m) }),
      cells: {
        period: label(m),
        spent: cell(m.spent),
        plan: cell(m.plan),
        diff: diff === null ? dash : <Overshoot value={diff} currency={currency} />,
        income: cell(m.income),
      },
    };
  });

  return (
    <div className="trend">
      <div className="trend-head">
        <p className="ws-muted trend-subtitle">
          {first && last ? t("trend.subtitle", { from: label(first), to: label(last) }) : null}
        </p>
        <div className="trend-filter">
          <Select
            label={t("trend.category")}
            placeholder={t("trend.category.all")}
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <span className="ws-muted">{t("trend.scope")}</span>
        </div>
      </div>

      <section className="ws-card trend-card" aria-labelledby={`${group}-chart`}>
        <div className="trend-card-head">
          <div>
            <h2 id={`${group}-chart`} className="ws-text-label trend-title">
              {t("trend.card.title")}
            </h2>
            {ends ? (
              <p className="ws-muted trend-note">
                {t("trend.card.extremes", {
                  high: label(ends.high),
                  highAmount: money(ends.high.spent!.amount),
                  low: label(ends.low),
                  lowAmount: money(ends.low.spent!.amount),
                })}{" "}
                · {t("trend.card.hint")}
              </p>
            ) : months.length === 1 ? (
              <p className="ws-muted trend-note">
                {t("trend.one")} {t("trend.card.hint")}
              </p>
            ) : view ? (
              <p className="ws-muted trend-note">{t("trend.card.hint")}</p>
            ) : null}
          </div>
          <div className="trend-tools">
            <fieldset className="ws-segmented">
              <legend className="ws-visually-hidden">{t("trend.range.label")}</legend>
              <div className="ws-segmented-options">
                {RANGES.map((r) => (
                  <label key={r} className="ws-segmented-option">
                    <input
                      type="radio"
                      name={group}
                      value={r}
                      checked={range === r}
                      onChange={() => setRange(r)}
                    />
                    <span>{t(`trend.range.${r}` as MessageKey)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {/* BUD-06 FR 7: the chart has one view, «Стовпчики»; the button is shown inactive. */}
            <IconButton icon="bars" label={t("trend.view")} aria-disabled />
          </div>
        </div>
        <BarChart
          label={t("trend.chart.label")}
          categories={categoriesOfChart}
          series={[
            {
              id: "spent",
              name: t("trend.series.spent"),
              values: values((m) => m.spent),
              tone: "brand-2",
              goodWhen: "down",
            },
          ]}
          lines={[
            {
              id: "income",
              name: t("trend.series.income"),
              values: values((m) => m.income),
              tone: "chart-group-income-2",
              marker: "square",
              goodWhen: "up",
            },
            {
              id: "plan",
              name: t("trend.series.plan"),
              values: values((m) => m.plan),
              dash: [12, 4],
              marker: "diamond",
              step: true,
            },
          ]}
          currency={currency}
          height={300}
          legend
          changeLabel={t("trend.change")}
          onBarClick={(i) => months[i] && open(months[i]!.period)}
          loading={result.state === "loading"}
          emptyTitle={t("trend.empty.title")}
          emptyText={t("trend.empty.text")}
          {...(failure
            ? {
                error: {
                  text: t("trend.error.text"),
                  onRetry: retry,
                  ...(failure.code ? { code: failure.code } : {}),
                },
              }
            : {})}
        />
        {view && view.nearestRateCount > 0 ? (
          <p className="ws-muted trend-note">
            <StatusMark id="g.approximate" />
          </p>
        ) : null}
      </section>

      {months.length > 0 ? (
        <section className="ws-card trend-card" aria-labelledby={`${group}-table`}>
          <h2 id={`${group}-table`} className="ws-text-label trend-title">
            {t("trend.table.title")}
          </h2>
          <p className="ws-muted trend-note">{t("trend.table.hint")}</p>
          <Table
            caption={t("trend.table.caption")}
            columns={columns}
            rows={rows}
            sort={sort}
            onSort={(key) =>
              setSort((s) =>
                s?.key === key
                  ? { key: key as SortKey, direction: s.direction === "asc" ? "desc" : "asc" }
                  : { key: key as SortKey, direction: key === "period" ? "asc" : "desc" },
              )
            }
            onOpen={(row) => open(row.id)}
          />
        </section>
      ) : null}
    </div>
  );
}

/**
 * «Факт − план» of a month: the arrow and the amount, the colour is the meaning, not the direction — spending above
 * the plan is a loss, below it a gain (DS-04 FR 14; the arrow and the spoken name carry it without the colour).
 */
function Overshoot({ value, currency }: { value: string; currency: string }) {
  const { locale } = useI18n();
  const { text, direction, label } = formatDelta(locale, { amount: { value, currency, digits: 2 } });
  const tone = direction === "up" ? "ws-loss" : direction === "down" ? "ws-gain" : "ws-muted";
  return (
    <span className={`ws-tabular ${tone}`} data-direction={direction}>
      <span aria-hidden="true">{text}</span>
      <span className="ws-visually-hidden">{label}</span>
    </span>
  );
}
