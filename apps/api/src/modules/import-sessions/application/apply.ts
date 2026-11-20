import { currencyInfo, Decimal, isCurrencyCode, Money } from "@willowsum/domain-kernel";
import {
  outcomeCounts,
  PlanTooLargeError,
  ROW_OUTCOMES,
  type IncomingRow,
  type PlanDeps,
  type PlanRequest,
  type RowOutcome,
} from "../../duplicate-matching/index.ts";
import type { StatementEvent } from "../../file-parsers/index.ts";
import {
  ImportBusy,
  importedText,
  ImportWriteRefused,
  ImportWriteVoided,
  type ImportCounts,
  type ImportedRowInput,
  type ImportPlanContext,
  type ImportWriteInput,
  type ImportWriteResult,
} from "../../transactions/index.ts";
import { maskNumbers, type BatchState } from "../domain/index.ts";
import { checkedResult, type ApplicationResult, type StoredApplication } from "./applications.ts";
import {
  BatchNotFoundError,
  BatchStateErrorFor,
  type Batch,
  type BatchesDeps,
  type BatchHandOff,
  type Handed,
} from "./batches.ts";
import type { ReviewBatchesTx } from "./decisions.ts";
import { parsePurpose, type FileParse, type ParseTx, type SealedParse } from "./parse.ts";
import { readiness, type FilePlan, type FileReview, type ReadinessCode } from "./review.ts";

/**
 * «Застосувати» (IMP-01@PoC FR 11; IMP-04@PoC FR 7, AC9; wave 2, the apply step, part a; #637). Nothing is written to
 * the books before it; then, in three steps:
 *
 * A. In this module's transaction with the batch locked: a finished result — returned as it is (FR 7: nothing new). Else
 *    the batch must be «розібрано» or «потребує перегляду» with the same version as checked, ready (IMP-05 FR 11), each
 *    file with its account, parsed, its rows writable (`fileRows`: an amount with more decimals than the currency has,
 *    also on a row closed «as read» — #637 item 1), and with nothing a later part brings (`ApplyUnsupported`). The
 *    result is stored «in progress» and the batch is «застосовано»: no decision, parse, cancel or delete changes it.
 * B. Module transactions writes the rows of every file in one of its transactions under the import and money locks of
 *    the batch's accounts (transactions `ImportedTransactions`), planning each file (duplicate-matching `planImport`)
 *    after the one before it is written; once per batch and once per row by their own keys.
 * C. The result's counts in this module's transaction, and the audit entry (IMP-04 FR 10): the counts, the engine's
 *    versions and the recipes.
 *
 * A crash after A leaves the result «in progress» (the batch read says `applying`): the next apply goes on from B under
 * the same attempt (B writes nothing twice), and the daily recovery (`recoverStuckApplications`) settles one nobody
 * retried. B refused (`ApplyRowsRefused`, `PlanTooLargeError`, `ApplyUnsupported` of a pending row replaced, a closed
 * account, `ImportBusy`) — the attempt is given up (module transactions `settle`, under the accounts' import lock: a
 * write of the same attempt by a request that joined it finishes first and is kept), then the batch goes back to its
 * state and the result is removed, nothing written; a write of the given-up attempt that comes later is refused there
 * (`ImportWriteVoided` → 409, try again; #654).
 */

/** The parts of the apply not built yet: refused with nothing written (the batch stays as it is). */
export const APPLY_UNSUPPORTED = [
  // IMP-05 FR 2: «Застосувати й оновити залишок до виписки».
  "balance-update",
  // IMP-05 FR 8: an order of day and month other than the engine's — the dates are read again.
  "date-order",
  // IMP-04 FR 6: a posted row in place of a pending one.
  "replace",
] as const;
export type ApplyUnsupportedReason = (typeof APPLY_UNSUPPORTED)[number];

export class ApplyUnsupported extends Error {
  readonly reason: ApplyUnsupportedReason;

  constructor(reason: ApplyUnsupportedReason) {
    super(`The apply does not take this yet: ${reason}`);
    this.name = "ApplyUnsupported";
    this.reason = reason;
  }
}

/** IMP-05 FR 11: the batch is not ready; the readiness route explains each code. */
export class ApplyNotReady extends Error {
  readonly codes: readonly ReadinessCode[];

