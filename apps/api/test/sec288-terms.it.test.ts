import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * FIN-12@PoC FR 4, AC10 (#244 item 7; owner decision 2026-11-13) through the real API on a real PostgreSQL: in
 * «Реквізити» a loan's rate and monthly payment and a credit card's credit limit change, and the new terms apply from
 * the date of the change — the liability's dated history of terms (`liabilities`, migrations/0004_terms_history.sql),
 * with the terms before kept for the dates before. Every name and amount is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const DAY1 = "2026-11-13";
const DAY2 = "2026-11-15";
let now = Date.parse(`${DAY1}T10:00:00Z`);
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let liabilities: Liabilities;
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

const eur = (amount: string) => ({ amount, currency: "EUR" });
const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();
const details = (space: Space, id: string, body: unknown, principal?: { role?: string; scoped?: boolean }) =>
  call(space, "PATCH", `/v1/accounts/${id}/details`, body, principal);

async function createAccount(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2024-10-01", ...body });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const newLoan = (space: Space) =>
  createAccount(space, {
    kind: "loan",
    name: "Автокредит",
    balance: eur("12000.00"),
    annualRate: "9.9",
    monthlyPayment: "310.00",
  });

/** The liability's audit entries of a change of terms (`update`), oldest first. */
async function termsUpdates(space: Space, accountId: string) {
  const liability = await liabilities.forAccount(space.householdId, accountId);
  if (!liability) throw new Error("no liability");
  return (
    await audit.entriesFor(space.householdId, { type: "liabilities.liability", id: liability.id })
  ).filter((e) => e.action === "update");
}

async function historyRows(space: Space): Promise<number> {
  const { rows } = await db.owner.query(
    `SELECT count(*)::int AS n FROM liabilities.liability_terms WHERE household_id = $1`,
    [space.householdId],
  );
  return (rows[0] as { n: number }).n;
}

const rateOf = async (space: Space, id: string, date: string) =>
  (await liabilities.termsOn(space.householdId, id, date))?.annualRate;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit, clock);
  const services = createAccountsServices({
    walletUsage: [],
    ledger: createLedger(db.databases.for("ledger")),
    liabilities,
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

describe("pr288-sec: the dated terms of another space are out of reach in the database", () => {
  it("pr288-sec: the liabilities role in another space's context reads no terms period and cannot write one", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await newLoan(space);
    expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    expect(await historyRows(space)).toBe(2);
    const mod = db.databases.for("liabilities");
    const seen = await mod.inHousehold(
      stranger.householdId,
      async (q) => (await q.query(`SELECT count(*)::int AS n FROM liability_terms`)).rows,
    );
    expect(seen).toEqual([{ n: 0 }]);
    const liability = await liabilities.forAccount(space.householdId, id);
    await expect(
      mod.inHousehold(stranger.householdId, (q) =>
        q.query(
          `INSERT INTO liability_terms (household_id, id, liability_id, valid_from, kind, currency, annual_rate, monthly_payment)
           VALUES ($1, gen_random_uuid(), $2, '2026-11-14', 'loan', 'EUR', 1, 1)`,
          [space.householdId, liability!.id],
        ),
      ),
    ).rejects.toThrow();
    const touched = await mod.inHousehold(
      stranger.householdId,
      async (q) => (await q.query(`UPDATE liability_terms SET annual_rate = 0`)).rowCount,
    );
    expect(touched).toBe(0);
    expect(await historyRows(space)).toBe(2);
  });
});

describe("pr288-sec: the history never goes back in time", () => {
  it("pr288-sec: a clock behind the last change dates the new terms on that change's day, so termsOn of today is the newest", async () => {
    now = Date.parse(`${DAY2}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    now = Date.parse(`${DAY1}T10:00:00Z`);
    expect((await details(space, id, { annualRate: "7.5" })).statusCode).toBe(200);
    const history = await liabilities.termsHistory(space.householdId, id);
    expect(history?.map((p) => [p.validFrom, p.terms.annualRate])).toEqual([
      [null, "9.9"],
      [DAY2, "8.5"],
      [DAY2, "7.5"],
    ]);
    expect(await rateOf(space, id, DAY2)).toBe("7.5");
    expect(await rateOf(space, id, DAY1)).toBe("9.9");
    expect((await view(space, id)).loan.annualRate).toBe("7.5");
  });
});

describe("pr288-sec: values that never reach the history", () => {
  it("pr288-sec: negative, over-precise, over-long, exponent and over-range terms are 400 and write nothing", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const loan = await newLoan(space);
    const card = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("1.00") });
    for (const [account, body] of [
      [loan, { monthlyPayment: "-1.00" }],
      [loan, { monthlyPayment: "1".repeat(21) }],
      [loan, { monthlyPayment: "0.001" }],
      [loan, { annualRate: "-1" }],
      [loan, { annualRate: "100.01" }],
      [loan, { annualRate: "1e1" }],
      [card, { creditLimit: "-0.01" }],
      [card, { creditLimit: "1E3" }],
      [card, { creditLimit: " 100" }],
    ] as const) {
      const res = await details(space, account, body);
      expect([body, res.statusCode]).toEqual([body, 400]);
    }
    expect(await historyRows(space)).toBe(0);
    expect(await termsUpdates(space, loan)).toEqual([]);
  });
});

describe("pr288-sec: the terms' audit entry survives a failed hand-off", () => {
  it("pr288-sec: the audit log down after the terms commit leaves the entry's job in the liabilities queue", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const pending = async () => {
      const { rows } = await db.owner.query(
        `SELECT count(*)::int AS n FROM liabilities.jobs WHERE household_id = $1`,
        [space.householdId],
      );
      return (rows[0] as { n: number }).n;
    };
    const before = await pending();
    const spy = vi.spyOn(audit, "record").mockRejectedValue(new Error("audit down"));
    try {
      expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(await pending()).toBe(before + 1);
    expect(await termsUpdates(space, id)).toEqual([]);
  });
});

describe("pr288-sec: two changes of one liability at once", () => {
  it("pr288-sec: a rate and a payment changed concurrently both stay (the row is locked; no lost update)", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    for (let round = 0; round < 6; round++) {
      const id = await newLoan(space);
      const results = await Promise.all([
        liabilities.changeTerms(space.householdId, {
          actorAccountId: space.accountId,
          accountId: id,
          change: { annualRate: "8.5" },
          validFrom: DAY1,
        }),
        liabilities.changeTerms(space.householdId, {
          actorAccountId: space.accountId,
          accountId: id,
          change: { monthlyPayment: "295.50" },
          validFrom: DAY1,
        }),
      ]);
      expect(results.map((r) => r.kind)).toEqual(["changed", "changed"]);
      const t = await liabilities.forAccount(space.householdId, id);
      expect([round, t?.annualRate, t?.monthlyPayment?.toDecimalString()]).toEqual([round, "8.5", "295.5"]);
    }
  });
});

describe("pr288-sec: the terms' change after the accounts commit is not queued (documented, non-blocking)", () => {
  it("pr288-sec: liabilities down after the accounts commit — 500, the account's own fields stay, the terms do not change and no job will retry them", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const spy = vi.spyOn(liabilities, "changeTerms").mockRejectedValue(new Error("liabilities down"));
    let status: number;
    try {
      status = (await details(space, id, { note: "синтетична", annualRate: "8.5" })).statusCode;
    } finally {
      spy.mockRestore();
    }
    expect(status).toBe(500);
    const after = await view(space, id);
    expect(after.note).toBe("синтетична");
    expect(after.loan.annualRate).toBe("9.9");
    expect(await historyRows(space)).toBe(0);
  });
});

describe("pr288-sec: terms refused after the accounts commit", () => {
  it("pr288-sec: liabilities refusing the terms after the accounts check (a concurrent kind change) answers 400, never 200", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const spy = vi
      .spyOn(liabilities, "changeTerms")
      .mockResolvedValue({ kind: "invalid", issues: [{ field: "monthlyPayment", issue: "not_allowed" }] });
    let res;
    try {
      res = await details(space, id, { monthlyPayment: "280.00" });
    } finally {
      spy.mockRestore();
    }
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "monthlyPayment", issue: "not_allowed" }]);
  });

  it("pr288-sec: before the account's hand-off has registered its liability, a term is 400 «unavailable» and nothing is written", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const spy = vi.spyOn(liabilities, "register").mockRejectedValue(new Error("liabilities down"));
    let id: string;
    try {
      id = await newLoan(space);
    } finally {
      spy.mockRestore();
    }
    const res = await details(space, id, { annualRate: "8.5" });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "annualRate", issue: "unavailable" }]);
    expect(await historyRows(space)).toBe(0);
  });
});
