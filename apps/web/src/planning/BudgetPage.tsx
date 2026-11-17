import { useT } from "@willowsum/i18n";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { BUDGET } from "../routing/routes.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { PlanGrid, PlanRegion } from "./PlanGrid.tsx";

/**
 * GRID-04@PoC FR 1, S-121 «Бюджет» (template Dashboard): the header with the tabs, then «Можна витратити»,
 * «Дохід» and «Регулярні платежі» — three blocks of 4 columns and one height — and the categories on 12.
 * Only the grid: the blocks are the slots of BUD-02 (wave 2, row 123); the tabs are the next rows.
 */
export function BudgetPage() {
  const t = useT();
  const title = t(BUDGET.label);
  useDocumentTitle(title);
  return (
    <AppLayout sectionId={BUDGET.sectionId} pageId={BUDGET.id}>
      <div className="app-page-head">
        <h1>{title}</h1>
      </div>
      <div className="plan-tabs-slot" data-plan-region="tabs" />
      <PlanGrid page="budget">
        <PlanRegion name="spendable" span={4} />
        <PlanRegion name="income" span={4} />
        <PlanRegion name="recurring" span={4} />
        {/* Until BUD-02 d) (row 123) fills the page it keeps the shell's empty state (DS-01 FR 7). */}
        <PlanRegion name="categories" span={12}>
          <EmptyState icon={BUDGET.icon} />
        </PlanRegion>
      </PlanGrid>
    </AppLayout>
  );
}
