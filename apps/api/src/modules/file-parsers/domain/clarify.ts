import { currencyInfo, isCurrencyCode } from "@willowsum/domain-kernel";
import { ANALYSIS_LIMITS, type Role, type StatementAnalysis } from "./analysis.ts";
import type { StatementEvents } from "./events.ts";
import {
  dateCell,
  isAmbiguousInteger,
  numberCell,
  readDate,
  readNumber,
  type DateOrder,
  type DecimalSeparator,
} from "./values.ts";

/**
 * What the engine does not decide alone (IMP-05@PoC FR 7, FR 8, AC6, AC7): «потребує уточнення».
 * - An amount like «1.234» or «12,345» with no evidence in the file — no cell that only one decimal separator reads
 *   (the number decision is not flagged as assumed), no balance chain through the row, no currency rule — gets both
 *   readings (1,234 and 1 234). A reading with more decimals than the currency has is rejected (`readingFits`): when
 *   only one reading fits, the currency has settled it.
 * - An order of day and month that nothing settles (the date decision is flagged «порядок дати припущено») is one
 *   question for the file, with both readings of an example.
 * Remembering the answer and «застосувати до файлу» come with the batch's decisions (IMP-05 FR 10, import-sessions).
 */
export interface AmountReading {
  readonly decimal: DecimalSeparator;
  /** Decimal text: «1.234» or «1234». */
  readonly value: string;
}

export interface AmountClarification {
  readonly kind: "amount";
  readonly row: number;
  /** The cell as printed, cut to `ANALYSIS_LIMITS.exampleChars`. */
  readonly cell: string;
  readonly readings: readonly AmountReading[];
}

export interface DateOrderClarification {
  readonly kind: "date-order";
  /** Rows whose date reads differently under the two orders. */
  readonly rows: number;
  readonly example: {
    readonly cell: string;
    readonly readings: readonly { order: DateOrder; value: string }[];
  };
}

export type Clarification = AmountClarification | DateOrderClarification;

/** A reading the currency allows (FR 7, AC7): no more decimals than it has; any reading when it is not known. */
export function readingFits(value: string, currency: string | null): boolean {
  if (currency === null || !isCurrencyCode(currency)) return true;
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return scale <= currencyInfo(currency).minorUnits;
}

const clip = (cell: string): string => {
  const t = cell.trim();
  return t.length > ANALYSIS_LIMITS.exampleChars ? `${t.slice(0, ANALYSIS_LIMITS.exampleChars - 1)}…` : t;
};

export function clarifications(
  rows: readonly (readonly string[])[],
  analysis: StatementAnalysis,
  statement: StatementEvents,
  chainRows: ReadonlySet<number>,
): Clarification[] {
  const column = (role: Role): number =>
    analysis.columns.find((c) => c.role.chosen.value === role)?.column ?? 0;
  const out: Clarification[] = [];
  const assumed =
    analysis.numbers?.flags.some((f) => f === "ambiguous-integer" || f === "decimal-assumed") ?? false;
  if (assumed) {
    const amountColumns = (["amount", "debit", "credit"] as const).map(column).filter((c) => c > 0);
    for (const e of statement.events) {
      if (chainRows.has(e.row)) continue;
      const row = rows[e.row - 1] ?? [];
      for (const c of amountColumns) {
        const cell = row[c - 1] ?? "";
        const n = numberCell(cell);
        if (!n || !isAmbiguousInteger(n)) continue;
        const readings = (["," as const, "." as const] as const)
          .map((decimal) => ({ decimal, value: readNumber(n, decimal)?.value ?? null }))
          .filter((r): r is AmountReading => r.value !== null && readingFits(r.value, e.currency));
        if (readings.length === 2) out.push({ kind: "amount", row: e.row, cell: clip(cell), readings });
      }
    }
  }
  if (analysis.dates?.flags.includes("date-order-assumed")) {
    const c = column("date");
    const both = statement.events.flatMap((e) => {
      const text = (rows[e.row - 1] ?? [])[c - 1] ?? "";
      const d = c > 0 ? dateCell(text) : null;
      const dmy = d && readDate(d, "dmy");
      const mdy = d && readDate(d, "mdy");
      return dmy && mdy && dmy !== mdy ? [{ text, dmy, mdy }] : [];
    });
    if (both.length > 0)
      out.push({
        kind: "date-order",
        rows: both.length,
        example: {
          cell: clip(both[0]!.text),
          readings: [
            { order: "dmy", value: both[0]!.dmy },
            { order: "mdy", value: both[0]!.mdy },
          ],
        },
      });
  }
  return out;
}
