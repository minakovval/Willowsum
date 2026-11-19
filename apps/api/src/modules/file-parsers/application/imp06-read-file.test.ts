import { describe, expect, it } from "vitest";
import { encodeSingleByte } from "../domain/bytes.test-helper.ts";
import { FileTooLargeError, readDelimitedFile, READ_LIMITS } from "./index.ts";

const statement = (balance: string, iban: string) =>
  [
    `Рахунок:;${iban}`,
    "Період:;01.03.2026 - 31.03.2026",
    `Дата;Сума;Опис;${balance}`,
    "01.03.2026;-120,50;Кава;1 000,00",
    "02.03.2026;-5,00;Хліб;995,00",
  ].join("\r\n");

describe("IMP-06@PoC: reading a statement file and its format fingerprint", () => {
  it("IMP-06@PoC AC7: two files of one bank with «Залишок (EUR)» and «Залишок (UAH)» have the same fingerprint", () => {
    const eur = readDelimitedFile(
      new TextEncoder().encode(statement("Залишок (EUR)", "UA000000000000000000000000001")),
    );
    const uah = readDelimitedFile(
      encodeSingleByte(statement("Залишок (UAH)", "UA000000000000000000000000002"), "windows-1251"),
    );
    expect(eur.format).not.toBeNull();
    expect(eur.format!.fingerprint).toMatch(/^fp1:[0-9a-f]{64}$/);
    expect(uah.format!.fingerprint).toBe(eur.format!.fingerprint);
    expect(uah.encoding.chosen.encoding).toBe("windows-1251");
  });

  it("IMP-06@PoC FR 7: another header gives another fingerprint", () => {
    const a = readDelimitedFile(new TextEncoder().encode(statement("Залишок", "UA00")));
    const b = readDelimitedFile(new TextEncoder().encode(statement("Баланс", "UA00")));
    expect(b.format!.fingerprint).not.toBe(a.format!.fingerprint);
  });

  it("IMP-06@PoC FR 9: the same bytes give the same reading, byte for byte", () => {
    const bytes = encodeSingleByte(statement("Залишок", "UA00"), "windows-1251");
    expect(JSON.stringify(readDelimitedFile(bytes))).toBe(JSON.stringify(readDelimitedFile(bytes.slice())));
  });

  it("IMP-06@PoC FR 1: the recipe's file rules (encoding, delimiter, quote, rows to skip, header row) are applied as given", () => {
    const bytes = encodeSingleByte(statement("Залишок", "UA00"), "windows-1251");
    const forced = readDelimitedFile(bytes, { encoding: "koi8-u", delimiter: ",", quote: null });
    expect(forced.encoding.chosen).toMatchObject({ encoding: "koi8-u", reason: "recipe" });
    expect(forced.delimiter.chosen).toMatchObject({ delimiter: ",", reason: "recipe" });
    expect(forced.rows[0]).toHaveLength(1);
    // FR 8: the recipe's choices carry their live examples too.
    expect(forced.encoding.chosen.sample.length).toBeGreaterThan(0);
    expect(forced.delimiter.chosen.sample).toHaveLength(1);
    expect(readDelimitedFile(bytes, { encoding: "windows-1251" }).encoding.chosen.sample).toBe(
      "Рахунок:;UA00",
    );
    const rows = readDelimitedFile(bytes, { skipRows: 1, headerRow: 2 });
    expect(rows.headerRow).toBe(2);
    expect(rows.format!.signature.labels).toEqual(["період"]);
  });

  it("IMP-06@PoC AC12: bytes past the scored sample that do not decode are counted, not hidden", () => {
    const head = new TextEncoder().encode(
      `${statement("Залишок", "UA00")}\r\n${"01.03.2026;-1,00;Кава;1,00\r\n".repeat(3000)}`,
    );
    expect(head.length).toBeGreaterThan(64 * 1024);
    const bytes = new Uint8Array([...head, 0xff, 0x0d, 0x0a]);
    const reading = readDelimitedFile(bytes);
    expect(reading.encoding.chosen.encoding).toBe("utf-8");
    expect(reading.replacementChars).toBe(1);
    expect(readDelimitedFile(head).replacementChars).toBe(0);
  });

  it("IMP-06@PoC FR 1: a file over 25 MiB is refused before it is read", () => {
    expect(READ_LIMITS.fileBytes).toBe(25 * 1024 * 1024);
    expect(() => readDelimitedFile(new Uint8Array(READ_LIMITS.fileBytes + 1))).toThrow(FileTooLargeError);
  });
});
