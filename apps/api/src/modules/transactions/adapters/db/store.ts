import { exchangeRate, Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import { filterValue } from "../../../../platform/http/list-query.ts";
import { defineList, type AmountGroup } from "../../../../platform/lists/list-engine.ts";
import { z } from "zod";
import type { StoredTransaction, TransactionsTx } from "../../application/index.ts";
import {
  REVIEW_STATES,
  TRANSACTION_STATUSES,
  type ReviewState,
  type Split,
  type SplitMode,
  type TransactionStatus,
  transferDate,
  transferFee,
  type TransferLink,
  keepsOneOff,
} from "../../domain/index.ts";
import { publishEvent } from "../../../../platform/queue/index.ts";
import { transactionCreated } from "../../events.ts";
import { enqueueHandOff } from "../queue/job.ts";
import { lockAccounts } from "../../../accounts/index.ts";

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
  source: "manual" | "imported";
  hidden: boolean;
  split_mode: SplitMode | null;
  split_needs_review: boolean;
  transfer_id: string | null;
  merged_into: string | null;
  note: string | null;
  tag_ids: string[];
  one_off: boolean;
  review: ReviewState | null;
  version: number;
  created_at: Date;
}

interface TransferRow {
  id: string;
  outflow_id: string;
  inflow_id: string;
  rate: string | null;
  rate_date: string | null;
  rate_source: string | null;
  inflow_amount: string;
  inflow_currency: string;
  inflow_date: string;
  outflow_amount: string;
  outflow_currency: string;
  outflow_date: string;
}

