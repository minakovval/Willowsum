import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  detectEncoding,
  decodeText,
  readRows,
  TABLE_LIMITS,
  TableLimitError,
} from "./index.ts";
import { encodeSingleByte } from "./bytes.test-helper.ts";

/** Security review of PR #602: the reader's bounds on an untrusted file (IMP-06@PoC FR 1; IMP-01@PoC FR 13). */
describe("IMP-06@PoC FR 1: the table reader's bounds (security review)", () => {
  const refused = (text: string, quote: '"' | null = '"') => {
    try {
      readRows(text, { delimiter: ";", quote });
    } catch (error) {
      if (error instanceof TableLimitError) return error.ceiling;
      throw error;
    }
    return null;
  };

  it("IMP-06@PoC FR 1: the column and cell bounds are 512 columns and 32 768 characters, exactly", () => {
    expect(TABLE_LIMITS).toMatchObject({ maxColumns: 512, maxCellChars: 32_768 });
    expect(refused(";".repeat(511))).toBeNull();
    expect(refused(";".repeat(512))).toBe("columns");
    expect(refused("x".repeat(32_768))).toBeNull();
    expect(refused("x".repeat(32_769))).toBe("cell-length");
  });

  it("IMP-06@PoC FR 1: a quote that never closes stops at the cell bound, with or without doubled quotes", () => {
    expect(refused(`a;b\n1;"${"x".repeat(40_000)}`)).toBe("cell-length");
    expect(refused(`a;b\n1;"${'""'.repeat(40_000)}`)).toBe("cell-length");
    expect(refused(`"${"x;\n".repeat(12_000)}`)).toBe("cell-length");
    expect(readRows(`a;"${'""'.repeat(16_384)}"`, { delimiter: ";", quote: '"' }).rows[0]![1]).toHaveLength(
      16_384,
    );
  });

  it("IMP-06@PoC FR 8: a delimiter whose reading breaks a bound is scored 0, not an error", () => {
    const text = `Дата,Сума\n${";".repeat(600)},1\n`;
    const found = detectDelimiter(text, '"');
    expect(found.chosen.delimiter).toBe(",");
    expect(found.alternatives.find((g) => g.delimiter === ";")!.score).toBe(0);
  });

  // Defect at 652ddc57: an empty line is no record, so only the 2 million cells stop them — a 2 MB file of line
  // breaks is read into 2 million row arrays (peak ~0.5 GB, measured). With the patch (TABLE_LIMITS.maxLines) the
  // reading stops (fixed in review round 1; was `it.fails`).
  it("IMP-06@PoC FR 1: empty lines cannot pile up past the row ceiling", () => {
    expect(refused("\n".repeat(100_000))).toBe("rows");
    expect(refused(";\r\n".repeat(100_000))).toBe("rows");
    expect(refused("\r".repeat(100_000), null)).toBe("rows");
  });

  it("IMP-06@PoC FR 1: a statement with some empty lines is still read", () => {
    const text = `Дата;Сума\n\n${"01.03.2026;1\n\n".repeat(15_000)}`;
    expect(readRows(text, { delimiter: ";", quote: '"' }).rows).toHaveLength(30_001);
  });

  it("IMP-06@PoC FR 8: bytes that are not UTF-8 never give a UTF-8 reading, and no decoding throws", () => {
    const bytes = encodeSingleByte("Дата;Сума;Опис\n01.03.2026;1,00;Кава", "windows-1251");
    const found = detectEncoding(bytes);
    expect([found.chosen, ...found.alternatives].map((g) => g.encoding)).not.toContain("utf-8");
    const broken = Uint8Array.of(0xef, 0xbb, 0xbf, 0x61, 0xff, 0xc3, 0x3b, 0x62, 0xed, 0xa0, 0x80);
    expect(detectEncoding(broken).chosen).toMatchObject({ encoding: "utf-8", reason: "bom" });
    expect(decodeText(broken, "utf-8")).toBe("a��;b���");
    const lone = Uint8Array.of(0xff, 0xfe, 0x61, 0x00, 0x00, 0xd8, 0x3b, 0x00, 0x62);
    expect(detectEncoding(lone).chosen.encoding).toBe("utf-16le");
    expect(decodeText(lone, "utf-16le")).toBe("a�;�");
  });
});
