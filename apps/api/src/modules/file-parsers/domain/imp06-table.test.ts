import { describe, expect, it } from "vitest";
import { detectDelimiter, readRows, TABLE_LIMITS, TableLimitError } from "./index.ts";

/**
 * IMP-06@PoC FR 1 (file: delimiter, quotes) and FR 8 (the delimiter's alternatives); the reading of an untrusted file
 * is bounded by IMP-01@PoC FR 13's ceilings and never evaluates a cell.
 */
describe("IMP-06@PoC: reading a delimited table", () => {
  const csv = [
    "Дата;Сума;Опис",
    '01.03.2026;-120,50;"Кава; круасан"',
    '02.03.2026;1 000,00;"Повернення ""боргу"""',
    '03.03.2026;-5,00;"Два\nрядки"',
  ].join("\r\n");

  it("IMP-06@PoC FR 8: the delimiter is chosen with the alternatives scored", () => {
    const result = detectDelimiter(csv, '"');
    expect(result.chosen.delimiter).toBe(";");
    expect(result.alternatives.map((a) => a.delimiter)).toEqual(expect.arrayContaining([",", "\t", "|"]));
    for (const a of result.alternatives) expect(a.score).toBeLessThan(result.chosen.score);
    expect(detectDelimiter("a\tb\tc\n1\t2\t3", '"').chosen.delimiter).toBe("\t");
    expect(detectDelimiter("a,b,c\n1,2,3\n4,5,6", '"').chosen.delimiter).toBe(",");
  });

  it("IMP-06@PoC FR 8: every delimiter hypothesis carries a live example", () => {
    const result = detectDelimiter(csv, '"');
    expect(result.chosen.sample).toEqual(["Дата", "Сума", "Опис"]);
    for (const a of result.alternatives) expect(a.sample.length).toBeGreaterThan(0);
    expect(result.alternatives.find((a) => a.delimiter === ",")!.sample).toEqual(["Дата;Сума;Опис"]);
  });

  it("IMP-06@PoC FR 1: quotes keep delimiters, doubled quotes and line breaks inside a cell", () => {
    const { rows } = readRows(csv, { delimiter: ";", quote: '"' });
    expect(rows).toEqual([
      ["Дата", "Сума", "Опис"],
      ["01.03.2026", "-120,50", "Кава; круасан"],
      ["02.03.2026", "1 000,00", 'Повернення "боргу"'],
      ["03.03.2026", "-5,00", "Два\nрядки"],
    ]);
  });

  it("IMP-06@PoC FR 1: a recipe's quote «none» reads quotes as text", () => {
    expect(readRows('a;"b;c"', { delimiter: ";", quote: null }).rows).toEqual([["a", '"b', 'c"']]);
    expect(readRows("a;'b;c'", { delimiter: ";", quote: "'" }).rows).toEqual([["a", "b;c"]]);
  });

  it("IMP-06@PoC FR 1: a formula is kept as text and never evaluated", () => {
    const { rows } = readRows('=1+2;"=HYPERLINK(""http://x"")";@SUM(A1)', { delimiter: ";", quote: '"' });
    expect(rows).toEqual([["=1+2", '=HYPERLINK("http://x")', "@SUM(A1)"]]);
  });

  it("IMP-06@PoC FR 1: an unclosed quote ends the cell at the end of the file and is reported", () => {
    const result = readRows('a;"b\nc', { delimiter: ";", quote: '"' });
    expect(result.rows).toEqual([["a", "b\nc"]]);
    expect(result.unclosedQuote).toBe(true);
  });

  it("IMP-06@PoC FR 1: trailing empty lines are not rows", () => {
    expect(readRows("a;b\n1;2\n\n\r\n", { delimiter: ";", quote: '"' }).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("IMP-06@PoC FR 1: the reading stops at the ceilings of IMP-01 (rows, cells) and at the column and cell bounds", () => {
    expect(TABLE_LIMITS).toMatchObject({ maxRows: 20_000, maxCells: 2_000_000 });
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `${i};x`).join("\n");
    expect(readRows(rows(TABLE_LIMITS.maxRows), { delimiter: ";", quote: '"' }).rows).toHaveLength(20_000);
    const refused = (text: string) => {
      try {
        readRows(text, { delimiter: ";", quote: '"' });
      } catch (error) {
        if (error instanceof TableLimitError) return [error.ceiling, error.limit];
        throw error;
      }
      return null;
    };
    expect(refused(rows(TABLE_LIMITS.maxRows + 1))).toEqual(["rows", 20_000]);
    expect(refused(";".repeat(TABLE_LIMITS.maxColumns))).toEqual(["columns", TABLE_LIMITS.maxColumns]);
    expect(refused("x".repeat(TABLE_LIMITS.maxCellChars + 1))).toEqual([
      "cell-length",
      TABLE_LIMITS.maxCellChars,
    ]);
    const wide = Array.from({ length: 4_000 }, () => ";".repeat(500)).join("\n");
    expect(refused(wide)).toEqual(["cells", 2_000_000]);
  });
});
