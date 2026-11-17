import { FILE_LIMITS, PARSE_CEILINGS } from "./limits.ts";

/**
 * Why a file was not accepted (ARC-06@PoC FR 4, NFR-15@PoC FR 18, FR 31, IMP-01@PoC FR 13–15). A rejection is decided
 * before anything is stored: a rejected file leaves no object in the storage and no row in the database. The texts are
 * IMP-01 FR 15's; a ceiling's text names the ceiling and advises splitting the file, never the plan.
 */
export const REJECTION_CODES = [
  "UNSUPPORTED_FORMAT",
  "ENCRYPTED",
  "CORRUPTED",
  "NO_TRANSACTIONS",
  "FILE_TOO_LARGE",
  "REQUEST_TOO_LARGE",
  "ARCHIVE_LIMIT",
  "TOO_MANY_ROWS",
  "TOO_MANY_CELLS",
  "TOO_MANY_SHEETS",
  "PARSE_TIMEOUT",
  "PARSE_MEMORY",
  "SPACE_STORAGE_LIMIT",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface Rejection {
  readonly code: RejectionCode;
  /** 413 for sizes of the request and the space's storage, 422 for the content. */
  readonly status: 413 | 422;
  /** The ceiling that was exceeded, for the message (IMP-01 FR 13); never a plan's limit. */
  readonly ceiling?: { readonly name: string; readonly limit: number };
  readonly message: { readonly uk: string; readonly en: string };
}

const SPLIT_UK = " Розділіть файл, наприклад за періодом, і завантажте частини.";
const SPLIT_EN = " Split the file, for example by period, and upload the parts.";

const UNSUPPORTED = { uk: "Формат не підтримується", en: "This format is not supported" };

function ceiling(name: string, limit: number, uk: string, en: string, status: 413 | 422 = 422) {
  return { status, ceiling: { name, limit }, message: { uk: uk + SPLIT_UK, en: en + SPLIT_EN } } as const;
}

const REJECTIONS: { readonly [C in RejectionCode]: Omit<Rejection, "code"> } = {
  UNSUPPORTED_FORMAT: { status: 422, message: UNSUPPORTED },
  ENCRYPTED: {
    status: 422,
    message: {
      uk: "Файл зашифровано. Зніміть пароль і завантажте файл знову",
      en: "The file is encrypted. Remove the password and upload it again",
    },
  },
  CORRUPTED: { status: 422, message: { uk: "Файл пошкоджено", en: "The file is damaged" } },
  NO_TRANSACTIONS: {
    status: 422,
    message: { uk: "У файлі немає транзакцій", en: "The file has no transactions" },
  },
  FILE_TOO_LARGE: ceiling(
    "fileBytes",
    FILE_LIMITS.fileBytes,
    "Файл більший за 25 МБ.",
    "The file is larger than 25 MB.",
    413,
  ),
  REQUEST_TOO_LARGE: ceiling(
    "requestBytes",
    FILE_LIMITS.requestBytes,
    "Файли одного завантаження разом більші за 150 МБ.",
    "The files of one upload are larger than 150 MB together.",
    413,
  ),
  ARCHIVE_LIMIT: ceiling(
    "zipPackage",
    FILE_LIMITS.zipUnpackedBytes,
    "Книга після розпакування більша за 200 МБ, має понад 1 000 частин або стиснена понад 100:1.",
    "The book is larger than 200 MB unpacked, has over 1,000 parts or is compressed over 100:1.",
  ),
  TOO_MANY_ROWS: ceiling(
    "rows",
    PARSE_CEILINGS.rows,
    "Занадто багато рядків: у файлі може бути до 20 000 рядків.",
    "Too many rows: a file may have up to 20,000 rows.",
  ),
  TOO_MANY_CELLS: ceiling(
    "cells",
    PARSE_CEILINGS.cells,
    "Занадто багато клітинок: у файлі може бути до 2 млн клітинок.",
    "Too many cells: a file may have up to 2 million cells.",
  ),
  TOO_MANY_SHEETS: ceiling(
    "xlsSheets",
    PARSE_CEILINGS.xlsSheets,
    "Занадто багато аркушів: у книзі XLS може бути до 20 аркушів.",
    "Too many sheets: an XLS book may have up to 20 sheets.",
  ),
  PARSE_TIMEOUT: ceiling(
    "parseSeconds",
    PARSE_CEILINGS.timeoutMs / 1000,
    "Розбір триває занадто довго (понад 60 с).",
    "Parsing takes too long (over 60 s).",
  ),
  PARSE_MEMORY: ceiling(
    "parseMemoryMb",
    PARSE_CEILINGS.memoryMb,
    "Розбір файлу потребує понад 512 МБ пам'яті.",
    "Parsing the file needs over 512 MB of memory.",
  ),
  SPACE_STORAGE_LIMIT: {
    status: 413,
    ceiling: { name: "spaceBytes", limit: FILE_LIMITS.spaceBytes },
    message: {
      uk: "Досягнуто технічної межі сховища простору (100 ГБ)",
      en: "The space's storage has reached its technical limit (100 GB)",
    },
  },
};

export function rejection(code: RejectionCode): Rejection {
  return { code, ...REJECTIONS[code] };
}

/** A file was not accepted; nothing of it was stored. Its message never holds the file's content. */
export class FileRejectedError extends Error {
  readonly rejection: Rejection;

  constructor(code: RejectionCode) {
    super(`File rejected: ${code}`);
    this.name = "FileRejectedError";
    this.rejection = rejection(code);
  }

  get code(): RejectionCode {
    return this.rejection.code;
  }
}

export function reject(code: RejectionCode): never {
  throw new FileRejectedError(code);
}
