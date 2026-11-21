import { currencyInfo, Decimal, isCurrencyCode, Money } from "@willowsum/domain-kernel";

/**
 * Rules of a transaction entered by hand (FIN-03@PoC FR 2, FR 3, FR 28, FR 29, edge case 2), pure: what the form may
 * send and what each field becomes. The amount is signed in the account's currency — plus «надходження» (income),
 * minus «списання» (expense) — and never a float (Decimal of domain-kernel).
 */

export const COUNTERPARTY_MAX = 200;
export const DESCRIPTION_MAX = 1000;
/** The earliest date a transaction may be dated (the same bound as an account's balance date; a lead decision). */
export const EARLIEST_DATE = "1900-01-01";
/**
 * FR 24: «Проведена» or «Очікує». «Очікує» is not in the journal: it changes no balance until it is posted (FR 4).
 */
export const TRANSACTION_STATUSES = ["posted", "pending"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
/** «imported» — written by the apply of an import batch (IMP-01@PoC FR 11; #637). */
export const TRANSACTION_SOURCES = ["manual", "imported"] as const;
/** FR 3: «надходження» is income, «списання» an expense. */
export const TRANSACTION_TYPES = ["income", "expense"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type FieldIssue = {
  readonly field: string;
  readonly issue:
    | "invalid"
    | "zero"
    | "date_in_future"
    | "currency_mismatch"
    | "not_found"
    // A split (splits.ts): the number of parts or months, a part's sign, the parts' sum, a part's category.
    | "count"
    | "sign"
    | "sum_mismatch"
    | "kind_mismatch"
    // A transfer (transfers.ts): a side that may not be one, or a pair that is not a transfer.
    | "pending"
    | "hidden"
    | "split"
    | "in_transfer"
    | "same_account"
    | "same_direction"
    | "amount_mismatch"
    | "rate_unavailable"
    // A merge of duplicates (duplicates.ts): a side merged already, one that others were merged into, another account.
    | "merged"
    | "has_duplicates"
    | "account_mismatch"
    // The attributes (attributes.ts, BUD-13 FR 2): more than 20 tags on a transaction — «Досягнуто 20 тегів».
    | "too_many"
    // «Одноразова витрата» (attributes.ts, BUD-06 FR 8): only an expense is marked.
    | "not_expense";
};

const AMOUNT_RE = /^-?\d{1,20}(?:\.\d{1,18})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
const VISIBLE = /[^\s\p{Cf}\p{Z}]/u;

/** A signed amount with at most the currency's minor units; `zero` for 0 (a transaction moves money), else invalid. */
export function parseSignedAmount(text: string, currency: string): Money | "invalid" | "zero" {
  if (!AMOUNT_RE.test(text) || !isCurrencyCode(currency)) return "invalid";
  const amount = new Decimal(text);
  if (amount.decimalPlaces() > currencyInfo(currency).minorUnits) return "invalid";
  if (amount.isZero()) return "zero";
  try {
    return Money.of(amount, currency);
  } catch {
    return "invalid";
  }
}

/** A calendar date YYYY-MM-DD from 1900 on. */
export function isCalendarDay(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (m === null) return false;
  const iso = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10);
  return iso === value && value >= EARLIEST_DATE;
}

/** «Дата» (FR 29): a calendar date, never after today (planned payments are «Регулярні платежі»). */
export function checkDate(value: string, today: string): FieldIssue["issue"] | null {
  if (!isCalendarDay(value)) return "invalid";
  return value > today ? "date_in_future" : null;
}

/** «Контрагент»: one line, NFC, trimmed, 1–200 code points; empty — none; undefined — invalid. */
export function counterpartyText(text: string): string | null | undefined {
  const value = text.normalize("NFC").trim();
  if (value === "") return null;
  if ([...value].length > COUNTERPARTY_MAX || CONTROL.test(value) || BIDI.test(value) || !VISIBLE.test(value))
    return undefined;
  return value;
}

/** «Опис»: up to 1 000 code points, line feeds allowed; empty — none; undefined — invalid. */
export function descriptionText(text: string): string | null | undefined {
  const value = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (value === "") return null;
  if ([...value].length > DESCRIPTION_MAX || BIDI.test(value) || CONTROL.test(value.replaceAll("\n", "")))
    return undefined;
  return value;
}

/** FR 3: the type of a signed amount. */
export function typeOf(amount: Money): TransactionType {
  return amount.isNegative() ? "expense" : "income";
}

/** A subaccount (one currency) of a money account, as the accounts module answers it. */
export interface PostingAccount {
  readonly accountId: string;
  /** Accounts' kind (`ACCOUNT_KINDS`), when the directory gives it. */
  readonly kind?: string;
  readonly status: "active" | "closed";
  readonly subaccounts: readonly {
    readonly subaccountId: string;
    readonly currency: string;
    readonly ledgerAccountId: string;
  }[];
}

/**
 * The subaccount an amount goes to (FR 2, edge case 2): the account's currency, or on a multi-currency account the
 * subaccount of that currency; another currency is «Валюта не відповідає рахунку».
 */
export function subaccountFor(
  account: PostingAccount,
  currency: string,
): PostingAccount["subaccounts"][number] | "currency_mismatch" {
  return account.subaccounts.find((s) => s.currency === currency) ?? "currency_mismatch";
}
