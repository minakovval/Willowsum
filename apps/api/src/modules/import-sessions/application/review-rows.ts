import { Decimal } from "@willowsum/domain-kernel";
import type { RowOutcome } from "../../duplicate-matching/index.ts";
import type {
  AmountReading,
  Decision,
  Evidence,
  Hypothesis,
  RowSign,
  StatementAnalysis,
  StatementEvent,
} from "../../file-parsers/index.ts";
import { maskNumbers, type BatchState } from "../domain/index.ts";
import {
  fileRows,
  type ApplyPorts,
  type ApplyBatchesTx,
  type RowIssue,
  type RowIssueDetail,
} from "./apply.ts";
import { BatchNotFoundError, BatchStateErrorFor } from "./batches.ts";
import type { ReviewBatchesTx } from "./decisions.ts";
import { parsePurpose, type FileParse, type ParseTx, type SealedParse } from "./parse.ts";
import {
  closesQuestion,
  dispositionsOf,
  readiness,
  type Decided,
  type FilePlan,
  type FileReview,
  type GroupAction,
  type RowAction,
} from "./review.ts";

/**
 * The review of one parsed file for the wizard's step «Перевірка розпізнавання» (IMP-08@PoC FR 5–7, FR 10, AC3–AC6,
 * AC10; IMP-06@PoC FR 8, AC8; plan row 137, server part 1 of 2). Read only, from what the batch already holds: the
 * sealed parse (events, the engine's analysis), the file's checks and the batch's decisions. Every rule is the one the
 * readiness and the apply use — the dispositions (`dispositionsOf`), the readings (`readiness`), the rows that cannot be
 * written (`fileRows`), the duplicate plan (`planImport` through the apply's port) — never a copy of it.
 *
 * Nothing of a row's value goes to a log or an error: a refusal is a state code.
 */

/** A row's state (IMP-01@PoC FR 10): «гаразд», «потребує перегляду», «потребує уточнення», «помилка», «виключено». */
export const REVIEW_ROW_STATES = ["ok", "needs-review", "needs-clarification", "error", "excluded"] as const;
export type ReviewRowState = (typeof REVIEW_ROW_STATES)[number];

/** The bank's status of a row (IMP-08 FR 10, IMP-01 FR 16): «В обробці», «Невдала». */
export const BANK_STATUSES = ["processing", "failed"] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

/** A filter of the review's rows (IMP-08 FR 5, FR 6). */
export const REVIEW_ROW_FILTERS = [...REVIEW_ROW_STATES, "sign-unconfirmed", "changed"] as const;
export type ReviewRowFilter = (typeof REVIEW_ROW_FILTERS)[number];

export interface ReviewRow {
  readonly row: number;
  readonly state: ReviewRowState;
  /** The person's decision on the row (AC6): its own, or its group's. Null — none. */
  readonly decision: { readonly action: RowAction | GroupAction; readonly from: "row" | "group" } | null;
  /** FR 6, AC6: a value the person changed — the sign flipped or a reading chosen. */
  readonly changed: boolean;
  /** FR 6, AC5: the row is in the group «знак не підтверджено». */
  readonly signUnconfirmed: boolean;
  /** Why the engine believes the row's sign (IMP-05 FR 5); null — the engine read no sign for it. */
  readonly sign: Pick<RowSign, "basis" | "confidence" | "confirmed"> | null;
  /**
   * FR 7, AC4: an amount the engine does not decide alone — the cell, the candidate values a `reading` decision takes,
   * the chosen one, and «чому так» (the evidence of the file's number format).
   */
  readonly reading: {
    readonly cell: string;
    readonly readings: readonly AmountReading[];
    readonly chosen: string | null;
    readonly evidence: readonly Evidence[];
  } | null;
  /** Why the row cannot be written as it is («помилка»); null — it can. */
  readonly issue: RowIssue | null;
  /** #703: what more the issue says (`fee-basis`); null — nothing more. */
  readonly issueDetail: RowIssueDetail | null;
  /** FR 10: null until the parser reads the bank's status (IMP-01 FR 16, a follow-up). */
  readonly bankStatus: BankStatus | null;
}

