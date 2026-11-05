import { useT } from "@willowsum/i18n";
import { FocusShell } from "@willowsum/ui";
import { TRANSACTIONS } from "../routing/routes.ts";
import { hasEarlierPage } from "../routing/session.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { EmptyState } from "./SectionPage.tsx";

/**
 * The statement import wizard in focus mode (UX-09@PoC items 10, 14): no navigation; «×» goes back
 * by history to the page the user came from, or to «Гроші → Транзакції» when opened directly.
 */
export function ImportWizardPage() {
  const t = useT();
  const title = t("page.importWizard");
  useDocumentTitle(title);
  const close = () => {
    if (hasEarlierPage()) window.history.back();
    else window.location.replace(hrefFor(TRANSACTIONS.path));
  };
  return (
    <FocusShell title={title} closeLabel={t("shell.close")} onClose={close}>
      <EmptyState icon="upload" />
    </FocusShell>
  );
}
