import { useT } from "@willowsum/i18n";
import { NoAccessState } from "@willowsum/ui";
import { START_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";

/**
 * S-029 «Немає доступу» (DAT-05@PoC FR 6, П-7; canvas NoAccess): shown in place of a module the user's rights close —
 * never for one record, a count or a sum (a record outside the user's reach is «не знайдено», UX-09). It names
 * nothing of what is closed and offers «На Головну».
 */
export function NoAccessPage() {
  const t = useT();
  useDocumentTitle(t("noAccess.title"));
  return (
    <AppLayout sectionId={null} pageId={null}>
      <div className="no-access-page">
        <NoAccessState
          title={t("noAccess.title")}
          text={t("noAccess.body")}
          action={{ label: t("noAccess.home"), href: hrefFor(START_PATH) }}
        />
      </div>
    </AppLayout>
  );
}
