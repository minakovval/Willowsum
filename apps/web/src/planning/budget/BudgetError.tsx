import { useId } from "react";
import { useI18n } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { failureOf } from "../../auth/failure.ts";
import { budgetFailureKey } from "./model.ts";

/**
 * The error card of the budget pages (П-13): «✕ Не вдалося завантажити бюджет», what failed in the budget's words (never
 * the sign-in's), «Спробувати ще раз» and «Код: …» of the API's answer.
 */
export function BudgetError({
  failure,
  onRetry,
}: {
  failure: Parameters<typeof failureOf>[0];
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const code = failureOf(failure).code;
  return (
    <section className="ws-card bud-card" role="alert" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-text-heading-3 bud-card-title">
        <Icon name="close" size={16} /> {t("planning.budget.error.title")}
      </h2>
      <p className="ws-muted">{t(budgetFailureKey(failure))}</p>
      <p>
        <button type="button" className="ws-button" onClick={onRetry}>
          {t("planning.budget.error.retry")}
        </button>
      </p>
      {code ? <p className="ws-muted">{t("planning.budget.error.code", { code })}</p> : null}
    </section>
  );
}
