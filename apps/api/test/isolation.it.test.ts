import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generate,
  loadModuleGenerators,
  syntheticHouseholds,
  type SyntheticHousehold,
  type SyntheticRow,
} from "@willowsum/synthetic";
import { HOUSEHOLD_COLUMN } from "../src/platform/db/isolation.ts";
import type { ModuleDatabases, ModuleQueryRunner } from "../src/platform/db/module-db.ts";
import { schemaName } from "../src/platform/modules/rules.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, openRealModules, realModules, realModulesDir } from "./real-modules.ts";

/**
 * ARC-03, criterion «Запит, що повертає дані іншого простору — 0, навіть якщо фільтр у коді забуто;
 * автоматичний тест для кожної таблиці з даними клієнтів». The test finds every table with household_id in
 * every module schema, fills it with synthetic rows of two households (each module registers a generator
 * per table) and queries it as the module's own role without any filter.
 */

const SEED = "arc-03-isolation";
const PER_HOUSEHOLD = 3;
const [householdA, householdB] = syntheticHouseholds(SEED, 2) as [SyntheticHousehold, SyntheticHousehold];

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let tables: { table: string; module: string }[] = [];
/** One more row of household B per table, never loaded: used for a forbidden insert. */
const extraB = new Map<string, SyntheticRow>();
/** Rows loaded per household and table: PER_HOUSEHOLD, or fewer where the table allows fewer. */
const loaded = new Map<string, number>();
const rowsOf = (table: string): number => loaded.get(table) ?? PER_HOUSEHOLD;

const moduleOfSchema = new Map(realModules.map((m) => [schemaName(m), m]));

function insert(client: Pick<ModuleQueryRunner, "query">, table: string, row: SyntheticRow) {
  const columns = Object.keys(row);
  return client.query(
    `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map((c) => row[c]),
  );
}

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  databases = await openRealModules(owner, db.url);
  const { rows } = await owner.query<{ table: string; schema: string }>(
    `SELECT n.nspname || '.' || c.relname AS table, n.nspname AS schema
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = $2 AND NOT a.attisdropped)
      ORDER BY 1`,
    [realModules.map(schemaName), HOUSEHOLD_COLUMN],
  );
  tables = rows.map((r) => ({ table: r.table, module: moduleOfSchema.get(r.schema)! }));
  const generators = await loadModuleGenerators(realModulesDir);
  const missing = tables.filter((t) => !generators.some((g) => g.table === t.table)).map((t) => t.table);
  if (missing.length > 0)
    throw new Error(
      `Customer-data tables need a synthetic generator (<module>/synthetic.ts): ${missing.join(", ")}`,
    );
  // A table that holds at most N rows per household (a space's own record) gets N; one more row is generated
  // for household B and never loaded (the forbidden insert below).
  for (const g of generators)
    if (g.maxPerHousehold !== undefined) loaded.set(g.table, Math.min(PER_HOUSEHOLD, g.maxPerHousehold));
  const counts = Object.fromEntries(tables.map((t) => [t.table, rowsOf(t.table) + 1]));
  const used = generators.filter((g) => g.table in counts);
  const seen = new Map<string, number>();
  // The superuser owner bypasses row policies while loading. One transaction: tables whose rows are only valid
  // together at commit (a ledger entry with its postings) load as the module writes them.
  await owner.query("BEGIN");
  for (const { table, household, row } of generate({ seed: SEED, households: 2, tables: used, counts })) {
    const key = `${table}/${household.index}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n <= rowsOf(table)) await insert(owner, table, row);
    else if (household.id === householdB.id) extraB.set(table, row);
  }
  await owner.query("COMMIT");
});

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

describe("ARC-03 criterion: another household's data — 0 for every customer-data table, even without a code filter", () => {
  it("finds the customer-data tables of every module (the list grows with each module)", () => {
    expect(tables.map((t) => t.table)).toContain("audit.entries");
    expect(tables.map((t) => t.table)).toContain("household.households");
  });

  it("a query without any household filter returns the bound household's rows only", async () => {
    for (const { table, module } of tables) {
      const counts = await databases.for(module).inHousehold(householdA.id, async (q) => {
        const all = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        const other = await q.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${HOUSEHOLD_COLUMN} <> $1`,
          [householdA.id],
        );
        return [all.rows[0]!.n, other.rows[0]!.n];
      });
      expect(counts, table).toEqual([rowsOf(table), 0]);
    }
  });

  it("filtering by another household's id finds nothing (no rows, no counts)", async () => {
    for (const { table, module } of tables) {
      const n = await databases
        .for(module)
        .inHousehold(
          householdA.id,
          async (q) =>
            (
              await q.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM ${table} WHERE ${HOUSEHOLD_COLUMN} = $1`,
                [householdB.id],
              )
            ).rows[0]!.n,
        );
      expect(n, table).toBe(0);
    }
  });

  it("a transaction bound to no household sees no rows at all", async () => {
    for (const { table, module } of tables) {
      const n = await databases
        .for(module)
        .transaction(
          async (q) => (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n,
        );
      expect(n, table).toBe(0);
    }
  });

  it("another household's rows cannot be inserted, changed or deleted", async () => {
    for (const { table, module } of tables) {
      const m = databases.for(module);
      expect(
        await code(m.inHousehold(householdA.id, (q) => insert(q, table, extraB.get(table)!))),
        table,
      ).toBe("42501");
      for (const sql of [
        `UPDATE ${table} SET ${HOUSEHOLD_COLUMN} = ${HOUSEHOLD_COLUMN} WHERE ${HOUSEHOLD_COLUMN} = $1`,
        `DELETE FROM ${table} WHERE ${HOUSEHOLD_COLUMN} = $1`,
      ]) {
        // Either the policy hides the rows (0 changed) or the table refuses the statement (append-only).
        const outcome = await m
          .inHousehold(householdA.id, async (q) => (await q.query(sql, [householdB.id])).rowCount)
          .catch((e: { code?: string }) => e.code);
        expect([0, "42501"], `${table}: ${sql}`).toContain(outcome);
      }
      const left = await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${HOUSEHOLD_COLUMN} = $1`,
        [householdB.id],
      );
      expect(left.rows[0]!.n, table).toBe(rowsOf(table));
    }
  });
});
