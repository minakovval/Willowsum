import { currencyInfo, Decimal } from "@willowsum/domain-kernel";
import { pairDays, type PairKind, type TransferProposal } from "./matching.ts";

/**
 * IMP-03@PoC b) (wave 2 row 48): the score of a pair, its confidence and the choice of the proposals one-to-one, pure.
 *
 * FR 3: the score 0–100 is the sum of the points of the pair's evidence; a pair below 55 is no proposal (AC14); the
 * confidence is high from 80, medium from 65, else low. FR 4 (the evidence this part reads — the amounts, the rate, the
 * days and the wallet group): the exact amount within ±1 minor unit of the currency (AC3: −100,00 / +99,99 EUR), the
 * amount less a fee, the rate close to the reference rate of the day (1 % or 3 %), the same day or the days between,
 * and the same wallet group (an exchange on one account). The points of each are the lead's decision (row 48 decision
 * log); the other evidence of FR 4 (an account's identifier in the text, marker words, the merchant, a reference) is a
 * later part. FR 7: candidates within 5 points of the chosen one are shown as «неоднозначно з…»; at an equal score
 * the kind of the pair, then fewer days, then the smaller difference of the amounts wins. FR 12: open proposals are
 * one-to-one — a transaction is a side of one proposal at most.
 */

/** FR 3: the least score of a proposal. */
export const PROPOSAL_MIN_SCORE = 55;
/** FR 3: high confidence from this score. */
export const HIGH_CONFIDENCE_SCORE = 80;
/** FR 3: medium confidence from this score. */
export const MEDIUM_CONFIDENCE_SCORE = 65;
/** FR 7: other candidates within this many points of a proposal make it ambiguous. */
export const AMBIGUITY_POINTS = 5;
const MAX_SCORE = 100;

/** The kinds of evidence this part scores (FR 4); the list grows with the later parts. */
export type EvidenceCode =
  | "exact-amount"
  | "amount-less-fee"
  | "rate-within-1"
  | "rate-within-3"
  | "same-day"
  | "days-apart"
  | "same-wallet-group";

export interface Evidence {
  readonly code: EvidenceCode;
  readonly points: number;
  /** `days-apart`: the days between the sides. */
  readonly days?: number;
}

export type Confidence = "high" | "medium" | "low";

/**
 * The points of each piece of evidence (the lead's decision, row 48; the requirement gives none). They are set so that
 * every pair the rule of FIN-03@PoC FR 5 admits — a fee up to 2 % in one currency or up to 3 % from the reference rate in
 * two, at most 3 days apart — scores at least 55 and stays a proposal (FIN-03 FR 6): the weakest such pair, a 2 % fee
 * or a 3 % rate 3 days apart, scores exactly 55 (35 + 20).
 */
export const EVIDENCE_POINTS = {
  "exact-amount": 50,
  /** A fee of at most 0,5 % of the debit. */
  "amount-less-fee": 40,
  /** A fee above 0,5 % and up to 2 % (FR 5) of the debit. */
  "amount-less-large-fee": 35,
  "rate-within-1": 40,
  "rate-within-3": 35,
  "same-day": 40,
  /** By the days between the sides: 1, 2, 3; beyond 3 none. */
  "days-apart": [35, 25, 20] as readonly number[],
  "same-wallet-group": 5,
} as const;

/** A fee at most this share of the debit scores as `amount-less-fee` with its higher points. */
export const SMALL_FEE_SHARE = new Decimal("0.005");

export type ScoredProposal = TransferProposal & {
  readonly score: number;
  readonly confidence: Confidence;
  readonly evidence: readonly Evidence[];
};

export type ChosenProposal = ScoredProposal & {
  /** FR 7: the other candidates within 5 points that share a side with this one — their other side, best first. */
  readonly ambiguousWith: readonly { readonly transactionId: string; readonly score: number }[];
};

/** One minor unit of the currency (0,01 EUR, 1 JPY, 0,001 KWD). */
export function minorUnit(currency: string): Decimal {
  return new Decimal("1").dividedBy(new Decimal("10").pow(currencyInfo(currency).minorUnits));
}

