import { useCallback, useState, useSyncExternalStore } from "react";
import { formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, Icon, Skeleton } from "@willowsum/ui";
import { AppLayout } from "../pages/AppLayout.tsx";
import { PlanEmpty } from "./PlanEmpty.tsx";
import { GOALS } from "../routing/routes.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { failureOf } from "../auth/failure.ts";
import { kyivToday, useLoad } from "../recurring/data.ts";
import "./goals/goals.css";
import { PlanGrid, PlanRegion } from "./PlanGrid.tsx";
import { GoalCard } from "./goals/GoalCard.tsx";
import { GoalDialog } from "./goals/GoalDialog.tsx";
import { GoalLinks } from "./goals/GoalLinks.tsx";
import { GoalList } from "./goals/GoalList.tsx";
import { TEMPLATES } from "./goals/newGoal.ts";
import { collectedTotal, goalFromHash, loadGoals, type Goal } from "./goals/model.ts";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;

/**
 * GRID-04@PoC FR 3, FR 7, BUD-05@PoC c) FR 1, FR 4, FR 6, FR 13, S-136 «Цілі» (master-detail) and the card S-137: the
 * header «N активних цілей · зібрано …», the list of goals on 4 columns and on 8 the card of the chosen goal, the
 * projection (a slot until the chart lands) and the links («Де лежать гроші», the history). Without goals the page
 * shows its own empty state (#541, GRID-04 EC2) with the templates. «Нова ціль» and «Змінити ціль» (S-138, FR 2) open
 * the form dialog; «Витратити» (S-139) is row 129; there is no pause, archive, «Відстає» or auto-contribution in the PoC.
 */
export function GoalsPage({ today = kyivToday() }: { today?: string }) {
  const { t, locale } = useI18n();
  const title = t(GOALS.label);
  useDocumentTitle(title);
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const load = useCallback((api: Parameters<typeof loadGoals>[0]) => loadGoals(api), []);
  const { result, reload } = useLoad(load);
  const [creating, setCreating] = useState<{ template?: Goal["template"] } | null>(null);
  const data = result.state === "ready" ? result.data : null;
  const goals = data?.goals ?? [];
  const wanted = goalFromHash(hash);
  const goal = goals.find((g) => g.id === wanted) ?? goals[0];
  const total = data ? collectedTotal(goals) : null;
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(goals.length);
  const count = t(`planning.goals.summary.${rule}` as "planning.goals.summary.one", { count: goals.length });

  return (
    <AppLayout sectionId={GOALS.sectionId} pageId={GOALS.id}>
      <div className="app-page-head">
        <div>
          <h1>{title}</h1>
          {data && goals.length > 0 ? (
            <p className="ws-muted">
              {total
                ? t("planning.goals.summary.collected", {
                    count,
                    sum: formatMoney(locale, total.amount, total.currency),
                  })
                : count}
            </p>
          ) : null}
        </div>
        {data && goals.length > 0 ? (
          <div className="app-page-actions">
            <Button variant="primary" label={t("planning.goals.new.open")} onClick={() => setCreating({})} />
          </div>
        ) : null}
      </div>
      {data && creating ? (
        <GoalDialog
          goals={goals}
          today={today}
          template={creating?.template}
          fallbackCurrency={goals[0]?.target.currency ?? "UAH"}
          onClose={() => setCreating(null)}
          onSaved={(id) => {
            setCreating(null);
            window.location.hash = `${GOALS.path}?goal=${id}`;
            reload();
          }}
        />
      ) : null}
      <PlanGrid page="goals">
        <PlanRegion name="list" span={4}>
          {result.state === "error" ? (
            <section className="ws-card goal-card" role="alert" aria-labelledby="goals-error-title">
              <h2 id="goals-error-title" className="ws-text-heading-3">
                <Icon name="close" size={16} /> {t("planning.goals.error.title")}
              </h2>
              <p className="ws-muted">{t("planning.goals.error.body")}</p>
              <p>
                <button type="button" className="ws-button" onClick={reload}>
                  {t("planning.goals.error.retry")}
                </button>
              </p>
              {failureOf(result.failure).code ? (
                <p className="ws-muted">
                  {t("planning.goals.error.code", { code: failureOf(result.failure).code ?? "" })}
                </p>
              ) : null}
            </section>
          ) : !data ? (
            <section className="ws-card goal-card" aria-label={t("planning.goals.loading")}>
              <Skeleton variant="row" lines={4} />
            </section>
          ) : goal ? (
            <GoalList
              goals={goals}
              selected={goal.id}
              onSelect={(id) => {
                window.location.hash = `${GOALS.path}?goal=${id}`;
              }}
            />
          ) : (
            <PlanEmpty icon={GOALS.icon} page="goals">
              <ul className="goal-templates" aria-label={t("planning.goals.new.templates")}>
                {TEMPLATES.map((x) => (
                  <li key={x}>
                    <button
                      type="button"
                      className="goal-template"
                      onClick={() => setCreating({ template: x })}
                    >
                      <b>{t(`planning.goals.template.${x}` as MessageKey)}</b>
                      <span className="ws-muted">{t(`planning.goals.new.template.${x}` as MessageKey)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                label={t("planning.goals.new.open")}
                onClick={() => setCreating({})}
              />
            </PlanEmpty>
          )}
        </PlanRegion>
        <div className="plan-region plan-span-8 plan-stack" data-plan-region="detail">
          {data && goal ? (
            <PlanRegion name="goal" span={12}>
              <GoalCard
                key={goal.id}
                goal={goal}
                accounts={data.accounts}
                today={today}
                goals={goals}
                onChanged={reload}
                onGone={reload}
              >
                <GoalLinks goal={goal} accounts={data.accounts} />
              </GoalCard>
            </PlanRegion>
          ) : (
            <PlanRegion name="goal" span={12} />
          )}
          <PlanRegion name="projection" span={12} />
          {data && goal ? null : <PlanRegion name="links" span={12} />}
        </div>
      </PlanGrid>
    </AppLayout>
  );
}
