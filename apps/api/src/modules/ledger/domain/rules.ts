import {
  assertValidRate,
  convert,
  DomainError,
  type ExchangeRate,
  type Money,
} from "@willowsum/domain-kernel";
import { LedgerError, type AccountRef, type Posting } from "./postings.ts";

/**
 * The posting rules (FIN-04@PoC FR 3, FR 4; ARC-11 «Правила проводок»): event type → postings, as pure functions.
 * Each entry stores the version it was made by; a change of the rules is a new version and applies to new entries
 * only. Accounts are ledger account ids that the owner modules got from `openAccount`; the ledger knows no assets,
 * categories or texts.
 */
export const RULES_VERSION = 1;

/** The events the rules know. Signed amounts: positive increases the account, negative decreases it. */
export type LedgerEvent =
  /** Income (positive) or spending (negative) on an account; the other side is «Зовнішні кошти». */
  | { readonly type: "transaction"; readonly account: string; readonly amount: Money }
  /** A transfer between two accounts of the space: debit B, credit A. */
  | { readonly type: "transfer"; readonly from: string; readonly to: string; readonly amount: Money }
  /**
   * «Початковий залишок» of a new account (FIN-01@PoC FR 7): its balance on the date it is given, against «Зовнішні
   * кошти». Signed from the holder's side like `transaction`: a debt (credit card, loan) is negative.
   */
  | { readonly type: "opening-balance"; readonly account: string; readonly amount: Money }
  /** «Оновити залишок»: the difference to the actual balance, against «Коригування». */
  | { readonly type: "balance-adjustment"; readonly account: string; readonly amount: Money }
  /** Purchase of an asset from an account: debit the asset (cost basis), credit the account. */
  | {
      readonly type: "asset-purchase";
      readonly asset: string;
      readonly account: string;
      readonly amount: Money;
    }
  /** Revaluation of an asset: up debits the asset against «Резерв переоцінки», down the other way. */
  | { readonly type: "asset-revaluation"; readonly asset: string; readonly change: Money }
  /** Sale of an asset: debit the account, credit the asset (its basis) and the realised gain (or debit a loss). */
  | {
      readonly type: "asset-sale";
      readonly asset: string;
      readonly account: string;
      readonly proceeds: Money;
      readonly basis: Money;
    }
  /** Mortgage payment: debit the liability (principal) and the interest expense, credit the account. */
  | {
      readonly type: "mortgage-payment";
      readonly liability: string;
      readonly interestExpense: string;
      readonly account: string;
      readonly principal: Money;
      readonly interest: Money;
    }
  /** Rental income: debit the account, credit the asset's income account. */
  | {
      readonly type: "rental-income";
      readonly account: string;
      readonly income: string;
      readonly amount: Money;
    }
  /**
   * Income (positive) or spending (negative) in a currency other than the account's (FIN-04 EC1): `amount` in the
   * event's currency — the entry's currency — against «Зовнішні кошти», `settled` (same sign) on the account in its
   * own currency. `rate` (1 unit of the account's currency = `rate` units of the event's, dated) is given explicitly.
   */
  | {
      readonly type: "fx-transaction";
      readonly account: string;
      readonly amount: Money;
      readonly settled: Money;
      readonly rate: ExchangeRate;
    }
  /**
   * A transfer between accounts in two currencies (FIN-04 EC1): `sent` leaves `from` in its currency — the entry's
   * currency — and `received` arrives on `to` in another. `rate`: 1 unit of `received`'s currency = `rate` units of
   * `sent`'s, dated, given explicitly.
   */
  | {
      readonly type: "fx-transfer";
      readonly from: string;
      readonly to: string;
      readonly sent: Money;
      readonly received: Money;
      readonly rate: ExchangeRate;
    };

export type LedgerEventType = LedgerEvent["type"];

