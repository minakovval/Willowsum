import { useI18n } from "@willowsum/i18n";
import { FitAmount, formatCompactAmount } from "@willowsum/ui";

/**
 * DS-22 gallery: CMP-07 «Великі значення» at several widths (synthetic values). The full values use
 * the uk-UA format; the abbreviation units and layout follow the interface language (DS-04 item 11):
 * «12,35 трлн €» in Ukrainian, «€12.35tn» in English.
 */
const HUGE = { value: "12345678901234.00", text: "12 345 678 901 234,00 €" };
const BIG = { value: "1234567.89", text: "1 234 567,89 ₴" };
const ORDINARY = { value: "48250.40", text: "48 250,40 €" };
const WIDTHS = [360, 240, 160, 110] as const;

export function AmountFitDemo() {
  const { t, locale } = useI18n();
  const huge = formatCompactAmount({ value: HUGE.value, currency: "€", locale });
  const big = formatCompactAmount({ value: BIG.value, currency: "₴", locale });
  const ordinary = formatCompactAmount({ value: ORDINARY.value, currency: "€", locale });
  return (
    <div className="gallery-fit">
      <p className="ws-muted">{t("gallery.fit.intro")}</p>
      <div className="gallery-fit__grid">
        {WIDTHS.map((width) => (
          <figure key={width} className="gallery-fit__case">
            <figcaption className="ws-text-label ws-muted">{t("gallery.fit.width", { width })}</figcaption>
            <div className="gallery-fit__box" style={{ inlineSize: `${width}px` }}>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.inline")}</p>
              <p className="ws-text-body">
                {t("gallery.fit.label")} <FitAmount value={BIG.text} compact={big} size="amount-s" />
              </p>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.own")}</p>
              <div>
                <FitAmount value={HUGE.text} compact={huge} size="amount-l" />
              </div>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.small")}</p>
              <div>
                <FitAmount value={ORDINARY.text} compact={ordinary} size="amount-xl" />
              </div>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
