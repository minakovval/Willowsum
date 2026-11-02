/**
 * The language registry (L10N-01, item 1). Only the complete languages of the MVP are listed here;
 * adding a language means adding a row and a catalogue, no other code.
 */
export const LANGUAGES = [
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", dir: "ltr", status: "complete" },
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr", status: "complete" },
] as const;

export type Locale = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "uk";

/** Unsupported languages fall back to English (L10N-01, item 4). */
export const FALLBACK_LOCALE: Locale = "en";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && LANGUAGES.some((l) => l.code === value);