  constructor(codes: readonly ReadinessCode[]) {
    super(`The batch is not ready: ${codes.join(", ")}`);
    this.name = "ApplyNotReady";
    this.codes = codes;
  }
}

export const ROW_ISSUES = ["unreadable", "currency", "too-precise", "fee", "account", "text"] as const;
export type RowIssue = (typeof ROW_ISSUES)[number];

/** At most this many rows are named in a refusal. */
export const ROWS_NAMED = 20;

/**
 * #654: the most rows one apply writes (all its files; a technical ceiling, the same for every plan, IMP-01 FR 13).
 * Past it — `ApplyTooLarge`, nothing written: the batch is split into several.
 */
export const APPLY_ROWS_MAX = 100_000;

export class ApplyTooLarge extends Error {
  constructor() {
    super("The batch has more rows than one apply writes");
    this.name = "ApplyTooLarge";
  }
}

/** #654: an apply «in progress» this long after it started is stuck (its request ended): the recovery settles it. */
export const STUCK_AFTER_MS = 15 * 60 * 1000;
/** At most this many stuck applies of a space are settled by one run of the recovery. */
export const STUCK_PER_RUN = 20;

/** Rows that cannot be written as they are; the person excludes or answers them. Nothing written. */
export class ApplyRowsRefused extends Error {
  readonly rows: readonly {
    readonly fileId: string;
    readonly row: number | null;
    readonly issue: RowIssue;
  }[];

  constructor(rows: ApplyRowsRefused["rows"]) {
    super(`Rows cannot be written: ${rows.length}`);
    this.name = "ApplyRowsRefused";
    this.rows = rows.slice(0, ROWS_NAMED);
  }
}

/** The ports the apply adds to the batch's transaction. */
export interface ApplicationTx {
  application(batchId: string): Promise<StoredApplication | null>;
  startApplication(
    application: StoredApplication & { readonly fromState: "parsed" | "needs-review" },
  ): Promise<void>;
  /** Only the attempt's own row «in progress». */
  finishApplication(batchId: string, attemptId: string, result: ApplicationResult): Promise<void>;
  dropApplication(batchId: string, attemptId: string): Promise<void>;
  /** #654: the applies «in progress» that started before `before`, the oldest first. */
  stuckApplications(before: Date, limit: number): Promise<readonly StoredApplication[]>;
  /** FR 3: the applied batch with a file of the same content for the same account; null — none. */
  sameFileApplied(batchFileId: string, accountId: string): Promise<string | null>;
}

export type ApplyBatchesTx = ReviewBatchesTx & ParseTx & ApplicationTx;

export interface ApplyPorts {
  /** This module's transaction bound to the caller's space. */
  readonly run: <T>(work: (tx: ApplyBatchesTx) => Promise<T>) => Promise<T>;
  /** Opens the parse's sealed rows (household `SpaceKeys.openBytes`). */
  readonly open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>;
  /** Module transactions' `ImportedTransactions.write`. */
  readonly write: (
    input: ImportWriteInput,
    plan: (context: ImportPlanContext) => Promise<ImportCounts>,
  ) => Promise<ImportWriteResult>;
  /** Module transactions' `ImportedTransactions.settle` (#654). */
  readonly settle: (
    input: Pick<ImportWriteInput, "batchId" | "attemptId" | "accountIds">,
  ) => Promise<ImportCounts | null>;
  /** Module duplicate-matching's `planImport` for the caller's space. */
  readonly plan: (deps: PlanDeps, request: PlanRequest) => Promise<readonly RowOutcome[]>;
}

/** A row as the apply writes it: the plan's input and the texts the transaction keeps. */
export interface ApplyRow extends IncomingRow {
  readonly counterparty: string | null;
}

