/**
 * Sealing a space's values again with a new data key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; the replacement of data keys
 * made under the fixed-label test key, scripts/kms-rotate-data-keys.ts). The household module owns the keys and gives
 * a `Resealer` for one space; every module that keeps sealed values of a space gives a `ResealPart` that walks them in
 * batches, each batch in one transaction of the module's own database, and stores what the resealer returns. Types
 * only: modules depend on this file, not on household, so the module rules stay as they are (ARC-01 FR 4).
 */
import type pg from "pg";

/**
 * The space's old and new data keys during one replacement. Each call answers the value sealed with the new key, or
 * null when it already is (a run stopped after the batch that sealed it), so a repeat never seals a value twice. A
 * value neither key opens is `SpaceKeyError` «SEALED_VALUE_INVALID»: the part stops, nothing of that batch changes.
 * The plaintext exists only inside the call; it is never returned, logged or written anywhere.
 */
export interface Resealer {
  /** A `ws1.…` field value sealed for this space and `field` (`SpaceKeys.seal`). */
  field(field: string, sealed: string): string | null;
  /** Bytes sealed for this space and `purpose` (`SpaceKeys.sealBytes`). */
  bytes(purpose: string, sealed: Uint8Array): Buffer | null;
}

/** One module's sealed values of a space. */
export interface ResealPart {
  /** The part's name in the rotation's progress (`space_key_rotations.done_parts`): lower case, e.g. `accounts`. */
  readonly name: string;
  /** How many sealed values the space has here (the dry run). */
  count(householdId: string): Promise<number>;
  /**
   * Seals every value of the space here again through `resealer`, `batchSize` values per transaction; returns how
   * many changed. A value is replaced only if it is still the one that was read. Safe to repeat after a stop.
   */
  reseal(householdId: string, resealer: Resealer, batchSize: number): Promise<number>;
}

/** Values one transaction of a part seals again, unless the command names another number. */
export const RESEAL_BATCH_SIZE = 100;

/**
 * One sealed column of a module's table: the columns that order its rows within a space (the primary key without
 * `household_id`), and what the value is sealed for — a field name, or a purpose made from the row's own columns.
 * Names are the module's constants, never input.
 */
export interface SealedColumn {
  readonly table: string;
  readonly keys: readonly string[];
  readonly column: string;
  readonly sealedFor:
    | { readonly kind: "field"; readonly field: string }
    | {
        readonly kind: "bytes";
        readonly columns: readonly string[];
        readonly purpose: (row: Readonly<Record<string, unknown>>) => string;
      };
}

/** Byte payloads (up to 32 MiB each) are sealed again a few per transaction, whatever the batch size. */
export const RESEAL_BYTES_BATCH_MAX = 8;

const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** A query runner of one space's transaction (`ModuleDatabase.inHousehold`). */
export interface ResealQueries {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** The module's database as a part needs it (`ModuleDatabase`). */
export interface ResealDatabase {
  inHousehold<T>(householdId: string, work: (q: ResealQueries) => Promise<T>): Promise<T>;
}

/** Validates the names of a part's sealed columns (identifiers of the module's own schema). */
function checkColumns(columns: readonly SealedColumn[]): void {
  for (const c of columns) {
    const names = [
      c.table,
      c.column,
      ...c.keys,
      ...(c.sealedFor.kind === "bytes" ? c.sealedFor.columns : []),
    ];
    if (c.keys.length === 0 || !names.every((n) => IDENT_RE.test(n)))
      throw new Error("A sealed column is named by the module's identifiers");
  }
}

/** Seals one batch of a column again, in one transaction; the cursor of the next batch (null: none left). */
async function resealBatch(
  q: ResealQueries,
  householdId: string,
  c: SealedColumn,
  resealer: Resealer,
  limit: number,
  cursor: readonly unknown[] | null,
): Promise<{ readonly next: unknown[] | null; readonly changed: number }> {
  const keyList = c.keys.join(", ");
  const params = c.keys.map((_, i) => `$${i + 2}`).join(", ");
  const extra = c.sealedFor.kind === "bytes" ? c.sealedFor.columns.filter((x) => !c.keys.includes(x)) : [];
  const after = cursor ? `AND (${keyList}) > (${params})` : "";
  const { rows } = await q.query(
    `SELECT ${[...c.keys, ...extra, c.column].join(", ")} FROM ${c.table}
      WHERE household_id = $1 AND ${c.column} IS NOT NULL ${after}
      ORDER BY ${keyList} LIMIT ${limit} FOR UPDATE`,
    [householdId, ...(cursor ?? [])],
  );
  let changed = 0;
  for (const row of rows) {
    const value: unknown = row[c.column];
    const next =
      c.sealedFor.kind === "field"
        ? resealer.field(c.sealedFor.field, value as string)
        : resealer.bytes(c.sealedFor.purpose(row), value as Buffer);
    if (next === null) continue;
    await q.query(
      `UPDATE ${c.table} SET ${c.column} = $${c.keys.length + 2} WHERE household_id = $1 AND (${keyList}) = (${params})`,
      [householdId, ...c.keys.map((k) => row[k]), next],
    );
    changed += 1;
  }
  const last = rows.length === limit ? rows[rows.length - 1] : undefined;
  return { next: last ? c.keys.map((k) => last[k]) : null, changed };
}

/**
 * The part of a module whose sealed values are columns of its own tables: each batch is read in key order under
 * `FOR UPDATE`, sealed again and written in the same transaction of the module's role, bound to the space.
 */
export function sealedColumnsPart(
  name: string,
  db: ResealDatabase,
  columns: readonly SealedColumn[],
): ResealPart {
  checkColumns(columns);
  return {
    name,
    async count(householdId) {
      let total = 0;
      for (const c of columns) {
        const { rows } = await db.inHousehold(householdId, (q) =>
          q.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${c.table} WHERE household_id = $1 AND ${c.column} IS NOT NULL`,
            [householdId],
          ),
        );
        total += Number(rows[0]?.n ?? 0);
      }
      return total;
    },
    async reseal(householdId, resealer, batchSize) {
      let changed = 0;
      for (const c of columns) {
        const limit = Math.max(
          1,
          c.sealedFor.kind === "bytes" ? Math.min(batchSize, RESEAL_BYTES_BATCH_MAX) : batchSize,
        );
        let cursor: unknown[] | null = null;
        do {
          const from: unknown[] | null = cursor;
          const batch: { readonly next: unknown[] | null; readonly changed: number } = await db.inHousehold(
            householdId,
            (q) => resealBatch(q, householdId, c, resealer, limit, from),
          );
          changed += batch.changed;
          cursor = batch.next;
        } while (cursor !== null);
      }
      return changed;
    },
  };
}
