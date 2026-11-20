import type { ImportRollbackInput, ImportRollbackResult, RollbackMode } from "../../transactions/index.ts";
import type { ApplyBatchesTx } from "./apply.ts";
import {
  BatchNotFoundError,
  BatchStateErrorFor,
  type BatchesDeps,
  type BatchHandOff,
  type Handed,
} from "./batches.ts";

/**
 * «Відкотити» an applied batch (IMP-04@PoC FR 8, FR 10, AC7, AC8, AC12, EC4; IMP-16@PoC FR 1–5, FR 9, AC1, AC2, AC4, AC5;
 * wave 2 row 44), in three steps like the apply:
 *
 * A. In this module's transaction with the batch locked: rolled back already — its stored result (FR 3: nothing new).
 *    Else the batch must be «застосовано» with its apply finished, and applied at most 7 days ago (FR 1; past that —
 *    `RollbackExpired`, unless module transactions has rolled it back already: a crash between B and C is finished).
 * B. Module transactions rolls the batch's transactions back in one of its transactions under the import and money
 *    locks of the batch's accounts (`ImportedTransactions.rollback`, once per batch by its own record).
 * C. The batch «відкочено» with the result in this module's transaction, and the audit entry (FR 9): who (the entry's
 *    actor), when, how many rolled back, kept and restored.
 *
 * A crash after B leaves the batch «застосовано»: the next «Відкотити» (past the 7 days too) or the daily recovery
 * (`recoverStuckRollbacks`) finishes it with the mode, actor and time module transactions recorded (B changes nothing
 * twice).
 */

/** FR 1: a batch is rolled back within this many days after it was applied. */
export const ROLLBACK_DAYS = 7;

/** FR 1, AC4: the last moment the batch can be rolled back. */
export function rollbackUntil(appliedAt: Date): Date {
  return new Date(appliedAt.getTime() + ROLLBACK_DAYS * 24 * 60 * 60 * 1000);
}

/** AC8: «Строк відкату минув» — nothing changed. */
export class RollbackExpired extends Error {
  constructor() {
    super("The time to roll back the batch has passed");
    this.name = "RollbackExpired";
  }
}

/** The rollback as this module keeps it with the batch's applied result. */
export interface StoredRollback {
  readonly rolledBackBy: string;
  readonly rolledBackAt: Date;
  readonly mode: RollbackMode;
  readonly counts: Readonly<Record<string, number>>;
  /** The transactions kept (changed by the person, or sides of a transfer), at most 200. */
  readonly kept: readonly string[];
}

export interface RollbackTx {
  rollbackOf(batchId: string): Promise<StoredRollback | null>;
  recordRollback(batchId: string, rollback: StoredRollback): Promise<void>;
}

export interface RollbackPorts {
  /** This module's transaction bound to the caller's space. */
  readonly run: <T>(work: (tx: ApplyBatchesTx & RollbackTx) => Promise<T>) => Promise<T>;
  /** Module transactions' `ImportedTransactions.rollback`. */
  readonly rollback: (input: ImportRollbackInput) => Promise<ImportRollbackResult>;
  /** Module transactions' `ImportedTransactions.rolledBack`. */
  readonly rolledBack: (batchId: string) => Promise<TransactionsRollback | null>;
}

/** The rollback as module transactions recorded it: its first request's mode, actor and time. */
export type TransactionsRollback = Omit<ImportRollbackResult, "first">;

export interface RolledBack {
  readonly rollback: StoredRollback;
  /** False — the batch was rolled back before: nothing changed now. */
  readonly first: boolean;
}

export async function rollbackBatch(
  deps: BatchesDeps,
  ports: RollbackPorts,
  actorId: string,
  batchId: string,
  mode: RollbackMode,
): Promise<Handed<RolledBack>> {
  // A: the checks; nothing written.
  const checked = await ports.run(async (tx) => {
    const batch = await tx.lockBatch(batchId);
    if (!batch) throw new BatchNotFoundError();
    const stored = await tx.rollbackOf(batchId);
    if (batch.state === "rolled-back" && stored) return { done: stored } as const;
    const application = await tx.application(batchId);
    if (batch.state !== "applied" || !application || application.inProgress)
      throw new BatchStateErrorFor(batch.state);
    const accountIds = [
      ...new Set((await tx.reviews(batchId)).flatMap((r) => (r.accountId === null ? [] : [r.accountId]))),
    ];
    return { expired: deps.now() > rollbackUntil(application.appliedAt), accountIds } as const;
  });
  if ("done" in checked) return { result: { rollback: checked.done, first: false }, handOffs: [] };

  // B: module transactions rolls the transactions back (once per batch).
  let result: TransactionsRollback;
  if (checked.expired) {
    // Past 7 days only a rollback module transactions has done already is finished here (a crash before C).
    const done = await ports.rolledBack(batchId);
    if (!done) throw new RollbackExpired();
    result = done;
  } else {
    result = await ports.rollback({ batchId, actorId, accountIds: checked.accountIds, mode });
  }

  // C: the batch «відкочено», the result kept with it, the audit entry (FR 9) — once.
  return finishRollback(deps, ports.run, batchId, result);
}

