import { Decimal, type Money } from "@willowsum/domain-kernel";
import { decideIncoming, MATCH_WINDOW_DAYS, type ExistingTransaction } from "./matching.ts";

/**
 * The plan of an import batch against the account's transactions (IMP-04@PoC FR 1–6; wave 2 row 43), pure: what each
 * row of a statement file becomes when the batch is applied. Nothing here writes; the apply step does what the plan
 * says (and stores its result once per batch, FR 7).
 *
 * In order, for one account:
 * 1. FR 3 — the same file (by content) as one of an applied batch: every row «дубль — уже імпортовано», nothing created.
 * 2. FR 1, FR 4 — the duplicate key: account, primary date, amount, currency, normalized description, and the balance
 *    after the operation when both sides have one — its value first, then (a credit card only) its size: either basis
 *    of a card's balance (#654, #655). If the account has k transactions with a key and the file n rows,
 *    max(0, n − k) rows are imported and the first min(n, k) of them (in file order) are duplicates of those k. An
 *    existing «в обробці» (pending) one is a key match only for a pending row: a posted row replaces it (FR 6).
 * 3. FR 2 — rows with the same key in the file (the balance left out) are all kept; the second and later get «повтор у
 *    файлі» and their occurrence number (`occurrence`, from 1 in file order, the duplicates of step 2 counted).
 * 4. FR 6 — a posted row replaces a pending one of a previous import on the account: the same currency and sign,
 *    amounts at most min(0.25, 10 % of the posted amount) apart in the account's currency (exact decimals), the posted date on the pending date or up to 10 days after it; the closest amount,
 *    then the closest date, then the earlier one.
 * 5. FR 5 — the rule `decideIncoming` against the shown transactions of the account (not merged, not a side of a
 *    transfer, imported ones of other batches): a single manual one not matched yet — merged; any other match
 *    («Можливий дубль», also a pair of imported ones from different batches) — the row is imported to «До розбору»
 *    with the mark, nothing merged or hidden. When several rows would merge with one manual transaction, the row with
 *    the closest date merges and the others are «Можливий дубль» of it; a tie in the date — none merges, all are.
 */

export const REPLACE_WINDOW_DAYS = 10;
/**
 * FR 6: the tolerance's cap, in units of the account's currency. The tolerance is min(0.25, 10 % of the posted amount)
 * (Рішення власника (2026-11-20), п. 8), exact decimals, never rounded.
 */
export const REPLACE_TOLERANCE = "0.25";
/** FR 6: the tolerance's share of the posted row's amount (its absolute value). */
export const REPLACE_TOLERANCE_SHARE = "0.1";

/** FR 6: how far apart a pending amount and a posted one may be: min(0.25, 10 % of |posted|). */
export function replaceTolerance(posted: Decimal): Decimal {
  return Decimal.min(new Decimal(REPLACE_TOLERANCE), posted.abs().times(REPLACE_TOLERANCE_SHARE));
}
/**
 * The most transactions the FR 5 and FR 6 steps of one plan may look at (every row counts each transaction of its
 * window). Dense windows (thousands of pending ones or of one amount within days) make the plan rows × transactions;
 * past this bound the plan is refused, nothing planned, so one file never blocks the process for long.
 */
export const PLAN_WORK_MAX = 500_000;

/** The account's window is too large for one plan; nothing planned (the file is split into several). */
export class PlanTooLargeError extends Error {
  constructor() {
    super("The account has too many transactions in the window of the batch");
    this.name = "PlanTooLargeError";
  }
}

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
  /**
   * FR 4 (#655): the account is a credit card (accounts' kind «credit-card»): a balance that matches by neither value
   * also matches by its size (its statements may be stored in the debt basis or as printed, IMP-05 FR 6). Otherwise —
   * by value only.
   */
  readonly creditCard?: boolean;
}

