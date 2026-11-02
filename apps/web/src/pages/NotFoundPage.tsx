import { useT } from "@willowsum/i18n";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "./AppLayout.tsx";

export function NotFoundPage() {
  const t = useT();
  useDocumentTitle(t("notFound.title"));
  return (
    <AppLayout currentId={null}>
      <h1>{t("notFound.title")}</h1>
      <p className="ws-muted">{t("notFound.body")}</p>
      <p>
        <a href={hrefFor("/")}>{t("notFound.home")}</a>
      </p>
    </AppLayout>
  );
}
