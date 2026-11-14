import {
  currencyInfo,
  Decimal,
  DomainError,
  isCalendarDate,
  isCurrencyCode,
  Money,
} from "@willowsum/domain-kernel";

/**
 * Money accounts of a space (FIN-01@PoC FR 1–8, FR 12, FR 25; FIN-12@PoC FR 11, FR 13): their kinds and groups, the
 * fields of «Новий рахунок» by kind, the account number kept sealed and shown as its last 4 characters, and the
 * duplicate rule. Pure rules, no I/O.
 */

/** «Поточний» (the default), «Ощадний», «Депозит», «Готівка», «Кредитна картка», «Кредит» (FIN-01 FR 1). */
export const ACCOUNT_KINDS = ["current", "savings", "deposit", "cash", "credit-card", "loan"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const DEFAULT_ACCOUNT_KIND: AccountKind = "current";

/** «Готівкові» and «Кредитні» (FIN-01 FR 14, FR 19). */
export type AccountGroup = "cash" | "credit";

export function groupOf(kind: AccountKind): AccountGroup {
  return kind === "credit-card" || kind === "loan" ? "credit" : "cash";
}

/** The ledger type of an account's subaccounts: a debt is a liability (FIN-01 FR 2, FR 16). */
export function ledgerTypeOf(kind: AccountKind): "asset" | "liability" {
  return groupOf(kind) === "credit" ? "liability" : "asset";
}

export const ACCOUNT_STATUSES = ["active", "closed"] as const;
export const ACCOUNT_SOURCES = ["manual", "import"] as const;

/** Lead decisions (FIN-01): name up to 80 characters, institution name up to 100, note up to 1 000 (FR 3). */
export const ACCOUNT_NAME_MAX = 80;
export const INSTITUTION_NAME_MAX = 100;
export const NOTE_MAX = 1000;
/** A multi-currency current account holds at most this many currencies (a lead decision). */
export const CURRENCIES_MAX = 10;
/** The earliest date a balance or a deposit may be dated (a lead decision). */
export const EARLIEST_DATE = "1900-01-01";

// Characters that would break one line or reorder what is shown: control characters (any in a one-line field; in a
// note all but the line feed), the line and paragraph separators and the bidi controls.
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const LINE_BREAKERS = /[\p{Cc}\u2028\u2029]/u;
const NOTE_BREAKERS = /[\p{Cc}\u2028\u2029]/u;
const VISIBLE = /[^\s\p{Cf}\p{Z}]/u;

/** One line of text: NFC, trimmed, 1–`max` code points, without line breaks or bidi controls; else null. */
export function oneLine(text: string, max: number): string | null {
  const value = text.normalize("NFC").trim();
  const length = [...value].length;
  if (length < 1 || length > max || LINE_BREAKERS.test(value) || BIDI.test(value) || !VISIBLE.test(value))
    return null;
  return value;
}

/** «Нотатка» (FIN-01 FR 3): up to 1 000 code points, line feeds allowed; empty — no note; else undefined (invalid). */
export function noteText(text: string): string | null | undefined {
  const value = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (value === "") return null;
  if ([...value].length > NOTE_MAX || BIDI.test(value)) return undefined;
  if (NOTE_BREAKERS.test(value.replaceAll("\n", ""))) return undefined;
  return value;
}

/** «Банк або установа» (FIN-01 FR 4): a name and an ISO 3166-1 alpha-2 country. */
export interface Institution {
  readonly name: string;
  readonly country: string;
}

const COUNTRY_RE = /^[A-Z]{2}$/;

export function institutionOf(input: { name: string; country: string }): Institution | null {
  const name = oneLine(input.name, INSTITUTION_NAME_MAX);
  if (name === null || !COUNTRY_RE.test(input.country)) return null;
  return { name, country: input.country };
}

/**
 * The key two institutions are «the same» by (FIN-01 FR 25): the name without case and repeated spaces, and the
 * country. No institution has its own key.
 */
export function institutionKey(institution: Institution | null): string {
  if (!institution) return "-";
  return `${institution.country}|${institution.name.toLocaleLowerCase("uk").replace(/\s+/gu, " ")}`;
}

/**
 * «Номер · останні 4 цифри / IBAN» (FIN-01 FR 3, business rule; FIN-12 FR 4). Either the last 4 characters only, or
 * a full IBAN or account number, which is kept sealed and never shown or answered in full. A full card number is never
 * taken (FIN-12 FR 4: «повний номер картки не вводиться і не зберігається»).
 */
export interface AccountNumber {
  readonly last4: string;
  /** The full IBAN or account number, normalized (no spaces, upper case); null — only the last 4 were given. */
  readonly full: string | null;
}

export type NumberIssue = "invalid" | "card_number_not_allowed";

const LAST4_RE = /^[A-Z0-9]{4}$/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const ACCOUNT_RE = /^[A-Z0-9]{5,34}$/;
const PAN_RE = /^\d{13,19}$/;

/** ISO 13616 check: the IBAN with its first four characters moved to the end, letters as 10–35, mod 97 = 1. */
function ibanValid(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** The Luhn check of payment card numbers. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function parseAccountNumber(text: string): AccountNumber | NumberIssue {
  const n = text.replace(/[\s-]/gu, "").toUpperCase();
  if (LAST4_RE.test(n)) return { last4: n, full: null };
  if (PAN_RE.test(n) && luhnValid(n)) return "card_number_not_allowed";
  if (IBAN_RE.test(n)) return ibanValid(n) ? { last4: n.slice(-4), full: n } : "invalid";
  if (ACCOUNT_RE.test(n)) return { last4: n.slice(-4), full: n };
  return "invalid";
}

/** How a number is shown everywhere, the audit log included (FIN-01 AC7, AC15): «••1234». */
export function maskedNumber(last4: string): string {
  return `••${last4}`;
}

/**
 * The same number (FIN-01 FR 25 and its assumption): by the full number or IBAN when both are kept, otherwise by the
 * last 4 characters.
 */
export function sameNumber(a: AccountNumber, b: AccountNumber): boolean {
  if (a.full !== null && b.full !== null) return a.full === b.full;
  return a.last4 === b.last4;
}

const RATE_RE = /^\d{1,3}(?:\.\d{1,2})?$/;
const AMOUNT_RE = /^\d{1,20}(?:\.\d{1,18})?$/;

/** «% річних» (FIN-01 FR 3, FR 8): 0–100 with at most two decimals, as a canonical decimal string; else null. */
export function parseAnnualRate(text: string): string | null {
  if (!RATE_RE.test(text)) return null;
  const rate = new Decimal(text);
  return rate.greaterThan(100) ? null : rate.toFixed();
}

/** A typed non-negative amount with at most the currency's minor units (2 for EUR, 0 for JPY); else null. */
export function parseTypedAmount(text: string, currency: string): Money | null {
  if (!AMOUNT_RE.test(text) || !isCurrencyCode(currency)) return null;
  const amount = new Decimal(text);
  if (amount.decimalPlaces() > currencyInfo(currency).minorUnits) return null;
  try {
    return Money.of(amount, currency);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * A loan's or a credit card's terms as typed, for the `liabilities` module, which checks them (FIN-01 FR 2, FR 5,
 * FR 16): the same shape as its `LiabilityTermsInput`.
 */
export interface LiabilityTermsDraft {
  readonly kind: "loan" | "credit-card";
  readonly currency: string;
  readonly annualRate: string | null;
  readonly monthlyPayment: string | null;
  readonly creditLimit: string | null;
  readonly gracePeriodDays: number | null;
}

/** A currency of a new account with its opening balance as typed (positive: money held, or the debt). */
export interface OpeningBalance {
  readonly balance: Money;
  /** «На дату*» */
  readonly date: string;
}

/** What «Новий рахунок» sends, flat as the steps are (FIN-01 FR 3). */
export interface NewAccountInput {
  readonly kind: AccountKind;
  readonly name: string;
  readonly institution?: { readonly name: string; readonly country: string } | null | undefined;
  /** «Залишок*» (for a credit card and a loan «Залишок боргу*», the debt) and «Валюта*». */
  readonly balance: { readonly amount: string; readonly currency: string };
  readonly balanceDate: string;
  /** «+ додати ще валюту» (FR 12): further currencies of a current account. */
  readonly extraCurrencies?:
    | readonly { readonly amount: string; readonly currency: string; readonly date: string }[]
    | null
    | undefined;
  readonly number?: string | null | undefined;
  readonly note?: string | null | undefined;
  /** «Ощадний», «Депозит»: the rate; «Кредит», «Кредитна картка»: the liability's rate. */
  readonly annualRate?: string | null | undefined;
  readonly depositOpenedOn?: string | null | undefined;
  readonly depositMaturesOn?: string | null | undefined;
  readonly creditLimit?: string | null | undefined;
  readonly gracePeriodDays?: number | null | undefined;
  readonly monthlyPayment?: string | null | undefined;
}

export interface NewAccount {
  readonly kind: AccountKind;
  readonly name: string;
  readonly institution: Institution | null;
  readonly number: AccountNumber | null;
  readonly note: string | null;
  /** «Ощадний», «Депозит»: percent per year; null otherwise or not given. */
  readonly annualRate: string | null;
  readonly depositOpenedOn: string | null;
  readonly depositMaturesOn: string | null;
  /** The account's opening date: the deposit's opening date, else the earliest balance date (FR 6). */
  readonly openedOn: string;
  /** The first is the main currency. */
  readonly currencies: readonly OpeningBalance[];
  /** A loan's or a credit card's terms for the `liabilities` module (checked there); null for a cash account. */
  readonly liability: LiabilityTermsDraft | null;
}

export interface FieldIssue {
  readonly field: string;
  readonly issue: string;
}

const given = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const SIGNED_RE = /^-\d/;

function date(text: string): string | null {
  return isCalendarDate(text) && text >= EARLIEST_DATE ? text : null;
}

/**
 * A typed opening balance: not negative, except on a current account (an overdraft); at most the currency's minor
 * units.
 */
export function openingAmount(kind: AccountKind, amount: string, currency: string): Money | null {
  const negative = SIGNED_RE.test(amount);
  if (negative && kind !== "current") return null;
  const typed = parseTypedAmount(negative ? amount.slice(1) : amount, currency);
  if (!typed) return null;
  return negative ? typed.negated() : typed;
}

/**
 * Checks «Новий рахунок» (FIN-01 FR 1–5, FR 8, FR 12): the required fields (kind, name, balance, currency, balance
 * date) and the fields of the kind; fields of another kind are refused rather than dropped. A loan's and a credit
 * card's own terms (for a loan the required rate and monthly payment) are checked by `liabilities` (`checkTerms`).
 */
export function checkNewAccount(
  input: NewAccountInput,
): { readonly account: NewAccount } | { readonly issues: readonly FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const bad = (field: string, issue = "invalid") => issues.push({ field, issue });
  const kind = input.kind;
  const onlyFor = (field: keyof NewAccountInput, kinds: readonly AccountKind[]) => {
    if (given(input[field]) && !kinds.includes(kind)) bad(field, "not_allowed");
  };

  const name = oneLine(input.name, ACCOUNT_NAME_MAX);
  if (name === null) bad("name");

  let institution: Institution | null = null;
  if (given(input.institution)) {
    institution = institutionOf(input.institution);
    if (!institution) bad("institution");
  }

  const currencies: OpeningBalance[] = [];
  const main = input.balance;
  if (!isCurrencyCode(main.currency)) bad("balance.currency");
  else {
    const balance = openingAmount(kind, main.amount, main.currency);
    if (!balance) bad("balance.amount");
    const day = date(input.balanceDate);
    if (!day) bad("balanceDate");
    if (balance && day) currencies.push({ balance, date: day });
  }

  onlyFor("extraCurrencies", ["current"]);
  if (kind === "current" && given(input.extraCurrencies)) {
    const seen = new Set([main.currency]);
    if (input.extraCurrencies.length + 1 > CURRENCIES_MAX) bad("extraCurrencies", "too_many");
    input.extraCurrencies.forEach((extra, i) => {
      const at = `extraCurrencies.${i}`;
      if (!isCurrencyCode(extra.currency)) return bad(`${at}.currency`);
      if (seen.has(extra.currency)) return bad(`${at}.currency`, "duplicate");
      seen.add(extra.currency);
      const balance = openingAmount(kind, extra.amount, extra.currency);
      const day = date(extra.date);
      if (!balance) bad(`${at}.amount`);
      if (!day) bad(`${at}.date`);
      if (balance && day) currencies.push({ balance, date: day });
    });
  }

  let number: AccountNumber | null = null;
  if (given(input.number) && input.number.trim() !== "") {
    const parsed = parseAccountNumber(input.number);
    if (typeof parsed === "string") bad("number", parsed);
    else number = parsed;
  }

  let note: string | null = null;
  if (given(input.note)) {
    const parsed = noteText(input.note);
    if (parsed === undefined) bad("note");
    else note = parsed;
  }

  onlyFor("annualRate", ["savings", "deposit", "credit-card", "loan"]);
  onlyFor("depositOpenedOn", ["deposit"]);
  onlyFor("depositMaturesOn", ["deposit"]);
  onlyFor("creditLimit", ["credit-card"]);
  onlyFor("gracePeriodDays", ["credit-card"]);
  onlyFor("monthlyPayment", ["loan"]);

  let annualRate: string | null = null;
  if ((kind === "savings" || kind === "deposit") && given(input.annualRate)) {
    annualRate = parseAnnualRate(input.annualRate);
    if (annualRate === null) bad("annualRate");
  }

  let depositOpenedOn: string | null = null;
  let depositMaturesOn: string | null = null;
  if (kind === "deposit") {
    if (given(input.depositOpenedOn)) {
      depositOpenedOn = date(input.depositOpenedOn);
      if (!depositOpenedOn) bad("depositOpenedOn");
    }
    if (given(input.depositMaturesOn)) {
      depositMaturesOn = date(input.depositMaturesOn);
      if (!depositMaturesOn) bad("depositMaturesOn");
    }
    if (depositOpenedOn && depositMaturesOn && depositMaturesOn <= depositOpenedOn)
      bad("depositMaturesOn", "before_opening");
  }

  const liability: LiabilityTermsDraft | null =
    kind === "credit-card" || kind === "loan"
      ? {
          kind,
          currency: main.currency,
          annualRate: input.annualRate ?? null,
          monthlyPayment: input.monthlyPayment ?? null,
          creditLimit: input.creditLimit ?? null,
          gracePeriodDays: input.gracePeriodDays ?? null,
        }
      : null;

  if (issues.length > 0 || name === null) return { issues };
  const earliest = currencies.map((c) => c.date).sort()[0]!;
  return {
    account: {
      kind,
      name,
      institution,
      number,
      note,
      annualRate,
      depositOpenedOn,
      depositMaturesOn,
      openedOn: depositOpenedOn ?? earliest,
      currencies,
      liability,
    },
  };
}

/**
 * The amount of the ledger event «Початковий залишок» (FIN-01 FR 7): signed from the holder's side, so the debt of a
 * credit card or a loan is negative (its liability grows). Zero moves nothing: no event is posted.
 */
export function openingEventAmount(kind: AccountKind, typed: Money): Money {
  return groupOf(kind) === "credit" ? typed.negated() : typed;
}

/** The balance shown for an account from its ledger balance (sign of the ledger type): a debt is shown negative. */
export function shownBalance(kind: AccountKind, ledgerBalance: Money): Money {
  return groupOf(kind) === "credit" ? ledgerBalance.negated() : ledgerBalance;
}

/** «Owner простору з часткою 100 % з дати відкриття рахунку» (FIN-01 FR 6, AC17; FIN-12 FR 13). */
export const OWNER_SHARE = new Decimal("100");
