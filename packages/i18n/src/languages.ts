/**
 * The language registry (L10N-01, item 1; NFR-09 FR 2). Adding a language means adding a row here and its
 * catalogue in `translate.ts`, no other code: the provider, the formatters (`format.ts`) and the compact
 * amounts of `@willowsum/ui` read everything they need from the row and the catalogue.
 *
 * - `format`: the regional format (BCP 47) that numbers, amounts and dates use (NFR-09 FR 3, DS-04).
 * - `status`: `complete` — a product language; `pseudo` — the pseudo-locale for testing, never offered in
 *   the production build (NFR-09@PoC: left to right only; the RTL pseudo-locale comes in PoC v2).
 */
export const LANGUAGES = [
  {
    code: "uk",
    nativeName: "Українська",
    englishName: "Ukrainian",
    dir: "ltr",
    status: "complete",
    format: "uk-UA",
  },
  {
    code: "en",
    nativeName: "English",
    englishName: "English",
    dir: "ltr",
    status: "complete",
    format: "en-GB",
  },
  {
    code: "en-XA",
    nativeName: "[Ƥšéúðó ~~~]",
    englishName: "Pseudo-locale (long strings, left to right)",
    dir: "ltr",
    status: "pseudo",
    format: "en-GB",
  },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type Locale = Language["code"];

export const DEFAULT_LOCALE: Locale = "uk";

/** Unsupported languages fall back to English (L10N-01, item 4). */
export const FALLBACK_LOCALE: Locale = "en";

/** The left-to-right pseudo-locale (NFR-09@PoC FR 2). */
export const PSEUDO_LOCALE: Locale = "en-XA";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && LANGUAGES.some((l) => l.code === value);

/** The registry row of a language. */
export const languageOf = (locale: Locale): Language => LANGUAGES.find((l) => l.code === locale)!;
