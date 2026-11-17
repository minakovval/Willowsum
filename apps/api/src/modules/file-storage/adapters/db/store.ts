import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { FileKind, FilesStore, StoredFile } from "../../application/index.ts";

interface FileRow {
  household_id: string;
  id: string;
  kind: FileKind;
  format: string;
  content_type: string;
  file_name: string;
  size_bytes: string;
  sha256: Buffer;
  object_key: string;
  created_at: Date;
}

const COLUMNS =
  "household_id, id, kind, format, content_type, file_name, size_bytes, sha256, object_key, created_at";

function fromRow(row: FileRow): StoredFile {
  return {
    householdId: row.household_id,
    id: row.id,
    kind: row.kind,
    format: row.format,
    contentType: row.content_type,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256.toString("hex"),
    objectKey: row.object_key,
    createdAt: row.created_at,
  };
}

/**
 * The space-level lock of limits (NFR-15@PoC FR 31): one transaction-scoped advisory lock per space, the key plan
 * limits take too when they arrive (SUB), so every check of a space's limits is serialised with the others.
 */
export const SPACE_LIMITS_LOCK = "space-limits:";

/** The file-storage module's own database (schema `file_storage`), every query bound to one space. */
export function databaseFilesStore(db: ModuleDatabase): FilesStore {
  return {
    inSpace: (householdId, work) =>
      db.inHousehold(householdId, (q) =>
        work({
          async lockSpaceLimits() {
            await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || $2::text, 0))", [
              SPACE_LIMITS_LOCK,
              householdId,
            ]);
          },
          async usedBytes() {
            const { rows } = await q.query<{ used: string }>(
              "SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM files WHERE household_id = $1",
              [householdId],
            );
            return Number(rows[0]!.used);
          },
          async insert(file) {
            await q.query(`INSERT INTO files (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
              householdId,
              file.id,
              file.kind,
              file.format,
              file.contentType,
              file.fileName,
              file.sizeBytes,
              Buffer.from(file.sha256, "hex"),
              file.objectKey,
              file.createdAt,
            ]);
          },
          async find(fileId) {
            if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
            const { rows } = await q.query<FileRow>(
              `SELECT ${COLUMNS} FROM files WHERE household_id = $1 AND id = $2`,
              [householdId, fileId],
            );
            return rows[0] ? fromRow(rows[0]) : null;
          },
          async remove(fileId) {
            const { rowCount } = await q.query("DELETE FROM files WHERE household_id = $1 AND id = $2", [
              householdId,
              fileId,
            ]);
            return (rowCount ?? 0) > 0;
          },
        }),
      ),
  };
}
