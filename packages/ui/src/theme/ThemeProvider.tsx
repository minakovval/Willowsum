import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeName } from "../tokens/color.ts";
import { mediaQueries } from "../tokens/layout.ts";
import { readStorage, writeStorage } from "../storage.ts";
import { useMediaQuery } from "../useMediaQuery.ts";

/** DS-11 item 3: «Світла», «Темна», «Як у системі». */
export type ThemePreference = "system" | ThemeName;
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/**
 * Device-local storage key (DS-11 item 8). apps/web/index.html reads the same key before the first
 * paint so there is no flash of the light theme (DS-11 item 7).
 */
export const THEME_STORAGE_KEY = "ws-theme";
export const THEME_ATTRIBUTE = "data-theme";

const isPreference = (v: unknown): v is ThemePreference => v === "system" || v === "light" || v === "dark";

export function readThemePreference(): ThemePreference {
  const stored = readStorage(THEME_STORAGE_KEY);
  return isPreference(stored) ? stored : "system";
}

interface ThemeValue {
  preference: ThemePreference;
  /** The theme actually shown. */
  theme: ThemeName;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Applies the theme with one attribute on the root element (DS-11 item 5): `data-theme="light"` or
 * `"dark"` for a manual choice, no attribute for «Як у системі» so the CSS follows
 * `prefers-color-scheme` live (DS-11 item 4).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const systemDark = useMediaQuery(mediaQueries.dark);
  const theme: ThemeName = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute(THEME_ATTRIBUTE);
    else root.setAttribute(THEME_ATTRIBUTE, preference);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    writeStorage(THEME_STORAGE_KEY, p === "system" ? null : p);
  }, []);

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
