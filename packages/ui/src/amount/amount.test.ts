import { describe, expect, it } from "vitest";
import { LANGUAGES, PSEUDO_LOCALE, translate } from "@willowsum/i18n";
import { formatCompactAmount } from "./compact.ts";
import { chooseFit } from "./fit.ts";

const NB = "\u00A0";
type Lang = "uk" | "en";
const c = (value: string, currency = "€", locale: Lang = "uk") =>
  formatCompactAmount({ value, currency, locale })?.replace(/\u00A0/g, " ");

describe("formatCompactAmount (CMP-07, DS-04 item 11)", () => {
  it("uses Ukrainian units for the Ukrainian interface, currency after the unit", () => {
    expect(c("128400")).toBe("128,4 тис. €");
    expect(c("1240500", "₴")).toBe("1,24 млн ₴");
    expect(c("12345678901.00")).toBe("12,35 млрд €");
    expect(c("12345678901234.00")).toBe("12,35 трлн €");
    expect(c("123456789012345678.00")).toBe("123,5 квдрлн €");
    expect(c("1234567890123456789")).toBe("1,23 квінтлн €");
  });
  it("uses English units and the English layout for the English interface: symbol first, no space, dot", () => {
    expect(c("128400", "€", "en")).toBe("€128.4k");
    expect(c("1240500", "₴", "en")).toBe("₴1.24M");
    expect(c("12345678901.00", "€", "en")).toBe("€12.35bn");
    expect(c("12345678901234.00", "€", "en")).toBe("€12.35tn");
    expect(c("123456789012345678.00", "€", "en")).toBe("€123.5qd");
    expect(c("1234567890123456789", "€", "en")).toBe("€1.23qn");
  });
  it("keeps a no-break space after a letter currency code in English", () => {
    expect(formatCompactAmount({ value: "128400", currency: "CHF", locale: "en" })).toBe(`CHF${NB}128.4k`);
  });
  it("has no space at all in the English form", () => {
    expect(formatCompactAmount({ value: "128400", currency: "€", locale: "en" })).toBe("€128.4k");
  });
  it("puts the true minus in front", () => {
    expect(c("-1240500", "₴")).toBe("−1,24 млн ₴");
    expect(c("-1240500", "₴", "en")).toBe("−₴1.24M");
    expect(c("-128400", "€", "en")).toBe("−€128.4k");
  });
  it("carries into the next unit when rounding reaches a thousand", () => {
    expect(c("999960")).toBe("1,00 млн €");
    expect(c("999960", "€", "en")).toBe("€1.00M");
  });
  it("caps at 999+ of the largest unit", () => {
    expect(c("9".repeat(25))).toBe("999+ квінтлн €");
    expect(c("9".repeat(25), "€", "en")).toBe("€999+qn");
  });
  it("shows two decimals below 100 and one from 100", () => {
    expect(c("12345678")).toBe("12,35 млн €");
    expect(c("12450000")).toBe("12,45 млн €");
    expect(c("-3600")).toBe("−3,60 тис. €");
    expect(c("128450")).toBe("128,5 тис. €");
  });
  it("switches to one decimal when rounding reaches 100", () => {
    expect(c("99995")).toBe("100,0 тис. €");
    expect(c("99999.5")).toBe("100,0 тис. €");
    expect(c("99995", "€", "en")).toBe("€100.0k");
  });
  it("returns null for anything that is not a plain decimal string", () => {
    for (const bad of ["1 234", "1,234.56", "--5000", "abcd", "1e50", "Infinity1", ""]) {
      expect(formatCompactAmount({ value: bad, currency: "€", locale: "uk" })).toBeNull();
    }
  });
  it("returns null below 1 000", () => {
    expect(formatCompactAmount({ value: "999.99", currency: "€", locale: "uk" })).toBeNull();
    expect(formatCompactAmount({ value: "950", currency: "€", locale: "en" })).toBeNull();
  });
  it("uses no-break spaces, also inside the value and before the currency", () => {
    expect(formatCompactAmount({ value: "128400", currency: "€", locale: "uk" })).toBe(
      `128,4${NB}тис.${NB}€`,
    );
  });
});

describe("chooseFit (CMP-07 order)", () => {
  // Width grows with characters and scale; the box is `box` units wide.
  const fitsIn = (box: number) => (text: string, scale: number) => text.length * scale <= box;
  const full = "12 345 678 901 234,00 €"; // 23 chars
  const compact = "12,35 трлн"; // 10 chars (currency left out to keep the arithmetic simple)
  it("keeps the full value when it fits", () => {
    expect(chooseFit(full, compact, fitsIn(30))).toEqual({ text: full, scale: 1, abbreviated: false });
  });
  it("shrinks the full value to 80 % first", () => {
    expect(chooseFit(full, compact, fitsIn(19))).toEqual({ text: full, scale: 0.8, abbreviated: false });
  });
  it("then abbreviates at 80 %, then shrinks down to 55 %", () => {
    expect(chooseFit(full, compact, fitsIn(8))).toEqual({ text: compact, scale: 0.8, abbreviated: true });
    expect(chooseFit(full, compact, fitsIn(6))).toEqual({ text: compact, scale: 0.6, abbreviated: true });
    expect(chooseFit(full, compact, fitsIn(2))).toEqual({ text: compact, scale: 0.55, abbreviated: true });
  });
});

describe("NFR-09@PoC FR 2: compact amounts for a newly registered language", () => {
  it("NFR-09@PoC FR 2: every registered language abbreviates with the unit words of its own catalogue", () => {
    for (const { code } of LANGUAGES) {
      const out = formatCompactAmount({ value: "128400", currency: "€", locale: code });
      expect(out, code).toContain(translate(code, "amount.compact.thousand"));
      expect(out, code).toContain("128");
      expect(out, code).toContain("€");
    }
  });

  it("NFR-09@PoC FR 2: the pseudo-locale follows the layout of its regional format (en-GB: symbol first)", () => {
    const out = formatCompactAmount({ value: "128400", currency: "€", locale: PSEUDO_LOCALE });
    expect(out).toBe(`€128.4${translate(PSEUDO_LOCALE, "amount.compact.thousand")}`);
  });
});