const acc = (account: string): AccountRef => ({ account });
const EXTERNAL: AccountRef = { service: "external-funds" };
const ADJUSTMENT: AccountRef = { service: "adjustment" };
const REVALUATION: AccountRef = { service: "revaluation-reserve" };
const GAIN: AccountRef = { service: "realized-gain" };
/** «Валютна різниця»: one per currency, so every pair of a cross-currency entry stays in one currency. */
const FX: AccountRef = { service: "fx-difference" };

/** Debit `debit` and credit `credit` by `amount`; a negative amount swaps the sides; zero gives no posting. */
function signed(debit: AccountRef, credit: AccountRef, amount: Money): Posting[] {
  if (amount.isZero()) return [];
  return amount.isNegative()
    ? [{ debit: credit, credit: debit, amount: amount.negated() }]
    : [{ debit, credit, amount }];
}

function positive(amount: Money): Money {
  if (amount.isNegative())
    throw new LedgerError("INVALID_EVENT", "This amount of the event cannot be negative");
  return amount;
}

const RULES: { readonly [T in LedgerEventType]: (event: Extract<LedgerEvent, { type: T }>) => Posting[] } = {
  transaction: (e) => signed(acc(e.account), EXTERNAL, e.amount),
  transfer: (e) => signed(acc(e.to), acc(e.from), positive(e.amount)),
  "opening-balance": (e) => signed(acc(e.account), EXTERNAL, e.amount),
  "balance-adjustment": (e) => signed(acc(e.account), ADJUSTMENT, e.amount),
  "asset-purchase": (e) => signed(acc(e.asset), acc(e.account), positive(e.amount)),
  "asset-revaluation": (e) => signed(acc(e.asset), REVALUATION, e.change),
  "asset-sale": (e) => {
    const proceeds = positive(e.proceeds);
    const basis = positive(e.basis);
    const gain = proceeds.minus(basis);
    // A gain: the account gets the basis back from the asset and the gain from «Реалізований прибуток».
    // A loss: the account gets the proceeds from the asset, and the rest of the basis is the realised loss.
    return gain.isNegative()
      ? [...signed(acc(e.account), acc(e.asset), proceeds), ...signed(GAIN, acc(e.asset), gain.negated())]
      : [...signed(acc(e.account), acc(e.asset), basis), ...signed(acc(e.account), GAIN, gain)];
  },
  "mortgage-payment": (e) => [
    // Debiting a liability decreases it (its balance is credits minus debits).
    ...signed(acc(e.liability), acc(e.account), positive(e.principal)),
    ...signed(acc(e.interestExpense), acc(e.account), positive(e.interest)),
  ],
  "rental-income": (e) => signed(acc(e.account), acc(e.income), positive(e.amount)),
  // Each currency is a balanced pair of its own, bridged by «Валютна різниця» of that currency (ADR-0011 pair model).
  "fx-transaction": (e) => {
    const { entryAmount, amount } = crossCurrency(e);
    return [...signed(acc(e.account), FX, amount), ...signed(FX, EXTERNAL, entryAmount)];
  },
  "fx-transfer": (e) => {
    const { entryAmount, amount } = crossCurrency(e);
    return [...signed(FX, acc(e.from), entryAmount), ...signed(acc(e.to), FX, amount)];
  },
};

type CrossCurrencyEvent = Extract<LedgerEvent, { type: "fx-transaction" | "fx-transfer" }>;

/** A rate's source is a code (ARC-11: no free text in the journal), e.g. `NBU`, `EU`, `synthetic`. */
const RATE_SOURCE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;

/**
 * The two actual amounts of a cross-currency event, checked: the entry's (in the event's currency) and the account's
 * (in another), of one sign and not zero (a transfer: both positive); the rate converts the account's currency into
 * the entry's, is valid (positive, at most 18 decimals, dated) and names its source by a code.
 */
