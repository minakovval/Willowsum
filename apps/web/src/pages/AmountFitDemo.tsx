import { formatMoney, useI18n } from "@willowsum/i18n";
import { FitAmount, formatCompactAmount } from "@willowsum/ui";

/**
 * DS-04 item 15, AC13 «Великі суми і скорочення»: CMP-07 «Великі значення» at widths 360, 240, 160 and
 * 110 px on synthetic values from 0,01 € to 12 345 678 901,00 € (and one larger). The full values come
 * from `formatMoney`, the abbreviations from `formatCompactAmount`; both follow the interface language
 * (DS-04 item 11): «12,35 трлн €» in Ukrainian, «€12.35tn» in English.
 */
const HUGE = { value: "12345678901234.00", currency: "EUR", symbol: "€" };
const BILLIONS = { value: "12345678901.00", currency: "EUR", symbol: "€" };
const BIG = { value: "1234567.89", currency: "UAH", symbol: "₴" };
const ORDINARY = { value: "48250.40", currency: "EUR", symbol: "€" };
const TINY = { value: "0.01", currency: "EUR", symbol: "€" };
const WIDTHS = [360, 240, 160, 110] as const;

export function AmountFitDemo() {
  const { t, locale } = useI18n();
  const full = (a: typeof HUGE) => formatMoney(locale, a.value, a.currency);
  const short = (a: typeof HUGE) => formatCompactAmount({ value: a.value, currency: a.symbol, locale });
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
                {t("gallery.fit.label")} <FitAmount value={full(BIG)} compact={short(BIG)} size="amount-s" />
              </p>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.own")}</p>
              <div>
                <FitAmount value={full(HUGE)} compact={short(HUGE)} size="amount-l" />
              </div>
              <div>
                <FitAmount value={full(BILLIONS)} compact={short(BILLIONS)} size="amount-l" />
              </div>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.small")}</p>
              <div>
                <FitAmount value={full(ORDINARY)} compact={short(ORDINARY)} size="amount-xl" />
              </div>
              <p className="ws-text-body-sm ws-muted">{t("gallery.fit.tiny")}</p>
              <div>
                <FitAmount value={full(TINY)} compact={short(TINY)} size="amount-xl" />
              </div>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
