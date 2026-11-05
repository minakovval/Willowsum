import { useT } from "@willowsum/i18n";
import { START_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";

/** UX-09@PoC item 19: a short explanation without record names and «На Бюджет». */
export function NotFoundPage() {
  const t = useT();
  useDocumentTitle(t("notFound.title"));
  return (
    <AppLayout sectionId={null} pageId={null}>
      <h1>{t("notFound.title")}</h1>
      <p className="ws-muted">{t("notFound.body")}</p>
      <p>
        <a className="ws-button ws-button-primary" href={hrefFor(START_PATH)}>
          {t("notFound.home")}
        </a>
      </p>
    </AppLayout>
  );
}
