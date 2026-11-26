import { useEffect, useRef, useState } from "react";
import type { operations } from "@willowsum/api-contract";
import type { MessageKey } from "@willowsum/i18n";
import { currencyInfo, knownCurrencies } from "@willowsum/domain-kernel";
import { amountInPlaces } from "@willowsum/ui";
import { outcome, type useAuthApi } from "../auth/api.ts";

/**
 * S-052 «Новий рахунок» (FIN-01@PoC FR 1, FR 3–5, FR 8, FR 12, FR 25): the values of the three steps, the checks the
 * form makes before it sends anything, and the body of `POST /v1/accounts`. The server checks everything again
 * (module `accounts`, `checkNewAccount`); these checks only say early what it would refuse. Amounts stay decimal
 * strings from the field to the request (AGENTS.md money rule).
 */
export type NewAccountBody = operations["createAccount"]["requestBody"]["content"]["application/json"];
export type AccountKind = NewAccountBody["kind"];

/** FIN-01@PoC FR 1: the order of the list, «Поточний» by default. */
export const KINDS: readonly AccountKind[] = ["current", "savings", "deposit", "cash", "credit-card", "loan"];

export const KIND_LABEL: Readonly<Record<AccountKind, MessageKey>> = {
  current: "accounts.kind.current",
  savings: "accounts.kind.savings",
  deposit: "accounts.kind.deposit",
  cash: "accounts.kind.cash",
  "credit-card": "accounts.kind.creditCard",
  loan: "accounts.kind.loan",
};

export const KIND_DESCRIPTION: Readonly<Record<AccountKind, MessageKey>> = {
  current: "newAccount.type.desc.current",
  savings: "newAccount.type.desc.savings",
  deposit: "newAccount.type.desc.deposit",
  cash: "newAccount.type.desc.cash",
  "credit-card": "newAccount.type.desc.creditCard",
  loan: "newAccount.type.desc.loan",
};

/** The value of «Банк або установа» that stands for «Інша установа» (a bank code is 6 digits, so it never clashes). */
export const OTHER_INSTITUTION = "other";

/** The limits of the server (module `accounts`, lead decisions 2026-11-14, FIN-01). */
export const NAME_MAX = 80;
export const INSTITUTION_MAX = 100;
export const NOTE_MAX = 1000;
export const CURRENCIES_MAX = 10;
export const EARLIEST_DATE = "1900-01-01";

/** One more currency of a current account («+ додати ще валюту», FR 12). */
export interface ExtraCurrency {
  /** A key of the row on screen only. */
  readonly key: number;
  currency: string;
  amount: string | null;
  /** The amount field shows its own problem (not a number, too many decimals). */
  amountProblem: boolean;
}

export interface NewAccountValues {
  kind: AccountKind;
  name: string;
  /** A bank code of the NBU directory, `OTHER_INSTITUTION` or `""` (none). */
  bank: string;
  otherName: string;
  country: string;
  balance: string | null;
  balanceProblem: boolean;
  currency: string;
  date: string;
  number: string;
  rate: string;
  openedOn: string;
  maturesOn: string;
  creditLimit: string | null;
  creditLimitProblem: boolean;
  grace: string;
  monthly: string | null;
  monthlyProblem: boolean;
  extras: ExtraCurrency[];
  note: string;
}

export function initialValues(today: string, kind: AccountKind = "current"): NewAccountValues {
  return {
    kind,
    name: "",
    bank: "",
    otherName: "",
    country: "",
    balance: null,
    balanceProblem: false,
    currency: "",
    date: today,
    number: "",
    rate: "",
    openedOn: "",
    maturesOn: "",
    creditLimit: null,
    creditLimitProblem: false,
    grace: "",
    monthly: null,
    monthlyProblem: false,
    extras: [],
    note: "",
  };
}

/**
 * What a statement says about its account (IMP-08@PoC FR 2, AC 16; `files[].detected` of `GET /v1/import/batches/{id}/parse`):
 * the form «Додати рахунок» opens filled with it. `mask` is «…» and the last 4 characters of the card or IBAN, as the
 * server masks it; never more reaches the form.
 */
export interface Prefill {
  readonly bank?: string | undefined;
  readonly currency?: string | undefined;
  readonly mask?: string | undefined;
}

const MASK_RE = /^…([A-Z0-9]{4})$/u;

/** The last 4 characters of a masked number «…1234», or `""` for anything else (a longer text is never taken). */
export const maskTail = (mask: string | undefined): string => MASK_RE.exec(mask ?? "")?.[1] ?? "";