/** A transfer as the API shows it on each side (FR 7, FR 8, edge case 1): the pair, its date and its fee. */
export interface TransferView {
  readonly link: TransferLink;
  readonly date: string;
  readonly fee: Money | null;
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
  counterparty, description, status, source, hidden, split_mode, split_needs_review, transfer_id, merged_into, note,
  tag_ids::text[] AS tag_ids, one_off, review, version, created_at`;

/** The transfers `ids` (FR 7), read with their two sides (the rate's currencies, the date and the fee). */
export async function transfersOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<Map<string, TransferView>> {
  const byId = new Map<string, TransferView>();
  if (ids.length === 0) return byId;
  const { rows } = await q.query<TransferRow>(
    `SELECT f.id, f.outflow_id, f.inflow_id, f.rate::text AS rate, f.rate_date::text AS rate_date, f.rate_source,
            i.amount::text AS inflow_amount, i.currency AS inflow_currency, i.occurred_on::text AS inflow_date,
            o.amount::text AS outflow_amount, o.currency AS outflow_currency, o.occurred_on::text AS outflow_date
       FROM transfers f
       JOIN transactions o ON o.household_id = f.household_id AND o.id = f.outflow_id
       JOIN transactions i ON i.household_id = f.household_id AND i.id = f.inflow_id
      WHERE f.household_id = $1 AND f.id = ANY($2::uuid[])`,
    [householdId, ids],
  );
  for (const r of rows) {
    const outflow = { amount: Money.of(r.outflow_amount, r.outflow_currency), date: r.outflow_date };
    const inflow = { amount: Money.of(r.inflow_amount, r.inflow_currency), date: r.inflow_date };
    byId.set(r.id, {
      link: {
        id: r.id,
        outflowId: r.outflow_id,
        inflowId: r.inflow_id,
        rate:
          r.rate === null
            ? null
            : exchangeRate({
                base: r.inflow_currency,
                quote: r.outflow_currency,
                rate: r.rate,
                date: r.rate_date!,
                source: r.rate_source!,
              }),
      },
      date: transferDate(outflow, inflow),
      fee: transferFee(outflow, inflow),
    });
  }
  return byId;
}

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

function stored(r: Row, parts: readonly PartRow[], transfer: TransferLink | null): StoredTransaction {
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
    transfer,
    mergedInto: r.merged_into,
    note: r.note,
    tagIds: r.tag_ids,
    oneOff: r.one_off,
    review: r.review,
    version: r.version,
    // As the list engine returns it (the driver's instant, milliseconds), so a row reads the same in both.
    createdAt: r.created_at.toISOString(),
  };
}

/** The columns of a stored transaction and its row as read (for the rollback's own reads, adapters/db/imported.ts). */
export const STORED_COLUMNS = COLUMNS;
export type StoredRowShape = Row;

/** A read row with its split's parts and its transfer. */
export async function storedRow(
  q: ModuleQueryRunner,
  householdId: string,
  row: Row,
): Promise<StoredTransaction> {
  const parts = row.split_mode === null ? [] : ((await partsOf(q, householdId, [row.id])).get(row.id) ?? []);
  const transfer =
    row.transfer_id === null
      ? null
      : ((await transfersOf(q, householdId, [row.transfer_id])).get(row.transfer_id)?.link ?? null);
  return stored(row, parts, transfer);
}

/**
 * IMP-04 FR 8, IMP-16 FR 2: a transaction rolled back with its import batch is out of every read and change of the
 * module — found by none (`find`, `lock`), so a hand-off of it reverses its journal event; only the rollback reads it.
 */
const LIVE = "rolled_back_at IS NULL";

export function transactionsTx(q: ModuleQueryRunner): TransactionsTx {
  const one = async (text: string, values: unknown[]) => {
    const { rows } = await q.query<Row>(text, values);
    const row = rows[0];
    if (!row) return null;
    return storedRow(q, String(values[0]), row);
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
                                   counterparty, description, status, source, version, note, tag_ids, review,
                                   transfer_id, one_off)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid[], $15, $16, $17)
         RETURNING ${COLUMNS}`,
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
          t.note,
          [...t.tagIds],
          t.review,
          // FIN-03 FR 1, FR 28: a side of a transfer created in one action, its pair written first (insertTransfer).
          t.transfer?.id ?? null,
          // BUD-06 FR 8: an income or a transfer side keeps no «Одноразова витрата» (any write that makes it one).
          keepsOneOff(t),
        ],
      );
      return row!;
    },
    find: (householdId, id) =>
      one(`SELECT ${COLUMNS} FROM transactions WHERE household_id = $1 AND id = $2 AND ${LIVE}`, [
        householdId,
        id,
      ]),
    lock: (householdId, id) =>
      one(`SELECT ${COLUMNS} FROM transactions WHERE household_id = $1 AND id = $2 AND ${LIVE} FOR UPDATE`, [
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
                split_needs_review = $14, transfer_id = $15, merged_into = $16, note = $17,
                tag_ids = $18::uuid[], review = $19, one_off = $20, updated_at = now()
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
          t.transfer?.id ?? null,
          t.mergedInto,
          t.note,
          [...t.tagIds],
          t.review,
          // BUD-06 FR 8: an income or a transfer side keeps no «Одноразова витрата» (any write that makes it one).
          keepsOneOff(t),
        ],
      );
      return row!;
    },
    async insertTransfer(householdId, link) {
      await q.query(
        `INSERT INTO transfers (household_id, id, outflow_id, inflow_id, rate, rate_date, rate_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          householdId,
          link.id,
          link.outflowId,
          link.inflowId,
          link.rate?.rate.toString() ?? null,
          link.rate?.date ?? null,
          link.rate?.source ?? null,
        ],
      );
    },
    async removeTransfer(householdId, id) {
      await q.query(`DELETE FROM transfers WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    async duplicatesOf(householdId, id) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM transactions WHERE household_id = $1 AND merged_into = $2 ORDER BY id`,
        [householdId, id],
      );
      return rows.map((r) => r.id);
    },
    async insertDismissal(householdId, firstId, secondId) {
      const { rowCount } = await q.query(
        `INSERT INTO duplicate_dismissals (household_id, first_id, second_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [householdId, firstId, secondId],
      );
      return (rowCount ?? 0) > 0;
    },
    lockAccounts: (householdId, accountIds) => lockAccounts(q, householdId, accountIds),
    async lockDuplicates(householdId) {
      await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('transactions.duplicates:' || $1, 0))`, [
        householdId,
      ]);
    },
    async duplicatesForHiding(householdId, id, _accountId, windowDays) {
      // Under the space's lock of duplicates (lockDuplicates, taken first by the caller): the other copy, hidden or
      // changed meanwhile, is seen once that one has committed.
      return duplicateCandidatesOf(q, householdId, id, { windowDays });
    },
    async hiddenCopiesOf(householdId, side, windowDays) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT h.id FROM transactions h
          WHERE h.household_id = $1 AND h.hidden AND h.merged_into IS NULL AND h.transfer_id IS NULL
            AND h.source = 'manual' AND h.id <> $2 AND h.account_id = $3 AND h.currency = $4
            AND h.amount = $5::numeric AND abs(h.occurred_on - $6::date) <= $7::int
            AND NOT EXISTS (SELECT 1 FROM duplicate_dismissals d
                             WHERE d.household_id = h.household_id
                               AND d.first_id = least(h.id, $2::uuid) AND d.second_id = greatest(h.id, $2::uuid))
          ORDER BY h.id`,
        [
          householdId,
          side.id,
          side.accountId,
          side.amount.currency,
          side.amount.toDecimalString(),
          side.date,
          windowDays,
        ],
      );
      return rows.map((r) => r.id);
    },
    async pairsOfHidden(householdId, id, windowDays) {
      const { rows } = await q.query<DuplicateRow>(
        `SELECT h.id AS a_id, h.occurred_on::text AS a_date, o.id AS b_id, o.occurred_on::text AS b_date,
                h.account_id, h.amount::text AS amount, h.currency
           FROM transactions h
           JOIN transactions o ON o.household_id = h.household_id AND o.account_id = h.account_id
                              AND o.currency = h.currency AND o.amount = h.amount AND o.id <> h.id
                              AND abs(o.occurred_on - h.occurred_on) <= $3::int
          WHERE h.household_id = $1 AND h.id = $2 AND h.transfer_id IS NULL AND NOT o.hidden AND o.transfer_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM duplicate_dismissals d
                             WHERE d.household_id = h.household_id
                               AND d.first_id = least(h.id, o.id) AND d.second_id = greatest(h.id, o.id))
          ORDER BY o.occurred_on, o.id LIMIT 100`,
        [householdId, id, windowDays],
      );
      // Each pair in the order of the search (the earlier, then the smaller id, first).
      return rows
        .map(duplicateSides)
        .map(({ first, second }) =>
          first.date < second.date ||
          (first.date === second.date && first.transactionId < second.transactionId)
            ? { first, second }
            : { first: second, second: first },
        );
    },
    async remove(householdId, id) {
      // A side of a transfer is never deleted (the route refuses it), so no transfer points at the row.
      await q.query(`DELETE FROM transactions WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    enqueueHandOff: (householdId, handOff) => enqueueHandOff({ ...q, householdId }, handOff),
    async publishCreated(householdId, transactionId) {
      await publishEvent({ ...q, householdId }, transactionCreated, { transactionId });
    },
  };
}

/**
 * IMP-02@PoC FR 4 (S-047 data): what an imported transaction keeps of its statement row, under the names the list
 * selects (`transactionsList`) — the bank's description, the balance after it, the batch, file and row it came from, the
 * original amount and currency, the bank's rate, the value date and the reference. Null for one entered by hand.
 */
export const BANK_FIELDS = {
  bankDescription: "bank_description",
  balanceAfter: "balance_after",
  importBatchId: "import_batch_id",
  importFileId: "import_file_id",
  importRow: "import_row",
  originalAmount: "original_amount",
  originalCurrency: "original_currency",
  exchangeRate: "exchange_rate",
  valueDate: "value_date",
  bankReference: "bank_reference",
} as const;
export type BankFields = { readonly [K in keyof typeof BANK_FIELDS]: unknown } & {
  readonly currency: unknown;
};

/**
 * The list «Транзакції» on the universal list engine (DAT-01@PoC; FIN-03 FR 13, FR 22): whitelisted filters and sorts,
 * numbered pages of 25, 50 or 100, and the amounts by currency, date and sign for the totals of income, expenses and
 * the difference at the official rate of each transaction's date. «Стан» (FR 22): `status` («Очікує»), `split`
 * («Розділені»), `transfer` («Переказ») and `hidden` («Приховані»; without a `hidden` filter the route lists the shown ones only);
 * «Теги» — `tag` (BUD-13 FR 2); «До розбору» — `review` (BUD-12 FR 2). The filters of categories and merchants come with the parts that bring them (BUD-01, BUD-14).
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
    transferId: "transfer_id",
    mergedInto: "merged_into",
    note: "note",
    tagIds: "tag_ids",
    oneOff: "one_off",
    review: "review",
    version: "version",
    createdAt: "created_at",
    ...BANK_FIELDS,
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
    /** «Стан: приховані» — `hidden.eq:true`; a rolled-back transaction (IMP-16 FR 2) is in neither. */
    hidden: { column: "listed_hidden", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
    /** «Стан: переказ» (FR 22) — `transfer.eq:true`; budgets and reports leave transfers out with `false` (FR 7). */
    transfer: { column: "is_transfer", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
    /** «Теги» (BUD-13 FR 2, FR 5): `tag.eq:<id>` — has the tag, `tag.in:<id>,<id>` — any of them. */
    tag: { column: "tag_ids", cast: "uuid", value: filterValue.uuid(), operators: ["eq", "in"], array: true },
    /** «До розбору» (BUD-12 FR 2): `review.eq:queued` with `sort=date` — the queue, oldest first. */
    review: { column: "review", cast: "text", value: z.enum(REVIEW_STATES), operators: ["eq", "in"] },
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

/** One side of a candidate pair (FIN-03 FR 5), as module transfer-matching receives it. */
export interface CandidateSide {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
  /** IMP-08 FR 11: the import batch that wrote it; null — entered by hand. */
  readonly importBatchId: string | null;
}

/**
 * The candidate pairs of a space for module transfer-matching (FIN-03 FR 5): a debit and a credit on two accounts (or,
 * IMP-03 FR 2, an exchange: on two wallets of one account in two currencies) within
 * `windowDays`, both posted, shown, not split and in no transfer; in one currency the credit at most the debit and at
 * least `sameCurrencyMinShare` of it (the rule of transfer-matching decides the rest, in two currencies by the rate).
 * Newest first; at most `limit` pairs.
 */
export async function transferCandidates(
  q: ModuleQueryRunner,
  householdId: string,
  query: { readonly windowDays: number; readonly sameCurrencyMinShare: string; readonly limit: number },
): Promise<{ readonly outflow: CandidateSide; readonly inflow: CandidateSide }[]> {
  const { rows } = await q.query<{
    o_id: string;
    o_account: string;
    o_amount: string;
    o_currency: string;
    o_date: string;
    i_id: string;
    i_account: string;
    i_amount: string;
    i_currency: string;
    i_date: string;
    o_batch: string | null;
    i_batch: string | null;
  }>(
    `SELECT o.id AS o_id, o.account_id AS o_account, o.amount::text AS o_amount, o.currency AS o_currency,
            o.occurred_on::text AS o_date, i.id AS i_id, i.account_id AS i_account, i.amount::text AS i_amount,
            i.currency AS i_currency, i.occurred_on::text AS i_date, o.import_batch_id AS o_batch,
            i.import_batch_id AS i_batch
       FROM transactions o
       JOIN transactions i ON i.household_id = o.household_id
      WHERE o.household_id = $1 AND o.amount < 0 AND i.amount > 0
        AND (i.account_id <> o.account_id OR i.currency <> o.currency)
        AND o.status = 'posted' AND i.status = 'posted' AND NOT o.hidden AND NOT i.hidden
        AND o.split_mode IS NULL AND i.split_mode IS NULL AND o.transfer_id IS NULL AND i.transfer_id IS NULL
        AND i.occurred_on BETWEEN o.occurred_on - $2::int AND o.occurred_on + $2::int
        AND (i.currency <> o.currency OR (i.amount <= -o.amount AND i.amount >= -o.amount * $3::numeric))
      ORDER BY least(o.occurred_on, i.occurred_on) DESC, o.id, i.id
      LIMIT $4`,
    [householdId, query.windowDays, query.sameCurrencyMinShare, query.limit],
  );
  return rows.map((r) => ({
    outflow: {
      transactionId: r.o_id,
      accountId: r.o_account,
      amount: Money.of(r.o_amount, r.o_currency),
      date: r.o_date,
      importBatchId: r.o_batch,
    },
    inflow: {
      transactionId: r.i_id,
      accountId: r.i_account,
      amount: Money.of(r.i_amount, r.i_currency),
      date: r.i_date,
      importBatchId: r.i_batch,
    },
  }));
}

/** The duplicates merged into each of `ids` (FIN-03 FR 11: «Об'єднано»), in the order of their ids. */
export async function mergedOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const byKept = new Map<string, string[]>();
  if (ids.length === 0) return byKept;
  const { rows } = await q.query<{ id: string; merged_into: string }>(
    `SELECT id, merged_into FROM transactions WHERE household_id = $1 AND merged_into = ANY($2::uuid[]) ORDER BY id`,
    [householdId, ids],
  );
  for (const r of rows) byKept.set(r.merged_into, [...(byKept.get(r.merged_into) ?? []), r.id]);
  return byKept;
}

/** The bank's fields (`BANK_FIELDS`) of the transactions `ids` of the space, by the primary key; one query. */
export async function bankFieldsOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<Map<string, BankFields>> {
  const byId = new Map<string, BankFields>();
  if (ids.length === 0) return byId;
  const columns = Object.entries(BANK_FIELDS)
    .map(([name, column]) => `${column} AS "${name}"`)
    .join(", ");
  const { rows } = await q.query<BankFields & { id: string }>(
    `SELECT id, currency, ${columns} FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[])`,
    [householdId, ids],
  );
  for (const r of rows) byId.set(r.id, r);
  return byId;
}

/** One side of a possible duplicate (FIN-03 FR 12), as module duplicate-matching receives it. */
export interface DuplicateSide {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
}

interface DuplicateRow {
  a_id: string;
  a_date: string;
  b_id: string;
  b_date: string;
  account_id: string;
  amount: string;
  currency: string;
}

const duplicateSides = (r: DuplicateRow): { first: DuplicateSide; second: DuplicateSide } => {
  const side = (transactionId: string, date: string) => ({
    transactionId,
    accountId: r.account_id,
    amount: Money.of(r.amount, r.currency),
    date,
  });
  return { first: side(r.a_id, r.a_date), second: side(r.b_id, r.b_date) };
};

/**
 * Two shown transactions on one account with the same amount and currency within `windowDays`, neither a side of a
 * transfer, the pair not «Не дубль» (FIN-03 FR 12); a merged duplicate is hidden, so never one. `a` is the earlier
 * (then the smaller id). The rule of duplicate-matching decides the rest.
 */
const DUPLICATE_PAIRS = `
  SELECT a.id AS a_id, a.occurred_on::text AS a_date, b.id AS b_id, b.occurred_on::text AS b_date,
         a.account_id, a.amount::text AS amount, a.currency
    FROM transactions a
    JOIN transactions b ON b.household_id = a.household_id AND b.account_id = a.account_id
                       AND b.currency = a.currency AND b.amount = a.amount AND b.id <> a.id
                       AND (b.occurred_on, b.id) > (a.occurred_on, a.id)
                       AND b.occurred_on <= a.occurred_on + $2::int
   WHERE a.household_id = $1 AND NOT a.hidden AND NOT b.hidden AND a.transfer_id IS NULL AND b.transfer_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM duplicate_dismissals d
                      WHERE d.household_id = a.household_id
                        AND d.first_id = least(a.id, b.id) AND d.second_id = greatest(a.id, b.id))`;

/** The possible duplicates of a space for module duplicate-matching: newest first, at most `limit` pairs. */
export async function duplicateCandidates(
  q: ModuleQueryRunner,
  householdId: string,
  query: { readonly windowDays: number; readonly limit: number },
): Promise<{ readonly first: DuplicateSide; readonly second: DuplicateSide }[]> {
  const { rows } = await q.query<DuplicateRow>(
    `${DUPLICATE_PAIRS} ORDER BY b.occurred_on DESC, a.occurred_on DESC, a.id, b.id LIMIT $3`,
    [householdId, query.windowDays, query.limit],
  );
  return rows.map(duplicateSides);
}

/** The possible duplicates that one transaction is a side of (FR 18: only a duplicate is hidden). */
export async function duplicateCandidatesOf(
  q: ModuleQueryRunner,
  householdId: string,
  transactionId: string,
  query: { readonly windowDays: number },
): Promise<{ readonly first: DuplicateSide; readonly second: DuplicateSide }[]> {
  const { rows } = await q.query<DuplicateRow>(
    `${DUPLICATE_PAIRS} AND $3::uuid IN (a.id, b.id) ORDER BY a.occurred_on, a.id, b.id LIMIT 100`,
    [householdId, query.windowDays, transactionId],
  );
  return rows.map(duplicateSides);
}

/**
 * BUD-01@PoC FR 12: of `ids`, the categories a split part of the space has — of any transaction, hidden or not (a
 * part keeps its category until the split is removed). Read only.
 */
export async function categoriesInParts(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query<{ id: string }>(
    `SELECT DISTINCT category_id AS id FROM transaction_parts WHERE household_id = $1 AND category_id = ANY($2::uuid[])`,
    [householdId, ids],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * What module budget counts of the space's transactions in a period (BUD-02@PoC FR 12): the transactions of these
 * accounts dated in [from, to] — pending ones too; not hidden, not a merged duplicate, not a side of a transfer between
 * own accounts — with the parts of a split one; a split «На кілька місяців» by the months of its parts, whatever its
 * date. Read only; amounts signed, in their own currency.
 */
export async function budgetRows(
  q: ModuleQueryRunner,
  householdId: string,
  accountIds: readonly string[],
  from: string,
  to: string,
): Promise<
  {
    id: string;
    accountId: string;
    amount: Money;
    date: string;
    parts: { categoryId: string; month: string | null; amount: Money }[] | null;
    oneOff: boolean;
  }[]
> {
  if (accountIds.length === 0) return [];
  const { rows } = await q.query<{
    id: string;
    account_id: string;
    amount: string;
    currency: string;
    date: string;
    split_mode: string | null;
    parts: { categoryId: string; month: string | null; amount: string }[] | null;
    one_off: boolean;
  }>(
    `SELECT t.id, t.account_id, t.amount::text AS amount, t.currency, to_char(t.occurred_on, 'YYYY-MM-DD') AS date,
            t.split_mode, t.one_off,
            (SELECT json_agg(json_build_object('categoryId', p.category_id, 'month', to_char(p.month, 'YYYY-MM-DD'),
                                               'amount', p.amount::text) ORDER BY p.position)
               FROM transaction_parts p WHERE p.household_id = t.household_id AND p.transaction_id = t.id) AS parts
       FROM transactions t
      WHERE t.household_id = $1 AND t.account_id = ANY($2::uuid[]) AND NOT t.hidden AND t.merged_into IS NULL
        AND t.transfer_id IS NULL
        AND (t.occurred_on BETWEEN $3::date AND $4::date
             OR (t.split_mode = 'months' AND EXISTS (SELECT 1 FROM transaction_parts p
                   WHERE p.household_id = t.household_id AND p.transaction_id = t.id
                     AND p.month BETWEEN $3::date AND $4::date)))
      ORDER BY t.occurred_on, t.id`,
    [householdId, [...accountIds], from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    amount: Money.of(r.amount, r.currency),
    date: r.date,
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

/**
 * BUD-06@PoC FR 4, FR 5: the date of the first transaction the budget counts on these accounts (as `budgetRows`: shown,
 * no merged duplicate, no side of a transfer) — where the space's history starts; null — none.
 */
export async function budgetFirstDate(
  q: ModuleQueryRunner,
  householdId: string,
  accountIds: readonly string[],
): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const { rows } = await q.query<{ first: string | null }>(
    `SELECT to_char(min(t.occurred_on), 'YYYY-MM-DD') AS first
       FROM transactions t
      WHERE t.household_id = $1 AND t.account_id = ANY($2::uuid[]) AND NOT t.hidden AND t.merged_into IS NULL
        AND t.transfer_id IS NULL`,
    [householdId, [...accountIds]],
  );
  return rows[0]?.first ?? null;
}

/**
 * BUD-03@PoC FR 5 «Платіж місяця вважається сплаченим, коли в місяці є перший платіж на цей рахунок»: which of these
 * accounts got money in the dates — a shown transaction with a positive amount, a side of a transfer too (a loan is
 * mostly paid by a transfer from an own account); merged duplicates are not counted.
 */
export async function accountsPaidIn(
  q: ModuleQueryRunner,
  householdId: string,
  accountIds: readonly string[],
  from: string,
  to: string,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const { rows } = await q.query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM transactions
      WHERE household_id = $1 AND account_id = ANY($2::uuid[]) AND NOT hidden AND merged_into IS NULL
        AND amount > 0 AND occurred_on BETWEEN $3::date AND $4::date`,
    [householdId, [...accountIds], from, to],
  );
  return new Set(rows.map((r) => r.account_id));
}

