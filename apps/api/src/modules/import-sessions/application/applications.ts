/**
 * The idempotent apply of a batch (IMP-04@PoC FR 7; wave 2 row 43): one stored result per batch. The apply step (the
 * next slice) calls `recordOnce` in its own transaction of this module with the batch locked: the first call stores its
 * result, every later one — also a request sent at the same time — gets the stored one back and must create nothing.
 */

/** Counts by outcome (duplicate-matching `ROW_OUTCOMES`, `outcomeCounts`) and the apply step's own counts. */
export interface ApplicationResult {
  readonly counts: Readonly<Record<string, number>>;
}

export interface StoredApplication {
  readonly batchId: string;
  readonly result: ApplicationResult;
  readonly appliedBy: string;
  readonly appliedAt: Date;
}

/** At most this many counts; a name is lower-case words with hyphens. */
export const APPLICATION_COUNTS_MAX = 32;
const COUNT_NAME = /^[a-z][a-z-]{0,39}$/u;

export class ApplicationResultError extends Error {
  constructor() {
    super("The result of the apply is not a set of counts");
    this.name = "ApplicationResultError";
  }
}

/** The result as stored: only named non-negative whole counts (no text of rows, ARC-11). */
export function checkedResult(result: ApplicationResult): ApplicationResult {
  const entries = Object.entries(result.counts);
  if (
    entries.length > APPLICATION_COUNTS_MAX ||
    entries.some(([name, n]) => !COUNT_NAME.test(name) || !Number.isSafeInteger(n) || n < 0)
  )
    throw new ApplicationResultError();
  return { counts: Object.fromEntries(entries) };
}
