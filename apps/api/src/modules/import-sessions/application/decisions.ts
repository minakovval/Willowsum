import type { StatementBounds, StatementChecks } from "../../file-parsers/index.ts";
import {
  BatchNotFoundError,
  BatchStateErrorFor,
  type BatchesDeps,
  type BatchesTx,
  type BatchHandOff,
  type Handed,
} from "./batches.ts";
import {
  checkDecision,
  historyOf,
  readiness,
  slotOf,
  type Decided,
  type DecisionInput,
  type FileReview,
  type Readiness,
} from "./review.ts";
import type { BatchState } from "../domain/index.ts";

/**
 * IMP-05@PoC part 2 (wave 2 row 42): a file's checks are recorded while its batch is «в обробці» (the parse step); the
 * person's decisions are taken while it is «розібрано» or «потребує перегляду» — until it is applied (FR 10); the
 * readiness is read in the same states (FR 11). Every change enqueues its audit hand-off (ADR-0015): kinds and counts
 * only, never a value of the file.
 */
const DECIDING: ReadonlySet<BatchState> = new Set(["parsed", "needs-review"]);

/** At most this many decisions in one request. */
export const DECISIONS_PER_REQUEST = 200;

/** The ports the review adds to the batch's transaction. */
export interface ReviewTx {
  /** Replaces the file's review (a re-parse records it again). */
  upsertReview(review: FileReview): Promise<void>;
  reviews(batchId: string): Promise<FileReview[]>;
  /**
   * FR 3: the last applied statement of the account in this space (the latest end of period, then the batch's latest
   * action), outside `batchId`; null — none.
   */
  previousStatement(
    accountId: string,
    batchId: string,
  ): Promise<{ readonly fileId: string; readonly bounds: StatementBounds } | null>;
  /** All the batch's decisions (the readiness); `page` — at most `limit` after the slot `after`, by slot. */
  decisions(
    batchId: string,
    page?: { readonly limit: number; readonly after?: string; readonly slots?: readonly string[] },
  ): Promise<Decided[]>;
  upsertDecision(batchId: string, decided: Decided): Promise<void>;
  /** The batch files whose parse was refused: they have no checks and take no decision (the parse step). */
  failedParses(batchId: string): Promise<readonly string[]>;
  /** The decisions of one file and the batch's own: a new parse of the file makes them stale. */
  dropDecisions(batchId: string, fileId: string): Promise<void>;
}

export type ReviewBatchesTx = BatchesTx & ReviewTx;

async function enqueue(
  tx: BatchesTx,
  deps: BatchesDeps,
  h: Omit<BatchHandOff, "changeId">,
): Promise<BatchHandOff> {
  const full = { ...h, changeId: deps.newId() };
  await tx.enqueueHandOff(full);
  return full;
}

export interface RecordInput {
  readonly actorId: string | null;
  readonly batchId: string;
  readonly batchFileId: string;
  readonly account: { readonly id: string | null; readonly currency: string | null };
  readonly suggestedAccountId?: string | null;
  readonly checks: StatementChecks;
}

/**
 * Records one accepted file's checks (FR 1–9) with its history gap against the last applied statement of the same
 * account in the space (FR 3, AC2). The batch must be «в обробці». A new record replaces the old one and drops the
 * decisions it made stale (the file's and the batch's own).
 */
export async function recordChecks(
  deps: BatchesDeps,
  tx: ReviewBatchesTx,
  input: RecordInput,
): Promise<Handed<FileReview>> {
  const batch = await tx.lockBatch(input.batchId);
  if (!batch) throw new BatchNotFoundError();
  if (batch.state !== "processing") throw new BatchStateErrorFor(batch.state);
  const file = (await tx.files(input.batchId)).find((f) => f.id === input.batchFileId);
  if (!file?.fileId) throw new BatchNotFoundError();
  const checks = maskedChecks(input.checks);
  const previous =
    input.account.id === null ? null : await tx.previousStatement(input.account.id, input.batchId);
  const review: FileReview = {
    batchFileId: file.id,
    batchId: input.batchId,
    accountId: input.account.id,
    accountCurrency: input.account.currency,
    suggestedAccountId: input.suggestedAccountId ?? null,
    checks,
    history: historyOf(previous?.bounds ?? null, checks),
    previousFileId: previous?.fileId ?? null,
    recordedAt: deps.now(),
  };
  await tx.upsertReview(review);
  await tx.dropDecisions(input.batchId, file.id);
  await tx.updateBatch(input.batchId, batch.state, deps.now());
  const h = await enqueue(tx, deps, {
    entityId: input.batchId,
    actorAccountId: input.actorId,
    action: "update",
    changes: [
      { field: "files.checked", before: null, after: String(file.position) },
      { field: "files.flags", before: null, after: String(checks.flags.length) },
      { field: "files.history", before: null, after: review.history.status },
    ],
  });
  return { result: review, handOffs: [h] };
}