/**
 * What module categorization asks of the space's transactions before it changes one's category (BUD-01@PoC FR 5, FR 6;
 * FIN-03 FR 7, FR 11): whether each of `ids` exists (hidden too), is a side of a transfer, is split or is a merged
 * duplicate. Missing ids are absent from the map.
 */
export async function categorizableFacts(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, { transfer: boolean; split: boolean; merged: boolean }>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query<{ id: string; transfer: boolean; split: boolean; merged: boolean }>(
    `SELECT id, is_transfer AS transfer, is_split AS split, merged_into IS NOT NULL AS merged
       FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[]) AND rolled_back_at IS NULL`,
    [householdId, ids],
  );
  return new Map(rows.map((r) => [r.id, { transfer: r.transfer, split: r.split, merged: r.merged }]));
}

/**
 * What module merchants reads of the space's transactions (BUD-14@PoC FR 1, FR 2): the counterparty — the bank's
 * description as received, or as the user typed it — of each existing transaction of `ids` (hidden ones too). Missing
 * ids are absent; a transaction without a counterparty maps to null.
 */
export async function counterpartiesOf(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query<{ id: string; counterparty: string | null }>(
    `SELECT id, counterparty FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[])`,
    [householdId, ids],
  );
  return new Map(rows.map((r) => [r.id, r.counterparty]));
}

