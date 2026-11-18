import { useT } from "@willowsum/i18n";
import { AppLayout } from "../pages/AppLayout.tsx";
import { PlanEmpty } from "./PlanEmpty.tsx";
import { GOALS } from "../routing/routes.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { PlanGrid, PlanRegion } from "./PlanGrid.tsx";

/**
 * GRID-04@PoC FR 3, S-136 «Цілі» (master-detail): the header, the list of goals on 4 columns and on 8 the detail
 * with the projection and the links. Only the grid: the blocks are the slots of BUD-03 (wave 2, later rows).
 */
export function GoalsPage() {
  const t = useT();
  const title = t(GOALS.label);
  useDocumentTitle(title);
  return (
    <AppLayout sectionId={GOALS.sectionId} pageId={GOALS.id}>
      <div className="app-page-head">
        <h1>{title}</h1>
      </div>
      <PlanGrid page="goals">
        {/* Until BUD-05 c) (row 128) fills the page it shows its own empty state (GRID-04 EC1, EC2). */}
        <PlanRegion name="list" span={4}>
          <PlanEmpty icon={GOALS.icon} page="goals" />
        </PlanRegion>
        <div className="plan-region plan-span-8 plan-stack" data-plan-region="detail">
          <PlanRegion name="goal" span={12} />
          <PlanRegion name="projection" span={12} />
          <PlanRegion name="links" span={12} />
        </div>
      </PlanGrid>
    </AppLayout>
  );
}
