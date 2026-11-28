import {
  DERIVATION_FOREGROUND_MAX,
  deriveSuggestions,
  type DerivationRow,
  type DerivedSuggestion,
} from "../domain/index.ts";
import type { AuditHandOff } from "./rules.ts";

/**
 * The derivation of category rules from a history file (BUD-21@PoC FR 9–15, FR 17, FR 26; wave 2 row 235). The rows
 * come from module import-sessions (the confirmed batch, its labels resolved to the space's categories, BUD-21 b);
 * the merchant of each row is the one module merchants' cleaning gives its text (FR 9) — read only, no merchant is
 * born. The engine (domain/history-derivation.ts) runs over the whole array: up to 2 000 rows in the request, more in
 * the background with «оброблено X з N рядків» (FR 10). A second start while one runs starts nothing (EC10).
 */

/** A categorised row of a confirmed history batch, as module import-sessions gives it (`HistoryRowsSource`). */
export interface HistorySourceRow {
  readonly row: number;
  readonly date: string;
  readonly amount: string;
  readonly currency: string | null;
  readonly counterparty: string | null;
  readonly description: string | null;
  /** The description as the user may see it: an IBAN or a card number masked to its last 4 characters. */
  readonly shown: string | null;
  readonly accountId: string | null;
  /** The space's category of the row's label; null — a transfer. */
  readonly categoryId: string | null;
  /** FR 16 (row 236): a transfer row of the file (its mark, or a label marked as a transfer). */
  readonly transfer: boolean;
  readonly tags: readonly string[];
}

