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

describe("FIN-12@PoC AC10: a loan's rate changed in «Реквізити» applies from the date of the change", () => {
  it("FIN-12@PoC AC10: «Кредит» at 9.9 % and 310.00 € — the rate changed to 8.5 % applies from the day of the change and the account (the «Борги» page) shows 8.5 %; 9.9 % stays for the dates before", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const res = await details(space, id, { annualRate: "8.5" });
    expect(res.statusCode).toBe(200);
    expect(res.json().loan).toEqual(
      expect.objectContaining({ annualRate: "8.5", monthlyPayment: eur("310"), termsMissing: false }),
    );
    expect((await view(space, id)).loan.annualRate).toBe("8.5");

    expect(await rateOf(space, id, "2026-11-12")).toBe("9.9");
    expect(await rateOf(space, id, DAY1)).toBe("8.5");
    const history = await liabilities.termsHistory(space.householdId, id);
    expect(
      history?.map((p) => [p.validFrom, p.terms.annualRate, p.terms.monthlyPayment?.toDecimalString()]),
    ).toEqual([
      [null, "9.9", "310"],
      [DAY1, "8.5", "310"],
    ]);
    const [entry] = await termsUpdates(space, id);
    expect(entry!.changes).toEqual([
      { field: "annualRate", before: "9.9", after: "8.5", masked: false },
      { field: "validFrom", before: null, after: DAY1, masked: false },
    ]);
  });

  it("FIN-12@PoC AC10: a later change of the payment applies from its own day; the rate's change keeps its day", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    now = Date.parse(`${DAY2}T09:00:00Z`);
    const res = await details(space, id, { monthlyPayment: "295.50" });
    expect(res.statusCode).toBe(200);
    expect(res.json().loan.monthlyPayment).toEqual(eur("295.5"));

    const on = async (date: string) => {
      const t = await liabilities.termsOn(space.householdId, id, date);
      return [t?.annualRate, t?.monthlyPayment?.toDecimalString()];
    };
    expect(await on("2026-11-12")).toEqual(["9.9", "310"]);
    expect(await on("2026-11-14")).toEqual(["8.5", "310"]);
    expect(await on(DAY2)).toEqual(["8.5", "295.5"]);
    expect((await termsUpdates(space, id)).map((e) => e.changes)).toEqual([
      [
        { field: "annualRate", before: "9.9", after: "8.5", masked: false },
        { field: "validFrom", before: null, after: DAY1, masked: false },
      ],
      [
        { field: "monthlyPayment", before: "310", after: "295.5", masked: false },
        { field: "validFrom", before: null, after: DAY2, masked: false },
      ],
    ]);
  });

  it("FIN-12@PoC FR 4: the same terms again change nothing — no audit entry, no new period", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const res = await details(space, id, { annualRate: "9.90", monthlyPayment: "310" });
    expect(res.statusCode).toBe(200);
    expect(await termsUpdates(space, id)).toEqual([]);
    expect(await historyRows(space)).toBe(0);
  });
});

