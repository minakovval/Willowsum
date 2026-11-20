import { useCallback, useSyncExternalStore } from "react";
import { formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { Button, Icon, IconButton, PageTabs, Skeleton, StatusMark } from "@willowsum/ui";
import { hrefFor } from "../routing/useHashPath.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { PlanEmpty } from "./PlanEmpty.tsx";
import { useBudgetTabs } from "./trend/tabs.ts";
import { BUDGET, childPath } from "../routing/routes.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { failureOf } from "../auth/failure.ts";
import { kyivToday, useLoad } from "../recurring/data.ts";
import "./budget/budget.css";
import { PlanGrid, PlanRegion } from "./PlanGrid.tsx";
import { SpendableCard } from "./spendable/SpendableCard.tsx";
import { CategoriesCard } from "./budget/CategoriesCard.tsx";
import {
  budgetFailureKey,
  loadBudget,
  monthOf,
  periodFromHash,
  shiftMonth,
  type BudgetView,
  type Money,
} from "./budget/model.ts";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;

/** The month of a period in the words of the catalogue (so that a pseudo-locale shows it too): «Листопад». */
const monthName = (t: Translate, period: string): string =>
  t(`planning.budget.month.${period.slice(5, 7)}` as MessageKey);
/** «Листопад 2026» (S-121 title of the period). */
const monthYear = (t: Translate, period: string): string => `${monthName(t, period)} ${period.slice(0, 4)}`;

/**
 * GRID-04@PoC FR 1, BUD-02@PoC d) FR 9, FR 16, S-121 / S-289 «Бюджет» (template Dashboard): the header with the
 * budget period «‹ Листопад 2026 ›», then «Можна витратити», «Дохід» and «Регулярні платежі» — three blocks of 4
 * columns and one height — and the categories on 12. The current month shows the fact, a past one the plan against
 * the fact, a future one only the plan under the banner «Це план на <місяць> — витрат ще немає». Without a budget the
 * page shows its own empty state (#541, GRID-04 EC1). «Можна витратити» is the card of BUD-03 (row 126, only in the current month) and «Регулярні платежі» the slot of
 * BUD-07 (row 130); the tabs are the next rows.
 */
export function BudgetPage({ today = kyivToday() }: { today?: string }) {
  const { t } = useI18n();
  const tabs = useBudgetTabs();
  const title = t(BUDGET.label);
  useDocumentTitle(title);
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const current = monthOf(today);
  const period = periodFromHash(hash) ?? current;
  const load = useCallback(
    (api: Parameters<typeof loadBudget>[0]) => loadBudget(api, period, today),
    [period, today],
  );
  const { result, reload } = useLoad(load);
  const data = result.state === "ready" ? result.data : null;
  const settled = data !== null && (data.kind !== "ready" || data.period.period === period);

  const go = (month: string) => {
    window.location.hash = `${BUDGET.path}?period=${month}`;
  };
  const monthLabel = monthYear(t, period);
  const atStart = data?.kind === "ready" && period <= data.firstPeriod;

  return (
    <AppLayout sectionId={BUDGET.sectionId} pageId={BUDGET.id}>
      <div className="app-page-head bud-head">
        <h1>{title}</h1>
        <div className="bud-period" role="group" aria-label={t("planning.budget.period.group")}>
          <IconButton
            icon="chevron-left"
            label={t("planning.budget.period.prev")}
            aria-disabled={atStart || undefined}
            onClick={() => (atStart ? undefined : go(shiftMonth(period, -1)))}
          />
          <span className="bud-period-label" aria-live="polite">
            {monthLabel}
          </span>
          <IconButton
            icon="chevron-right"
            label={t("planning.budget.period.next")}
            onClick={() => go(shiftMonth(period, 1))}
          />
        </div>
        {data && data.kind !== "none" ? (
          <a
            className="ws-icon-button"
            href={hrefFor(childPath("budgetGeneral"))}
            aria-label={t("planning.budget.settings.open")}
            title={t("planning.budget.settings.open")}
          >
            <Icon name="settings" size={20} />
          </a>
        ) : null}
      </div>
      <PageTabs label={tabs.label} panelId="budget-panel" selected="budget" tabs={tabs.tabs}>
        <PlanGrid page="budget">
          {data?.kind === "ready" && settled && data.period.mode === "current" ? (
            <SpendableCard period={data.period.period} />
          ) : (
            <PlanRegion name="spendable" span={4} />
          )}
          {data?.kind === "ready" && settled ? (
            <PlanRegion name="income" span={4} card>
              <IncomeCard view={data} />
            </PlanRegion>
          ) : (
            <PlanRegion name="income" span={4} />
          )}
          <PlanRegion name="recurring" span={4} />
          <PlanRegion name="categories" span={12}>
            {result.state === "error" ? (
              <section className="ws-card bud-card" role="alert" aria-labelledby="bud-error-title">
                <h2 id="bud-error-title" className="ws-text-heading-3 bud-card-title">
                  <Icon name="close" size={16} /> {t("planning.budget.error.title")}
                </h2>
                <p className="ws-muted">{t(budgetFailureKey(result.failure))}</p>
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
              </section>
            ) : !data || !settled ? (
              <section className="ws-card bud-card" aria-label={t("planning.budget.categories.title")}>
                <Skeleton variant="row" lines={6} />
              </section>
            ) : data.kind === "none" ? (
              <PlanEmpty icon={BUDGET.icon} page="budget">
                <div className="bud-wiz-cta">
                  <Button
                    variant="primary"
                    href={hrefFor(childPath("budgetNew"))}
                    label={t("planning.budget.wizard.method.spending")}
                  />
                  <Button
                    variant="secondary"
                    href={hrefFor(childPath("budgetNew"))}
                    label={t("planning.budget.wizard.method.zero")}
                  />
                </div>
              </PlanEmpty>
            ) : data.kind === "before" ? (
              <section className="ws-card bud-card">
                <p role="status">{t("planning.budget.beforeStart")}</p>
              </section>
            ) : (
              <>
                <PeriodNotes view={data} month={monthYear(t, data.period.period)} />
                <CategoriesCard key={data.period.period} view={data} plan={data.period.mode === "future"} />
              </>
            )}
          </PlanRegion>
        </PlanGrid>
      </PageTabs>
    </AppLayout>
  );
}

/** The future month's banner (S-289), the note of a past month and the approximate-rate marks (BUD-02 AC3, AC8). */
function PeriodNotes({ view, month }: { view: BudgetView; month: string }) {
  const { t, locale } = useI18n();
  const { mode, approximate, period } = view.period;
  const name = monthName(t, period);
  // «Це план на грудень»: the month in the sentence is lower case in Ukrainian.
  const inSentence = locale === "uk" ? name.toLocaleLowerCase("uk-UA") : name;
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(approximate.nearestRateCount);
  const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
  return (
    <>
      {mode === "future" ? (
        <div className="bud-banner" role="status">
          <p>
            <StatusMark id="g.futureMonth" params={{ month: inSentence }} />
          </p>
          <p className="ws-muted">
            {t("planning.budget.future.hint", {
              date: t("planning.budget.firstDay", {
                month: t(`planning.budget.monthOf.${period.slice(5, 7)}` as MessageKey),
              }),
            })}
          </p>
        </div>
      ) : null}
      {mode === "past" ? <p className="bud-note">{t("planning.budget.past.note", { month })}</p> : null}
      {approximate.nearestRateCount > 0 ? (
        <p className="bud-note">
          <StatusMark id="g.approximate" />{" "}
          {t(`planning.budget.approx.${form}` as "planning.budget.approx.one", {
            count: approximate.nearestRateCount,
          })}
        </p>
      ) : null}
      {approximate.unavailableCount > 0 ? (
        <p className="bud-note">
          {t("planning.budget.rate.unavailable", { count: approximate.unavailableCount })}
        </p>
      ) : null}
    </>
  );
}

/** «Дохід» (BUD-02 FR 9): the plan and the fact of the month as the API gives them; the sources wait for their API. */
function IncomeCard({ view }: { view: BudgetView }) {
  const { t, locale } = useI18n();
  const { incomePlan, incomeActual, mode } = view.period;
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  return (
    <section className="bud-card" aria-labelledby="bud-income-title">
      <h2 id="bud-income-title" className="ws-text-heading-3 bud-card-title">
        {t("planning.budget.income.title")}
      </h2>
      <dl className="bud-figures">
        <div>
          <dt>{t("planning.budget.income.plan")}</dt>
          <dd>{money(incomePlan)}</dd>
        </div>
        {mode !== "future" && incomeActual ? (
          <div>
            <dt>{t("planning.budget.income.actual")}</dt>
            <dd>{money(incomeActual)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
