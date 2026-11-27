import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { sealedColumnsPart, type ResealPart } from "../../../../platform/modules/reseal.ts";
import { parsePurpose } from "../../application/parse.ts";

/**
 * NFR-01@PoC FR 3: the space's sealed parses (`file_parses.rows_sealed`, purpose `parse:<batch file id><parse id>`), sealed
 * again with the space's new data key by the data-key rotation, a few per transaction (each up to 32 MiB). The parse
 * keeps its id and state.
 */
export function importSessionsResealPart(db: ModuleDatabase): ResealPart {
  return sealedColumnsPart("import-sessions", db, [
    {
      keys: ["batch_file_id"],
      column: "rows_sealed",
      select: `SELECT batch_file_id, parse_id, rows_sealed FROM file_parses
                WHERE household_id = $1 AND rows_sealed IS NOT NULL
                  AND ($2::uuid IS NULL OR batch_file_id > $2::uuid)
                ORDER BY batch_file_id LIMIT $3 FOR UPDATE`,
      update: "UPDATE file_parses SET rows_sealed = $3 WHERE household_id = $1 AND batch_file_id = $2",
      count:
        "SELECT count(*)::text AS n FROM file_parses WHERE household_id = $1 AND rows_sealed IS NOT NULL",
      sealedFor: {
        kind: "bytes",
        purpose: (row) => parsePurpose(row["batch_file_id"] as string, row["parse_id"] as string),
      },
    },
  ]);
}
