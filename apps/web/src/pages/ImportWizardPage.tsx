import { useT } from "@willowsum/i18n";
import { FocusShell } from "@willowsum/ui";
import { FilesStep } from "../import/FilesStep.tsx";
import { ReviewStep } from "../import/ReviewStep.tsx";
import { type ImportStep, TRANSACTIONS } from "../routing/routes.ts";
import { hasEarlierPage } from "../routing/session.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { EmptyState } from "./SectionPage.tsx";

/**
 * The statement import wizard in focus mode (UX-09@PoC items 10, 14; IMP-08@PoC FR 1): no navigation; «×» goes back
 * by history to the page the user came from, or to «Гроші → Транзакції» when opened directly. Each step has its own
 * address (`/import`, `/import/<batch>`, `/import/<batch>/review`, `/import/<batch>/result`). «Рахунок і файли» is
 * wave 2 row 136; «Перевірка розпізнавання» is row 137 (`ReviewStep`); «Результат» (row 138) takes its place in `step`.
 */
export function ImportWizardPage({ batchId, step }: { batchId: string | null; step: ImportStep }) {
  const t = useT();
  const title = t("page.importWizard");
  useDocumentTitle(title);
  const close = () => {
    if (hasEarlierPage()) window.history.back();
    else window.location.replace(hrefFor(TRANSACTIONS.path));
  };
  return (
    <FocusShell title={title} closeLabel={t("shell.close")} onClose={close}>
      {step === "files" ? (
        <FilesStep batchId={batchId} onClose={close} />
      ) : step === "review" && batchId ? (
        <ReviewStep batchId={batchId} />
      ) : (
        // «Результат» (row 138) takes this place: `/import/<batch>/result`, where «Застосувати» of the review leads.
        <EmptyState icon="upload" />
      )}
    </FocusShell>
  );
}
