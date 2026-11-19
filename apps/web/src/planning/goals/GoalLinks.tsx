import { Decimal } from "@willowsum/domain-kernel";
import { formatDate, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import type { AccountLabel } from "../../recurring/data.ts";
import type { Goal } from "./model.ts";

/**
 * S-137, region «Зв'язки» (BUD-05@PoC FR 2, FR 4; canvas PocPlanGoalCard, PocPlanGoalCardContribute): «Де лежать
 * гроші» — the one part of the goal with its account, and the history of contributions with the starting amount.
 * The amounts are the API's own.
 */
export function GoalLinks({ goal, accounts }: { goal: Goal; accounts: ReadonlyMap<string, AccountLabel> }) {
  const { t, locale } = useI18n();
  const money = (m: { amount: string; currency: string }) => formatMoney(locale, m.amount, m.currency);
  const account = goal.part.accountId !== null ? accounts.get(goal.part.accountId) : undefined;
  const kind = goal.part.kind;
  const collectedKey: MessageKey =
    kind === "account"
      ? "planning.goals.links.collectedAccount"
      : kind === "envelope"
        ? "planning.goals.links.collectedEnvelope"
        : "planning.goals.links.collectedMarks";
  const start = goal.part.startAmount;
  const hasStart = new Decimal(start.amount).gt(0);
  return (
    <>
      <section className="goal-links" aria-labelledby="goal-where">
        <h3 id="goal-where" className="ws-text-label ws-muted">
          {t("planning.goals.links.title")}
        </h3>
        <p className="ws-muted">{t("planning.goals.links.one")}</p>
        <dl className="goal-facts">
          {account ? (
            <div>
              <dt className="ws-muted">{t("planning.goals.links.account")}</dt>
              <dd>
                {account.label} · {t(`planning.goals.part.${kind}` as MessageKey)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="ws-muted">{t(`planning.goals.part.${kind}` as MessageKey)}</dt>
            <dd>
              {money(goal.collected)} <span className="ws-muted">· {t(collectedKey)}</span>
              {goal.part.freeBalance !== null ? (
                <span className="ws-muted">
                  {" · "}
                  {t("planning.goals.links.free", { free: money(goal.part.freeBalance) })}
                </span>
              ) : null}
            </dd>
          </div>
          {new Decimal(goal.contributedThisMonth.amount).gt(0) ? (
            <div>
              <dt className="ws-muted">{t("planning.goals.links.month")}</dt>
              <dd>{t("planning.goals.links.contributed", { amount: money(goal.contributedThisMonth) })}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="goal-links" aria-labelledby="goal-history">
        <h3 id="goal-history" className="ws-text-label ws-muted">
          {t("planning.goals.history.title")}
        </h3>
        {goal.contributions.length === 0 && !hasStart ? (
          <p className="ws-muted">{t("planning.goals.history.empty")}</p>
        ) : (
          <ul className="goal-history">
            {goal.contributions.map((c) => (
              <li key={c.id}>
                <span>{formatDate(locale, c.date)}</span>
                <span className="ws-muted">{t("planning.goals.history.manual")}</span>
                <b>+{money(c.amount)}</b>
              </li>
            ))}
            {hasStart ? (
              <li>
                <span>{formatDate(locale, goal.createdOn)}</span>
                <span className="ws-muted">{t("planning.goals.history.start")}</span>
                <b>+{money(start)}</b>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </>
  );
}
