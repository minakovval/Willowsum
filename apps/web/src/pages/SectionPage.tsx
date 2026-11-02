import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { Section } from "../routing/routes.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";

/** Placeholder section: heading and the empty state (DS-01 item 7). */
export function SectionPage({ section }: { section: Section }) {
  const t = useT();
  const title = t(section.label);
  useDocumentTitle(title);
  return (
    <AppLayout currentId={section.id}>
      <h1>{title}</h1>
      <section className="app-empty" aria-labelledby="app-empty-title">
        <Icon name={section.icon} size={40} tone="muted" />
        <h2 id="app-empty-title" className="ws-text-heading-3">
          {t("shell.empty.title")}
        </h2>
        <p className="ws-muted">{t("shell.empty.body")}</p>
      </section>
    </AppLayout>
  );
}
