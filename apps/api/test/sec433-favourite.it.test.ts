import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";
import { accountsTx } from "../src/modules/accounts/adapters/db/store.ts";

/**
 * Security review of #433 (FIN-01@PoC FR 20, «Обране»), the reviewer's tests: the row lock of `PATCH …/display` proved
 * with a held `FOR UPDATE`, a scoped editor and viewer refused, the two new store calls under the row policy of another
 * space, and malformed input refused before any write. Every name and amount is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const display = (space: Space, id: string, body: unknown, principal?: { role?: string; scoped?: boolean }) =>
  call(space, "PATCH", `/v1/accounts/${id}/display`, body, principal);

async function createAccount(space: Space, name: string, amount = "1250.00"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name,
    balance: { amount, currency: "EUR" },
    balanceDate: "2026-10-01",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** The audit entries of the account that change «Обране», oldest first. */
async function favouriteChanges(space: Space, id: string) {
  return (await audit.entriesFor(space.householdId, { type: "accounts.account", id }))
    .flatMap((e) => e.changes)
    .filter((c) => c.field === "favourite");
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const services = createAccountsServices({
    walletUsage: [],
    pendingPostings: [],
    ledger: createLedger(db.databases.for("ledger")),
    liabilities: createLiabilities(db.databases.for("liabilities"), audit, clock),
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
    audit,
    clock,
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("sec433: «Обране» — the row lock, scope and space isolation of PATCH …/display", () => {
  it("sec433: two stars while the account's row is held by another transaction — one change and one audit entry", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
      await q.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [id]);
      locked();
      await held;
    });
    await isLocked;
    const both = Promise.all([
      display(space, id, { favourite: true }),
      display(space, id, { favourite: true }),
    ]);
    // Both requests wait on the row (with or without their own lock: the UPDATE waits too), then the holder ends.
    for (let i = 0; i < 200; i++) {
      const { rows } = await db.owner.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if ((rows[0] as { n: number }).n >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    const res = await both;
    expect(res.map((r) => [r.statusCode, r.json().favourite])).toEqual([
      [200, true],
      [200, true],
    ]);
    expect(await favouriteChanges(space, id)).toEqual([
      { field: "favourite", before: "false", after: "true", masked: false },
    ]);
  });

  it("sec433: a scoped editor and a scoped viewer cannot star (403), nothing written", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний", "4417.00");
    for (const principal of [
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
      { role: "advisor", scoped: false },
    ]) {
      const res = await display(space, id, { favourite: true }, principal);
      expect([principal, res.statusCode]).toEqual([principal, 403]);
      expect(res.body).not.toMatch(/Щоденний|4417/);
    }
    expect((await call(space, "GET", `/v1/accounts/${id}`)).json().favourite).toBe(false);
    expect(await favouriteChanges(space, id)).toEqual([]);
  });

  it("sec433: the store bound to another space neither locks nor sets the star of this space's account", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await createAccount(space, "Щоденний");
    const asStranger = db.databases.for("accounts");
    expect(
      await asStranger.inHousehold(stranger.householdId, (q) =>
        accountsTx(q).lockAccount(stranger.householdId, id),
      ),
    ).toBeNull();
    expect(
      await asStranger.inHousehold(stranger.householdId, (q) =>
        accountsTx(q).lockAccount(space.householdId, id),
      ),
    ).toBeNull();
    await asStranger.inHousehold(stranger.householdId, (q) =>
      accountsTx(q).setFavourite(space.householdId, id, true),
    );
    const { rows } = await db.owner.query(`SELECT favourite FROM accounts.accounts WHERE id = $1`, [id]);
    expect(rows).toEqual([{ favourite: false }]);
  });

  it("sec433: an unknown account id shape and an oversized body are refused before any write", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    expect((await display(space, "not-a-uuid", { favourite: true })).statusCode).toBe(400);
    const big = await display(space, id, { favourite: true, pad: "x".repeat(2000) });
    expect([400, 413]).toContain(big.statusCode);
    expect(await favouriteChanges(space, id)).toEqual([]);
  });
});
