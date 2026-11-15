import {
  checkDetails,
  institutionKey,
  maskedNumber,
  type DetailsInput,
  type FieldIssue,
} from "../domain/index.ts";
import {
  findDuplicate,
  NUMBER_FIELD,
  type AccountsDeps,
  type AccountsTx,
  type Caller,
  type Duplicate,
  type StoredAccount,
} from "./accounts.ts";
import type { HandOff } from "./hand-off.ts";
import { settingsHandOff } from "./settings.ts";
import { CHANGEABLE_TERMS, checkTermsChange, type TermsChangeInput } from "../../liabilities/index.ts";

/**
 * «Рахунок → Налаштування» → «Реквізити» (FIN-12@PoC FR 4, AC9; NFR-01@PoC FR 6; wave 2 row 14). In the accounts
 * transaction with the account's row locked:
 *
 * 1. the change is checked against the account's kind (`checkDetails`) — nothing is written for a refusal;
 * 2. a full IBAN or account number is sealed with the space's key (ARC-06 FR 2, `NUMBER_FIELD`); only its last 4
 *    characters stay in the clear. The same number again keeps the sealed value as it is (no change, no entry);
 * 3. a new institution or number must not make a duplicate of another account of the space (FIN-12 FR 11, FIN-01
 *    FR 25), checked under the lock of the space's creations, as creating is;
 * 4. the row, then the audit entry with every changed field before and after — the sealed number and the note masked,
 *    the number otherwise only as «••1234» — as a hand-off job of the same transaction, written once it has committed
 *    (ARC-04, #252 item 3; `settingsHandOff`).
 *
 * The full number is never answered, logged or written to the audit log: it exists in the clear only in this request
 * and, opened for the comparison, in this process.
 *
 * A loan's rate and monthly payment and a card's credit limit are the liability's terms (`liabilities`, FIN-12 AC10,
 * #244 item 7): they are checked here against the terms in effect (`checkTermsChange`), so a refusal writes nothing,
 * and returned as `terms` for the caller to hand to `liabilities.changeTerms` once this transaction has committed.
 */

/** The liability's terms to change after the commit (null — none sent). */
type TermsToChange = TermsChangeInput | null;

export type DetailsResult =
  | { readonly kind: "updated"; readonly handOff: HandOff; readonly terms: TermsToChange }
  | { readonly kind: "unchanged"; readonly terms: TermsToChange }
  | { readonly kind: "not-found" }
  | { readonly kind: "closed" }
  | { readonly kind: "duplicate"; readonly duplicate: Duplicate }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] };

type Details = Pick<
  StoredAccount,
  | "institutionName"
  | "institutionCountry"
  | "institutionKey"
  | "numberLast4"
  | "numberSealed"
  | "note"
  | "cardExpiry"
  | "annualRate"
>;

/** What «Реквізити» sends: the account's own fields and the liability's terms. */
export type DetailsRequest = DetailsInput & {
  readonly monthlyPayment?: string | null | undefined;
  readonly creditLimit?: string | null | undefined;
};

const TERMS_FIELDS = ["annualRate", "monthlyPayment", "creditLimit"] as const;

/**
 * The request split by the account's kind: the terms a loan or a card changes in `liabilities`, the rest the account's
 * own (a loan's rate is a term; a savings account's rate is its own). A term field of another kind is `not_allowed`.
 */
function splitTerms(
  kind: StoredAccount["kind"],
  input: DetailsRequest,
): { readonly own: DetailsInput; readonly terms: TermsChangeInput; readonly issues: FieldIssue[] } {
  const termFields: readonly string[] =
    kind === "loan" || kind === "credit-card" ? CHANGEABLE_TERMS[kind] : [];
  const own: Record<string, unknown> = {};
  const terms: Record<string, string | null> = {};
  const issues: FieldIssue[] = [];
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (termFields.includes(field)) terms[field] = value as string | null;
    else if (field === "monthlyPayment" || field === "creditLimit")
      issues.push({ field, issue: "not_allowed" });
    else own[field] = value;
  }
  return { own: own as DetailsInput, terms: terms as TermsChangeInput, issues };
}

