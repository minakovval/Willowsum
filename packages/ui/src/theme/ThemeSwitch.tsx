import { useId } from "react";
import { useT, type MessageKey } from "@willowsum/i18n";
import { THEME_PREFERENCES, useTheme, type ThemePreference } from "./ThemeProvider.tsx";

const LABELS: Record<ThemePreference, MessageKey> = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
};

/** DS-11 item 3: a three-way switch; the choice applies at once, without reloading. */
export function ThemeSwitch() {
  const t = useT();
  const { preference, setPreference } = useTheme();
  const name = useId();
  return (
    <fieldset className="ws-segmented">
      <legend className="ws-segmented-legend">{t("theme.label")}</legend>
      <div className="ws-segmented-options">
        {THEME_PREFERENCES.map((p) => (
          <label key={p} className="ws-segmented-option">
            <input
              type="radio"
              name={name}
              value={p}
              checked={preference === p}
              onChange={() => setPreference(p)}
            />
            <span>{t(LABELS[p])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
