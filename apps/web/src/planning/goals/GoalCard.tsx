import { useState, type ReactNode } from "react";
import { formatDate, formatMoney, formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, ConfirmDialog, Icon, IconButton, MoreActions } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { TRANSACTIONS } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import type { AccountLabel } from "../../recurring/data.ts";
import { GoalDialog } from "./GoalDialog.tsx";
import { SpendDialog } from "./SpendDialog.tsx";
import { ContributeButton } from "./ContributePopover.tsx";
import { barPercent, goalColor, TEMPLATE_ICON, type Goal, type Money } from "./model.ts";

const money = (locale: Parameters<typeof formatMoney>[0], m: Money) =>
  formatMoney(locale, m.amount, m.currency);

/** The bar of the goal (BUD-05@PoC FR 4): the fill is the colour of the goal scale at its percent. */
export function GoalBar({ goal, label }: { goal: Goal; label: string }) {
  const percent = barPercent(goal.progressPercent);
  return (
    <div
      className="goal-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number.parseInt(percent.toFixed(0), 10)}
    >
      <span
        className="goal-bar-fill"
        style={{ inlineSize: `${percent.toFixed(2)}%`, backgroundColor: goalColor(percent) }}
      />
    </div>
  );
}

/** The goal's amber icon: amber is only for goals (GRID-04@PoC FR 7); it shows the template glyph. */
export const GoalIcon = ({ template }: { template: Goal["template"] }) => (
  <span className="goal-icon">
    <Icon name={TEMPLATE_ICON[template]} size={20} />
  </span>
);

export function partLabel(goal: Goal): MessageKey {
  return `planning.goals.part.${goal.part.kind}`;
}

/**
 * S-137 «Картка цілі» (BUD-05@PoC FR 4, FR 6, FR 13; canvas PocPlanGoalCard, PocPlanGoalCardContribute,
 * PocPlanGoalCardAchieved): the name, the template and the part, collected / target with the percent and the bar, the
 * date, the required monthly contribution, the forecast and the pace, «Внести» (a popover) or — for a separate account —
 * the hint about a transfer, and the menu «⋯» with «Змінити ціль» (S-138; BUD-05 FR 13, AC 7), «Закрити без витрати» and «Видалити». «Витратити» (S-139, BUD-05@PoC d)) opens `SpendDialog`: primary on an achieved goal, secondary otherwise.
 */
