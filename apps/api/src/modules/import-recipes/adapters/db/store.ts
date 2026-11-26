import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { RecipesTx, SpaceTx, StoredRecipe, StoredVersion } from "../../application/index.ts";
import { RECIPE_SCHEMA_VERSION, type Recipe } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

interface RecipeRow {
  household_id: string;
  id: string;
  name: string;
  account_id: string | null;
  version: number;
  schema_version: number;
  recipe: Recipe;
  account_value_sealed: string | null;
  account_value_last4: string | null;
  fingerprint: string | null;
  use_count: number;
  last_used_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  "household_id, id, name, account_id, version, schema_version, recipe, account_value_sealed, account_value_last4, fingerprint, use_count, last_used_at, created_by, created_at, updated_at";

interface VersionRow {
  recipe_id: string;
  version: number;
  name: string;
  account_id: string | null;
  schema_version: number;
  recipe: Recipe;
  account_value_sealed: string | null;
  account_value_last4: string | null;
  fingerprint: string | null;
  saved_by: string;
  saved_at: Date;
}

const VERSION_COLUMNS =
  "recipe_id, version, name, account_id, schema_version, recipe, account_value_sealed, account_value_last4, fingerprint, saved_by, saved_at";

const storedVersion = (r: VersionRow): StoredVersion => ({
  recipeId: r.recipe_id,
  version: r.version,
  name: r.name,
  accountId: r.account_id,
  schemaVersion: r.schema_version,
  recipe: r.recipe,
  accountValueSealed: r.account_value_sealed,
  accountValueLast4: r.account_value_last4,
  fingerprint: r.fingerprint,
  savedBy: r.saved_by,
  savedAt: r.saved_at,
});

const stored = (r: RecipeRow): StoredRecipe => ({
  householdId: r.household_id,
  id: r.id,
  name: r.name,
  accountId: r.account_id,
  version: r.version,
  schemaVersion: r.schema_version,
  recipe: r.recipe,
  accountValueSealed: r.account_value_sealed,
  accountValueLast4: r.account_value_last4,
  fingerprint: r.fingerprint,
  useCount: r.use_count,
  lastUsedAt: r.last_used_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
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
        `INSERT INTO recipes (${COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          h,
          r.id,
          r.name,
          r.accountId,
          r.version,
          r.schemaVersion,
          JSON.stringify(r.recipe),
          r.accountValueSealed,
          r.accountValueLast4,
          r.fingerprint,
          r.useCount,
          r.lastUsedAt,
          r.createdBy,
          r.createdAt,
          r.updatedAt,
        ],
      );
    },
    async update(r, expectedVersion) {
      const { rowCount } = await q.query(
        `UPDATE recipes SET name = $3, account_id = $4, version = $5, schema_version = $6, recipe = $7::jsonb,
           account_value_sealed = $8, account_value_last4 = $9, fingerprint = $10, updated_at = $11
         WHERE household_id = $1 AND id = $2 AND version = $12`,
        [
          h,
          r.id,
          r.name,
          r.accountId,
          r.version,
          r.schemaVersion,
          JSON.stringify(r.recipe),
          r.accountValueSealed,
          r.accountValueLast4,
          r.fingerprint,
          r.updatedAt,
          expectedVersion,
        ],
      );
      return rowCount === 1;
    },
    async nameTaken(name, accountId, exceptId) {
      // At most 100 templates a space: the space's rows are read through its key.
      const { rows } = await q.query(
        `SELECT 1 FROM recipes WHERE household_id = $1 AND lower(name) = lower($2)
           AND account_id IS NOT DISTINCT FROM $3::uuid AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`,
        [h, name, accountId, exceptId ?? null],
      );
      return rows.length > 0;
    },
    async insertVersion(v) {
      await q.query(
        `INSERT INTO recipe_versions (household_id, ${VERSION_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
        [
          h,
          v.recipeId,
          v.version,
          v.name,
          v.accountId,
          v.schemaVersion,
          JSON.stringify(v.recipe),
          v.accountValueSealed,
          v.accountValueLast4,
          v.fingerprint,
          v.savedBy,
          v.savedAt,
        ],
      );
    },
    async pruneVersions(recipeId, upTo) {
      if (upTo < 1) return;
      await q.query(
        `DELETE FROM recipe_versions WHERE household_id = $1 AND recipe_id = $2 AND version <= $3`,
        [h, recipeId, upTo],
      );
    },
    async versions(recipeId, limit) {
      const { rows } = await q.query<VersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM recipe_versions WHERE household_id = $1 AND recipe_id = $2
         ORDER BY version DESC LIMIT $3`,
        [h, recipeId, limit],
      );
      return rows.map(storedVersion);
    },
    async findVersion(recipeId, version) {
      const { rows } = await q.query<VersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM recipe_versions WHERE household_id = $1 AND recipe_id = $2 AND version = $3`,
        [h, recipeId, version],
      );
      return rows[0] ? storedVersion(rows[0]) : null;
    },
    async recordUse(id, parseId, at) {
      await q.query(
        `UPDATE recipes SET use_count = use_count + 1, last_used_at = $4, last_used_parse = $3
         WHERE household_id = $1 AND id = $2 AND last_used_parse IS DISTINCT FROM $3::uuid`,
        [h, id, parseId, at],
      );
    },
    async find(id) {
      const { rows } = await q.query<RecipeRow>(
        `SELECT ${COLUMNS} FROM recipes WHERE household_id = $1 AND id = $2`,
        [h, id],
      );
      return rows[0] ? stored(rows[0]) : null;
    },
    async forFormat(fingerprint, accountId) {
      const { rows } = await q.query<RecipeRow>(
        `SELECT ${COLUMNS} FROM recipes WHERE household_id = $1 AND fingerprint = $2 AND schema_version >= $4
           AND (account_id IS NULL OR account_id = $3::uuid)
         ORDER BY (account_id IS NULL), updated_at DESC, id DESC LIMIT 1`,
        [h, fingerprint, accountId, RECIPE_SCHEMA_VERSION],
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
