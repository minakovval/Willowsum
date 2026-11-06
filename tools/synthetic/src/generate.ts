import { Rng } from "./random.ts";
import type { SyntheticHousehold, SyntheticRow, SyntheticTable } from "./define.ts";

export interface GenerateOptions {
  readonly seed: string;
  readonly households: number;
  readonly tables: readonly SyntheticTable[];
  /** Rows per household for a table, instead of its `perHousehold`. */
  readonly counts?: Readonly<Record<string, number>>;
}

export interface GeneratedRow {
  readonly table: string;
  readonly household: SyntheticHousehold;
  readonly row: SyntheticRow;
}

export function syntheticHouseholds(seed: string, count: number): SyntheticHousehold[] {
  const rng = new Rng(`${seed}/households`);
  return Array.from({ length: count }, (_, i) => ({
    id: rng.uuid(),
    index: i + 1,
    name: `Synthetic household ${i + 1}`,
    dataRegion: "eu" as const,
    encryptionKeyRef: `synthetic-key-${String(i + 1).padStart(4, "0")}`,
  }));
}

/**
 * Streams the rows of every table for every household, table by table, deterministically: the same
 * options give the same rows. Nothing is held in memory beyond one row.
 */
export function* generate(options: GenerateOptions): Generator<GeneratedRow> {
  const seen = new Set<string>();
  for (const t of options.tables) {
    if (seen.has(t.table)) throw new Error(`Two synthetic generators for ${t.table}`);
    seen.add(t.table);
  }
  for (const name of Object.keys(options.counts ?? {}))
    if (!seen.has(name)) throw new Error(`No synthetic generator for ${name}`);
  const households = syntheticHouseholds(options.seed, options.households);
  for (const t of [...options.tables].sort((a, b) => (a.table < b.table ? -1 : 1))) {
    const count = options.counts?.[t.table] ?? t.perHousehold;
    for (const household of households) {
      const rng = new Rng(`${options.seed}/${household.index}/${t.table}`);
      let produced = 0;
      for (const row of t.rows({ household, rng, count })) {
        if (row["household_id"] !== undefined && row["household_id"] !== household.id)
          throw new Error(`${t.table}: a row of household ${household.index} names another household`);
        yield { table: t.table, household, row };
        produced++;
      }
      if (produced !== count)
        throw new Error(`${t.table}: produced ${produced} rows for household ${household.index}, expected ${count}`);
    }
  }
}
