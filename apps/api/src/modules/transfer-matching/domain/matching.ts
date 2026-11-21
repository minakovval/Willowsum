import { convert, Decimal, type ExchangeRate, type Money } from "@willowsum/domain-kernel";

/**
 * The search for transfers between own accounts (FIN-03@PoC FR 5, AC2, AC4, edge case 1; wave 2 row 16b), pure: a debit
 * on one account of the space and a credit on another within 3 days; in one currency the credit is 0–2 % less than the
 * debit (the difference is the fee, FR 8), in two currencies the credit is within 3 % either way of the debit converted
 * at the official rate of the transfer's date (NBU; any other pair a cross rate through the hryvnia — module fx-rates).
 * A pair found is only a proposal (FR 6): the system never marks a transfer by itself.
 */

export const MATCH_WINDOW_DAYS = 3;
/**
 * IMP-03@PoC FR 4 (wave 2 row 47): «курс близький до довідкового курсу дня (1 % або 3 %)» — the two bands of the
 * evidence; beyond 3 % a pair in two currencies is no proposal (FIN-03 FR 5).
 */
export const RATE_CLOSE_SHARE = new Decimal("0.01");

/** One currency: the credit is 0 to 2 % below the debit. */
export const FEE_MAX_SHARE = new Decimal("0.02");
/** Two currencies: the credit is within 3 % of the debit converted at the rate of the date. */
export const CROSS_CURRENCY_MAX_SHARE = new Decimal("0.03");
/** The scale a rate is kept at (as the journal's rates: at most 18 decimals). */
const RATE_MAX_SCALE = 18;

/**
 * What the transactions module's search takes (its SQL narrows by these; the rule above decides): the window in days
 * and, in one currency, the smallest credit as a share of the debit.
 */
export const candidateQuery = {
  windowDays: MATCH_WINDOW_DAYS,
  sameCurrencyMinShare: new Decimal("1").minus(FEE_MAX_SHARE).toString(),
} as const;

export interface TransferSide {
  readonly transactionId: string;
  readonly accountId: string;
  /** Signed: the outflow negative, the inflow positive; each in its account's currency. */
  readonly amount: Money;
  readonly date: string;
  /** IMP-08 FR 11: the import batch that wrote it; null or absent — entered by hand. */
  readonly importBatchId?: string | null;
}

export interface PairCandidate {
  readonly outflow: TransferSide;
  readonly inflow: TransferSide;
}

/**
 * IMP-03@PoC FR 2 (wave 2 row 47): the kind of a pair — «переказ між власними рахунками» (two accounts, one currency or
 * two) or «обмін валют» (the debit in one currency and the credit in another on two wallets of one multi-currency
 * account). Refunds and holds come with row 48.
 */
export type PairKind = "transfer" | "exchange";

/** IMP-03@PoC FR 4: the credit is within 1 % (`within-1`) or within 3 % (`within-3`) of the debit at the reference rate. */
export type RateBand = "within-1" | "within-3";

export type TransferProposal = PairCandidate & {
  /** Edge case 1: the earlier side's date. */
  readonly date: string;
  readonly pairKind: PairKind;
} & (
    | {
        readonly kind: "same-currency";
        /** FR 8: the difference, an expense «Комісії банку» once confirmed; zero when the amounts are equal. */
        readonly fee: Money;
      }
    | {
        readonly kind: "cross-currency";
        /** 1 unit of the outflow's currency in the inflow's, dated by the transfer's date or the nearest earlier one. */
        readonly rate: ExchangeRate;
        /** The debit converted at the rate, in the inflow's currency (unrounded). */
        readonly converted: Money;
        /** The credit less `converted`: what «Валютна різниця» takes (FR 8). */
        readonly difference: Money;
        /**
         * IMP-03 FR 21: the bank's rate — the actual rate of the pair, 1 unit of the outflow's currency in the inflow's
         * (credit ÷ debit, 18 decimals, half to even), shown next to the reference `rate`.
         */
        readonly bankRate: Decimal;
        /** IMP-03 FR 4: how close the bank's rate is to the reference one. */
        readonly rateBand: RateBand;
      }
  );

/** Edge case 1: a transfer is dated by its earlier side. */
export function transferDate(c: PairCandidate): string {
  return c.outflow.date < c.inflow.date ? c.outflow.date : c.inflow.date;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** IMP-03@PoC FR 2: two wallets of one account in two currencies are an exchange; any other pair a transfer. */
export function pairKindOf(c: PairCandidate): PairKind {
  return c.outflow.accountId === c.inflow.accountId && c.outflow.amount.currency !== c.inflow.amount.currency
    ? "exchange"
    : "transfer";
}

function isPair(c: PairCandidate): boolean {
  return (
    c.outflow.amount.isNegative() &&
    !c.inflow.amount.isNegative() &&
    !c.inflow.amount.isZero() &&
    // FIN-03 FR 5: two accounts; IMP-03 FR 2: or two wallets (currencies) of one account — an exchange.
    (c.outflow.accountId !== c.inflow.accountId || c.outflow.amount.currency !== c.inflow.amount.currency) &&
    Math.abs(dayNumber(c.outflow.date) - dayNumber(c.inflow.date)) <= MATCH_WINDOW_DAYS
  );
}

/** The rate a pair in two currencies needs (fx-rates `rates`); null in one currency. */
export function rateRequestOf(c: PairCandidate): { from: string; to: string; date: string } | null {
  if (c.outflow.amount.currency === c.inflow.amount.currency) return null;
  return { from: c.outflow.amount.currency, to: c.inflow.amount.currency, date: transferDate(c) };
}

/** The proposal of a candidate pair, or null when it is no transfer by FR 5 (two currencies without a rate: none). */
export function proposalOf(c: PairCandidate, rate: ExchangeRate | null): TransferProposal | null {
  if (!isPair(c)) return null;
  const date = transferDate(c);
  const pairKind = pairKindOf(c);
  const debit = c.outflow.amount.negated();
  if (debit.currency === c.inflow.amount.currency) {
    const fee = c.inflow.amount.minus(debit);
    if (!fee.isNegative() && !fee.isZero()) return null;
    if (fee.negated().amount.greaterThan(debit.amount.times(FEE_MAX_SHARE))) return null;
    return { ...c, date, pairKind, kind: "same-currency", fee };
  }
  if (rate === null || rate.base !== debit.currency || rate.quote !== c.inflow.amount.currency) return null;
  const converted = convert(debit, rate, date).to;
  const difference = c.inflow.amount.minus(converted);
  const off = difference.amount.abs();
  if (off.greaterThan(converted.amount.times(CROSS_CURRENCY_MAX_SHARE))) return null;
  const rateBand: RateBand = off.greaterThan(converted.amount.times(RATE_CLOSE_SHARE))
    ? "within-3"
    : "within-1";
  const bankRate = c.inflow.amount.amount
    .dividedBy(debit.amount)
    .toDecimalPlaces(RATE_MAX_SCALE, Decimal.ROUND_HALF_EVEN);
  return { ...c, date, pairKind, kind: "cross-currency", rate, converted, difference, bankRate, rateBand };
}
