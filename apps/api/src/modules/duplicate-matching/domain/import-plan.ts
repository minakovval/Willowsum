import { Decimal, type Money } from "@willowsum/domain-kernel";
import { decideIncoming, type ExistingTransaction } from "./matching.ts";

/**
 * The plan of an import batch against the account's transactions (IMP-04@PoC FR 1–6; wave 2 row 43), pure: what each
 * row of a statement file becomes when the batch is applied. Nothing here writes; the apply step does what the plan
 * says (and stores its result once per batch, FR 7).
 *
 * In order, for one account:
 * 1. FR 3 — the same file (by content) as one of an applied batch: every row «дубль — уже імпортовано», nothing created.
 * 2. FR 1, FR 4 — the duplicate key: account, primary date, amount, currency, normalized description, and the balance
 *    after the operation when both sides have one. If the account has k transactions with a key and the file n rows,
 *    max(0, n − k) rows are imported and the first min(n, k) of them (in file order) are duplicates of those k. An
 *    existing «в обробці» (pending) one is a key match only for a pending row: a posted row replaces it (FR 6).
 * 3. FR 2 — rows with the same key in the file (the balance left out) are all kept; the second and later get «повтор у
 *    файлі» and their occurrence number (`occurrence`, from 1 in file order, the duplicates of step 2 counted).
 * 4. FR 6 — a posted row replaces a pending one of a previous import on the account: the same currency, amounts at
 *    most 0.25 apart, dates at most 10 days apart; the closest amount, then the closest date, then the earlier one.
 * 5. FR 5 — the rule `decideIncoming` against the shown transactions of the account (not merged, not a side of a
 *    transfer, imported ones of other batches): a single manual one not matched yet — merged; any other match
 *    («Можливий дубль», also a pair of imported ones from different batches) — the row is imported to «До розбору»
 *    with the mark, nothing merged or hidden. A manual one merged by a row is matched for the rows after it.
 */

export const REPLACE_WINDOW_DAYS = 10;
/** FR 6: in units of the account's currency. */
export const REPLACE_TOLERANCE = "0.25";

/** A row of a statement file as the parse gives it, for one account. */
export interface IncomingRow {
  /** The row of the file, from 1. */
  readonly row: number;
  /** The primary date (YYYY-MM-DD). */
  readonly date: string;
  /** Signed, in the account's currency (of its wallet). */
  readonly amount: Money;
  readonly description: string | null;
  /** The balance after the operation as printed; null — the file has none. */
  readonly balance: Money | null;
  readonly status: "posted" | "pending";
}

/** A transaction of the account (transactions' `ImportCandidate`). */
export interface KnownTransaction {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
  readonly description: string | null;
  readonly balanceAfter: Money | null;
  readonly status: "posted" | "pending";
  readonly source: "manual" | "imported";
  readonly importBatchId: string | null;
  readonly hidden: boolean;
  readonly transfer: boolean;
  readonly matched: boolean;
}

export const ROW_OUTCOMES = [
  "import",
  "repeat",
  "duplicate",
  "already-imported",
  "merge",
  "possible-duplicate",
  "replace",
] as const;
export type RowOutcomeKind = (typeof ROW_OUTCOMES)[number];

interface Common {
  readonly row: number;
  /** FR 2: the row's occurrence among the rows of the file with its key, from 1; 2 and more — «повтор у файлі». */
  readonly occurrence: number;
}

export type RowOutcome = Common &
  (
    | /** A new transaction. */ { readonly kind: "import" }
    | /** FR 2: a new transaction marked «повтор у файлі» with `occurrence`. */ { readonly kind: "repeat" }
    | /** FR 1, FR 4: nothing created; it is this transaction of the account. */ {
        readonly kind: "duplicate";
        readonly of: string;
      }
    | /** FR 3: nothing created; the same file was applied in this batch. */ {
        readonly kind: "already-imported";
        readonly batchId: string;
      }
    | /** FR 5: merged with this manual transaction (it keeps its category and notes). */ {
        readonly kind: "merge";
        readonly with: string;
      }
    | /** FR 5: a new transaction to «До розбору» with «Можливий дубль» of these. */ {
        readonly kind: "possible-duplicate";
        readonly candidates: readonly string[];
      }
    | /** FR 6: a new posted transaction in place of this pending one («замінено»). */ {
        readonly kind: "replace";
        readonly replaces: string;
      }
  );

export interface PlanInput {
  readonly batchId: string;
  readonly accountId: string;
  readonly rows: readonly IncomingRow[];
  /** FR 3: the applied batch whose file has the same content; null — none. */
  readonly sameFileAppliedIn: string | null;
  /** The account's transactions in `planWindow(rows)`. */
  readonly existing: readonly KnownTransaction[];
}