export interface FileReviewSummary {
  readonly counts: {
    readonly rows: number;
    readonly states: Readonly<Record<ReviewRowState, number>>;
    readonly changed: number;
    readonly signUnconfirmed: number;
  };
  /** FR 6, AC5: the group «знак не підтверджено» — its size and the group's decision («Прийняти групу», «Перевернути знак»). */
  readonly signGroup: { readonly rows: number; readonly action: GroupAction | null };
  /** IMP-06 FR 8, AC8: the engine's decisions with their alternatives and «чому так», examples masked. */
  readonly analysis: StatementAnalysis;
  /** IMP-06 FR 8: the file's encoding and delimiter with their alternatives (scores only: no sample of the file). */
  readonly encoding: { readonly chosen: Guess; readonly alternatives: readonly Guess[] } | null;
  readonly delimiter: { readonly chosen: Guess; readonly alternatives: readonly Guess[] } | null;
}

export interface Guess {
  readonly value: string;
  readonly score: number;
  readonly reason?: string;
}

/** Each row of the file under the batch's decisions. Pure. */
export function reviewRows(
  events: readonly StatementEvent[],
  analysis: StatementAnalysis,
  review: FileReview,
  decisions: readonly Decided[],
  plan: FilePlan,
): readonly ReviewRow[] {
  const { checks } = review;
  const d = dispositionsOf(review, decisions);
  const signs = new Map(checks.signs.rows.map((s) => [s.row, s]));
  const unconfirmed = new Set(checks.signs.unconfirmed);
  const questions = new Map(
    checks.clarifications.flatMap((c) => (c.kind === "amount" ? [[c.row, c] as const] : [])),
  );
  const chosen = new Map(plan.readings.map((r) => [r.row, r.value]));
  const flipped = new Set(plan.flipped);
  const found = fileRows(events, plan, review).issues;
  const issues = new Map(found.map((i) => [i.row, i.issue]));
  const details = new Map(found.flatMap((i) => (i.detail ? [[i.row, i.detail] as const] : [])));
  const evidence = analysis.numbers?.evidence ?? [];
  return events.map((e): ReviewRow => {
    const action = d.disposition(e.row);
    const own = d.own(e.row);
    const question = questions.get(e.row);
    const value = chosen.get(e.row) ?? null;
    const state: ReviewRowState =
      action === "exclude"
        ? "excluded"
        : question && value === null && !closesQuestion(action)
          ? "needs-clarification"
          : unconfirmed.has(e.row) && action === null
            ? "needs-review"
            : issues.has(e.row)
              ? "error"
              : "ok";
    const sign = signs.get(e.row);
    return {
      row: e.row,
      state,
      decision: action === null ? null : { action, from: own === null ? "group" : "row" },
      changed: state !== "excluded" && (flipped.has(e.row) || readsOtherwise(e, value)),
      signUnconfirmed: unconfirmed.has(e.row),
      sign: sign ? { basis: sign.basis, confidence: sign.confidence, confirmed: sign.confirmed } : null,
      reading: question
        ? {
            cell: question.cell,
            readings: question.readings.map((r) => ({ ...r })),
            chosen: value,
            evidence: evidence.map(maskEvidence),
          }
        : null,
      issue: issues.get(e.row) ?? null,
      issueDetail: details.get(e.row) ?? null,
      bankStatus: null,
    };
  });
}

/** A chosen reading that is not what the engine read for the row (its size: the sign is the row's own). */
function readsOtherwise(e: StatementEvent, value: string | null): boolean {
  const leg = e.legs.length === 1 ? e.legs[0]! : null;
  if (value === null) return false;
  if (!leg) return true;
  try {
    return !new Decimal(leg.amount).abs().equals(new Decimal(value).abs());
  } catch {
    return true;
  }
}

export function matchesFilter(r: ReviewRow, filter: ReviewRowFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter === "sign-unconfirmed") return r.signUnconfirmed;
  if (filter === "changed") return r.changed;
  return r.state === filter;
}

/** The counts of the file's rows (AC3) and its sign group (AC5). Pure. */
export function summaryOf(
  rows: readonly ReviewRow[],
  review: FileReview,
  decisions: readonly Decided[],
): FileReviewSummary["counts"] & { readonly groupAction: GroupAction | null } {
  const states = Object.fromEntries(REVIEW_ROW_STATES.map((s) => [s, 0])) as Record<ReviewRowState, number>;
  for (const r of rows) states[r.state] += 1;
  return {
    rows: rows.length,
    states,
    changed: rows.filter((r) => r.changed).length,
    signUnconfirmed: rows.filter((r) => r.signUnconfirmed).length,
    groupAction: dispositionsOf(review, decisions).group("review"),
  };
}

