import DecimalJs from "decimal.js";
import { DomainError } from "./errors.ts";

/**
 * Exact decimal arithmetic for amounts (AGENTS.md «Money»: never JS `number` for amounts).
 * Precision 60 significant digits covers NUMERIC(38,18) (ARC-03) with room for intermediate results.
 */
export const Decimal = DecimalJs.clone({ precision: 60, rounding: DecimalJs.ROUND_HALF_EVEN });
export type Decimal = InstanceType<typeof Decimal>;

/** Storage limits of an amount: NUMERIC(38,18) — 20 integer digits, 18 fraction digits (ARC-03). */
export const AMOUNT_MAX_INTEGER_DIGITS = 20;
export const AMOUNT_MAX_SCALE = 18;

/** ISO 4217 alphabetic code or another three-letter unit code (XAU, XAG, crypto tickers are added by NFR-06). */
export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

const CURRENCY_RE = /^[A-Z]{3}$/;

export function currencyCode(code: string): CurrencyCode {
  if (!CURRENCY_RE.test(code))
    throw new DomainError("INVALID_CURRENCY", "Currency code must be three letters A–Z");
  return code as CurrencyCode;
}

const DECIMAL_STRING_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export class CurrencyMismatchError extends DomainError {
  constructor() {
    super(
      "CURRENCY_MISMATCH",
      "Amounts in different currencies cannot be combined without an explicit dated rate",
    );
  }
}

export class AmountOutOfRangeError extends DomainError {
  constructor() {
    super("AMOUNT_OUT_OF_RANGE", "Amount does not fit NUMERIC(38,18)");
  }
}

function checkRange(value: Decimal): Decimal {
  if (value.decimalPlaces() > AMOUNT_MAX_SCALE) throw new AmountOutOfRangeError();
  if (value.abs().truncated().toFixed().replace(/^0$/, "").length > AMOUNT_MAX_INTEGER_DIGITS) {
    throw new AmountOutOfRangeError();
  }
  return value;
}

/**
 * An amount in one currency. Immutable. Created only from a decimal string or a Decimal — never from a
 * JS number, so a float can't sneak in. Arithmetic is exact; combining currencies throws.
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: CurrencyCode;

  private constructor(amount: Decimal, currency: CurrencyCode) {
    this.amount = checkRange(amount);
    this.currency = currency;
  }

  static of(amount: string | Decimal, currency: string): Money {
    if (typeof amount === "string") {
      if (!DECIMAL_STRING_RE.test(amount)) {
        throw new DomainError("INVALID_AMOUNT", "Amount must be a plain decimal string, e.g. -125.50");
      }
      return new Money(new Decimal(amount), currencyCode(currency));
    }
    if (!(amount instanceof Decimal)) {
      throw new DomainError("INVALID_AMOUNT", "Amount must be a decimal string or a Decimal");
    }
    return new Money(amount, currencyCode(currency));
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), currencyCode(currency));
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  /** Canonical decimal string without exponent, e.g. "-125.5". Not a display format (see DS-04). */
  toDecimalString(): string {
    return this.amount.toFixed();
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toDecimalString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new CurrencyMismatchError();
  }
}

/** Sum of amounts in one currency; an empty list needs the currency to be given. */
export function sumMoney(items: readonly Money[], currency: string): Money {
  return items.reduce((total, item) => total.plus(item), Money.zero(currency));
}
