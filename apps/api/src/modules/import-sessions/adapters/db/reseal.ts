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
      table: "file_parses",
      keys: ["batch_file_id"],
      column: "rows_sealed",
      sealedFor: {
        kind: "bytes",
        columns: ["batch_file_id", "parse_id"],
        purpose: (row) => parsePurpose(row["batch_file_id"] as string, row["parse_id"] as string),
      },
    },
  ]);
}
