import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FileRejectedError, FILE_LIMITS, type RejectionCode } from "../../domain/index.ts";
import {
  cfb,
  csv,
  docx,
  executable,
  html,
  pdf,
  sheetXml,
  xls,
  XLSM_MAIN,
  xlsx,
  zip,
  STATEMENT_ROWS,
} from "../../synthetic-files.ts";
import { inspectFile } from "./inspect.ts";

async function rejectionOf(bytes: Buffer): Promise<RejectionCode> {
  try {
    await inspectFile(bytes);
  } catch (error) {
    if (error instanceof FileRejectedError) return error.code;
    throw error;
  }
  throw new Error("The file was accepted");
}

describe("type by content (ARC-06@PoC FR 4, NFR-15@PoC FR 18, IMP-01@PoC FR 3)", () => {
  it("ARC-06@PoC FR 4: CSV, TSV, XLSX and XLS without macros are accepted with the type of their content", async () => {
    await expect(inspectFile(csv())).resolves.toMatchObject({
      format: "csv",
      contentType: "text/csv",
      rows: 3,
      cells: 9,
    });
    await expect(inspectFile(csv(STATEMENT_ROWS, ";"))).resolves.toMatchObject({ format: "csv" });
    await expect(inspectFile(csv(STATEMENT_ROWS, "\t"))).resolves.toMatchObject({
      format: "tsv",
      contentType: "text/tab-separated-values",
    });
    await expect(inspectFile(xlsx())).resolves.toMatchObject({
      format: "xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rows: 3,
      cells: 9,
    });
    await expect(inspectFile(xls())).resolves.toMatchObject({
      format: "xls",
      contentType: "application/vnd.ms-excel",
      rows: 2,
      cells: 4,
      sheets: 1,
    });
  });

  it("IMP-01@PoC FR 3: Windows-1251 CSV with quoted fields that hold line breaks is CSV", async () => {
    // А…я (U+0410…U+044F) are 0xC0…0xFF in Windows-1251.
    const cp1251 = (s: string) =>
      Buffer.from([...s].map((ch) => (ch >= "А" && ch <= "я" ? ch.charCodeAt(0) - 0x350 : ch.charCodeAt(0))));
    const text = cp1251('Дата;"Опис"\r\n2026-10-01;"рядок\r\nдругий"\r\n');
    await expect(inspectFile(text)).resolves.toMatchObject({ format: "csv", rows: 2, cells: 4 });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv()]);
    await expect(inspectFile(bom)).resolves.toMatchObject({ format: "csv", rows: 3 });
  });

  it("NFR-15@PoC FR 18: ZIP, DOCX, PDF, HTML and an executable are «Формат не підтримується», whatever their name", async () => {
    expect(await rejectionOf(zip([{ name: "statement.csv", data: csv() }]))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(docx())).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(pdf())).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(html())).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(executable())).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(Buffer.from("just one line of text without columns\n"))).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect(await rejectionOf(Buffer.from("﻿a,b\n", "utf16le"))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(cfb([{ name: "WordDocument", data: Buffer.alloc(5000, 1) }]))).toBe(
      "UNSUPPORTED_FORMAT",
    );
  });

  it("IMP-01@PoC FR 14: XLSM, XLTM and XLAM books, also named .xlsx, and any vbaProject.bin are refused", async () => {
    expect(await rejectionOf(xlsx({ main: XLSM_MAIN, vbaProject: true }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xlsx({ main: "application/vnd.ms-excel.template.macroEnabled.main+xml" }))).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect(await rejectionOf(xlsx({ main: "application/vnd.ms-excel.addin.macroEnabled.main+xml" }))).toBe(
      "UNSUPPORTED_FORMAT",
    );
    // A book that says it is a plain workbook but carries a VBA project.
    expect(
      await rejectionOf(
        xlsx({ extraParts: [{ name: "xl/vbaProject.bin", data: Buffer.from("synthetic") }] }),
      ),
    ).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: external links, DDE, embedded objects and XML with DOCTYPE or ENTITY are refused before any cell is read", async () => {
    const extra = (name: string, data = "<x/>") => xlsx({ extraParts: [{ name, data }] });
    expect(await rejectionOf(extra("xl/externalLinks/externalLink1.xml"))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(extra("xl/embeddings/oleObject1.bin", "MZ"))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(extra("xl/activeX/activeX1.xml"))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(extra("xl/styles.xml", '<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'))).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect(
      await rejectionOf(xlsx({ sheetData: `<row r="1"><c r="A1"><f>cmd|' /C calc'!A0</f></c></row>` })),
    ).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: XLS with VBA or macros, Excel 5/95, embedded objects and external links are refused", async () => {
    expect(await rejectionOf(xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ extra: [{ name: "Macros" }] }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ sheets: [[[1]], [[2]]], sheetKinds: [0, 1] }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ sheets: [[[1]], [[2]]], sheetKinds: [0, 6] }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ streamName: "Book", version: 0x0500 }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ version: 0x0500 }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ extra: [{ name: "MBD0001A2B3" }] }))).toBe("UNSUPPORTED_FORMAT");
    expect(await rejectionOf(xls({ externalLink: true }))).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: encrypted books are «Файл зашифровано»", async () => {
    expect(await rejectionOf(xls({ filePass: true }))).toBe("ENCRYPTED");
    // An encrypted XLSX is a compound file with EncryptionInfo and EncryptedPackage.
    const encrypted = cfb([
      { name: "EncryptionInfo", data: randomBytes(300) },
      { name: "EncryptedPackage", data: randomBytes(5000) },
    ]);
    expect(await rejectionOf(encrypted)).toBe("ENCRYPTED");
  });

  it("IMP-01@PoC FR 14: damaged files are «Файл пошкоджено», without looping", async () => {
    const book = xlsx();
    expect(await rejectionOf(book.subarray(0, book.length - 30))).toBe("CORRUPTED");
    const flipped = Buffer.from(book);
    flipped[60] = flipped[60]! ^ 0xff; // inside the first element's compressed data
    expect(["CORRUPTED", "UNSUPPORTED_FORMAT"]).toContain(await rejectionOf(flipped));
    expect(await rejectionOf(cfb([{ name: "Workbook", data: Buffer.alloc(5000) }], { loopFat: true }))).toBe(
      "CORRUPTED",
    );
    expect(await rejectionOf(xls().subarray(0, 1024))).toBe("CORRUPTED");
  });

  it("IMP-01@PoC EC3: a file without transactions is «У файлі немає транзакцій»", async () => {
    expect(await rejectionOf(Buffer.alloc(0))).toBe("NO_TRANSACTIONS");
    expect(await rejectionOf(Buffer.from(" \r\n\r\n"))).toBe("NO_TRANSACTIONS");
    expect(await rejectionOf(xlsx({ rows: [] }))).toBe("NO_TRANSACTIONS");
  });

  it("IMP-01@PoC EC2: an encrypted Excel book is refused with the request to remove the password", async () => {
    const err = await inspectFile(xls({ filePass: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileRejectedError);
    expect((err as FileRejectedError).rejection.message.uk).toBe(
      "Файл зашифровано. Зніміть пароль і завантажте файл знову",
    );
  });
});

