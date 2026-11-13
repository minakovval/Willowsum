import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createDataErasure, type DataErasure } from "../src/modules/data-erasure/index.ts";
import { createSpaceKeys } from "../src/modules/household/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { withErasureDatabases } from "../src/platform/db/erasure-db.ts";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { urlAs } from "./db.ts";
import { kms, personWithSpace, rowCount, spaceRows, withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** Security review of PR #143 (NFR-12@PoC FR 3, ADR-0013 option A) on a real PostgreSQL. Synthetic people only. */
let db: RealModulesDatabase;
let dir: string;

beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ws-sec143-"));
  return () => rmSync(dir, { recursive: true, force: true });
});

type Era = Pick<ModuleDatabases, "for">;

function erasure<T>(
  work: (e: DataErasure) => Promise<T>,
  wrap: (era: Era) => Era = (era) => era,
): Promise<T> {
  return withTestErasureDatabases(db, (era) =>
    work(
      createDataErasure({
        databases: db.databases,
        erasureDatabases: wrap(era),
        log: localErasureLog({ dir }),
      }),
    ),
  );
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "error",
  );

describe("sec143: the platform log has an entry before every deletion step", () => {
  // The journal and the space's own log each get a platform entry before they are deleted, so a run that stops after
  // the journal is gone still records that it was deleted (AGENTS.md «Audit»).
  it("the journal and the space's log each get a platform entry written before they are deleted", async () => {
    const person = await personWithSpace(db, "sec143-steps");
    const request = await erasure((e) => e.request({ accountId: person.accountId }));
    // The ledger's erasure pool is down: the run stops at the journal step.
    const broken = (era: Era): Era => ({
      for: (module) =>
        module === "ledger"
          ? ({
              inHousehold: () => Promise.reject(new Error("synthetic ledger outage")),
            } as unknown as ReturnType<Era["for"]>)
          : era.for(module),
    });
    await expect(erasure((e) => e.run(request.requestId), broken)).rejects.toThrow("synthetic ledger outage");
    const audit = createAuditLog(db.databases.for("audit"));
    // Written first: the entry is there although the step itself failed.
    expect(await audit.platformEntriesFor({ type: "ledger.journal", id: person.householdId })).toMatchObject([
      { actorKind: "system", action: "delete" },
    ]);
    await erasure((e) => e.run(request.requestId));
    const logEntries = await audit.platformEntriesFor({ type: "audit.log", id: person.householdId });
    expect(logEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of logEntries) expect(entry).toMatchObject({ actorKind: "system", action: "delete" });
    expect(await rowCount(db, person.householdId)).toBe(0);
  });
});

describe("sec143: nothing of the space is left behind by the daily key task", () => {
  // A rewrap (or provisioning) between the audit step and the key step writes a new entry into the space's own log;
  // the final sweep after the key step removes it, so no row outlives the space.
  it("a rewrap between the log step and the key step leaves no row of the erased space", async () => {
    const person = await personWithSpace(db, "sec143-residue");
    const request = await erasure((e) => e.request({ accountId: person.accountId }));
    const keys = createSpaceKeys(
      db.databases.for("household"),
      createAuditLog(db.databases.for("audit")),
      kms,
    );
    kms.rotate();
    // The daily task runs right after the space's log is erased, before the key step (once).
    let fired = false;
    const racing = (era: Era): Era => ({
      for: (module) => {
        const real = era.for(module);
        if (module !== "audit") return real;
        return {
          inHousehold: async (...args: Parameters<typeof real.inHousehold>) => {
            const out = await real.inHousehold(...args);
            if (!fired) {
              fired = true;
              expect((await keys.rewrapAll()).rewrapped).toBeGreaterThanOrEqual(1);
            }
            return out;
          },
        } as unknown as typeof real;
      },
    });
    await erasure((e) => e.run(request.requestId), racing);
    const left = await spaceRows(db, person.householdId);
    expect(Object.entries(left).filter(([, v]) => !v.startsWith("0:"))).toEqual([]);
  });
});

