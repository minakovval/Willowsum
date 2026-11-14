import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { setupRealModules } from "./real-modules.ts";

/**
 * #222: a test file whose `beforeAll` failed inside `setupRealModules` had nothing to close in `afterAll`, and its
 * database stayed in the cluster (two were found there hours later, each with a failed migration as its only trace).
 */
const compatBefore = process.env["WS_COMPAT_SCHEMA_FROM"];

afterEach(() => {
  if (compatBefore === undefined) delete process.env["WS_COMPAT_SCHEMA_FROM"];
  else process.env["WS_COMPAT_SCHEMA_FROM"] = compatBefore;
});

async function testDatabases(): Promise<string[]> {
  const admin = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'ws\\_it\\_%' ORDER BY 1",
    );
    return rows.map((r) => r.datname);
  } finally {
    await admin.end();
  }
}

describe("integration setup: setupRealModules (#222)", () => {
  it("a setup that fails drops the database it created", async () => {
    const before = await testDatabases();
    // The migrations of «a newer version» (ARC-03 FR 4 compatibility run) that fail: any error of the preparation.
    process.env["WS_COMPAT_SCHEMA_FROM"] = fileURLToPath(
      new URL("./fixtures/failing-migrate", import.meta.url),
    );
    await expect(setupRealModules()).rejects.toThrow();
    expect(await testDatabases()).toEqual(before);
  });
});