/**
 * BUD-14@PoC FR 3 («Об'єднати з…»): every distinct counterparty of the space's shown transactions with how many have
 * it. Read only.
 */
export async function counterpartyCounts(
  q: ModuleQueryRunner,
  householdId: string,
): Promise<{ readonly counterparty: string; readonly count: number }[]> {
  const { rows } = await q.query<{ counterparty: string; count: string }>(
    `SELECT counterparty, count(*) AS count FROM transactions
      WHERE household_id = $1 AND counterparty IS NOT NULL AND NOT hidden
      GROUP BY counterparty ORDER BY counterparty`,
    [householdId],
  );
  return rows.map((r) => ({ counterparty: r.counterparty, count: Number(r.count) }));
}

/**
 * What module recurring reads of the space's transactions (BUD-07@PoC FR 1): the shown transactions with a counterparty
 * dated `from`…`to` (both included) that are no side of a transfer and were merged into none — either status, entered
 * by hand or imported — newest first, at most `limit`. Read only.
 */
export async function recurringHistory(
  q: ModuleQueryRunner,
  householdId: string,
  query: { readonly from: string; readonly to: string; readonly limit: number },
): Promise<
  {
    readonly id: string;
    readonly accountId: string;
    readonly date: string;
    readonly amount: string;
    readonly currency: string;
    readonly counterparty: string;
  }[]
