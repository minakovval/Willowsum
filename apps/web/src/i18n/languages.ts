import { DEFAULT_LOCALE, LANGUAGES, type Language, type Locale } from "@willowsum/i18n";

/**
 * NFR-09@PoC FR 2: the languages the web app offers. The pseudo-locale (status `pseudo`) is offered in
 * development, test and CI builds only, never in the production build (`vite build --mode production`).
 */
export function offeredLanguages(mode: string): readonly Language[] {
  return LANGUAGES.filter((l) => l.status !== "pseudo" || mode !== "production");
}

/**
 * The interface language at start-up. Outside production, `?lang=<code>` picks any offered language (e.g.
 * `?lang=en-XA#/planning/budget` opens the app in the pseudo-locale). The production build ignores it and
 * starts in Ukrainian (П-25: one interface language in PoC).
 */
export function initialLocale(search: string, mode: string): Locale {
  if (mode === "production") return DEFAULT_LOCALE;
  const wanted = new URLSearchParams(search).get("lang");
  return offeredLanguages(mode).find((l) => l.code === wanted)?.code ?? DEFAULT_LOCALE;
}
