import { describe, expect, it } from "vitest";
import { detectedBank, INSTITUTION_LIMITS, type Institution } from "./detect.ts";

/**
 * IMP-08@PoC FR 2, server part (plan row 230; Рішення ведучого 2026-11-26, власник не схвалював): the statement's bank
 * is a directory bank whose name the rows before the table print — exactly or after folding case, quotes, punctuation
 * and spaces, as whole words. No fuzzy match; two banks — none.
 */
const BANKS: readonly Institution[] = [
  { name: "Універсал Банк (monobank)", legalName: 'АТ "УНІВЕРСАЛ БАНК"' },
  { name: "ПриватБанк", legalName: 'АТ КБ "ПРИВАТБАНК"' },
  { name: "ПУМБ", legalName: 'АТ "ПУМБ"' },
];

describe("IMP-08@PoC FR 2 (server part): the bank of the statement from the directory", () => {
  it("IMP-08@PoC FR 2: the name, the legal name and each part of a name with brackets match after folding", () => {
    expect(detectedBank([["monobank"]], BANKS)).toBe("Універсал Банк (monobank)");
    expect(detectedBank([["Виписка", "АТ «Універсал банк»"]], BANKS)).toBe("Універсал Банк (monobank)");
    expect(detectedBank([['АТ КБ "ПриватБанк"']], BANKS)).toBe("ПриватБанк");
    expect(detectedBank([["ПРИВАТБАНК, Київ"]], BANKS)).toBe("ПриватБанк");
  });

  it("IMP-08@PoC FR 2: a misspelt or partial name is not a match; two banks named — none", () => {
    expect(detectedBank([["Приват Банк"]], BANKS)).toBeNull();
    expect(detectedBank([["Універсал"]], BANKS)).toBeNull();
    expect(detectedBank([["Revolut Bank UAB"]], BANKS)).toBeNull();
    expect(detectedBank([["ПУМБ", "ПриватБанк"]], BANKS)).toBeNull();
    expect(detectedBank([], BANKS)).toBeNull();
  });

  it("IMP-08@PoC FR 2: a directory beyond its bound and a name over its length are not searched", () => {
    const many = Array.from({ length: INSTITUTION_LIMITS.count }, (_, i) => ({ name: `Банк номер ${i}` }));
    expect(detectedBank([["ПУМБ"]], [...many, { name: "ПУМБ" }])).toBeNull();
    expect(detectedBank([["x".repeat(400)]], [{ name: "x".repeat(400) }])).toBeNull();
    // An alias shorter than 3 characters never matches.
    expect(detectedBank([["АБ"]], [{ name: "АБ" }])).toBeNull();
  });
});