> {
  const { rows } = await q.query<{
    id: string;
    account_id: string;
    occurred_on: string;
    amount: string;
    currency: string;
    counterparty: string;
  }>(
    `SELECT id, account_id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, amount::text AS amount, currency,
            counterparty
       FROM transactions
      WHERE household_id = $1 AND occurred_on BETWEEN $2::date AND $3::date
        AND counterparty IS NOT NULL AND NOT hidden AND transfer_id IS NULL AND merged_into IS NULL
      ORDER BY occurred_on DESC, id DESC
      LIMIT $4`,
    [householdId, query.from, query.to, query.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.occurred_on,
    amount: r.amount,
    currency: r.currency,
    counterparty: r.counterparty,
  }));
}

/**
 * BUD-07@PoC FR 8 (module recurring, wave 2 row 26): the space's shown transactions in a period — no side of a transfer,
 * merged into none — with or without a counterparty (a charge is matched by its category too), newest first, at most
 * `limit`.
 */
export async function recurringMatching(
  q: ModuleQueryRunner,
  householdId: string,
  query: { readonly from: string; readonly to: string; readonly limit: number },
): Promise<
  {
    readonly id: string;
    readonly accountId: string;
    readonly date: string;
    readonly amount: string;
    readonly currency: string;
    readonly counterparty: string | null;
  }[]
