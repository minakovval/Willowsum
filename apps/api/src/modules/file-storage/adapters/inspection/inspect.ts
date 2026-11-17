import { isCfb, readCfb, type Cfb } from "./cfb.ts";
import { PARSE_CEILINGS, reject } from "../../domain/index.ts";
import { isZip, unpackZip } from "./zip.ts";

/**
 * The type check of an uploaded file by its content, never its name (ARC-06@PoC FR 4, NFR-15@PoC FR 18, IMP-01@PoC
 * FR 3, FR 13, FR 14). Without an antivirus in this release only CSV (TSV is CSV with tabs), XLSX without macros and
 * XLS (Excel 97–2003) without VBA or macros are accepted; anything else is refused before it is stored (closed by
 * default). Books with external links, DDE, embedded objects, XML with DOCTYPE or ENTITY, encrypted books and
 * Excel 5/95 are refused before any cell is read; the ceilings of rows, cells and XLS sheets are counted in the same
 * pass. Runs inside the parsing worker (isolation), never in the API's own thread.
 */
export const FILE_FORMATS = ["csv", "tsv", "xlsx", "xls"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** The type a stored file is served with, by its content (ARC-06 FR 4). */
export const CONTENT_TYPES: { readonly [F in FileFormat]: string } = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

export interface Inspection {
  readonly format: FileFormat;
  readonly contentType: string;
  /** Non-empty records of all sheets (a header too). */
  readonly rows: number;
  readonly cells: number;
  /** Sheets of a book; 1 for CSV. */
  readonly sheets: number;
}

export interface Ceilings {
  readonly rows: number;
  readonly cells: number;
  readonly xlsSheets: number;
}

export async function inspectFile(bytes: Buffer, ceilings: Ceilings = PARSE_CEILINGS): Promise<Inspection> {
  if (bytes.length === 0) return reject("NO_TRANSACTIONS");
  const counted = isZip(bytes)
    ? await inspectXlsx(bytes, ceilings)
    : isCfb(bytes)
      ? inspectXls(bytes, ceilings)
      : inspectText(bytes, ceilings);
  if (counted.rows > ceilings.rows) reject("TOO_MANY_ROWS");
  if (counted.cells > ceilings.cells) reject("TOO_MANY_CELLS");
  if (counted.rows === 0) reject("NO_TRANSACTIONS");
  return { ...counted, contentType: CONTENT_TYPES[counted.format] };
}

// ---------------------------------------------------------------- XLSX

const MAIN_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const XML_PART_RE = /\.(xml|rels|vml)$/i;
const SHEET_RE = /^xl\/worksheets\/[^/]+\.xml$/i;
const FORBIDDEN_PART_RE = /(^|\/)vbaproject\.bin$|^xl\/(externallinks|embeddings|activex)\//i;
const DTD_RE = /<!(DOCTYPE|ENTITY)/i;
const CONTENT_TYPE_ATTR_RE = /ContentType\s*=\s*"([^"]*)"/g;
// A DDE formula: application|topic!item.
const DDE_RE = /<f\b[^>]*>[^<]*[A-Za-z0-9_]\|[^<]*![^<]*<\/f>/;