/** The writable rows of one file under its plan, or the issues of the rows that are not. Pure. */
export function fileRows(
  events: readonly StatementEvent[],
  plan: FilePlan,
  review: Pick<FileReview, "accountCurrency" | "checks">,
): {
  readonly rows: readonly ApplyRow[];
  readonly excluded: number;
  readonly zero: number;
  readonly issues: readonly { readonly row: number; readonly issue: RowIssue }[];
} {
  const excluded = new Set(plan.excluded);
  const flipped = new Set(plan.flipped);
  const readings = new Map(plan.readings.map((r) => [r.row, r.value]));
  const rows: ApplyRow[] = [];
  const issues: { row: number; issue: RowIssue }[] = [];
  let zero = 0;
  let skipped = 0;
  for (const e of events) {
    if (excluded.has(e.row)) {
      skipped += 1;
      continue;
    }
    const leg = e.legs.length === 1 ? e.legs[0]! : null;
    const currency = leg?.currency ?? e.currency ?? review.accountCurrency;
    if (!leg || e.date === null) {
      issues.push({ row: e.row, issue: "unreadable" });
      continue;
    }
    if (currency === null || !isCurrencyCode(currency)) {
      issues.push({ row: e.row, issue: "currency" });
      continue;
    }
    // A fee is a leg of its own (IMP-02 FR 5): written by a later part, never dropped.
    if (e.fee && !new Decimal(e.fee.amount).isZero()) {
      issues.push({ row: e.row, issue: "fee" });
      continue;
    }
    let amount: Decimal;
    try {
      const read = new Decimal(leg.amount);
      // IMP-05 FR 7: the chosen reading's value with the sign the engine read for the row.
      const chosen = readings.get(e.row);
      amount = chosen === undefined ? read : new Decimal(chosen).abs().times(read.isNegative() ? -1 : 1);
      if (flipped.has(e.row)) amount = amount.negated();
    } catch {
      issues.push({ row: e.row, issue: "unreadable" });
      continue;
    }
    // #637 item 1: a row closed «as read» (accept, «імпортувати все одно») keeps the engine's amount — never more
    // decimals than the currency has (a reading is checked when chosen; this checks every row).
    if (amount.decimalPlaces() > currencyInfo(currency).minorUnits) {
      issues.push({ row: e.row, issue: "too-precise" });
      continue;
    }
    if (amount.isZero()) {
      zero += 1;
      continue;
    }
    let balance: Money | null;
    try {
      balance = e.balance === null ? null : Money.of(e.balance, currency);
    } catch {
      // A printed balance that does not read is not kept (it is no part of the money written).
      balance = null;
    }
    // An amount past what the books hold (20 integer digits) is the row's refusal, never a server error.
    let money: Money;
    try {
      money = Money.of(amount, currency);
    } catch {
      issues.push({ row: e.row, issue: "unreadable" });
      continue;
    }
    // IMP-05 business rule: an IBAN or a card number in the bank's text keeps its last 4 characters, in the books too.
    // #654: the text as the transaction keeps it (clipped to its column), so the plan compares what is stored.
    const description = importedText(maskNumbers(e.description), "description");
    const counterparty = importedText(maskNumbers(e.counterparty), "counterparty");
    if (description === undefined || counterparty === undefined) {
      issues.push({ row: e.row, issue: "text" });
      continue;
    }
    rows.push({
      row: e.row,
      date: e.date,
      amount: money,
      description,
      counterparty,
      balance,
      status: "posted",
    });
  }
  return { rows, excluded: skipped, zero, issues };
}

/** One file as the apply takes it. */
interface ReadyFile {
  readonly review: FileReview & { readonly accountId: string };
  readonly plan: FilePlan;
  readonly parse: FileParse;
  readonly sameFileAppliedIn: string | null;
}

interface Checked {
  readonly batch: Batch;
  readonly started: StoredApplication | null;
  readonly files: readonly ReadyFile[];
}

const DECIDING: ReadonlySet<BatchState> = new Set(["parsed", "needs-review"]);

/** Step A's checks in the transaction (the batch locked); nothing written. */
async function check(tx: ApplyBatchesTx, batchId: string): Promise<Checked | StoredApplication> {
  const batch = await tx.lockBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  const stored = await tx.application(batchId);
  if (stored && !stored.inProgress) return stored;
  if (stored ? batch.state !== "applied" : !DECIDING.has(batch.state))
    throw new BatchStateErrorFor(batch.state);
  const reviews = await tx.reviews(batchId);
  const failed = new Set(await tx.failedParses(batchId));
  const accepted = (await tx.files(batchId)).filter((f) => f.fileId !== null && !failed.has(f.id));
  // Every accepted file is checked (a refused parse has no checks and nothing to write).
  if (accepted.some((f) => !reviews.some((r) => r.batchFileId === f.id)))
    throw new BatchStateErrorFor(batch.state);
  const r = readiness(reviews, await tx.decisions(batchId));
  if (!r.ready) throw new ApplyNotReady(r.refusals.map((x) => x.code));
  const parses = new Map((await tx.parses(batchId)).map((p) => [p.batchFileId, p]));
  const files: ReadyFile[] = [];
  for (const review of reviews) {
    const plan = r.files.find((p) => p.fileId === review.batchFileId)!;
    const parse = parses.get(review.batchFileId);
    // #637 item 1: a file without an account is never applied (readiness refuses it too).
    if (review.accountId === null) throw new ApplyNotReady(["confirm-account"]);
    if (parse?.state !== "parsed" || !parse.rowsSealed) throw new BatchStateErrorFor(batch.state);
    if (plan.balance === "update") throw new ApplyUnsupported("balance-update");
    files.push({
      review: { ...review, accountId: review.accountId },
      plan,
      parse,
      sameFileAppliedIn: await tx.sameFileApplied(review.batchFileId, review.accountId),
    });
  }
  return { batch, started: stored, files };
}

