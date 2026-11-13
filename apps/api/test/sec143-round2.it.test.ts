import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataErasure, type DataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { withErasureDatabases } from "../src/platform/db/erasure-db.ts";
import { ERASURE_LOGIN_VALID_MS } from "../src/platform/db/migrate.ts";
import { urlAs } from "./db.ts";
import { personWithSpace, rowCount, withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** Security review of PR #143, round 2 (cf70f44). Synthetic people only. */
let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

const logins = async () =>
  (
    await db.owner.query<{ rolname: string; login: boolean; pw: boolean }>(
      `SELECT rolname, rolcanlogin AS login, rolpassword IS NOT NULL AS pw FROM pg_authid
        WHERE rolname IN ('ws_era_audit', 'ws_era_ledger') ORDER BY 1`,
    )
  ).rows;

describe("sec143 round 2: each erasure role loses its login on its own", () => {
  it("when taking the login from the first role fails, the second still loses it, and the failure is reported", async () => {
    let failed = false;
    const admin = {
      query: (text: string, values?: unknown[]) => {
        if (!failed && /ws_era_audit" NOLOGIN/.test(text)) {
          failed = true;
          return Promise.reject(new Error("synthetic admin failure"));
        }
        return db.owner.query(text, values as never);
      },
      escapeIdentifier: (s: string) => `"${s.replaceAll('"', '""')}"`,
      escapeLiteral: (s: string) => `'${s.replaceAll("'", "''")}'`,
    };
    await expect(
      withErasureDatabases(
        {
          admin: admin as never,
          connectionAs: (role, password) => ({ connectionString: urlAs(db.url, role, password) }),
          context: db.context,
        },
        async () => "done",
      ),
    ).rejects.toThrow("synthetic admin failure");
    expect(failed).toBe(true);
    const after = await logins();
    expect(after.find((r) => r.rolname === "ws_era_ledger")).toMatchObject({ login: false, pw: false });
    // The first role keeps its login only until VALID UNTIL; clean it up for the other tests.
    await db.owner.query(`ALTER ROLE ws_era_audit NOLOGIN PASSWORD NULL`);
  });
});

describe("sec143 round 2: the run-time union of spaces never erases a shared space", () => {
  it("a space that gained a second member after the request is refused at run time, and nothing is erased", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-sec143r2-"));
    try {
      const person = await personWithSpace(db, "sec143r2-shared");
      const erasure = <T>(work: (e: DataErasure) => Promise<T>) =>
        withTestErasureDatabases(db, (erasureDatabases) =>
          work(
            createDataErasure({ databases: db.databases, erasureDatabases, log: localErasureLog({ dir }) }),
          ),
        );
      const request = await erasure((e) => e.request({ accountId: person.accountId }));
      // Someone else joins the space before the owner runs the request.
      await db.owner.query(
        `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'editor')`,
        [randomUUID(), person.householdId],
      );
      const before = await rowCount(db, person.householdId);
      await expect(erasure((e) => e.run(request.requestId))).rejects.toMatchObject({ code: "SPACE_SHARED" });
      expect(await rowCount(db, person.householdId)).toBe(before);
      const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE id = $1`, [
        person.accountId,
      ]);
      expect(rows).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sec143 round 2: VALID UNTIL is set by this run, not left over from an earlier one", () => {
  it("each run sets a fresh expiry about an hour ahead (roles are shared by the cluster, so reset it first)", async () => {
    await db.owner.query(`ALTER ROLE ws_era_audit VALID UNTIL '2000-01-01T00:00:00Z'`);
    await db.owner.query(`ALTER ROLE ws_era_ledger VALID UNTIL '2000-01-01T00:00:00Z'`);
    const startedAt = Date.now();
    const until = await withTestErasureDatabases(db, async () => {
      const { rows } = await db.owner.query<{ until: Date | null }>(
        `SELECT rolvaliduntil AS until FROM pg_roles WHERE rolname IN ('ws_era_audit', 'ws_era_ledger')`,
      );
      return rows.map((r) => r.until?.getTime() ?? 0);
    });
    for (const t of until) {
      expect(t).toBeGreaterThanOrEqual(startedAt + ERASURE_LOGIN_VALID_MS - 60_000);
      expect(t).toBeLessThanOrEqual(Date.now() + ERASURE_LOGIN_VALID_MS);
    }
  });
});
