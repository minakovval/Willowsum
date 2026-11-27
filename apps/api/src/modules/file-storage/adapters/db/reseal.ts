import type { ObjectStorage } from "../../../../platform/adapters/object-storage/index.ts";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { RESEAL_BYTES_BATCH_MAX, type ResealPart } from "../../../../platform/modules/reseal.ts";

/**
 * NFR-01@PoC FR 3, FR 4: the space's stored files (objects sealed for `file:<id>`), sealed again with the space's new
 * data key by the data-key rotation. Each batch locks its files' rows (`FOR UPDATE`) in a transaction of the module's
 * role, so a removal waits; each object is replaced whole (the storage writes aside and renames, or S3 puts the whole
 * object), so a stop leaves every object under one key or the other, and a repeat finds the replaced ones done. An
 * object already gone is left as it is (the file answers «not found» as before). Bytes are never logged.
 */
export function fileStorageResealPart(db: ModuleDatabase, objects: ObjectStorage | undefined): ResealPart {
  return {
    name: "file-storage",
    async count(householdId) {
      const { rows } = await db.inHousehold(householdId, (q) =>
        q.query<{ n: string }>(`SELECT count(*)::text AS n FROM files WHERE household_id = $1`, [
          householdId,
        ]),
      );
      return Number(rows[0]?.n ?? 0);
    },
    async reseal(householdId, resealer, batchSize) {
      const limit = Math.max(1, Math.min(batchSize, RESEAL_BYTES_BATCH_MAX));
      let changed = 0;
      let after: string | null = null;
      do {
        const from: string | null = after;
        const batch: { readonly next: string | null; readonly changed: number } = await db.inHousehold(
          householdId,
          async (q) => {
            const { rows } = await q.query<{ id: string; object_key: string }>(
              `SELECT id, object_key FROM files
                WHERE household_id = $1 ${from === null ? "" : "AND id > $2"}
                ORDER BY id LIMIT ${limit} FOR UPDATE`,
              from === null ? [householdId] : [householdId, from],
            );
            if (rows.length > 0 && !objects)
              throw new Error("The stored files cannot be sealed again without their storage");
            let n = 0;
            for (const row of rows) {
              const sealed = await objects!.get(row.object_key);
              if (!sealed) continue;
              const next = resealer.bytes(`file:${row.id}`, sealed);
              if (next === null) continue;
              await objects!.put(row.object_key, next);
              n += 1;
            }
            return { next: rows.length === limit ? rows[rows.length - 1]!.id : null, changed: n };
          },
        );
        changed += batch.changed;
        after = batch.next;
      } while (after !== null);
      return changed;
    },
  };
}
