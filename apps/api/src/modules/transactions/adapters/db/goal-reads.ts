import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * BUD-05@PoC FR 10 (module goals, «Подушка безпеки»): the space's expenses from `from` to `to` (both included), summed
 * in SQL by day and currency — the outgoing amounts (without their sign) of shown transactions, «Очікує» too, merged
 * into none and no side of a transfer between own accounts. Exact NUMERIC as text, never a float.
 */
export async function expensesByDay(
  q: ModuleQueryRunner,
  householdId: string,
  from: string,
  to: string,
): Promise<{ date: string; amount: Money }[]> {
  const { rows } = await q.query<{ date: string; currency: string; total: string }>(
    `SELECT to_char(occurred_on, 'YYYY-MM-DD') AS date, currency, (-sum(amount))::text AS total
       FROM transactions
      WHERE household_id = $1 AND occurred_on BETWEEN $2::date AND $3::date AND amount < 0
        AND NOT hidden AND merged_into IS NULL AND transfer_id IS NULL
      GROUP BY occurred_on, currency
      ORDER BY occurred_on, currency`,
    [householdId, from, to],
  );
  return rows.map((r) => ({ date: r.date, amount: Money.of(r.total, r.currency) }));
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
