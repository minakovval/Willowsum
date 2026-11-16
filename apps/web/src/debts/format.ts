import { Money } from "@willowsum/domain-kernel";
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

/**
 * Sums amounts per currency, exactly (Money of the domain kernel, never JS numbers), in the order the currencies
 * first appear. A total across currencies in the reporting currency is BUD-19 FR 9 (not in the API yet), so each
 * currency keeps its own total.
 */
export function totalsByCurrency(values: readonly MoneyValue[]): MoneyValue[] {
  const totals = new Map<string, Money>();
  for (const v of values) {
    const current = totals.get(v.currency) ?? Money.zero(v.currency);
    totals.set(v.currency, current.plus(Money.of(v.amount, v.currency)));
  }
  return [...totals.values()].map((m) => m.toJSON());
}

/** The later of two `YYYY-MM` months (they compare as text). */
export const laterMonth = (a: string | null, b: string): string => (a === null || b > a ? b : a);