export interface Applied {
  readonly application: StoredApplication;
  /** False — the stored result of an earlier apply (FR 7): nothing was written now. */
  readonly first: boolean;
}

const COUNTED: ReadonlySet<string> = new Set(ROW_OUTCOMES);

/** B's refusals: nothing was written by this attempt (module transactions rolled back). */
const refusedWrite = (error: unknown) =>
  error instanceof ApplyUnsupported ||
  error instanceof ApplyRowsRefused ||
  error instanceof PlanTooLargeError ||
  error instanceof ImportWriteRefused ||
  error instanceof ImportBusy;

type Deps = BatchesDeps & { readonly engineVersion?: string };

/**
 * #654: gives the attempt up. Module transactions first (under the accounts' import lock): written meanwhile by a request
 * that joined it — its counts, the caller finishes the apply; else no write of the attempt can follow, and the batch
 * goes back to its state with the result removed (only this attempt's row «in progress»). Undefined — module
 * transactions could not answer (a lock wait, a failure): the result stays «in progress» for a retry or the recovery.
 */
async function giveUp(
  deps: Deps,
  ports: Pick<ApplyPorts, "run" | "settle">,
  batchId: string,
  attemptId: string,
  accountIds: readonly string[],
): Promise<ImportCounts | null | undefined> {
  let settled: ImportCounts | null;
  try {
    settled = await ports.settle({ batchId, attemptId, accountIds });
  } catch {
    return undefined;
  }
  if (settled) return settled;
  await ports.run(async (tx) => {
    const batch = await tx.lockBatch(batchId);
    const stored = await tx.application(batchId);
    if (!batch || !stored?.inProgress || stored.attemptId !== attemptId) return;
    await tx.dropApplication(batchId, attemptId);
    // A row without its state (stored before it was kept): the state that asks for a review again.
    await tx.updateBatch(batchId, stored.fromState ?? "needs-review", deps.now());
  });
  return null;
}

/** C: the counts of the attempt, once; the audit entry (IMP-04 FR 10) by `actorId`. */
async function finish(
  deps: Deps,
  run: ApplyPorts["run"],
  batchId: string,
  attemptId: string,
  counts: ImportCounts,
  actorId: string,
): Promise<Handed<Applied>> {
  return run(async (tx) => {
    const batch = await tx.lockBatch(batchId);
    if (!batch) throw new BatchNotFoundError();
    const stored = await tx.application(batchId);
    if (stored && !stored.inProgress) return { result: { application: stored, first: false }, handOffs: [] };
    // Another attempt's row (this one was given up meanwhile): nothing of this one to finish.
    if (!stored || stored.attemptId !== attemptId) throw new BatchStateErrorFor(batch.state);
    const result = checkedResult({ counts });
    await tx.finishApplication(batchId, attemptId, result);
    const application = (await tx.application(batchId))!;
    // The versions of the files written: each reviewed file's parse.
    const parses = new Map((await tx.parses(batchId)).map((p) => [p.batchFileId, p]));
    const written = (await tx.reviews(batchId)).flatMap((r) => {
      const p = parses.get(r.batchFileId);
      return p?.state === "parsed" ? [p] : [];
    });
    const engines = [...new Set(written.map((p) => p.engineVersion))].sort().join(",");
    const recipes = [...new Set(written.flatMap((p) => (p.usedRecipeId ? [p.usedRecipeId] : [])))].sort();
    const changes = [
      { field: "state", before: stored.fromState ?? null, after: "applied" },
      { field: "engine", before: null, after: engines.slice(0, 64) },
      ...recipes.map((id) => ({ field: "recipe", before: null, after: id })),
      ...Object.entries(result.counts)
        .filter(([name, n]) => n > 0 || COUNTED.has(name))
        // A field name has no hyphen: «already-imported» is «rows.alreadyImported».
        .map(([name, n]) => ({
          field: `rows.${name.replace(/-([a-z])/gu, (_, c: string) => c.toUpperCase())}`,
          before: null,
          after: String(n),
        })),
    ];
    // An audit hand-off carries at most 4 changes (its job's schema): the apply is a few entries in a row.
    const handOffs: BatchHandOff[] = [];
    for (let i = 0; i < changes.length; i += 4) {
      const handOff: BatchHandOff = {
        entityId: batchId,
        actorAccountId: actorId,
        action: "update",
        changeId: deps.newId(),
        changes: changes.slice(i, i + 4),
      };
      await tx.enqueueHandOff(handOff);
      handOffs.push(handOff);
    }
    return { result: { application, first: true }, handOffs };
  });
}

