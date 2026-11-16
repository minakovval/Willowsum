import { formatLocaleOf, formatMoney, type Locale } from "@willowsum/i18n";
import type { MoneyValue } from "./api.ts";

const MONTH = /^(\d{4})-(\d{2})$/;

/** A calendar month (`YYYY-MM`, no time zone): «вер. 2036 р.» (`short`), «вересень 2036 р.» (`long`). */
export function formatMonth(locale: Locale, month: string, style: "short" | "long" = "short"): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

export const money = (locale: Locale, value: MoneyValue): string =>
  formatMoney(locale, value.amount, value.currency);

/** The later of two `YYYY-MM` months (they compare as text). */
export const laterMonth = (a: string | null, b: string): string => (a === null || b > a ? b : a);
