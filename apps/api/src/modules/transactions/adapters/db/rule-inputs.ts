import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * What module categorization reads of the space's transactions for its category rules (BUD-14@PoC FR 5, FR 7, FR 8):
 * the account, the signed amount in its currency, the date and the counterparty — the bank's description, or as the
 * user typed it. `eligible` — a rule may set its category: shown, no side of a transfer, not split, merged into none.
 */
export interface RuleInput {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  readonly amount: string;
  readonly currency: string;
  readonly counterparty: string | null;
  readonly eligible: boolean;
}

interface Row {
  id: string;
  account_id: string;
  occurred_on: string;
  amount: string;
  currency: string;
  counterparty: string | null;
  eligible: boolean;
}

const SELECT = `SELECT id, account_id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, amount::text AS amount,
                       currency, counterparty,
                       (NOT hidden AND NOT is_transfer AND NOT is_split AND merged_into IS NULL) AS eligible
                  FROM transactions`;

const input = (r: Row): RuleInput => ({
  id: r.id,
  accountId: r.account_id,
  date: r.occurred_on,
  amount: r.amount,
  currency: r.currency,
  counterparty: r.counterparty,
  eligible: r.eligible,
});

/** The inputs of each existing transaction of `ids` (hidden ones too); the others are absent. */
export async function ruleInputsOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, RuleInput>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query<Row>(`${SELECT} WHERE household_id = $1 AND id = ANY($2::uuid[])`, [
    householdId,
    ids,
  ]);
  return new Map(rows.map((r) => [r.id, input(r)]));
}

/**
 * The eligible transactions of the space, newest first (date, then id), at most `limit`; `more` — there are others
 * beyond them.
 */
export async function ruleCandidates(
  q: ModuleQueryRunner,
  householdId: string,
  limit: number,
): Promise<{ readonly items: readonly RuleInput[]; readonly more: boolean }> {
  const { rows } = await q.query<Row>(
    `${SELECT}
      WHERE household_id = $1 AND NOT hidden AND NOT is_transfer AND NOT is_split AND merged_into IS NULL
      ORDER BY occurred_on DESC, id DESC
      LIMIT $2`,
    [householdId, limit + 1],
  );
  return { items: rows.slice(0, limit).map(input), more: rows.length > limit };
}