/** FR 1: the description as compared — Unicode NFKC, lower case, inner whitespace as one space, trimmed. */
export function normalizeDescription(text: string | null): string {
  return (text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

const amountText = (m: Money) => `${m.currency} ${m.amount.toString()}`;
/**
 * FR 1, FR 4 (#654): the balance after the operation as the key compares it — its value first, then only its size. A
 * credit card's statement stored in the debt basis (IMP-05 FR 6, «inverted») and an overlapping one stored as printed
 * (its «знак картки» confirmed) print the same balances with opposite signs; their shared rows are the same operations.
 * The value goes first so that, in an account whose balance crosses zero, a row with +X never takes the transaction of
 * the row with −X of the same day, amount and description; the size only for a credit card (#655: on any other account
 * +X and −X are two operations).
 */
const balanceText = (m: Money) => `${m.currency} ${m.amount.toString()}`;
const balanceSize = (m: Money) => `|${m.currency} ${m.amount.abs().toString()}`;

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
  // Indexes, so that the plan is linear in rows + transactions (a file has up to 20 000 rows, the window 50 000).
  const push = <K>(map: Map<K, KnownTransaction[]>, k: K, t: KnownTransaction) => {
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  };
  const used = new Set<string>();
  // FR 1: by key, status and balance («*» — any balance), each in the order of (date, id), read from its head.
  const ANY = "*";
  const NONE = "-";
  const listKey = (key: string, status: string, balance: string) => JSON.stringify([key, status, balance]);
  const byKey = new Map<string, KnownTransaction[]>();
  const heads = new Map<string, number>();
  for (const t of existing) {
    const k = duplicateKey(input.accountId, t);
    push(byKey, listKey(k, t.status, ANY), t);
    push(byKey, listKey(k, t.status, t.balanceAfter ? balanceText(t.balanceAfter) : NONE), t);
    if (t.balanceAfter && input.creditCard) push(byKey, listKey(k, t.status, balanceSize(t.balanceAfter)), t);
  }
  /** The first transaction of a list not taken yet. */
  const head = (k: string): KnownTransaction | undefined => {
    const list = byKey.get(k);
    if (!list) return undefined;
    let i = heads.get(k) ?? 0;
    while (i < list.length && used.has(list[i]!.transactionId)) i++;
    heads.set(k, i);
    return list[i];
  };

  // FR 1, FR 4: each existing transaction is the duplicate of at most one row; an exact balance match first. A
  // pending transaction is a key match only for a pending row (FR 6 otherwise).
  const duplicateOf = new Map<number, string>();
  for (const pass of input.creditCard ? (["value", "size", "none"] as const) : (["value", "none"] as const))
    for (const r of ordered) {
      if (duplicateOf.has(r.row)) continue;
      if (pass !== "none" && r.balance === null) continue;
      const balance =
        pass === "value"
          ? balanceText(r.balance!)
          : pass === "size"
            ? balanceSize(r.balance!)
            : r.balance === null
              ? ANY
              : NONE;
      const match = (r.status === "pending" ? ["posted", "pending"] : ["posted"])
        .map((status) => head(listKey(keyOf(r), status, balance)))
        .filter((t): t is KnownTransaction => t !== undefined)
        .sort(byDateThenId)[0];
      if (!match) continue;
      used.add(match.transactionId);
      duplicateOf.set(r.row, match.transactionId);
    }

  // FR 6: the pending ones of previous imports by day; FR 5: the shown ones by amount and day.
  const pendingByDay = new Map<number, KnownTransaction[]>();
  const shownByAmountDay = new Map<string, KnownTransaction[]>();
  const amountDay = (amount: Money, day: number) => `${amountText(amount)}|${day}`;
  for (const t of existing) {
    if (t.status === "pending" && t.source === "imported" && t.importBatchId !== input.batchId)
      push(pendingByDay, dayNumber(t.date), t);
    if (!t.hidden && !t.transfer && (t.source === "manual" || t.importBatchId !== input.batchId))
      push(shownByAmountDay, amountDay(t.amount, dayNumber(t.date)), t);
  }
  let work = 0;
  const around = <K>(
    map: Map<K, KnownTransaction[]>,
    before: number,
    after: number,
    keyOfDay: (day: number) => K,
    date: string,
  ) => {
    const found: KnownTransaction[] = [];
    for (let d = dayNumber(date) - before; d <= dayNumber(date) + after; d++) {
      const list = map.get(keyOfDay(d)) ?? [];
      work += list.length;
      if (work > PLAN_WORK_MAX) throw new PlanTooLargeError();
      for (const t of list) if (!used.has(t.transactionId)) found.push(t);
    }
    return found;
  };

  const matched = new Set(existing.filter((t) => t.matched).map((t) => t.transactionId));
  const outcomes: RowOutcome[] = [];
  // FR 5: the rows that would merge with each manual transaction (their outcome's index and the gap in days).
  const mergeRows = new Map<string, { index: number; days: number }[]>();
  for (const r of ordered) {
    const common = { row: r.row, occurrence: occ(r) };
    const of = duplicateOf.get(r.row);
    if (of !== undefined) {
      outcomes.push({ ...common, kind: "duplicate", of });
      continue;
    }

    // FR 6: a posted row in place of a pending one of a previous import.
    if (r.status === "posted") {
      const tolerance = replaceTolerance(r.amount.amount);
      const pending = around(pendingByDay, REPLACE_WINDOW_DAYS, 0, (d) => d, r.date)
        .filter(
          (t) =>
            t.amount.currency === r.amount.currency &&
            // Posted on the pending date or up to 10 days after it, never before.
            dayNumber(t.date) <= dayNumber(r.date) &&
            // The same direction: a debit never replaces a credit, whatever the tolerance.
            t.amount.amount.isNegative() === r.amount.amount.isNegative() &&
            t.amount.amount.minus(r.amount.amount).abs().lte(tolerance),
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
    const candidates: ExistingTransaction[] = around(
      shownByAmountDay,
      MATCH_WINDOW_DAYS,
      MATCH_WINDOW_DAYS,
      (d) => amountDay(r.amount, d),
      r.date,
    ).map((t) => ({
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
      outcomes.push({ ...common, kind: "merge", with: decision.with.transactionId });
      const rows = mergeRows.get(decision.with.transactionId);
      const entry = {
        index: outcomes.length - 1,
        days: Math.abs(dayNumber(decision.with.date) - dayNumber(r.date)),
      };
      if (rows) rows.push(entry);
      else mergeRows.set(decision.with.transactionId, [entry]);
    } else if (decision.kind === "possible-duplicate") {
      outcomes.push({
        ...common,
        kind: "possible-duplicate",
        candidates: decision.candidates.map((c) => c.transactionId),
      });
    } else outcomes.push({ ...common, kind: common.occurrence > 1 ? "repeat" : "import" });
  }
  // FR 5: one merge per manual transaction — the closest date; a tie in it leaves every row «Можливий дубль».
  for (const [transactionId, rows] of mergeRows) {
    if (rows.length < 2) continue;
    const closest = rows.reduce((m, e) => Math.min(m, e.days), Infinity);
    const winners = rows.filter((e) => e.days === closest);
    for (const e of rows)
      if (winners.length > 1 || e !== winners[0]) {
        const { row, occurrence } = outcomes[e.index]!;
        outcomes[e.index] = { row, occurrence, kind: "possible-duplicate", candidates: [transactionId] };
      }
  }
  return outcomes;
}

/** How many rows of each outcome (for the stored result of the apply, FR 7). */
export function outcomeCounts(outcomes: readonly RowOutcome[]): Readonly<Record<RowOutcomeKind, number>> {
  const counts = Object.fromEntries(ROW_OUTCOMES.map((k) => [k, 0])) as Record<RowOutcomeKind, number>;
  for (const o of outcomes) counts[o.kind] += 1;
  return counts;
}
