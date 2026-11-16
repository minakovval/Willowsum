import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { Tag, TagsTx } from "../../application/index.ts";
import { tagKey } from "../../domain/index.ts";
import { enqueueTagAudit } from "../queue/job.ts";

/**
 * The space's tags (BUD-13@PoC FR 2; migrations/0007_attributes.sql) through the module's own role, in the caller's
 * transactions transaction. The row policy binds the space; SQL filters it too. Lock order: tags in the order of their
 * ids, then transaction rows (application/attributes.ts).
 */
interface TagRow {
  id: string;
  name: string;
  version: number;
}

const tag = (r: TagRow): Tag => ({ id: r.id, name: r.name, version: r.version });

export function tagsTx(q: ModuleQueryRunner): TagsTx {
  return {
    async ensure(householdId, names, newId) {
      const byKey = new Map<string, Tag>();
      if (names.length === 0) return byKey;
      // In the order of the keys, so two requests creating the same new tags never wait on each other in a circle.
      let missing = [...new Map(names.map((n) => [tagKey(n), n])).values()].sort((a, b) =>
        tagKey(a) < tagKey(b) ? -1 : 1,
      );
      // A tag deleted or renamed by another request between the insert and the lock is created again (a few times).
      for (let attempt = 0; missing.length > 0 && attempt < 3; attempt++) {
        for (const name of missing)
          await q.query(
            `INSERT INTO tags (household_id, id, name, name_key) VALUES ($1, $2, $3, $4)
             ON CONFLICT (household_id, name_key) DO NOTHING`,
            [householdId, newId(), name, tagKey(name)],
          );
        const { rows } = await q.query<TagRow & { name_key: string }>(
          `SELECT id, name, name_key, version FROM tags WHERE household_id = $1 AND name_key = ANY($2::text[])
            ORDER BY id FOR SHARE`,
          [householdId, missing.map(tagKey)],
        );
        for (const r of rows) byKey.set(r.name_key, tag(r));
        missing = missing.filter((n) => !byKey.has(tagKey(n)));
      }
      if (missing.length > 0) throw new Error("a tag kept changing while it was attached");
      return byKey;
    },
    async names(householdId, ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await q.query<TagRow>(
        `SELECT id, name, version FROM tags WHERE household_id = $1 AND id = ANY($2::uuid[])`,
        [householdId, [...ids]],
      );
      return new Map(rows.map((r) => [r.id, r.name]));
    },
    async lockTags(householdId, ids) {
      const { rows } = await q.query<TagRow>(
        `SELECT id, name, version FROM tags WHERE household_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [householdId, [...ids]],
      );
      return new Map(rows.map((r) => [r.id, tag(r)]));
    },
    async byKey(householdId, key) {
      const { rows } = await q.query<TagRow>(
        `SELECT id, name, version FROM tags WHERE household_id = $1 AND name_key = $2`,
        [householdId, key],
      );
      return rows[0] ? tag(rows[0]) : null;
    },
    async rename(householdId, id, name, key) {
      const { rows } = await q.query<TagRow>(
        `UPDATE tags SET name = $3, name_key = $4, version = version + 1 WHERE household_id = $1 AND id = $2
         RETURNING id, name, version`,
        [householdId, id, name, key],
      );
      return tag(rows[0]!);
    },
    async retag(householdId, fromId, toId) {
      // The tag replaced in place (or removed), kept once where the transaction had both.
      const { rowCount } = await q.query(
        `UPDATE transactions t
            SET tag_ids = ARRAY(SELECT x.id FROM (
                  SELECT DISTINCT ON (r.id) r.id, r.n
                    FROM unnest(array_replace(t.tag_ids, $2::uuid, $3::uuid)) WITH ORDINALITY AS r(id, n)
                   WHERE r.id IS NOT NULL ORDER BY r.id, r.n) x ORDER BY x.n),
                version = t.version + 1, updated_at = now()
          WHERE t.household_id = $1 AND $2::uuid = ANY(t.tag_ids)`,
        [householdId, fromId, toId],
      );
      return rowCount ?? 0;
    },
    async remove(householdId, id) {
      await q.query(`DELETE FROM tags WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    enqueueTagAudit: (householdId, entry) => enqueueTagAudit({ ...q, householdId }, entry),
  };
}

/** «Теги» of the space (FR 2): each with how many transactions carry it (hidden too, AC6), by name. */
export async function tagsWithCounts(
  q: ModuleQueryRunner,
  householdId: string,
): Promise<{ readonly id: string; readonly name: string; readonly count: number }[]> {
  const { rows } = await q.query<{ id: string; name: string; count: number }>(
    `SELECT g.id, g.name,
            (SELECT count(*)::int FROM transactions t WHERE t.household_id = g.household_id AND g.id = ANY(t.tag_ids))
              AS count
       FROM tags g WHERE g.household_id = $1 ORDER BY g.name_key, g.id`,
    [householdId],
  );
  return rows;
}