describe("FIN-12@PoC FR 4: a credit card's credit limit in «Реквізити»", () => {
  it("FIN-12@PoC FR 4: the limit 2 000 → 3 500 applies from today, «Доступно» follows; clearing it leaves no limit", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "credit-card",
      name: "Кредитка",
      balance: eur("300.00"),
      creditLimit: "2000.00",
      gracePeriodDays: 55,
    });
    const res = await details(space, id, { creditLimit: "3500.00" });
    expect(res.statusCode).toBe(200);
    expect(res.json().creditCard).toEqual(
      expect.objectContaining({ creditLimit: eur("3500"), available: eur("3200"), gracePeriodDays: 55 }),
    );
    expect(
      (await liabilities.termsOn(space.householdId, id, "2026-11-12"))?.creditLimit?.toDecimalString(),
    ).toBe("2000");
    const cleared = await details(space, id, { creditLimit: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().creditCard).toEqual(
      expect.objectContaining({ creditLimit: null, available: null }),
    );
    expect((await termsUpdates(space, id)).map((e) => e.changes[0])).toEqual([
      { field: "creditLimit", before: "2000", after: "3500", masked: false },
      { field: "creditLimit", before: "3500", after: null, masked: false },
    ]);
  });

  it("FIN-12@PoC FR 4: a card's rate and payment, a loan's limit and a loan's rate or payment cleared are refused, and nothing changes", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const card = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("1.00") });
    const loan = await newLoan(space);
    for (const [account, body, errors] of [
      [card, { monthlyPayment: "10.00" }, [{ in: "body", path: "monthlyPayment", issue: "not_allowed" }]],
      [card, { annualRate: "20" }, [{ in: "body", path: "annualRate", issue: "not_allowed" }]],
      [loan, { creditLimit: "100.00" }, [{ in: "body", path: "creditLimit", issue: "not_allowed" }]],
      [loan, { annualRate: null }, [{ in: "body", path: "annualRate", issue: "required" }]],
      [loan, { monthlyPayment: "0" }, [{ in: "body", path: "monthlyPayment", issue: "invalid" }]],
      [loan, { monthlyPayment: "1.005" }, [{ in: "body", path: "monthlyPayment", issue: "invalid" }]],
    ] as const) {
      const res = await details(space, account, body);
      expect([body, res.statusCode]).toEqual([body, 400]);
      expect(res.json().errors).toEqual(errors);
    }
    expect((await view(space, loan)).loan).toEqual(
      expect.objectContaining({ annualRate: "9.9", monthlyPayment: eur("310") }),
    );
    expect(await historyRows(space)).toBe(0);
  });

  it("FIN-12@PoC FR 4: the account's own fields and the terms in one request — a refused term writes neither", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    const institution = { name: "ПриватБанк", country: "UA" };
    const refused = await details(space, id, { institution, monthlyPayment: "0" });
    expect(refused.statusCode).toBe(400);
    expect((await view(space, id)).institution).toBeNull();
    const res = await details(space, id, { institution, monthlyPayment: "280.00" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({ institution, loan: expect.objectContaining({ monthlyPayment: eur("280") }) }),
    );
  });
});

