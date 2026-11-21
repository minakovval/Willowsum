import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/** A transaction the cushion counts (BUD-05@PoC FR 10): signed, in its own currency, with its split parts. */
export interface CountedTransaction {
  readonly id: string;
  readonly date: string;
  /** Signed: an outflow is negative, a refund positive. */
  readonly amount: Money;
  /** Its parts in order (`month` — the first day of a share «На кілька місяців»); null — not split. */
  readonly parts:
    readonly { readonly categoryId: string; readonly month: string | null; readonly amount: Money }[] | null;
  /**
   * BUD-06@PoC FR 8: marked «Одноразова витрата» — out of the cushion's sum, still a month of history (#685); always
   * false while `transactions.one-off` is off for the space.
   */
  readonly oneOff: boolean;
}

/**
 * BUD-05@PoC FR 10 (module goals, «Подушка безпеки»): the space's transactions from `from` to `to` (both included) as
 * the budget period counts them (BUD-02@PoC FR 12): shown, «Очікує» too, merged into none, no side of a transfer
 * between own accounts, of every account; a split one with its parts (a share «На кілька місяців» in the window
 * brings its transaction even when the transaction's own date is outside). Signed exact NUMERIC as text.
 * `oneOffs` (BUD-06@PoC FR 8): whether the marks «Одноразова витрата» act (the flag); off — every row reads unmarked.
 */
export async function countedInWindow(
  q: ModuleQueryRunner,
  householdId: string,
  from: string,
  to: string,
  oneOffs = false,
): Promise<CountedTransaction[]> {
  const { rows } = await q.query<{
    id: string;
    amount: string;
    currency: string;
    date: string;
    split_mode: string | null;
    parts: { categoryId: string; month: string | null; amount: string }[] | null;
    one_off: boolean;
  }>(
    `SELECT t.id, t.amount::text AS amount, t.currency, to_char(t.occurred_on, 'YYYY-MM-DD') AS date, t.split_mode,
            $4::boolean AND t.one_off AS one_off,
            (SELECT json_agg(json_build_object('categoryId', p.category_id, 'month', to_char(p.month, 'YYYY-MM-DD'),
                                               'amount', p.amount::text) ORDER BY p.position)
               FROM transaction_parts p WHERE p.household_id = t.household_id AND p.transaction_id = t.id) AS parts
       FROM transactions t
      WHERE t.household_id = $1 AND NOT t.hidden AND t.merged_into IS NULL AND t.transfer_id IS NULL
        AND (t.occurred_on BETWEEN $2::date AND $3::date
             OR (t.split_mode = 'months' AND EXISTS (SELECT 1 FROM transaction_parts p
                   WHERE p.household_id = t.household_id AND p.transaction_id = t.id
                     AND p.month BETWEEN $2::date AND $3::date)))
      ORDER BY t.occurred_on, t.id`,
    [householdId, from, to, oneOffs],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Money.of(r.amount, r.currency),
    parts:
      r.split_mode === null || !r.parts
        ? null
        : r.parts.map((p) => ({
            categoryId: p.categoryId,
            month: p.month,
            amount: Money.of(p.amount, r.currency),
          })),
    oneOff: r.one_off,
  }));
}

export interface SpendCandidate {
  readonly id: string;
  readonly accountId: string;
  readonly counterparty: string | null;
  readonly description: string | null;
  readonly date: string;
  /** When it was recorded (PostgreSQL text, exact to the microsecond): with the date and id, the order's key. */
  readonly recordedAt: string;
  /** What the transaction takes from its account, without its sign. */
  readonly amount: Money;
}

/** Where a page starts: after this row of the order (date, time of recording, id — all newest first). */
export interface SpendCandidatesAfter {
  readonly date: string;
  readonly recordedAt: string;
  readonly id: string;
}

/** `%`, `_` and `\` are literal in the search text (ESCAPE '\'). */
const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * BUD-05@PoC FR 8 (module goals, «Витратити», #559): the outgoing «Проведена» shown transactions in `currency`, merged
 * into none and no side of a transfer, on `accountId` (null — any account of the space), whose id is not in `excluded`
 * (the goals' spends), matching `search` in the counterparty or the description; newest first (date, then the time of
 * recording, then id), at most `limit` after `after`, and how many match in all (`count`, without `after`).
 */
export async function spendCandidates(
  q: ModuleQueryRunner,
  householdId: string,
  query: {
    readonly accountId: string | null;
    readonly currency: string;
    readonly excluded: readonly string[];
    readonly search: string | null;
    readonly after: SpendCandidatesAfter | null;
    readonly limit: number;
  },
): Promise<{ items: SpendCandidate[]; count: number }> {
  const { rows } = await q.query<{
    count: string;
    id: string | null;
    account_id: string;
    counterparty: string | null;
    description: string | null;
    date: string;
    recorded_at: string;
    amount: string;
    currency: string;
  }>(
    `WITH m AS (
       SELECT id, account_id, counterparty, description, occurred_on, created_at, amount, currency
         FROM transactions
        WHERE household_id = $1 AND currency = $2 AND amount < 0 AND status = 'posted'
          AND NOT hidden AND merged_into IS NULL AND transfer_id IS NULL
          AND ($3::uuid IS NULL OR account_id = $3::uuid)
          AND NOT (id = ANY($4::uuid[]))
          AND ($5::text IS NULL OR search_text ILIKE $5::text ESCAPE '\\'))
     SELECT c.count::text AS count, p.id, p.account_id, p.counterparty, p.description,
            to_char(p.occurred_on, 'YYYY-MM-DD') AS date, p.created_at::text AS recorded_at,
            (-p.amount)::text AS amount, p.currency
       FROM (SELECT count(*) FROM m) c
       LEFT JOIN LATERAL (
         SELECT * FROM m
          WHERE $6::date IS NULL OR (occurred_on, created_at, id) < ($6::date, $7::timestamptz, $8::uuid)
          ORDER BY occurred_on DESC, created_at DESC, id DESC
          LIMIT $9) p ON true`,
    [
      householdId,
      query.currency,
      query.accountId,
      [...query.excluded],
      query.search === null ? null : likeText(query.search),
      query.after?.date ?? null,
      query.after?.recordedAt ?? null,
      query.after?.id ?? null,
      query.limit,
    ],
  );
  return {
    count: Number(rows[0]?.count ?? 0),
    items: rows
      .filter((r) => r.id !== null)
      .map((r) => ({
        id: r.id!,
        accountId: r.account_id,
        counterparty: r.counterparty,
        description: r.description,
        date: r.date,
        recordedAt: r.recorded_at,
        amount: Money.of(r.amount, r.currency),
      })),
  };
}
