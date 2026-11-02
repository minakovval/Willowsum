import { en } from "./messages/en.ts";
import { uk } from "./messages/uk.ts";
import { FALLBACK_LOCALE, type Locale } from "./languages.ts";
import type { MessageKey, MessageParams, Messages } from "./types.ts";

export const CATALOGUES: Readonly<Record<Locale, Messages>> = { uk, en };

const PLACEHOLDER = /\{(\w+)\}/g;

/** The `{placeholders}` used in a message, sorted. */
export function placeholdersOf(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "").sort();
}

/**
 * Looks up a message: the locale, then English, then the key itself (a missing key never breaks
 * the page, L10N-01 item 9), and substitutes `{placeholders}`.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES[FALLBACK_LOCALE][key] ?? key;
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
