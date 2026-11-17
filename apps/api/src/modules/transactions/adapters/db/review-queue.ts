import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * What module merchants reads of «До розбору» for its mode «Мерчанти» (BUD-12@PoC FR 14–16): the queue (shown
 * transactions with `review = 'queued'`, the counter's set) counted and summed in SQL by counterparty and currency,
 * and the ids of the queued transactions of some counterparties. Read only.
 */

/** The queued transactions of one counterparty in one currency. `total` is the exact signed sum (NUMERIC as text). */
export interface ReviewQueueSlice {
  readonly counterparty: string | null;
  readonly currency: string;
  readonly count: number;
  readonly total: string;
  readonly oldest: string;
}

/**
 * The queue by counterparty and currency, the oldest slices first, at most `limit`; `more` — there are others beyond
 * them (left out of the groups).
 */
export async function reviewQueueSlices(
  q: ModuleQueryRunner,
  householdId: string,
  limit: number,
): Promise<{ readonly slices: readonly ReviewQueueSlice[]; readonly more: boolean }> {
  const { rows } = await q.query<{
    counterparty: string | null;
    currency: string;
    n: number;
    total: string;
    oldest: string;
  }>(
    `SELECT counterparty, currency, count(*)::int AS n, sum(amount)::text AS total,
            to_char(min(occurred_on), 'YYYY-MM-DD') AS oldest
       FROM transactions
      WHERE household_id = $1 AND review = 'queued' AND NOT hidden
      GROUP BY counterparty, currency
      ORDER BY min(occurred_on), counterparty NULLS FIRST, currency
      LIMIT $2`,
    [householdId, limit + 1],
  );
  return {
    slices: rows.slice(0, limit).map((r) => ({
      counterparty: r.counterparty,
      currency: r.currency,
      count: r.n,
      total: r.total,
      oldest: r.oldest,
    })),
    more: rows.length > limit,
  };
}

/**
 * The queued (shown) transactions whose counterparty is one of `counterparties` — with `none`, also those without one
 * — with their counterparty, by id, after `after` (keyset), at most `limit`; `more` — there are others beyond them.
 */
export async function reviewQueueMembers(
  q: ModuleQueryRunner,
  householdId: string,
  query: {
    readonly counterparties: readonly string[];
    readonly none: boolean;
    readonly after: string | null;
    readonly limit: number;
  },
): Promise<{
  readonly items: readonly { readonly id: string; readonly counterparty: string | null }[];
  readonly more: boolean;
}> {
  const { rows } = await q.query<{ id: string; counterparty: string | null }>(
    `SELECT id, counterparty FROM transactions
      WHERE household_id = $1 AND review = 'queued' AND NOT hidden
        AND (counterparty = ANY($2::text[]) OR ($3::boolean AND counterparty IS NULL))
        AND ($4::uuid IS NULL OR id > $4::uuid)
      ORDER BY id
      LIMIT $5`,
    [householdId, query.counterparties, query.none, query.after, query.limit + 1],
  );
  return {
    items: rows.slice(0, query.limit).map((r) => ({ id: r.id, counterparty: r.counterparty })),
    more: rows.length > query.limit,
  };
}
