import { describe, expect, it } from "vitest";
import { encodeSingleByte, utf16 } from "./bytes.test-helper.ts";
import { decodeText, detectEncoding, ENCODINGS } from "./index.ts";

const HEADER = "Дата операції;Сума;Валюта;Опис операції;Залишок (UAH)";
const ROWS = [
  "01.03.2026;-120,50;UAH;Кав'ярня «Зерно»;10 250,00",
  "02.03.2026;15 000,00;UAH;Заробітна плата за лютий;25 250,00",
  "03.03.2026;-845,10;UAH;Супермаркет, продукти та побутова хімія;24 404,90",
];
const TEXT = [HEADER, ...ROWS].join("\r\n");

describe("IMP-06@PoC: the file's encoding", () => {
  it("IMP-06@PoC AC12: a Windows-1251 CSV without BOM with Ukrainian headers is read as Windows-1251, without broken characters, with the alternatives scored", () => {
    const bytes = encodeSingleByte(TEXT, "windows-1251");
    const result = detectEncoding(bytes);
    expect(result.chosen.encoding).toBe("windows-1251");
    expect(result.chosen.reason).toBe("content");
    const text = decodeText(bytes, result.chosen.encoding);
    expect(text).toBe(TEXT);
    expect(text).not.toMatch(/�/);
    // The alternatives: every other supported single-byte reading, scored lower, each with a live sample.
    const others = result.alternatives.map((a) => a.encoding);
    expect(others).toEqual(expect.arrayContaining(["windows-1252", "cp866", "koi8-u"]));
    for (const alternative of result.alternatives) {
      expect(alternative.score).toBeLessThan(result.chosen.score);
      expect(alternative.sample.length).toBeGreaterThan(0);
    }
    expect(result.chosen.sample).toBe(HEADER);
  });

  it("IMP-06@PoC FR 8: a BOM decides the encoding", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(TEXT)]);
    expect(detectEncoding(utf8).chosen).toMatchObject({ encoding: "utf-8", reason: "bom", score: 1 });
    expect(decodeText(utf8, "utf-8")).toBe(TEXT);
    for (const order of ["le", "be"] as const) {
      const bytes = utf16(TEXT, order, true);
      expect(detectEncoding(bytes).chosen).toMatchObject({ encoding: `utf-16${order}`, reason: "bom" });
      expect(decodeText(bytes, `utf-16${order}`)).toBe(TEXT);
    }
  });

  it("IMP-06@PoC FR 1: every supported encoding without BOM is recognised from Ukrainian text", () => {
    const cases: [string, Uint8Array][] = [
      ["utf-8", new TextEncoder().encode(TEXT)],
      ["utf-16le", utf16(TEXT, "le", false)],
      ["utf-16be", utf16(TEXT, "be", false)],
      ["windows-1251", encodeSingleByte(TEXT, "windows-1251")],
      // CP866 has no «і» and no guillemets: the sample writes «ї» for it.
      ["cp866", encodeSingleByte(TEXT.replace(/«|»/g, '"').replace(/і/g, "ї"), "ibm866")],
      ["koi8-u", encodeSingleByte(TEXT.replace(/«|»/g, '"'), "koi8-u")],
    ];
    for (const [encoding, bytes] of cases)
      expect(detectEncoding(bytes).chosen.encoding, encoding).toBe(encoding);
    expect(ENCODINGS).toEqual([
      "utf-8",
      "utf-16le",
      "utf-16be",
      "windows-1251",
      "windows-1252",
      "cp866",
      "koi8-u",
    ]);
  });

  it("IMP-06@PoC FR 1: Windows-1252 text (German headers) is read as Windows-1252", () => {
    const text =
      "Buchungstag;Empfänger;Verwendungszweck;Betrag (EUR);Währung\n02.03.2026;Bäckerei Müller;Brötchen;-3,50;EUR";
    const result = detectEncoding(encodeSingleByte(text, "windows-1252"));
    expect(result.chosen.encoding).toBe("windows-1252");
  });

  it("IMP-06@PoC FR 9: the same bytes always give the same answer", () => {
    const bytes = encodeSingleByte(TEXT, "windows-1251");
    expect(JSON.stringify(detectEncoding(bytes))).toBe(JSON.stringify(detectEncoding(bytes.slice())));
  });
});
