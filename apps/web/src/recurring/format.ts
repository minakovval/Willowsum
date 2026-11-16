import { formatLocaleOf, formatMoney, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import type { Frequency } from "./data.ts";

/** The words of BUD-07 FR 2 and FR 6 for a frequency: «щомісяця», «раз на 2 тижні». */
export const FREQUENCY_KEYS: Readonly<Record<Frequency, MessageKey>> = {
  week: "recurring.frequency.week",
  "two-weeks": "recurring.frequency.twoWeeks",
  month: "recurring.frequency.month",
  quarter: "recurring.frequency.quarter",
  year: "recurring.frequency.year",
};

type PluralBase = "recurring.count" | "recurring.proposals.count" | "recurring.proposal.charges";
const FORMS = ["one", "few", "many", "other"] as const;

/** A counted noun in the interface language: «13 платежів», «1 payment». */
export function counted(t: Translate, locale: Locale, base: PluralBase, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

/** A date of this year without the year: «20 лист.» (uk), «20 Nov» (en). */
export function shortDate(locale: Locale, isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** The month of the page: «листопад 2026» (uk), «November 2026» (en). */
export function monthTitle(locale: Locale, isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  const month = new Intl.DateTimeFormat(formatLocaleOf(locale), { month: "long", timeZone: "UTC" }).format(
    at,
  );
  return `${month} ${String(y)}`;
}

/** An expected amount: income with «+» (DS-04), a variable amount with «≈». */
export function expectedText(
  t: Translate,
  locale: Locale,
  money: { readonly amount: string; readonly currency: string },
  type: "expense" | "income",
  variable: boolean,
): string {
  const text = formatMoney(locale, money.amount, money.currency, { signed: type === "income" });
  return variable ? t("recurring.approx", { amount: text }) : text;
}
