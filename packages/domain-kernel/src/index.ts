// Shared pure code without business rules (AGENTS.md, ARC-01): money, identifiers, errors.
export { DomainError } from "./errors.ts";
export {
  AMOUNT_MAX_INTEGER_DIGITS,
  AMOUNT_MAX_SCALE,
  AmountOutOfRangeError,
  CurrencyMismatchError,
  Decimal,
  Money,
  currencyCode,
  sumMoney,
} from "./money.ts";
export type { CurrencyCode } from "./money.ts";
export { isId, newId, parseId } from "./ids.ts";
export type { Id } from "./ids.ts";