describe("FIN-12@PoC AC12: «Додайте ставку і платіж» goes once both are entered in «Реквізити»", () => {
  it("FIN-12@PoC AC12: a card without transactions becomes a loan, marked until its rate and payment are entered in «Реквізити»", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("0.00") });
    expect((await call(space, "PATCH", `/v1/accounts/${id}`, { kind: "loan" })).statusCode).toBe(200);
    expect((await view(space, id)).loan.termsMissing).toBe(true);
    const rateOnly = await details(space, id, { annualRate: "12" });
    expect(rateOnly.statusCode).toBe(200);
    expect(rateOnly.json().loan).toEqual(expect.objectContaining({ annualRate: "12", termsMissing: true }));
    const both = await details(space, id, { monthlyPayment: "150.00" });
    expect(both.statusCode).toBe(200);
    expect(both.json().loan).toEqual(
      expect.objectContaining({ annualRate: "12", monthlyPayment: eur("150"), termsMissing: false }),
    );
    const { rows } = await db.owner.query(
      `SELECT terms_pending FROM liabilities.liabilities WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([{ terms_pending: false }]);
    // The kind change is a period of its own: the card's terms before it.
    const history = await liabilities.termsHistory(space.householdId, id);
    expect(history?.map((p) => [p.validFrom, p.terms.kind])).toEqual([
      [null, "credit-card"],
      [DAY1, "loan"],
      [DAY1, "loan"],
      [DAY1, "loan"],
    ]);
  });
});

describe("FIN-12@PoC FR 8 and access: the terms of a closed account or of another space do not change", () => {
  it("FIN-12@PoC FR 8: a closed loan's terms do not change", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "loan",
      name: "Позика",
      balance: eur("0.00"),
      annualRate: "5",
      monthlyPayment: "50.00",
    });
    expect((await call(space, "POST", `/v1/accounts/${id}/close`, { closedOn: DAY1 })).statusCode).toBe(200);
    const res = await details(space, id, { annualRate: "4" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_CLOSED" }));
    expect((await view(space, id)).loan.annualRate).toBe("5");
  });

  it("FIN-12@PoC permissions of the terms: a viewer and a scoped member are refused; another space's loan is «not found» and tells nothing", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await newLoan(space);
    for (const principal of [
      { role: "viewer", scoped: false },
      { role: "owner", scoped: true },
    ]) {
      const res = await details(space, id, { annualRate: "1" }, principal);
      expect([principal, res.statusCode]).toEqual([principal, 403]);
      expect(res.body).not.toMatch(/9\.9|310|12000/);
    }
    for (const account of [id, randomUUID()]) {
      const res = await details(stranger, account, { annualRate: "1", monthlyPayment: "1.00" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(res.body).not.toMatch(/9\.9|310|12000/);
    }
    // Through the liabilities interface too: another space sees no liability and changes none.
    expect(await liabilities.termsHistory(stranger.householdId, id)).toBeNull();
    const foreign = await liabilities.changeTerms(stranger.householdId, {
      actorAccountId: stranger.accountId,
      accountId: id,
      change: { annualRate: "1" },
      validFrom: DAY1,
    });
    expect(foreign).toEqual({ kind: "not-found" });
    expect((await view(space, id)).loan.annualRate).toBe("9.9");
    expect(await historyRows(space)).toBe(0);
  });
});

describe("FIN-12@PoC FR 5 (#289 item 3): old code + new schema — a kind change by the previous code leaves no period", () => {
  it("FIN-12@PoC FR 5: after a row change without a period, the next kind change adds the terms now first, so termsOn(today) is the row's", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    // What the previous code's changeKind writes: the row only (no liability_terms period).
    await db.owner.query(
      `UPDATE liabilities.liabilities SET kind = 'credit-card', monthly_payment = NULL WHERE household_id = $1`,
      [space.householdId],
    );
    await db.owner.query(
      `UPDATE accounts.accounts SET kind = 'credit-card' WHERE household_id = $1 AND id = $2`,
      [space.householdId, id],
    );
    expect((await call(space, "PATCH", `/v1/accounts/${id}`, { kind: "loan" })).statusCode).toBe(200);
    const history = await liabilities.termsHistory(space.householdId, id);
    expect(history?.map((p) => [p.validFrom, p.terms.kind])).toEqual([
      [null, "loan"],
      [DAY1, "loan"],
      [DAY1, "credit-card"],
      [DAY1, "loan"],
    ]);
    expect((await liabilities.termsOn(space.householdId, id, DAY1))?.kind).toBe("loan");
  });

  it("FIN-12@PoC FR 5: the drifted terms are dated on the day of the next change, never back on the last period's day", async () => {
    now = Date.parse(`${DAY1}T10:00:00Z`);
    const space = await newSpace();
    const id = await newLoan(space);
    expect((await details(space, id, { annualRate: "8.5" })).statusCode).toBe(200);
    await db.owner.query(
      `UPDATE liabilities.liabilities SET kind = 'credit-card', monthly_payment = NULL WHERE household_id = $1`,
      [space.householdId],
    );
    await db.owner.query(
      `UPDATE accounts.accounts SET kind = 'credit-card' WHERE household_id = $1 AND id = $2`,
      [space.householdId, id],
    );
    now = Date.parse(`${DAY2}T09:00:00Z`);
    expect((await call(space, "PATCH", `/v1/accounts/${id}`, { kind: "loan" })).statusCode).toBe(200);
    const history = await liabilities.termsHistory(space.householdId, id);
    expect(history?.map((p) => [p.validFrom, p.terms.kind])).toEqual([
      [null, "loan"],
      [DAY1, "loan"],
      [DAY2, "credit-card"],
      [DAY2, "loan"],
    ]);
    // On DAY1 the history still says what it recorded then (the old code's change has no known day).
    expect((await liabilities.termsOn(space.householdId, id, DAY1))?.kind).toBe("loan");
  });
});
