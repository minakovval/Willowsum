import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticHouseholds } from "@willowsum/synthetic";
import { mountApi } from "../../api.ts";
import { buildServer } from "../../platform/process/server.ts";
import { setupRealModules, realModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { principalHeader, testAuthenticate } from "../../../test/http.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  AUDIT_ENTITY,
  bucketOf,
  createFlagAdminFor,
  createFlagRuntimeFor,
  REFRESH_MS,
  type FlagAdmin,
  type FlagRuntime,
} from "./index.ts";

/**
 * CICD-06 on a real PostgreSQL and the real API: rollout and kill switches stored in the module's schema,
 * changed only through FlagAdmin (each change audited), read by the API's runtime within REFRESH_MS.
 */
const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };
const spaces = syntheticHouseholds("cicd-06-it", 200).map((h) => h.id);
const [testSpace, otherSpace] = spaces as [string, string];

let db: RealModulesDatabase;
let admin: FlagAdmin;
let runtime: FlagRuntime;
let app: ReturnType<typeof buildServer>;
let t = 1_000_000;
const later = () => (t += REFRESH_MS);

const get = (url: string, householdId = otherSpace) =>
  app.inject({ method: "GET", url, headers: principalHeader({ householdId }) });

beforeAll(async () => {
  db = await setupRealModules();
  const audit = createAuditLog(db.databases.for("audit"));
  admin = createFlagAdminFor(db.databases.for("feature-flags"), audit, realModules);
  runtime = createFlagRuntimeFor(db.databases.for("feature-flags"), { now: () => t });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: runtime,
        authenticate: testAuthenticate,
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("CICD-06 FR 1: a new function ships off; the owner enables it for test spaces, then a share, then all", () => {
  it("off by default: the function's routes answer 404 as unknown paths, and /v1/me/features lists nothing for it", async () => {
    const unknown = await get("/v1/no-such-function");
    const res = await get("/v1/me/permissions");
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(unknown.body);
    // household.core gates /v1/me/features too.
    expect((await get("/v1/me/features")).statusCode).toBe(404);
  });

  it("stage «test»: on for marked test spaces only", async () => {
    await admin.setTestHousehold(staff, testSpace, true);
    await admin.setRollout(staff, "household.core", { stage: "test" });
    later();
    expect((await get("/v1/me/permissions", testSpace)).statusCode).toBe(200);
    expect((await get("/v1/me/features", testSpace)).json()).toEqual({ features: ["household.core"] });
    expect((await get("/v1/me/permissions", otherSpace)).statusCode).toBe(404);
  });

  it("stage «share»: on for the spaces in the share by their deterministic bucket, and still for test spaces", async () => {
    await admin.setRollout(staff, "household.core", { stage: "share", percent: 25 });
    later();
    const inShare = spaces.filter((h) => bucketOf("household.core", h) < 25);
    expect(inShare.length).toBeGreaterThan(20);
    for (const h of spaces.slice(1, 60)) {
      const expected = bucketOf("household.core", h) < 25 ? 200 : 404;
      expect((await get("/v1/me/permissions", h)).statusCode, h).toBe(expected);
    }
    expect((await get("/v1/me/permissions", testSpace)).statusCode).toBe(200);
  });

  it("stage «all»: on for every space; the day it was reached is stored (the 30-day rule)", async () => {
    await admin.setRollout(staff, "household.core", { stage: "all" });
    later();
    for (const h of spaces.slice(0, 30)) expect((await get("/v1/me/permissions", h)).statusCode).toBe(200);
    const state = await admin.state();
    const at = state.fullyEnabledAt.get("household.core")!;
    expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(60_000);
    // An operational flag is permanent: the stored full rollout is no reminder for it.
    expect(await admin.overdue(new Date(Date.now() + 40 * 86_400_000))).toEqual([]);
  });

  it("unmarking a test space keeps its history and takes effect at the next refresh", async () => {
    await admin.setRollout(staff, "household.core", { stage: "test" });
    await admin.setTestHousehold(staff, testSpace, false);
    later();
    expect((await get("/v1/me/permissions", testSpace)).statusCode).toBe(404);
    const { rows } = await db.owner.query<{ n: number; open: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE unmarked_at IS NULL)::int AS open
         FROM feature_flags.test_households WHERE household_id = $1`,
      [testSpace],
    );
    expect(rows[0]).toEqual({ n: 1, open: 0 });
    await admin.setRollout(staff, "household.core", { stage: "all" });
    later();
  });
});

describe("CICD-06 FR 3: a module's kill switch makes it «temporarily unavailable» within ≤ 1 minute; the rest works", () => {
  it("switching access-scope off: its route answers 503, feature-flags and platform routes still answer", async () => {
    expect((await get("/v1/me/permissions")).statusCode).toBe(200);
    await admin.setKillSwitch(staff, "access-scope", true);
    later();
    const res = await get("/v1/me/permissions");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE" });
    expect(res.headers["retry-after"]).toBe("60");
    expect((await get("/v1/me/features")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/meta" })).statusCode).toBe(200);
    await admin.setKillSwitch(staff, "access-scope", false);
    later();
    expect((await get("/v1/me/permissions")).statusCode).toBe(200);
  });

  it("a module that does not exist cannot be switched", async () => {
    await expect(admin.setKillSwitch(staff, "no-such-module", true)).rejects.toThrow(/Unknown module/);
  });
});

describe("CICD-06: every change of a flag, a kill switch or a test space is in the audit log (П-10)", () => {
  it("flag changes: one platform entry per change, with stage and share before and after", async () => {
    const { rows } = await db.owner.query<{ id: string }>(
      "SELECT id FROM feature_flags.flags WHERE key = 'household.core'",
    );
    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: AUDIT_ENTITY.flag,
      id: rows[0]!.id,
    });
    expect(entries.map((e) => e.changes.map((c) => `${c.field}:${c.before}→${c.after}`).join(" "))).toEqual([
      "flag:household.core→household.core stage:off→test percent:0→0",
      "flag:household.core→household.core stage:test→share percent:0→25",
      "flag:household.core→household.core stage:share→all percent:25→100",
      "flag:household.core→household.core stage:all→test percent:100→0",
      "flag:household.core→household.core stage:test→all percent:0→100",
    ]);
    expect(entries.every((e) => e.actorKind === "staff" && e.actorId === staff.id)).toBe(true);
  });

  it("kill switch changes are on the platform log; test-space marks in that space's own log", async () => {
    const { rows } = await db.owner.query<{ id: string }>(
      "SELECT id FROM feature_flags.kill_switches WHERE module = 'access-scope'",
    );
    const log = createAuditLog(db.databases.for("audit"));
    const kills = await log.platformEntriesFor({ type: AUDIT_ENTITY.killSwitch, id: rows[0]!.id });
    expect(kills.map((e) => e.changes.map((c) => `${c.field}:${c.after}`).join(" "))).toEqual([
      "module:access-scope disabled:true",
      "module:access-scope disabled:false",
    ]);
    const marks = await log.entriesFor(testSpace, { type: AUDIT_ENTITY.testHousehold, id: testSpace });
    expect(marks.map((e) => e.changes[0]!.after)).toEqual(["true", "false"]);
    expect(await log.entriesFor(otherSpace, { type: AUDIT_ENTITY.testHousehold, id: testSpace })).toEqual([]);
  });

  it("the module's role cannot read another space's test mark, and the flag tables hold no household column", async () => {
    await createFlagAdminFor(
      db.databases.for("feature-flags"),
      createAuditLog(db.databases.for("audit")),
      realModules,
    ).setTestHousehold(staff, testSpace, true);
    const seen = await db.databases
      .for("feature-flags")
      .inHousehold(otherSpace, async (q) => (await q.query("SELECT household_id FROM test_households")).rows);
    expect(seen).toEqual([]);
    const { rows } = await db.owner.query<{ table: string }>(
      `SELECT table_name AS table FROM information_schema.columns
        WHERE table_schema = 'feature_flags' AND column_name = 'household_id'`,
    );
    expect(rows.map((r) => r.table)).toEqual(["test_households"]);
  });
});
