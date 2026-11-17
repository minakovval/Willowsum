// Security review of PR #496 (IMP-01@PoC a, file-storage): books with macros, external links or DDE that the type
// check accepts because it trusts conventional part names, double-quoted attributes and the order of records.
// Synthetic files only. Each test was an `it.fails` on the reviewed head; the fix round made them pass.
import { describe, expect, it } from "vitest";
import { FileRejectedError, type RejectionCode } from "../src/modules/file-storage/domain/index.ts";
import { inspectFile } from "../src/modules/file-storage/adapters/inspection/inspect.ts";
import {
  cfb,
  sheetXml,
  STATEMENT_ROWS,
  workbookStream,
  xls,
  xlsx,
  zip,
} from "../src/modules/file-storage/synthetic-files.ts";

async function outcome(bytes: Buffer): Promise<RejectionCode | "accepted"> {
  try {
    await inspectFile(bytes);
    return "accepted";
  } catch (error) {
    if (error instanceof FileRejectedError) return error.code;
    throw error;
  }
}

const NS = "http://schemas.openxmlformats.org";
const WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const SHEET_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const sheet = (data: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`;

/** A book whose content types are written by hand: `types` is the inside of `<Types>`. */
function book(types: string, parts: { name: string; data: string | Buffer }[] = []): Buffer {
  return zip(zipParts(types, parts));
}
function zipParts(types: string, parts: { name: string; data: string | Buffer }[] = []) {
  return [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${NS}/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>${types}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0"?><workbook xmlns="${NS}/spreadsheetml/2006/main"/>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet(sheetXml(STATEMENT_ROWS)) },
    ...parts,
  ];
}
const plain =
  `<Override PartName="/xl/workbook.xml" ContentType="${SHEET_MAIN}"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET}"/>`;
// A VBA project is a compound file whatever its part is called.
const vba = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);

