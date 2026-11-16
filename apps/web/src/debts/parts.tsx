import { formatPercent, useI18n, useT, type MessageKey } from "@willowsum/i18n";
import { Icon, Progress } from "@willowsum/ui";
import { childPath, DEBTS, type ChildId } from "../routing/routes.ts";
import type { Debt } from "./api.ts";

export type DebtsTab = "list" | "plan" | "strategy" | "progress";

export const TABS: readonly { id: DebtsTab; label: MessageKey; subtitle: MessageKey; child?: ChildId }[] = [
  { id: "list", label: "debts.tab.list", subtitle: "debts.subtitle.list" },
  { id: "plan", label: "debts.tab.plan", subtitle: "debts.subtitle.plan", child: "debtsPlan" },
  {
    id: "strategy",
    label: "debts.tab.strategy",
    subtitle: "debts.subtitle.strategy",
    child: "debtsStrategy",
  },
  {
    id: "progress",
    label: "debts.tab.progress",
    subtitle: "debts.subtitle.progress",
    child: "debtsProgress",
  },
];

export const tabPath = (tab: DebtsTab): string => {
  const def = TABS.find((x) => x.id === tab)!;
  return def.child ? childPath(def.child) : DEBTS.path;
};

/** The debt's name and its kind («Кредитна картка», «Кредит»). */
export function DebtName({ debt }: { debt: Debt }) {
  const t = useT();
  return (
    <span className="debts-stack">
      <span className="debts-strong">{debt.name}</span>
      <span className="ws-muted debts-small">{t(`debts.kind.${debt.kind}`)}</span>
    </span>
  );
}

/** FR 7: «Погашено N %» as a progress bar (CMP-74, no ring); the share is rounded down on the server. */
export function PaidBar({ debt }: { debt: Debt }) {
  const { t, locale } = useI18n();
  return (
    <Progress
      label={t("debts.paidOf", { name: debt.name })}
      value={debt.progress.paidPercent}
      max={100}
      text={formatPercent(locale, String(debt.progress.paidPercent))}
      className="debts-paid"
    />
  );
}

/** FR 10: every result carries «Розрахунок за введеними даними, не фінансова порада». */
export function Disclaimer() {
  const t = useT();
  return (
    <p className="debts-disclaimer" role="note">
      <Icon name="info" size={16} tone="muted" />
      <span>{t("debts.disclaimer")}</span>
    </p>
  );
}
