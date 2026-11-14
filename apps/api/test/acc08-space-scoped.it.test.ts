import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createHouseholdServices, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ACC-08@PoC FR 2 for a scoped member (#200), through the real API on a real PostgreSQL: `GET /v1/space` needs only
 * `household.data.read`, which a scoped member keeps, so a scoped Editor, Viewer or Advisor reads the name, region and
 * reporting currency of the session's own space, and never another space's. A scoped Owner or Admin is impossible
 * (00-general «Область доступу») and is refused. Names and accounts are synthetic.
 */
const WEB = "http://localhost:5173";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(displayName: string): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function getSpace(space: Space, role: string) {
  return app.inject({
    method: "GET",
    url: "/v1/space",
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, role, scoped: true }),
    },
  });
}

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        household: createHouseholdServices({ audit: createAuditLog(db.databases.for("audit")) }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("ACC-08@PoC FR 2: a scoped member reads the name of its own space", () => {
  it.each([["editor"], ["viewer"], ["advisor"]])(
    "ACC-08@PoC FR 2: a scoped %s gets the name, region and currency of the session's space (200), not another's",
    async (role) => {
      const own = await newSpace("Соломія Обмежена");
      const other = await newSpace("Богдан Сторонній");
      const res = await getSpace(own, role);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ name: "Родина Обмежена", dataRegion: "eu", reportingCurrency: "EUR" });
      expect(res.body).not.toContain("Сторонній");
      const theirs = await getSpace(other, role);
      expect(theirs.json()).toEqual({ name: "Родина Сторонній", dataRegion: "eu", reportingCurrency: "EUR" });
    },
  );

  it.each([["owner"], ["admin"]])(
    "ACC-08@PoC FR 2: a scoped %s cannot exist (Owner and Admin are never scoped), so it reads nothing (403)",
    async (role) => {
      const own = await newSpace("Остап Неможливий");
      const res = await getSpace(own, role);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("Неможливий");
    },
  );
});