/** The values of the form for a statement's account: its currency and card or IBAN tail, the bank's name as the name. */
export function prefilledValues(
  today: string,
  prefill: Prefill,
  kind: AccountKind = "current",
): NewAccountValues {
  const start = initialValues(today, kind);
  const currency = knownCurrencies().some((c) => c.kind === "fiat" && c.code === prefill.currency)
    ? (prefill.currency ?? "")
    : "";
  return {
    ...start,
    name: prefill.bank && [...prefill.bank].length <= NAME_MAX ? prefill.bank : "",
    currency,
    number: maskTail(prefill.mask),
  };
}

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const CONTROL = /[\p{Cc}\u2028\u2029]/u;

/** «Назва*»: one line of 1–80 characters, no control or direction marks (the server's `oneLine`). */
export function nameProblem(text: string): MessageKey | null {
  const value = text.normalize("NFC").trim();
  if (value === "") return null;
  if ([...value].length > NAME_MAX) return "newAccount.error.name.long";
  if (CONTROL.test(value) || BIDI.test(value)) return "newAccount.error.name.invalid";
  return null;
}

export function institutionNameProblem(text: string): MessageKey | null {
  const value = text.normalize("NFC").trim();
  if ([...value].length > INSTITUTION_MAX) return "newAccount.error.institution.long";
  if (CONTROL.test(value) || BIDI.test(value)) return "newAccount.error.institution.long";
  return null;
}

const LAST4_RE = /^[A-Z0-9]{4}$/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const ACCOUNT_RE = /^[A-Z0-9]{5,34}$/;
const PAN_RE = /^\d{13,19}$/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(iban: string): boolean {
  let remainder = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** The number as the server keeps it: no spaces or dashes, upper case. */
export const normalNumber = (text: string): string => text.replace(/[\s-]/gu, "").toUpperCase();

/**
 * «Номер · останні 4 цифри / IBAN» (FIN-01@PoC FR 3, FIN-12 FR 4): the last 4 characters, an IBAN with a valid check
 * (ISO 13616) or an account number of 5–34 characters; a full card number is refused and never sent.
 */
export function numberProblem(text: string): MessageKey | null {
  const n = normalNumber(text);
  if (n === "" || LAST4_RE.test(n)) return null;
  if (PAN_RE.test(n) && luhnValid(n)) return "newAccount.error.number.card";
  if (IBAN_RE.test(n)) return ibanValid(n) ? null : "newAccount.error.number";
  return ACCOUNT_RE.test(n) ? null : "newAccount.error.number";
}

const RATE_RE = /^\d{1,3}(?:\.\d{1,2})?$/;

/** «Ставка, % річних»: 0–100 with at most two decimals, the comma read as the point; the canonical text or null. */
export function parseRate(text: string): string | null {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!RATE_RE.test(t)) return null;
  const [whole = "0", fraction = ""] = t.split(".");
  const value = Number.parseInt(whole, 10);
  // A percent, not an amount: compared as whole and fraction digits, never as a float.
  if (value > 100 || (value === 100 && /[1-9]/.test(fraction))) return null;
  return fraction ? `${String(value)}.${fraction}` : String(value);
}

/** «Пільговий період, днів»: a whole number 0–365, or null. */
export function parseGrace(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const days = Number.parseInt(t, 10);
  return days <= 365 ? days : null;
}

export const isNegative = (amount: string | null): boolean => amount !== null && amount.startsWith("-");
export const isPositive = (amount: string | null): boolean =>
  amount !== null && !isNegative(amount) && /[1-9]/.test(amount);

/** The fields of step 3 that a kind has (FR 3, FR 8, FR 12). */
export const hasRate = (k: AccountKind) => k === "savings" || k === "deposit" || k === "loan";
export const hasDepositDates = (k: AccountKind) => k === "deposit";
/** A kind that may be a card: «Повний номер картки не вводьте…» under «Номер». */
export const hasCardNumber = (k: AccountKind) => k === "current" || k === "credit-card";
export const hasCardTerms = (k: AccountKind) => k === "credit-card";
export const hasMonthly = (k: AccountKind) => k === "loan";
export const hasExtraCurrencies = (k: AccountKind) => k === "current";
/** A credit card's and a loan's balance is the debt, typed without a minus. */
export const isDebt = (k: AccountKind) => k === "credit-card" || k === "loan";

export interface Bank {
  readonly code: string;
  readonly name: string;
  readonly country: string;
}

/** The institution the account gets: a bank of the directory with «Україна», or «Інша установа» as typed. */
export function institutionOf(
  v: NewAccountValues,
  banks: readonly Bank[],
): { name: string; country: string } | null {
  if (v.bank === OTHER_INSTITUTION) {
    const name = v.otherName.trim();
    return name && v.country ? { name, country: v.country } : null;
  }
  const bank = banks.find((b) => b.code === v.bank);
  return bank ? { name: bank.name, country: bank.country } : null;
}

