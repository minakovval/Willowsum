import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/** One side of a transfer between own accounts as «Грошовий потік» reads it (BUD-08@PoC FR 5–7). */
export interface MovementSide {
  readonly id: string;
  readonly accountId: string;
  /** Signed, in the side's own currency: the outflow negative, the inflow positive. */
  readonly amount: Money;
  readonly date: string;
}

/** A transaction of an account as «Грошовий потік» reads a loan's (BUD-08@PoC FR 7). */
export interface AccountOperation extends MovementSide {
  readonly source: "manual" | "imported";
  /** A side of a transfer between own accounts. */
  readonly transfer: boolean;
}

/**
 * BUD-08@PoC FR 5, FR 6: the space's marked transfers between own accounts whose outflow is dated from `from` to `to`
 * (both included) and shown, with both sides. Bounded by the space and the dates (`transactions_by_date`), each joined
 * by its key.
 */
export async function transfersInPeriod(
  q: ModuleQueryRunner,
  householdId: string,
  from: string,
  to: string,
): Promise<{ readonly outflow: MovementSide; readonly inflow: MovementSide }[]> {
  const { rows } = await q.query<{
    out_id: string;
    out_account: string;
    out_amount: string;
    out_currency: string;
    out_date: string;
    in_id: string;
    in_account: string;
    in_amount: string;
    in_currency: string;
    in_date: string;
  }>(
    `SELECT o.id AS out_id, o.account_id AS out_account, o.amount::text AS out_amount, o.currency AS out_currency,
            to_char(o.occurred_on, 'YYYY-MM-DD') AS out_date,
            i.id AS in_id, i.account_id AS in_account, i.amount::text AS in_amount, i.currency AS in_currency,
            to_char(i.occurred_on, 'YYYY-MM-DD') AS in_date
       FROM transactions o
       JOIN transfers tr ON tr.household_id = o.household_id AND tr.outflow_id = o.id
       JOIN transactions i ON i.household_id = tr.household_id AND i.id = tr.inflow_id
      WHERE o.household_id = $1 AND o.transfer_id IS NOT NULL AND NOT o.hidden AND o.merged_into IS NULL
        AND o.occurred_on BETWEEN $2::date AND $3::date
      ORDER BY o.occurred_on, o.id`,
    [householdId, from, to],
  );
  return rows.map((r) => ({
    outflow: {
      id: r.out_id,
      accountId: r.out_account,
      amount: Money.of(r.out_amount, r.out_currency),
      date: r.out_date,
    },
    inflow: {
      id: r.in_id,
      accountId: r.in_account,
      amount: Money.of(r.in_amount, r.in_currency),
      date: r.in_date,
    },
  }));
}

/**
 * BUD-08@PoC FR 7: the shown transactions of `accountIds` from `from` to `to` (both included), sides of a transfer too,
 * no merged duplicate; oldest first — by date, then as recorded (`transactions_by_account`).
 */
export async function operationsOnAccounts(
  q: ModuleQueryRunner,
  householdId: string,
  accountIds: readonly string[],
  from: string,
  to: string,
): Promise<AccountOperation[]> {
  if (accountIds.length === 0) return [];
  const { rows } = await q.query<{
    id: string;
    account_id: string;
    amount: string;
    currency: string;
    date: string;
    source: "manual" | "imported";
    transfer: boolean;
  }>(
    `SELECT id, account_id, amount::text AS amount, currency, to_char(occurred_on, 'YYYY-MM-DD') AS date, source,
            transfer_id IS NOT NULL AS transfer
       FROM transactions
      WHERE household_id = $1 AND account_id = ANY($2::uuid[]) AND NOT hidden AND merged_into IS NULL
        AND occurred_on BETWEEN $3::date AND $4::date
      ORDER BY occurred_on, created_at, id`,
    [householdId, [...accountIds], from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    amount: Money.of(r.amount, r.currency),
    date: r.date,
    source: r.source,
    transfer: r.transfer,
  }));
}
