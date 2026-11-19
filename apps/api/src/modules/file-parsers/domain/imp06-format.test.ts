import { describe, expect, it } from "vitest";
import {
  compareSignatures,
  findHeaderRow,
  formatSignature,
  normalizeHeaderCell,
  signatureSimilarity,
} from "./index.ts";

/** IMP-06@PoC FR 7: the format's signature — the normalised header, the columns and the labels of the preamble. */
describe("IMP-06@PoC FR 7: the format signature", () => {
  const statement = (balance: string, iban: string, period: string): string[][] => [
    ["Виписка", ""],
    ["Рахунок:", iban],
    [`Період: ${period}`],
    ["Клієнт тестовий"],
    ["Дата операції", "Сума", "Валюта", "Опис", balance],
    ["01.03.2026", "-120,50", "EUR", "Кава", "1 000,00"],
    ["02.03.2026", "-5,00", "EUR", "Хліб", "995,00"],
  ];

  it("IMP-06@PoC FR 7: case, diacritics, digits and currency codes in a header are ignored", () => {
    expect(normalizeHeaderCell("Залишок (EUR)")).toBe("залишок");
    expect(normalizeHeaderCell("ЗАЛИШОК, uah")).toBe("залишок");
    expect(normalizeHeaderCell("Café  Betrag 2")).toBe("cafe betrag");
    expect(normalizeHeaderCell("Сума, ₴")).toBe("сума");
    expect(normalizeHeaderCell("Сума в грн.")).toBe("сума в");
  });

  it("IMP-06@PoC FR 7: the header row is found after the preamble", () => {
    expect(findHeaderRow(statement("Залишок (EUR)", "UA00 0000", "03.2026"), 0)).toBe(4);
    expect(findHeaderRow([["01.03.2026", "-1,00"]], 0)).toBeNull();
  });

  it("IMP-06@PoC FR 7: account numbers and periods in the preamble do not change the signature", () => {
    const a = formatSignature(statement("Залишок", "UA000000000000000000000000001", "01.03.2026–31.03.2026"));
    const b = formatSignature(statement("Залишок", "UA000000000000000000000000002", "01.04.2026–30.04.2026"));
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(a!.labels).toEqual(["період", "рахунок"]);
    expect(a!.columns).toBe(5);
  });

  it("IMP-06@PoC FR 7: a line of one cell without «:» (a name, a title) is not a label", () => {
    const a = formatSignature(statement("Залишок", "UA00", "03.2026"))!;
    expect(a.labels).not.toContain("клієнт тестовий");
  });

  it("IMP-06@PoC EC1: a changed layout changes the signature, and its similarity hints «format changed»", () => {
    const before = formatSignature(statement("Залишок", "UA00", "03.2026"))!;
    const moved = statement("Залишок", "UA00", "03.2026").map((r, i) =>
      i >= 4 ? [r[0]!, r[3]!, r[1]!, r[2]!, r[4]!] : r,
    );
    const after = formatSignature(moved)!;
    expect(after).not.toEqual(before);
    const similarity = signatureSimilarity(before, after);
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(1);
    expect(compareSignatures(before, after)).toEqual({ status: "changed", similarity });
    expect(compareSignatures(before, formatSignature(statement("Залишок (UAH)", "UA11", "04.2026")))).toEqual(
      {
        status: "match",
        similarity: 1,
      },
    );
    expect(compareSignatures(null, after)).toEqual({ status: "unknown", similarity: null });
    const other = formatSignature([
      ["Date", "Amount"],
      ["2026-03-01", "1"],
    ])!;
    expect(signatureSimilarity(before, other)).toBeLessThan(0.3);
  });

  it("IMP-06@PoC EC3: rows the recipe skips before the table are not read as the preamble", () => {
    const rows = statement("Залишок", "UA00", "03.2026");
    const skipped = formatSignature(rows, { skipRows: 3 })!;
    expect(skipped.labels).toEqual([]);
    expect(formatSignature(rows, { skipRows: 2 })!.labels).toEqual(["період"]);
  });

  it("IMP-06@PoC FR 7: a recipe's header row is taken as given", () => {
    const rows = statement("Залишок", "UA00", "03.2026");
    const given = formatSignature(rows, { headerRow: 5 })!;
    expect(given.header).toEqual(["", "", "", "кава", ""]);
    expect(given.labels).toContain(normalizeHeaderCell("Дата операції"));
    expect(normalizeHeaderCell("Дата операції")).toBe("дата операціі");
  });
});
