import { useI18n } from "@willowsum/i18n";
import { BUDGET, childPath } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";

/** The tabs of «Бюджет» that exist so far (UX-09@PoC EC 1): «Бюджет», «План», «Порівняння» and «Тренд»; «Грошовий потік» is a later row. */
export function useBudgetTabs() {
  const { t } = useI18n();
  return {
    label: t("trend.tabs"),
    tabs: [
      { id: "budget", label: t(BUDGET.label), href: hrefFor(BUDGET.path) },
      { id: "plan", label: t("planning.tab.plan"), href: hrefFor(childPath("budgetPlan")) },
      { id: "compare", label: t("planning.compare.title"), href: hrefFor(childPath("budgetCompare")) },
      { id: "trend", label: t("trend.title"), href: hrefFor(childPath("budgetTrend")) },
    ],
  };
}
