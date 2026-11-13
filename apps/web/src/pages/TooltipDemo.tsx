import { currencySymbolOf, formatMoney, useI18n } from "@willowsum/i18n";
import { FitAmount, formatCompactAmount, Icon, Tooltip, TruncatedText } from "@willowsum/ui";

/**
 * CMP-25@PoC Tooltip in the design-system gallery, on synthetic values: a card name cut off with an ellipsis
 * (tooltip, focusable), a name that fits (neither), an abbreviated amount and an icon-only button, plus a cut-off
 * name at the right edge to show that the tooltip stays inside the window.
 */
const BILLIONS = { value: "12345678901.00", currency: "EUR" };

export function TooltipDemo() {
  const { t, locale } = useI18n();
  const full = formatMoney(locale, BILLIONS.value, BILLIONS.currency);
  const short = formatCompactAmount({
    value: BILLIONS.value,
    currency: currencySymbolOf(locale, BILLIONS.currency),
    locale,
  });
  const add = t("gallery.tooltip.addTransaction");
  return (
    <div className="gallery-tooltip">
      <p className="ws-muted">{t("gallery.tooltip.intro")}</p>
      <div className="gallery-tooltip__grid">
        <figure className="gallery-tooltip__case" data-case="cut">
          <figcaption className="ws-text-label ws-muted">{t("gallery.tooltip.cut")}</figcaption>
          <div className="ws-card gallery-tooltip__card">
            <TruncatedText text={t("gallery.tooltip.longName")} className="ws-text-heading-3" />
          </div>
        </figure>
        <figure className="gallery-tooltip__case" data-case="fits">
          <figcaption className="ws-text-label ws-muted">{t("gallery.tooltip.fits")}</figcaption>
          <div className="ws-card gallery-tooltip__card">
            <TruncatedText text={t("gallery.tooltip.shortName")} className="ws-text-heading-3" />
          </div>
        </figure>
        <figure className="gallery-tooltip__case" data-case="amount">
          <figcaption className="ws-text-label ws-muted">{t("gallery.tooltip.amount")}</figcaption>
          <div className="ws-card gallery-tooltip__card">
            <div>
              <FitAmount value={full} compact={short} size="amount-xl" />
            </div>
          </div>
        </figure>
        <figure className="gallery-tooltip__case" data-case="icon">
          <figcaption className="ws-text-label ws-muted">{t("gallery.tooltip.icon")}</figcaption>
          <div>
            <Tooltip text={add}>
              <button type="button" className="ws-icon-button" aria-label={add}>
                <Icon name="plus" size={20} />
              </button>
            </Tooltip>
          </div>
        </figure>
      </div>
      <figure className="gallery-tooltip__case gallery-tooltip__edge" data-case="edge">
        <figcaption className="ws-text-label ws-muted">{t("gallery.tooltip.edge")}</figcaption>
        <div className="ws-card gallery-tooltip__card">
          <TruncatedText text={t("gallery.tooltip.longName")} />
        </div>
      </figure>
    </div>
  );
}
