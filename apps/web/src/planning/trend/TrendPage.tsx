import { useI18n } from "@willowsum/i18n";
import { PageTabs } from "@willowsum/ui";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { BUDGET, SECTIONS, rootOf } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import { useBudgetTabs } from "./tabs.ts";
import { TrendScreen } from "./TrendScreen.tsx";

const PANEL_ID = "budget-trend-panel";

/** BUD-16@PoC b), S-133 «Тренд» (PocPlanTrend): «Планування › Бюджет › Тренд», the heading, the tabs and the screen. */
export function TrendPage() {
  const { t } = useI18n();
  const title = t("trend.title");
  useDocumentTitle(title);
  const planning = SECTIONS.find((s) => s.id === "planning")!;
  const { label, tabs } = useBudgetTabs();
  return (
    <AppLayout sectionId={BUDGET.sectionId} pageId={BUDGET.id}>
      <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
        <ol>
          <li>
            <a href={hrefFor(rootOf(planning).path)}>{t(planning.label)}</a>
          </li>
          <li>
            <a href={hrefFor(BUDGET.path)}>{t(BUDGET.label)}</a>
          </li>
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <div className="app-page-head">
        <h1>{title}</h1>
      </div>
      <PageTabs label={label} panelId={PANEL_ID} selected="trend" tabs={tabs}>
        <TrendScreen />
      </PageTabs>
    </AppLayout>
  );
}
