/**
 * The account of a statement among the space's accounts (IMP-08@PoC FR 2; Рішення власника (2026-11-26, чат), row
 * 230b: «У користувача може бути багато рахунків в одному банку»). The one place of the rule; the parse step picks the
 * account with it and the step «Рахунок і файли» offers «Створити рахунок» by its outcome:
 * 1. the card or IBAN tail the file shows (`detected.mask`, «…» and 4 characters) — one account ending in it is the
 *    file's account, unless the file names a bank and that account is of another one (no account fits); several —
 *    the one of the file's bank among them, else the person picks;
 * 2. no tail on the file — the bank: the one account of that bank is the file's; several — the person picks;
 * 3. a tail no account ends in — the bank's one account only when it has no number (a number that differs is another
 *    account), else no account fits: «Створити рахунок».
 * Pure: the caller gives the detected facts and the accounts (their institution name and last 4 characters only).
 */
export const ACCOUNT_MATCHES = ["picked", "several", "none"] as const;
export type AccountMatchKind = (typeof ACCOUNT_MATCHES)[number];

export interface AccountCandidate {
  readonly accountId: string;
  readonly institution: string | null;
  readonly last4: string | null;
}

export type AccountPick =
  | { readonly kind: "picked"; readonly accountId: string }
  | { readonly kind: "several" }
  | { readonly kind: "none" };

/** A bank's name compared without case, quotes, punctuation and extra spaces («АТ “ПУМБ”» = «ат пумб»). */
const folded = (text: string): string =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .replace(/["'«»„“”’ʼ`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const TAIL = /^…([A-Za-z0-9]{4})$/u;

/** Words that name a kind of company, not a bank: they never make two names one bank («Банк», «АТ», «UAB»). */
const GENERIC = new Set([
  "банк",
  "bank",
  "ат",
  "пат",
  "прат",
  "ао",
  "тов",
  "uab",
  "ag",
  "sa",
  "ltd",
  "llc",
  "of",
  "the",
  "and",
  "і",
  "та",
]);

const distinctive = (name: string): string[] =>
  name.split(" ").filter((w) => w.length >= 2 && !GENERIC.has(w));

/**
 * Two folded bank names that may name one bank: equal, or the distinctive words (generic ones like «банк», «АТ», «UAB»
 * and one-letter words dropped) of one are all among the other's («revolut» in «revolut bank uab», «monobank» in
 * «універсал банк monobank»). A name with no distinctive word («Банк», «А») matches only an equal name. Only a clear
 * difference contradicts a tail match.
 */
const mayBeSameBank = (a: string, b: string): boolean => {
  if (a === b) return true;
  const wa = distinctive(a);
  const wb = distinctive(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.every((w) => big.includes(w));
};

/** Null when the file names neither a bank nor a tail: nothing to match by. */
export function accountFor(
  detected: { readonly bank?: string | undefined; readonly mask?: string | undefined },
  candidates: readonly AccountCandidate[],
): AccountPick | null {
  const tail = TAIL.exec(detected.mask ?? "")?.[1]?.toUpperCase() ?? null;
  const bank = detected.bank ? folded(detected.bank) : "";
  if (tail === null && bank === "") return null;
  const ofBank =
    bank === "" ? [] : candidates.filter((c) => c.institution !== null && folded(c.institution) === bank);
  const picked = (c: AccountCandidate): AccountPick => ({ kind: "picked", accountId: c.accountId });
  if (tail !== null) {
    const byTail = candidates.filter((c) => c.last4 !== null && c.last4.toUpperCase() === tail);
    if (byTail.length === 1) {
      // The one account with the tail is of another bank than the file names (review of #718): that account is not
      // the file's, so no pick, and the file's account is not among the space's — «Оберіть рахунок» and «Створити
      // рахунок» (FR 2). `several` would hide «Створити рахунок» (web `canCreateFor`).
      const only = byTail[0]!;
      const otherBank =
        bank !== "" && only.institution !== null && !mayBeSameBank(folded(only.institution), bank);
      return otherBank ? { kind: "none" } : picked(only);
    }
    if (byTail.length > 1) {
      const both = byTail.filter((c) => ofBank.includes(c));
      return both.length === 1 ? picked(both[0]!) : { kind: "several" };
    }
    return ofBank.length === 1 && ofBank[0]!.last4 === null ? picked(ofBank[0]!) : { kind: "none" };
  }
  if (ofBank.length === 1) return picked(ofBank[0]!);
  return ofBank.length > 1 ? { kind: "several" } : { kind: "none" };
}