const maskText = (t: string): string => maskNumbers(t) ?? t;

function maskEvidence(e: Evidence): Evidence {
  return {
    ...e,
    ...(e.word !== undefined ? { word: maskText(e.word) } : {}),
    ...(e.example !== undefined ? { example: maskText(e.example) } : {}),
  };
}

const maskHypothesis = <V>(h: Hypothesis<V>): Hypothesis<V> => ({
  ...h,
  examples: h.examples.map((x) => ({
    cell: maskText(x.cell),
    reads: x.reads === null ? null : maskText(x.reads),
  })),
});

const maskDecision = <V>(x: Decision<V>): Decision<V> => ({
  ...x,
  chosen: maskHypothesis(x.chosen),
  alternatives: x.alternatives.map(maskHypothesis),
  evidence: x.evidence.map(maskEvidence),
});

/** The analysis with every text of the file masked (an IBAN or a card number keeps its last 4 characters). */
export function maskedAnalysis(a: StatementAnalysis): StatementAnalysis {
  return {
    table: { ...a.table, evidence: a.table.evidence.map(maskEvidence) },
    columns: a.columns.map((c) => ({
      ...c,
      header: c.header === null ? null : maskText(c.header),
      role: maskDecision(c.role),
    })),
    dates: a.dates ? maskDecision(a.dates) : null,
    numbers: a.numbers ? maskDecision(a.numbers) : null,
    sign: a.sign ? maskDecision(a.sign) : null,
    currency: { ...a.currency, evidence: a.currency.evidence.map(maskEvidence) },
  };
}

// ——— The read side in the batch's transaction ———

interface Opened {
  readonly state: BatchState;
  readonly review: FileReview;
  readonly decisions: readonly Decided[];
  readonly plan: FilePlan;
  readonly parse: FileParse;
  readonly sealed: SealedParse;
}

/** The file's parse opened and its plan under the batch's decisions; 404 for a file not of the batch, 409 unparsed. */
async function openFile(
  tx: ReviewBatchesTx & ParseTx,
  open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>,
  batchId: string,
  batchFileId: string,
): Promise<Opened> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  const parse = (await tx.parses(batchId)).find((p) => p.batchFileId === batchFileId);
  if (!parse) throw new BatchNotFoundError();
  const review = (await tx.reviews(batchId)).find((r) => r.batchFileId === batchFileId);
  if (parse.state !== "parsed" || !parse.rowsSealed || !review) throw new BatchStateErrorFor(batch.state);
  const decisions = await tx.decisions(batchId);
  const plan = readiness([review], decisions).files[0]!;
  const plain = await open(parsePurpose(parse.batchFileId, parse.parseId), parse.rowsSealed);
  const sealed = JSON.parse(new TextDecoder().decode(plain)) as SealedParse;
  return { state: batch.state, review, decisions, plan, parse, sealed };
}

/** A page of the file's review rows, after the row `after`, those the filter takes. */
export async function reviewRowsOf(
  tx: ReviewBatchesTx & ParseTx,
  open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>,
  batchId: string,
  batchFileId: string,
  page: { readonly limit: number; readonly after: number; readonly filter?: ReviewRowFilter },
): Promise<{ readonly rows: readonly ReviewRow[]; readonly more: boolean }> {
  const f = await openFile(tx, open, batchId, batchFileId);
  const all = reviewRows(f.sealed.events.events, f.sealed.analysis, f.review, f.decisions, f.plan);
  const after = all.filter((r) => r.row > page.after && matchesFilter(r, page.filter));
  return { rows: after.slice(0, page.limit), more: after.length > page.limit };
}

