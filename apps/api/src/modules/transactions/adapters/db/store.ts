import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import { filterValue } from "../../../../platform/http/list-query.ts";
import { defineList } from "../../../../platform/lists/list-engine.ts";
import { z } from "zod";
import type { StoredTransaction, TransactionsTx } from "../../application/index.ts";
import {
  TRANSACTION_STATUSES,
  type Split,
  type SplitMode,
  type TransactionStatus,
} from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

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
  status: TransactionStatus;
  source: "manual";
  hidden: boolean;
  split_mode: SplitMode | null;
  split_needs_review: boolean;
  version: number;
  created_at: Date;
}

interface PartRow {
  transaction_id: string;
  category_id: string;
  month: string | null;
  amount: string;
  currency: string;
}

// The date as text, so no time zone of the driver touches it.
const COLUMNS = `id, account_id, subaccount_id, amount::text AS amount, currency, occurred_on::text AS occurred_on,
  counterparty, description, status, source, hidden, split_mode, split_needs_review, version, created_at`;

function splitOf(mode: SplitMode | null, needsReview: boolean, parts: readonly PartRow[]): Split | null {
  if (mode === null) return null;
  return {
    mode,
    needsReview,
    parts: parts.map((p) => ({
      categoryId: p.category_id,
      month: p.month,
      amount: Money.of(p.amount, p.currency),
    })),
  };
}

/** The parts of the transactions `ids`, in order (the date as text, as the row's). */
export async function partsOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<Map<string, PartRow[]>> {
  const byTransaction = new Map<string, PartRow[]>();
  if (ids.length === 0) return byTransaction;
  const { rows } = await q.query<PartRow>(
    `SELECT transaction_id, category_id, month::text AS month, amount::text AS amount, currency
       FROM transaction_parts WHERE household_id = $1 AND transaction_id = ANY($2::uuid[])
      ORDER BY transaction_id, position`,
    [householdId, ids],
  );
  for (const r of rows)
    byTransaction.set(r.transaction_id, [...(byTransaction.get(r.transaction_id) ?? []), r]);
  return byTransaction;
}

/** A listed row's split (the route reads the page's parts in one query). */
export function listedSplit(
  row: Record<string, unknown>,
  parts: ReadonlyMap<string, PartRow[]>,
): Split | null {
  return splitOf(
    (row["splitMode"] as SplitMode | null) ?? null,
    row["splitNeedsReview"] === true,
    parts.get(String(row["id"])) ?? [],
  );
}

function stored(r: Row, parts: readonly PartRow[]): StoredTransaction {
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
    hidden: r.hidden,
    split: splitOf(r.split_mode, r.split_needs_review, parts),
    version: r.version,
    // As the list engine returns it (the driver's instant, milliseconds), so a row reads the same in both.
    createdAt: r.created_at.toISOString(),
  };
}

export function transactionsTx(q: ModuleQueryRunner): TransactionsTx {
  const one = async (text: string, values: unknown[]) => {
    const { rows } = await q.query<Row>(text, values);
    const row = rows[0];
    if (!row) return null;
    const parts =
      row.split_mode === null ? [] : ((await partsOf(q, String(values[0]), [row.id])).get(row.id) ?? []);
    return stored(row, parts);
  };
  /** The parts of `t` replace the stored ones (none when it is not split). */
  const writeParts = async (householdId: string, t: { id: string; split: Split | null }) => {
    await q.query(`DELETE FROM transaction_parts WHERE household_id = $1 AND transaction_id = $2`, [
      householdId,
      t.id,
    ]);
    const parts = t.split?.parts ?? [];
    if (parts.length === 0) return;
    await q.query(
      `INSERT INTO transaction_parts (household_id, transaction_id, position, category_id, month, amount, currency)
       SELECT $1, $2, p.position, p.category_id, p.month, p.amount, p.currency
         FROM unnest($3::smallint[], $4::uuid[], $5::date[], $6::numeric[], $7::text[])
              AS p(position, category_id, month, amount, currency)`,
      [
        householdId,
        t.id,
        parts.map((_, i) => i),
        parts.map((p) => p.categoryId),
        parts.map((p) => p.month),
        parts.map((p) => p.amount.toDecimalString()),
        parts.map((p) => p.amount.currency),
      ],
    );
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
      // The parts first: the row's read below returns them with it.
      await writeParts(householdId, t);
      const row = await one(
        `UPDATE transactions
            SET account_id = $3, subaccount_id = $4, amount = $5, currency = $6, occurred_on = $7, counterparty = $8,
                description = $9, version = $10, status = $11, hidden = $12, split_mode = $13,
                split_needs_review = $14, updated_at = now()
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
          t.status,
          t.hidden,
          t.split?.mode ?? null,
          t.split?.needsReview ?? false,
        ],
      );
      return row!;
    },
    async remove(householdId, id) {
      await q.query(`DELETE FROM transactions WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    enqueueHandOff: (householdId, handOff) => enqueueHandOff({ ...q, householdId }, handOff),
  };
}

/**
 * The list «Транзакції» on the universal list engine (DAT-01@PoC; FIN-03 FR 13, FR 22): whitelisted filters and sorts,
 * numbered pages of 25, 50 or 100, and the amounts by currency, date and sign for the totals of income, expenses and
 * the difference at the official rate of each transaction's date. «Стан» (FR 22): `status` («Очікує»), `split`
 * («Розділені») and `hidden` («Приховані»; without a `hidden` filter the route lists the shown ones only). The filters of
 * tags, categories and merchants come with the parts that bring them (BUD-01, BUD-13).
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
    hidden: "hidden",
    splitMode: "split_mode",
    splitNeedsReview: "split_needs_review",
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
    /** «Стан: очікує» — `status.eq:pending`. */
    status: { column: "status", cast: "text", value: z.enum(TRANSACTION_STATUSES), operators: ["eq", "in"] },
    /** «Стан: розділені». */
    split: { column: "is_split", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
    /** «Стан: приховані» — `hidden.eq:true`. */
    hidden: { column: "hidden", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
  },
  // «Дата і час» (FR 13, AC13): the date, then within a day the time it was recorded (`recordedAt`, see the route).
  sorts: { date: "occurred_on", recordedAt: "created_at", amount: "amount", counterparty: "counterparty" },
  defaultSort: { field: "date", direction: "desc" },
  amounts: {
    amountColumn: "amount",
    currencyColumn: "currency",
    rateDate: { column: "occurred_on" },
    bySign: true,
  },
});
