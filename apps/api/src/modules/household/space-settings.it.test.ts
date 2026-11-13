import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiRoutes, mountApi } from "../../api.ts";
import { buildServer } from "../../platform/process/server.ts";
import { isPublic } from "../../platform/http/route.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog, type AuditLog } from "../audit/index.ts";
import { createHouseholdServices, type HouseholdSpaces } from "./index.ts";

/**
 * ACC-08@PoC FR 2, FR 4, FR 5 and AC5, server side, through the real API on a real PostgreSQL: the space's name for
 * the profile (`GET /v1/space`), renaming by the Owner (`PATCH /v1/space`) with the old and the new name in the space's
 * own audit log, only the session's own space, and exactly one Owner per space. The session is the test's principal
 * header (identity's cookie is covered by first-space.it.test.ts); names and accounts are synthetic.
 */
const WEB = "http://localhost:5173";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
/** Makes the audit log fail while set (a rename must not stay without its entry). */
let auditDown = false;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(displayName: string): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "PATCH",
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url: "/v1/space",
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function nameOf(householdId: string): Promise<string> {
  const { rows } = await db.owner.query(`SELECT name FROM household.households WHERE household_id = $1`, [
    householdId,
  ]);
  return (rows[0] as { name: string }).name;
}

async function renames(householdId: string) {
  const entries = await audit.entriesFor(householdId, { type: "household.space", id: householdId });
  return entries.filter((e) => e.action === "update");
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const flaky: Pick<AuditLog, "record"> = {
    record: async (householdId, entry) => {
      if (auditDown) throw new Error("audit unavailable");
      return audit.record(householdId, entry);
    },
  };
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
        authenticate: testAuthenticate,
        household: createHouseholdServices({ audit: flaky }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  auditDown = false;
});

