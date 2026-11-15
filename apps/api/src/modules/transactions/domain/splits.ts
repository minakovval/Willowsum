import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import { parseSignedAmount, type FieldIssue } from "./transactions.ts";

/**
 * «Розділити» (BUD-01@PoC FR 6, BUD-13@PoC FR 6–8; FIN-03@PoC FR 23), pure. A split changes only how the budget and
 * the reports see a transaction: never its amount, its date, its journal event or the account's balance.
 *
 * - «За категоріями»: 2–20 parts, each with a category and a signed amount of the transaction's sign and currency, at
 *   most the currency's minor units; the parts sum to exactly the transaction's amount.
 * - «На кілька місяців»: one category, «Починаючи з» a month, «Місяців» 2–60; equal shares rounded towards zero to the
 *   currency's minor units, the rounding remainder in the last share (BUD-13 FR 6, AC5, AC8, edge case 2).
 */

export const SPLIT_MODES = ["categories", "months"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];
export const CATEGORY_PARTS_MIN = 2;
export const CATEGORY_PARTS_MAX = 20;
export const SPLIT_MONTHS_MIN = 2;
export const SPLIT_MONTHS_MAX = 60;

export interface SplitPart {
  readonly categoryId: string;
  /** «На кілька місяців»: the first day of the share's month (YYYY-MM-01); null for «За категоріями». */
  readonly month: string | null;
  readonly amount: Money;
}

export interface Split {
  readonly mode: SplitMode;
  /** In order: «Категорія» of the list shows the first part (FIN-03 FR 23). */
  readonly parts: readonly SplitPart[];
  /** BUD-01 FR 6: the transaction's amount changed after the split; it still holds and waits for the user's review. */
  readonly needsReview: boolean;
}

export type SplitInput =
  | {
      readonly mode: "categories";
      readonly parts: readonly { readonly categoryId: string; readonly amount: string }[];
    }
  | {
      readonly mode: "months";
      /** YYYY-MM. */
      readonly startMonth: string;
      readonly months: number;
      readonly categoryId: string;
    };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The first day of the month `k` months after `start` (YYYY-MM). */
export function monthAfter(start: string, k: number): string {
  const m = MONTH_RE.exec(start)!;
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + k;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** BUD-13 FR 6: equal shares towards zero to the minor unit, the remainder in the last; null if a share would be 0. */
export function monthShares(amount: Money, months: number): Money[] | null {
  const minor = currencyInfo(amount.currency).minorUnits;
  const share = Money.of(
    amount.amount.div(new Decimal(String(months))).toDecimalPlaces(minor, Decimal.ROUND_DOWN),
    amount.currency,
  );
  if (share.isZero()) return null;
  let rest = amount;
  const shares: Money[] = [];
  for (let k = 0; k < months - 1; k++) {
    shares.push(share);
    rest = rest.minus(share);
  }
  shares.push(rest);
  return shares;
}

export type SplitProblem = FieldIssue;

/**
 * The parts of a split of `amount` (a transaction's signed amount), or what is wrong. The categories are checked by
 * the caller against the space's tree. An empty «За категоріями» is no split: `null` (BUD-01 FR 6: it cancels the split).
 */
export function buildSplit(
  amount: Money,
  input: SplitInput,
): { readonly split: Omit<Split, "needsReview"> | null } | { readonly problems: SplitProblem[] } {
  if (input.mode === "months") {
    const problems: SplitProblem[] = [];
    if (!MONTH_RE.exec(input.startMonth) || input.startMonth < "1900-01")
      problems.push({ field: "startMonth", issue: "invalid" });
    if (!Number.isInteger(input.months) || input.months < SPLIT_MONTHS_MIN || input.months > SPLIT_MONTHS_MAX)
      problems.push({ field: "months", issue: "count" });
    if (problems.length > 0) return { problems };
    const shares = monthShares(amount, input.months);
    // A share below one minor unit (0,01 € on 3 months) would be 0: no split of that.
    if (shares === null) return { problems: [{ field: "months", issue: "count" }] };
    return {
      split: {
        mode: "months",
        parts: shares.map((share, k) => ({
          categoryId: input.categoryId,
          month: monthAfter(input.startMonth, k),
          amount: share,
        })),
      },
    };
  }
  if (input.parts.length === 0) return { split: null };
  if (input.parts.length < CATEGORY_PARTS_MIN || input.parts.length > CATEGORY_PARTS_MAX)
    return { problems: [{ field: "parts", issue: "count" }] };
  const problems: SplitProblem[] = [];
  const parts: SplitPart[] = [];
  input.parts.forEach((p, i) => {
    const part = parseSignedAmount(p.amount, amount.currency);
    if (typeof part === "string") problems.push({ field: `parts.${i}.amount`, issue: part });
    else if (part.isNegative() !== amount.isNegative())
      problems.push({ field: `parts.${i}.amount`, issue: "sign" });
    else parts.push({ categoryId: p.categoryId, month: null, amount: part });
  });
  if (problems.length > 0) return { problems };
  const sum = parts.reduce((total, p) => total.plus(p.amount), Money.zero(amount.currency));
  if (!sum.equals(amount)) return { problems: [{ field: "parts", issue: "sum_mismatch" }] };
  return { split: { mode: "categories", parts } };
}

/** The categories a split input names, each once (checked against the space's tree before the change). */
export function splitCategoryIds(input: SplitInput): string[] {
  return input.mode === "months" ? [input.categoryId] : [...new Set(input.parts.map((p) => p.categoryId))];
}

/** The type of category a part may have: an expense's parts are expense categories, an income's income ones. */
export function partCategoryKind(amount: Money): "expense" | "income" {
  return amount.isNegative() ? "expense" : "income";
}

/**
 * The split as fields of the audit entry (FIN-03 FR 20, BUD-13 «зміни атрибутів»): the mode, then one field per part
 * («<category> <amount>»; a month's share also its month) — each value within the audit log's 1 000 characters.
 */
export function splitAuditFields(split: Split | null): Map<string, string> {
  const fields = new Map<string, string>();
  if (split === null) return fields;
  fields.set("split.mode", split.mode);
  if (split.needsReview) fields.set("split.needsReview", "true");
  split.parts.forEach((p, i) =>
    fields.set(
      `split.part.${i + 1}`,
      [p.month?.slice(0, 7), p.categoryId, p.amount.toDecimalString()].filter(Boolean).join(" "),
    ),
  );
  return fields;
}
