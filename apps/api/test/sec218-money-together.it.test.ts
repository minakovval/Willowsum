import { randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * Security review of PR #218 (FIN-01@PoC b): the rate date shown, a rate published ahead of its day, and a scoped
 * member who learns nothing (not even that the route answers differently from an absent one).
 * The session is the test's principal header; every name and amount is synthetic.
 */
const WEB = "http://localhost:5173";
/** FIN-01 AC12: «курс НБУ на 2 лист. 2026 р.» — the Kyiv date of this clock is 2026-11-02 (a Monday). */
const NOW = Date.parse("2026-11-02T10:00:00Z");
/** 1 EUR in UAH: 829 680,00 UAH is 18 880,00 € (AC12), to the cent. */
const EUR_UAH = "43.94491";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
let now = NOW;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}
type Principal = { role?: string; scoped?: boolean };
interface MoneyJson {
  amount: string;
  currency: string;
}
interface Converted {
  currency: string;
  amount: MoneyJson;
  equivalent: MoneyJson | null;
  rateDate: string | null;
  approximate: boolean;
}
/** A row of the list as the API answers it (JSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the rows are asserted field by field
type Row = Record<string, any> & { id: string; currencies: Converted[] };

async function newSpace(displayName = "Олена Синтетична"): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown, principal: Principal = {}) {
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

async function create(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2026-11-01", ...body });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

const cash = (name: string, amount: string, currency: string, extra: Record<string, unknown> = {}) => ({
  kind: "current",
  name,
  balance: { amount, currency },
  ...extra,
});

async function summary(space: Space, principal: Principal = {}) {
  const res = await call(space, "GET", "/v1/accounts/summary", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function list(space: Space, query = "", principal: Principal = {}) {
  const res = await call(space, "GET", `/v1/accounts${query}`, undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { items: Row[]; nextCursor: string | null };
}

/** The display value: rounded to cents only here (the API answers unrounded amounts). */
const cents = (m: MoneyJson | null) =>
  m === null ? null : new Decimal(m.amount).toDecimalPlaces(2).toFixed(2);

async function seedRates(rows: [date: string, currency: string, rate: string][]) {
  for (const [d, c, r] of rows)
    await db.owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
      [d, c, r],
    );
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const clock = { now: () => now };
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
          audit,
          clock,
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

beforeEach(async () => {
  off.clear();
  now = NOW;
  await db.owner.query("TRUNCATE fx_rates.rates");
  await seedRates([["2026-11-02", "EUR", EUR_UAH]]);
});

describe("sec218: the NBU rate behind «Гроші разом»", () => {
  it("FIN-01@PoC FR 18: «курс НБУ на <дата>» names the earliest rate date used, not the latest", async () => {
    await seedRates([
      ["2026-10-29", "EUR", "43.90000"],
      ["2026-10-29", "USD", "41.00000"],
    ]);
    const space = await newSpace();
    await create(space, cash("Гривня", "829680.00", "UAH"));
    // USD has no rate on 2026-11-02: its cross rate through the hryvnia is the one of 2026-10-29.
    await create(space, cash("Долари", "100.00", "USD"));
    const s = await summary(space);
    const dates = s.moneyTogether.breakdown.map((b: Converted) => [b.currency, b.rateDate]);
    expect(dates).toEqual(
      expect.arrayContaining([
        ["UAH", "2026-11-02"],
        ["USD", "2026-10-29"],
      ]),
    );
    expect(s.moneyTogether.rate).toEqual({ source: "NBU", date: "2026-10-29" });
  });

  it("VAL-04@PoC: a rate the NBU set for tomorrow is never used for today's balances", async () => {
    // The NBU publishes the next day's rate in the afternoon; it must not reach today's totals.
    await seedRates([["2026-11-03", "EUR", "50.00000"]]);
    const space = await newSpace();
    await create(space, cash("Гривня", "829680.00", "UAH"));
    const s = await summary(space);
    expect(s.moneyTogether.rate).toEqual({ source: "NBU", date: "2026-11-02" });
    expect(cents(s.moneyTogether.total)).toBe("18880.00");
    const row = (await list(space)).items[0]!;
    expect(row.currencies[0]).toMatchObject({ rateDate: "2026-11-02" });
    expect(cents(row.inProfileCurrency.total)).toBe("18880.00");
  });
});

describe("sec218: a scoped member cannot tell the accounts routes from absent ones", () => {
  it("FIN-01@PoC AC10: every query a scoped member can send gets the same 404 body as a switched-off route", async () => {
    const space = await newSpace();
    for (let i = 0; i < 3; i += 1) await create(space, cash(`Рахунок ${i}`, "4321.00", "EUR"));
    const page = await list(space, "?limit=1");
    expect(page.nextCursor).not.toBeNull();
    off.add("accounts.manual");
    const absent = await call(space, "GET", "/v1/accounts/summary");
    expect(absent.statusCode).toBe(404);
    off.clear();
    const urls = [
      "/v1/accounts",
      "/v1/accounts?includeClosed=true",
      "/v1/accounts?group=credit",
      "/v1/accounts?group=cash&includeClosed=false",
      `/v1/accounts?limit=1&cursor=${page.nextCursor}`,
      "/v1/accounts/summary",
    ];
    for (const url of urls)
      for (const role of ["editor", "viewer"]) {
        const res = await call(space, "GET", url, undefined, { role, scoped: true });
        expect(res.statusCode, url).toBe(404);
        expect(res.json(), url).toEqual(absent.json());
        expect(res.headers["x-total-count"], url).toBeUndefined();
      }
  });
});
