import type { BatchState } from "./batch.ts";

/**
 * The parse step's own rules (IMP-01@PoC FR 5, FR 6, FR 10, FR 13, FR 15; IMP-19@PoC FR 3–5): the state of each file's
 * parse, the batch's state once every file is done, and the technical ceiling of parse requests. Pure.
 */
export const PARSE_STATES = ["pending", "parsed", "failed"] as const;
export type ParseState = (typeof PARSE_STATES)[number];

/**
 * The batches a parse may start from: a new one, or one parsed again (FR 21 «повторний розбір») — a batch whose every file
 * was refused too, so a refusal that asks to parse again (`ACCOUNT_BINDING`: save the recipe again) can be followed in the
 * same batch. A failed batch with no accepted file has nothing to parse (409).
 */
const PARSES_FROM: ReadonlySet<BatchState> = new Set(["uploaded", "parsed", "needs-review", "failed"]);

export function takesParse(state: BatchState): boolean {
  return PARSES_FROM.has(state);
}

/**
 * The batch's state once no file is pending (FR 6, FR 10, IMP-19 FR 5): every accepted file refused — «не вдалося
 * розібрати»; any file refused, or any parsed file with something to review — «потребує перегляду»; else «розібрано».
 * Null while a file is still pending.
 */
export function batchStateAfterParse(
  files: readonly { readonly state: ParseState; readonly needsReview: boolean }[],
): BatchState | null {
  if (files.length === 0 || files.some((f) => f.state === "pending")) return null;
  if (files.every((f) => f.state === "failed")) return "failed";
  return files.some((f) => f.state === "failed" || f.needsReview) ? "needs-review" : "parsed";
}

/**
 * Parse requests of a space in an hour (#624: `account.status` answers a yes/no question about the recipe's sealed
 * value for each parsed file, so its rate is bounded): four full batches. A technical ceiling, the same for every plan
 * (never 402).
 */
export const PARSE_FILES_PER_HOUR = 200;

/**
 * Why a file of the batch could not be parsed, beyond file-storage's codes (IMP-01 FR 15: the reason in plain words).
 * `ACCOUNT_BINDING`: the recipe's account value could not be opened (fails closed); `FORMAT_NOT_PARSED`: an Excel book —
 * its reader is a later part; `FILE_MISSING`: the original is gone.
 */
export const PARSE_REFUSALS = {
  ACCOUNT_BINDING: {
    status: 422,
    message: {
      uk: "Не вдалося перевірити рахунок за рецептом. Збережіть рецепт ще раз і повторіть розбір.",
      en: "The recipe's account could not be checked. Save the recipe again and parse the file again.",
    },
  },
  FORMAT_NOT_PARSED: {
    status: 422,
    message: {
      uk: "Книги Excel поки не розбираються. Збережіть аркуш як CSV і завантажте його.",
      en: "Excel books are not parsed yet. Save the sheet as CSV and upload it.",
    },
  },
  FILE_MISSING: {
    status: 422,
    message: {
      uk: "Оригінал файлу не знайдено. Завантажте файл ще раз.",
      en: "The file's original is not found. Upload the file again.",
    },
  },
} as const;
export type ParseRefusalCode = keyof typeof PARSE_REFUSALS;