/** The file's counts, its sign group and the engine's decisions with their alternatives and evidence. */
export async function fileReviewOf(
  tx: ReviewBatchesTx & ParseTx,
  open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>,
  batchId: string,
  batchFileId: string,
): Promise<FileReviewSummary> {
  const f = await openFile(tx, open, batchId, batchFileId);
  const rows = reviewRows(f.sealed.events.events, f.sealed.analysis, f.review, f.decisions, f.plan);
  const { groupAction, ...counts } = summaryOf(rows, f.review, f.decisions);
  const { reading } = f.sealed;
  return {
    counts,
    signGroup: { rows: counts.signUnconfirmed, action: groupAction },
    analysis: maskedAnalysis(f.sealed.analysis),
    encoding: reading?.encoding
      ? {
          chosen: {
            value: reading.encoding.chosen.encoding,
            score: reading.encoding.chosen.score,
            reason: reading.encoding.chosen.reason,
          },
          alternatives: reading.encoding.alternatives.map((g) => ({ value: g.encoding, score: g.score })),
        }
      : null,
    delimiter: reading?.delimiter
      ? {
          chosen: {
            value: reading.delimiter.chosen.delimiter,
            score: reading.delimiter.chosen.score,
            reason: reading.delimiter.chosen.reason,
          },
          alternatives: reading.delimiter.alternatives.map((g) => ({ value: g.delimiter, score: g.score })),
        }
      : null,
  };
}

// ——— IMP-04: the duplicate preview before «Застосувати» ———

/** What a row would be at the apply (IMP-04 FR 1–6), «з чим збіг»: only the rows that are not plain new ones. */
export type DuplicatePreview = Exclude<RowOutcome, { kind: "import" }>;

export interface PreviewPorts {
  /** The apply's plan port (module duplicate-matching's `planImport` for the caller's space). */
  readonly plan: ApplyPorts["plan"];
  /** Reads the account's transactions as the apply's plan does (module transactions' `ImportCandidates`). */
  readonly candidates: Parameters<ApplyPorts["plan"]>[0]["candidates"];
  /** FR 4 (#655): the account is a credit card. */
  readonly creditCard: (accountId: string) => Promise<boolean>;
}

/**
 * IMP-04@PoC FR 1–6 before the apply: the file's writable rows (`fileRows`, as the apply takes them under the batch's
 * decisions) planned by the apply's own port against the account's transactions as they are now, and the earlier
 * applied batch of the same file (FR 3). Read only: nothing written or locked. The apply plans each file after the
 * files before it are written: `afterEarlierFile` — an earlier file of the batch has the same account, so its rows,
 * not seen here, may match this file's rows too.
 */
export async function duplicatePreviewOf(
  run: <T>(work: (tx: ApplyBatchesTx) => Promise<T>) => Promise<T>,
  open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>,
  ports: PreviewPorts,
  batchId: string,
  batchFileId: string,
): Promise<{
  readonly accountId: string | null;
  readonly afterEarlierFile: boolean;
  readonly rows: readonly DuplicatePreview[];
}> {
  // The batch's part in its own transaction; the plan reads the other modules after it (no connection held meanwhile).
  const read = await run(async (tx) => {
    const f = await openFile(tx, open, batchId, batchFileId);
    // Only before the apply: an applied batch's rows are in the books (they would match themselves).
    if (f.state !== "parsed" && f.state !== "needs-review") throw new BatchStateErrorFor(f.state);
    const accountId = f.review.accountId;
    if (accountId === null) return null;
    const files = await tx.files(batchId);
    const position = files.find((x) => x.id === batchFileId)?.position ?? 0;
    const earlier = new Set(files.filter((x) => x.position < position).map((x) => x.id));
    const afterEarlierFile = (await tx.reviews(batchId)).some(
      (r) => earlier.has(r.batchFileId) && r.accountId === accountId,
    );
    return {
      accountId,
      afterEarlierFile,
      rows: fileRows(f.sealed.events.events, f.plan, f.review).rows,
      sameFileAppliedIn: await tx.sameFileApplied(batchFileId, accountId),
    };
  });
  if (read === null) return { accountId: null, afterEarlierFile: false, rows: [] };
  const outcomes = await ports.plan(
    { candidates: ports.candidates },
    {
      batchId,
      accountId: read.accountId,
      rows: read.rows,
      sameFileAppliedIn: read.sameFileAppliedIn,
      creditCard: await ports.creditCard(read.accountId),
    },
  );
  return {
    accountId: read.accountId,
    afterEarlierFile: read.afterEarlierFile,
    rows: outcomes.filter((o): o is DuplicatePreview => o.kind !== "import").sort((a, b) => a.row - b.row),
  };
}
