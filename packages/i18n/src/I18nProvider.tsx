import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, LANGUAGES, type Locale } from "./languages.ts";
import { translate } from "./translate.ts";
import type { MessageKey, MessageParams } from "./types.ts";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Provides the interface language. Ukrainian by default. Sets `lang` and `dir` on the root element
 * so screen readers switch pronunciation (DS-22, item 5).
 */
export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    const lang = LANGUAGES.find((l) => l.code === locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = lang?.dir ?? "ltr";
  }, [locale]);

  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The current language, its setter and the translate function. Outside a provider: Ukrainian. */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value) return value;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => undefined,
    t: (key, params) => translate(DEFAULT_LOCALE, key, params),
  };
}

export const useT = (): Translate => useI18n().t;
