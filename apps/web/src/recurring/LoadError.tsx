import { useI18n } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { Outcome } from "../auth/api.ts";
import { failureOf } from "../auth/failure.ts";

/** «Стани інтерфейсу»: «Не вдалося завантажити регулярні платежі», «Спробувати ще раз» and the code (ARC-09 FR 3). */
export function LoadError({
  failure,
  onRetry,
}: {
  failure: Exclude<Outcome<unknown>, { ok: true }>;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const reason = failureOf(failure);
  return (
    <section className="ws-card rec-card rec-error" role="alert" aria-labelledby="rec-error-title">
      <h2 id="rec-error-title" className="ws-text-heading-3">
        <Icon name="close" size={16} />
        <span>{t("recurring.error.title")}</span>
      </h2>
      <p className="ws-muted">{t(reason.key)}</p>
      <p>
        <button type="button" className="ws-button" onClick={onRetry}>
          {t("recurring.error.retry")}
        </button>
      </p>
      {reason.code ? (
        <p className="ws-muted rec-code">{t("recurring.error.code", { code: reason.code })}</p>
      ) : null}
    </section>
  );
}
