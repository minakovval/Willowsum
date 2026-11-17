// The refused and accepted files of ARC-06@PoC's criterion «Файл недозволеного типу у сховищі», shared by the tests
// on the test object storage and on a local S3-compatible storage. Synthetic only.
import { randomBytes } from "node:crypto";
import type { RejectionCode } from "./domain/index.ts";
import {
  cfb,
  csv,
  docx,
  executable,
  html,
  pdf,
  STATEMENT_ROWS,
  xls,
  XLSM_MAIN,
  xlsx,
  zip,
} from "./synthetic-files.ts";

export interface RejectedCase {
  readonly label: string;
  readonly bytes: Buffer;
  readonly fileName: string;
  /** A declared request length instead of the file's own (the request over 150 MiB). */
  readonly declared?: number;
  readonly code: RejectionCode;
}

export function rejectedFiles(): RejectedCase[] {
  const runs = Buffer.alloc(8 * 1024 * 1024);
  for (let at = 0; at < runs.length; at += 64) runs.fill(randomBytes(1)[0]!, at, at + 64);
  const many = Array.from({ length: 1001 }, (_, i) => ({ name: `xl/media/${i}.txt`, data: "a" }));
  return [
    {
      label: "ZIP",
      bytes: zip([{ name: "a.csv", data: csv() }]),
      fileName: "a.csv",
      code: "UNSUPPORTED_FORMAT",
    },
    { label: "DOCX", bytes: docx(), fileName: "a.xlsx", code: "UNSUPPORTED_FORMAT" },
    { label: "PDF", bytes: pdf(), fileName: "a.csv", code: "UNSUPPORTED_FORMAT" },
    { label: "HTML", bytes: html(), fileName: "a.csv", code: "UNSUPPORTED_FORMAT" },
    { label: "executable", bytes: executable(), fileName: "a.xls", code: "UNSUPPORTED_FORMAT" },
    {
      label: "XLSM named .xlsx",
      bytes: xlsx({ main: XLSM_MAIN, vbaProject: true }),
      fileName: "a.xlsx",
      code: "UNSUPPORTED_FORMAT",
    },
    {
      label: "XLS with VBA",
      bytes: xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] }),
      fileName: "a.xls",
      code: "UNSUPPORTED_FORMAT",
    },
    {
      label: "Excel 5/95",
      bytes: xls({ streamName: "Book", version: 0x0500 }),
      fileName: "a.xls",
      code: "UNSUPPORTED_FORMAT",
    },
    { label: "encrypted XLS", bytes: xls({ filePass: true }), fileName: "a.xls", code: "ENCRYPTED" },
    {
      label: "encrypted XLSX",
      bytes: cfb([
        { name: "EncryptionInfo", data: randomBytes(300) },
        { name: "EncryptedPackage", data: randomBytes(5000) },
      ]),
      fileName: "a.xlsx",
      code: "ENCRYPTED",
    },
    {
      label: "ZIP over 200 MiB unpacked",
      bytes: xlsx({
        extraParts: Array.from({ length: 26 }, (_, i) => ({ name: `xl/media/p${i}.xml`, data: runs })),
      }),
      fileName: "a.xlsx",
      code: "ARCHIVE_LIMIT",
    },
    {
      label: "ZIP element over 100:1",
      bytes: xlsx({ extraParts: [{ name: "xl/styles.xml", data: Buffer.alloc(1024 * 1024, 0x20) }] }),
      fileName: "a.xlsx",
      code: "ARCHIVE_LIMIT",
    },
    {
      label: "ZIP over 1 000 elements",
      bytes: xlsx({ extraParts: many }),
      fileName: "a.xlsx",
      code: "ARCHIVE_LIMIT",
    },
    {
      label: "request over 150 MiB",
      bytes: csv(),
      fileName: "a.csv",
      declared: 150 * 1024 * 1024 + 1,
      code: "REQUEST_TOO_LARGE",
    },
  ];
}

export function acceptedFiles(): { format: string; bytes: Buffer; fileName: string }[] {
  return [
    { format: "csv", bytes: csv(), fileName: "statement.csv" },
    { format: "tsv", bytes: csv(STATEMENT_ROWS, "\t"), fileName: "statement.tsv" },
    { format: "xlsx", bytes: xlsx(), fileName: "statement.xlsx" },
    { format: "xls", bytes: xls(), fileName: "statement.xls" },
  ];
}
