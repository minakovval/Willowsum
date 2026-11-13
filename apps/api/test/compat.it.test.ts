import { cpSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createTestDatabase } from "./db.ts";
import { makeTestTmpDir, removeTestTmpDir } from "./tmp-dir.ts";
import { apiDir, migrateRealModules, openRealModules } from "./real-modules.ts";

/**
 * ARC-03 FR 4, criterion «тест "старий код + нова схема" у CI». In CI the module tests of the base version
 * run against a database built by this version's runner and migrations (WS_COMPAT_SCHEMA_FROM, job `api`).
 * Here the same harness is checked in both directions: a newer version that only expands keeps this
 * code working; one that renames a column breaks it, and the harness sees that.
 */

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  delete process.env["WS_COMPAT_SCHEMA_FROM"];
  for (const step of cleanup.splice(0).reverse()) await step();
});

const auditMigrations = path.join(apiDir, "src/modules/audit/adapters/db/migrations");
/** The name of the next audit migration (after the ones this version ships). */
const NEXT = `${String(readdirSync(auditMigrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).length + 1).padStart(4, "0")}_next.sql`;

/** A copy of apps/api with one more audit migration: the «new version». */
function newerVersion(sql: string): string {
  const dir = makeTestTmpDir("compat");
  for (const entry of ["package.json", "module-rules.json", "schema-exemptions.json", "scripts", "src"])
    cpSync(path.join(apiDir, entry), path.join(dir, entry), { recursive: true });
  writeFileSync(path.join(dir, "src/modules/audit/adapters/db/migrations", NEXT), sql);
  cleanup.push(async () => removeTestTmpDir(dir));
  return dir;
}

async function oldCodeRecordsAgainst(newer: string): Promise<void> {
  process.env["WS_COMPAT_SCHEMA_FROM"] = newer;
  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  cleanup.push(async () => {
    await owner.end();
    await db.drop();
  });
  await migrateRealModules(owner, db.url);
  const applied = await owner.query("SELECT 1 FROM platform_migrations.applied WHERE name = $1", [NEXT]);
  expect(applied.rowCount).toBe(1);
  const databases = await openRealModules(owner, db.url, 1);
  cleanup.push(() => databases.end());
  await createAuditLog(databases.for("audit")).record("0b5f0c4e-6a1d-4f7e-9b2c-3d4e5f6a7b81", {
    actor: { kind: "system" },
    channel: "system",
    entity: { type: "audit.check", id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e51" },
    action: "create",
    changes: [],
  });
}

describe("ARC-03 FR 4: old code + new schema", () => {
  it("an expand step (a new nullable column) keeps the previous code working", async () => {
    await expect(
      oldCodeRecordsAgainst(newerVersion("ALTER TABLE entries ADD COLUMN request_id uuid;")),
    ).resolves.toBe(undefined);
  });

  it("a contract step shipped too early (a renamed column) breaks the previous code, and the harness fails", async () => {
    await expect(
      oldCodeRecordsAgainst(newerVersion("ALTER TABLE entries RENAME COLUMN changes TO diff;")),
    ).rejects.toThrow(/column "changes" .*does not exist/);
  });
});
