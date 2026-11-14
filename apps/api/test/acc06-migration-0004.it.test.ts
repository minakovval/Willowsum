import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/platform/db/migrate.ts";
import { createTestDatabase } from "./db.ts";
import { realModulesDir } from "./real-modules.ts";

/**
 * ACC-06@PoC FR 1: a space created before migration 0004 gets the reporting currency EUR when 0004 is applied (the
 * column default fills existing rows), and keeps its name and data region. The real household migrations are applied
 * in two steps — 0001–0003, a space inserted, then 0004 — on a throw-away database. The space is synthetic.
 */
let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let dir: string;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  dir = mkdtempSync(path.join(tmpdir(), "ws-mig0004-"));
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ACC-06@PoC FR 1: migration 0004 fills the reporting currency of existing spaces", () => {
  it("ACC-06@PoC FR 1: a space inserted after 0001–0003 has EUR once 0004 is applied, its name and region unchanged", async () => {
    const source = path.join(realModulesDir, "household/adapters/db/migrations");
    const target = path.join(dir, "household/adapters/db/migrations");
    mkdirSync(target, { recursive: true });
    const files = readdirSync(source)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.at(3)).toMatch(/^0004_reporting_currency/);
    for (const file of files.slice(0, 3)) cpSync(path.join(source, file), path.join(target, file));

    await migrate(owner, { modules: ["household"], modulesDir: dir });
    const before = await owner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'household' AND table_name = 'households' AND column_name = 'reporting_currency'`,
    );
    expect(before.rowCount).toBe(0);

    const id = randomUUID();
    await owner.query(
      `INSERT INTO household.households (household_id, name, data_region, encryption_key_ref)
       VALUES ($1, 'Родина Міграційна', 'eu', 'synthetic-key')`,
      [id],
    );

    cpSync(path.join(source, files[3]!), path.join(target, files[3]!));
    const result = await migrate(owner, { modules: ["household"], modulesDir: dir });
    expect(result.applied).toEqual([expect.stringContaining("0004_reporting_currency")]);

    const { rows } = await owner.query(
      `SELECT name, data_region, reporting_currency FROM household.households WHERE household_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ name: "Родина Міграційна", data_region: "eu", reporting_currency: "EUR" }]);
  });
});
