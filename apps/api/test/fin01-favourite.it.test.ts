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

/**
 * FIN-01@PoC FR 20 (owner decision 2026-11-16, item 2а: the field in PoC) through the real API on a real PostgreSQL:
 * the «Обране» star of an account — `PATCH /v1/accounts/{id}/display` sets and clears it, the account and the list
 * carry `favourite`, each change has an audit entry, a closed account keeps it as a display flag (FIN-12@PoC FR 8).
 * Every name and amount is synthetic; the clock is the test's.
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

const listed = async (space: Space, query = "") =>
  (await call(space, "GET", `/v1/accounts${query}`)).json().items as { id: string; favourite: boolean }[];

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

describe("FIN-01@PoC FR 20: «Обране» on an account", () => {
  it("FIN-01@PoC FR 20: a new account is not in «Обране»; the star sets it and clears it, the account and the list show it, each change has an audit entry", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    const other = await createAccount(space, "Скарбничка");
    expect((await call(space, "GET", `/v1/accounts/${id}`)).json().favourite).toBe(false);
    expect((await listed(space)).map((a) => [a.id, a.favourite])).toEqual([
      [id, false],
      [other, false],
    ]);

    const set = await display(space, id, { favourite: true });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ id, favourite: true, name: "Щоденний" });
    expect((await call(space, "GET", `/v1/accounts/${id}`)).json().favourite).toBe(true);
    // The list keeps the order the accounts were added in; the page puts «Обране» at the top of its group.
    expect((await listed(space)).map((a) => [a.id, a.favourite])).toEqual([
      [id, true],
      [other, false],
    ]);

    const cleared = await display(space, id, { favourite: false });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().favourite).toBe(false);
    expect(await favouriteChanges(space, id)).toEqual([
      { field: "favourite", before: "false", after: "true", masked: false },
      { field: "favourite", before: "true", after: "false", masked: false },
    ]);
    expect(await favouriteChanges(space, other)).toEqual([]);
  });

  it("FIN-01@PoC FR 20: the same value again changes nothing — 200 and no audit entry", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Готівка вдома");
    expect((await display(space, id, { favourite: false })).statusCode).toBe(200);
    expect((await display(space, id, { favourite: true })).statusCode).toBe(200);
    const again = await display(space, id, { favourite: true });
    expect(again.statusCode).toBe(200);
    expect(again.json().favourite).toBe(true);
    expect(await favouriteChanges(space, id)).toHaveLength(1);
  });

  it("FIN-01@PoC FR 20: two simultaneous stars on one account — both answer «in Обране», one change and one audit entry", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    const both = await Promise.all([
      display(space, id, { favourite: true }),
      display(space, id, { favourite: true }),
    ]);
    expect(both.map((r) => [r.statusCode, r.json().favourite])).toEqual([
      [200, true],
      [200, true],
    ]);
    expect(await favouriteChanges(space, id)).toEqual([
      { field: "favourite", before: "false", after: "true", masked: false },
    ]);
  });

  it("FIN-01@PoC FR 20: a closed account keeps its star and can change it — a display flag (FIN-12 FR 8); its other fields stay read-only", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Старий", "0.00");
    expect((await display(space, id, { favourite: true })).statusCode).toBe(200);
    expect(
      (await call(space, "POST", `/v1/accounts/${id}/close`, { closedOn: "2026-11-16" })).statusCode,
    ).toBe(200);
    expect((await listed(space, "?includeClosed=true")).find((a) => a.id === id)?.favourite).toBe(true);
    const cleared = await display(space, id, { favourite: false });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ status: "closed", favourite: false });
    const rename = await call(space, "PATCH", `/v1/accounts/${id}`, { name: "Новий" });
    expect(rename.statusCode).toBe(409);
  });

  it("FIN-01@PoC FR 20: the body is only «favourite» as a boolean — anything else is 400 and nothing changes", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    for (const body of [{}, { favourite: "true" }, { favourite: null }, { favourite: true, name: "Інший" }]) {
      const res = await display(space, id, body);
      expect([body, res.statusCode]).toEqual([body, 400]);
    }
    const view = (await call(space, "GET", `/v1/accounts/${id}`)).json();
    expect(view).toMatchObject({ favourite: false, name: "Щоденний" });
    expect(await favouriteChanges(space, id)).toEqual([]);
  });

  it("FIN-01@PoC FR 20: a viewer and a scoped member cannot star; another space's account is «not found» and tells nothing", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await createAccount(space, "Щоденний", "4417.00");
    for (const principal of [
      { role: "viewer", scoped: false },
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ]) {
      const res = await display(space, id, { favourite: true }, principal);
      expect([principal, res.statusCode]).toEqual([principal, 403]);
      expect(res.body).not.toMatch(/Щоденний|4417/);
    }
    for (const account of [id, randomUUID()]) {
      const res = await display(stranger, account, { favourite: true });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(res.body).not.toMatch(/Щоденний|4417/);
    }
    expect((await call(space, "GET", `/v1/accounts/${id}`)).json().favourite).toBe(false);
    expect(await favouriteChanges(space, id)).toEqual([]);
  });

  it("FIN-01@PoC FR 20: old code + new schema — an account row written without the column is not in «Обране»", async () => {
    const space = await newSpace();
    const id = await createAccount(space, "Щоденний");
    const { rows } = await db.owner.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'accounts' AND table_name = 'accounts' AND column_name = 'favourite'`,
    );
    expect(rows).toEqual([{ column_default: "false", is_nullable: "NO" }]);
    expect((await listed(space)).find((a) => a.id === id)?.favourite).toBe(false);
  });
});
