import type { ReactNode } from "react";
import { useT, type MessageKey } from "@willowsum/i18n";
import { PageTabs } from "@willowsum/ui";
import { BUDGET, childPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";

export type BudgetTab = "budget" | "plan";

const TABS: readonly { id: BudgetTab; label: MessageKey; path: () => string }[] = [
  { id: "budget", label: "planning.tab.budget", path: () => BUDGET.path },
  { id: "plan", label: "planning.tab.plan", path: () => childPath("budgetPlan") },
];

/**
 * UX-09@PoC «Вкладки сторінки» of «Бюджет» (S-121 and S-126): «Бюджет» and «План». The other tabs of the canvas
 * («Порівняння», «Тренд», «Грошовий потік») come with their own rows of the plan; a tab is added here, in `TABS`.
 */
export function BudgetTabs({ selected, children }: { selected: BudgetTab; children: ReactNode }) {
  const t = useT();
  return (
    <PageTabs
      label={t("planning.tabs")}
      panelId="budget-panel"
      selected={selected}
      tabs={TABS.map((x) => ({ id: x.id, label: t(x.label), href: hrefFor(x.path()) }))}
    >
      {children}
    </PageTabs>
  );
}
