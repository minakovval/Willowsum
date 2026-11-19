import { useI18n } from "@willowsum/i18n";
import { BUDGET, childPath } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";

/** The tabs of «Бюджет» that exist so far (UX-09@PoC EC 1): «Бюджет» and «Тренд»; «План», «Порівняння», «Грошовий потік» are later rows. */
export function useBudgetTabs() {
  const { t } = useI18n();
  return {
    label: t("trend.tabs"),
    tabs: [
      { id: "budget", label: t(BUDGET.label), href: hrefFor(BUDGET.path) },
      { id: "trend", label: t("trend.title"), href: hrefFor(childPath("budgetTrend")) },
    ],
  };
}
