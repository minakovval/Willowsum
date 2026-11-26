import { detectedMask } from "./account.ts";

/**
 * What a statement says about its own account (IMP-08@PoC FR 2, «Створити рахунок»; plan row 230): the bank, the
 * currency and the card or IBAN masked to its last 4 characters, for the short form of a new account when none of the
 * space's accounts fits the file. Each part is there only when the file names it unambiguously; the person fills or
 * changes the rest in the form.
 */
export interface DetectedAccount {
  /** The name of a bank of the directory the caller gave (`StatementOptions.institutions`), as the directory has it. */
  readonly bank?: string;
  /** The statement's one currency (ISO code). */
  readonly currency?: string;
  /** «…» and the last 4 characters of the card or IBAN (`maskLast4`); never more. */
  readonly mask?: string;
}

/** A bank of the directory as the caller gives it (accounts' NBU directory: the display name and the legal name). */
export interface Institution {
  readonly name: string;
  readonly legalName?: string;
}

/** The directory is bounded before it reaches the worker's search (the preamble is untrusted, the directory is not). */
export const INSTITUTION_LIMITS = { count: 1000, nameLength: 300, aliasMin: 3 } as const;

/** NFKC, lower case, no quotes, every run of other non-letters and non-digits one space. */
function folded(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .replace(/["'«»„“”’ʼ`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The texts a bank is printed under: its name, its legal name, and for a name with a part in brackets
 * («Універсал Банк (monobank)») each part alone. Folded; shorter than `aliasMin` characters — left out.
 */
function aliasesOf(bank: Institution): string[] {
  const names = [bank.name, ...(bank.legalName ? [bank.legalName] : [])];
  const bracket = /^(.*?)\s*\(([^()]+)\)\s*$/u.exec(bank.name);
  if (bracket) names.push(bracket[1]!, bracket[2]!);
  return [...new Set(names.map(folded))].filter((a) => a.length >= INSTITUTION_LIMITS.aliasMin);
}

/**
 * The bank the rows before the table name (Рішення ведучого (2026-11-26; власник не схвалював; row 230)): a cell that
 * is, or holds as whole words, one of a directory bank's names after folding (case, quotes, punctuation, spaces) —
 * an exact or normalised match only, no fuzzy one. No bank, or cells naming two different banks — null: the person
 * picks the bank in the form.
 */
export function detectedBank(
  preamble: readonly (readonly string[])[],
  institutions: readonly Institution[],
): string | null {
  const cells = preamble
    .flat()
    .map(folded)
    .filter((c) => c !== "")
    .map((c) => ` ${c} `);
  if (cells.length === 0) return null;
  const found = new Set<string>();
  for (const bank of institutions.slice(0, INSTITUTION_LIMITS.count)) {
    if (bank.name.length > INSTITUTION_LIMITS.nameLength) continue;
    if (aliasesOf(bank).some((alias) => cells.some((c) => c.includes(` ${alias} `)))) found.add(bank.name);
    if (found.size > 1) return null;
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** The statement's facts about its account: bank, one currency, masked number (each only when unambiguous). */
export function detectAccount(
  preamble: readonly (readonly string[])[],
  currencies: readonly string[],
  institutions: readonly Institution[] = [],
): DetectedAccount {
  const bank = detectedBank(preamble, institutions);
  const one = [...new Set(currencies)];
  const mask = detectedMask(preamble);
  return {
    ...(bank !== null ? { bank } : {}),
    ...(one.length === 1 ? { currency: one[0]! } : {}),
    ...(mask !== null ? { mask } : {}),
  };
}
