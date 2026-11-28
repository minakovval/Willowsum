import { exchangeRate, Money, type ExchangeRate } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import { transferDate, transferDifference, type OneSidedState } from "../../domain/index.ts";

/**
 * IMP-03@PoC FR 14, FR 18, FR 20, FR 22 — what «Пари → Односторонні» and «Пари → Підтверджені» read, and the free single
 * transactions module transfer-matching checks for the flag «односторонній переказ». Read only; every query is bound to
 * the space (and to it by the row policy). A transaction rolled back with its import batch is in none.
 */

/** A side as the lists show it: the transaction, its account, signed amount, date and texts. */
export interface PairListSide {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
  readonly counterparty: string | null;
  readonly description: string | null;
}

/** A free single transaction for the check of FR 14, FR 15 (the bank's description in `description` too). */
export interface SingleSide extends PairListSide {
  readonly importBatchId: string | null;
}

export interface ConfirmedPair {
  /** The transfer's id. */
  readonly id: string;
  readonly outflow: PairListSide;
  readonly inflow: PairListSide;
  /** Edge case 1: the earlier side's date. */
  readonly date: string;
  /** Two currencies: the official rate kept when marked (1 unit of the inflow's currency in the outflow's). */
  readonly rate: ExchangeRate | null;
  /** FIN-03 FR 8: the fee (one currency) or the currency difference (two) the budget counts; null — none. */
  readonly difference: { readonly amount: Money; readonly side: "outflow" | "inflow" } | null;
  /** FR 21: the category chosen for it; null — «Комісії банку». */
  readonly feeCategoryId: string | null;
}

export interface OneSidedSide extends PairListSide {
  readonly state: Exclude<OneSidedState, "dismissed">;
  readonly evidence: readonly string[];
}

interface SideRow {
  id: string;
  account_id: string;
  amount: string;
  currency: string;
  occurred_on: string;
  counterparty: string | null;
  description: string | null;
}

const sideOf = (r: SideRow): PairListSide => ({
  transactionId: r.id,
  accountId: r.account_id,
  amount: Money.of(r.amount, r.currency),
  date: r.occurred_on,
  counterparty: r.counterparty,
  description: r.description,
});

const SIDE = `id, account_id, amount::text AS amount, currency, occurred_on::text AS occurred_on, counterparty,
  description`;

/** Free: posted, shown, not split, not merged, in no transfer, not rolled back. */
const FREE = `status = 'posted' AND NOT hidden AND split_mode IS NULL AND merged_into IS NULL AND transfer_id IS NULL
  AND rolled_back_at IS NULL`;

/**
 * FR 14, FR 15: the free transactions that never had a one-sided state (not zero), newest first, at most `limit` — the
 * text compared is the description as typed or imported and the bank's own description (IMP-02 FR 4).
 */
export async function pairingSingles(
  q: ModuleQueryRunner,
  householdId: string,
  limit: number,
): Promise<SingleSide[]> {
  const { rows } = await q.query<SideRow & { import_batch_id: string | null }>(
    `SELECT id, account_id, amount::text AS amount, currency, occurred_on::text AS occurred_on, counterparty,
            NULLIF(concat_ws(' ', description, bank_description), '') AS description, import_batch_id
       FROM transactions
      WHERE household_id = $1 AND ${FREE} AND one_sided IS NULL AND amount <> 0
      ORDER BY occurred_on DESC, id
      LIMIT $2`,
    [householdId, limit],
  );
  return rows.map((r) => ({ ...sideOf(r), importBatchId: r.import_batch_id }));
}

/**
 * FR 18, FR 22 «Односторонні»: the flagged and the marked («Це переказ») one-sided transfers that are still free, newest
 * first, at most `limit`, and how many there are in all.
 */
export async function oneSidedTransfers(
  q: ModuleQueryRunner,
  householdId: string,
  limit: number,
): Promise<{ readonly items: OneSidedSide[]; readonly count: number }> {
  const { rows } = await q.query<
    SideRow & { one_sided: "flagged" | "marked"; one_sided_evidence: string[] | null; rows_in_all: number }
  >(
    `SELECT ${SIDE}, one_sided, one_sided_evidence, count(*) OVER ()::int AS rows_in_all
       FROM transactions
      WHERE household_id = $1 AND ${FREE} AND one_sided IN ('flagged', 'marked')
      ORDER BY occurred_on DESC, id
      LIMIT $2`,
    [householdId, limit],
  );
  return {
    items: rows.map((r) => ({ ...sideOf(r), state: r.one_sided, evidence: r.one_sided_evidence ?? [] })),
    count: rows[0]?.rows_in_all ?? 0,
  };
}

/** FR 18, FR 20 «Підтверджені»: the space's transfers, newest first (by the earlier side), at most `limit`, and all. */
export async function confirmedPairs(
  q: ModuleQueryRunner,
  householdId: string,
  limit: number,
): Promise<{ readonly items: ConfirmedPair[]; readonly count: number }> {
  const { rows } = await q.query<{
    id: string;
    rate: string | null;
    rate_date: string | null;
    rate_source: string | null;
    fee_category_id: string | null;
    rows_in_all: number;
    o: SideRow;
    i: SideRow;
  }>(
    `SELECT f.id, f.rate::text AS rate, f.rate_date::text AS rate_date, f.rate_source, f.fee_category_id,
            count(*) OVER ()::int AS rows_in_all,
            json_build_object('id', o.id, 'account_id', o.account_id, 'amount', o.amount::text, 'currency', o.currency,
                              'occurred_on', o.occurred_on::text, 'counterparty', o.counterparty,
                              'description', o.description) AS o,
            json_build_object('id', i.id, 'account_id', i.account_id, 'amount', i.amount::text, 'currency', i.currency,
                              'occurred_on', i.occurred_on::text, 'counterparty', i.counterparty,
                              'description', i.description) AS i
       FROM transfers f
       JOIN transactions o ON o.household_id = f.household_id AND o.id = f.outflow_id
       JOIN transactions i ON i.household_id = f.household_id AND i.id = f.inflow_id
      WHERE f.household_id = $1 AND o.rolled_back_at IS NULL AND i.rolled_back_at IS NULL
      ORDER BY LEAST(o.occurred_on, i.occurred_on) DESC, f.id
      LIMIT $2`,
    [householdId, limit],
  );
  return {
    items: rows.map((r) => {
      const outflow = sideOf(r.o);
      const inflow = sideOf(r.i);
      const rate =
        r.rate === null
          ? null
          : exchangeRate({
              base: inflow.amount.currency,
              quote: outflow.amount.currency,
              rate: r.rate,
              date: r.rate_date!,
              source: r.rate_source!,
            });
      return {
        id: r.id,
        outflow,
        inflow,
        date: transferDate(outflow, inflow),
        rate,
        difference: transferDifference(outflow, inflow, rate),
        feeCategoryId: r.fee_category_id,
      };
    }),
    count: rows[0]?.rows_in_all ?? 0,
  };
}
