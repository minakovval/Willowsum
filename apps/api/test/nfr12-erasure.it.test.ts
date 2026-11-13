import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createDataErasure, ErasureError, type DataErasure } from "../src/modules/data-erasure/index.ts";
import { createSpaceKeys } from "../src/modules/household/index.ts";
import { erasureLog, localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { kms, personWithSpace, rowCount, spaceRows, withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * NFR-12@PoC FR 3 (with NFR-16@PoC FR 9; ADR-0013 option A) on a real PostgreSQL: a person asks the product owner to
 * delete their account and all its data; the owner records the request (30-day deadline in the erasure log outside
 * the database) and runs it. Everything of the account and its space is gone — the space's key last — the neighbour is
 * untouched, and after a restore from a copy the erasure is applied again. Synthetic people only.
 */
const DAY = 86_400_000;
let db: RealModulesDatabase;
let dir: string;
let t = Date.UTC(2026, 10, 13, 10, 0, 0);

beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ws-erasure-"));
  t += 40 * DAY;
  return () => rmSync(dir, { recursive: true, force: true });
});

function erasure<T>(work: (e: DataErasure) => Promise<T>, log = localErasureLog({ dir })): Promise<T> {
  return withTestErasureDatabases(db, (erasureDatabases) =>
    work(createDataErasure({ databases: db.databases, erasureDatabases, log, now: () => t })),
  );
}

