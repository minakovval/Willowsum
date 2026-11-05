import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, type IconName } from "@willowsum/ui";
import {
  childPath,
  IMPORT_WIZARD_PATH,
  rootOf,
  TRANSACTIONS,
  type ChildDef,
  type PageDef,
  type SectionDef,
} from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";

/** The empty state of a page whose screen is not built yet (DS-01 item 7). */
export function EmptyState({ icon }: { icon: IconName }) {
  const t = useT();
  return (
    <section className="app-empty" aria-labelledby="app-empty-title">
      <Icon name={icon} size={40} tone="muted" />
      <h2 id="app-empty-title" className="ws-text-heading-3">
        {t("shell.empty.title")}
      </h2>
      <p className="ws-muted">{t("shell.empty.body")}</p>
    </section>
  );
}

/** UX-09@PoC item 14: «Імпортувати виписку» opens the wizard in focus mode. */
function ImportStatementLink({ primary }: { primary?: boolean }) {
  const t = useT();
  return (
    <a className={primary ? "ws-button ws-button-primary" : "ws-button"} href={hrefFor(IMPORT_WIZARD_PATH)}>
      <Icon name="upload" size={20} />
      <span>{t("action.importStatement")}</span>
    </a>
  );
}

/** An L2 page: heading and, for «Транзакції», the import actions (UX-09@PoC item 14). */
export function SectionPage({ section, page }: { section: SectionDef; page: PageDef }) {
  const t = useT();
  const title = t(page.label);
  useDocumentTitle(title);
  const actions =
    page.id === TRANSACTIONS.id ? (
      <div className="app-page-actions">
        <ImportStatementLink primary />
        <a className="app-quiet-link" href={hrefFor(childPath("importHistory"))}>
          {t("action.importHistory")}
        </a>
      </div>
    ) : null;
  return (
    <AppLayout sectionId={section.id} pageId={page.id}>
      <PageHeader title={title} actions={actions} />
      <EmptyState icon={page.icon} />
    </AppLayout>
  );
}

function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="app-page-head">
      <h1>{title}</h1>
      {actions}
    </div>
  );
}

/** A page below an L2 page; breadcrumbs follow the hierarchy (UX-09@PoC item 8). */
export function ChildPage({ section, child }: { section: SectionDef; child: ChildDef }) {
  const t = useT();
  const title = t(child.title);
  useDocumentTitle(title);
  return (
    <AppLayout sectionId={section.id} pageId={child.parent.id}>
      <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
        <ol>
          <li>
            <a href={hrefFor(rootOf(section).path)}>{t(section.label)}</a>
          </li>
          <li>
            <a href={hrefFor(child.parent.path)}>{t(child.parent.label)}</a>
          </li>
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <PageHeader title={title} />
      {child.id === "newTransaction" ? (
        <p>
          <ImportStatementLink />
        </p>
      ) : null}
      <EmptyState icon={child.parent.icon} />
    </AppLayout>
  );
}