/**
 * IMP-05 FR 4 and its business rule, #637 item 3: the account evidence is kept masked whatever the parse step gave —
 * an IBAN or a card as «…» and at most its last 4 characters, a currency only as a code (or a list of codes). The boundary checks it again
 * instead of trusting the parse.
 */
export function maskedChecks(checks: StatementChecks): StatementChecks {
  const masked = (value: string) =>
    /^…[^…]{0,4}$/u.test(value) ? value : `…${[...value.replace(/^…+/u, "")].slice(-4).join("")}`;
  // EC3: a file in several currencies the account does not hold names them all («EUR, USD»), up to 8 codes.
  const code = (value: string) =>
    /^[A-Z0-9]{3,10}(?:, [A-Z0-9]{3,10}){0,7}$/.test(value) ? value : masked(value);
  return {
    ...checks,
    account: {
      ...checks.account,
      reasons: checks.account.reasons.map((r) =>
        r.kind === "currency"
          ? { kind: r.kind, file: code(r.file), account: code(r.account) }
          : { kind: r.kind, file: masked(r.file), account: masked(r.account) },
      ),
    },
  };
}

/** The batch is not ready to be reviewed: a file is not checked yet (a file whose parse was refused has no checks). */
async function checkedFiles(tx: ReviewBatchesTx, batchId: string): Promise<FileReview[]> {
  const reviews = await tx.reviews(batchId);
  const checked = new Set(reviews.map((r) => r.batchFileId));
  const failed = new Set(await tx.failedParses(batchId));
  const accepted = (await tx.files(batchId)).filter((f) => f.fileId !== null && !failed.has(f.id));
  if (accepted.some((f) => !checked.has(f.id))) throw new BatchStateErrorFor("processing");
  return reviews;
}

/**
 * FR 10: the person's decisions on rows, groups, files and the batch, all or none. A decision replaces the one in its
 * slot, so each can be repeated until the batch is applied. AC7: a reading with more decimals than the currency allows
 * is refused (DecisionRefused).
 */
export async function decide(
  deps: BatchesDeps,
  tx: ReviewBatchesTx,
  actorId: string,
  batchId: string,
  inputs: readonly DecisionInput[],
): Promise<Handed<Decided[]>> {
  const batch = await tx.lockBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  if (!DECIDING.has(batch.state)) throw new BatchStateErrorFor(batch.state);
  const files = new Map((await checkedFiles(tx, batchId)).map((r) => [r.batchFileId, r]));
  const at = deps.now();
  const decided = inputs.map((d, i): Decided => ({
    slot: slotOf(d),
    fileId: d.fileId,
    decision: checkDecision(d, files, i),
    decidedBy: actorId,
    decidedAt: at,
  }));
  for (const d of decided) await tx.upsertDecision(batchId, d);
  await tx.updateBatch(batchId, batch.state, at);
  const kinds = [...new Set(inputs.map((d) => d.kind))].sort().join(",");
  const h = await enqueue(tx, deps, {
    entityId: batchId,
    actorAccountId: actorId,
    action: "update",
    changes: [
      { field: "decisions", before: null, after: String(inputs.length) },
      { field: "decisions.kinds", before: null, after: kinds },
    ],
  });
  // The answer is this request's decisions as stored (≤ DECISIONS_PER_REQUEST), never the whole batch's.
  const slots = [...new Set(decided.map((d) => d.slot))];
  return { result: await tx.decisions(batchId, { limit: slots.length, slots }), handOffs: [h] };
}

/** A page of the batch's decisions by slot: at most `limit`, after the slot `after`. */
export async function decisionsOf(
  tx: ReviewBatchesTx,
  batchId: string,
  page: { readonly limit: number; readonly after?: string },
): Promise<Decided[]> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  return tx.decisions(batchId, page);
}

export interface BatchReadiness extends Readiness {
  readonly reviews: readonly FileReview[];
}

/**
 * FR 11, AC3, AC8, AC9: whether the batch may be applied, with each refusal's explanation, and what the apply does with
 * each file. The batch must be «розібрано» or «потребує перегляду» with every accepted file checked.
 */
export async function readinessOf(tx: ReviewBatchesTx, batchId: string): Promise<BatchReadiness> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  if (!DECIDING.has(batch.state)) throw new BatchStateErrorFor(batch.state);
  const reviews = await checkedFiles(tx, batchId);
  return { ...readiness(reviews, await tx.decisions(batchId)), reviews };
}
