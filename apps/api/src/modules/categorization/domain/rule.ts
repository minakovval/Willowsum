import type { Money } from "@willowsum/domain-kernel";

/**
 * Category rules (BUD-14@PoC FR 4, FR 5, FR 8, FR 10, FR 11, FR 12; wave 2 row 23). Pure rules, no I/O.
 *
 * A rule's conditions all hold («І», FR 5): «Мерчант» and «Опис» (the bank's original description) with «дорівнює» and
 * «містить», any case; «Сума» with «дорівнює», «більше за», «менше за» in one currency, on the amount without its sign
 * (an expense of 59,99 € is «більше за 50 €»); «Рахунок» with «дорівнює». «Лише для рахунків» limits a rule to some
 * accounts. The action is a category (tags come with the transaction tags of BUD-13); there is no «приховати» (FR 12).
 */

export const RULE_FIELDS = ["merchant", "description", "amount", "account"] as const;
export const TEXT_OPERATORS = ["equals", "contains"] as const;
export const AMOUNT_OPERATORS = ["equals", "greater", "less"] as const;

/** At most this many conditions in one rule and accounts in «Лише для рахунків». */
export const RULE_CONDITIONS_MAX = 10;
export const RULE_ACCOUNTS_MAX = 50;
/** At most this many rules in a space: the rules of a new transaction are checked one by one. */
export const RULES_MAX = 500;

export type RuleCondition =
  | {
      readonly field: "merchant" | "description";
      readonly operator: (typeof TEXT_OPERATORS)[number];
      readonly value: string;
    }
  | { readonly field: "amount"; readonly operator: (typeof AMOUNT_OPERATORS)[number]; readonly value: Money }
  | { readonly field: "account"; readonly operator: "equals"; readonly value: string };

/** What a rule decides by — the conditions and «Лише для рахунків» (empty: every account). */
export interface RuleMatcher {
  readonly conditions: readonly RuleCondition[];
  readonly accountIds: readonly string[];
}

/** A transaction as the rules see it: the shown merchant (module merchants), the bank's description, the amount. */
export interface RuleSubject {
  readonly merchant: string | null;
  readonly description: string | null;
  readonly amount: Money;
  readonly accountId: string;
}

const fold = (text: string) => text.trim().toLowerCase();

function textHolds(operator: "equals" | "contains", value: string, text: string | null): boolean {
  if (text === null) return false;
  return operator === "equals" ? fold(text) === fold(value) : fold(text).includes(fold(value));
}

function conditionHolds(condition: RuleCondition, subject: RuleSubject): boolean {
  switch (condition.field) {
    case "merchant":
      return textHolds(condition.operator, condition.value, subject.merchant);
    case "description":
      return textHolds(condition.operator, condition.value, subject.description);
    case "account":
      return subject.accountId === condition.value;
    case "amount": {
      // Another currency never matches: no conversion without an explicit dated rate (AGENTS.md «Money»).
      if (subject.amount.currency !== condition.value.currency) return false;
      const unsigned = subject.amount.isNegative() ? subject.amount.negated() : subject.amount;
      const order = unsigned.compare(condition.value);
      return condition.operator === "equals"
        ? order === 0
        : condition.operator === "greater"
          ? order > 0
          : order < 0;
    }
  }
}

/** FR 5: every condition holds («І») and the account is one of «Лише для рахунків», if any. */
export function ruleMatches(rule: RuleMatcher, subject: RuleSubject): boolean {
  if (rule.accountIds.length > 0 && !rule.accountIds.includes(subject.accountId)) return false;
  return rule.conditions.every((c) => conditionHolds(c, subject));
}

/**
 * FR 11: the canonical form of a rule's conditions and accounts — two rules with the same key have identical
 * conditions, whatever their order, spacing or case of the text.
 */
export function conditionKey(rule: RuleMatcher): string {
  const parts = rule.conditions
    .map((c) =>
      c.field === "amount"
        ? `amount:${c.operator}:${c.value.amount.toString()}:${c.value.currency}`
        : `${c.field}:${c.operator}:${c.field === "account" ? c.value : fold(c.value)}`,
    )
    .sort();
  return JSON.stringify([[...new Set(parts)], [...new Set(rule.accountIds)].sort()]);
}

/** Why a rule is skipped until it is edited (FR 10, AC7): its category or one of its accounts is gone. */
export type RuleAttention = "category_deleted" | "account_deleted";

/** A rule as the rules of a new transaction are run (FR 8): in priority order, the first that matches decides. */
export interface RankedRule extends RuleMatcher {
  readonly id: string;
  readonly categoryId: string;
  readonly enabled: boolean;
}

/**
 * FR 8, FR 10, AC7, AC12: the rule whose category a new transaction takes — the first enabled rule in priority order
 * that matches and needs no attention; null — none. `attention` is asked only for a rule that matches.
 */
export async function firstRule<R extends RankedRule>(
  rules: readonly R[],
  subject: RuleSubject,
  attention: (rule: R) => Promise<RuleAttention | null>,
): Promise<R | null> {
  for (const rule of rules) {
    if (!rule.enabled || !ruleMatches(rule, subject)) continue;
    if ((await attention(rule)) === null) return rule;
  }
  return null;
}

/** The order of a space's rules after a move of `id` to `position` (1-based, within 1…n). */
export function moved(ids: readonly string[], id: string, position: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(position - 1, 0, id);
  return rest;
}
