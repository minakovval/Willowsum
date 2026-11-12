import type { Rng } from "./random.ts";

/**
 * A synthetic household (space). There is no household table yet (ACC-08): the household module will
 * register a generator for it that writes these fields. Every value is invented.
 */
export interface SyntheticHousehold {
  readonly id: string;
  /** 1-based position in the generated set. */
  readonly index: number;
  readonly name: string;
  /** ARC-03 FR 3: the data region; only «eu» exists. */
  readonly dataRegion: "eu";
  /** ARC-03 FR 3: reference to the household's own encryption key (a synthetic placeholder, not a key). */
  readonly encryptionKeyRef: string;
}

/** One row: column name → text value as PostgreSQL reads it (COPY), or null. */
export type SyntheticRow = Readonly<Record<string, string | null>>;

export interface SyntheticContext {
  readonly household: SyntheticHousehold;
  /** Seeded by (seed, household, table): adding a table never changes another table's data. */
  readonly rng: Rng;
  readonly count: number;
}

/**
 * A module's generator for one of its tables (`apps/api/src/modules/<module>/synthetic.ts` exports
 * `synthetic: SyntheticTable[]`). `perHousehold` is the volume for tests and staging: ARC-03 FR 6 asks
 * 10 000 assets and 100 000 transactions per household, declared by those modules' generators.
 */
export interface SyntheticTable {
  /** «<schema>.<table>». */
  readonly table: string;
  readonly perHousehold: number;
  /**
   * The most rows one household can hold (a unique key on household_id, e.g. a space's own record): tests that
   * load several rows per household load at most this many.
   */
  readonly maxPerHousehold?: number;
  rows(context: SyntheticContext): Iterable<SyntheticRow>;
}

export function defineSyntheticTable(table: SyntheticTable): SyntheticTable {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table.table))
    throw new Error(`Synthetic table «${table.table}» must be named <schema>.<table>`);
  if (!Number.isInteger(table.perHousehold) || table.perHousehold < 0)
    throw new Error(`${table.table}: perHousehold must be a non-negative integer`);
  if (
    table.maxPerHousehold !== undefined &&
    (!Number.isInteger(table.maxPerHousehold) || table.maxPerHousehold < 1 || table.perHousehold > table.maxPerHousehold)
  )
    throw new Error(`${table.table}: maxPerHousehold must be an integer ≥ 1 and ≥ perHousehold`);
  return table;
}
