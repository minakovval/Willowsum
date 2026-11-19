import { Decimal } from "@willowsum/domain-kernel";
import type { StatementAnalysis } from "./analysis.ts";
import type { StatementEvents } from "./events.ts";

/**
 * Why the engine believes a row's sign (IMP-05@PoC FR 5, FR 6, AC4, AC5): the bases, the strongest first. A sign held
 * only by the bank's profile, the card's features or the majority is «знак не підтверджено» (confidence ≤ 0.6) and
 * the row goes to the separate group «потребує перегляду». A printed minus in a column that prints both signs is a
 * basis of its own, below the debit and credit columns (Рішення ведучого, 2026-11-19).
 */
export const SIGN_BASES = [
  "balance-chain",
  "totals",
  "direction-word",
  "debit-credit",
  "printed-both-signs",
  "profile",
  "card",
  "majority",
] as const;
export type SignBasis = (typeof SIGN_BASES)[number];

/** The bases that do not confirm a sign (FR 5). */
const WEAK: ReadonlySet<SignBasis> = new Set(["profile", "card", "majority"]);
export const SIGN_CONFIDENCE: Readonly<Record<SignBasis, number>> = {
  "balance-chain": 0.95,
  totals: 0.9,
  "direction-word": 0.85,
  "debit-credit": 0.85,
  "printed-both-signs": 0.8,
  profile: 0.6,
  card: 0.5,
  majority: 0.4,
};

export interface RowSign {
  readonly row: number;
  readonly basis: SignBasis;
  readonly confidence: number;
  /** False — «знак не підтверджено». */
  readonly confirmed: boolean;
}

export interface SignReview {
  readonly rows: readonly RowSign[];
  /** The group «потребує перегляду»: rows with an unconfirmed sign, from 1. */
  readonly unconfirmed: readonly number[];
  /** FR 6 «знак картки»: a credit card, no confirmed sign, most rows positive; null otherwise. */
  readonly card: { readonly positive: number; readonly negative: number } | null;
}

export interface SignContext {
  readonly chainRows: ReadonlySet<number>;
  readonly totalsVerified: boolean;
  /** The sign comes from the recipe's bank profile (IMP-06 FR 1 «знак»). */
  readonly profile?: boolean;
  /** The file or the account shows a card: a masked card in the preamble, or the account's kind. */
  readonly card: boolean;
  /** The account is a credit card (accounts' kind «credit-card», or a card in the file when the kind is not known). */
  readonly creditCard: boolean;
}

export function reviewSigns(
  statement: StatementEvents,
  analysis: StatementAnalysis,
  context: SignContext,
): SignReview {
  const mode = analysis.sign?.chosen.value ?? "as-printed";
  const bothSigns = analysis.sign?.evidence.some((e) => e.code === "negative-amounts") ?? false;
  const fallback: SignBasis = context.profile ? "profile" : context.card ? "card" : "majority";
  const rows = statement.events
    .filter((e) => e.legs.length > 0)
    .map((e): RowSign => {
      const unclear = e.flags.includes("sign-unclear");
      const basis: SignBasis = context.chainRows.has(e.row)
        ? "balance-chain"
        : context.totalsVerified
          ? "totals"
          : unclear
            ? fallback
            : mode === "indicator"
              ? "direction-word"
              : mode === "debit-credit"
                ? "debit-credit"
                : mode === "as-printed" && bothSigns
                  ? "printed-both-signs"
                  : fallback;
      return { row: e.row, basis, confidence: SIGN_CONFIDENCE[basis], confirmed: !WEAK.has(basis) };
    });
  const amounts = statement.events.flatMap((e) =>
    e.legs.length > 0 ? [new Decimal(e.legs[0]!.amount)] : [],
  );
  const positive = amounts.filter((a) => a.isPositive() && !a.isZero()).length;
  const negative = amounts.filter((a) => a.isNegative()).length;
  const card =
    context.creditCard && rows.length > 0 && rows.every((r) => !r.confirmed) && positive > negative
      ? { positive, negative }
      : null;
  return { rows, unconfirmed: rows.filter((r) => !r.confirmed).map((r) => r.row), card };
}
