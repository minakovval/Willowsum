import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { defineListQuery, filterValue } from "../src/platform/http/list-query.ts";
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
/** A third connection that only reads the lock state of the two above. */
let observer: pg.Client;

const runner = (client: pg.Client, householdId: string): HouseholdQueryRunner => ({
  householdId,
  query: ((text: string, values?: readonly unknown[]) =>
    client.query(text, values as unknown[])) as HouseholdQueryRunner["query"],
});

const assets = defineVersionedTable({
  table: "assets",
  fields: { name: "name", purchasedOn: "purchased_on", value: "value_amount" },
  readable: ["name", "purchasedOn", "value"],
});

const ID = "5d2f3c1a-8b7e-4c6d-9a0b-1e2f3a4b5c6d";
/** The record of the other space: the second pair of parallel changes runs on it. */
const OTHER_ID = "7a1e4b2c-3d5f-4e6a-8b9c-0d1e2f3a4b5c";

beforeAll(async () => {
  db = await createTestDatabase();
  clients = [new pg.Client({ connectionString: db.url }), new pg.Client({ connectionString: db.url })];
  observer = new pg.Client({ connectionString: db.url });
  for (const c of [...clients, observer]) await c.connect();
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
     ($2, $4, 'Other space', '2026-01-10', 5)`,
    [householdA, householdB, ID, OTHER_ID],
  );
});

afterAll(async () => {
  for (const c of [...clients, observer]) await c.end();
  await db.drop();
});

const backendPid = async (client: pg.Client): Promise<number> =>
  (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;

/**
 * Resolves once the statement of backend `waiterPid` is waiting for a lock that the open transaction of
 * backend `holderPid` holds — PostgreSQL's own view of it (`pg_blocking_pids`), read on a third connection.
 * `ended` settles when that statement does: one that ends without ever waiting is an error, not a wait.
 */
async function waitsForLockOf(waiterPid: number, holderPid: number, ended: Promise<unknown>): Promise<void> {
  let over = false;
  void ended.then(() => (over = true));
  for (;;) {
    const { rows } = await observer.query<{ waits: boolean }>(
      "SELECT $2::int = ANY (pg_blocking_pids($1::int)) AS waits",
      [waiterPid, holderPid],
    );
    if (rows[0]!.waits) return;
    if (over) throw new Error("the second change ended without waiting for the first one's row lock");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface ParallelChanges {
  /** Index in `clients` of the connection whose UPDATE takes the row lock first, and of the other one. */
  readonly winner: 0 | 1;
  readonly householdId: string;
  readonly id: string;
  readonly winnerChange: Readonly<Record<string, unknown>>;
  readonly loserChange: Readonly<Record<string, unknown>>;
  /** What both clients read at version 1. */
  readonly base: Readonly<Record<string, unknown>>;
}

/**
 * Two transactions change one record they both read at version 1. The order in which their UPDATEs reach the
 * row is fixed here, not left to the scheduler: the winner's UPDATE has returned (its transaction holds the
 * row lock) before the loser's is sent, and the winner commits only when PostgreSQL reports the loser's
 * UPDATE waiting for that lock. Sent in one tick on two connections instead, either UPDATE could lock the row
 * first, and with the other one first this test waited for a transaction it had not committed yet (#237).
 */
async function parallelChanges(
  p: ParallelChanges,
): Promise<{ applied: { version: number }; outcome: unknown }> {
  const winner = clients[p.winner]!;
  const loser = clients[1 - p.winner]!;
  const [winnerPid, loserPid] = [await backendPid(winner), await backendPid(loser)];
  await winner.query("BEGIN");
  await loser.query("BEGIN");
  try {
    const applied = await updateVersioned(
      runner(winner, p.householdId),
      assets,
      p.id,
      1,
      p.winnerChange,
      p.base,
    );
    // The outcome handler is attached at once: the conflict can arrive while the COMMIT is still awaited, and a
    // rejection without a handler by then is an unhandled error of the run (CI, PR #141).
    const outcome = updateVersioned(
      runner(loser, p.householdId),
      assets,
      p.id,
      1,
      p.loserChange,
      p.base,
    ).then(
      () => "applied" as const,
      (error: unknown) => error,
    );
    // Parallel for the database too: the loser's UPDATE is in flight, blocked by the winner's uncommitted row.
    await waitsForLockOf(loserPid, winnerPid, outcome);
    await winner.query("COMMIT");
    return { applied, outcome: await outcome };
  } finally {
    // Whatever failed above, neither transaction stays open (the lock holder first: that releases the other),
    // so the tests after this one never wait behind it. Outside a transaction ROLLBACK is a no-op.
    await winner.query("ROLLBACK");
    await loser.query("ROLLBACK");
  }
}

describe("NFR-15 FR 13: optimistic concurrency on PostgreSQL", () => {
  it("two parallel changes based on version 1: one applies; the other is 409 naming the field A changed, not the one B sends", async () => {
    // Both read version 1: name «Painting», value 100. A changes the name; B, still on version 1, sends only
    // the value. A's UPDATE reaches the row first.
    const { applied, outcome } = await parallelChanges({
      winner: 0,
      householdId: householdA,
      id: ID,
      winnerChange: { name: "Painting (restored)" },
      loserChange: { value: "250" },
      base: { name: "Painting", value: "100" },
    });
    expect(applied).toEqual({ version: 2 });
    expect(outcome).toBeInstanceOf(ApiProblem);
    const problem = outcome as ApiProblem;
    expect(problem.code).toBe("VERSION_CONFLICT");
    // The field A changed — not the value B is editing, which nobody else touched.
    expect(problem.extensions).toEqual({ currentVersion: 2, changedFields: ["name"] });
    const { rows } = await clients[0]!.query(
      "SELECT name, value_amount::text AS value, version FROM assets WHERE id = $1",
      [ID],
    );
    expect(rows).toEqual([{ name: "Painting (restored)", value: "100.000000000000000000", version: 2 }]);
  });

  it("the same two changes in the other order: B's UPDATE reaches the row first, B applies and A is 409 naming the field B changed", async () => {
    // The mirror of the test above on the other space's record (name «Other space», value 5): now the
    // connection that sends the value locks the row first, and the one that sends the name has to lose.
    const { applied, outcome } = await parallelChanges({
      winner: 1,
      householdId: householdB,
      id: OTHER_ID,
      winnerChange: { value: "250" },
      loserChange: { name: "Other space (renamed)" },
      base: { name: "Other space", value: "5" },
    });
    expect(applied).toEqual({ version: 2 });
    expect(outcome).toBeInstanceOf(ApiProblem);
    const problem = outcome as ApiProblem;
    expect(problem.code).toBe("VERSION_CONFLICT");
    expect(problem.extensions).toEqual({ currentVersion: 2, changedFields: ["value"] });
    const { rows } = await clients[0]!.query(
      "SELECT name, value_amount::text AS value, version FROM assets WHERE id = $1",
      [OTHER_ID],
    );
    expect(rows).toEqual([{ name: "Other space", value: "250.000000000000000000", version: 2 }]);
  });

  it("an amount compares as a number, not as text (100 = 100.000000000000000000)", async () => {
    const a = runner(clients[0]!, householdA);
    const problem = await updateVersioned(
      a,
      assets,
      ID,
      1,
      { name: "x" },
      {
        value: "100",
        name: "Painting (restored)",
      },
    ).catch((e: unknown) => e as ApiProblem);
    expect(problem).toBeInstanceOf(ApiProblem);
    expect((problem as ApiProblem).extensions).toEqual({ currentVersion: 2, changedFields: [] });
  });

  it("another space's record is 404 for the caller, not a conflict", async () => {
    const b = runner(clients[0]!, householdB);
    const problem = await updateVersioned(b, assets, ID, 2, { name: "x" }, {}).catch(
      (e: unknown) => e as ApiProblem,
    );
    expect((problem as ApiProblem).code).toBe("NOT_FOUND");
  });
});

const list = defineListQuery({
  filters: {
    name: { column: "name", cast: "text", value: z.string().max(100), operators: ["eq", "ne"] },
    purchasedOn: {
      column: "purchased_on",
      cast: "date",
      value: filterValue.isoDate(),
      operators: ["gte", "lte"],
    },
    value: { column: "value_amount", cast: "numeric", value: filterValue.decimal(), operators: ["gt", "lt"] },
    version: { column: "version", cast: "integer", value: filterValue.int4(), operators: ["eq", "gte"] },
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

describe("NFR-15 FR 15 (review of PR #86): boundary values reach PostgreSQL only when the column can hold them", () => {
  it("int4 max, the largest NUMERIC(38,18) and a leap day run; one past the range is 400 before any SQL", async () => {
    const compiled = list.compile(
      {
        filter: [
          "version.gte:-2147483648",
          "value.lt:99999999999999999999.999999999999999999",
          "purchasedOn.lte:2024-02-29",
        ],
      },
      2,
    );
    await clients[0]!.query(`SELECT 1 FROM assets WHERE household_id = $1 AND ${compiled.where}`, [
      householdA,
      ...compiled.params,
    ]);
    for (const filter of [
      "version.eq:2147483648",
      "value.gt:123456789012345678901",
      "purchasedOn.lte:2026-02-30",
    ]) {
      const problem = (() => {
        try {
          list.compile({ filter }, 2);
        } catch (error) {
          return error as ApiProblem;
        }
        throw new Error("expected a problem");
      })();
      expect(problem.code, filter).toBe("VALIDATION_FAILED");
    }
  });
});
