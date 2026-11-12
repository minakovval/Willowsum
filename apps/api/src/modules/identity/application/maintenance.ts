import { UNCONFIRMED_ACCOUNT_TTL_MS } from "../domain/index.ts";
import type { MaintenanceDeps, SweepCounts } from "./ports.ts";

/** Accounts deleted per transaction: a long backlog never holds one long transaction. */
export const DELETE_BATCH = 200;

export interface DailyCleanupReport extends SweepCounts {
  readonly unconfirmedAccounts: number;
}

/**
 * The daily task of identity (ACC-01 FR 6, AC8, AC9; NFR-12; ADR-0010). Unconfirmed accounts whose latest sign-up
 * is 30 days old or older are deleted with all their rows; no reminder is ever sent. Then the rows that no longer
 * change any answer or limit are swept. Idempotent: running it twice, or on two instances, deletes nothing more.
 * The clock is read once, so one run judges every row by the same time.
 */
export async function dailyCleanup(deps: MaintenanceDeps): Promise<DailyCleanupReport> {
  const now = deps.now();
  let unconfirmedAccounts = 0;
  for (;;) {
    const ids = await deps.store.transaction((tx) =>
      tx.deleteUnconfirmedAccounts(now - UNCONFIRMED_ACCOUNT_TTL_MS, DELETE_BATCH),
    );
    // In the platform log after the deletion: the id and the state only, never the address (П-10).
    for (const id of ids) await deps.audit.accountDeleted(id);
    unconfirmedAccounts += ids.length;
    if (ids.length < DELETE_BATCH) break;
  }
  const swept = await deps.store.transaction((tx) => tx.sweep(now));
  return { unconfirmedAccounts, ...swept };
}
