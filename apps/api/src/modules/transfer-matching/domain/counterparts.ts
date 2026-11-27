import { convert, Decimal, DomainError, type ExchangeRate, type Money } from "@willowsum/domain-kernel";
import { transferDate, type TransferSide } from "./matching.ts";

/**
 * IMP-03@PoC FR 24 — «Позначити як переказ» (ручне поєднання), pure: the candidates for the other side of a transaction
 * the user pairs by hand. The transactions module's search gives the free transactions of the opposite direction on the
 * other own accounts within 7 days before or after the chosen one, in its currency within ±5 % of its amount (for a
 * debit of 2 000,00 EUR — 1 900,00–2 100,00 EUR), in another currency any amount; here each candidate gets what its row
 * shows once chosen: in one currency the difference of the amounts that becomes an expense «Комісії банку», in two the
 * line of the difference with the pair's rate next to the reference one, as on the proposal card (FR 21). The rules of
 * the automatic proposals (the windows of FR 5, the score) do not apply: the choice is the user's.
 */

/** FR 24: candidates dated at most this many days before or after the chosen transaction. */
export const COUNTERPART_WINDOW_DAYS = 7;
/** FR 24: in one currency a candidate's amount is within this share of the chosen one's, either way. */
export const COUNTERPART_AMOUNT_SHARE = new Decimal("0.05");
/** The most candidates one read lists; `more` tells there were others. */
export const COUNTERPARTS_MAX = 50;
/** The scale a rate is kept at (as the journal's rates: at most 18 decimals). */
const RATE_MAX_SCALE = 18;

/** What the transactions module tells of the chosen transaction (its side, and what stops it being one). */
export interface ChosenTransaction extends TransferSide {
  readonly status: string;
  readonly hidden: boolean;
  readonly split: boolean;
  readonly inTransfer: boolean;
}

export interface CounterpartTransaction extends TransferSide {
  readonly counterparty: string | null;
  readonly description: string | null;
}

/** Why the chosen transaction can be no side of a pair (the same codes as «Позначити як переказ», FIN-03 FR 27). */
export type ChosenIssue = "pending" | "hidden" | "split" | "in_transfer" | "zero";

export function chosenIssues(t: ChosenTransaction): ChosenIssue[] {
  const issues: ChosenIssue[] = [];
  if (t.status !== "posted") issues.push("pending");
  if (t.hidden) issues.push("hidden");
  if (t.split) issues.push("split");
  if (t.inTransfer) issues.push("in_transfer");
  if (t.amount.isZero()) issues.push("zero");
  return issues;
}

export type Counterpart = CounterpartTransaction & {
  /** The pair the candidate would make with the chosen transaction: the debit and the credit. */
  readonly outflow: TransferSide;
  readonly inflow: TransferSide;
} & (
    | {
        readonly kind: "same-currency";
        /**
         * The credit plus the debit: negative or zero — the fee, an expense «Комісії банку» once paired (FR 24, FR 9);
         * positive — the credit exceeds the debit, which «Позначити як переказ» refuses (`markable` false).
         */
        readonly difference: Money;
        readonly markable: boolean;
      }
    | {
        readonly kind: "cross-currency";
        /** 1 unit of the debit's currency in the credit's, the reference rate of the pair's date; null — none known. */
        readonly rate: ExchangeRate | null;
        /** The debit at `rate`, in the credit's currency (unrounded); null without a rate. */
        readonly converted: Money | null;
        /** The credit less `converted` (FR 21: a loss or a gain once paired); null without a rate. */
        readonly difference: Money | null;
        /** FR 21: the pair's rate — credit ÷ debit, 1 unit of the debit's currency in the credit's, 18 decimals. */
        readonly bankRate: Decimal;
        readonly markable: true;
      }
  );

/** The pair a candidate makes with the chosen transaction: the debit is the negative one. */
export function pairWith(
  chosen: TransferSide,
  candidate: TransferSide,
): { outflow: TransferSide; inflow: TransferSide } {
  return chosen.amount.isNegative()
    ? { outflow: chosen, inflow: candidate }
    : { outflow: candidate, inflow: chosen };
}

/** The reference rate a candidate in another currency needs (fx-rates `rates`); null in one currency. */
export function counterpartRateRequest(
  chosen: TransferSide,
  candidate: TransferSide,
): { from: string; to: string; date: string } | null {
  if (chosen.amount.currency === candidate.amount.currency) return null;
  const pair = pairWith(chosen, candidate);
  return { from: pair.outflow.amount.currency, to: pair.inflow.amount.currency, date: transferDate(pair) };
}

/** What the row of a candidate shows once chosen (FR 24, FR 21). `rate` — as `counterpartRateRequest` asked. */
export function counterpartOf(
  chosen: TransferSide,
  candidate: CounterpartTransaction,
  rate: ExchangeRate | null,
): Counterpart {
  const pair = pairWith(chosen, candidate);
  const debit = pair.outflow.amount.negated();
  const credit = pair.inflow.amount;
  if (debit.currency === credit.currency) {
    const difference = credit.minus(debit);
    return {
      ...candidate,
      ...pair,
      kind: "same-currency",
      difference,
      markable: difference.isNegative() || difference.isZero(),
    };
  }
  const bankRate = credit.amount
    .dividedBy(debit.amount)
    .toDecimalPlaces(RATE_MAX_SCALE, Decimal.ROUND_HALF_EVEN);
  const usable = rate !== null && rate.base === debit.currency && rate.quote === credit.currency;
  let converted: Money | null = null;
  if (usable) {
    try {
      converted = convert(debit, rate, transferDate(pair)).to;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  return {
    ...candidate,
    ...pair,
    kind: "cross-currency",
    rate: converted === null ? null : rate,
    converted,
    difference: converted === null ? null : credit.minus(converted),
    bankRate,
    markable: true,
  };
}