describe("ZIP package limits while unpacking (ARC-06@PoC FR 4, NFR-15@PoC FR 18)", () => {
  it("ARC-06@PoC FR 4: more than 1 000 elements is refused", async () => {
    const parts = Array.from({ length: FILE_LIMITS.zipEntries + 1 }, (_, i) => ({
      name: `x/${i}.txt`,
      data: "a",
    }));
    expect(await rejectionOf(zip(parts))).toBe("ARCHIVE_LIMIT");
    const ok = Array.from({ length: FILE_LIMITS.zipEntries - 5 }, (_, i) => ({
      name: `xl/media/${i}.txt`,
      data: "ab",
    }));
    await expect(inspectFile(xlsx({ extraParts: ok }))).resolves.toMatchObject({ format: "xlsx" });
  });

  it("ARC-06@PoC FR 4: an element compressed over 100:1 is refused, also when its declared size lies", async () => {
    const bomb = Buffer.alloc(1024 * 1024, 0x20); // 1 MiB of spaces deflates far beyond 100:1
    expect(await rejectionOf(xlsx({ extraParts: [{ name: "xl/styles.xml", data: bomb }] }))).toBe(
      "ARCHIVE_LIMIT",
    );
    expect(
      await rejectionOf(xlsx({ extraParts: [{ name: "xl/styles.xml", data: bomb, declaredSize: 1000 }] })),
    ).toBe("ARCHIVE_LIMIT");
  });

  it("ARC-06@PoC FR 4: more than 200 MiB after unpacking is refused while unpacking", async () => {
    // Elements of runs of one random byte compress about 25:1 — under the ratio — and together pass 200 MiB.
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    for (let at = 0; at < chunk.length; at += 64) chunk.fill(randomBytes(1)[0]!, at, at + 64);
    const parts = Array.from({ length: 26 }, (_, i) => ({ name: `xl/media/part${i}.xml`, data: chunk }));
    const book = xlsx({ extraParts: parts });
    expect(book.length).toBeLessThan(FILE_LIMITS.fileBytes);
    expect(await rejectionOf(book)).toBe("ARCHIVE_LIMIT");
  }, 60_000);

  it("ARC-06@PoC FR 4: overlapping elements are a damaged package", async () => {
    const book = xlsx();
    // Point the second central record at the first element's local header.
    const eocd = book.length - 22;
    const dir = book.readUInt32LE(eocd + 16);
    const second = dir + 46 + book.readUInt16LE(dir + 28);
    const copy = Buffer.from(book);
    copy.writeUInt32LE(0, second + 42);
    expect(await rejectionOf(copy)).toBe("CORRUPTED");
  });
});

