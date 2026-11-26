import { detectedMask } from "./account.ts";

/**
 * What a statement says about its own account (IMP-08@PoC FR 2, «Створити рахунок»; plan row 230): the bank, the
 * currency and the card or IBAN masked to its last 4 characters, for the short form of a new account when none of the
 * space's accounts fits the file. Each part is there only when the file names it unambiguously; the person fills or
 * changes the rest in the form.
 */
export interface DetectedAccount {
  /**
   * The statement's bank: the name of a bank of the directory the caller gave (`StatementOptions.institutions`), as the
   * directory has it; else the bank's name as the file prints it (`printedBank`; owner, 2026-11-26, row 230b).
   */
  readonly bank?: string;
  /** Whether `bank` is a name of the directory (true) or the name the file prints (false); absent without a bank. */
  readonly bankInDirectory?: boolean;
  /** The statement's one currency (ISO code). */
  readonly currency?: string;
  /** «…» and the last 4 characters of the card or IBAN (`maskLast4`); never more. */
  readonly mask?: string;
  /**
   * How the file's facts fit the space's accounts (import-sessions' `accountFor`, row 230b): `picked` — one account,
   * `several` — the person picks among them, `none` — no account fits («Створити рахунок»). Set by the import step
   * after the parse, never by the parse worker (the worker does not see the accounts).
   */
  readonly accountMatch?: "picked" | "several" | "none";
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

/** The bounds of a bank's name the file prints (`bankName`): accounts keep an institution's name in 100 characters. */
export const PRINTED_BANK_LIMITS = { length: 100, cellLength: 300, digits: 4, words: 6 } as const;

/**
 * A bank's name as a statement prints it, made safe to keep and show (IMP-08@PoC FR 2; owner, 2026-11-26, row 230b):
 * NFKC, control and format characters (direction marks among them) as spaces, runs of spaces as one. Null when it is
 * empty, has no letter, is longer than `PRINTED_BANK_LIMITS.length` characters, or holds more than 4 digits — a card
 * or an IBAN printed next to the name never passes as the name (the business rule of IMP-05: masked, the last 4).
 * The parse worker and the import boundary check a name with this one function.
 */
export function bankName(text: string): string | null {
  if (text.length > PRINTED_BANK_LIMITS.cellLength) return null;
  const value = text
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (value === "" || !/\p{L}/u.test(value) || [...value].length > PRINTED_BANK_LIMITS.length) return null;
  if ((value.match(/\p{Nd}/gu)?.length ?? 0) > PRINTED_BANK_LIMITS.digits) return null;
  return value;
}

/** Labels a bank's name is printed after («Банк;…», «Bank name: …»), folded. */
const BANK_LABELS: ReadonlySet<string> = new Set(["банк", "bank", "назва банку", "bank name"]);
const LABELLED = /^\s*(банк|bank|назва банку|bank name)\s*[:：]\s*(.+)$/iu;
/** Words that make a cell a title or a field, not a bank's name («Bank statement», «Рахунок у банку»). */
const NOT_A_NAME =
  /(?:^| )(?:statement|виписка|account|рахунок|рахунку|period|період|card|картка|iban|date|дата|balance|залишок)(?: |$)/u;
const BANK_WORD = /(?:^| )(?:bank|банк)(?: |$)/u;

/**
 * The bank the rows before the table print when no bank of the directory is named (owner, 2026-11-26, row 230b:
 * «визначати банк з виписки - так»): the value after a label «Банк» / «Bank» / «Назва банку» / «Bank name» (in the
 * next cell or after a colon), else a short cell that holds the word «Bank» or «Банк» with the name («Revolut Bank
 * UAB»). One name only: two different ones — null, the person picks the bank in the form.
 */
export function printedBank(preamble: readonly (readonly string[])[]): string | null {
  const one = (found: readonly (string | null)[]): string | null | "several" => {
    const names = new Set(found.filter((n): n is string => n !== null));
    return names.size === 0 ? null : names.size === 1 ? [...names][0]! : "several";
  };
  const labelled: (string | null)[] = [];
  for (const row of preamble) {
    row.forEach((cell, i) => {
      if (cell.length > PRINTED_BANK_LIMITS.cellLength) return;
      const inCell = LABELLED.exec(cell.normalize("NFKC"));
      if (inCell) labelled.push(bankName(inCell[2]!));
      else if (BANK_LABELS.has(folded(cell)) && row[i + 1] !== undefined)
        labelled.push(bankName(row[i + 1]!));
    });
  }
  const byLabel = one(labelled);
  if (byLabel !== null) return byLabel === "several" ? null : byLabel;
  const named = preamble.flat().map((cell) => {
    if (cell.length > PRINTED_BANK_LIMITS.cellLength) return null;
    const f = folded(cell);
    if (BANK_LABELS.has(f) || !BANK_WORD.test(f) || NOT_A_NAME.test(f)) return null;
    return f.split(" ").length <= PRINTED_BANK_LIMITS.words ? bankName(cell) : null;
  });
  const byWord = one(named);
  return byWord === "several" ? null : byWord;
}

/** The statement's facts about its account: bank, one currency, masked number (each only when unambiguous). */
export function detectAccount(
  preamble: readonly (readonly string[])[],
  currencies: readonly string[],
  institutions: readonly Institution[] = [],
): DetectedAccount {
  const listed = detectedBank(preamble, institutions);
  const bank = listed ?? printedBank(preamble);
  const one = [...new Set(currencies)];
  const mask = detectedMask(preamble);
  return {
    ...(bank !== null ? { bank, bankInDirectory: listed !== null } : {}),
    ...(one.length === 1 ? { currency: one[0]! } : {}),
    ...(mask !== null ? { mask } : {}),
  };
}
