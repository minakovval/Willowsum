import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { defineListQuery } from "../src/platform/http/list-query.ts";
import { ApiProblem } from "../src/platform/http/problem.ts";
import { defineVersionedTable, updateVersioned } from "../src/platform/http/versioned.ts";
import { createTestDatabase } from "./db.ts";
import { householdA, householdB } from "./http.ts";

/**
 * NFR-15 FR 13 and FR 15 on a real PostgreSQL 17: two parallel changes of one record — one applies, the
 * other gets VERSION_CONFLICT with the current version and the changed fields; whitelisted filters run as
 * typed parameters, and a hostile value is only ever a value.
 */
let db: { url: string; drop: () => Promise<void> };
let clients: pg.Client[] = [];

const runner = (client: pg.Client, householdId: string): HouseholdQueryRunner => ({
  householdId,
  query: ((text: string, values?: readonly unknown[]) =>
    client.query(text, values as unknown[])) as HouseholdQueryRunner["query"],
});

const assets = defineVersionedTable({
  table: "assets",
  fields: { name: "name", purchasedOn: "purchased_on", value: "value_amount" },
});

const ID = "5d2f3c1a-8b7e-4c6d-9a0b-1e2f3a4b5c6d";

beforeAll(async () => {
  db = await createTestDatabase();
  clients = [new pg.Client({ connectionString: db.url }), new pg.Client({ connectionString: db.url })];
  for (const c of clients) await c.connect();
  await clients[0]!.query(`
    CREATE TABLE assets (
      household_id uuid NOT NULL,
      id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1,
      name text NOT NULL,
      purchased_on date,
      value_amount numeric(38, 18),
      PRIMARY KEY (household_id, id)
    )`);
  await clients[0]!.query(
    `INSERT INTO assets (household_id, id, name, purchased_on, value_amount) VALUES
     ($1, $3, 'Painting', '2026-01-10', 100), ($1, gen_random_uuid(), 'Wine', '2026-03-01', 20),
     ($2, gen_random_uuid(), 'Other space', '2026-01-10', 5)`,
    [householdA, householdB, ID],
  );
});

afterAll(async () => {
  for (const c of clients) await c.end();
  await db.drop();
});

describe("NFR-15 FR 13: optimistic concurrency on PostgreSQL", () => {
  it("two parallel changes based on version 1: exactly one applies, the other is 409 with the current version and changed fields", async () => {
    const [a, b] = clients.map((c) => runner(c, householdA)) as [HouseholdQueryRunner, HouseholdQueryRunner];
    await clients[0]!.query("BEGIN");
    await clients[1]!.query("BEGIN");
    const first = updateVersioned(a, assets, ID, 1, { name: "Painting (restored)" });
    const second = updateVersioned(b, assets, ID, 1, { name: "Painting, oil", purchasedOn: "2026-01-10" });
    const firstResult = await first;
    // The second waits for the first's row lock; it sees the new version once the first commits.
    await clients[0]!.query("COMMIT");
    const outcome = await second.then(
      () => "applied",
      (error: unknown) => error,
    );
    await clients[1]!.query("ROLLBACK");
    expect(firstResult).toEqual({ version: 2 });
    expect(outcome).toBeInstanceOf(ApiProblem);
    const problem = outcome as ApiProblem;
    expect(problem.code).toBe("VERSION_CONFLICT");
    // Only the name differs from what the second user sent; the date they sent is what is stored.
    expect(problem.extensions).toEqual({ currentVersion: 2, changedFields: ["name"] });
    const { rows } = await clients[0]!.query("SELECT name, version FROM assets WHERE id = $1", [ID]);
    expect(rows).toEqual([{ name: "Painting (restored)", version: 2 }]);
  });

  it("an amount compares as a number, not as text (100 = 100.000000000000000000)", async () => {
    const a = runner(clients[0]!, householdA);
    const problem = await updateVersioned(a, assets, ID, 1, {
      value: "100",
      name: "Painting (restored)",
    }).catch((e: unknown) => e as ApiProblem);
    expect(problem).toBeInstanceOf(ApiProblem);
    expect((problem as ApiProblem).extensions).toEqual({ currentVersion: 2, changedFields: [] });
  });

  it("another space's record is 404 for the caller, not a conflict", async () => {
    const b = runner(clients[0]!, householdB);
    const problem = await updateVersioned(b, assets, ID, 2, { name: "x" }).catch(
      (e: unknown) => e as ApiProblem,
    );
    expect((problem as ApiProblem).code).toBe("NOT_FOUND");
  });
});

const list = defineListQuery({
  filters: {
    name: { column: "name", cast: "text", value: z.string().max(100), operators: ["eq", "ne"] },
    purchasedOn: { column: "purchased_on", cast: "date", value: z.iso.date(), operators: ["gte", "lte"] },
    value: {
      column: "value_amount",
      cast: "numeric",
      value: z.string().regex(/^-?\d{1,20}(\.\d{1,18})?$/),
      operators: ["gt", "lt"],
    },
  },
  sorts: { name: "name", purchasedOn: "purchased_on" },
  defaultSort: { field: "name", direction: "asc" },
});

describe("NFR-15 FR 15: whitelisted filters run as typed parameters on PostgreSQL", () => {
  async function names(input: Parameters<typeof list.compile>[0]): Promise<string[]> {
    const compiled = list.compile(input, 2);
    const { rows } = await clients[0]!.query<{ name: string }>(
      `SELECT name FROM assets WHERE household_id = $1 AND ${compiled.where} ORDER BY ${compiled.orderBy}`,
      [householdA, ...compiled.params],
    );
    return rows.map((r) => r.name);
  }

  it("filters by date and amount with casts, sorts by a whitelisted field", async () => {
    expect(await names({ filter: "purchasedOn.gte:2026-02-01" })).toEqual(["Wine"]);
    expect(await names({ filter: "value.gt:50" })).toEqual(["Painting (restored)"]);
    expect(await names({ sort: "-purchasedOn" })).toEqual(["Wine", "Painting (restored)"]);
  });

  it("a hostile text value is only a value: no rows of the other space, no error", async () => {
    expect(await names({ filter: "name.eq:x' OR '1'='1" })).toEqual([]);
    expect(await names({ filter: "name.ne:'; DROP TABLE assets; --" })).toEqual([
      "Painting (restored)",
      "Wine",
    ]);
    const { rows } = await clients[0]!.query("SELECT count(*)::int AS n FROM assets");
    expect(rows[0].n).toBe(3);
  });
});