> {
  const { rows } = await q.query<{
    id: string;
    account_id: string;
    occurred_on: string;
    amount: string;
    currency: string;
    counterparty: string | null;
  }>(
    `SELECT id, account_id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, amount::text AS amount, currency,
            counterparty
       FROM transactions
      WHERE household_id = $1 AND occurred_on BETWEEN $2::date AND $3::date
        AND NOT hidden AND transfer_id IS NULL AND merged_into IS NULL
      ORDER BY occurred_on DESC, id DESC
      LIMIT $4`,
    [householdId, query.from, query.to, query.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.occurred_on,
    amount: r.amount,
    currency: r.currency,
    counterparty: r.counterparty,
  }));
}

/**
 * IMP-02@PoC FR 15: of `ids`, the subaccounts a transaction of the space is on — any status, hidden or not, posted to
 * the journal or not yet. Read only.
 */
export async function subaccountsInUse(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query<{ id: string }>(
    `SELECT DISTINCT subaccount_id AS id FROM transactions WHERE household_id = $1 AND subaccount_id = ANY($2::uuid[])`,
    [householdId, ids],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * BUD-13@PoC FR 9 («Вибрано N · Сума ±X €»): the amounts of the selected transactions `ids` of the space by currency
 * and date, for the total at the official rate of each transaction's date (`ListTotals`). Ids of another space or of
 * none are simply not there.
 */
export async function selectionGroups(
  q: ModuleQueryRunner,
  householdId: string,
  ids: readonly string[],
): Promise<AmountGroup[]> {
  const { rows } = await q.query<{ currency: string; date: string; sum: string; count: number }>(
    `SELECT currency, occurred_on::text AS date, sum(amount)::text AS sum, count(*)::int AS count
       FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[])
      GROUP BY currency, occurred_on ORDER BY occurred_on, currency`,
    [householdId, [...ids]],
  );
  return rows.map((r) => ({
    currency: r.currency,
    date: r.date,
    sum: Money.of(r.sum, r.currency),
    count: r.count,
  }));
}

/**
 * BUD-12 FR 2, AC9: how many transactions are in the space's «До розбору» — the counter of «Транзакції» in the side menu
 * and of the tab; shown ones only (a hidden or merged duplicate leaves the queue).
 */
export async function reviewQueueCount(q: ModuleQueryRunner, householdId: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM transactions WHERE household_id = $1 AND review = 'queued' AND NOT hidden`,
    [householdId],
  );
  return rows[0]?.n ?? 0;
}
