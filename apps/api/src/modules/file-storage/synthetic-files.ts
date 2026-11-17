// Synthetic files for the tests of file-storage (CICD-04: synthetic data only). Small writers of ZIP packages, XLSX
// books and Compound File (XLS) containers, so every accepted and refused kind of file is built from scratch here:
// no file from outside the repository, no real statement. Not used by the application.
import { crc32, deflateRawSync } from "node:zlib";

// ---------------------------------------------------------------- ZIP

export interface ZipPart {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** 8 deflate (default) or 0 stored. */
  readonly method?: 0 | 8;
  /** Overrides the sizes written in the directory (a lying package). */
  readonly declaredSize?: number;
}

export function zip(parts: readonly ZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const raw = Buffer.from(part.data);
    const method = part.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw, { level: 9 }) : raw;
    const name = Buffer.from(part.name, "utf8");
    const crc = crc32(raw);
    const size = part.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(record, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---------------------------------------------------------------- XLSX

export const SHEET_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
export const XLSM_MAIN = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export interface XlsxOptions {
  readonly rows?: readonly (readonly string[])[];
  readonly main?: string;
  readonly vbaProject?: boolean;
  readonly extraParts?: readonly ZipPart[];
  /** Raw XML of the first sheet's `<sheetData>`, instead of `rows`. */
  readonly sheetData?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function sheetXml(rows: readonly (readonly string[])[]): string {
  return rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells.map((c) => `<c t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
}

export function xlsx(options: XlsxOptions = {}): Buffer {
  const rows = options.rows ?? STATEMENT_ROWS;
  const main = options.main ?? SHEET_MAIN;
  const types =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (options.vbaProject
      ? `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>`
      : "") +
    `<Override PartName="/xl/workbook.xml" ContentType="${main}"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;
  return zip([
    { name: "[Content_Types].xml", data: types },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Виписка" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${options.sheetData ?? sheetXml(rows)}</sheetData></worksheet>`,
    },
    ...(options.vbaProject
      ? [{ name: "xl/vbaProject.bin", data: Buffer.from("synthetic VBA project") }]
      : []),
    ...(options.extraParts ?? []),
  ]);
}

export function docx(): Buffer {
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="${DOCX_MAIN}"/></Types>`,
    },
    { name: "word/document.xml", data: `<?xml version="1.0"?><document/>` },
  ]);
}

// ---------------------------------------------------------------- Compound File (XLS)

export interface CfbItem {
  readonly name: string;
  /** A stream's bytes; absent for a storage. */
  readonly data?: Uint8Array;
}

const SECTOR = 512;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_MARK = 0xfffffffd;

/** A version 3 compound file with the items flat under the root; streams under 4 096 bytes go to the mini stream. */
export function cfb(items: readonly CfbItem[], options: { loopFat?: boolean } = {}): Buffer {
  const streams = items.map((item) => ({ item, big: item.data !== undefined && item.data.length >= 4096 }));
  const miniData: Buffer[] = [];
  const miniFat: number[] = [];
  const miniStart = new Map<CfbItem, number>();
  for (const { item, big } of streams) {
    if (!item.data || big || item.data.length === 0) continue;
    const count = Math.ceil(item.data.length / 64);
    miniStart.set(item, miniFat.length);
    for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? END : miniFat.length + 1);
    const padded = Buffer.alloc(count * 64);
    Buffer.from(item.data).copy(padded);
    miniData.push(padded);
  }
  const miniContainer = Buffer.concat(miniData);
  const sectorsOf = (bytes: number) => Math.ceil(bytes / SECTOR);
  const dirEntries = items.length + 1;
  const dirSectors = sectorsOf(dirEntries * 128);
  const miniFatSectors = sectorsOf(miniFat.length * 4);
  const containerSectors = sectorsOf(miniContainer.length);
  const bigSectors = streams.filter((s) => s.big).map((s) => sectorsOf(s.item.data!.length));
  const others = dirSectors + miniFatSectors + containerSectors + bigSectors.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * 128 < others + fatSectors) fatSectors++;
  const total = fatSectors + others;
  const fat = new Array<number>(fatSectors * 128).fill(FREE);
  let next = 0;
  const run = (count: number): number => {
    if (count === 0) return END;
    const start = next;
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1;
    next += count;
    return start;
  };
  for (let i = 0; i < fatSectors; i++) fat[next++] = FAT_MARK;
  const dirStart = run(dirSectors);
  const miniFatStart = run(miniFatSectors);
  const containerStart = run(containerSectors);
  const bigStart = new Map<CfbItem, number>();
  streams.forEach((s, i) => {
    if (s.big) bigStart.set(s.item, run(bigSectors[streams.filter((x) => x.big).indexOf(s)]!));
    void i;
  });
  if (options.loopFat) fat[dirStart + dirSectors - 1] = dirStart; // the directory's chain loops
  const out = Buffer.alloc(SECTOR + total * SECTOR);
  // Header.
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(out, 0);
  out.writeUInt16LE(0x003e, 24);
  out.writeUInt16LE(3, 26);
  out.writeUInt16LE(0xfffe, 28);
  out.writeUInt16LE(9, 30);
  out.writeUInt16LE(6, 32);
  out.writeUInt32LE(fatSectors, 44);
  out.writeUInt32LE(dirStart, 48);
  out.writeUInt32LE(4096, 56);
  out.writeUInt32LE(miniFatSectors ? miniFatStart : END, 60);
  out.writeUInt32LE(miniFatSectors, 64);
  out.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < fatSectors ? i : FREE, 76 + i * 4);
  const sectorOffset = (n: number) => SECTOR + n * SECTOR;
  fat.forEach((v, i) => out.writeUInt32LE(v, sectorOffset(Math.floor(i / 128)) + (i % 128) * 4));
  // Directory.
  const entry = (index: number, name: string, type: number, start: number, size: number, child: number) => {
    const at = sectorOffset(dirStart) + index * 128;
    const encoded = Buffer.from(name + "\u0000", "utf16le");
    encoded.copy(out, at);
    out.writeUInt16LE(encoded.length, at + 64);
    out[at + 66] = type;
    out[at + 67] = 1;
    out.writeUInt32LE(FREE, at + 68);
    out.writeUInt32LE(index > 0 && index < items.length ? index + 1 : FREE, at + 72);
    out.writeUInt32LE(child, at + 76);
    out.writeUInt32LE(start, at + 116);
    out.writeUInt32LE(size, at + 120);
  };
  entry(
    0,
    "Root Entry",
    5,
    containerSectors ? containerStart : END,
    miniContainer.length,
    items.length ? 1 : FREE,
  );
  items.forEach((item, i) => {
    const size = item.data?.length ?? 0;
    const start = item.data === undefined || size === 0 ? 0 : (bigStart.get(item) ?? miniStart.get(item)!);
    entry(i + 1, item.name, item.data === undefined ? 1 : 2, start, size, FREE);
  });
  miniFat.forEach((v, i) => out.writeUInt32LE(v, sectorOffset(miniFatStart) + i * 4));
  miniContainer.copy(out, sectorOffset(containerStart));
  for (const [item, start] of bigStart) Buffer.from(item.data!).copy(out, sectorOffset(start));
  return out;
}

// ---------------------------------------------------------------- BIFF8 workbook stream

function record(type: number, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(body.length, 2);
  return Buffer.concat([head, body]);
}

function bof(version: number, kind: number): Buffer {
  const body = Buffer.alloc(16);
  body.writeUInt16LE(version, 0);
  body.writeUInt16LE(kind, 2);
  return record(0x0809, body);
}

export interface WorkbookOptions {
  /** Numbers per sheet: rows of cells. */
  readonly sheets?: readonly (readonly (readonly number[])[])[];
  /** Sheet type per sheet (0 worksheet, 1 macro sheet, 6 VBA module). */
  readonly sheetKinds?: readonly number[];
  readonly filePass?: boolean;
  /** An external SUPBOOK (another book or DDE). */
  readonly externalLink?: boolean;
  readonly version?: 0x0600 | 0x0500;
}

export function workbookStream(options: WorkbookOptions = {}): Buffer {
  const sheets = options.sheets ?? [STATEMENT_NUMBERS];
  const version = options.version ?? 0x0600;
  const globals: Buffer[] = [bof(version, 0x0005)];
  if (options.filePass) globals.push(record(0x002f, Buffer.alloc(54)));
  sheets.forEach((_, i) => {
    const name = Buffer.from(`S${i + 1}`, "latin1");
    const body = Buffer.alloc(8 + name.length);
    body[5] = options.sheetKinds?.[i] ?? 0;
    body[6] = name.length;
    name.copy(body, 8);
    globals.push(record(0x0085, body));
  });
  if (options.externalLink) {
    const body = Buffer.alloc(12);
    body.writeUInt16LE(1, 0);
    body.writeUInt16LE(5, 2); // a path of 5 characters: another book
    body.write("\u0001Book", 5, "latin1");
    globals.push(record(0x01ae, body));
  } else {
    const body = Buffer.alloc(4);
    body.writeUInt16LE(sheets.length, 0);
    body.writeUInt16LE(0x0401, 2);
    globals.push(record(0x01ae, body));
  }
  globals.push(record(0x000a));
  const parts = sheets.map((rows) => {
    const cells: Buffer[] = [bof(version, 0x0010)];
    rows.forEach((row, r) =>
      row.forEach((value, c) => {
        const body = Buffer.alloc(14);
        body.writeUInt16LE(r, 0);
        body.writeUInt16LE(c, 2);
        body.writeDoubleLE(value, 6);
        cells.push(record(0x0203, body));
      }),
    );
    cells.push(record(0x000a));
    return Buffer.concat(cells);
  });
  return Buffer.concat([...globals, ...parts]);
}

/** An XLS book (Excel 97–2003) with the items it may carry besides «Workbook». */
export function xls(
  options: WorkbookOptions & { extra?: readonly CfbItem[]; streamName?: string } = {},
): Buffer {
  const stream = workbookStream(options);
  // Real books keep «Workbook» in normal sectors; pad so it is ≥ 4 096 bytes unless it is meant to be small.
  const data = stream.length >= 4096 ? stream : Buffer.concat([stream, Buffer.alloc(4096 - stream.length)]);
  return cfb([{ name: options.streamName ?? "Workbook", data }, ...(options.extra ?? [])]);
}

// ---------------------------------------------------------------- Statements and other contents

/** A synthetic statement: dates, amounts and descriptions of nobody. */
export const STATEMENT_ROWS: readonly (readonly string[])[] = [
  ["Дата", "Сума", "Опис"],
  ["2026-10-01", "-120.50", "Кав'ярня «Синтетика»"],
  ["2026-10-02", "2500.00", "Зарплата ТОВ «Вигадка»"],
];
const STATEMENT_NUMBERS: readonly (readonly number[])[] = [
  [46296, -120.5],
  [46297, 2500],
];

export function csv(rows = STATEMENT_ROWS, delimiter = ","): Buffer {
  return Buffer.from(rows.map((r) => r.join(delimiter)).join("\r\n") + "\r\n", "utf8");
}

/** The start of a Windows executable (DOS header, NUL bytes, PE signature). */
export function executable(): Buffer {
  const out = Buffer.alloc(512);
  out.write("MZ", 0, "latin1");
  out.writeUInt32LE(0x80, 0x3c);
  out.write("PE\u0000\u0000", 0x80, "latin1");
  return out;
}

export function pdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
    "latin1",
  );
}

export function html(): Buffer {
  return Buffer.from("<!doctype html><html><body><script>alert(1)</script>a,b,c</body></html>", "utf8");
}
