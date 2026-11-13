# @willowsum/i18n — translations

**Purpose.** The interface strings and the language registry. Ukrainian is the default and the
source catalogue; English is complete. Keys are typed: `MessageKey` is derived from `uk`, and
`en` must have exactly the same keys (a missing key is a compile error; tests check placeholders).

**Requirements:** L10N-01 (partly: registry, uk/en catalogues, fallback to English then to the
key, `{placeholder}` checks, `lang`/`dir` on the root element). NFR-09@PoC: the regional format of each
language (`format` in the registry: uk → uk-UA, en → en-GB) and the formatters `formatNumber`,
`formatMoney`, `formatDate`, `formatDateTime` (FR 3; decimal strings only, never JS numbers; time stamps in
the user's time zone); the left-to-right pseudo-locale `en-XA` (FR 2: one registry row, its catalogue
generated from English by `pseudoLocalize`; status `pseudo`, offered by the web app outside production only).
The RTL pseudo-locale is PoC v2. Plural rules and machine-translated languages are still to do.

**Adding a language:** a row in `LANGUAGES` (`languages.ts`) and its catalogue in `CATALOGUES`
(`translate.ts`). Nothing else: the provider, the formatters and the compact amounts of `@willowsum/ui`
(unit words `amount.compact.*` from the catalogue, layout from `Intl`) read the row and the catalogue.

**Public exports:** `I18nProvider`, `useI18n`, `useT`, `translate`, `CATALOGUES`, `LANGUAGES`,
`DEFAULT_LOCALE`, `FALLBACK_LOCALE`, `PSEUDO_LOCALE`, `isLocale`, `languageOf`, `placeholdersOf`,
`formatLocaleOf`, `formatNumber`, `formatMoney`, `formatDate`, `formatDateTime`, `pseudoLocalize`,
`pseudoCatalogue`, `keepNumbersTogether`, types `Language`, `Locale`, `MessageKey`, `Messages`,
`MessageParams`, `Translate`.

Events, tables: none.
