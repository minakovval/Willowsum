import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { sealedColumnsPart, type ResealPart } from "../../../../platform/modules/reseal.ts";
import { answersPurpose, historyPurpose } from "../../application/history.ts";
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
    // BUD-21 FR 3, FR 6: a history file's read and the confirmation's answers.
    ...(["parse_sealed", "answers_sealed"] as const).map((column) => ({
      keys: ["batch_id"],
      column,
      select: `SELECT batch_id, batch_file_id, parse_id, ${column} FROM history_parses
                WHERE household_id = $1 AND ${column} IS NOT NULL
                  AND ($2::uuid IS NULL OR batch_id > $2::uuid)
                ORDER BY batch_id LIMIT $3 FOR UPDATE`,
      update: `UPDATE history_parses SET ${column} = $3 WHERE household_id = $1 AND batch_id = $2`,
      count: `SELECT count(*)::text AS n FROM history_parses WHERE household_id = $1 AND ${column} IS NOT NULL`,
      sealedFor: {
        kind: "bytes" as const,
        purpose: (row: Record<string, unknown>) =>
          (column === "parse_sealed" ? historyPurpose : answersPurpose)(
            row["batch_file_id"] as string,
            row["parse_id"] as string,
          ),
      },
    })),
  ]);
}