/**
 * Step C: the batch «відкочено» with the rollback module transactions recorded — its mode, actor and time, never a
 * later request's (FR 3, FR 9) — and the audit entry, once. Also the recovery's finish of a request that ended after B.
 */
export async function finishRollback(
  deps: BatchesDeps,
  run: RollbackPorts["run"],
  batchId: string,
  result: TransactionsRollback,
): Promise<Handed<RolledBack>> {
  return run(async (tx) => {
    const batch = await tx.lockBatch(batchId);
    if (!batch) throw new BatchNotFoundError();
    const stored = await tx.rollbackOf(batchId);
    if (batch.state === "rolled-back" && stored)
      return { result: { rollback: stored, first: false }, handOffs: [] };
    if (batch.state !== "applied") throw new BatchStateErrorFor(batch.state);
    const rollback: StoredRollback = {
      rolledBackBy: result.rolledBackBy,
      rolledBackAt: result.rolledBackAt,
      mode: result.mode,
      counts: { ...result.counts },
      kept: [...result.kept],
    };
    await tx.recordRollback(batchId, rollback);
    await tx.updateBatch(batchId, "rolled-back", deps.now());
    const changes = [
      { field: "state", before: "applied", after: "rolled-back" },
      { field: "rollback.mode", before: null, after: result.mode },
      ...Object.entries(result.counts).map(([name, n]) => ({
        field: `rollback.${name}`,
        before: null,
        after: String(n),
      })),
    ];
    // An audit hand-off carries at most 4 changes (its job's schema): the rollback is a few entries in a row.
    const handOffs: BatchHandOff[] = [];
    for (let i = 0; i < changes.length; i += 4) {
      const handOff: BatchHandOff = {
        entityId: batchId,
        actorAccountId: result.rolledBackBy,
        action: "update",
        changeId: deps.newId(),
        changes: changes.slice(i, i + 4),
      };
      await tx.enqueueHandOff(handOff);
      handOffs.push(handOff);
    }
    return { result: { rollback, first: true }, handOffs };
  });
}

/** A rollback's request that ended after B this long ago is finished by the daily recovery. */
export const ROLLBACK_STUCK_AFTER_MS = 15 * 60 * 1000;
/** The recovery looks at the rollbacks module transactions recorded this far back (twice the 7 days). */
export const ROLLBACK_RECOVERY_DAYS = 14;

/**
 * The daily recovery's part for the rollback: a batch module transactions rolled back (B) whose request ended before
 * C — still «застосовано», no audit entry — is finished with the recorded result, so the batch's state and the money
 * agree. A batch finished already changes nothing.
 */
export async function recoverStuckRollbacks(
  deps: BatchesDeps,
  run: RollbackPorts["run"],
  rolledBackSince: (
    since: Date,
    before: Date,
  ) => Promise<readonly (TransactionsRollback & { batchId: string })[]>,
): Promise<Handed<{ readonly finished: number; readonly failed: number }>> {
  const now = deps.now().getTime();
  const done = await rolledBackSince(
    new Date(now - ROLLBACK_RECOVERY_DAYS * 24 * 60 * 60 * 1000),
    new Date(now - ROLLBACK_STUCK_AFTER_MS),
  );
  const handOffs: BatchHandOff[] = [];
  let finished = 0;
  let failed = 0;
  for (const r of done) {
    const out = await finishRollback(deps, run, r.batchId, r).catch((e: unknown) =>
      e instanceof BatchNotFoundError ? null : undefined,
    );
    if (out === undefined) failed += 1;
    else if (out?.result.first) {
      finished += 1;
      handOffs.push(...out.handOffs);
    }
  }
  return { result: { finished, failed }, handOffs };
}