export async function applyBatch(
  deps: Deps,
  ports: ApplyPorts,
  actorId: string,
  batchId: string,
): Promise<Handed<Applied>> {
  const checked = await ports.run((tx) => check(tx, batchId));
  if (!("files" in checked)) return { result: { application: checked, first: false }, handOffs: [] };

  // The rows of each file, opened from the parse's seal (never stored in the clear).
  const prepared: { file: ReadyFile; rows: readonly ApplyRow[]; excluded: number; zero: number }[] = [];
  const issues: ApplyRowsRefused["rows"][number][] = [];
  let total = 0;
  for (const file of checked.files) {
    const plain = await ports.open(
      parsePurpose(file.parse.batchFileId, file.parse.parseId),
      file.parse.rowsSealed!,
    );
    const sealed = JSON.parse(new TextDecoder().decode(plain)) as SealedParse;
    const engineOrder = sealed.analysis.dates?.chosen.value.order ?? null;
    if (file.plan.dateOrder !== null && file.plan.dateOrder !== engineOrder)
      throw new ApplyUnsupported("date-order");
    const out = fileRows(sealed.events.events, file.plan, file.review);
    for (const i of out.issues) issues.push({ fileId: file.review.batchFileId, ...i });
    total += out.rows.length;
    // #654: one apply writes at most APPLY_ROWS_MAX rows (checked before anything is stored).
    if (total > APPLY_ROWS_MAX) throw new ApplyTooLarge();
    prepared.push({ file, rows: out.rows, excluded: out.excluded, zero: out.zero });
  }
  if (issues.length > 0) throw new ApplyRowsRefused(issues);

  // A: the result «in progress», the batch «застосовано» — unless a crashed apply left it so (its attempt goes on).
  const at = deps.now();
  const attemptId =
    checked.started?.attemptId ??
    (await ports.run(async (tx) => {
      const batch = await tx.lockBatch(batchId);
      if (!batch) throw new BatchNotFoundError();
      // Another apply of the batch started meanwhile: this one goes on with its attempt (step B writes nothing twice).
      const other = await tx.application(batchId);
      if (other?.inProgress) {
        // Only an apply of the same checks is joined: the one that started it moved the version by one from what it
        // checked. A decision in between (this request's checks are older) — try again, nothing written by it.
        if (batch.version !== checked.batch.version + 1) throw new BatchStateErrorFor(batch.state);
        return other.attemptId;
      }
      // A decision or a parse since the checks (the version moved), or a finished apply: try again.
      if (other || batch.version !== checked.batch.version) throw new BatchStateErrorFor(batch.state);
      const id = deps.newId();
      await tx.startApplication({
        batchId,
        result: { counts: {} },
        appliedBy: actorId,
        appliedAt: at,
        inProgress: true,
        fromState: batch.state as "parsed" | "needs-review",
        attemptId: id,
      });
      await tx.updateBatch(batchId, "applied", at);
      return id;
    }));

  // B: module transactions writes every file's rows, each file planned after the one before it is written.
  const accountIds = prepared.map((p) => p.file.review.accountId);
  let counts: ImportCounts;
  try {
    counts = (
      await ports.write(
        {
          batchId,
          attemptId,
          actorId,
          accountIds,
          fileIds: prepared.map((p) => p.file.review.batchFileId),
        },
        async (context) => {
          const outcomes: RowOutcome[] = [];
          for (const p of prepared) {
            const fileId = p.file.review.batchFileId;
            const accountId = p.file.review.accountId;
            const planned = await ports.plan(
              { candidates: context.candidates },
              {
                batchId,
                accountId,
                rows: p.rows,
                sameFileAppliedIn: p.file.sameFileAppliedIn,
                // FR 4 (#655): a card's balance also matches by its size (either basis); any other account by value.
                creditCard: context.creditCard(accountId),
              },
            );
            if (planned.some((o) => o.kind === "replace")) throw new ApplyUnsupported("replace");
            const byRow = new Map(p.rows.map((r) => [r.row, r]));
            const create: ImportedRowInput[] = [];
            for (const o of planned) {
              // FR 5: the merge with a manual one is a later part; until then the row is written and shows as
              // «Можливий дубль» of it (the search of duplicate-matching), nothing merged or hidden.
              const outcome: RowOutcome =
                o.kind === "merge"
                  ? { row: o.row, occurrence: o.occurrence, kind: "possible-duplicate", candidates: [o.with] }
                  : o;
              outcomes.push(outcome);
              if (
                outcome.kind !== "import" &&
                outcome.kind !== "repeat" &&
                outcome.kind !== "possible-duplicate"
              )
                continue;
              const r = byRow.get(o.row)!;
              create.push({
                fileId,
                row: r.row,
                accountId,
                amount: r.amount,
                date: r.date,
                description: r.description,
                counterparty: r.counterparty,
                balanceAfter: r.balance,
              });
            }
            await context.create(create);
          }
          const counted: Record<string, number> = { ...outcomeCounts(outcomes) };
          counted["excluded"] = prepared.reduce((n, p) => n + p.excluded, 0);
          counted["zero"] = prepared.reduce((n, p) => n + p.zero, 0);
          counted["files"] = prepared.length;
          return checkedResult({ counts: counted }).counts;
        },
      )
    ).counts;
  } catch (error) {
    // The attempt was given up (a refused request of it, or the recovery) before this write: nothing written; try again.
    if (error instanceof ImportWriteVoided) throw new BatchStateErrorFor("applied");
    if (!refusedWrite(error)) throw error;
    const settled = await giveUp(deps, ports, batchId, attemptId, accountIds);
    // Written meanwhile by a request that joined this attempt: the apply is finished with its counts.
    if (!settled) throw error;
    counts = settled;
  }

  // C: the counts, once; the audit entry (IMP-04 FR 10).
  return finish(deps, ports.run, batchId, attemptId, counts, actorId);
}

