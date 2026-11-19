import { formatDate, formatMoney, formatNumber, useI18n } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { barPercent, goalColor, TEMPLATE_ICON, type Goal } from "./model.ts";

/**
 * S-136 list of goals (BUD-05@PoC FR 1, FR 4; canvas PocPlanGoals): a row of a goal is its name, «зібрано з ціль · до
 * дата» and the percent, with the bar in the colour of the goal scale; an achieved goal shows «✓ Досягнуто» and a full
 * bar. The chosen goal opens in the card next to the list (master-detail).
 */
export function GoalList({
  goals,
  selected,
  onSelect,
}: {
  goals: readonly Goal[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const money = (m: { amount: string; currency: string }) => formatMoney(locale, m.amount, m.currency);
  return (
    <ul className="goal-list" aria-label={t("planning.goals.list.label")}>
      {goals.map((g) => {
        const percent = barPercent(g.progressPercent);
        const of = t("planning.goals.row.of", { collected: money(g.collected), target: money(g.target) });
        return (
          <li key={g.id}>
            <a
              className="goal-row"
              href={`#/planning/goals?goal=${g.id}`}
              aria-current={g.id === selected ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onSelect(g.id);
              }}
            >
              <span className="goal-row-icon" aria-hidden="true">
                <Icon name={TEMPLATE_ICON[g.template]} size={20} />
              </span>
              <span className="goal-row-body">
                <span className="goal-row-head">
                  <b>{g.name}</b>
                  {g.achieved ? <span className="goal-achieved">{t("planning.goals.achieved")}</span> : null}
                </span>
                <span className="ws-muted goal-row-sub">
                  {g.targetDate !== null
                    ? t("planning.goals.row.due", { of, date: formatDate(locale, g.targetDate) })
                    : t("planning.goals.row.noDate", { of })}
                </span>
                <span className="goal-row-bar">
                  <span className="goal-bar" aria-hidden="true">
                    <span
                      className="goal-bar-fill"
                      style={{ inlineSize: `${percent.toFixed(2)}%`, backgroundColor: goalColor(percent) }}
                    />
                  </span>
                  <span>{formatNumber(locale, g.progressPercent)} %</span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
