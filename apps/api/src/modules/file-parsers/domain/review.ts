import type { AccountBindingKind, AccountMatch } from "./account.ts";
import type { StatementAnalysis } from "./analysis.ts";
import { checkControls, type ControlCheck, type StatementBounds } from "./checks.ts";
import { clarifications, type Clarification } from "./clarify.ts";
import type { StatementEvents } from "./events.ts";
import type { DeclaredFigures } from "./figures.ts";
import { reviewSigns, type SignReview } from "./signs.ts";

/**
 * The batch's review of one statement (IMP-05@PoC FR 1–9): the control checks, the bounds the next statement is
 * compared with (FR 3), the evidence of another account (FR 4), the signs (FR 5, FR 6), the clarifications (FR 7,
 * FR 8) and the batch's flags with their level — «блокування» (`block`) or «перегляд» (`review`). Any flag means «не
 * приймати документ автоматично». Storing decisions and refusing to apply (FR 10, FR 11) are import-sessions'.
 */
export type Severity = "block" | "review";

export type BatchFlagCode =
  /** FR 2, AC1: a control check does not agree. */
  | "checksum-mismatch"
  /** FR 4, AC3, EC3: the file's IBAN, card or currency is another account's. */
  | "foreign-account"
  /** FR 6, AC5. */
  | "card-sign"
  /** FR 9. */
  | "formula-cells"
  | "hidden-sheets"
  | "balance-not-checked"
  | "no-transactions";

export interface BatchFlag {
  readonly code: BatchFlagCode;
  readonly severity: Severity;
  /** `checksum-mismatch`: the difference of the first check that does not agree, and its kind. */
  readonly difference?: string;
  readonly check?: ControlCheck["kind"];
  /** `formula-cells`, `hidden-sheets`: how many. */
  readonly count?: number;
  /** `card-sign`. */
  readonly positive?: number;
  readonly negative?: number;
}

export const FLAG_SEVERITY: Readonly<Record<BatchFlagCode, Severity>> = {
  "checksum-mismatch": "review",
  "foreign-account": "block",
  "card-sign": "review",
  "formula-cells": "review",
  "hidden-sheets": "review",
  "balance-not-checked": "review",
  "no-transactions": "review",
};

/** A reason of «чужий рахунок», masked to the last 4 characters (IBAN, card); a currency is its code. */
export interface MismatchReason {
  readonly kind: "iban" | "card" | "currency";
  readonly file: string;
  readonly account: string;
}

export interface AccountEvidence {
  readonly status: "match" | "mismatch" | "not-checked";
  readonly reasons: readonly MismatchReason[];
}

export interface StatementChecks {
  readonly currency: string | null;
  readonly figures: DeclaredFigures;
  readonly controls: readonly ControlCheck[];
  readonly bounds: StatementBounds;
  readonly account: AccountEvidence;
  readonly signs: SignReview;
  readonly clarifications: readonly Clarification[];
  readonly flags: readonly BatchFlag[];
}

export interface ReviewInput {
  readonly rows: readonly (readonly string[])[];
  readonly firstRow: number;
  readonly analysis: StatementAnalysis;
  readonly events: StatementEvents;
  readonly figures: DeclaredFigures;
  /** The account the file is bound to or chosen for: its currencies and kind (accounts' `ACCOUNT_KINDS`). */
  readonly account?: {
    readonly currencies: readonly string[];
    readonly multiCurrency: boolean;
    readonly kind?: string;
  };
  /** The binding's outcome and its masked reason (`maskedMismatch`). */
  readonly match: AccountMatch | null;
  readonly masked: { readonly file: string; readonly account: string } | null;
  /** A masked card in the rows before the table. */
  readonly cardInFile: boolean;
  /** Hidden sheets of a workbook (none in CSV and TSV). */
  readonly hiddenSheets?: number;
  /** The sign comes from the recipe's bank profile. */
  readonly profileSign?: boolean;
}

/** A cell a spreadsheet would run: «=…», «@…», or a function after a sign («+SUM(», «-cmd|»). Never run here. */
const FORMULA = /^(?:[=@]\S|[+-][A-Za-z_][\w.]*[(|])/;

export function accountEvidence(
  match: AccountMatch | null,
  masked: ReviewInput["masked"],
  account: ReviewInput["account"],
  currencies: readonly string[],
): AccountEvidence {
  const reasons: MismatchReason[] = [];
  if (match?.status === "mismatch" && masked) {
    const kind: Record<AccountBindingKind, MismatchReason["kind"]> = {
      iban: "iban",
      "account-number": "iban",
      mask: "card",
    };
    reasons.push({ kind: kind[match.by], ...masked });
  }
  // EC3: a file in a currency a single-currency account does not hold.
  if (account && !account.multiCurrency && account.currencies.length > 0) {
    const foreign = currencies.filter((c) => !account.currencies.includes(c));
    if (foreign.length > 0)
      reasons.push({ kind: "currency", file: foreign.join(", "), account: account.currencies.join(", ") });
  }
  if (reasons.length > 0) return { status: "mismatch", reasons };
  return { status: match?.status === "match" ? "match" : "not-checked", reasons };
}

export function reviewStatement(input: ReviewInput): StatementChecks {
  const { rows, analysis, events, figures } = input;
  const controls = checkControls(figures, events);
  const kind = input.account?.kind;
  const card = input.cardInFile || kind === "credit-card" || input.match?.by === "mask";
  const signs = reviewSigns(events, analysis, {
    chainRows: controls.chainRows,
    totalsVerified: controls.totalsVerified,
    profile: input.profileSign ?? false,
    card,
    creditCard: kind === undefined ? card : kind === "credit-card",
  });
  const account = accountEvidence(input.match, input.masked, input.account, events.currencies);
  const flags: BatchFlag[] = [];
  const add = (code: BatchFlagCode, extra: Omit<BatchFlag, "code" | "severity"> = {}) =>
    flags.push({ code, severity: FLAG_SEVERITY[code], ...extra });
  const mismatch = controls.checks.find((c) => c.status === "mismatch");
  if (mismatch)
    add("checksum-mismatch", {
      check: mismatch.kind,
      ...(mismatch.difference !== null ? { difference: mismatch.difference } : {}),
    });
  if (account.status === "mismatch") add("foreign-account");
  if (signs.card) add("card-sign", signs.card);
  let formulas = 0;
  for (let i = input.firstRow; i < rows.length; i++)
    for (const cell of rows[i]!) if (FORMULA.test(cell.trim())) formulas++;
  if (formulas > 0) add("formula-cells", { count: formulas });
  if ((input.hiddenSheets ?? 0) > 0) add("hidden-sheets", { count: input.hiddenSheets! });
  if (controls.checks.find((c) => c.kind === "balance-equation")!.status === "not-checked")
    add("balance-not-checked");
  if (events.events.length === 0) add("no-transactions");
  return {
    currency: controls.currency,
    figures,
    controls: controls.checks,
    bounds: controls.bounds,
    account,
    signs,
    clarifications: clarifications(rows, analysis, events, controls.chainRows),
    flags,
  };
}
