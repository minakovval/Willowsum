# @willowsum/i18n — translations

**Purpose.** The interface strings and the language registry. Ukrainian is the default and the
source catalogue; English is complete. Keys are typed: `MessageKey` is derived from `uk`, and
`en` must have exactly the same keys (a missing key is a compile error; tests check placeholders).

**Requirements:** L10N-01 (partly: registry, uk/en catalogues, fallback to English then to the
key, `{placeholder}` checks, `lang`/`dir` on the root element). Plural rules, regional formats and
machine-translated languages are still to do.

**Public exports:** `I18nProvider`, `useI18n`, `useT`, `translate`, `CATALOGUES`, `LANGUAGES`,
`DEFAULT_LOCALE`, `FALLBACK_LOCALE`, `isLocale`, `placeholdersOf`, types `Locale`, `MessageKey`,
`Messages`, `MessageParams`, `Translate`.

Events, tables: none.
