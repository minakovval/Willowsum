import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * FIN-01@PoC FR 4 (wave 2 row 37a, #215), through the real API on a real PostgreSQL: the search of the built-in
 * directory of NBU banks, an account created with a bank picked from it (country «Україна») and with «Інша установа»
 * typed by hand, which leaves the directory as it was. Every name and amount is synthetic.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(displayName = "Олена Синтетична"): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const create = (space: Space, body: unknown, principal: { role?: string; scoped?: boolean } = {}) =>
  call(space, "POST", "/v1/accounts", body, principal);
const banks = (space: Space, query = "", principal: { role?: string; scoped?: boolean } = {}) =>
  call(space, "GET", `/v1/accounts/banks${query}`, undefined, principal);

const account = {
  kind: "current",
  name: "Щоденний",
  balance: { amount: "1000.00", currency: "EUR" },
  balanceDate: "2026-10-01",
};

async function allBanks(space: Space): Promise<{ code: string; name: string; country: string }[]> {
  const out: { code: string; name: string; country: string }[] = [];
  let cursor: string | null = null;
  do {
    const res = await banks(space, `?limit=5${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.statusCode).toBe(200);
    const page = res.json() as { items: typeof out; nextCursor: string | null };
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          ledger: createLedger(db.databases.for("ledger")),
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => off.clear());

describe("FIN-01@PoC FR 4: «Банк або установа» — the directory of NBU banks or «Інша установа»", () => {
  it("FIN-01@PoC AC22: «Приват» finds «ПриватБанк» with the country «Україна»; the account is created with it; «Інша установа» Revolut, Литва, leaves the directory unchanged", async () => {
    const space = await newSpace();
    const before = await allBanks(space);

    const found = await banks(space, `?q=${encodeURIComponent("Приват")}`);
    expect(found.statusCode).toBe(200);
    const page = found.json() as {
      items: { code: string; name: string; country: string }[];
      source: unknown;
    };
    expect(page.items[0]).toEqual({ code: "305299", name: "ПриватБанк", country: "UA" });
    expect(page.source).toMatchObject({ attribution: "Джерело: Національний банк України (bank.gov.ua)" });

    const picked = page.items[0]!;
    const institution = { name: picked.name, country: picked.country };
    const fromDirectory = await create(space, { ...account, institution });
    expect(fromDirectory.statusCode).toBe(201);
    expect(fromDirectory.json().institution).toEqual({ name: "ПриватБанк", country: "UA" });

    const other = await create(space, {
      ...account,
      name: "Подорожі",
      institution: { name: "Revolut", country: "LT" },
    });
    expect(other.statusCode).toBe(201);
    expect(other.json().institution).toEqual({ name: "Revolut", country: "LT" });

    expect((await banks(space, "?q=Revolut")).json().items).toEqual([]);
    expect(await allBanks(space)).toEqual(before);
  });

  it("FIN-01@PoC FR 4: the directory pages through every bank once, each with the country «Україна»", async () => {
    const space = await newSpace();
    const all = await allBanks(space);
    expect(all.length).toBeGreaterThan(5);
    expect(new Set(all.map((b) => b.code)).size).toBe(all.length);
    for (const bank of all) expect(bank.country).toBe("UA");
    expect((await banks(space, "?cursor=bm90LWEtY3Vyc29y")).statusCode).toBe(400);
  });

  it("FIN-01@PoC FR 4: the same right as creating an account — a viewer gets 403; behind the flag accounts.manual", async () => {
    const space = await newSpace();
    expect((await banks(space, "", { role: "viewer" })).statusCode).toBe(403);
    expect((await banks(space, "", { role: "owner" })).statusCode).toBe(200);
    off.add("accounts.manual");
    expect((await banks(space)).statusCode).toBe(404);
  });
});
