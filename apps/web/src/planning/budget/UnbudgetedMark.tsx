import { useI18n } from "@willowsum/i18n";

/**
 * BUD-02@PoC FR 25 (owner, 2026-11-26): the visible mark «поза бюджетом» of a category taken out of the budget. It looks
 * like the quiet plate of «обов'язкова» (DS-23 family В) and is read once, as «Статус: поза бюджетом»; it is not an
 * entry of the status dictionary (DS-23 lists four states of family В and the corrections did not change it).
 */
export function UnbudgetedMark() {
  const { t } = useI18n();
  const word = t("planning.budget.cat.unbudgeted.mark");
  return (
    <span
      className="ws-status"
      data-mark="unbudgeted"
      data-tone="neutral"
      data-ink="ink-muted"
      data-plate="quiet"
    >
      <span className="ws-status-marker" aria-hidden="true">
        •
      </span>
      <span className="ws-status-word" aria-hidden="true">
        {word}
      </span>
      <span className="ws-visually-hidden">{t("status.prefix", { status: word })}</span>
    </span>
  );
}
