// Shared pure code without business rules (AGENTS.md, ARC-01): money, identifiers, errors.
export { DomainError } from "./errors.ts";
export {
  AMOUNT_MAX_INTEGER_DIGITS,
  AMOUNT_MAX_SCALE,
  AmountOutOfRangeError,
  CurrencyMismatchError,
  Decimal,
  Money,
  sumMoney,
} from "./money.ts";
export { currencyCode, currencyInfo, isCurrencyCode, knownCurrencies } from "./currency.ts";
export type { CurrencyCode, CurrencyInfo, CurrencyKind } from "./currency.ts";
export { InvalidRateError, RATE_MAX_SCALE, assertValidRate, convert, exchangeRate } from "./conversion.ts";
export type { Conversion, ExchangeRate } from "./conversion.ts";
export { isId, newId, parseId } from "./ids.ts";
export type { Id } from "./ids.ts";
