/**
 * A history file's rows as the review step counts them (BUD-21@PoC FR 5, FR 8, EC5, EC6): a row is a transfer when its
 * transfer mark is one of the values the user (or the engine's suggestion) counts as transfers — its category then does
 * not count; a row with neither a category nor a transfer mark is skipped, with its reason, and so is a row whose date
 * or amount could not be read. Pure: the caller gives the rows and the answer.
 */
export const HISTORY_SKIPS = [
  "date-unreadable",
  "amount-unreadable",
  "no-categorisation",
  // BUD-21 EC12: a row of the label «Коригування» — a service category, no category of income or expenses.
  "service-category",
] as const;
export type HistorySkip = (typeof HISTORY_SKIPS)[number];

/** The ceilings of the review step's lists (FR 5): labels and account values beyond them are counted, not listed. */
export const HISTORY_VIEW_LIMITS = { labels: 1000, accounts: 100, examples: 5 } as const;

/** A row as file-parsers reads it (`HistoryRow`): the fields these rules look at. */
export interface HistoryRowFields {
  readonly date: string | null;
  readonly amount: string | null;
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly transferMark: string | null;
  readonly account: string | null;
}

export type ReadRow<R extends HistoryRowFields = HistoryRowFields> = R & {
  readonly transfer: boolean;
};

export interface HistorySummary {
  /** Rows of the table the file has (its data rows). */
  readonly rows: number;
  /** Rows read: with a date, an amount and a category or a transfer mark. */
  readonly read: number;
  readonly transfers: number;
  readonly skipped: readonly { readonly reason: HistorySkip; readonly count: number }[];
}

/**
 * BUD-21 FR 8, EC12 (row 234): what the matching of labels makes of a row's label — a transfer (the user, or the label
 * «Переказ») or a row skipped (the label «Коригування»); undefined — a category.
 */
export type LabelAction = (
  category: string | null,
  subcategory: string | null,
) => "transfer" | "skip" | undefined;

export function classifyRows<R extends HistoryRowFields>(
  rows: readonly R[],
  transferValues: ReadonlySet<string>,
  labelAction?: LabelAction,
): { readonly read: readonly ReadRow<R>[]; readonly summary: HistorySummary } {
  const read: ReadRow<R>[] = [];
  const skipped = new Map<HistorySkip, number>();
  const skip = (reason: HistorySkip) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  for (const r of rows) {
    if (r.date === null) skip("date-unreadable");
    else if (r.amount === null) skip("amount-unreadable");
    else {
      const transfer = r.transferMark !== null && transferValues.has(r.transferMark);
      // EC5: a row with a transfer mark is a transfer; its category does not count.
      const action = transfer ? undefined : labelAction?.(r.category, r.subcategory);
      if (!transfer && r.category === null && r.subcategory === null) skip("no-categorisation");
      else if (action === "skip") skip("service-category");
      else read.push({ ...r, transfer: transfer || action === "transfer" });
    }
  }
  return {
    read,
    summary: {
      rows: rows.length,
      read: read.length,
      transfers: read.filter((r) => r.transfer).length,
      skipped: HISTORY_SKIPS.flatMap((reason) =>
        skipped.has(reason) ? [{ reason, count: skipped.get(reason)! }] : [],
      ),
    },
  };
}

export interface LabelNode {
  readonly category: string;
  readonly count: number;
  readonly subcategories: readonly { readonly name: string; readonly count: number }[];
}

/** Most rows first, then by the text (code points: deterministic). */
const byCount = (a: { count: number; key: string }, b: { count: number; key: string }): number =>
  b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * FR 5: the file's categories with their row counts, each with its subcategories; transfers have no category (FR 8). A
 * subcategory without a category is a category of its own. Labels are as printed; the matching to the space's
 * categories is the next part (BUD-21 b, FR 7).
 */
export function labelTree(rows: readonly ReadRow[]): {
  readonly labels: readonly LabelNode[];
  readonly more: boolean;
} {
  const tree = new Map<string, { count: number; subs: Map<string, number> }>();
  for (const r of rows) {
    if (r.transfer) continue;
    const category = r.category ?? r.subcategory!;
    const node = tree.get(category) ?? { count: 0, subs: new Map<string, number>() };
    node.count += 1;
    if (r.category !== null && r.subcategory !== null)
      node.subs.set(r.subcategory, (node.subs.get(r.subcategory) ?? 0) + 1);
    tree.set(category, node);
  }
  const labels = [...tree]
    .map(([category, n]) => ({
      category,
      count: n.count,
      subcategories: [...n.subs]
        .sort((a, b) => byCount({ count: a[1], key: a[0] }, { count: b[1], key: b[0] }))
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => byCount({ count: a.count, key: a.category }, { count: b.count, key: b.category }));
  return {
    labels: labels.slice(0, HISTORY_VIEW_LIMITS.labels),
    more: labels.length > HISTORY_VIEW_LIMITS.labels,
  };
}

/** FR 5: the values of the account column with their row counts, most rows first. */
export function accountValues(rows: readonly ReadRow[]): {
  readonly values: readonly { readonly value: string; readonly count: number }[];
  readonly more: boolean;
} {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.account !== null) counts.set(r.account, (counts.get(r.account) ?? 0) + 1);
  const values = [...counts]
    .sort((a, b) => byCount({ count: a[1], key: a[0] }, { count: b[1], key: b[0] }))
    .map(([value, count]) => ({ value, count }));
  return {
    values: values.slice(0, HISTORY_VIEW_LIMITS.accounts),
    more: values.length > HISTORY_VIEW_LIMITS.accounts,
  };
}

/**
 * BUD-21 FR 7 (row 234): the labels of the rows read — each as printed, with how many rows have a negative and a
 * positive amount (a zero counts as negative: «витрата» is the default type). Transfers have no label (FR 8). The
 * module categories matches them (one label for spellings that differ in case, diacritics or spaces, EC1).
 */
export function labelCounts(rows: readonly ReadRow[]): {
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly negative: number;
  readonly positive: number;
}[] {
  const counts = new Map<
    string,
    { category: string | null; subcategory: string | null; negative: number; positive: number }
  >();
  for (const r of rows) {
    if (r.transfer || (r.category === null && r.subcategory === null)) continue;
    const key = JSON.stringify([r.category, r.subcategory]);
    const c = counts.get(key) ?? {
      category: r.category,
      subcategory: r.subcategory,
      negative: 0,
      positive: 0,
    };
    if (/^-|^[0.]+$/.test(r.amount!)) c.negative += 1;
    else c.positive += 1;
    counts.set(key, c);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, c]) => c);
}

/** A label as the confirmation resolved it (`HistoryAnswers.labels`): its spellings, its category or a transfer. */
export interface ResolvedLabelAnswer {
  readonly variants: readonly { readonly category: string | null; readonly subcategory: string | null }[];
  readonly action: "category" | "transfer" | "skip";
  readonly categoryId: string | null;
}

/**
 * BUD-21 FR 7, AC8: the category of a history row after the confirmation, for the derivation (row 235) — the space's
 * category its label was matched with or created as; null — a transfer, a skipped row or a label not resolved.
 */
export function rowCategories(
  resolved: readonly ResolvedLabelAnswer[],
): (row: {
  readonly category: string | null;
  readonly subcategory: string | null;
}) => ResolvedLabelAnswer | null {
  const byText = new Map<string, ResolvedLabelAnswer>();
  for (const l of resolved)
    for (const v of l.variants) byText.set(JSON.stringify([v.category, v.subcategory]), l);
  return (row) => byText.get(JSON.stringify([row.category, row.subcategory])) ?? null;
}
