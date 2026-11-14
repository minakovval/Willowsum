import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import { filterValue } from "../../../../platform/http/list-query.ts";
import { defineList } from "../../../../platform/lists/list-engine.ts";
import { z } from "zod";
import type { StoredTransaction, TransactionsTx } from "../../application/index.ts";

/** The transactions schema through the module's own role (migrations/0001_transactions.sql). The row policy binds the space; SQL filters it too. */

interface Row {
  id: string;
  account_id: string;
  subaccount_id: string;
  amount: string;
  currency: string;
  occurred_on: string;
  counterparty: string | null;
  description: string | null;
  status: "posted";
  source: "manual";
  version: number;
  created_at: string;
}

// Dates and times as text, so no time zone of the driver touches them.
const COLUMNS = `id, account_id, subaccount_id, amount::text AS amount, currency, occurred_on::text AS occurred_on,
  counterparty, description, status, source, version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`;

function stored(r: Row): StoredTransaction {
  return {
    id: r.id,
    accountId: r.account_id,
    subaccountId: r.subaccount_id,
    amount: Money.of(r.amount, r.currency),
    date: r.occurred_on,
    counterparty: r.counterparty,
    description: r.description,
    status: r.status,
    source: r.source,
    version: r.version,
    createdAt: r.created_at,
  };
}

export function transactionsTx(q: ModuleQueryRunner): TransactionsTx {
  const one = async (text: string, values: unknown[]) => {
    const { rows } = await q.query<Row>(text, values);
    return rows[0] ? stored(rows[0]) : null;
  };
  return {
    async insert(householdId, t) {
      const row = await one(
        `INSERT INTO transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                   counterparty, description, status, source, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`,
        [
          householdId,
          t.id,
          t.accountId,
          t.subaccountId,
          t.amount.toDecimalString(),
          t.amount.currency,
          t.date,
          t.counterparty,
          t.description,
          t.status,
          t.source,
          t.version,
        ],
      );
      return row!;
    },
    find: (householdId, id) =>
      one(`SELECT ${COLUMNS} FROM transactions WHERE household_id = $1 AND id = $2`, [householdId, id]),
    lock: (householdId, id) =>
      one(`SELECT ${COLUMNS} FROM transactions WHERE household_id = $1 AND id = $2 FOR UPDATE`, [
        householdId,
        id,
      ]),
    async update(householdId, t) {
      const row = await one(
        `UPDATE transactions
            SET account_id = $3, subaccount_id = $4, amount = $5, currency = $6, occurred_on = $7, counterparty = $8,
                description = $9, version = $10, updated_at = now()
          WHERE household_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
        [
          householdId,
          t.id,
          t.accountId,
          t.subaccountId,
          t.amount.toDecimalString(),
          t.amount.currency,
          t.date,
          t.counterparty,
          t.description,
          t.version,
        ],
      );
      return row!;
    },
    async remove(householdId, id) {
      await q.query(`DELETE FROM transactions WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
  };
}

/**
 * The list «Транзакції» on the universal list engine (DAT-01@PoC; FIN-03 FR 13, FR 22): whitelisted filters and sorts,
 * numbered pages of 25, 50 or 100, and the amounts by currency, date and sign for the totals of income, expenses and
 * the difference at the official rate of each transaction's date. The filters of states, tags, categories and
 * merchants come with the parts that bring them (FIN-03 b, BUD-01, BUD-13).
 */
export const transactionsList = defineList({
  table: "transactions",
  select: {
    id: "id",
    accountId: "account_id",
    amount: "amount",
    currency: "currency",
    date: "occurred_on",
    counterparty: "counterparty",
    description: "description",
    status: "status",
    source: "source",
    createdAt: "created_at",
  },
  tieBreaker: "id",
  filters: {
    /** «Рахунки» */
    accountId: { column: "account_id", cast: "uuid", value: filterValue.uuid(), operators: ["eq", "in"] },
    /** «Період» */
    date: { column: "occurred_on", cast: "date", value: filterValue.isoDate(), operators: ["gte", "lte"] },
    /** «Тип»: `in` — надходження, `out` — списання. */
    type: { column: "direction", cast: "text", value: z.enum(["in", "out"]), operators: ["eq"] },
    /** «Сума» від / до: the amount without its sign. */
    amount: { column: "magnitude", cast: "numeric", value: filterValue.decimal(), operators: ["gte", "lte"] },
    /** «Мерчант»: the counterparty as typed (the merchants directory comes later). */
    counterparty: {
      column: "counterparty",
      cast: "text",
      value: z.string().min(1).max(200),
      operators: ["eq", "has"],
    },
    /** The search of the list (FR 13): counterparty and description. */
    search: { column: "search_text", cast: "text", value: z.string().min(1).max(200), operators: ["has"] },
  },
  sorts: { date: "occurred_on", amount: "amount", counterparty: "counterparty" },
  defaultSort: { field: "date", direction: "desc" },
  amounts: {
    amountColumn: "amount",
    currencyColumn: "currency",
    rateDate: { column: "occurred_on" },
    bySign: true,
  },
});
