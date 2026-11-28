import { isCurrencyCode, Money } from "@willowsum/domain-kernel";
import {
  compareAcceptance,
  deriveSuggestions,
  type DerivationRow,
  type Orderable,
  type SuggestionCondition,
} from "./history-derivation.ts";
import { conditionKey, ruleMatches, type RuleCondition, type RuleMatcher } from "./rule.ts";

/**
 * The checks of the suggestions and their acceptance (BUD-21@PoC FR 18–20, FR 22, FR 23; wave 2 row 237). Pure: no
 * clock, no I/O; integers only (a share is a pair of counts, the client shows it as a percentage).
 */

/** FR 18: under this many rows with a category or a transfer mark the history is too short for the check. */
export const HISTORY_CHECK_MIN_ROWS = 50;
/** FR 19: the warning about descriptions needs at least this many transactions imported from statements. */
export const DESCRIPTIONS_CHECK_MIN = 50;

/** FR 18: the check on the history — the coverage (`covered` of `rows`) and the agreement (`agreeing` of `covered`). */
export type HistoryCheck =
  | {
      readonly status: "ready";
      /** The latest 20 % of the rows by date. */
      readonly rows: number;
      /** Of them, the rows a rule derived from the earlier 80 % gave a category. */
      readonly covered: number;
      /** Of the covered, the rows whose category is the user's. */
      readonly agreeing: number;
    }
  | { readonly status: "too_short"; readonly rows: number };

/** A suggestion's conditions as a rule's (an amount as Money in its currency). */
export function ruleConditions(conditions: readonly SuggestionCondition[]): RuleCondition[] {
  return conditions.map((c) =>
    c.field === "amount" ? { ...c, value: Money.of(c.value.amount, c.value.currency) } : { ...c },
  );
}

/** FR 20, FR 23: the canonical key of a suggestion's conditions — the same as `conditionKey` of a rule with them. */
export function suggestionKey(conditions: readonly SuggestionCondition[]): string {
  return conditionKey({ conditions: ruleConditions(conditions), accountIds: [] });
}

/** A row of the file as a rule reads it; a row without a currency matches no «Сума» condition (BR «суми»). */
function rowMatches(matcher: RuleMatcher, row: DerivationRow): boolean {
  const amount = row.currency !== null && isCurrencyCode(row.currency) ? row.currency : null;
  if (amount === null && matcher.conditions.some((c) => c.field === "amount")) return false;
  return ruleMatches(matcher, {
    merchant: row.merchant,
    description: row.description,
    // No «Сума» condition reads it when the row has no currency (above).
    amount: Money.of(row.amount, amount ?? "EUR"),
    accountId: row.accountId ?? "",
  });
}

/** The rows by date, then by the file's row — as the engine orders them (FR 15). */
const byDate = (a: DerivationRow, b: DerivationRow) =>
  (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.row - b.row;

/**
 * FR 18, AC20: with at least 50 rows, the rules derived from the earlier 80 % of the rows (by date) — the confident
 * suggestions, the ones selected by default (FR 21), in their order (FR 20) — are applied to the latest 20 %: each row
 * takes the category of the first rule that matches. The suggestions themselves are always derived from the whole array.
 */
export function historyCheck(rows: readonly DerivationRow[]): HistoryCheck {
  if (rows.length < HISTORY_CHECK_MIN_ROWS) return { status: "too_short", rows: rows.length };
  const sorted = [...rows].sort(byDate);
  const cut = Math.floor((sorted.length * 8) / 10);
  const rules = deriveSuggestions(sorted.slice(0, cut))
    .filter((s) => s.kind === "confident")
    .map((s) => ({
      matcher: { conditions: ruleConditions(s.conditions), accountIds: [] },
      categoryId: s.categoryId,
    }));
  const tested = sorted.slice(cut);
  let covered = 0;
  let agreeing = 0;
  for (const row of tested) {
    const rule = rules.find((r) => rowMatches(r.matcher, row));
    if (!rule) continue;
    covered += 1;
    if (rule.categoryId === row.categoryId) agreeing += 1;
  }
  return { status: "ready", rows: tested.length, covered, agreeing };
}

/**
 * FR 19, AC21: «описи у файлі, схоже, відрізняються від описів банку» — at least 50 transactions of the space imported
 * from statements, and all the suggestions together match under 10 % of them.
 */
export function descriptionsDiffer(imported: number, matchedImported: number): boolean {
  return imported >= DESCRIPTIONS_CHECK_MIN && matchedImported * 10 < imported;
}

/** A rule of the space as FR 20 compares a suggestion with it. */
export interface ExistingRule extends RuleMatcher {
  readonly id: string;
  readonly position: number;
  readonly categoryId: string;
}

/**
 * FR 20, AC22, AC23: a suggestion against the space's rules — `same` (a rule with the same conditions and category:
 * the suggestion is not shown), the first rule by priority with the same conditions and another category (shown,
 * marked as conflicting with it and not selected), or null.
 */
export function againstRules(
  key: string,
  categoryId: string,
  rules: readonly ExistingRule[],
): "same" | ExistingRule | null {
  const same = rules.filter((r) => conditionKey(r) === key).sort((a, b) => a.position - b.position);
  if (same.some((r) => r.categoryId === categoryId)) return "same";
  return same[0] ?? null;
}

/** FR 22, FR 20, AC26: the accepted suggestions in the order their rules take below the existing ones. */
export function acceptanceOrder<S extends Orderable>(accepted: readonly S[]): S[] {
  return [...accepted].sort(compareAcceptance);
}
