import { formatDateTime, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import type { BatchResult } from "./resultApi.ts";

/**
 * IMP-08@PoC c) (wave 2, row 138): the pure part of the step «Результат». Counts of rows of one kind are added up here
 * (whole numbers); no money is.
 */

/** FR 11: the three tiles. The engine's counts by outcome (IMP-04 FR 1–6) are grouped as the board names them. */
export interface Tiles {
  /** Rows written as new transactions, including a repeat in the file, a merge with a manual one and a «Можливий дубль». */
  readonly created: number;
  /** IMP-04 FR 6: a posted row replaced the «в обробці» one. */
  readonly replaced: number;
  /** IMP-04 FR 1, 3: «дубль» and «дубль — уже імпортовано»: nothing written. */
  readonly skipped: number;
}

const n = (counts: Readonly<Record<string, number>>, ...keys: string[]): number =>
  keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0);

export const tilesOf = (counts: BatchResult["result"]["counts"]): Tiles => ({
  created: n(counts, "import", "repeat", "merge", "possible-duplicate"),
  replaced: n(counts, "replace"),
  skipped: n(counts, "duplicate", "already-imported"),
});

/** The plural form of a count in the user's language (uk: one, few, many; the keys end `.one`, `.few`, `.many`, `.other`). */
export function plural(t: Translate, locale: string, base: string, count: number, shown?: string): string {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en-GB").select(count);
  const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count: shown ?? count });
}

/** One row the apply refused: the file it is in (a name, or `null` for the whole batch), its number, the engine's issue code. */
export interface RefusedRow {
  readonly fileId: string | null;
  readonly row: number | null;
  readonly issue: string;
}

const PATH = /^files\[([^\]]+)\](?:\.rows\[(\d+)\])?$/;

/** `IMPORT_ROWS_REFUSED` carries `errors: [{ path: "files[<id>].rows[<n>]", issue }]` — codes and numbers only (IMP-01 FR 11). */
export function refusedRows(errors: readonly { path: string; issue: string }[] | undefined): RefusedRow[] {
  return (errors ?? []).map((e) => {
    const m = PATH.exec(e.path);
    return m
      ? { fileId: m[1]!, row: m[2] === undefined ? null : Number(m[2]), issue: e.issue }
      : { fileId: null, row: null, issue: e.issue };
  });
}

/** When the batch was applied, in the browser's time zone; the raw text when it cannot be formatted. */
export function whenText(locale: Locale, instant: string): string {
  try {
    return formatDateTime(locale, instant, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return instant;
  }
}

/** IMP-04 FR 8: the rollback is open until `rollbackUntil` (7 days after the apply); the API gives the moment. */
export const canRollback = (batch: BatchResult["batch"], now: number): boolean =>
  batch.state === "applied" && batch.rollbackUntil !== null && Date.parse(batch.rollbackUntil) > now;
