import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { publishEvent } from "../../../../platform/queue/index.ts";
import type { CategoriesTx, StoredCategory, StoredGroup } from "../../application/index.ts";
import { categoryMerged } from "../../events.ts";

/** The categories schema through the module's own role (migrations/0001_categories.sql). The row policy binds the space; SQL filters it too. */

const GROUP_COLUMNS = `id, system_key, kind, name, renamed, tone, position, version`;
const CATEGORY_COLUMNS = `id, group_id, kind, system_key, name, renamed, icon, color, essential, state, merged_into,
  position, version`;

interface GroupRow {
  id: string;
  system_key: string | null;
  kind: StoredGroup["kind"];
  name: string;
  renamed: boolean;
  tone: string;
  position: number;
  version: number;
}

interface CategoryRow {
  id: string;
  group_id: string;
  kind: StoredCategory["kind"];
  system_key: string | null;
  name: string;
  renamed: boolean;
  icon: string;
  color: string;
  essential: boolean | null;
  state: StoredCategory["state"];
  merged_into: string | null;
  position: number;
  version: number;
}

const group = (r: GroupRow): StoredGroup => ({
  id: r.id,
  systemKey: r.system_key,
  kind: r.kind,
  name: r.name,
  renamed: r.renamed,
  tone: r.tone,
  position: r.position,
  version: r.version,
});

const category = (r: CategoryRow): StoredCategory => ({
  id: r.id,
  groupId: r.group_id,
  kind: r.kind,
  systemKey: r.system_key,
  name: r.name,
  renamed: r.renamed,
  icon: r.icon,
  color: r.color,
  essential: r.essential,
  state: r.state,
  mergedInto: r.merged_into,
  position: r.position,
  version: r.version,
});

const groupParams = (householdId: string, g: StoredGroup) => [
  householdId,
  g.id,
  g.systemKey,
  g.kind,
  g.name,
  g.renamed,
  g.tone,
  g.position,
  g.version,
];

const categoryParams = (householdId: string, c: StoredCategory) => [
  householdId,
  c.id,
  c.groupId,
  c.kind,
  c.systemKey,
  c.name,
  c.renamed,
  c.icon,
  c.color,
  c.essential,
  c.state,
  c.mergedInto,
  c.position,
  c.version,
];

const INSERT_GROUP = `INSERT INTO category_groups (household_id, ${GROUP_COLUMNS})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
const INSERT_CATEGORY = `INSERT INTO categories (household_id, ${CATEGORY_COLUMNS})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;

