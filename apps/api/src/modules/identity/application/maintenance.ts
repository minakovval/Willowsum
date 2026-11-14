import { UNCONFIRMED_ACCOUNT_TTL_MS } from "../domain/index.ts";
import type { IdentityStore, IdentityTx, MaintenanceDeps, SweepCounts } from "./ports.ts";

/** Accounts deleted per transaction: a long backlog never holds one long transaction. */
export const DELETE_BATCH = 200;

/** Further attempts of one batch or sweep that PostgreSQL aborted as a deadlock victim (SQLSTATE 40P01). */
export const DEADLOCK_RETRIES = 2;

const isDeadlock = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "40P01";

/**
 * A confirmation locks its link row and then the account; the deletion locks the account and then its links
 * (cascade). When the two meet at the 30-day boundary PostgreSQL aborts one of them. The task's transaction holds
 * no work outside the database, so it is safe to run again: the batch is retried at once (its rows are rechecked,
 * so an account the confirmation committed meanwhile is kept), instead of waiting for the next daily run.
 */
async function withDeadlockRetry<T>(store: IdentityStore, work: (tx: IdentityTx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await store.transaction(work);
    } catch (error) {
      if (!isDeadlock(error) || attempt >= DEADLOCK_RETRIES) throw error;
    }
  }
}

export interface DailyCleanupReport extends SweepCounts {
  readonly unconfirmedAccounts: number;
  /** Open sessions that had lapsed, ended here (each written to the sign-in journal by the store). */
  readonly lapsedSessions: number;
}

/**
 * The daily task of identity (ACC-01 FR 6, AC8, AC9; NFR-12; ADR-0010). Unconfirmed accounts whose latest sign-up
 * is 30 days old or older are deleted with all their rows; no reminder is ever sent. Then the rows that no longer
 * change any answer or limit are swept. Idempotent: running it twice, or on two instances, deletes nothing more.
 * Open sessions that lapsed are ended (and so journaled) before the sweep. The clock is read once, so one run judges
 * every row by the same time.
 */
export async function dailyCleanup(deps: MaintenanceDeps): Promise<DailyCleanupReport> {
  const now = deps.now();
  let unconfirmedAccounts = 0;
  for (;;) {
    const ids = await withDeadlockRetry(deps.store, (tx) =>
      tx.deleteUnconfirmedAccounts(now - UNCONFIRMED_ACCOUNT_TTL_MS, DELETE_BATCH),
    );
    // In the platform log after the deletion: the id and the state only, never the address (П-10).
    for (const id of ids) await deps.audit.accountDeleted(id);
    unconfirmedAccounts += ids.length;
    if (ids.length < DELETE_BATCH) break;
  }
  // A session nobody came back to has lapsed but was never ended: it ends now, with its reason, so its end is in the
  // sign-in journal (ACC-04 business rules) before the sweep deletes it.
  const lapsed = await withDeadlockRetry(deps.store, (tx) => tx.endLapsedSessions(now));
  const swept = await withDeadlockRetry(deps.store, (tx) => tx.sweep(now));
  return { unconfirmedAccounts, lapsedSessions: lapsed.length, ...swept };
}
