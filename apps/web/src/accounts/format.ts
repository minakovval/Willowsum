import {
  formatDate,
  formatLocaleOf,
  formatMoney,
  maskNumber,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import type { MoneyValue } from "./api.ts";

type PluralBase =
  | "accounts.activeCount"
  | "accounts.sources.count"
  | "accounts.group.credit.count"
  | "accounts.currencyCount";
const FORMS = ["one", "few", "many", "other"] as const;

/** A counted noun in the interface language: «4 активні рахунки», «1 рахунок», «3 валюти». */
export function counted(t: Translate, locale: Locale, base: PluralBase, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

export const money = (locale: Locale, value: MoneyValue): string =>
  formatMoney(locale, value.amount, value.currency);

/** A debt the API returns as a positive amount, shown with the real minus (FR 19: «−640,00 €»). */
export function negated(value: MoneyValue): MoneyValue {
  const a = value.amount.trim();
  if (/^[+-]?0*(\.0*)?$/.test(a)) return value;
  return { amount: a.startsWith("-") ? a.slice(1) : `-${a.replace(/^\+/, "")}`, currency: value.currency };
}

/** A date of the list without the year: «1 лист.» (uk), «1 Nov» (en). */
export function shortDate(locale: Locale, isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** The date of a rate with its year, as in FIN-01@PoC AC12: «2 лист. 2026 р.». */
export const rateDate = (locale: Locale, isoDate: string): string => {
  try {
    return formatDate(locale, isoDate);
  } catch {
    return isoDate;
  }
};

/**
 * DS-04 FR 13: «··4417». The owner's decision of 2026-11-16 (item 4): a number whose last 4 characters hold
 * letters is shown «··AB12»; until the shared `maskNumber` does that (#405), such a tail is masked here the same
 * way. Anything else is not shown.
 */
export function maskedNumber(last4: string): string | null {
  try {
    return maskNumber(last4);
  } catch {
    return /^[0-9A-Za-z]{4}$/.test(last4) ? `··${last4.toUpperCase()}` : null;
  }
}