export async function updateAccountDetails(
  deps: Pick<AccountsDeps, "seal" | "newId"> & {
    readonly liabilities: Pick<AccountsDeps["liabilities"], "forAccount">;
  },
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: DetailsRequest,
): Promise<DetailsResult> {
  const { householdId } = caller;
  const account = await tx.lockAccount(householdId, accountId);
  if (!account) return { kind: "not-found" };
  // «Закритий» is read-only except the display flags (FR 8).
  if (account.status === "closed") return { kind: "closed" };
  const split = splitTerms(account.kind, input);
  const checked = checkDetails(account.kind, split.own);
  const issues = [...split.issues, ...("issues" in checked ? checked.issues : [])];
  let terms: TermsToChange = null;
  if (TERMS_FIELDS.some((f) => split.terms[f] !== undefined)) {
    // Until the account's hand-off has registered its liability (ARC-04) there are no terms to change yet.
    const liability = await deps.liabilities.forAccount(householdId, accountId);
    if (liability === null)
      issues.push(
        ...TERMS_FIELDS.filter((f) => split.terms[f] !== undefined).map((field) => ({
          field,
          issue: "unavailable",
        })),
      );
    else {
      const termsChecked = checkTermsChange(liability, split.terms);
      if ("issues" in termsChecked) issues.push(...termsChecked.issues);
      else terms = split.terms;
    }
  }
  if (issues.length > 0 || "issues" in checked) return { kind: "invalid", issues };
  const change = checked.change;

  const after: { -readonly [K in keyof Details]: Details[K] } = {
    institutionName: account.institutionName,
    institutionCountry: account.institutionCountry,
    institutionKey: account.institutionKey,
    numberLast4: account.numberLast4,
    numberSealed: account.numberSealed,
    note: account.note,
    cardExpiry: account.cardExpiry,
    annualRate: account.annualRate,
  };
  if (change.institution !== undefined) {
    after.institutionName = change.institution?.name ?? null;
    after.institutionCountry = change.institution?.country ?? null;
    after.institutionKey = institutionKey(change.institution);
  }
  if (change.note !== undefined) after.note = change.note;
  if (change.cardExpiry !== undefined) after.cardExpiry = change.cardExpiry;
  if (change.annualRate !== undefined) after.annualRate = change.annualRate;

  // The full number of the account after the change, for the duplicate rule; opened only when it is needed.
  let full: string | null | undefined;
  const opened = async () =>
    account.numberSealed === null ? null : deps.seal.open(householdId, NUMBER_FIELD, account.numberSealed);
  if (change.number !== undefined) {
    const number = change.number;
    after.numberLast4 = number?.last4 ?? null;
    full = number?.full ?? null;
    if (full === null) after.numberSealed = null;
    else if (account.numberLast4 === number!.last4 && (await opened()) === full)
      after.numberSealed = account.numberSealed;
    else after.numberSealed = await deps.seal.seal(householdId, NUMBER_FIELD, full);
  }

  const numberChanged =
    after.numberLast4 !== account.numberLast4 || after.numberSealed !== account.numberSealed;
  if (after.numberLast4 !== null && (numberChanged || after.institutionKey !== account.institutionKey)) {
    await tx.lockCreations(householdId);
    const subaccounts = await tx.subaccounts(householdId, accountId);
    const duplicate = await findDuplicate(deps, tx, householdId, {
      institutionKey: after.institutionKey,
      number: { last4: after.numberLast4, full: full === undefined ? await opened() : full },
      currencies: subaccounts.map((s) => s.currency),
      exceptAccountId: accountId,
    });
    if (duplicate) return { kind: "duplicate", duplicate };
  }

  const masked = (last4: string | null) => (last4 === null ? null : maskedNumber(last4));
  const sealed = (value: string | null) => (value === null ? null : "sealed");
  const changes = [
    {
      field: "institutionName",
      before: account.institutionName,
      after: after.institutionName,
      sensitive: false,
    },
    {
      field: "institutionCountry",
      before: account.institutionCountry,
      after: after.institutionCountry,
      sensitive: false,
    },
    // Masked by the log: whether a full number is kept, and that it changed — never its value (NFR-01 FR 6).
    ...(after.numberSealed !== account.numberSealed
      ? [
          {
            field: "number",
            before: sealed(account.numberSealed),
            after: sealed(after.numberSealed),
            sensitive: true,
          },
        ]
      : []),
    {
      field: "numberLast4",
      before: masked(account.numberLast4),
      after: masked(after.numberLast4),
      sensitive: false,
    },
    { field: "cardExpiry", before: account.cardExpiry, after: after.cardExpiry, sensitive: false },
    // Free text: masked, as on creating (FIN-01 FR 17).
    { field: "note", before: account.note, after: after.note, sensitive: true },
    { field: "annualRate", before: account.annualRate, after: after.annualRate, sensitive: false },
  ].filter((c) => c.field === "number" || c.before !== c.after);
  if (changes.length === 0) return { kind: "unchanged", terms };

  await tx.updateDetails(householdId, { id: accountId, ...after });
  return { kind: "updated", handOff: await settingsHandOff(deps, tx, caller, accountId, changes), terms };
}
