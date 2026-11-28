import type { TransferSide } from "./matching.ts";

/**
 * IMP-03@PoC FR 14, FR 15, FR 22 — the one-sided transfer («односторонній переказ»), pure: a free transaction whose other
 * side is on an account outside Willowsum. The system only flags one (it still counts as usual, FR 14); «Це переказ»
 * (FR 22) takes it out of income and expenses and «Це не переказ» drops the flag for good — both are the transactions
 * module's. Here: which free transactions get the flag.
 *
 * - FR 14, AC9: the text says «переказ» and points to an own account, and no pair came within 4 days.
 * - FR 15, AC10: a positive line of a credit card that reads as its repayment («Payment received — thank you»,
 *   «Zahlungseingang», …) — flagged at once with the evidence «платіж на картку»; a refund, cashback, interest, a bonus,
 *   a reversal or a statement credit is no such payment.
 *
 * A side of an open proposal is never flagged (its pair may be waiting for «Підтвердити»), nor one flagged, marked or
 * dismissed before (the transactions module leaves those out of `singles`).
 */

/** FR 14: no pair within this many days — then the flag. */
export const ONE_SIDED_AFTER_DAYS = 4;

/** Why a transaction is flagged (the evidence shown on «Односторонні»). */
export type OneSidedEvidence = "transfer-words" | "own-account-words" | "card-payment";

/** A free transaction as the transactions module gives it for the check. */
export interface SingleTransaction extends TransferSide {
  readonly counterparty: string | null;
  readonly description: string | null;
}

/** The text compared: lower case, every dash a hyphen, runs of spaces one space. */
export function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Marker words of a transfer (FR 4). The release's list for the languages of its synthetic and test statements; the
 * full list of FR 4 (37 languages) is the scoring's later part — this one only grows.
 */
export const TRANSFER_WORDS: readonly string[] = [
  "переказ",
  "перевод",
  "transfer",
  "überweisung",
  "umbuchung",
  "przelew",
  "virement",
  "bonifico",
  "transferencia",
  "transferência",
  "převod",
];

/** Marker words of an own account (FR 4). */
export const OWN_ACCOUNT_WORDS: readonly string[] = [
  "власний рахунок",
  "власного рахунку",
  "свій рахунок",
  "між своїми рахунками",
  "own account",
  "between own accounts",
  "eigenes konto",
  "własne konto",
  "compte propre",
  "cuenta propia",
  "conta própria",
];

/** FR 15: a credit card's line that reads as its repayment. */
export const CARD_PAYMENT_WORDS: readonly string[] = [
  "payment received",
  "payment - thank you",
  "payment thank you",
  "autopay",
  "automatic payment",
  "online payment",
  "автоплатіж",
  "онлайн-платіж",
  "погашення кредиту",
  "погашення заборгованості",
  "pagamento de fatura",
  "zahlungseingang",
];

/** FR 15: never a card payment, whatever else the line says. */
export const NOT_CARD_PAYMENT_WORDS: readonly string[] = [
  "refund",
  "cashback",
  "cash back",
  "interest",
  "bonus",
  "reversal",
  "statement credit",
  "повернення",
  "кешбек",
  "відсотк",
  "бонус",
  "сторно",
  "erstattung",
  "gutschrift",
  "zinsen",
  "estorno",
];

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

const textOf = (t: SingleTransaction) => normalized(`${t.counterparty ?? ""} ${t.description ?? ""}`);

/** The ISO date `days` before `date` (calendar days, no time zone). */
export function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** FR 15: a positive line of a credit card that reads as its repayment. */
export function isCardPayment(t: SingleTransaction, cards: ReadonlySet<string>): boolean {
  if (!cards.has(t.accountId) || t.amount.isNegative() || t.amount.isZero()) return false;
  const text = textOf(t);
  return has(text, CARD_PAYMENT_WORDS) && !has(text, NOT_CARD_PAYMENT_WORDS);
}

/**
 * The evidence of a one-sided transfer, or null when `t` gets no flag now. `today` is the space's date (an injected
 * clock); `proposed` — the sides of the open proposals.
 */
export function oneSidedEvidence(
  t: SingleTransaction,
  context: {
    readonly today: string;
    readonly cards: ReadonlySet<string>;
    readonly proposed: ReadonlySet<string>;
  },
): readonly OneSidedEvidence[] | null {
  if (t.amount.isZero() || context.proposed.has(t.transactionId)) return null;
  if (isCardPayment(t, context.cards)) return ["card-payment"];
  const text = textOf(t);
  if (!has(text, TRANSFER_WORDS) || !has(text, OWN_ACCOUNT_WORDS)) return null;
  // FR 14: «без пари протягом 4 днів» — dated at least 4 days before today.
  if (t.date > daysBefore(context.today, ONE_SIDED_AFTER_DAYS)) return null;
  return ["transfer-words", "own-account-words"];
}

/** The transactions of `singles` to flag now, with their evidence. */
export function oneSidedToFlag(
  singles: readonly SingleTransaction[],
  context: Parameters<typeof oneSidedEvidence>[1],
): { readonly transactionId: string; readonly evidence: readonly OneSidedEvidence[] }[] {
  return singles.flatMap((t) => {
    const evidence = oneSidedEvidence(t, context);
    return evidence ? [{ transactionId: t.transactionId, evidence }] : [];
  });
}