function xmlText(part: Buffer): string {
  if (part.length >= 2 && part[0] === 0xff && part[1] === 0xfe) return part.toString("utf16le", 2);
  if (part.length >= 2 && part[0] === 0xfe && part[1] === 0xff) {
    const swapped = Buffer.from(part.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return part.toString("utf8");
}

function count(text: string, re: RegExp): number {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(text)) n++;
  return n;
}

async function inspectXlsx(bytes: Buffer, ceilings: Ceilings): Promise<Omit<Inspection, "contentType">> {
  const { entries, parts } = await unpackZip(
    bytes,
    (name) => XML_PART_RE.test(name) || name === "[Content_Types].xml",
  );
  if (entries.some((e) => FORBIDDEN_PART_RE.test(e.name))) reject("UNSUPPORTED_FORMAT");
  const contentTypes = parts.get("[Content_Types].xml");
  if (!contentTypes) return reject("UNSUPPORTED_FORMAT");
  for (const part of parts.values()) if (DTD_RE.test(xmlText(part))) reject("UNSUPPORTED_FORMAT");
  const types = xmlText(contentTypes);
  const declared = [...types.matchAll(CONTENT_TYPE_ATTR_RE)].map((m) => m[1]!);
  if (declared.some((t) => /macroEnabled|vbaProject/i.test(t))) reject("UNSUPPORTED_FORMAT");
  const main = /<Override\b[^>]*>/g;
  let mainPart: string | undefined;
  for (const m of types.matchAll(main)) {
    if (m[0].includes(`"${MAIN_SHEET}"`)) mainPart = /PartName\s*=\s*"\/?([^"]*)"/.exec(m[0])?.[1];
  }
  if (mainPart === undefined) reject("UNSUPPORTED_FORMAT");
  if (!entries.some((e) => e.name === mainPart)) reject("CORRUPTED");
  let rows = 0;
  let cells = 0;
  let sheets = 0;
  for (const [name, part] of parts) {
    if (!SHEET_RE.test(name)) continue;
    const xml = xmlText(part);
    if (DDE_RE.test(xml)) reject("UNSUPPORTED_FORMAT");
    sheets++;
    rows += count(xml, /<row\b[^>]*>(?!\s*<\/row>)/g);
    cells += count(xml, /<c\b/g);
    if (rows > ceilings.rows) reject("TOO_MANY_ROWS");
    if (cells > ceilings.cells) reject("TOO_MANY_CELLS");
  }
  return { format: "xlsx", rows, cells, sheets };
}

// ---------------------------------------------------------------- XLS

const ENCRYPTED_STREAMS = new Set(["encryptioninfo", "encryptedpackage"]);
const MACRO_ENTRIES = new Set(["_vba_project_cur", "_vba_project", "vba", "macros", "_xlfn"]);
// MBD… storages and the ObjectPool hold embedded objects; «\u0001Ole10Native» is an embedded file.
const EMBEDDED_NAME = (name: string) =>
  /^(mbd[0-9a-f]*|objectpool)$/.test(name) || name === String.fromCharCode(1) + "ole10native";

const BOF = 0x0809;
const EOF = 0x000a;
const FILEPASS = 0x002f;
const BOUNDSHEET = 0x0085;
const SUPBOOK = 0x01ae;
const SINGLE_CELLS = new Set([0x0203, 0x027e, 0x00fd, 0x0204, 0x0201, 0x0205, 0x0006, 0x00d6]);
const MULRK = 0x00bd;
const MULBLANK = 0x00be;