/** FR 4: the evidence of a proposal (the rule of FR 5 has admitted it already). */
export function evidenceOf(p: TransferProposal): Evidence[] {
  const evidence: Evidence[] = [];
  if (p.kind === "same-currency") {
    const fee = p.fee.amount.abs();
    const debit = p.outflow.amount.amount.abs();
    if (fee.lessThanOrEqualTo(minorUnit(p.fee.currency)))
      evidence.push({ code: "exact-amount", points: EVIDENCE_POINTS["exact-amount"] });
    else
      evidence.push({
        code: "amount-less-fee",
        points: fee.lessThanOrEqualTo(debit.times(SMALL_FEE_SHARE))
          ? EVIDENCE_POINTS["amount-less-fee"]
          : EVIDENCE_POINTS["amount-less-large-fee"],
      });
  } else {
    const code = p.rateBand === "within-1" ? "rate-within-1" : "rate-within-3";
    evidence.push({ code, points: EVIDENCE_POINTS[code] });
  }
  const days = pairDays(p);
  if (days === 0) evidence.push({ code: "same-day", points: EVIDENCE_POINTS["same-day"] });
  else {
    const points = EVIDENCE_POINTS["days-apart"][days - 1];
    if (points !== undefined) evidence.push({ code: "days-apart", points, days });
  }
  if (p.pairKind === "exchange")
    evidence.push({ code: "same-wallet-group", points: EVIDENCE_POINTS["same-wallet-group"] });
  return evidence;
}

export function confidenceOf(score: number): Confidence {
  if (score >= HIGH_CONFIDENCE_SCORE) return "high";
  if (score >= MEDIUM_CONFIDENCE_SCORE) return "medium";
  return "low";
}

/** FR 3: the scored proposal, or null below 55 (AC14). */
export function scored(p: TransferProposal): ScoredProposal | null {
  const evidence = evidenceOf(p);
  const score = Math.min(
    MAX_SCORE,
    evidence.reduce((sum, e) => sum + e.points, 0),
  );
  if (score < PROPOSAL_MIN_SCORE) return null;
  return { ...p, score, confidence: confidenceOf(score), evidence };
}

/** FR 7: the order of the kinds at an equal score (as FR 2 lists them). */
const KIND_ORDER: readonly PairKind[] = ["transfer", "exchange"];

/** The difference of the amounts as a share of the debit (one currency) or of the converted debit (two). */
function differenceShare(p: TransferProposal): Decimal {
  if (p.kind === "same-currency") return p.fee.amount.abs().dividedBy(p.outflow.amount.amount.abs());
  return p.difference.amount.abs().dividedBy(p.converted.amount.abs());
}

/** FR 7: better first — the higher score, then the kind, fewer days, the smaller difference; then by the ids. */
export function compareProposals(a: ScoredProposal, b: ScoredProposal): number {
  return (
    b.score - a.score ||
    KIND_ORDER.indexOf(a.pairKind) - KIND_ORDER.indexOf(b.pairKind) ||
    pairDays(a) - pairDays(b) ||
    differenceShare(a).comparedTo(differenceShare(b)) ||
    a.outflow.transactionId.localeCompare(b.outflow.transactionId) ||
    a.inflow.transactionId.localeCompare(b.inflow.transactionId)
  );
}

/**
 * FR 7, FR 12: the open proposals of the scored candidates — the best first takes both its sides, and a candidate with a
 * side already taken is no proposal; each chosen one lists the candidates it beat by at most 5 points on a shared side.
 * The chosen keep the order they came in (newest first).
 */
export function chooseProposals(candidates: readonly ScoredProposal[]): ChosenProposal[] {
  const ranked = [...candidates].sort(compareProposals);
  const taken = new Set<string>();
  const chosen = new Set<ScoredProposal>();
  for (const p of ranked) {
    if (taken.has(p.outflow.transactionId) || taken.has(p.inflow.transactionId)) continue;
    taken.add(p.outflow.transactionId);
    taken.add(p.inflow.transactionId);
    chosen.add(p);
  }
  return candidates
    .filter((p) => chosen.has(p))
    .map((p) => {
      const ambiguousWith = ranked
        .filter((q) => q !== p && Math.abs(p.score - q.score) <= AMBIGUITY_POINTS)
        .flatMap((q) => {
          if (q.outflow.transactionId === p.outflow.transactionId)
            return [{ transactionId: q.inflow.transactionId, score: q.score }];
          if (q.inflow.transactionId === p.inflow.transactionId)
            return [{ transactionId: q.outflow.transactionId, score: q.score }];
          return [];
        });
      return { ...p, ambiguousWith };
    });
}