export function categoriesTx(q: HouseholdQueryRunner): CategoriesTx {
  const groups = async (text: string, values: unknown[]) =>
    (await q.query<GroupRow>(text, values)).rows.map(group);
  const categories = async (text: string, values: unknown[]) =>
    (await q.query<CategoryRow>(text, values)).rows.map(category);
  return {
    async systemGroupCount(householdId) {
      const { rows } = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM category_groups WHERE household_id = $1 AND system_key IS NOT NULL`,
        [householdId],
      );
      return rows[0]!.n;
    },
    async seed(householdId, newGroups, newCategories) {
      for (const g of newGroups)
        await q.query(`${INSERT_GROUP} ON CONFLICT DO NOTHING`, groupParams(householdId, g));
      let added = 0;
      for (const c of newCategories) {
        const r = await q.query(`${INSERT_CATEGORY} ON CONFLICT DO NOTHING`, categoryParams(householdId, c));
        added += r.rowCount ?? 0;
      }
      return added;
    },
    groups: (householdId) =>
      groups(
        `SELECT ${GROUP_COLUMNS} FROM category_groups WHERE household_id = $1 ORDER BY position, created_at, id`,
        [householdId],
      ),
    categories: (householdId, options) =>
      categories(
        `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = $1${options?.withRetired ? "" : " AND state <> 'retired'"}
          ORDER BY position, created_at, id`,
        [householdId],
      ),
    async group(householdId, id, lock) {
      const rows = await groups(
        `SELECT ${GROUP_COLUMNS} FROM category_groups WHERE household_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
        [householdId, id],
      );
      return rows[0] ?? null;
    },
    async category(householdId, id, lock) {
      const rows = await categories(
        `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
        [householdId, id],
      );
      return rows[0] ?? null;
    },
    async bySystemKey(householdId, key) {
      const rows = await categories(
        `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = $1 AND system_key = $2`,
        [householdId, key],
      );
      return rows[0] ?? null;
    },
    async nameTaken(householdId, name, table, exceptId) {
      const sql =
        table === "groups"
          ? `SELECT 1 FROM category_groups WHERE household_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3`
          : `SELECT 1 FROM categories WHERE household_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3
               AND state <> 'retired'`;
      return (await q.query(sql, [householdId, name, exceptId ?? null])).rows.length > 0;
    },
    async customGroupCount(householdId, kind) {
      const { rows } = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM category_groups WHERE household_id = $1 AND system_key IS NULL AND kind = $2`,
        [householdId, kind],
      );
      return rows[0]!.n;
    },
    async nextPosition(householdId, table, groupId) {
      const { rows } = await q.query<{ n: number }>(
        table === "groups"
          ? `SELECT coalesce(max(position) + 1, 0)::int AS n FROM category_groups
              WHERE household_id = $1 AND kind <> 'service'`
          : `SELECT coalesce(max(position) + 1, 0)::int AS n FROM categories WHERE household_id = $1 AND group_id = $2`,
        table === "groups" ? [householdId] : [householdId, groupId],
      );
      return rows[0]!.n;
    },
    async insertGroup(householdId, g) {
      return (await groups(`${INSERT_GROUP} RETURNING ${GROUP_COLUMNS}`, groupParams(householdId, g)))[0]!;
    },
    async updateGroup(householdId, g) {
      const rows = await groups(
        `UPDATE category_groups SET name = $3, renamed = $4, version = $5, updated_at = now()
          WHERE household_id = $1 AND id = $2 RETURNING ${GROUP_COLUMNS}`,
        [householdId, g.id, g.name, g.renamed, g.version],
      );
      return rows[0]!;
    },
    async insertCategory(householdId, c) {
      return (
        await categories(`${INSERT_CATEGORY} RETURNING ${CATEGORY_COLUMNS}`, categoryParams(householdId, c))
      )[0]!;
    },
    async updateCategory(householdId, c) {
      const rows = await categories(
        `UPDATE categories
            SET name = $3, renamed = $4, icon = $5, color = $6, essential = $7, state = $8, merged_into = $9,
                version = $10, updated_at = now()
          WHERE household_id = $1 AND id = $2 RETURNING ${CATEGORY_COLUMNS}`,
        [
          householdId,
          c.id,
          c.name,
          c.renamed,
          c.icon,
          c.color,
          c.essential,
          c.state,
          c.mergedInto,
          c.version,
        ],
      );
      return rows[0]!;
    },
    async repointMerged(householdId, from, to) {
      const before = await categories(
        `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE household_id = $1 AND merged_into = $2 ORDER BY id FOR UPDATE`,
        [householdId, from],
      );
      const after = await categories(
        `UPDATE categories SET merged_into = $3, version = version + 1, updated_at = now()
          WHERE household_id = $1 AND merged_into = $2 RETURNING ${CATEGORY_COLUMNS}`,
        [householdId, from, to],
      );
      const byId = new Map(after.map((c) => [c.id, c]));
      return before.map((b) => ({ before: b, after: byId.get(b.id)! }));
    },
    async publishMerged(event) {
      await publishEvent(q, categoryMerged, event);
    },
    async mergeTargets(householdId, ids) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT DISTINCT merged_into AS id FROM categories
          WHERE household_id = $1 AND merged_into = ANY($2::uuid[])`,
        [householdId, ids],
      );
      return new Set(rows.map((r) => r.id));
    },
    async deleteCategory(householdId, id) {
      await q.query(`DELETE FROM categories WHERE household_id = $1 AND id = $2 AND system_key IS NULL`, [
        householdId,
        id,
      ]);
    },
  };
}
