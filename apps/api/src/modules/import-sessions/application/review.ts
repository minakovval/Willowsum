import {
  historyGap,
  readingFits,
  type BatchFlag,
  type BatchFlagCode,
  type HistoryGap,
  type MismatchReason,
  type StatementBounds,
  type StatementChecks,
} from "../../file-parsers/index.ts";

/**
 * The batch's review of its statements (IMP-05@PoC FR 2–4, FR 7, FR 10, FR 11; AC1, AC3, AC6–AC9): each file's checks
 * from the parse (`StatementChecks`, file-parsers) with its history gap against the last applied statement of the same
 * account, the person's decisions, and the readiness to apply. Pure: no clock, no I/O.
 *
 * Decisions sit in slots; a new decision in a slot replaces the old one, so a decision can be repeated until the batch is
 * applied (FR 10). A row's own decision wins over its file's group decision, which wins over the batch's (Рішення
 * ведучого, 2026-11-20). Among group decisions «виключити» wins over «перевернути знак», which wins over «прийняти».
 */
export const ROW_ACTIONS = ["accept", "flip-sign", "exclude", "include", "import-anyway"] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];
export const GROUPS = ["review", "clarify"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_ACTIONS = ["accept", "exclude", "flip-sign"] as const;
export type GroupAction = (typeof GROUP_ACTIONS)[number];
export const BALANCE_CHOICES = ["update", "keep"] as const;
/** FR 2: «Застосувати й оновити залишок до виписки» (`update`) or «Застосувати без оновлення залишку» (`keep`). */
export type BalanceChoice = (typeof BALANCE_CHOICES)[number];
export const DATE_ORDER_CHOICES = ["dmy", "mdy"] as const;

/** A decision as the person sends it. `fileId` is the batch file's id; null in a group or flag decision — the batch. */
export type DecisionInput =
  | { readonly kind: "row"; readonly fileId: string; readonly row: number; readonly action: RowAction }
  | {
      readonly kind: "reading";
      readonly fileId: string;
      readonly row: number;
      /** The chosen reading as a decimal text, e.g. «1234» or «1.234». */
      readonly value: string;
      /** «застосувати до файлу» (FR 7, AC6): the same decimal separator for the file's other ambiguous amounts. */
      readonly applyToFile: boolean;
    }
  | { readonly kind: "date-order"; readonly fileId: string; readonly order: "dmy" | "mdy" }
  | {
      readonly kind: "group";
      readonly fileId: string | null;
      readonly group: Group;
      readonly action: GroupAction;
    }
  | { readonly kind: "flag"; readonly fileId: string | null; readonly code: BatchFlagCode }
  /** FR 4, AC3: «Так, це правильний рахунок». */
  | { readonly kind: "account"; readonly fileId: string }
  | { readonly kind: "balance"; readonly fileId: string; readonly choice: BalanceChoice };

/** A stored decision: a reading keeps the chosen decimal separator too (for «застосувати до файлу»). */
export type StoredDecision =
  | Exclude<DecisionInput, { kind: "reading" }>
  | (Extract<DecisionInput, { kind: "reading" }> & { readonly decimal: "," | "." });

export interface Decided {
  readonly slot: string;
  readonly fileId: string | null;
  readonly decision: StoredDecision;
  readonly decidedBy: string;
  readonly decidedAt: Date;
}

/** One file's review as stored: its checks, its account and the history gap found when they were recorded. */
export interface FileReview {
  readonly batchFileId: string;
  readonly batchId: string;
  /** The account the file is bound to or chosen for (accounts' id); null — not known yet. */
  readonly accountId: string | null;
  /** That account's currency (a single-currency account), for the readings (FR 7) when the file names none. */
  readonly accountCurrency: string | null;
  /** FR 4: the space's account that fits the file, offered with «чужий рахунок»; null — none found. */
  readonly suggestedAccountId: string | null;
  readonly checks: StatementChecks;
  readonly history: HistoryGap;
  /** The previous statement the history was compared with (a batch file of an applied batch); null — none. */
  readonly previousFileId: string | null;
  readonly recordedAt: Date;
}

/** FR 3: the history gap against the previous statement's bounds (null — no applied statement of the account yet). */
export const historyOf = (previous: StatementBounds | null, checks: StatementChecks): HistoryGap =>
  historyGap(previous, checks.bounds);

/** The slot a decision fills; a new decision in the same slot replaces the old one (FR 10). */
export function slotOf(d: DecisionInput): string {
  const scope = d.fileId ?? "batch";
  switch (d.kind) {
    case "row":
      return `row:${scope}:${d.row}`;
    case "reading":
      return d.applyToFile ? `reading:${scope}:file` : `reading:${scope}:${d.row}`;
    case "date-order":
      return `date-order:${scope}`;
    case "group":
      return `group:${scope}:${d.group}`;
    case "flag":
      return `flag:${scope}:${d.code}`;
    case "account":
      return `account:${scope}`;
    case "balance":
      return `balance:${scope}`;
  }
}

/** Why a decision is refused (nothing of the request is written). */
export type DecisionIssue =
  /** FR 7, AC7: the reading has more decimals than the currency allows. */
  | "READING_TOO_PRECISE"
  /** The file is not one of the batch's checked files. */
  | "UNKNOWN_FILE"
  /** The row, the reading, the flag or the question is not in the file's checks. */
  | "NOT_IN_CHECKS";

export class DecisionRefused extends Error {
  readonly issue: DecisionIssue;
  readonly index: number;

  constructor(issue: DecisionIssue, index: number) {
    super(`Decision ${index} refused: ${issue}`);
    this.name = "DecisionRefused";
    this.issue = issue;
    this.index = index;
  }
}

/** The currency a file's readings are checked against (FR 7): the statement's, else its account's. */
const currencyOf = (f: FileReview): string | null => f.checks.currency ?? f.accountCurrency;

/** Flags with a decision of their own: the account (FR 4) and the balance choice (FR 2). */
const OWN_DECISION: ReadonlySet<BatchFlagCode> = new Set(["foreign-account", "checksum-mismatch"]);

/**
 * A decision checked against the batch's files; returns it as stored or throws DecisionRefused. A reading must be one
 * of the clarification's readings and fit the currency (AC7: EUR and three decimals — refused).
 */
export function checkDecision(
  d: DecisionInput,
  files: ReadonlyMap<string, FileReview>,
  index: number,
): StoredDecision {
  const file = d.fileId === null ? null : files.get(d.fileId);
  if (d.fileId !== null && !file) throw new DecisionRefused("UNKNOWN_FILE", index);
  const refuse = (issue: DecisionIssue = "NOT_IN_CHECKS"): never => {
    throw new DecisionRefused(issue, index);
  };
  const all = file ? [file] : [...files.values()];
  switch (d.kind) {
    case "row": {
      const rows = new Set(file!.checks.signs.rows.map((r) => r.row));
      for (const c of file!.checks.clarifications) if (c.kind === "amount") rows.add(c.row);
      return rows.has(d.row) ? d : refuse();
    }
    case "reading": {
      if (!readingFits(d.value, currencyOf(file!))) return refuse("READING_TOO_PRECISE");
      const question = file!.checks.clarifications.find((c) => c.kind === "amount" && c.row === d.row);
      const reading =
        question?.kind === "amount" ? question.readings.find((r) => r.value === d.value) : undefined;
      return reading ? { ...d, decimal: reading.decimal } : refuse();
    }
    case "date-order":
      return file!.checks.clarifications.some((c) => c.kind === "date-order") ? d : refuse();
    case "group":
      // «Перевернути знак» is for the rows whose sign is not confirmed (FR 6), never for a reading.
      return d.action === "flip-sign" && d.group !== "review" ? refuse() : d;
    case "flag":
      return !OWN_DECISION.has(d.code) && all.some((f) => f.checks.flags.some((x) => x.code === d.code))
        ? d
        : refuse();
    case "account":
      return file!.checks.account.status === "mismatch" ? d : refuse();
    case "balance":
      return file!.checks.flags.some((x) => x.code === "checksum-mismatch") ? d : refuse();
  }
}

// ——— Readiness (FR 11) ———

export const READINESS_CODES = ["confirm-account", "clarifications", "review-rows", "flags"] as const;
export type ReadinessCode = (typeof READINESS_CODES)[number];

/** FR 11: the explanation of each refusal. */
export const READINESS_MESSAGES: Readonly<Record<ReadinessCode, { uk: string; en: string }>> = {
  "confirm-account": { uk: "Підтвердіть рахунок", en: "Confirm the account" },
  clarifications: { uk: "Потрібні уточнення", en: "Clarifications needed" },
  "review-rows": { uk: "Потрібен перегляд рядків", en: "Rows need review" },
  flags: { uk: "Не підтверджені позначки", en: "Flags not confirmed" },
};

/** How many row numbers a refusal lists per file; `count` has them all. */
export const LISTED_ROWS = 100;

export interface RowsLeft {
  readonly fileId: string;
  readonly rows: readonly number[];
  readonly count: number;
}

export type Refusal =
  | {
      readonly code: "confirm-account";
      readonly files: readonly {
        readonly fileId: string;
        /** The file has no account yet: one is chosen for it first (no decision confirms it). */
        readonly missing: boolean;
        /** Masked to the last 4 characters (IBAN, card); a currency by its code. */
        readonly reasons: readonly MismatchReason[];
        readonly suggestedAccountId: string | null;
      }[];
    }
  | {
      readonly code: "clarifications";
      readonly files: readonly (RowsLeft & { readonly dateOrder: boolean })[];
    }
  | { readonly code: "review-rows"; readonly files: readonly RowsLeft[] }
  | {
      readonly code: "flags";
      readonly files: readonly {
        readonly fileId: string;
        /** `checksum-mismatch` is confirmed by a balance choice (FR 2, AC1): `choices` names both. */
        readonly flags: readonly (BatchFlag & { readonly choices?: readonly BalanceChoice[] })[];
      }[];
    };

/** What the apply does with one file once the batch is ready (the apply step's input). */
export interface FilePlan {
  readonly fileId: string;
  /** FR 2: null — the statement's figures agree, no choice was needed. */
  readonly balance: BalanceChoice | null;
  readonly excluded: readonly number[];
  readonly flipped: readonly number[];
  /** «Імпортувати все одно» (FR 10): rows imported although a later rule would hold them back. */
  readonly forced: readonly number[];
  readonly readings: readonly { readonly row: number; readonly value: string }[];
  readonly dateOrder: "dmy" | "mdy" | null;
}

export interface Readiness {
  readonly ready: boolean;
  readonly refusals: readonly Refusal[];
  readonly files: readonly FilePlan[];
}

type Disposition = RowAction | GroupAction | null;

/**
 * FR 11, AC3, AC8, AC9: the batch may be applied only when every file's account is confirmed (FR 4), every
 * clarification answered (FR 7, FR 8), every row whose sign is not confirmed reviewed (FR 5), and every flag confirmed
 * (FR 2: a control-sum mismatch by its balance choice). With no flag, question or unconfirmed row it is ready with no
 * decision at all (AC9).
 */
export function readiness(files: readonly FileReview[], decisions: readonly Decided[]): Readiness {
  const at = new Map(decisions.map((d) => [d.slot, d.decision]));
  const accounts: Extract<Refusal, { code: "confirm-account" }>["files"][number][] = [];
  const questions: (RowsLeft & { dateOrder: boolean })[] = [];
  const review: RowsLeft[] = [];
  const flagsLeft: Extract<Refusal, { code: "flags" }>["files"][number][] = [];
  const plans: FilePlan[] = [];
  const left = (fileId: string, rows: readonly number[]): RowsLeft => ({
    fileId,
    rows: rows.slice(0, LISTED_ROWS),
    count: rows.length,
  });

  for (const f of files) {
    const id = f.batchFileId;
    const { checks } = f;
    const group = (g: Group): GroupAction | null => {
      const own = at.get(`group:${id}:${g}`) ?? at.get(`group:batch:${g}`);
      return own?.kind === "group" ? own.action : null;
    };
    const rowOwn = (row: number): RowAction | null => {
      const d = at.get(`row:${id}:${row}`);
      return d?.kind === "row" ? d.action : null;
    };
    const unconfirmed = new Set(checks.signs.unconfirmed);
    // FR 6: «знак картки» answered by flipping the sign for the file (its flag not confirmed) flips every row of the
    // file, also the ones the balance chain holds as printed — the chain of a card confirms no sign (#654, #655: the
    // flag was closed and nothing flipped, so purchases were written as income).
    const cardFlip =
      checks.flags.some((flag) => flag.code === "card-sign") &&
      at.get(`flag:${id}:card-sign`)?.kind !== "flag" &&
      at.get("flag:batch:card-sign")?.kind !== "flag";
    const amountRows = new Set(checks.clarifications.flatMap((c) => (c.kind === "amount" ? [c.row] : [])));
    const disposition = (row: number): Disposition => {
      const own = rowOwn(row);
      if (own) return own;
      const groups = [
        ...(unconfirmed.has(row) || cardFlip ? [group("review")] : []),
        ...(amountRows.has(row) ? [group("clarify")] : []),
      ].filter((g): g is GroupAction => g !== null);
      return groups.includes("exclude")
        ? "exclude"
        : groups.includes("flip-sign")
          ? "flip-sign"
          : (groups[0] ?? null);
    };

    // FR 4, AC3; a file with no account yet is never applied: the account is chosen first (`missing`).
    if (f.accountId === null)
      accounts.push({ fileId: id, missing: true, reasons: [], suggestedAccountId: f.suggestedAccountId });
    else if (checks.account.status === "mismatch" && at.get(`account:${id}`)?.kind !== "account")
      accounts.push({
        fileId: id,
        missing: false,
        reasons: checks.account.reasons,
        suggestedAccountId: f.suggestedAccountId,
      });

    // FR 7, FR 8, AC6, AC8: a row's own reading, else the file's («застосувати до файлу»), else the row is accepted as
    // read or excluded (its own decision or the group's).
    const fileReading = at.get(`reading:${id}:file`);
    const readings: { row: number; value: string }[] = [];
    const unanswered: number[] = [];
    for (const c of checks.clarifications) {
      if (c.kind !== "amount") continue;
      const own = at.get(`reading:${id}:${c.row}`);
      const decimal =
        own?.kind === "reading" ? own.decimal : fileReading?.kind === "reading" ? fileReading.decimal : null;
      // AC7: a file-wide answer never brings in a reading the currency refuses; such a row stays a question.
      const reading =
        decimal === null
          ? undefined
          : c.readings.find((r) => r.decimal === decimal && readingFits(r.value, currencyOf(f)));
      if (reading) readings.push({ row: c.row, value: reading.value });
      else {
        const d = disposition(c.row);
        if (d !== "accept" && d !== "exclude" && d !== "import-anyway") unanswered.push(c.row);
      }
    }
    const order = at.get(`date-order:${id}`);
    const dateOrder = order?.kind === "date-order" ? order.order : null;
    // FR 8: the order of day and month needs its own answer; a group decision never closes it (it would leave the
    // engine's assumed order in the plan).
    const dateOpen = checks.clarifications.some((c) => c.kind === "date-order") && dateOrder === null;
    if (unanswered.length > 0 || dateOpen) questions.push({ ...left(id, unanswered), dateOrder: dateOpen });

    // FR 5, AC4: every row of «потребує перегляду» has a decision.
    const unreviewed = checks.signs.unconfirmed.filter((row) => disposition(row) === null);
    if (unreviewed.length > 0) review.push(left(id, unreviewed));

    // FR 2, FR 6, FR 9: every flag but the account's is confirmed; a control-sum mismatch by its balance choice.
    const balanceDecision = at.get(`balance:${id}`);
    const balance = balanceDecision?.kind === "balance" ? balanceDecision.choice : null;
    const open = checks.flags.filter((flag) => {
      if (flag.code === "foreign-account") return false;
      if (flag.code === "checksum-mismatch") return balance === null;
      const confirmed =
        at.get(`flag:${id}:${flag.code}`)?.kind === "flag" ||
        at.get(`flag:batch:${flag.code}`)?.kind === "flag";
      // FR 6: «знак картки» is confirmed, or the sign is flipped for the file.
      return !(confirmed || (flag.code === "card-sign" && group("review") === "flip-sign"));
    });
    if (open.length > 0)
      flagsLeft.push({
        fileId: id,
        flags: open.map((flag) =>
          flag.code === "checksum-mismatch" ? { ...flag, choices: [...BALANCE_CHOICES] } : flag,
        ),
      });

    const rows = new Set([...checks.signs.rows.map((r) => r.row), ...amountRows]);
    const by = (action: Disposition) =>
      [...rows].filter((r) => disposition(r) === action).sort((a, b) => a - b);
    plans.push({
      fileId: id,
      balance,
      excluded: by("exclude"),
      flipped: by("flip-sign"),
      forced: by("import-anyway"),
      readings,
      dateOrder,
    });
  }

  const refusals: Refusal[] = [];
  if (accounts.length > 0) refusals.push({ code: "confirm-account", files: accounts });
  if (questions.length > 0) refusals.push({ code: "clarifications", files: questions });
  if (review.length > 0) refusals.push({ code: "review-rows", files: review });
  if (flagsLeft.length > 0) refusals.push({ code: "flags", files: flagsLeft });
  return { ready: refusals.length === 0, refusals, files: plans };
}
