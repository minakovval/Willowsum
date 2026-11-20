import { formatDate, formatMoney, formatNumber, type Locale } from "@willowsum/i18n";
import type { BatchDetail, FileParse, Readiness } from "./api.ts";
import type { Duplicate, FileRow, FileReview, ReviewFilter, ReviewRow } from "./reviewApi.ts";

/**
 * IMP-08@PoC b) (wave 2, row 137): the pure part of the step «Перевірка розпізнавання». Which files are reviewed, the
 * banners of a file (IMP-08 FR 9: control-sum mismatch, card sign, formulas, hidden sheets, unchecked balance, no
 * transactions; the order of day and month; the gap in the history), the two lists of the panel and how a row is shown.
 * No money is computed: an amount, a difference and a balance are the API's decimal texts, formatted for display only.
 */
export interface ReviewFile {
  readonly fileId: string;
  readonly name: string;
  readonly rowCount: number | null;
  /** The statement's currency (the parse's checks), for the differences and balances the banners name. */
  readonly currency: string | null;
  /** The file's recipe was found but the format changed (IMP-08 FR 3, «Граничні випадки»). */
  readonly recipeChanged: boolean;
  readonly flags: NonNullable<NonNullable<FileParse["checks"]>["flags"]>;
}

/** The files a user reviews: accepted, parsed and with an account (the step before confirmed it). */
export function reviewFiles(batch: BatchDetail, parse: ReadonlyMap<string, FileParse>): ReviewFile[] {
  return batch.fileList.flatMap((f) => {
    const p = parse.get(f.id);
    if (f.status !== "accepted" || !p || p.state !== "parsed" || p.accountId === null) return [];
    return [
      {
        fileId: f.id,
        name: f.fileName,
        rowCount: p.rowCount,
        currency: p.checks?.currency ?? null,
        recipeChanged: p.recipe?.format === "changed",
        flags: p.checks?.flags ?? [],
      },
    ];
  });
}

export type FlagCode = ReviewFile["flags"][number]["code"];
export type HistoryStatus = NonNullable<Readiness["files"][number]["history"]>;

export interface FlagBanner {
  readonly kind: "flag";
  readonly code: FlagCode;
  readonly severity: "block" | "review";
  /** Still waits for the person's decision (readiness lists it); a confirmed one stays as a note. */
  readonly open: boolean;
  readonly difference: string | null;
  readonly positive: number | null;
  readonly negative: number | null;
  readonly choices: readonly ("update" | "keep")[];
}
export interface DateOrderBanner {
  readonly kind: "date-order";
}
export interface HistoryBanner {
  readonly kind: "history";
  readonly history: HistoryStatus;
}
export type Banner = FlagBanner | DateOrderBanner | HistoryBanner;

/** The account's own flag (`foreign-account`) is decided on the previous step (IMP-05 FR 4), so it is not shown here. */
export function bannersOf(file: ReviewFile, readiness: Readiness): Banner[] {
  const open = readiness.refusals.flatMap((r) =>
    r.code === "flags" ? r.files.filter((f) => f.fileId === file.fileId).flatMap((f) => f.flags) : [],
  );
  const flags: Banner[] = file.flags
    .filter((f) => f.code !== "foreign-account")
    .map((f) => {
      const waiting = open.find((o) => o.code === f.code);
      return {
        kind: "flag",
        code: f.code,
        severity: f.severity,
        open: waiting !== undefined,
        difference: f.difference ?? null,
        positive: f.positive ?? null,
        negative: f.negative ?? null,
        choices: waiting?.choices ?? [],
      };
    });
  const dateOrder = readiness.refusals.some(
    (r) => r.code === "clarifications" && r.files.some((f) => f.fileId === file.fileId && f.dateOrder),
  );
  const history = readiness.files.find((f) => f.fileId === file.fileId)?.history;
  return [
    ...(dateOrder ? [{ kind: "date-order" as const }] : []),
    ...flags,
    ...(history && (history.status === "gap" || history.status === "overlap")
      ? [{ kind: "history" as const, history }]
      : []),
  ];
}

/** The question tab lists these states, in this order (the API filters by one state); the other tab lists all rows. */
export const QUESTION_FILTERS: readonly ReviewFilter[] = ["needs-clarification", "needs-review", "error"];

export function questionCount(review: FileReview): number {
  const s = review.counts.states;
  return s["needs-clarification"] + s["needs-review"] + s.error;
}

export type Tab = "questions" | "all";

/** What a row of the list shows: its values (when read), its state and its marks. */
export interface RowView {
  readonly row: ReviewRow;
  readonly date: string | null;
  readonly text: string | null;
  readonly amount: string | null;
  readonly duplicate: Duplicate | null;
}

export function dateText(locale: Locale, iso: string | null): string | null {
  if (iso === null) return null;
  try {
    return formatDate(locale, iso);
  } catch {
    return iso;
  }
}

/** The first leg is the row's amount; its currency is the leg's, else the row's. */
export function amountText(locale: Locale, v: FileRow | undefined): string | null {
  const leg = v?.legs[0];
  if (!v || !leg) return null;
  const currency = leg.currency ?? v.currency;
  return currency ? formatMoney(locale, leg.amount, currency) : formatNumber(locale, leg.amount);
}

export function rowViews(
  locale: Locale,
  rows: readonly ReviewRow[],
  values: ReadonlyMap<number, FileRow>,
  duplicates: ReadonlyMap<number, Duplicate>,
): RowView[] {
  return rows.map((row) => {
    const v = values.get(row.row);
    return {
      row,
      date: dateText(locale, v?.date ?? null),
      text: v?.counterparty ?? v?.description ?? null,
      amount: amountText(locale, v),
      duplicate: duplicates.get(row.row) ?? null,
    };
  });
}

/** IMP-04: how many rows of each kind the apply would not write as new ones. */
export function duplicateCounts(items: readonly Duplicate[]): ReadonlyMap<Duplicate["kind"], number> {
  const out = new Map<Duplicate["kind"], number>();
  for (const d of items) out.set(d.kind, (out.get(d.kind) ?? 0) + 1);
  return out;
}