describe("sec496: XLSX with macros, links or DDE under unconventional spellings (IMP-01@PoC FR 14, NFR-15@PoC FR 18)", () => {
  it("control: the hand-written plain book is accepted", async () => {
    expect(await outcome(book(plain))).toBe("accepted");
  });

  it("IMP-01@PoC FR 14: an XLSM whose content types use single quotes and whose VBA part has another name is refused", async () => {
    const types =
      `<!-- <Override PartName="/xl/workbook.xml" ContentType="${SHEET_MAIN}"/> -->` +
      `<Override PartName='/xl/workbook.xml' ContentType='application/vnd.ms-excel.sheet.macroEnabled.main+xml'/>` +
      `<Override PartName='/xl/code.bin' ContentType='application/vnd.ms-office.vbaProject'/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET}"/>`;
    expect(await outcome(book(types, [{ name: "xl/code.bin", data: vba }]))).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: a VBA content type written with character references is refused", async () => {
    const types =
      plain + `<Override PartName="/xl/code.bin" ContentType="application/vnd.ms-office.vba&#80;roject"/>`;
    expect(await outcome(book(types, [{ name: "xl/code.bin", data: Buffer.from("synthetic") }]))).toBe(
      "UNSUPPORTED_FORMAT",
    );
  });

  it("IMP-01@PoC FR 14: a compound file (VBA project, OLE object) inside the package is refused whatever it is called", async () => {
    expect(await outcome(book(plain, [{ name: "xl/media/image1.bin", data: vba }]))).toBe(
      "UNSUPPORTED_FORMAT",
    );
  });

  it("IMP-01@PoC FR 14: two elements of one name (a second [Content_Types].xml) are refused", async () => {
    const macro =
      `<?xml version="1.0"?><Types xmlns="${NS}/package/2006/content-types">` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>` +
      `<Override PartName="/xl/code.dat" ContentType="application/vnd.ms-office.vbaProject"/></Types>`;
    const twice = zip([
      { name: "[Content_Types].xml", data: macro },
      { name: "xl/code.dat", data: Buffer.from("synthetic") },
      ...zipParts(plain),
    ]);
    expect(await outcome(twice)).not.toBe("accepted");
  });

  it("IMP-01@PoC FR 14: an Excel 4.0 macro sheet is refused", async () => {
    const types =
      plain +
      `<Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>`;
    expect(await outcome(book(types, [{ name: "xl/macrosheets/sheet1.xml", data: sheet("") }]))).toBe(
      "UNSUPPORTED_FORMAT",
    );
  });

  it("IMP-01@PoC FR 14: an external link (DDE) part outside xl/externalLinks/ is refused", async () => {
    const types =
      plain +
      `<Override PartName="/xl/links/l1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>`;
    const link = `<?xml version="1.0"?><externalLink xmlns="${NS}/spreadsheetml/2006/main"><ddeLink ddeService="cmd" ddeTopic="/c calc"/></externalLink>`;
    expect(await outcome(book(types, [{ name: "xl/links/l1.xml", data: link }]))).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 13, FR 14: a worksheet outside xl/worksheets/ is not skipped (DDE formula, 25 001 rows)", async () => {
    const types = plain + `<Override PartName="/xl/data/s2.xml" ContentType="${WORKSHEET}"/>`;
    const dde = sheet(`<row r="1"><c r="A1"><f>cmd|' /C calc'!A0</f></c></row>`);
    expect(await outcome(book(types, [{ name: "xl/data/s2.xml", data: dde }]))).not.toBe("accepted");
    const many = sheet(sheetXml(Array.from({ length: 25_001 }, (_, i) => [String(i)])));
    expect(await outcome(book(types, [{ name: "xl/data/s2.xml", data: many }]))).not.toBe("accepted");
  });

  it("IMP-01@PoC FR 14: XML in an encoding the check does not read (UTF-32, a declared code page) is refused", async () => {
    const dtd = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>`;
    const utf32 = Buffer.concat([
      Buffer.from([0xff, 0xfe, 0, 0]),
      ...[...dtd].map((c) => Buffer.from([c.charCodeAt(0), 0, 0, 0])),
    ]);
    expect(await outcome(book(plain, [{ name: "xl/styles.xml", data: utf32 }]))).toBe("UNSUPPORTED_FORMAT");
    const ebcdic = `<?xml version="1.0" encoding="IBM037"?><styleSheet/>`;
    expect(await outcome(book(plain, [{ name: "xl/styles.xml", data: ebcdic }]))).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: an XML part under a non-XML name is still checked for DOCTYPE", async () => {
    const types =
      `<Override PartName="/xl/workbook.dat" ContentType="${SHEET_MAIN}"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET}"/>`;
    const dtd = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><workbook/>`;
    expect(await outcome(book(types, [{ name: "xl/workbook.dat", data: dtd }]))).toBe("UNSUPPORTED_FORMAT");
  });
});

function rec(type: number, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(body.length, 2);
  return Buffer.concat([head, body]);
}
function bof(kind: number): Buffer {
  const body = Buffer.alloc(16);
  body.writeUInt16LE(0x0600, 0);
  body.writeUInt16LE(kind, 2);
  return rec(0x0809, body);
}
function boundSheet(kind: number): Buffer {
  const body = Buffer.alloc(10);
  body[5] = kind;
  body[6] = 2;
  body.write("S1", 8, "latin1");
  return rec(0x0085, body);
}
function externalSupbook(): Buffer {
  const body = Buffer.alloc(12);
  body.writeUInt16LE(1, 0);
  body.writeUInt16LE(5, 2);
  return rec(0x01ae, body);
}
function cell(row: number): Buffer {
  const body = Buffer.alloc(14);
  body.writeUInt16LE(row, 0);
  body.writeDoubleLE(1, 6);
  return rec(0x0203, body);
}
const EOF = rec(0x000a);
const sheetStream = (kind = 0x0010) => Buffer.concat([bof(kind), cell(0), cell(1), EOF]);
function xlsOf(stream: Buffer, extra: { name: string; data?: Buffer }[] = []): Buffer {
  const data = Buffer.concat([stream, Buffer.alloc(Math.max(0, 4096 - stream.length))]);
  return cfb([...extra, { name: "Workbook", data }]);
}

describe("sec496: XLS with macros or links past where the record scan stops (IMP-01@PoC FR 14)", () => {
  it("control: the hand-written plain XLS is accepted, the same with a macro sheet is refused", async () => {
    expect(await outcome(xlsOf(Buffer.concat([bof(5), boundSheet(0), EOF, sheetStream()])))).toBe("accepted");
    expect(
      await outcome(xlsOf(Buffer.concat([bof(5), boundSheet(0), boundSheet(1), EOF, sheetStream()]))),
    ).toBe("UNSUPPORTED_FORMAT");
  });

  it("IMP-01@PoC FR 14: a stray BOF in the globals does not hide a macro sheet, an external link or FILEPASS", async () => {
    const hidden = (r: Buffer) =>
      xlsOf(Buffer.concat([bof(5), boundSheet(0), bof(5), cell(0), r, EOF, sheetStream()]));
    expect(await outcome(hidden(boundSheet(1)))).not.toBe("accepted");
    expect(await outcome(hidden(externalSupbook()))).not.toBe("accepted");
    expect(await outcome(hidden(rec(0x002f, Buffer.alloc(54))))).not.toBe("accepted");
  });

  it("IMP-01@PoC FR 14: a sheet whose own BOF says macro sheet or VBA module is refused", async () => {
    for (const kind of [0x0040, 0x0006])
      expect(await outcome(xlsOf(Buffer.concat([bof(5), boundSheet(0), EOF, sheetStream(kind)])))).toBe(
        "UNSUPPORTED_FORMAT",
      );
  });

  it("IMP-01@PoC FR 14: a second «Workbook» stream is not left unchecked", async () => {
    const clean = workbookStream();
    const macro = Buffer.concat([bof(5), boundSheet(0), boundSheet(1), EOF, sheetStream(), sheetStream()]);
    const pad = (s: Buffer) => Buffer.concat([s, Buffer.alloc(Math.max(0, 4096 - s.length))]);
    expect(
      await outcome(
        cfb([
          { name: "Workbook", data: pad(clean) },
          { name: "Workbook", data: pad(macro) },
        ]),
      ),
    ).not.toBe("accepted");
  });

  it("control: the module's own synthetic books keep their outcome", async () => {
    expect(await outcome(xlsx())).toBe("accepted");
    expect(await outcome(xls())).toBe("accepted");
    expect(await outcome(xls({ sheets: [[[1]], [[2]]] }))).toBe("accepted");
  });
});