describe("sec143: ADR-0013 boundaries that had no test", () => {
  it("the superuser cannot TRUNCATE the audit log or the journal", async () => {
    const person = await personWithSpace(db, "sec143-truncate");
    const before = await rowCount(db, person.householdId);
    const outcomes = {
      audit: await code(db.owner.query(`TRUNCATE audit.entries`)),
      platform: await code(db.owner.query(`TRUNCATE audit.platform_entries`)),
      postings: await code(db.owner.query(`TRUNCATE ledger.postings CASCADE`)),
      alerts: await code(db.owner.query(`TRUNCATE ledger.integrity_alerts`)),
    };
    expect(outcomes).toEqual({ audit: "42501", platform: "42501", postings: "42501", alerts: "42501" });
    expect(await rowCount(db, person.householdId)).toBe(before);
  });

  it("an erasure role bound to one space deletes nothing of another, even when it names it", async () => {
    const mine = await personWithSpace(db, "sec143-bound");
    const other = await personWithSpace(db, "sec143-named");
    const otherBefore = await spaceRows(db, other.householdId);
    const outcome = await withTestErasureDatabases(db, async (era) => ({
      ledger: await code(
        era.for("ledger").inHousehold(mine.householdId, async (q) => {
          for (const t of ["postings", "entries", "accounts"])
            await q.query(`DELETE FROM ${t} WHERE household_id = $1`, [other.householdId]);
        }),
      ),
      audit: await code(
        era
          .for("audit")
          .inHousehold(mine.householdId, (q) =>
            q.query(`DELETE FROM entries WHERE household_id = $1`, [other.householdId]),
          ),
      ),
      insert: await code(
        era
          .for("audit")
          .inHousehold(mine.householdId, (q) =>
            q.query(`INSERT INTO entries SELECT * FROM entries WHERE household_id = $1 LIMIT 1`, [
              mine.householdId,
            ]),
          ),
      ),
    }));
    // Deleting a space it is not bound to leaves its own space whole, so the statement trigger refuses it (or it
    // deletes nothing); either way the other space is untouched. INSERT is never granted.
    expect(outcome.insert).toBe("42501");
    expect(await spaceRows(db, other.householdId)).toEqual(otherBefore);
  });

  it("the one-time password works only during the run and is gone afterwards, also after a failure", async () => {
    let seen: { role: string; password: string } | undefined;
    await expect(
      withErasureDatabases(
        {
          admin: db.owner as never,
          connectionAs: (role, password) => {
            seen = { role, password };
            return { connectionString: urlAs(db.url, role, password) };
          },
          context: db.context,
        },
        async (era) => {
          // Make a pool connect, so connectionAs is called.
          await era.for("audit").transaction((q) => q.query(`SELECT 1`));
          throw new Error("synthetic failure");
        },
      ),
    ).rejects.toThrow("synthetic failure");
    expect(seen).toBeDefined();
    const { rows } = await db.owner.query<{ rolname: string; login: boolean; pw: boolean }>(
      `SELECT rolname, rolcanlogin AS login, rolpassword IS NOT NULL AS pw FROM pg_authid
        WHERE rolname LIKE 'ws\\_era\\_%' ORDER BY 1`,
    );
    expect(rows.map((r) => [r.login, r.pw])).toEqual(rows.map(() => [false, false]));
    const client = new pg.Client({ connectionString: urlAs(db.url, seen!.role, seen!.password) });
    await expect(client.connect()).rejects.toThrow();
    await client.end().catch(() => undefined);
  });
});

describe("sec143: the order of a run and the guards the existing tests did not pin", () => {
  it("the account is gone before the journal and the log are erased; the key is still there until the last step", async () => {
    const person = await personWithSpace(db, "sec143-order");
    const request = await erasure((e) => e.request({ accountId: person.accountId }));
    const seen: Record<string, { account: number; key: number }> = {};
    const state = async () => {
      const { rows } = await db.owner.query<{ account: number; key: number }>(
        `SELECT (SELECT count(*)::int FROM identity.accounts WHERE id = $1) AS account,
                (SELECT count(*)::int FROM household.space_keys WHERE household_id = $2) AS key`,
        [person.accountId, person.householdId],
      );
      return rows[0]!;
    };
    const observed = (era: Era): Era => ({
      for: (module) => {
        const real = era.for(module);
        return {
          inHousehold: async (...args: Parameters<typeof real.inHousehold>) => {
            seen[module] ??= await state();
            return real.inHousehold(...args);
          },
        } as unknown as typeof real;
      },
    });
    await erasure((e) => e.run(request.requestId), observed);
    expect(seen).toEqual({ ledger: { account: 0, key: 1 }, audit: { account: 0, key: 1 } });
    expect(await state()).toEqual({ account: 0, key: 0 });
  });

  it("the superuser cannot empty a whole append-only table either (the statement check alone would allow it)", async () => {
    await personWithSpace(db, "sec143-superuser");
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      for (const table of ["audit.entries", "ledger.postings"]) {
        await client.query("BEGIN");
        const outcome = await code(client.query(`DELETE FROM ${table}`));
        await client.query("ROLLBACK");
        expect([table, outcome]).toEqual([table, "42501"]);
      }
    } finally {
      await client.end();
    }
  });

  it("ws_era_audit holds SELECT and DELETE on audit.entries only — never on the platform log", async () => {
    const { rows } = await db.owner.query<{ g: string }>(
      `SELECT table_name || ':' || privilege_type AS g FROM information_schema.role_table_grants
        WHERE grantee = 'ws_era_audit' ORDER BY 1`,
    );
    expect(rows.map((r) => r.g)).toEqual(["entries:DELETE", "entries:SELECT"]);
  });
});
