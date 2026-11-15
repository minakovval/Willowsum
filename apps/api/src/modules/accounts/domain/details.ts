import {
  institutionOf,
  noteText,
  parseAccountNumber,
  parseAnnualRate,
  type AccountKind,
  type AccountNumber,
  type FieldIssue,
  type Institution,
} from "./accounts.ts";

/**
 * «Рахунок → Налаштування» → «Реквізити» (FIN-12@PoC FR 4; wave 2 row 14), as pure rules: which fields a kind has and
 * how each is checked. The number follows «Новий рахунок» (FIN-01 FR 3): the last 4 characters, or a full IBAN or
 * account number, which the application seals with the space's key; a full card number is never taken.
 *
 * Lead decisions (FIN-12): the institution, the number and the note — for every kind, as in «Новий рахунок», so nothing
 * typed there becomes uneditable; «Строк дії» — a credit card's only; the rate — «Ощадний» and «Депозит» (the account's
 * own field). A card's limit and a loan's rate and payment are the liability's terms (`liabilities`) and not changed
 * here (see the PR, «Follow-ups»); the opening date is shown, not changed (the owner's share runs from it).
 */

export type DetailField = "institution" | "number" | "note" | "cardExpiry" | "annualRate";

export function detailFieldsOf(kind: AccountKind): readonly DetailField[] {
  const fields: DetailField[] = ["institution", "number", "note"];
  if (kind === "credit-card") fields.push("cardExpiry");
  if (kind === "savings" || kind === "deposit") fields.push("annualRate");
  return fields;
}

/** What «Реквізити» sends: a field left out is not changed, null clears it. */
export interface DetailsInput {
  readonly institution?: { readonly name: string; readonly country: string } | null | undefined;
  readonly number?: string | null | undefined;
  readonly note?: string | null | undefined;
  /** «Строк дії» of a credit card: YYYY-MM. */
  readonly cardExpiry?: string | null | undefined;
  readonly annualRate?: string | null | undefined;
}

/** The checked change: only the fields sent. */
export interface DetailsChange {
  readonly institution?: Institution | null;
  readonly number?: AccountNumber | null;
  readonly note?: string | null;
  readonly cardExpiry?: string | null;
  readonly annualRate?: string | null;
}

const EXPIRY_RE = /^20\d{2}-(?:0[1-9]|1[0-2])$/;

/** «Строк дії» (month and year of a card, a lead decision: 2000–2099) as YYYY-MM; else null. */
export function parseCardExpiry(text: string): string | null {
  return EXPIRY_RE.test(text) ? text : null;
}

export function checkDetails(
  kind: AccountKind,
  input: DetailsInput,
): { readonly change: DetailsChange } | { readonly issues: readonly FieldIssue[] } {
  const allowed = detailFieldsOf(kind);
  const issues: FieldIssue[] = [];
  const change: {
    institution?: Institution | null;
    number?: AccountNumber | null;
    note?: string | null;
    cardExpiry?: string | null;
    annualRate?: string | null;
  } = {};
  const sent = (field: DetailField) => {
    if (input[field] === undefined) return false;
    if (!allowed.includes(field)) {
      issues.push({ field, issue: "not_allowed" });
      return false;
    }
    return true;
  };

  if (sent("institution")) {
    const value = input.institution!;
    if (value === null) change.institution = null;
    else {
      const institution = institutionOf(value);
      if (institution) change.institution = institution;
      else issues.push({ field: "institution", issue: "invalid" });
    }
  }
  if (sent("number")) {
    const value = input.number!;
    if (value === null || value.trim() === "") change.number = null;
    else {
      const parsed = parseAccountNumber(value);
      if (typeof parsed === "string") issues.push({ field: "number", issue: parsed });
      else change.number = parsed;
    }
  }
  if (sent("note")) {
    const value = input.note!;
    const parsed = value === null ? null : noteText(value);
    if (parsed === undefined) issues.push({ field: "note", issue: "invalid" });
    else change.note = parsed;
  }
  if (sent("cardExpiry")) {
    const value = input.cardExpiry!;
    const parsed = value === null ? null : parseCardExpiry(value);
    if (value !== null && parsed === null) issues.push({ field: "cardExpiry", issue: "invalid" });
    else change.cardExpiry = parsed;
  }
  if (sent("annualRate")) {
    const value = input.annualRate!;
    const parsed = value === null ? null : parseAnnualRate(value);
    if (value !== null && parsed === null) issues.push({ field: "annualRate", issue: "invalid" });
    else change.annualRate = parsed;
  }
  return issues.length > 0 ? { issues } : { change };
}