/**
 * An amount with exactly the digits of its currency as the server counts them (`domain-kernel`): «1200.00» for JPY is
 * sent as «1200». A value with more significant digits is never valid in the form (FR 3); it is sent as it is only if
 * that check were bypassed, and the server refuses it.
 */
function amountIn(amount: string, currency: string): string {
  return amount && currency ? (amountInPlaces(amount, currencyInfo(currency).minorUnits) ?? amount) : amount;
}

/** The request of «Додати рахунок»: only the fields of the chosen kind (the server refuses a field of another kind). */
export function bodyOf(v: NewAccountValues, banks: readonly Bank[]): NewAccountBody {
  const k = v.kind;
  const number = normalNumber(v.number);
  const note = v.note.trim();
  const rate = parseRate(v.rate);
  const grace = parseGrace(v.grace);
  return {
    kind: k,
    name: v.name.normalize("NFC").trim(),
    institution: institutionOf(v, banks),
    balance: { amount: amountIn(v.balance ?? "", v.currency), currency: v.currency },
    balanceDate: v.date,
    ...(number ? { number } : {}),
    ...(note ? { note } : {}),
    ...(hasRate(k) && rate !== null ? { annualRate: rate } : {}),
    ...(hasDepositDates(k) && v.openedOn ? { depositOpenedOn: v.openedOn } : {}),
    ...(hasDepositDates(k) && v.maturesOn ? { depositMaturesOn: v.maturesOn } : {}),
    ...(hasCardTerms(k) && v.creditLimit !== null
      ? { creditLimit: amountIn(v.creditLimit, v.currency) }
      : {}),
    ...(hasCardTerms(k) && grace !== null ? { gracePeriodDays: grace } : {}),
    ...(hasMonthly(k) && v.monthly !== null ? { monthlyPayment: amountIn(v.monthly, v.currency) } : {}),
    ...(hasExtraCurrencies(k) && v.extras.length > 0
      ? {
          extraCurrencies: v.extras.map((e) => ({
            amount: amountIn(e.amount ?? "", e.currency),
            currency: e.currency,
            date: v.date,
          })),
        }
      : {}),
  };
}

type Api = ReturnType<typeof useAuthApi>;

/** The most pages of the directory read: 100 banks each, above the NBU list (about 60 banks). */
const BANK_PAGES = 5;

/**
 * The NBU bank directory (`GET /v1/accounts/banks`, FIN-01@PoC FR 4, #338), read once when the form opens. The search
 * runs in the list itself, by name. `failed` — the directory could not be read: «Інша установа» still works.
 */
export function useBanks(
  api: Api,
  open: boolean,
): { banks: readonly Bank[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ banks: readonly Bank[]; loading: boolean; failed: boolean }>({
    banks: [],
    loading: true,
    failed: false,
  });
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || loaded.current) return;
    let live = true;
    void (async () => {
      const banks: Bank[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < BANK_PAGES; page++) {
        const o = await outcome(
          api.GET("/v1/accounts/banks", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }),
        );
        if (!live) return;
        if (!o.ok) {
          setState({ banks, loading: false, failed: true });
          return;
        }
        banks.push(...o.data.items);
        cursor = o.data.nextCursor ?? undefined;
        if (!cursor) break;
      }
      loaded.current = true;
      setState({ banks, loading: false, failed: false });
    })();
    return () => {
      live = false;
    };
  }, [api, open]);
  return state;
}

export interface Duplicate {
  readonly accountId: string;
  readonly institution: string;
  readonly last4: string;
}

/**
 * FIN-01@PoC FR 25, AC15: the existing account a new one would duplicate (same institution, number or IBAN and
 * currency), asked once the number is valid (`POST /v1/accounts/duplicate-check`). A failed check shows nothing: the
 * server refuses a duplicate on «Додати рахунок» too (409 `ACCOUNT_DUPLICATE`).
 */
export function useDuplicate(
  api: Api,
  query: {
    institution: { name: string; country: string } | null;
    number: string;
    currencies: string[];
  } | null,
): { duplicate: Duplicate | null; recheck: () => void } {
  const [found, setFound] = useState<{ key: string; duplicate: Duplicate | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = query ? JSON.stringify(query) : "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    const body = JSON.parse(key) as NonNullable<typeof query>;
    void outcome(api.POST("/v1/accounts/duplicate-check", { body })).then((o) => {
      if (!live || !o.ok) return;
      const d = o.data.duplicate;
      setFound({
        key,
        duplicate: d
          ? { accountId: d.accountId, institution: d.institution, last4: d.maskedNumber.replace(/^•+/u, "") }
          : null,
      });
    });
    return () => {
      live = false;
    };
  }, [api, key, attempt]);
  return {
    duplicate: found && found.key === key ? found.duplicate : null,
    recheck: () => setAttempt((n) => n + 1),
  };
}
