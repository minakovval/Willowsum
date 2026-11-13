import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditErasure } from "../src/modules/audit/index.ts";
import { createLedgerErasure } from "../src/modules/ledger/index.ts";
import { ERASABLE_MODULES } from "../src/platform/db/erasure-db.ts";
import { assertIsolatedRoles } from "../src/platform/db/migrate.ts";
import { erasureRoleName } from "../src/platform/modules/rules.ts";
import { personWithSpace, rowCount, spaceRows, withTestErasureDatabases } from "./erasure-helpers.ts";
import { realModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ADR-0013 option A (the owner's decision of 2026-11-13) on a real PostgreSQL: the audit log and the journal stay
 * append-only for every role but each module's erasure role, which may delete only a whole space — the one it is
 * bound to — and only while the owner's erasure script lets it log in. UPDATE and TRUNCATE stay refused for everyone.
 */
let db: RealModulesDatabase;

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "error",
  );

beforeAll(async () => {
  db = await setupRealModules(3);
});

afterAll(async () => {
  await db?.close();
});

describe("NFR-12@PoC FR 3 / ADR-0013: only the erasure role empties a space from the append-only tables", () => {
  it("NFR-12@PoC FR 3: the erasure roles delete the whole bound space; the neighbour is untouched", async () => {
    const mine = await personWithSpace(db, "mine");
    const other = await personWithSpace(db, "other");
    const otherBefore = await spaceRows(db, other.householdId);
    const result = await withTestErasureDatabases(db, async (era) => ({
      ledger: await createLedgerErasure(era.for("ledger")).eraseHousehold(mine.householdId),
      audit: await createAuditErasure(era.for("audit")).eraseHousehold(mine.householdId),
    }));
    expect(result.ledger).toMatchObject({ postings: expect.any(Number), entries: 2 });
    expect(result.ledger.postings).toBeGreaterThanOrEqual(2);
    expect(result.audit.entries).toBeGreaterThanOrEqual(2);
    const left = await spaceRows(db, mine.householdId);
    for (const table of ["audit.entries", "ledger.accounts", "ledger.entries", "ledger.postings"])
      expect(left[table]).toBe("0:");
    expect(await spaceRows(db, other.householdId)).toEqual(otherBefore);
  });

  it("NFR-12@PoC FR 3: an erasure role cannot delete part of a space, update or truncate", async () => {
    const person = await personWithSpace(db, "part");
    const before = await rowCount(db, person.householdId);
    const outcomes = await withTestErasureDatabases(db, async (era) => {
      const ledger = era.for("ledger");
      const audit = era.for("audit");
      const inSpace = (d: typeof ledger, sql: string) =>
        code(d.inHousehold(person.householdId, (q) => q.query(sql)));
      return {
        partOfLedger: await inSpace(ledger, `DELETE FROM postings WHERE amount < 100`),
        partOfAudit: await inSpace(audit, `DELETE FROM entries WHERE entity_type = 'household.member'`),
        update: await inSpace(audit, `UPDATE entries SET action = 'update'`),
        truncate: await inSpace(audit, `TRUNCATE entries`),
        otherTable: await inSpace(ledger, `DELETE FROM integrity_alerts`),
        otherModule: await inSpace(audit, `DELETE FROM ledger.postings`),
      };
    });
    expect(outcomes).toEqual({
      partOfLedger: "42501",
      partOfAudit: "42501",
      update: "42501",
      truncate: "42501",
      otherTable: "42501",
      otherModule: "42501",
    });
    expect(await rowCount(db, person.householdId)).toBe(before);
  });

  it("NFR-12@PoC FR 3: unbound, an erasure role sees and deletes nothing", async () => {
    const person = await personWithSpace(db, "unbound");
    const before = await rowCount(db, person.householdId);
    const deleted = await withTestErasureDatabases(db, (era) =>
      era.for("audit").transaction(async (q) => (await q.query(`DELETE FROM entries`)).rowCount),
    );
    expect(deleted).toBe(0);
    expect(await rowCount(db, person.householdId)).toBe(before);
  });

  it("NFR-12@PoC FR 3: module roles, owner roles and the superuser still cannot delete or update the logs", async () => {
    const person = await personWithSpace(db, "others");
    const before = await rowCount(db, person.householdId);
    const asModule = await code(
      db.databases.for("audit").inHousehold(person.householdId, (q) => q.query(`DELETE FROM entries`)),
    );
    const asLedger = await code(
      db.databases.for("ledger").inHousehold(person.householdId, (q) => q.query(`DELETE FROM postings`)),
    );
    const asSuperuser = await code(
      db.owner.query(`DELETE FROM audit.entries WHERE household_id = $1`, [person.householdId]),
    );
    const updateAsSuperuser = await code(
      db.owner.query(`UPDATE ledger.postings SET seq = seq WHERE household_id = $1`, [person.householdId]),
    );
    expect({ asModule, asLedger, asSuperuser, updateAsSuperuser }).toEqual({
      asModule: "42501",
      asLedger: "42501",
      asSuperuser: "42501",
      updateAsSuperuser: "42501",
    });
    expect(await rowCount(db, person.householdId)).toBe(before);
  });

  it("NFR-12@PoC FR 3: the erasure roles log in only during a run and stay plain, isolated roles", async () => {
    const canLogin = async () =>
      (
        await db.owner.query<{ rolname: string; rolcanlogin: boolean }>(
          `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
          [ERASABLE_MODULES.map(erasureRoleName)],
        )
      ).rows;
    expect((await canLogin()).map((r) => r.rolcanlogin)).toEqual([false, false]);
    const during = await withTestErasureDatabases(db, async () => canLogin());
    expect(during.map((r) => r.rolcanlogin)).toEqual([true, true]);
    expect((await canLogin()).map((r) => r.rolcanlogin)).toEqual([false, false]);
    // Also when the run fails.
    await expect(
      withTestErasureDatabases(db, async () => {
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");
    expect((await canLogin()).map((r) => r.rolcanlogin)).toEqual([false, false]);
    // No privileged attribute, no membership, privileges only in their own schema (the boundary check of migrate).
    await expect(assertIsolatedRoles(db.owner as never, realModules)).resolves.toBeUndefined();
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ANY($1)
          AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)`,
      [realModules.map(erasureRoleName)],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("NFR-12@PoC FR 3: an erasure role cannot reach another module's tables", async () => {
    const person = await personWithSpace(db, "reach");
    const outcome = await withTestErasureDatabases(db, (era) =>
      code(
        era
          .for("audit")
          .inHousehold(person.householdId, (q) => q.query(`SELECT * FROM household.households`)),
      ),
    );
    expect(outcome).toBe("42501");
    void randomUUID;
  });
});
