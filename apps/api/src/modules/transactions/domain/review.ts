/**
 * «До розбору» (BUD-12@PoC FR 2–10): the space's one queue of transactions whose category is to be confirmed. No status
 * «переглянуто» of its own (FR 4): «Підтвердити» confirms the category, and the transaction leaves the queue. Pure
 * rules, no I/O.
 */

/** `queued` — in «До розбору»; `confirmed` — its category confirmed. A transaction never queued has none (null). */
export const REVIEW_STATES = ["queued", "confirmed"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * FR 8, FR 9: the fixed rule of the queue, with no settings — every new transaction imported from a statement file goes
 * into the queue (a «Можливий дубль» among them, whatever the rule); one entered by hand never does.
 */
export function reviewOnCreate(origin: { readonly importedFromStatement: boolean }): ReviewState | null {
  return origin.importedFromStatement ? "queued" : null;
}

/**
 * FR 4: «Підтвердити» (and «Змінити категорію», which confirms the category it sets) — a queued transaction leaves the
 * queue; one confirmed already stays so (nothing to do); one never queued cannot be confirmed here.
 */
export function confirmReview(state: ReviewState | null): ReviewState | "unchanged" | "not-queued" {
  if (state === "queued") return "confirmed";
  if (state === "confirmed") return "unchanged";
  return "not-queued";
}

/**
 * FR 6: «Відмінити» of a confirmation — the card returns with its previous state, back in the queue; one in the queue
 * already stays so; one never queued is not put there.
 */
export function reopenReview(state: ReviewState | null): ReviewState | "unchanged" | "not-queued" {
  if (state === "confirmed") return "queued";
  if (state === "queued") return "unchanged";
  return "not-queued";
}
