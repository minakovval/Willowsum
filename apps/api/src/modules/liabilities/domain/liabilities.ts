import { currencyInfo, Decimal, DomainError, isCurrencyCode, Money } from "@willowsum/domain-kernel";

/**
 * Liabilities (FIN-01@PoC FR 2, FR 16, FR 19; business rule «зобов'язання — першокласна сутність»): a loan («Кредит» —
 * mortgage, consumer or car loan, credit line or personal loan) with its annual rate and monthly payment, and a credit
 * card with its credit limit and grace period. The debt itself is a time series in the ledger (the balance of the
 * account's ledger account); the owners and their shares are the account's (module `accounts`). Pure rules, no I/O.
 */
export const LIABILITY_KINDS = ["loan", "credit-card"] as const;
export type LiabilityKind = (typeof LIABILITY_KINDS)[number];

/** Grace period of a credit card, in days (a lead decision: 0–365). */
export const GRACE_PERIOD_MAX_DAYS = 365;

const RATE_RE = /^\d{1,3}(?:\.\d{1,2})?$/;
const AMOUNT_RE = /^\d{1,20}(?:\.\d{1,18})?$/;

/**
 * An annual rate in percent, as typed: 0–100 with at most two decimals («Ставка, % річних*», FIN-01 FR 3). Returns its
 * canonical decimal string (e.g. "4.2"), or null when it is not one.
 */
export function parseAnnualRate(text: string): string | null {
  if (!RATE_RE.test(text)) return null;
  const rate = new Decimal(text);
  return rate.greaterThan(100) ? null : rate.toFixed();
}

/**
 * An amount a person types in a currency: a plain non-negative decimal with at most the currency's minor units
 * (2 for EUR, 0 for JPY). Returns Money, or null when it is not one. The sign is the caller's to add.
 */
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

/** The terms of a liability as typed in «Новий рахунок» (step 3 «Додатково»). */
export interface LiabilityTermsInput {
  readonly kind: LiabilityKind;
  /** The account's currency: every amount of the terms is in it. */
  readonly currency: string;
  readonly annualRate?: string | null | undefined;
  readonly monthlyPayment?: string | null | undefined;
  readonly creditLimit?: string | null | undefined;
  readonly gracePeriodDays?: number | null | undefined;
}

export interface LiabilityTerms {
  readonly kind: LiabilityKind;
  readonly currency: string;
  /** Percent per year, canonical decimal string; null — not given (never for a loan). */
  readonly annualRate: string | null;
  /** A loan's monthly payment, > 0 in the account's currency; null for a credit card. */
  readonly monthlyPayment: Money | null;
  /** A credit card's (or credit line's) limit, ≥ 0; null — not given. */
  readonly creditLimit: Money | null;
  readonly gracePeriodDays: number | null;
}

/** Why terms were refused: the input field and an issue code (never the value). */
export interface TermsIssue {
  readonly field: "annualRate" | "monthlyPayment" | "creditLimit" | "gracePeriodDays";
  readonly issue: "required" | "invalid" | "not_allowed";
}

const given = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/**
 * Checks the terms (FIN-01 FR 2, FR 3, FR 5): a loan needs «Ставка, % річних*» (0–100, two decimals) and «Щомісячний
 * платіж*» (> 0, in the account's currency) and has no grace period; a credit card may have a credit limit (≥ 0), a
 * grace period (0–365 days) and a rate, and has no monthly payment.
 */
export function checkTerms(
  input: LiabilityTermsInput,
): { readonly terms: LiabilityTerms } | { readonly issues: readonly TermsIssue[] } {
  const issues: TermsIssue[] = [];
  let annualRate: string | null = null;
  if (given(input.annualRate)) {
    annualRate = parseAnnualRate(input.annualRate);
    if (annualRate === null) issues.push({ field: "annualRate", issue: "invalid" });
  } else if (input.kind === "loan") issues.push({ field: "annualRate", issue: "required" });

  let monthlyPayment: Money | null = null;
  if (input.kind === "credit-card") {
    if (given(input.monthlyPayment)) issues.push({ field: "monthlyPayment", issue: "not_allowed" });
  } else if (!given(input.monthlyPayment)) issues.push({ field: "monthlyPayment", issue: "required" });
  else {
    monthlyPayment = parseTypedAmount(input.monthlyPayment, input.currency);
    if (monthlyPayment === null || monthlyPayment.isZero()) {
      monthlyPayment = null;
      issues.push({ field: "monthlyPayment", issue: "invalid" });
    }
  }

  let creditLimit: Money | null = null;
  if (given(input.creditLimit)) {
    creditLimit = parseTypedAmount(input.creditLimit, input.currency);
    if (creditLimit === null) issues.push({ field: "creditLimit", issue: "invalid" });
  }

  let gracePeriodDays: number | null = null;
  if (given(input.gracePeriodDays)) {
    if (input.kind === "loan") issues.push({ field: "gracePeriodDays", issue: "not_allowed" });
    else if (
      !Number.isInteger(input.gracePeriodDays) ||
      input.gracePeriodDays < 0 ||
      input.gracePeriodDays > GRACE_PERIOD_MAX_DAYS
    )
      issues.push({ field: "gracePeriodDays", issue: "invalid" });
    else gracePeriodDays = input.gracePeriodDays;
  }

  if (issues.length > 0) return { issues };
  return {
    terms: {
      kind: input.kind,
      currency: input.currency,
      annualRate,
      monthlyPayment,
      creditLimit,
      gracePeriodDays,
    },
  };
}

/**
 * «Доступно» of a credit card (FIN-01 FR 16, AC8, AC13): the credit limit minus the debt. A debt above the limit gives
 * a negative amount, shown as it is.
 */
export function availableCredit(creditLimit: Money, debt: Money): Money {
  return creditLimit.minus(debt);
}
