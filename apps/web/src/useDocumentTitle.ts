import { useEffect } from "react";
import { useT } from "@willowsum/i18n";

/** DS-02 item 12: «Willowsum · <page>». */
export function useDocumentTitle(page: string): void {
  const t = useT();
  useEffect(() => {
    document.title = t("document.title", { page });
  }, [page, t]);
}