export function GoalCard({
  goal,
  accounts,
  goals,
  today,
  onChanged,
  onGone,
  children,
}: {
  children?: ReactNode;
  goal: Goal;
  goals: readonly Goal[];
  accounts: ReadonlyMap<string, AccountLabel>;
  today: string;
  onChanged: () => void;
  onGone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [asking, setAsking] = useState<"close" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [spending, setSpending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const account = goal.part.accountId !== null ? accounts.get(goal.part.accountId) : undefined;
  const num = (v: string) => formatNumber(locale, v);
  const rows: { key: MessageKey; hint?: string; value: string }[] = [];

  rows.push({
    key: "planning.goals.date",
    value: goal.targetDate !== null ? formatDate(locale, goal.targetDate) : t("planning.goals.noDate"),
    ...(goal.targetDate === null
      ? { hint: t("planning.goals.progressOnly") }
      : goal.overdue
        ? { hint: t("planning.goals.overdue") }
        : {}),
  });
  if (goal.requiredMonthly !== null && !goal.achieved)
    rows.push({
      key: "planning.goals.required",
      value: t("planning.goals.perMonth", {
        amount: formatMoney(locale, goal.requiredMonthly.amount, goal.requiredMonthly.currency, {
          digits: 0,
        }),
      }),
      hint: t("planning.goals.requiredHint"),
    });
  if (goal.forecastDate !== null && !goal.achieved)
    rows.push({
      key: "planning.goals.forecast",
      value: formatDate(locale, goal.forecastDate),
      hint: t("planning.goals.forecastHint"),
    });
  if (goal.pace !== null)
    rows.push({
      key: "planning.goals.pace",
      value: t("planning.goals.perMonth", { amount: money(locale, goal.pace) }),
    });

  const run = async (action: "close" | "delete") => {
    setBusy(true);
    setFailed(false);
    const done =
      action === "close"
        ? await outcome(api.POST("/v1/goals/{goalId}/close", { params: { path: { goalId: goal.id } } }))
        : await outcome(api.DELETE("/v1/goals/{goalId}", { params: { path: { goalId: goal.id } } }));
    setBusy(false);
    if (!done.ok && !(done.kind === "problem" && done.problem.status === 404)) {
      setFailed(true);
      return;
    }
    setAsking(null);
    onGone();
  };

  const mask = account?.mask ?? null;
  const spendButton = (
    <Button
      label={t("planning.goals.menu.spend")}
      variant={goal.achieved ? "primary" : "secondary"}
      icon="money"
      onClick={() => setSpending(true)}
    />
  );

  return (
    <section className="ws-card goal-card" aria-label={goal.name} data-achieved={goal.achieved || undefined}>
      <header className="goal-card-head">
        <GoalIcon template={goal.template} />
        <div className="goal-card-title">
          <h2 className="ws-text-heading-3">{goal.name}</h2>
          <p className="ws-muted">
            {t(`planning.goals.template.${goal.template}` as MessageKey)} · {t(partLabel(goal))}
          </p>
        </div>
        {goal.achieved ? <span className="goal-achieved">{t("planning.goals.achieved")}</span> : null}
        <IconButton icon="edit" label={t("planning.goals.menu.edit")} onClick={() => setEditing(true)} />
        <MoreActions
          items={[
            {
              id: "edit",
              label: t("planning.goals.menu.edit"),
              icon: "edit",
              onSelect: () => setEditing(true),
            },
            {
              id: "close",
              label: t("planning.goals.menu.close"),
              icon: "check",
              onSelect: () => setAsking("close"),
            },
            {
              id: "delete",
              label: t("planning.goals.menu.delete"),
              icon: "trash",
              danger: true,
              onSelect: () => setAsking("delete"),
            },
          ]}
        />
      </header>
      <div className="goal-card-sum">
        <b className="ws-text-heading-2">{money(locale, goal.collected)}</b>
        <span className="ws-muted">
          {t("planning.goals.card.of", { target: money(locale, goal.target) })}
        </span>
        <b className="goal-card-percent">{num(goal.progressPercent)} %</b>
      </div>
      <GoalBar goal={goal} label={t("planning.goals.card.progress", { name: goal.name })} />
      {goal.overTarget !== null ? (
        <p className="goal-achieved">
          {t("planning.goals.over", { amount: money(locale, goal.overTarget) })}
        </p>
      ) : null}
      <dl className="goal-facts">
        {rows.map((r) => (
          <div key={r.key} className="goal-fact">
            <dt className="ws-muted">{t(r.key)}</dt>
            <dd>
              <b>{r.value}</b>
              {r.hint ? <span className="ws-muted">{r.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {goal.part.kind === "account" ? (
        <p className="goal-transfer" role="note">
          <Icon name="info" size={16} />
          <span>
            {t("planning.goals.transfer.hint", { mask: mask ?? "" })}{" "}
            <a
              href={hrefFor(
                `${TRANSACTIONS.path}/new?type=transfer${goal.part.accountId ? `&to=${goal.part.accountId}` : ""}`,
              )}
            >
              {t("planning.goals.transfer.link")}
            </a>
          </span>
        </p>
      ) : null}
      <div className="goal-card-actions">
        {goal.achieved ? spendButton : null}
        {goal.part.kind === "account" ? null : (
          <ContributeButton goal={goal} today={today} quiet={goal.achieved} onAdded={onChanged} />
        )}
        {goal.achieved ? null : spendButton}
      </div>
      {children}
      {spending ? (
        <SpendDialog
          goal={goal}
          accounts={accounts}
          onClose={() => setSpending(false)}
          onSpent={() => {
            setSpending(false);
            onChanged();
          }}
          onGone={() => {
            setSpending(false);
            onGone();
          }}
        />
      ) : null}
      {editing ? (
        <GoalDialog
          goal={goal}
          goals={goals}
          today={today}
          fallbackCurrency={goal.target.currency}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={t(asking === "delete" ? "planning.goals.delete.title" : "planning.goals.close.title", {
          name: goal.name,
        })}
        text={t(asking === "delete" ? "planning.goals.delete.text" : "planning.goals.close.text")}
        tone={asking === "delete" ? "danger" : "warning"}
        icon={asking === "delete" ? "trash" : "check"}
        closeLabel={t("planning.goals.dialog.close")}
        cancelLabel={t("planning.goals.dialog.cancel")}
        confirmLabel={t(
          asking === "delete" ? "planning.goals.delete.confirm" : "planning.goals.close.confirm",
        )}
        busyLabel={t(asking === "delete" ? "planning.goals.delete.busy" : "planning.goals.close.busy")}
        busy={busy}
        error={failed ? t("planning.goals.dialog.error") : undefined}
        onConfirm={() => void run(asking ?? "close")}
      />
    </section>
  );
}
