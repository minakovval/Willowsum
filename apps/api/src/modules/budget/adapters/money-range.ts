import type { Money } from "@willowsum/domain-kernel";

/**
 * The most integer digits one amount the budget reads may have — as `parseBudgetAmount` takes a limit (#567, #586).
 * Above it an amount is left out before any conversion or sum, so no sum of the budget leaves the money type
 * (NUMERIC(38,18), 20 integer digits) and answers 500.
 */
export const BUDGET_MAX_INTEGER_DIGITS = 15;

/** An amount over `BUDGET_MAX_INTEGER_DIGITS` integer digits. */
export const overBudgetCap = (m: Money): boolean =>
  m.amount.abs().truncated().toFixed().length > BUDGET_MAX_INTEGER_DIGITS;