/** FR 1: the description as compared — Unicode NFKC, lower case, inner whitespace as one space, trimmed. */
export function normalizeDescription(text: string | null): string {
  return (text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

const amountText = (m: Money) => `${m.currency} ${m.amount.toString()}`;

/** FR 1 without the balance: account, primary date, amount, currency, normalized description. */
export function duplicateKey(
  accountId: string,
  side: { readonly date: string; readonly amount: Money; readonly description: string | null },
): string {
  return JSON.stringify([
    accountId,
    side.date,
    amountText(side.amount),
    normalizeDescription(side.description),
  ]);
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const shiftDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);

/** The dates the plan needs of the account: the rows' dates widened by the replacement window (it is the widest). */
export function planWindow(
  rows: readonly IncomingRow[],
): { readonly from: string; readonly to: string } | null {
  if (rows.length === 0) return null;
  const dates = rows.map((r) => r.date).sort();
  return {
    from: shiftDays(dates[0]!, -REPLACE_WINDOW_DAYS),
    to: shiftDays(dates[dates.length - 1]!, REPLACE_WINDOW_DAYS),
  };
}

/** A key match of FR 1: a pending transaction is one only for a pending row (FR 6 otherwise). */
const keyEligible = (row: IncomingRow, t: KnownTransaction) =>
  t.status === "posted" || row.status === "pending";

const balanceFits = (row: IncomingRow, t: KnownTransaction) =>
  row.balance === null || t.balanceAfter === null || row.balance.equals(t.balanceAfter);

const balanceExact = (row: IncomingRow, t: KnownTransaction) =>
  row.balance !== null && t.balanceAfter !== null && row.balance.equals(t.balanceAfter);

const byDateThenId = (a: KnownTransaction, b: KnownTransaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId < b.transactionId ? -1 : 1;

export function planBatch(input: PlanInput): readonly RowOutcome[] {
  const ordered = [...input.rows].sort((a, b) => a.row - b.row);
  const keyOf = (r: IncomingRow) => duplicateKey(input.accountId, r);
  // FR 2: the occurrence of each row among the file's rows with the same key (without the balance: two coffees of a
  // day are «повтор у файлі» even when the file prints a balance after each).
  const occurrence = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const r of ordered) {
    const n = (seen.get(keyOf(r)) ?? 0) + 1;
    seen.set(keyOf(r), n);
    occurrence.set(r.row, n);
  }
  const occ = (r: IncomingRow) => occurrence.get(r.row)!;

  if (input.sameFileAppliedIn !== null) {
    const batchId = input.sameFileAppliedIn;
    return ordered.map((r) => ({ row: r.row, occurrence: occ(r), kind: "already-imported", batchId }));
  }

  const existing = input.existing.filter((t) => t.accountId === input.accountId).sort(byDateThenId);
  const byKey = new Map<string, KnownTransaction[]>();
  for (const t of existing) {
    const k = duplicateKey(input.accountId, t);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }

  // FR 1, FR 4: each existing transaction is the duplicate of at most one row; an exact balance match first.
  const used = new Set<string>();
  const duplicateOf = new Map<number, string>();
  for (const exact of [true, false])
    for (const r of ordered) {
      if (duplicateOf.has(r.row)) continue;
      const match = (byKey.get(keyOf(r)) ?? []).find(
        (t) =>
          !used.has(t.transactionId) &&
          keyEligible(r, t) &&
          (exact ? balanceExact(r, t) : balanceFits(r, t) && !balanceExact(r, t)),
      );
      if (!match) continue;
      used.add(match.transactionId);
      duplicateOf.set(r.row, match.transactionId);
    }

  const tolerance = new Decimal(REPLACE_TOLERANCE);
  const matched = new Set(existing.filter((t) => t.matched).map((t) => t.transactionId));
  const outcomes: RowOutcome[] = [];
  for (const r of ordered) {
    const common = { row: r.row, occurrence: occ(r) };
    const of = duplicateOf.get(r.row);
    if (of !== undefined) {
      outcomes.push({ ...common, kind: "duplicate", of });
      continue;
    }

    // FR 6: a posted row in place of a pending one of a previous import.
    if (r.status === "posted") {
      const pending = existing
        .filter(
          (t) =>
            !used.has(t.transactionId) &&
            t.status === "pending" &&
            t.source === "imported" &&
            t.importBatchId !== input.batchId &&
            t.amount.currency === r.amount.currency &&
            t.amount.amount.minus(r.amount.amount).abs().lte(tolerance) &&
            Math.abs(dayNumber(t.date) - dayNumber(r.date)) <= REPLACE_WINDOW_DAYS,
        )
        .map((t) => ({
          t,
          gap: t.amount.amount.minus(r.amount.amount).abs(),
          days: Math.abs(dayNumber(t.date) - dayNumber(r.date)),
        }))
        .sort((a, b) => a.gap.comparedTo(b.gap) || a.days - b.days || byDateThenId(a.t, b.t));
      const best = pending[0];
      if (best) {
        used.add(best.t.transactionId);
        outcomes.push({ ...common, kind: "replace", replaces: best.t.transactionId });
        continue;
      }
    }

    // FR 5: the rule of the manual merge and «Можливий дубль».
    const candidates: ExistingTransaction[] = existing
      .filter(
        (t) =>
          !used.has(t.transactionId) &&
          !t.hidden &&
          !t.transfer &&
          (t.source === "manual" || t.importBatchId !== input.batchId),
      )
      .map((t) => ({
        transactionId: t.transactionId,
        accountId: t.accountId,
        amount: t.amount,
        date: t.date,
        source: t.source,
        matched: matched.has(t.transactionId),
      }));
    const decision = decideIncoming(
      { transactionId: `row:${r.row}`, accountId: input.accountId, amount: r.amount, date: r.date },
      candidates,
    );
    if (decision.kind === "merge") {
      matched.add(decision.with.transactionId);
      outcomes.push({ ...common, kind: "merge", with: decision.with.transactionId });
    } else if (decision.kind === "possible-duplicate") {
      outcomes.push({
        ...common,
        kind: "possible-duplicate",
        candidates: decision.candidates.map((c) => c.transactionId),
      });
    } else outcomes.push({ ...common, kind: common.occurrence > 1 ? "repeat" : "import" });
  }
  return outcomes;
}

/** How many rows of each outcome (for the stored result of the apply, FR 7). */
export function outcomeCounts(outcomes: readonly RowOutcome[]): Readonly<Record<RowOutcomeKind, number>> {
  const counts = Object.fromEntries(ROW_OUTCOMES.map((k) => [k, 0])) as Record<RowOutcomeKind, number>;
  for (const o of outcomes) counts[o.kind] += 1;
  return counts;
}
