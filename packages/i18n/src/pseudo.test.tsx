import { render, screen } from "@testing-library/react";
import {
  CATALOGUES,
  I18nProvider,
  LANGUAGES,
  PSEUDO_LOCALE,
  placeholdersOf,
  pseudoLocalize,
  translate,
  useT,
} from "./index.ts";
import type { MessageKey } from "./types.ts";

/**
 * NFR-09@PoC FR 2 (criterion «Додавання мови»): a language is added by registering it, with no code
 * change. The left-to-right pseudo-locale is such a language: one registry row and a catalogue generated
 * from English, with lengthened, accented strings. RTL pseudo-locale — from PoC v2.
 */
const keys = Object.keys(CATALOGUES.en) as MessageKey[];
const pseudo = CATALOGUES[PSEUDO_LOCALE];
/** Untranslated by design (DS-02): the product name. */
const UNTRANSLATED: readonly MessageKey[] = ["brand.name", "brand.markLabel"];

describe("NFR-09@PoC FR 2: pseudoLocalize", () => {
  it("NFR-09@PoC FR 2: accents every Latin letter and wraps the text in brackets", () => {
    const out = pseudoLocalize("Settings");
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(out).not.toMatch(/[A-Za-z]/);
  });

  it("NFR-09@PoC FR 2: lengthens every string by at least 40 % (long translations show up in layout)", () => {
    for (const s of ["Add", "Settings", "Skip to content", "Collapse navigation"]) {
      expect(pseudoLocalize(s).length, s).toBeGreaterThanOrEqual(Math.ceil(s.length * 1.4));
    }
  });

  it("NFR-09@PoC FR 2: keeps {placeholders} unchanged so values are still substituted", () => {
    expect(placeholdersOf(pseudoLocalize("{count} to review"))).toEqual(["count"]);
    expect(pseudoLocalize("Willowsum · {page}")).toContain("{page}");
  });

  it("NFR-09@PoC FR 2: leaves digits, symbols and spaces alone", () => {
    expect(pseudoLocalize("1 234,50 € · 15 %")).toContain("1 234,50 € · 15 %");
  });

  it("NFR-09@PoC FR 2: is idempotent on letters it already accented", () => {
    const once = pseudoLocalize("Budget");
    expect(once.slice(1, 7)).toBe(pseudoLocalize(once.slice(1, 7)).slice(1, 7));
  });
});

describe("NFR-09@PoC FR 2: the pseudo-locale is a registered language", () => {
  it("NFR-09@PoC FR 2: has one registry row: left to right, status «pseudo», English regional format", () => {
    const rows = LANGUAGES.filter((l) => l.code === PSEUDO_LOCALE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dir: "ltr", status: "pseudo", format: "en-GB" });
  });

  it("NFR-09@PoC FR 2: its catalogue is English, pseudo-localised, key for key", () => {
    expect(Object.keys(pseudo).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const expected = UNTRANSLATED.includes(key) ? CATALOGUES.en[key] : pseudoLocalize(CATALOGUES.en[key]);
      expect(pseudo[key], key).toBe(expected);
    }
  });

  it("NFR-09@PoC FR 2: every message except the product name differs from English (nothing slips through)", () => {
    for (const key of keys) {
      if (UNTRANSLATED.includes(key)) continue;
      expect(pseudo[key], key).not.toBe(CATALOGUES.en[key]);
    }
  });

  it("NFR-09@PoC FR 2: translate substitutes values into pseudo messages", () => {
    const out = translate(PSEUDO_LOCALE, "shell.nav.reviewCount", { count: 7 });
    expect(out).toContain("7");
    expect(out).not.toContain("{count}");
    expect(out.startsWith("[")).toBe(true);
  });

  it("NFR-09@PoC FR 2: the provider renders it and sets lang and a left-to-right dir on the root element", () => {
    function Probe() {
      return <p>{useT()("shell.settings")}</p>;
    }
    render(
      <I18nProvider initialLocale={PSEUDO_LOCALE}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText(pseudoLocalize(CATALOGUES.en["shell.settings"]))).toBeTruthy();
    expect(document.documentElement.lang).toBe(PSEUDO_LOCALE);
    expect(document.documentElement.dir).toBe("ltr");
  });
});