describe("ceilings of a statement file (IMP-01@PoC FR 13)", () => {
  it("IMP-01@PoC AC2: 25 001 rows are refused naming the 20 000-row ceiling and advising to split, without plan hints", async () => {
    const rows = Array.from({ length: 25_001 }, (_, i) => [`2026-10-01`, `${i}.00`, "Синтетика"]);
    for (const file of [csv(rows), xlsx({ sheetData: sheetXml(rows) })]) {
      const err = await inspectFile(file).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FileRejectedError);
      const { rejection } = err as FileRejectedError;
      expect(rejection.code).toBe("TOO_MANY_ROWS");
      expect(rejection.ceiling).toEqual({ name: "rows", limit: 20_000 });
      expect(rejection.message.uk).toContain("20 000");
      expect(rejection.message.uk).toContain("Розділіть файл");
      expect(rejection.message.uk).not.toMatch(/план|тариф|Plus|Family/i);
      expect(rejection.message.en).not.toMatch(/plan|upgrade/i);
    }
    const xlsRows = Array.from({ length: 20_001 }, (_, i) => [i]);
    expect(await rejectionOf(xls({ sheets: [xlsRows] }))).toBe("TOO_MANY_ROWS");
    await expect(inspectFile(csv(rows.slice(0, 20_000)))).resolves.toMatchObject({ rows: 20_000 });
  }, 60_000);

  it("IMP-01@PoC FR 13: more than 2 million cells and more than 20 XLS sheets are refused", async () => {
    const wide = Array.from({ length: 19_900 }, () => Array.from({ length: 101 }, () => "1"));
    expect(await rejectionOf(csv(wide))).toBe("TOO_MANY_CELLS");
    const sheets = Array.from({ length: 21 }, () => [[1]]);
    expect(await rejectionOf(xls({ sheets }))).toBe("TOO_MANY_SHEETS");
    await expect(inspectFile(xls({ sheets: sheets.slice(0, 20) }))).resolves.toMatchObject({ sheets: 20 });
  }, 60_000);
});