function inspectXls(bytes: Buffer, ceilings: Ceilings): Omit<Inspection, "contentType"> {
  const cfb: Cfb = readCfb(bytes);
  const names = cfb.entries.map((e) => e.name.toLowerCase());
  if (names.some((n) => ENCRYPTED_STREAMS.has(n))) reject("ENCRYPTED");
  if (names.some((n) => MACRO_ENTRIES.has(n) || EMBEDDED_NAME(n))) reject("UNSUPPORTED_FORMAT");
  const workbook = cfb.entries.find((e) => e.type === 2 && e.name.toLowerCase() === "workbook");
  // «Book» without «Workbook» is Excel 5/95 or older; neither is another kind of compound file (DOC, MSG).
  if (!workbook) return reject("UNSUPPORTED_FORMAT");
  const s = cfb.stream(workbook);
  if (
    s.length < 12 ||
    s.readUInt16LE(0) !== BOF ||
    s.readUInt16LE(4) !== 0x0600 ||
    s.readUInt16LE(6) !== 0x0005
  )
    reject("UNSUPPORTED_FORMAT");
  let sheets = 0;
  let cells = 0;
  let substream = -1;
  const rows = new Set<number>();
  let at = 0;
  while (at + 4 <= s.length) {
    const type = s.readUInt16LE(at);
    const length = s.readUInt16LE(at + 2);
    const body = at + 4;
    if (body + length > s.length) reject("CORRUPTED");
    if (type === BOF) substream++;
    else if (type === FILEPASS && substream === 0) reject("ENCRYPTED");
    else if (type === BOUNDSHEET && substream === 0) {
      if (length < 8) reject("CORRUPTED");
      const kind = s[body + 5];
      if (kind === 0x01 || kind === 0x06) reject("UNSUPPORTED_FORMAT");
      sheets++;
      if (sheets > ceilings.xlsSheets) reject("TOO_MANY_SHEETS");
    } else if (type === SUPBOOK && substream === 0) {
      if (length < 4) reject("CORRUPTED");
      const marker = s.readUInt16LE(body + 2);
      // Only the book's own references (0x0401) and add-in functions (0x3A01); any other is an external link or DDE.
      if (marker !== 0x0401 && marker !== 0x3a01) reject("UNSUPPORTED_FORMAT");
    } else if (substream > 0 && length >= 2) {
      let n = 0;
      if (SINGLE_CELLS.has(type)) n = 1;
      else if (type === MULRK && length >= 6) n = Math.floor((length - 6) / 6);
      else if (type === MULBLANK && length >= 6) n = Math.floor((length - 6) / 2);
      if (n > 0) {
        cells += n;
        rows.add(substream * 65536 + s.readUInt16LE(body));
        if (cells > ceilings.cells) reject("TOO_MANY_CELLS");
        if (rows.size > ceilings.rows) reject("TOO_MANY_ROWS");
      }
    }
    if (type === 0 && length === 0) break; // padding after the last record
    at = body + length;
    if (type === EOF && substream >= sheets) break;
  }
  if (sheets === 0) reject("CORRUPTED");
  return { format: "xls", rows: rows.size, cells, sheets };
}

// ---------------------------------------------------------------- CSV and TSV

const DELIMITERS = ["\t", ",", ";", "|"] as const;
const TEXT_LOOKALIKES_RE = /^(<|%PDF-|\{\\rtf)/i;

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function inspectText(bytes: Buffer, ceilings: Ceilings): Omit<Inspection, "contentType"> {
  // UTF-16 and other encodings with NUL bytes are not CSV here (lead's decision 2026-11-17: UTF-8 or a single-byte
  // code page such as Windows-1251, which is what banks export).
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) reject("UNSUPPORTED_FORMAT");
  }
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const text = isUtf8(body) ? body.toString("utf8") : body.toString("latin1");
  const trimmed = text.trimStart();
  if (trimmed.trim() === "") reject("NO_TRANSACTIONS");
  if (TEXT_LOOKALIKES_RE.test(trimmed)) reject("UNSUPPORTED_FORMAT");
  const firstLine = trimmed.split(/\r\n|\n|\r/, 1)[0]!;
  const counts = DELIMITERS.map((d) => firstLine.split(d).length - 1);
  const best = Math.max(...counts);
  if (best === 0) reject("UNSUPPORTED_FORMAT");
  const delimiter = DELIMITERS[counts.indexOf(best)]!;
  const { rows, cells } = countRecords(text, delimiter, ceilings);
  return { format: delimiter === "\t" ? "tsv" : "csv", rows, cells, sheets: 1 };
}

/** Records and fields of delimited text (RFC 4180 quotes); empty records are not counted. */
function countRecords(text: string, delimiter: string, ceilings: Ceilings): { rows: number; cells: number } {
  let rows = 0;
  let cells = 0;
  let fields = 1;
  let content = false;
  let quoted = false;
  const endRecord = () => {
    if (content) {
      rows++;
      cells += fields;
      if (rows > ceilings.rows) reject("TOO_MANY_ROWS");
      if (cells > ceilings.cells) reject("TOO_MANY_CELLS");
    }
    fields = 1;
    content = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      content = true;
    } else if (ch === delimiter) {
      fields++;
      content = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else if (ch !== " " && ch !== "\t") content = true;
  }
  endRecord();
  return { rows, cells };
}
