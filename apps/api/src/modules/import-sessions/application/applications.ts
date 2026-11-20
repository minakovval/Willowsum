/**
 * The idempotent apply of a batch (IMP-04@PoC FR 7; wave 2 row 43; the apply step, apply.ts): one stored result per
 * batch. The apply stores it «in progress» before module transactions writes the rows and finishes it with the counts
 * after (#637: a crash between them is finished by the next apply); every later apply gets the stored one back.
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
  /** The rows are being written (apply.ts step B); the counts come when they are. */
  readonly inProgress: boolean;
  /** The batch's state before the apply started; null — stored before it was kept. */
  readonly fromState?: "parsed" | "needs-review" | null;
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