function crossCurrency(e: CrossCurrencyEvent): { entryAmount: Money; amount: Money } {
  const [entryAmount, amount] = e.type === "fx-transaction" ? [e.amount, e.settled] : [e.sent, e.received];
  if (e.type === "fx-transfer") {
    positive(entryAmount);
    positive(amount);
  }
  if (entryAmount.isZero() || amount.isZero() || entryAmount.isNegative() !== amount.isNegative())
    throw new LedgerError("INVALID_EVENT", "Both amounts of a cross-currency event move the same way");
  if (entryAmount.currency === amount.currency)
    throw new LedgerError(
      "INVALID_EVENT",
      "A cross-currency event has two currencies; use the one-currency event",
    );
  assertRate(e.rate, amount.currency, entryAmount.currency);
  return { entryAmount, amount };
}

function assertRate(rate: ExchangeRate | undefined, base: string, quote: string): void {
  if (rate === undefined || rate === null)
    throw new LedgerError("INVALID_RATE", "A cross-currency event needs an explicit dated rate");
  try {
    assertValidRate(rate);
  } catch (error) {
    if (error instanceof DomainError) throw new LedgerError("INVALID_RATE", error.message);
    throw error;
  }
  if (rate.base !== base || rate.quote !== quote)
    throw new LedgerError(
      "INVALID_RATE",
      "The rate converts the account's currency into the entry's currency (base: account, quote: entry)",
    );
  if (!RATE_SOURCE_RE.test(rate.source))
    throw new LedgerError("INVALID_RATE", "A rate's source is a code of 1–32 letters, digits and . _ -");
}

/**
 * The rate kept on an entry for a posting in another currency than the entry's (ARC-11 «Запис проводок»): the actual
 * amount on the account, the entry's actual amount, both positive, and the account's amount converted into the entry's
 * currency at the rate. The conversion difference (`conversionDifference`) is what «Валютна різниця» holds for it.
 */
export interface EntryConversion {
  /** The actual amount on the account, in its currency (the rate's base). */
  readonly amount: Money;
  /** The entry's actual amount, in the entry's currency (the rate's quote). */
  readonly entryAmount: Money;
  /** `amount` × the rate, in the entry's currency, at the storage scale of the kernel (18 decimals). */
  readonly converted: Money;
  readonly rate: ExchangeRate;
}

/**
 * The conversions of an event (ARC-11): one for a cross-currency event, none for an event in one currency. The rate
 * may not be dated after the operation (an explicit dated rate known on that day; the kernel's `convert` refuses it).
 */
export function conversionsFor(event: LedgerEvent, operationDate: string): EntryConversion[] {
  if (event.type !== "fx-transaction" && event.type !== "fx-transfer") return [];
  const { entryAmount, amount } = crossCurrency(event);
  const actual = amount.isNegative() ? amount.negated() : amount;
  try {
    const { to } = convert(actual, event.rate, operationDate);
    return [
      {
        amount: actual,
        entryAmount: entryAmount.isNegative() ? entryAmount.negated() : entryAmount,
        converted: to,
        rate: event.rate,
      },
    ];
  } catch (error) {
    if (error instanceof DomainError) throw new LedgerError("INVALID_RATE", error.message);
    throw error;
  }
}

/** The conversion difference in the entry's currency: the converted amount minus the entry's actual amount. */
export function conversionDifference(c: EntryConversion): Money {
  return c.converted.minus(c.entryAmount);
}

/**
 * The postings of an event by the current rules (FIN-04 FR 2–4). An event without a rule is refused with
 * «невідомий тип події» (ARC-11); an event that moves nothing is refused as an empty posting set.
 */
export function postingsFor(event: LedgerEvent): Posting[] {
  const rule = Object.hasOwn(RULES, event.type)
    ? (RULES[event.type] as (e: LedgerEvent) => Posting[])
    : undefined;
  if (!rule) throw new LedgerError("UNKNOWN_EVENT_TYPE", "No posting rule for this event type");
  const postings = rule(event);
  if (postings.length === 0) throw new LedgerError("EMPTY_POSTING_SET", "The event moves no amount");
  return postings;
}

export const EVENT_TYPES = Object.keys(RULES) as LedgerEventType[];