async function accountRows(accountId: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM identity.accounts WHERE id = $1)
          + (SELECT count(*) FROM identity.sessions WHERE account_id = $1)
          + (SELECT count(*) FROM household.account_spaces WHERE account_id = $1) AS n`,
    [accountId],
  );
  return Number(rows[0]!.n);
}

describe("NFR-12@PoC FR 3: erasure on the person's request, through the product owner", () => {
  it("NFR-12@PoC FR 3: the account and all its data are deleted and the space's key destroyed; the neighbour stays", async () => {
    const person = await personWithSpace(db, "subject");
    const neighbour = await personWithSpace(db, "neighbour");
    const neighbourBefore = await spaceRows(db, neighbour.householdId);
    expect(await rowCount(db, person.householdId)).toBeGreaterThan(5);

    const request = await erasure((e) => e.request({ email: person.email.toUpperCase() }));
    expect(request).toMatchObject({
      accountId: person.accountId,
      householdIds: [person.householdId],
      state: "pending",
      requestedAt: new Date(t).toISOString(),
      dueAt: new Date(t + 30 * DAY).toISOString(),
      daysLeft: 30,
    });
    // Recording a request deletes nothing.
    expect(await accountRows(person.accountId)).toBe(3);

    const { key_id: keyId } = (
      await db.owner.query(`SELECT key_id FROM household.space_keys WHERE household_id = $1`, [
        person.householdId,
      ])
    ).rows[0] as { key_id: string };
    const done = await erasure((e) => e.run(request.requestId));
    expect(done).toMatchObject({
      state: "completed",
      overdue: false,
      completedAt: new Date(t).toISOString(),
    });

    // Every table of every module that holds space data, the login directory and the account: nothing left.
    expect(await rowCount(db, person.householdId)).toBe(0);
    expect(await accountRows(person.accountId)).toBe(0);
    // The key is gone with the record; the neighbour keeps everything, its key included.
    expect(await spaceRows(db, neighbour.householdId)).toEqual(neighbourBefore);
    expect(await neighbour.keys.open(neighbour.householdId, "iban", neighbour.sealed)).toBe(
      "UA00 0000 SYNTH",
    );

    // The platform log: the request, the account, the key (first) and the completion — ids only.
    const audit = createAuditLog(db.databases.for("audit"));
    expect(await audit.platformEntriesFor({ type: "household.space-key", id: keyId })).toMatchObject([
      { action: "delete" },
    ]);
    expect(await audit.platformEntriesFor({ type: "identity.account", id: person.accountId })).toMatchObject([
      { action: "delete", changes: [{ field: "reason", after: "erasure-request" }] },
    ]);
    const requestEntries = await audit.platformEntriesFor({
      type: "data-erasure.request",
      id: request.requestId,
    });
    expect(requestEntries.map((e) => e.changes[0]!.after)).toEqual([request.dueAt, "completed"]);
    for (const entry of requestEntries) expect(JSON.stringify(entry)).not.toContain(person.email);

    // The log outside the database holds the request and its completion, ids and times only.
    const records = await localErasureLog({ dir }).records();
    expect(records.map((r) => r.kind)).toEqual(["requested", "completed"]);
    expect(JSON.stringify(records)).not.toContain(person.email);

    // Running it again is harmless.
    await expect(erasure((e) => e.run(request.requestId))).resolves.toMatchObject({ state: "completed" });
  });

  it("NFR-12@PoC FR 3: the 30-day deadline is tracked: pending, days left, overdue after day 30", async () => {
    const person = await personWithSpace(db, "deadline");
    const request = await erasure((e) => e.request({ accountId: person.accountId }));
    // A second request for the same account returns the pending one.
    expect((await erasure((e) => e.request({ email: person.email }))).requestId).toBe(request.requestId);
    t += 29 * DAY;
    expect((await erasure((e) => e.status()))[0]).toMatchObject({
      state: "pending",
      overdue: false,
      daysLeft: 1,
    });
    t += 2 * DAY;
    expect((await erasure((e) => e.status()))[0]).toMatchObject({
      state: "pending",
      overdue: true,
      daysLeft: 0,
    });
    await erasure((e) => e.run(request.requestId));
    expect((await erasure((e) => e.status()))[0]).toMatchObject({ state: "completed", overdue: false });
  });

  it("NFR-16@PoC FR 9: after a restore from an older copy, the erasure is applied again from the log", async () => {
    const person = await personWithSpace(db, "restore");
    // The «copy»: every row of the space and the account as they were before the erasure.
    const copy = await snapshot(person.accountId, person.householdId);
    const request = await erasure((e) => e.request({ accountId: person.accountId }));
    await erasure((e) => e.run(request.requestId));
    expect(await rowCount(db, person.householdId)).toBe(0);

    await restore(copy);
    expect(await rowCount(db, person.householdId)).toBeGreaterThan(5);
    expect(await accountRows(person.accountId)).toBe(3);

    expect(await erasure((e) => e.reapply())).toBe(1);
    expect(await rowCount(db, person.householdId)).toBe(0);
    expect(await accountRows(person.accountId)).toBe(0);
  });

  it("NFR-12@PoC FR 3: without the log nothing is erased (a deployed process until the live log exists)", async () => {
    const person = await personWithSpace(db, "nolog");
    const before = await rowCount(db, person.householdId);
    const live = erasureLog("live", { deployed: true }, () => ({ dir }));
    await expect(erasure((e) => e.request({ accountId: person.accountId }), live)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await rowCount(db, person.householdId)).toBe(before);
    expect(await accountRows(person.accountId)).toBe(3);
  });

  it("NFR-12@PoC FR 3: an unknown account or request is refused and nothing is recorded", async () => {
    await expect(erasure((e) => e.request({ email: "nobody@example.test" }))).rejects.toBeInstanceOf(
      ErasureError,
    );
    await expect(erasure((e) => e.run("6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10"))).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
    expect(await localErasureLog({ dir }).records()).toEqual([]);
  });
});

describe("NFR-12@PoC FR 3: the key is destroyed even when the daily key task runs in between (#141 review)", () => {
  it("NFR-12@PoC FR 3: a `pending:` space provisioned between the read and the lock is still erased without a key", async () => {
    const person = await personWithSpace(db, "race");
    // Back to a space made before keys existed.
    await db.owner.query(`DELETE FROM household.space_keys WHERE household_id = $1`, [person.householdId]);
    await db.owner.query(`UPDATE household.households SET encryption_key_ref = $2 WHERE household_id = $1`, [
      person.householdId,
      `pending:${person.householdId}`,
    ]);
    const keys = createSpaceKeys(
      db.databases.for("household"),
      createAuditLog(db.databases.for("audit")),
      kms,
    );
    // The daily task provisions the key right after the erasure has read the space (the platform entry is written
    // between the read and the locked transaction): the locked re-check sees the new key and starts again.
    const audit = createAuditLog(db.databases.for("audit"));
    let raced = false;
    const racingAudit = {
      ...audit,
      recordPlatform: async (entry: Parameters<typeof audit.recordPlatform>[0]) => {
        const written = await audit.recordPlatform(entry);
        if (!raced && entry.entity.type === "household.space-key") {
          raced = true;
          expect((await keys.rewrapAll()).provisioned).toBeGreaterThanOrEqual(1);
        }
        return written;
      },
    };
    const { createSpaceErasure } = await import("../src/modules/household/index.ts");
    const result = await createSpaceErasure(db.databases.for("household"), racingAudit).eraseSpace(
      person.householdId,
    );
    expect(raced).toBe(true);
    expect(result).toEqual({ keyDestroyed: true });
    const { rows } = await db.owner.query(
      `SELECT (SELECT count(*) FROM household.space_keys WHERE household_id = $1)
            + (SELECT count(*) FROM household.households WHERE household_id = $1) AS n`,
      [person.householdId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

/** Rows of the account and its space as a copy would hold them (superuser, no row policy). */
async function snapshot(accountId: string, householdId: string) {
  const tables = Object.keys(await spaceRows(db, householdId)).filter(
    (t) => t !== "household.account_spaces",
  );
  const out: { table: string; rows: string }[] = [];
  // As JSON written by PostgreSQL itself, so every type (bytea, numeric, timestamptz) comes back exactly.
  const grab = async (table: string, where: string, id: string) => {
    const { rows } = await db.owner.query<{ j: string | null }>(
      `SELECT json_agg(t)::text AS j FROM ${table} t WHERE ${where} = $1`,
      [id],
    );
    if (rows[0]!.j) out.push({ table, rows: rows[0]!.j });
  };
  await grab("identity.accounts", "id", accountId);
  await grab("identity.sessions", "account_id", accountId);
  // Parents before children, as a restore loads them.
  const order = [
    "household.households",
    "household.space_keys",
    "ledger.accounts",
    "ledger.entries",
    "ledger.postings",
  ];
  for (const table of [...order, ...tables.filter((t) => !order.includes(t))])
    await grab(table, "household_id", householdId);
  await grab("household.account_spaces", "space_id", householdId);
  return out;
}

/** Loads a snapshot back past the triggers, as a restore from a copy does (the triggers fire on no restored row). */
async function restore(copy: { table: string; rows: string }[]) {
  await db.owner.query("BEGIN");
  try {
    await db.owner.query("SET LOCAL session_replication_role = replica");
    for (const { table, rows } of copy) {
      // Generated columns are computed again, as a restore does.
      const { rows: columns } = await db.owner.query<{ name: string }>(
        `SELECT quote_ident(attname) AS name FROM pg_attribute
          WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum`,
        [table],
      );
      const list = columns.map((c) => c.name).join(", ");
      await db.owner.query(
        `INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`,
        [rows],
      );
    }
    await db.owner.query("COMMIT");
  } catch (error) {
    await db.owner.query("ROLLBACK");
    throw error;
  }
}
