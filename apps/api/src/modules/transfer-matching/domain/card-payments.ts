import type { TransferProposal } from "./matching.ts";

/**
 * BUD-01@PoC FR 7, AC4 — the one exception to «лише пропозиція»: a payment to a credit card from a known own account of
 * the space is a transfer at once, without the user's confirmation. Pure: of the proposals found (matching.ts, as
 * «Пари · N» reads them) the ones to mark now —
 * - a transfer between two accounts (`pairKind` `transfer`, never an exchange) whose credit is on a credit card of the
 *   space (`cards`) — the debit on another account of the space is the known own source;
 * - with a side among `fresh` (the transactions that have just arrived: an import batch's rows, a transaction entered by
 *   hand) — a pair the person unmarked earlier (FIN-03 FR 9) is never marked again by a later arrival of something else;
 * - unambiguous: neither side is a side of another candidate (Рішення ведучого (2026-11-27; власник не схвалював;
 *   #722 D): a debit that fits two credits, or a credit that fits two debits, stays a proposal for the person). Since
 *   the proposals are one-to-one (IMP-03 FR 12) the other candidate is no proposal any more, so the sides are counted
 *   over `candidates` — every scored candidate of the read, the proposals among them; whatever the points between them
 *   (stricter than «неоднозначно з…» of IMP-03 FR 7, issue #731).
 * A credit on a card with no debit of the space that fits it (the source unknown) is no proposal at all, so it stays an
 * income until the person confirms a transfer (Рішення ведучого 2026-11-26, BUD-01 FR 7).
 */
export function cardPaymentsOf(
  proposals: readonly TransferProposal[],
  cards: ReadonlySet<string>,
  fresh: (transactionId: string) => boolean,
  candidates: readonly TransferProposal[] = proposals,
): readonly TransferProposal[] {
  const uses = new Map<string, number>();
  for (const p of candidates)
    for (const id of [p.outflow.transactionId, p.inflow.transactionId]) uses.set(id, (uses.get(id) ?? 0) + 1);
  return proposals.filter(
    (p) =>
      p.pairKind === "transfer" &&
      p.outflow.accountId !== p.inflow.accountId &&
      cards.has(p.inflow.accountId) &&
      (fresh(p.outflow.transactionId) || fresh(p.inflow.transactionId)) &&
      uses.get(p.outflow.transactionId) === 1 &&
      uses.get(p.inflow.transactionId) === 1,
  );
}
