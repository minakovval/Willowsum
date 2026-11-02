import { act, render, screen } from "@testing-library/react";
import { CATALOGUES, I18nProvider, LANGUAGES, placeholdersOf, translate, useI18n } from "./index.ts";
import type { MessageKey } from "./types.ts";

describe("catalogues", () => {
  const ukKeys = Object.keys(CATALOGUES.uk).sort();

  it.each(LANGUAGES.map((l) => l.code))("%s has exactly the Ukrainian keys, all non-empty", (code) => {
    const catalogue = CATALOGUES[code];
    expect(Object.keys(catalogue).sort()).toEqual(ukKeys);
    for (const key of ukKeys) expect(catalogue[key as MessageKey].trim()).not.toBe("");
  });

  it.each(LANGUAGES.map((l) => l.code))("%s uses the same placeholders as English", (code) => {
    for (const key of ukKeys as MessageKey[]) {
      expect(placeholdersOf(CATALOGUES[code][key]), key).toEqual(placeholdersOf(CATALOGUES.en[key]));
    }
  });

  it("keeps the product name untranslated in every language (DS-02)", () => {
    for (const { code } of LANGUAGES) expect(CATALOGUES[code]["brand.name"]).toBe("Willowsum");
  });
});

describe("translate", () => {
  it("substitutes placeholders", () => {
    expect(translate("uk", "document.title", { page: "Net worth" })).toBe("Willowsum · Net worth");
  });

  it("leaves an unknown placeholder visible rather than failing", () => {
    expect(translate("en", "document.title", {})).toBe("Willowsum · {page}");
  });
});

describe("I18nProvider", () => {
  function Probe() {
    const { t, setLocale } = useI18n();
    return (
      <button type="button" onClick={() => setLocale("en")}>
        {t("shell.nav.home")}
      </button>
    );
  }

  it("defaults to Ukrainian, switches language and sets lang on the root element", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByRole("button").textContent).toBe("Головна");
    expect(document.documentElement.lang).toBe("uk");
    act(() => screen.getByRole("button").click());
    expect(screen.getByRole("button").textContent).toBe("Home");
    expect(document.documentElement.lang).toBe("en");
  });
});
