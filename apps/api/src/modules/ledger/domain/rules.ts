import type { Money } from "@willowsum/domain-kernel";
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
    };

export type LedgerEventType = LedgerEvent["type"];

const acc = (account: string): AccountRef => ({ account });
const EXTERNAL: AccountRef = { service: "external-funds" };
const ADJUSTMENT: AccountRef = { service: "adjustment" };
const REVALUATION: AccountRef = { service: "revaluation-reserve" };
const GAIN: AccountRef = { service: "realized-gain" };

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
};

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
