import { useT } from "@willowsum/i18n";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";
import { EmptyState } from "./SectionPage.tsx";

/** UX-09@PoC item 18: «Налаштування», opened from the profile menu; not a navigation section. */
export function SettingsPage() {
  const t = useT();
  const title = t("shell.settings");
  useDocumentTitle(title);
  return (
    <AppLayout sectionId={null} pageId={null}>
      <h1>{title}</h1>
      <EmptyState icon="settings" />
    </AppLayout>
  );
}
