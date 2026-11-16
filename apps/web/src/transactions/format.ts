import { formatLocaleOf, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";

type PluralBase = "tx.split.parts" | "tx.split.moreParts" | "tx.split.badge";
const FORMS = ["one", "few", "many", "other"] as const;

/** A counted noun in the interface language: «36 частин», «3 частини», «1 part». */
export function counted(t: Translate, locale: Locale, base: PluralBase, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

/** A month «YYYY-MM»: «листопад 2026» (uk), «November 2026» (en); `capital` starts a line with a capital. */
export function monthName(locale: Locale, month: string, capital = false): string {
  const [y, m] = month.split("-").map((x) => Number.parseInt(x, 10));
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  const name = new Intl.DateTimeFormat(formatLocaleOf(locale), { month: "long", timeZone: "UTC" }).format(at);
  const text = `${name} ${String(y)}`;
  return capital ? text.charAt(0).toLocaleUpperCase(formatLocaleOf(locale)) + text.slice(1) : text;
}
