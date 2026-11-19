import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { RecipesTx, SpaceTx, StoredRecipe } from "../../application/index.ts";
import type { Recipe } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

interface RecipeRow {
  household_id: string;
  id: string;
  name: string;
  schema_version: number;
  recipe: Recipe;
  account_value_sealed: string | null;
  account_value_last4: string | null;
  fingerprint: string | null;
  created_by: string;
  created_at: Date;
}

const COLUMNS =
  "household_id, id, name, schema_version, recipe, account_value_sealed, account_value_last4, fingerprint, created_by, created_at";

const stored = (r: RecipeRow): StoredRecipe => ({
  householdId: r.household_id,
  id: r.id,
  name: r.name,
  schemaVersion: r.schema_version,
  recipe: r.recipe,
  accountValueSealed: r.account_value_sealed,
  accountValueLast4: r.account_value_last4,
  fingerprint: r.fingerprint,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** The recipes of the transaction's space; every statement names the space too (row policies hold it anyway). */
export function recipesTx(q: HouseholdQueryRunner): RecipesTx {
  const h = q.householdId;
  return {
    async lockSpace() {
      await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('import-recipes:' || $1::text, 0))`, [h]);
    },
    async count() {
      const { rows } = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM recipes WHERE household_id = $1`,
        [h],
      );
      return rows[0]?.n ?? 0;
    },
    async insert(r) {
      await q.query(
        `INSERT INTO recipes (${COLUMNS}) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
        [
          h,
          r.id,
          r.name,
          r.schemaVersion,
          JSON.stringify(r.recipe),
          r.accountValueSealed,
          r.accountValueLast4,
          r.fingerprint,
          r.createdBy,
          r.createdAt,
        ],
      );
    },
    async find(id) {
      const { rows } = await q.query<RecipeRow>(
        `SELECT ${COLUMNS} FROM recipes WHERE household_id = $1 AND id = $2`,
        [h, id],
      );
      return rows[0] ? stored(rows[0]) : null;
    },
    async list(limit, after) {
      const { rows } = await q.query<RecipeRow>(
        `SELECT ${COLUMNS} FROM recipes WHERE household_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [h, after?.createdAt ?? null, after?.id ?? null, limit],
      );
      return rows.map(stored);
    },
    async remove(id) {
      const { rows } = await q.query<RecipeRow>(
        `DELETE FROM recipes WHERE household_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
        [h, id],
      );
      return rows[0] ? stored(rows[0]) : null;
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}

/** A transaction of the module's database bound to one space. */
export function spaceTx(db: Pick<ModuleDatabase, "inHousehold">, householdId: string): SpaceTx {
  return (work) => db.inHousehold(householdId, (q) => work(recipesTx(q)));
}
