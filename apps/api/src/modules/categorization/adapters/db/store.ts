import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type {
  CategorizationTx,
  CategoryHandOff,
  StoredTransactionCategory,
} from "../../application/index.ts";
import type { CategorySource } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/**
 * The categorization schema through the module's own role (migrations/0001_transaction_categories.sql). The row policy
 * binds the space; SQL filters it too.
 */
interface Row {
  transaction_id: string;
  category_id: string | null;
  source: CategorySource;
  version: number;
}

const COLUMNS = `transaction_id, category_id, source, version`;

const stored = (r: Row): StoredTransactionCategory => ({
  transactionId: r.transaction_id,
  categoryId: r.category_id,
  source: r.source,
  version: r.version,
});

export function categorizationTx(q: HouseholdQueryRunner): CategorizationTx {
  return {
    async lock(householdId, transactionId) {
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM transaction_categories
          WHERE household_id = $1 AND transaction_id = $2 FOR UPDATE`,
        [householdId, transactionId],
      );
      return rows[0] ? stored(rows[0]) : null;
    },
    async read(householdId, ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM transaction_categories
          WHERE household_id = $1 AND transaction_id = ANY($2::uuid[])`,
        [householdId, ids],
      );
      return new Map(rows.map((r) => [r.transaction_id, stored(r)]));
    },
    async insert(householdId, transactionId, next) {
      const { rowCount } = await q.query(
        `INSERT INTO transaction_categories (household_id, transaction_id, category_id, source)
         VALUES ($1, $2, $3, $4) ON CONFLICT (household_id, transaction_id) DO NOTHING`,
        [householdId, transactionId, next.categoryId, next.source],
      );
      return (rowCount ?? 0) === 1;
    },
    async update(householdId, transactionId, next, version) {
      await q.query(
        `UPDATE transaction_categories SET category_id = $3, source = $4, version = $5, updated_at = now()
          WHERE household_id = $1 AND transaction_id = $2`,
        [householdId, transactionId, next.categoryId, next.source, version],
      );
    },
    async withCategories(householdId, categoryIds) {
      if (categoryIds.length === 0) return new Map();
      const { rows } = await q.query<{ transaction_id: string; category_id: string }>(
        `SELECT transaction_id, category_id FROM transaction_categories
          WHERE household_id = $1 AND category_id = ANY($2::uuid[])`,
        [householdId, categoryIds],
      );
      return new Map(rows.map((r) => [r.transaction_id, r.category_id]));
    },
    async move(householdId, sourceId, targetId) {
      const { rowCount } = await q.query(
        `UPDATE transaction_categories SET category_id = $3, version = version + 1, updated_at = now()
          WHERE household_id = $1 AND category_id = $2`,
        [householdId, sourceId, targetId],
      );
      return rowCount ?? 0;
    },
    enqueueHandOff: (_householdId, handOff: CategoryHandOff) => enqueueHandOff(q, handOff),
  };
}