/**
 * #654: the daily recovery of applies stuck «in progress» (their request ended after step A, nobody retried) in one
 * space, at most `STUCK_PER_RUN` of them started over `STUCK_AFTER_MS` ago: each is settled with module transactions —
 * written (a crash after B) — finished with the write's counts and its audit entry by the person who applied it; not
 * written — given up, the batch back in its state (no write of that attempt can follow). Returns how many were settled
 * and how many could not be (module transactions did not answer, or the finish failed: left «in progress» for the next
 * run; #655 — counted, never silent).
 */
export async function recoverStuckApplications(
  deps: Deps,
  ports: Pick<ApplyPorts, "run" | "settle">,
): Promise<Handed<{ readonly settled: number; readonly failed: number }>> {
  const before = new Date(deps.now().getTime() - STUCK_AFTER_MS);
  const stuck = await ports.run((tx) => tx.stuckApplications(before, STUCK_PER_RUN));
  const handOffs: BatchHandOff[] = [];
  let settled = 0;
  let failed = 0;
  for (const a of stuck) {
    const accountIds = (await ports.run((tx) => tx.reviews(a.batchId))).flatMap((r) =>
      r.accountId === null ? [] : [r.accountId],
    );
    const counts = await giveUp(deps, ports, a.batchId, a.attemptId, accountIds);
    if (counts === undefined) {
      failed += 1;
      continue;
    }
    if (counts) {
      const done = await finish(deps, ports.run, a.batchId, a.attemptId, counts, a.appliedBy).catch(
        () => null,
      );
      if (!done) {
        failed += 1;
        continue;
      }
      handOffs.push(...done.handOffs);
    }
    settled += 1;
  }
  return { result: { settled, failed }, handOffs };
}