describe("ACC-08@PoC FR 5: the Owner renames the space in «Налаштування → Простір»", () => {
  it("ACC-08@PoC AC5: «Родина Коваль» → «Коваль і батьки»: the name changes and the log has the old and the new name", async () => {
    const space = await newSpace("Петро Коваль");
    expect(await nameOf(space.householdId)).toBe("Родина Коваль");

    const res = await call(space, "PATCH", { name: "Коваль і батьки" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "Коваль і батьки", dataRegion: "eu" });
    expect(await nameOf(space.householdId)).toBe("Коваль і батьки");

    const entries = await renames(space.householdId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorKind: "user",
      actorId: space.accountId,
      action: "update",
      changes: [{ field: "name", before: "Родина Коваль", after: "Коваль і батьки", masked: false }],
    });
  });

  it("ACC-08@PoC AC5: an empty name or one over 60 characters is not saved (400; name and log unchanged)", async () => {
    const space = await newSpace("Ірина Коваль");
    for (const name of ["", "   ", "Д".repeat(61), "😀".repeat(61), "Коваль\nі батьки"]) {
      const res = await call(space, "PATCH", { name });
      expect(res.statusCode, JSON.stringify(name)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
      // The problem never echoes what was sent.
      expect(res.body).not.toContain("Коваль\\nі");
    }
    expect(await nameOf(space.householdId)).toBe("Родина Коваль");
    expect(await renames(space.householdId)).toEqual([]);

    const sixty = await call(space, "PATCH", { name: `  ${"Д".repeat(60)} ` });
    expect(sixty.statusCode).toBe(200);
    expect(await nameOf(space.householdId)).toBe("Д".repeat(60));
  });

  it("uniqueness is not required: two spaces may have one name; the same name again writes no entry", async () => {
    const a = await newSpace("Андрій Тестовий");
    const b = await newSpace("Богдан Тестовий");
    expect(await nameOf(a.householdId)).toBe(await nameOf(b.householdId));
    expect((await call(a, "PATCH", { name: "Родина Тестовий" })).statusCode).toBe(200);
    expect(await renames(a.householdId)).toEqual([]);
  });

  it.each([["admin"], ["editor"], ["viewer"], ["advisor"]])(
    "a %s may not rename the space (403); the name stays",
    async (role) => {
      const space = await newSpace("Олег Синтетичний");
      const res = await call(space, "PATCH", { name: "Інша назва" }, { role });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await nameOf(space.householdId)).toBe("Родина Синтетичний");
      expect(await renames(space.householdId)).toEqual([]);
    },
  );

  it("a scoped member may not rename the space either (403)", async () => {
    const space = await newSpace("Олег Обмежений");
    const res = await call(space, "PATCH", { name: "Інша назва" }, { role: "viewer", scoped: true });
    expect(res.statusCode).toBe(403);
    expect(await nameOf(space.householdId)).toBe("Родина Обмежений");
  });

  it("a failed audit write leaves the old name: no rename without its entry (П-10)", async () => {
    const space = await newSpace("Галина Аудитна");
    auditDown = true;
    const res = await call(space, "PATCH", { name: "Нова назва" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("audit unavailable");
    auditDown = false;
    expect(await nameOf(space.householdId)).toBe("Родина Аудитна");
    expect(await renames(space.householdId)).toEqual([]);
  });

  it("the flag household.space-settings off: both routes answer 404 as if absent; nothing changes", async () => {
    const space = await newSpace("Вікторія Прапорна");
    off.add("household.space-settings");
    expect((await call(space, "GET")).statusCode).toBe(404);
    expect((await call(space, "PATCH", { name: "Інша назва" })).statusCode).toBe(404);
    expect(await nameOf(space.householdId)).toBe("Родина Прапорна");
  });
});

describe("ACC-08@PoC FR 2: the space's name for the profile, and only the session's own space", () => {
  it("ACC-08@PoC FR 2: GET /v1/space gives the name and region of the session's space", async () => {
    const space = await newSpace("Марта Профільна");
    const res = await call(space, "GET");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "Родина Профільна", dataRegion: "eu" });
  });

  it("renaming space A changes nothing in space B; a space id in the request is ignored (П-5)", async () => {
    const a = await newSpace("Анна Перша");
    const b = await newSpace("Борис Другий");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/space?householdId=${b.householdId}`,
      headers: {
        origin: WEB,
        "content-type": "application/json",
        "x-household-id": b.householdId,
        ...principalHeader({ userId: a.accountId, householdId: a.householdId }),
      },
      payload: JSON.stringify({ name: "Перейменований A", householdId: b.householdId }),
    });
    expect(res.statusCode).toBe(200);
    expect(await nameOf(a.householdId)).toBe("Перейменований A");
    expect(await nameOf(b.householdId)).toBe("Родина Другий");
    expect(await renames(b.householdId)).toEqual([]);
    expect((await call(b, "GET")).json()).toEqual({ name: "Родина Другий", dataRegion: "eu" });
  });
});

describe("ACC-08@PoC FR 4: a space always has exactly one Owner; no transfer of ownership in PoC", () => {
  it("ACC-08@PoC FR 4: the database refuses a second Owner of a space", async () => {
    const space = await newSpace("Оксана Власниця");
    await expect(
      db.owner.query(
        `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'owner')`,
        [randomUUID(), space.householdId],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "account_spaces_one_owner" });
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS owners FROM household.account_spaces WHERE space_id = $1 AND role = 'owner'`,
      [space.householdId],
    );
    expect(rows[0]).toEqual({ owners: 1 });
    // Another role in the same space is still possible (the data model has every role, П-24).
    await db.owner.query(
      `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'viewer')`,
      [randomUUID(), space.householdId],
    );
  });

  it("ACC-08@PoC FR 4: no route of the API transfers ownership (none needs household.transfer)", () => {
    const transfer = apiRoutes.filter(
      (r) => !isPublic(r.access) && "permission" in r.access && r.access.permission === "household.transfer",
    );
    expect(transfer).toEqual([]);
    expect(apiRoutes.map((r) => r.path).filter((p) => /owner|transfer/i.test(p))).toEqual([]);
  });
});
