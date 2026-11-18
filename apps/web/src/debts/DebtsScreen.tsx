import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, PageTabs, Skeleton } from "@willowsum/ui";
import { childPath, DEBTS, rootOf, SECTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { PlanGrid, PlanRegion } from "../planning/PlanGrid.tsx";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { useDebts, type DebtsState } from "./api.ts";
import { DebtsList } from "./DebtsList.tsx";
import "./debts.css";
import { DebtsPlan } from "./DebtsPlan.tsx";
import { DebtsProgress } from "./DebtsProgress.tsx";
import { DebtsStrategy } from "./DebtsStrategy.tsx";
import { TABS, tabPath, type DebtsTab } from "./parts.tsx";

export type { DebtsTab };

const PANEL_ID = "debts-panel";

/**
 * BUD-19@PoC FR 11: the page «Борги» of «Планування» with the tabs «Борги · План погашення · Стратегія · Прогрес»
 * (S-143…S-146). The menu item is always there; without debts the page is one empty state «Боргів не додано»
 * (FR 11, AC10). No «›» in the heading and no link to «Активи › Зобов'язання».
 */
export function DebtsScreen({ tab }: { tab: DebtsTab }) {
  const t = useT();
  const { state, retry, refresh } = useDebts();
  const def = TABS.find((x) => x.id === tab)!;
  const title = t(def.label);
  useDocumentTitle(title);
  const planning = SECTIONS.find((s) => s.id === "planning")!;
  const empty = state.kind === "ready" && state.debts.length === 0;

  return (
    <AppLayout sectionId="planning" pageId={DEBTS.id}>
      <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
        <ol>
          <li>
            <a href={hrefFor(rootOf(planning).path)}>{t(planning.label)}</a>
          </li>
          {tab === "list" ? (
            <li aria-current="page">{t(DEBTS.label)}</li>
          ) : (
            <>
              <li>
                <a href={hrefFor(DEBTS.path)}>{t(DEBTS.label)}</a>
              </li>
              <li aria-current="page">{title}</li>
            </>
          )}
        </ol>
      </nav>
      <div className="debts-head">
        <h1>{title}</h1>
        {state.kind !== "off" ? (
          <p className="ws-muted">{t(empty ? "debts.subtitle.empty" : def.subtitle)}</p>
        ) : null}
      </div>
      {state.kind === "off" ? (
        <EmptyState icon="debts" />
      ) : empty ? (
        <DebtsEmpty />
      ) : (
        <PageTabs
          label={t("debts.tabs")}
          panelId={PANEL_ID}
          selected={tab}
          tabs={TABS.map((x) => ({ id: x.id, label: t(x.label), href: hrefFor(tabPath(x.id)) }))}
        >
          {/* GRID-04@PoC: S-143 is one column of 12: the summary, the warning and the table, one under another. */}
          <PlanGrid page="debts">
            <PlanRegion name="content" span={12}>
              <TabContent tab={tab} state={state} retry={retry} refresh={refresh} />
            </PlanRegion>
          </PlanGrid>
        </PageTabs>
      )}
    </AppLayout>
  );
}

function TabContent({
  tab,
  state,
  retry,
  refresh,
}: {
  tab: DebtsTab;
  state: DebtsState;
  retry: () => void;
  refresh: () => void;
}): ReactNode {
  if (state.kind === "loading") return <DebtsLoading />;
  if (state.kind === "error") return <DebtsError supportId={state.supportId} retry={retry} />;
  if (state.kind !== "ready") return null;
  if (tab === "list") return <DebtsList debts={state.debts} />;
  if (tab === "progress") return <DebtsProgress debts={state.debts} />;
  if (tab === "plan") return <DebtsPlan debts={state.debts} refresh={refresh} />;
  return <DebtsStrategy debts={state.debts} />;
}

/** FR 11, AC10: «Боргів не додано» with «Додати рахунок», which opens «Новий рахунок» with the type «Кредит». */
function DebtsEmpty() {
  const t = useT();
  return (
    <section className="ws-card debts-empty" aria-labelledby="debts-empty-title">
      <Icon name="debts" size={40} tone="muted" />
      <h2 id="debts-empty-title" className="ws-text-heading-3">
        {t("debts.empty.title")}
      </h2>
      <p className="ws-muted">{t("debts.empty.body")}</p>
      <a className="ws-button ws-button-primary" href={`${hrefFor(childPath("newAccount"))}?type=loan`}>
        <Icon name="plus" size={20} />
        <span>{t("debts.empty.add")}</span>
      </a>
    </section>
  );
}

/** Loading: the skeleton of the debt card and of the table (BUD-19 «Стани інтерфейсу»). */
function DebtsLoading() {
  return (
    <div className="ws-card debts-loading">
      <Skeleton variant="row" lines={5} />
    </div>
  );
}

/** Error: «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (PocStates). */
function DebtsError({ supportId, retry }: { supportId: string | undefined; retry: () => void }) {
  const t = useT();
  return (
    <section className="ws-card debts-error" role="alert">
      <p className="debts-error-title">{t("debts.error.title")}</p>
      <p>{t("debts.error.body")}</p>
      <button type="button" className="ws-button" onClick={retry}>
        {t("debts.error.retry")}
      </button>
      {supportId ? <p className="ws-muted">{t("debts.error.code", { code: supportId })}</p> : null}
    </section>
  );
}
