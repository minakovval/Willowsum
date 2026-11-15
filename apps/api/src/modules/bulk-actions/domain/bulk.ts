/**
 * Rules of a bulk action (DAT-03@PoC), pure: the size of one action, when it runs in the background, the reasons a
 * record is skipped, the summary before the run, the 24-hour window of «Відмінити» and what a record that is processed
 * again (after an interruption) becomes. No I/O; the clock is always passed in.
 */

/** FR 7, NFR-15@PoC FR 17: at most 500 records in one action (the platform's `TECHNICAL_LIMITS.bulkItems`). */
export const BULK_ITEMS_MAX = 500;
/**
 * FR 11 (#272 item 2): the size of one record's part of the group audit entry, which the audit log checks again when the
 * entry is written (`auditEntryInput`: at most 4 changes per record of a 500-record entry, a value of at most 1000
 * characters, a field name of the form below). A record whose planned or previous values do not fit is skipped as
 * «невалідний» (`audit_size`) before anything is written, so the entry of a run can never be refused for good.
 */
export const AUDIT_FIELDS_PER_RECORD = 4;
export const AUDIT_VALUE_MAX = 1000;
export const AUDIT_ISSUE = "audit_size";
const AUDIT_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/;

export function fitsAuditEntry(before: BulkValues, after: BulkValues): boolean {
  const fields = Object.keys(after);
  if (fields.length > AUDIT_FIELDS_PER_RECORD) return false;
  const fits = (v: string | null | undefined) => v == null || v.length <= AUDIT_VALUE_MAX;
  return fields.every((f) => AUDIT_FIELD_RE.test(f) && fits(after[f]) && fits(before[f]));
}

/** FR 6: an action on more than 50 records runs in the background. */
export const FOREGROUND_MAX = 50;
/** FR 8, FR 9: «Відмінити» within 24 hours of the end of the action. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * FR 4: why a record is skipped. «unavailable» — outside the space or outside the caller's visibility, told apart from
 * a record that does not exist by nothing; «unchanged» — it already has the values; «conflict» — another change came
 * between the snapshot of the action and its turn; «invalid» — the record's own validation refused (with an issue).
 */
export const SKIP_REASONS = ["unavailable", "unchanged", "conflict", "invalid"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** A record of an action: still to do, changed, or skipped for one of the reasons. */
export const ITEM_OUTCOMES = ["pending", "changed", ...SKIP_REASONS] as const;
export type ItemOutcome = (typeof ITEM_OUTCOMES)[number];

/**
 * FR 6, FR 8–10: «running» (in the background or right now), «interrupted» (a failure or a restart stopped it; the
 * part done stays, «Продовжити» runs the rest), «completed», «undone» («Відмінити» was used).
 */
export const ACTION_STATUSES = ["running", "interrupted", "completed", "undone"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** FR 9: what «Відмінити» did to a changed record. */
export const UNDO_OUTCOMES = ["restored", "not_restored"] as const;
export type UndoOutcome = (typeof UNDO_OUTCOMES)[number];

/** Field values of a record that an action reads and writes: opaque strings or null, never money as a float. */
export type BulkValues = Readonly<Record<string, string | null>>;

/** What an action's handler says of one record before anything is written. */
export type PlannedChange =
  | { readonly kind: "change"; readonly after: BulkValues }
  | { readonly kind: "unchanged" }
  | { readonly kind: "invalid"; readonly issue: string };

/** One record of an action as the summary sees it. */
export interface SummaryItem {
  readonly recordId: string;
  readonly outcome: ItemOutcome;
  readonly issue: string | null;
}

export interface BulkSummary {
  readonly count: number;
  /** Records that change (preview) or changed (report); pending ones of a running action are not counted here. */
  readonly changed: number;
  readonly pending: number;
  readonly skipped: Readonly<Record<SkipReason, number>>;
}

/** FR 3, FR 8: counts by outcome. */
export function summarize(items: readonly SummaryItem[]): BulkSummary {
  const skipped: Record<SkipReason, number> = { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 };
  let changed = 0;
  let pending = 0;
  for (const item of items) {
    if (item.outcome === "changed") changed += 1;
    else if (item.outcome === "pending") pending += 1;
    else skipped[item.outcome] += 1;
  }
  return { count: items.length, changed, pending, skipped };
}

/** FR 3: up to `limit` examples of each reason, in the order of the selection. */
export function skipExamples(
  items: readonly SummaryItem[],
  limit = 3,
): { readonly recordId: string; readonly reason: SkipReason; readonly issue: string | null }[] {
  const seen = new Map<SkipReason, number>();
  const out: { recordId: string; reason: SkipReason; issue: string | null }[] = [];
  for (const item of items) {
    if (item.outcome === "changed" || item.outcome === "pending") continue;
    const n = seen.get(item.outcome) ?? 0;
    if (n >= limit) continue;
    seen.set(item.outcome, n + 1);
    out.push({ recordId: item.recordId, reason: item.outcome, issue: item.issue });
  }
  return out;
}

/** FR 6: more than 50 records run in the background. */
export function runsInBackground(changes: number): boolean {
  return changes > FOREGROUND_MAX;
}

/**
 * FR 1, FR 4: the selection's ids without repeats, in their first order. A repeated id is one record (it would
 * otherwise be changed twice and conflict with itself).
 */
export function distinctIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/**
 * FR 8, FR 9, AC3, AC4: «Відмінити» is offered for a completed or interrupted action until 24 hours after it ended;
 * the time left is 0 once the window is over (25 hours later — AC4) or the action was undone, running or never ended.
 */
export function undoRemainingMs(
  action: { readonly status: ActionStatus; readonly endedAt: number | null },
  now: number,
): number {
  if (action.status !== "completed" && action.status !== "interrupted") return 0;
  if (action.endedAt === null) return 0;
  return Math.max(0, action.endedAt + UNDO_WINDOW_MS - now);
}

function sameValues(current: BulkValues, after: BulkValues): boolean {
  return Object.keys(after).every((field) => (current[field] ?? null) === (after[field] ?? null));
}

/**
 * FR 5, FR 10, AC6, AC8: what to do with a pending record at its turn, from the record as it is now.
 * - gone (or out of the caller's visibility) → «unavailable»;
 * - the version of the snapshot → write the planned values (the target checks the version again under its lock);
 * - another version that already holds exactly the planned values → «changed»: this action wrote it before a failure
 *   stopped the run between the write and its outcome, so a resumed run never writes it twice (AC8);
 * - another version otherwise → «conflict» (changed by someone else during the action, AC6).
 */
export function decideTurn(
  item: { readonly versionBefore: number; readonly after: BulkValues },
  current: { readonly version: number; readonly values: BulkValues } | undefined,
):
  | { readonly kind: "write" }
  | { readonly kind: "already"; readonly version: number }
  | { readonly kind: "skip"; readonly reason: "unavailable" | "conflict" } {
  if (current === undefined) return { kind: "skip", reason: "unavailable" };
  if (current.version === item.versionBefore) return { kind: "write" };
  if (sameValues(current.values, item.after)) return { kind: "already", version: current.version };
  return { kind: "skip", reason: "conflict" };
}
