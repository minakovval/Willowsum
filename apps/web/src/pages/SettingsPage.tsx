import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { SPACE_SETTINGS_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";
import "../space/space.css";

/**
 * UX-09@PoC item 18: «Налаштування», opened from the profile menu; not a navigation section. Its sections list (S-186)
 * is wave 2 row 110; until then it leads to «Простір» (S-200, ACC-08@PoC FR 5).
 */
export function SettingsPage() {
  const t = useT();
  const title = t("shell.settings");
  useDocumentTitle(title);
  return (
    <AppLayout sectionId={null} pageId={null}>
      <h1>{title}</h1>
      <ul className="settings-links">
        <li>
          <a className="ws-card settings-link" href={hrefFor(SPACE_SETTINGS_PATH)}>
            <Icon name="settings" size={20} tone="muted" />
            <span>{t("space.title")}</span>
          </a>
        </li>
      </ul>
    </AppLayout>
  );
}
