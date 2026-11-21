import { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import {
  formatMoney,
  formatPercent,
  useI18n,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import {
  BarChart,
  CHART_PERCENT,
  EmptyState,
  ErrorState,
  IconButton,
  PeriodPicker,
  Skeleton,
  StatusMark,
  Table,
  type BarCategory,
  type TableColumn,
  type TableRow,
} from "@willowsum/ui";
import { failureOf } from "../../auth/failure.ts";
import { kyivToday, useLoad, type Load } from "../../recurring/data.ts";
import { childPath, DEBTS, TRANSACTIONS } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { anchorTo, hasEarlier, isLatest, periodsOf, shiftPeriod } from "../compare/model.ts";
import { periodName } from "../compare/ComparePage.tsx";
import { FlowBand, type BandPart } from "./FlowBand.tsx";
import {
  extremesBy,
  hashOf,
  isNegative,
  isNonZero,
  loadFlow,
  stateFromHash,
  TYPES,
  type FlowData,
  type FlowMonth,
  type FlowState,
  type Money,
  type PeriodType,
} from "./model.ts";
import "./flow.css";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;
const PICKER = (key: string) => `planning.compare.picker.${key}` as MessageKey;

type Shown = { readonly key: string; readonly data: FlowData };
const keyOf = (s: FlowState) => `${s.type}:${s.period}`;

const monthName = (t: Translate, period: string): string =>
  t(`planning.budget.month.${period.slice(5, 7)}` as MessageKey);
const monthYear = (t: Translate, period: string): string => `${monthName(t, period)} ${period.slice(0, 4)}`;
const lower = (locale: Locale, text: string): string =>
  locale === "uk" ? text.toLocaleLowerCase("uk-UA") : text;

/**
 * BUD-08@PoC b) (row 134), S-134 «Грошовий потік» (PocPlanFlow, PocPlanFlowYear): the type and the period (CMP-72;
 * «Власний» is not offered), the figures, then the view «Місяць» (where the income went, the calculation, what is
 * neither income nor spending) or «Помісячно» (net flow and savings rate by month, the table). Read only; every sum,
 * rate and counter is the API's, the web only formats them (П-14).
 */
export function FlowScreen({ today = kyivToday() }: { today?: string }) {
  const { t, locale } = useI18n();
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const s = stateFromHash(hash, today);
  const key = keyOf(s);
  const load = useCallback(
    async (api: Parameters<typeof loadFlow>[0]): Promise<Load<Shown>> => {
      const r = await loadFlow(api, s);
      return r.state === "ready" ? { state: "ready", data: { key, data: r.data } } : r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const { result, reload } = useLoad(load);
  const shown = result.state === "ready" && result.data.key === key ? result.data.data : null;
  const report = shown?.report ?? null;
  const currency = report?.currency ?? "EUR";

  const go = (next: FlowState) => {
    window.location.hash = hashOf(childPath("budgetFlow"), next);
  };
  const name = (type: PeriodType, period: string) => periodName(t, locale, type, period, today);
  const label = name(s.type, s.period);
  const failure = result.state === "error" ? failureOf(result.failure) : null;

  return (
    <div className="flow">
      <div className="flow-head">
        <p className="ws-muted flow-subtitle">{t("flow.subtitle", { currency })}</p>
        <PeriodPicker
          typeLabel={t(PICKER("type"))}
          typeName={(type) => t(PICKER("typeName"), { type })}
          types={TYPES.map((id) => ({ id, label: t(`planning.compare.type.${id}` as MessageKey) }))}
          type={s.type}
          onTypeChange={(type) => {
            const to = type as PeriodType;
            go({ type: to, period: anchorTo(to, s.type, s.period, today) });
          }}
          periods={periodsOf(s.type, null, today).map((id) => ({ id, label: name(s.type, id) }))}
          period={s.period}
          periodLabel={label}
          periodListLabel={t(PICKER("list"))}
          prevLabel={t(PICKER("prev"))}
          nextLabel={t(PICKER("next"))}
          prevDisabled={!hasEarlier(s.type, s.period, null, today)}
          prevHint={t(PICKER("noEarlier"))}
          nextDisabled={isLatest(s.type, s.period, today)}
          onPrev={() => go({ ...s, period: shiftPeriod(s.type, s.period, -1) })}
          onNext={() => go({ ...s, period: shiftPeriod(s.type, s.period, 1) })}
          onPeriodChange={(period) => go({ ...s, period })}
          announce={(p) => t(PICKER("shown"), { period: p })}
        />
      </div>
      {failure ? (
        <section className="ws-card flow-state">
          <ErrorState text={t("flow.error.text")} onRetry={reload} code={failure.code} role="status" />
        </section>
      ) : report === null ? (
        <FlowSkeleton />
      ) : report.empty ? (
        <section className="ws-card flow-state">
          <EmptyState
            placement="block"
            title={t("flow.empty.title")}
            text={t("flow.empty.text")}
            primary={{ label: t("flow.empty.action"), href: hrefFor(TRANSACTIONS.path) }}
          />
        </section>
      ) : (
        <FlowBody s={s} data={shown!} label={label} />
      )}
    </div>
  );
}

/** П-13 «Завантаження»: the skeleton of the figures and of the cards. */
function FlowSkeleton() {
  return (
    <div className="flow-body" aria-busy="true" data-state="loading">
      <section className="ws-card flow-kpis">
        <Skeleton variant="block" height={64} />
      </section>
      <section className="ws-card flow-card">
        <Skeleton variant="block" height={240} />
      </section>
      <section className="ws-card flow-card">
        <Skeleton variant="block" height={240} />
      </section>
    </div>
  );
}

function FlowBody({ s, data, label }: { s: FlowState; data: FlowData; label: string }) {
  const { t, locale } = useI18n();
  const { report } = data;
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const rate = (r: string | null) =>
    r === null ? t("flow.kpi.rate.none") : formatPercent(locale, r, { digits: 1 });
  const { totals } = report;
  const monthly = report.view === "monthly";
  const first = report.months[0];
  const last = report.months.at(-1);
  const plural = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(
    report.approximate.nearestRateCount,
  );
  const form = plural === "one" || plural === "few" || plural === "many" ? plural : "other";

  return (
    <div className="flow-body" data-view={report.view}>
      <section className="ws-card flow-kpis" aria-label={label}>
        <Kpi
          title={
            monthly
              ? t("flow.kpi.period", { name: t("flow.kpi.income"), period: periodShort(s, label) })
              : t("flow.kpi.income")
          }
          value={money(totals.income)}
          hint={
            monthly && first && last
              ? t("flow.kpi.months", {
                  from: lower(locale, monthName(t, first.month)),
                  to: lower(locale, monthName(t, last.month)),
                  count: String(report.months.length),
                })
              : undefined
          }
        />
        <Kpi
          title={
            monthly
              ? t("flow.kpi.period", { name: t("flow.kpi.expenses"), period: periodShort(s, label) })
              : t("flow.kpi.expenses")
          }
          value={money(totals.expenses)}
          hint={
            monthly && isNonZero(totals.fromGoals)
              ? t("flow.kpi.fromGoals", { amount: money(totals.fromGoals) })
              : undefined
          }
        />
        <Kpi title={t("flow.kpi.net")} value={money(totals.netFlow)} hint={t("flow.kpi.net.hint")} />
        <Kpi
          title={t("flow.kpi.rate")}
          value={rate(totals.savingsRate)}
          hint={
            totals.savingsRate === null
              ? t("flow.kpi.rate.noIncome")
              : monthly && totals.averageMonthlyRate !== null
                ? t("flow.kpi.average", { rate: rate(totals.averageMonthlyRate) })
                : t("flow.kpi.rate.hint")
          }
        />
      </section>

      {report.approximate.nearestRateCount > 0 ? (
        <p className="ws-muted flow-note" data-note="approximate">
          <StatusMark id="g.approximate" />{" "}
          {t(`planning.budget.approx.${form}` as "planning.budget.approx.one", {
            count: report.approximate.nearestRateCount,
          })}{" "}
          · {t("flow.approx.hint")}
        </p>
      ) : null}
      {report.approximate.unavailableCount > 0 ? (
        <p className="ws-muted flow-note" data-note="unavailable">
          {t("planning.budget.rate.unavailable", { count: report.approximate.unavailableCount })} ·{" "}
          {t("flow.rate.unavailable.hint")}
        </p>
      ) : null}

      {monthly ? <MonthlyView data={data} /> : <MonthView data={data} label={label} />}
    </div>
  );
}

/** «Дохід · 2026», «Дохід · III квартал 2026»: the period after the name. */
const periodShort = (_s: FlowState, label: string): string => label;

function Kpi({ title, value, hint }: { title: string; value: string; hint?: string | undefined }) {
  return (
    <div className="flow-kpi">
      <span className="ws-muted">{title}</span>
      <b className="flow-kpi-value ws-tabular">{value}</b>
      {hint ? <span className="ws-muted flow-kpi-hint">{hint}</span> : null}
    </div>
  );
}

// ---- «Місяць» ----

function MonthView({ data, label }: { data: FlowData; label: string }) {
  const { t, locale } = useI18n();
  const group = useId();
  const { report } = data;
  const m = report.months[0]!;
  const f = report.totals;
  const money = (x: Money) => formatMoney(locale, x.amount, x.currency);
  const showInvestments = data.hasBrokerage || isNonZero(f.investmentContributions);
  const parts: BandPart[] = [
    { id: "expenses", label: t("flow.where.expenses"), amount: m.expenses, tone: 1 },
    { id: "goals", label: t("flow.where.goals"), amount: f.goalContributions.total, tone: 2 },
    ...(showInvestments
      ? [
          {
            id: "investments",
            label: t("flow.where.investments"),
            amount: f.investmentContributions,
            tone: 3,
          },
        ]
      : []),
    {
      id: "debt",
      label: t("flow.where.debt"),
      amount: f.debtRepayment,
      tone: 4,
      open: { href: hrefFor(DEBTS.path), label: t("flow.where.debt.open") },
    },
    { id: "left", label: t("flow.where.left"), amount: f.leftOnAccounts, tone: 5 },
  ];
  const goalParts = f.goalContributions.goals
    .filter((g) => data.goals.has(g.goalId))
    .map((g) => t("flow.calc.goals.parts", { goal: data.goals.get(g.goalId)!, amount: money(g.amount) }));
  const loans = report.loansWithoutRate.map((id) => data.accounts.get(id)).filter((n): n is string => !!n);
  const calc: CalcRow[] = [
    { id: "income", label: t("flow.kpi.income"), hint: t("flow.calc.income.hint"), amount: m.income },
    { id: "expenses", op: "minus", label: t("flow.where.expenses"), amount: m.expenses },
    {
      id: "net",
      op: "equals",
      label: t("flow.kpi.net"),
      hint: t("flow.calc.net.hint", {
        rate:
          m.savingsRate === null
            ? t("flow.kpi.rate.none")
            : formatPercent(locale, m.savingsRate, { digits: 1 }),
      }),
      amount: m.netFlow,
      total: true,
    },
    {
      id: "goals",
      op: "minus",
      label: t("flow.where.goals"),
      hint: goalParts.length > 0 ? goalParts.join(" · ") : t("flow.calc.goals.hint"),
      amount: f.goalContributions.total,
    },
    ...(showInvestments
      ? [
          {
            id: "investments",
            op: "minus" as const,
            label: t("flow.where.investments"),
            hint: [
              t("flow.calc.investments.hint"),
              isNonZero(f.investmentWithdrawals)
                ? t("flow.calc.investments.withdrawn", { amount: money(f.investmentWithdrawals) })
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            amount: f.investmentContributions,
          },
        ]
      : []),
    {
      id: "debt",
      op: "minus",
      label: t("flow.where.debt"),
      hint: [
        t("flow.calc.debt.hint"),
        loans.length > 0 ? t("flow.calc.debt.noRate", { loans: loans.join(", ") }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      amount: f.debtRepayment,
      open: { href: hrefFor(DEBTS.path), label: t("flow.where.debt.open") },
    },
    {
      id: "left",
      op: "equals",
      label: t("flow.where.left"),
      hint: isNegative(f.leftOnAccounts) ? t("flow.calc.left.negative") : undefined,
      amount: f.leftOnAccounts,
      total: true,
    },
  ];
  const unpaired = report.unpairedTransfers;
  const uncategorized = m.uncategorizedInflows;
  return (
    <div className="flow-columns">
      <div className="flow-main">
        <section className="ws-card flow-card" aria-labelledby={`${group}-where`}>
          <div className="flow-card-head">
            <div>
              <h2 id={`${group}-where`} className="ws-text-label flow-title">
                {t("flow.where.title")}
              </h2>
              <p className="ws-muted flow-card-note">{label}</p>
            </div>
            {/* CHT-03: the card has the view «Смуга» only; the button is shown inactive (BUD-08 FR 2). */}
            <IconButton icon="bars" label={t("flow.where.view")} aria-disabled />
          </div>
          <FlowBand total={m.income} parts={parts} />
        </section>
        <section className="ws-card flow-card" aria-labelledby={`${group}-calc`}>
          <div>
            <h2 id={`${group}-calc`} className="ws-text-label flow-title">
              {t("flow.calc.title")}
            </h2>
            <p className="ws-muted flow-card-note">{t("flow.calc.subtitle")}</p>
          </div>
          <ol className="flow-calc">
            {calc.map((r) => (
              <CalcLine key={r.id} row={r} money={money} />
            ))}
          </ol>
        </section>
      </div>
      {unpaired > 0 || uncategorized.count > 0 ? (
        <aside className="ws-card flow-card flow-side" aria-labelledby={`${group}-side`}>
          <div>
            <h2 id={`${group}-side`} className="ws-text-label flow-title">
              {t("flow.side.title")}
            </h2>
            <p className="ws-muted flow-card-note">{label}</p>
          </div>
          <ul className="flow-side-list">
            {unpaired > 0 ? (
              <li data-row="unpaired">
                <a href={hrefFor(childPath("pairs"))} className="flow-side-link">
                  <span>
                    <span className="flow-side-name">{t("flow.side.unpaired")}</span>
                    <span className="ws-muted flow-side-hint">
                      {unpaired} · {t("flow.side.unpaired.hint")}
                    </span>
                  </span>
                </a>
              </li>
            ) : null}
            {uncategorized.count > 0 ? (
              <li data-row="uncategorized">
                <span className="flow-side-name">{t("flow.side.uncategorized")}</span>
                <span className="ws-muted flow-side-hint">
                  {t("flow.side.uncategorized.hint", {
                    count: String(uncategorized.count),
                    amount: money(uncategorized.amount),
                  })}
                </span>
              </li>
            ) : null}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

interface CalcRow {
  readonly id: string;
  readonly op?: "minus" | "equals";
  readonly label: string;
  readonly hint?: string | undefined;
  readonly amount: Money;
  readonly total?: boolean;
  readonly open?: { href: string; label: string };
}

function CalcLine({ row, money }: { row: CalcRow; money: (m: Money) => string }) {
  const { t } = useI18n();
  return (
    <li className={`flow-calc-row${row.total ? " flow-calc-total" : ""}`} data-row={row.id}>
      <span className="flow-calc-op" aria-hidden="true">
        {row.op === "minus" ? "−" : row.op === "equals" ? "=" : ""}
      </span>
      {row.op ? (
        <span className="ws-visually-hidden">
          {t(row.op === "minus" ? "flow.calc.minus" : "flow.calc.equals")}
        </span>
      ) : null}
      <span className="flow-calc-text">
        <span className="flow-calc-name">{row.label}</span>
        {row.hint ? <span className="ws-muted flow-calc-hint">{row.hint}</span> : null}
      </span>
      <b className="ws-tabular flow-calc-amount">{money(row.amount)}</b>
      {row.open ? (
        <a className="flow-open" href={row.open.href} aria-label={row.open.label} title={row.open.label}>
          ›
        </a>
      ) : (
        <span className="flow-open-gap" aria-hidden="true" />
      )}
    </li>
  );
}

// ---- «Помісячно» ----

function MonthlyView({ data }: { data: FlowData }) {
  const { t, locale } = useI18n();
  const group = useId();
  const { report } = data;
  const months = report.months;
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const short = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", {
      month: "short",
      timeZone: "UTC",
    });
    return (period: string) => f.format(new Date(`${period}-01T00:00:00Z`));
  }, [locale]);
  const categories: BarCategory[] = months.map((m) => ({
    id: m.month,
    label: short(m.month),
    full: monthYear(t, m.month),
  }));
  const rate = (r: string | null) =>
    r === null ? t("flow.kpi.rate.none") : formatPercent(locale, r, { digits: 1 });
  const byMonth = (id: string | null): FlowMonth | undefined => months.find((m) => m.month === id);
  const high = byMonth(report.totals.highest);
  const low = byMonth(report.totals.lowest);
  const rateEnds = extremesBy(months, (m) => m.savingsRate);
  const hasFromGoals = months.some((m) => isNonZero(m.fromGoals));
  const dash = t("chart.dash");

  const columns: TableColumn[] = [
    { key: "month", label: t("flow.col.month") },
    { key: "income", label: t("flow.col.income"), type: "amount", align: "end" },
    { key: "expenses", label: t("flow.col.expenses"), type: "amount", align: "end" },
    { key: "fromGoals", label: t("flow.col.fromGoals"), type: "amount", align: "end" },
    { key: "net", label: t("flow.col.net"), type: "amount", align: "end" },
    { key: "rate", label: t("flow.col.rate"), type: "amount", align: "end" },
  ];
  const fromGoalsCell = (m: Money) => (isNonZero(m) ? money(m) : dash);
  const rows: TableRow[] = [
    ...[...months].reverse().map((m) => ({
      id: m.month,
      label: monthYear(t, m.month),
      cells: {
        month: monthYear(t, m.month),
        income: money(m.income),
        expenses: money(m.expenses),
        fromGoals: fromGoalsCell(m.fromGoals),
        net: <b>{money(m.netFlow)}</b>,
        rate: rate(m.savingsRate),
      },
    })),
    {
      id: "total",
      label: t("flow.col.month"),
      cells: {
        month: <b>{totalName(t, locale, months)}</b>,
        income: <b>{money(report.totals.income)}</b>,
        expenses: <b>{money(report.totals.expenses)}</b>,
        fromGoals: <b>{fromGoalsCell(report.totals.fromGoals)}</b>,
        net: <b>{money(report.totals.netFlow)}</b>,
        rate: <b>{rate(report.totals.savingsRate)}</b>,
      },
    },
  ];
  const currency = report.currency;
  return (
    <>
      <section className="ws-card flow-card" aria-labelledby={`${group}-net`}>
        <div className="flow-card-head">
          <div>
            <h2 id={`${group}-net`} className="ws-text-label flow-title">
              {t("flow.net.title")}
            </h2>
            {high && low ? (
              <p className="ws-muted flow-card-note">
                {t("flow.net.note", {
                  high: monthYear(t, high.month),
                  highAmount: money(high.netFlow),
                  low: monthYear(t, low.month),
                  lowAmount: money(low.netFlow),
                })}
              </p>
            ) : null}
          </div>
          {/* BUD-08 FR 10: the chart has one view, «Стовпчики»; the button is shown inactive. */}
          <IconButton icon="bars" label={t("flow.net.view")} aria-disabled />
        </div>
        <BarChart
          label={t("flow.net.label")}
          categories={categories}
          series={[
            {
              id: "net",
              name: t("flow.net.series"),
              values: months.map((m) => m.netFlow.amount),
              tone: "brand-2",
              goodWhen: "up",
            },
            ...(hasFromGoals
              ? [
                  {
                    id: "fromGoals",
                    name: t("flow.net.fromGoals"),
                    values: months.map((m) => (isNonZero(m.fromGoals) ? m.fromGoals.amount : null)),
                    tone: "brand-2" as const,
                    dotted: true,
                  },
                ]
              : []),
          ]}
          currency={currency}
          height={300}
          legend
          showValues={false}
        />
      </section>
      <section className="ws-card flow-card" aria-labelledby={`${group}-rate`}>
        <div>
          <h2 id={`${group}-rate`} className="ws-text-label flow-title">
            {t("flow.rate.title")}
          </h2>
          {rateEnds ? (
            <p className="ws-muted flow-card-note">
              {t("flow.rate.note", {
                high: monthYear(t, rateEnds.high.month),
                highRate: rate(rateEnds.high.savingsRate),
                low: monthYear(t, rateEnds.low.month),
                lowRate: rate(rateEnds.low.savingsRate),
              })}
            </p>
          ) : null}
        </div>
        {/* BUD-08 FR 10: one percent series, no view button. */}
        <BarChart
          label={t("flow.rate.label")}
          categories={categories}
          series={[]}
          lines={[
            {
              id: "rate",
              name: t("flow.rate.series"),
              values: months.map((m) => m.savingsRate),
              tone: "brand-2",
              goodWhen: "up",
            },
          ]}
          currency={CHART_PERCENT}
          height={240}
          legend
        />
      </section>
      <section className="ws-card flow-card" aria-labelledby={`${group}-table`}>
        <div>
          <h2 id={`${group}-table`} className="ws-text-label flow-title">
            {t("flow.table.title")}
          </h2>
          <p className="ws-muted flow-card-note">{t("flow.table.hint")}</p>
        </div>
        <Table caption={t("flow.table.caption")} columns={columns} rows={rows} />
      </section>
    </>
  );
}

/** The last row of the table: the period as the picker names it, or «Січень–жовтень 2026» for the months it spans. */
function totalName(t: Translate, locale: Locale, months: readonly FlowMonth[]): string {
  const first = months[0]!.month;
  const last = months.at(-1)!.month;
  const a = monthName(t, first);
  const b = monthName(t, last);
  const year = last.slice(0, 4);
  return first === last ? `${a} ${year}` : `${a}–${lower(locale, b)} ${year}`;
}
