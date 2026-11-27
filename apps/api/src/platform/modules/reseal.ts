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
  /**
   * How many values of the space here `opener` cannot open, nothing written (the check before a replacement begins).
   * Throws when the values cannot be read at all (file-storage without its storage).
   */
  unopenable(householdId: string, opener: Opener, batchSize: number): Promise<number>;
}

/** Opens a value without returning it (the check before a replacement): throws when it does not open. */
export interface Opener {
  field(field: string, sealed: string): void;
  bytes(purpose: string, sealed: Uint8Array): void;
}

/**
 * The `unopenable` of a part from its own walk (`reseal`, not a wrapper of the part): the walk gets a resealer that
 * only opens, counts what does not and answers null for every value, so nothing is written.
 */
export function unopenableVia(walk: ResealPart["reseal"]): ResealPart["unopenable"] {
  return async (householdId, opener, batchSize) => {
    let failed = 0;
    const attempt = (open: () => void): null => {
      try {
        open();
      } catch {
        failed += 1;
      }
      return null;
    };
    await walk(
      householdId,
      {
        field: (field, sealed) => attempt(() => opener.field(field, sealed)),
        bytes: (purpose, sealed) => attempt(() => opener.bytes(purpose, sealed)),
      },
      batchSize,
    );
    return failed;
  };
}

/** Values one transaction of a part seals again, unless the command names another number. */
export const RESEAL_BATCH_SIZE = 100;

/**
 * One sealed column of a module's table: the columns that order its rows within a space (the primary key without
 * `household_id`), and what the value is sealed for — a field name, or a purpose made from the row's own columns.
 * The module writes its three statements as literal SQL (no text is built here; every value is a parameter):
 *   - `select`: `$1` the space, `$2…$(k+1)` the cursor (the last row's keys; all null for the first batch), `$(k+2)`
 *     the limit; returns the keys, the purpose's columns and the sealed column of the space's rows whose value is
 *     not null, after the cursor, in key order, `FOR UPDATE`;
 *   - `update`: `$1` the space, `$2…$(k+1)` the row's keys, `$(k+2)` the new sealed value;
 *   - `count`: `$1` the space; returns `n` (text), the space's rows whose value is not null.
 */
export interface SealedColumn {
  readonly keys: readonly string[];
  readonly column: string;
  readonly select: string;
  readonly update: string;
  readonly count: string;
  readonly sealedFor:
    | { readonly kind: "field"; readonly field: string }
    | {
        readonly kind: "bytes";
        readonly purpose: (row: Readonly<Record<string, unknown>>) => string;
      };
}

/** Byte payloads (up to 32 MiB each) are sealed again a few per transaction, whatever the batch size. */
export const RESEAL_BYTES_BATCH_MAX = 8;

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

/** Every statement of a part is bound to the space and the select locks its rows. */
function checkColumns(columns: readonly SealedColumn[]): void {
  for (const c of columns) {
    const bound = [c.select, c.update, c.count].every((sql) => sql.includes("household_id = $1"));
    if (c.keys.length === 0 || !bound || !c.select.includes("FOR UPDATE"))
      throw new Error("A sealed column's statements are bound to the space and lock what they read");
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
  const { rows } = await q.query(c.select, [householdId, ...(cursor ?? c.keys.map(() => null)), limit]);
  let changed = 0;
  for (const row of rows) {
    const value: unknown = row[c.column];
    const next =
      c.sealedFor.kind === "field"
        ? resealer.field(c.sealedFor.field, value as string)
        : resealer.bytes(c.sealedFor.purpose(row), value as Buffer);
    if (next === null) continue;
    const updated = await q.query(c.update, [householdId, ...c.keys.map((k) => row[k]), next]);
    if (updated.rowCount !== 1) throw new Error("A sealed row changed under its lock");
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
  const reseal: ResealPart["reseal"] = async (householdId, resealer, batchSize) => {
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
  };
  return {
    name,
    reseal,
    unopenable: unopenableVia(reseal),
    async count(householdId) {
      let total = 0;
      for (const c of columns) {
        const { rows } = await db.inHousehold(householdId, (q) =>
          q.query<{ n: string }>(c.count, [householdId]),
        );
        total += Number(rows[0]?.n ?? 0);
      }
      return total;
    },
  };
}