/** Module import-sessions' history batches, bound by the caller to nothing: every call names the space. */
export interface HistoryRowsSource {
  /** The categorised rows of a confirmed history batch of the space; null — no such batch, not confirmed, or gone. */
  rows(householdId: string, batchId: string): Promise<readonly HistorySourceRow[] | null>;
  /** Which of `batchIds` are history batches the space still stores. */
  existing(householdId: string, batchIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** FR 9: module merchants' names of texts, read only (`MerchantDirectory.knownMerchants`). */
export interface DerivationMerchants {
  knownNames(householdId: string, texts: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export type DerivationStatus = "running" | "completed" | "failed";

export interface DerivationRun {
  readonly id: string;
  readonly batchId: string;
  readonly actorAccountId: string;
  readonly status: DerivationStatus;
  readonly count: number;
  readonly processed: number;
  readonly createdAt: number;
  readonly endedAt: number | null;
}

export interface StoredSuggestion extends DerivedSuggestion {
  readonly ordinal: number;
}

/** The derivations part of the categorization schema, in one transaction of the module (adapters/db/derivations.ts). */
export interface DerivationsTx {
  /** Holds the batch's derivations to the end of the transaction: one start at a time. */
  lockBatch(householdId: string, batchId: string): Promise<void>;
  running(householdId: string, batchId: string): Promise<DerivationRun | null>;
  latest(householdId: string, batchId: string): Promise<DerivationRun | null>;
  run(householdId: string, id: string, lock?: boolean): Promise<DerivationRun | null>;
  insertRun(householdId: string, run: DerivationRun): Promise<void>;
  /** Queues the background run (`categorization.history-derivation`), one job per run. */
  enqueueRun(householdId: string, id: string): Promise<void>;
  enqueueAudit(householdId: string, handOff: AuditHandOff): Promise<void>;
  setProgress(householdId: string, id: string, processed: number): Promise<void>;
  finish(
    householdId: string,
    id: string,
    status: "completed" | "failed",
    suggestions: readonly DerivedSuggestion[],
    at: number,
  ): Promise<void>;
  suggestions(householdId: string, derivationId: string): Promise<StoredSuggestion[]>;
  /** The batches the space has derivations of. */
  batches(householdId: string): Promise<string[]>;
  /** FR 24: the derivations of batches that are gone, with their suggestions; returns how many. */
  forget(householdId: string, batchIds: readonly string[]): Promise<number>;
}

export type DerivationsRun = <T>(householdId: string, work: (tx: DerivationsTx) => Promise<T>) => Promise<T>;

export interface DerivationDeps {
  readonly source: HistoryRowsSource;
  readonly merchants: DerivationMerchants;
  /**
   * FR 16 (row 236): the id of the space's service category «Переказ» (module categories' `serviceCategory`) — the
   * category of the transfer rows, so a suggestion of them has the action «категорія „Переказ“»; null — none.
   */
  readonly transferCategory: (householdId: string) => Promise<string | null>;
  readonly now: () => number;
  readonly newId: () => string;
}

/** The batch is not a confirmed history file of the space (or it is gone): nothing to derive from. */
export class DerivationSourceMissing extends Error {
  constructor() {
    super("History batch not found or not confirmed");
    this.name = "DerivationSourceMissing";
  }
}

/** FR 26 «запуск виведення»: who and how many rows — never a value of the file. */
function startAudit(run: DerivationRun): AuditHandOff {
  return {
    key: `categorization.history-derivation:${run.id}`,
    actorAccountId: run.actorAccountId,
    entity: "categorization.history-derivation",
    entityId: run.id,
    action: "create",
    changes: [
      { field: "batchId", before: null, after: run.batchId, sensitive: false },
      { field: "count", before: null, after: String(run.count), sensitive: false },
      { field: "status", before: null, after: run.status, sensitive: false },
    ],
  };
}

/**
 * FR 10, EC10: starts the derivation of a confirmed history batch — or, while one runs for it, shows that one
 * (`started: false`). The run and its background job are one transaction; the job is the fallback of the request's
 * own run, so a run never stays «в обробці» for good (a dead job goes back with the daily recovery).
 */
export async function startDerivation(
  deps: DerivationDeps,
  inSpace: DerivationsRun,
  input: { readonly householdId: string; readonly actorAccountId: string; readonly batchId: string },
): Promise<{
  readonly run: DerivationRun;
  readonly started: boolean;
  readonly rows: readonly HistorySourceRow[] | null;
  readonly audit: AuditHandOff | null;
}> {
  const rows = await deps.source.rows(input.householdId, input.batchId);
  if (rows === null) throw new DerivationSourceMissing();
  return inSpace(input.householdId, async (tx) => {
    await tx.lockBatch(input.householdId, input.batchId);
    const running = await tx.running(input.householdId, input.batchId);
    if (running) return { run: running, started: false, rows: null, audit: null };
    const run: DerivationRun = {
      id: deps.newId(),
      batchId: input.batchId,
      actorAccountId: input.actorAccountId,
      status: "running",
      count: rows.length,
      processed: 0,
      createdAt: deps.now(),
      endedAt: null,
    };
    await tx.insertRun(input.householdId, run);
    await tx.enqueueRun(input.householdId, run.id);
    const audit = startAudit(run);
    await tx.enqueueAudit(input.householdId, audit);
    return { run, started: true, rows, audit };
  });
}

/**
 * FR 16 (row 236): the transfer rows take the category «Переказ» (`transferId`), so the engine derives their
 * suggestions in the same way and with the same thresholds as any other category — over the same array, so a
 * merchant's rows that are partly transfers are as mixed as with any two categories. Without «Переказ» (never in a
 * space whose tree is written) the transfer rows are left out, as before row 236.
 */
export function withTransferCategory(
  rows: readonly HistorySourceRow[],
  transferId: string | null,
): (HistorySourceRow & { readonly categoryId: string })[] {
  return rows.flatMap((r) => {
    const categoryId = r.transfer ? transferId : r.categoryId;
    return categoryId === null ? [] : [{ ...r, categoryId }];
  });
}

/** FR 10: the merchants are read this many texts at a time; the progress moves after each part. */
export const DERIVATION_PART_ROWS = 1000;

/**
 * FR 9–15, FR 17: a run of the derivation — the rows (`rows`, or read again from the batch), each row's merchant from
 * module merchants' cleaning of its counterparty, else its description (read only: FR 9, no merchant is born), the
 * engine, then the suggestions written and the run completed under the run's lock. It can run twice (the request and
 * the job): the second finds the run no longer running and writes nothing; the result is the same (FR 11).
 */
export async function executeDerivation(
  deps: DerivationDeps,
  inSpace: DerivationsRun,
  householdId: string,
  runId: string,
  rows?: readonly HistorySourceRow[] | null,
): Promise<void> {
  const run = await inSpace(householdId, (tx) => tx.run(householdId, runId));
  if (!run || run.status !== "running") return;
  const read = rows ?? (await deps.source.rows(householdId, run.batchId));
  if (read === null) {
    await inSpace(householdId, async (tx) => {
      const locked = await tx.run(householdId, runId, true);
      if (locked?.status === "running") await tx.finish(householdId, runId, "failed", [], deps.now());
    });
    return;
  }
  const source = read.some((r) => r.transfer)
    ? withTransferCategory(read, await deps.transferCategory(householdId))
    : withTransferCategory(read, null);
  const background = read.length > DERIVATION_FOREGROUND_MAX;
  const prepared: DerivationRow[] = [];
  for (let at = 0; at < source.length; at += DERIVATION_PART_ROWS) {
    const part = source.slice(at, at + DERIVATION_PART_ROWS);
    const texts = part.flatMap((r) => {
      const text = r.counterparty ?? r.description;
      return text === null ? [] : [text];
    });
    const names = await deps.merchants.knownNames(householdId, texts);
    for (const r of part) {
      const text = r.counterparty ?? r.description;
      prepared.push({
        row: r.row,
        date: r.date,
        amount: r.amount,
        currency: r.currency,
        merchant: text === null ? null : (names.get(text) ?? null),
        description: r.description ?? r.counterparty,
        accountId: r.accountId,
        categoryId: r.categoryId,
        tags: r.tags,
      });
    }
    // «оброблено X з N»: all N only once the suggestions are written.
    if (background)
      await inSpace(householdId, (tx) =>
        tx.setProgress(householdId, runId, Math.min(prepared.length, source.length - 1)),
      );
  }
  const suggestions = deriveSuggestions(prepared);
  await inSpace(householdId, async (tx) => {
    const locked = await tx.run(householdId, runId, true);
    if (locked?.status !== "running") return;
    await tx.finish(householdId, runId, "completed", suggestions, deps.now());
  });
}

/** FR 24: the daily sweep — the derivations of batches no longer stored go with their suggestions. */
export async function forgetGoneBatches(
  deps: Pick<DerivationDeps, "source">,
  inSpace: DerivationsRun,
  householdId: string,
): Promise<number> {
  const batches = await inSpace(householdId, (tx) => tx.batches(householdId));
  if (batches.length === 0) return 0;
  const kept = await deps.source.existing(householdId, batches);
  const gone = batches.filter((b) => !kept.has(b));
  return gone.length === 0 ? 0 : inSpace(householdId, (tx) => tx.forget(householdId, gone));
}
