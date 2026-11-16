import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { createAccountsServices, createCreditAccounts } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createDebtPayoffErasure,
  createDebtPayoffServices,
  createDebtPlannedExpenses,
} from "../src/modules/debt-payoff/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-19@PoC a) (wave 2 row 33), the server part of the module `debt-payoff`, through the real API on a real PostgreSQL:
 * the debts with their base calculation and progress, a scenario, both strategies, the saved plans, the space's boundary
 * and the audit hand-off with its daily recovery (ARC-04, #249). Every name and amount is synthetic; the clock is the
 * test's own (November 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-16";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
let now = at(TODAY);
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const telemetry = testTelemetryForFile();

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
  method: "GET" | "POST" | "PUT" | "DELETE",
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

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

/** A loan of the space (FIN-01): its debt, rate and monthly payment. */
async function loan(
  space: Space,
  name: string,
  debt: string,
  rate: string,
  payment: string,
  date = "2026-11-01",
) {
  return account(space, {
    kind: "loan",
    name,
    balance: eur(debt),
    balanceDate: date,
    annualRate: rate,
    monthlyPayment: payment,
  });
}

/** A credit card of the space: no monthly payment (FIN-01 FR 2), a rate if given. */
async function card(space: Space, name: string, debt: string, rate?: string) {
  return account(space, {
    kind: "credit-card",
    name,
    balance: eur(debt),
    balanceDate: "2026-11-01",
    ...(rate ? { annualRate: rate } : {}),
  });
}

async function account(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", body);
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

interface DebtJson {
  readonly accountId: string;
  readonly [field: string]: unknown;
}

async function debts(space: Space): Promise<DebtJson[]> {
  const res = await call(space, "GET", "/v1/debts");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().debts;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const planAudit = (householdId: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'debt-payoff.plan' AND action = $2",
    householdId,
    action,
  );

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          ledger,
          liabilities,
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
        }),
        debtPayoff: createDebtPayoffServices({
          accounts: createCreditAccounts(db.databases.for("accounts")),
          liabilities,
          ledger,
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

afterEach(() => {
  vi.restoreAllMocks();
  now = at(TODAY);
});

describe("BUD-19@PoC: «Борги → План погашення»", () => {
  it("BUD-19@PoC AC1: «Visa» 5 000 € at 24 % with 250 € — «Погашення через 26 міс.» with its month, 1 449,37 € of interest, from the liability", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const [d] = await debts(space);
    expect(d).toMatchObject({
      accountId: visa,
      kind: "loan",
      name: "Visa",
      balance: eur("5000"),
      annualRate: "24",
      monthlyPayment: eur("250"),
      termsMissing: false,
      base: { status: "paid", months: 26, payoffMonth: "2029-01", totalInterest: eur("1449.37") },
      plan: null,
    });
    const base = d!.base as { schedule: { month: string; balance: unknown }[] };
    // The chart «Лінії» and its table: the balance at the end of each month, the first month the next one.
    expect(base.schedule).toHaveLength(26);
    expect(base.schedule[0]).toEqual({ month: "2026-12", balance: eur("4850") });
    expect(base.schedule.at(-1)).toEqual({ month: "2029-01", balance: eur("0") });
  });

  it("BUD-19@PoC FR 11: the debts are the space's credit cards and loans only; none — an empty list", async () => {
    const space = await newSpace();
    expect(await debts(space)).toEqual([]);
    await account(space, {
      kind: "savings",
      name: "Скарбничка",
      balance: eur("100.00"),
      balanceDate: "2026-11-01",
    });
    const visa = await card(space, "Visa", "300.00", "24");
    const car = await loan(space, "Автокредит", "4100.00", "9.9", "310.00");
    expect((await debts(space)).map((d) => [d.accountId, d.kind])).toEqual([
      [visa, "credit-card"],
      [car, "loan"],
    ]);
  });

  it("BUD-19@PoC AC2: an extra 100 € / month — 17 months, 946,99 €, «На 9 міс. раніше, економія 502,38 €»; nothing is written", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const res = await call(space, "POST", `/v1/debts/${visa}/scenario`, { extraMonthly: "100.00" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      base: { status: "paid", months: 26, totalInterest: eur("1449.37") },
      scenario: { status: "paid", months: 17, payoffMonth: "2028-04", totalInterest: eur("946.99") },
      saving: { months: 9, interest: eur("502.38") },
    });
    // The base and the new scenario side by side: two lines of the chart.
    expect(res.json().base.schedule).toHaveLength(26);
    expect(res.json().scenario.schedule).toHaveLength(17);
    expect(await n("debt_payoff.plans WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-19@PoC AC2: «Зберегти план» with «Додати до запланованих витрат» makes 100 € a planned expense up to the payoff month; no payment is made", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const journal = await n("ledger.entries WHERE household_id = $1", space.householdId);
    const res = await call(space, "PUT", `/v1/debts/${visa}/plan`, {
      extraMonthly: "100.00",
      addToPlannedExpenses: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      startMonth: "2026-11",
      extraMonthly: eur("100"),
      months: 17,
      totalInterest: eur("946.99"),
      payoffMonth: "2028-04",
      addToPlannedExpenses: true,
      version: 1,
    });
    const planned = createDebtPlannedExpenses(db.databases.for("debt-payoff"));
    expect(await planned.inMonth(space.householdId, "2026-11")).toEqual([]);
    expect(
      (await planned.inMonth(space.householdId, "2026-12")).map((p) => [p.accountId, p.amount.toJSON()]),
    ).toEqual([[visa, eur("100")]]);
    expect(await planned.inMonth(space.householdId, "2028-04")).toHaveLength(1);
    expect(await planned.inMonth(space.householdId, "2028-05")).toEqual([]);
    // The product moves no money: the journal has no new entry.
    expect(await n("ledger.entries WHERE household_id = $1", space.householdId)).toBe(journal);
    expect((await debts(space))[0]!.plan).toMatchObject({ months: 17, addToPlannedExpenses: true });
  });

  it("BUD-19@PoC AC4: 5 000 € at 24 % and 90 € — no date, «За цих умов борг не зменшується»; such a plan is not saved", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "90.00");
    expect((await debts(space))[0]).toMatchObject({
      base: { status: "not-decreasing", months: null, payoffMonth: null, totalInterest: null, schedule: [] },
      progress: { remainingMonths: null },
    });
    const res = await call(space, "PUT", `/v1/debts/${visa}/plan`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DEBT_NOT_DECREASING");
    expect(await n("debt_payoff.plans WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-19@PoC EC6: a calculation over 1 200 months stops — «Розрахунок перевищує 100 років»", async () => {
    const space = await newSpace();
    const slow = await loan(space, "Іпотека", "5000.00", "1.2", "5.01");
    expect((await debts(space))[0]).toMatchObject({ base: { status: "over-limit", months: null } });
    expect((await call(space, "PUT", `/v1/debts/${slow}/plan`, {})).json().code).toBe("DEBT_OVER_LIMIT");
  });

  it("BUD-19@PoC AC5, EC2: a card without a payment asks for it, takes no part in «Стратегія» until given", async () => {
    const space = await newSpace();
    const visa = await card(space, "Visa", "5000.00", "24");
    const bare = await card(space, "Mastercard", "1500.00");
    const [v, m] = await debts(space);
    expect(v).toMatchObject({ termsMissing: true, base: null, monthlyPayment: null, annualRate: "24" });
    expect(m).toMatchObject({ termsMissing: true, base: null, annualRate: null });
    const missing = await call(space, "POST", `/v1/debts/${bare}/scenario`, {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json().errors).toEqual([
      { in: "body", path: "annualRate", issue: "required" },
      { in: "body", path: "monthlyPayment", issue: "required" },
    ]);
    const strategy = await call(space, "POST", "/v1/debts/strategy", { total: eur("340.00") });
    expect(strategy.statusCode, strategy.body).toBe(200);
    expect(strategy.json()).toMatchObject({
      included: [],
      excluded: [
        { accountId: visa, reason: "terms-missing" },
        { accountId: bare, reason: "terms-missing" },
      ],
    });
    // Entered in the scenario, the card is calculated — and the liability keeps no payment (FR 2).
    const entered = await call(space, "POST", `/v1/debts/${visa}/scenario`, { monthlyPayment: "250.00" });
    expect(entered.json().base).toMatchObject({ months: 26, totalInterest: eur("1449.37") });
    expect((await debts(space))[0]).toMatchObject({ termsMissing: true, monthlyPayment: null });
  });

  it("BUD-19@PoC AC6: a plan at 20 % instead of 24 % keeps 24 % in the liability; the plan keeps 20 % and its result; audited", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const res = await call(space, "PUT", `/v1/debts/${visa}/plan`, { annualRate: "20" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ annualRate: "20", balance: eur("5000"), monthlyPayment: eur("250") });
    const [d] = await debts(space);
    expect(d).toMatchObject({ annualRate: "24", base: { months: 26 }, plan: { annualRate: "20" } });
    const account = await call(space, "GET", `/v1/accounts/${visa}`);
    expect(account.json().loan.annualRate).toBe("24");
    expect(await planAudit(space.householdId, "create")).toBe(1);
    const { rows } = await db.owner.query<{ field: string; after: string }>(
      `SELECT c->>'field' AS field, c->>'after' AS after FROM audit.entries e, jsonb_array_elements(e.changes) c
        WHERE e.household_id = $1 AND e.entity_type = 'debt-payoff.plan'`,
      [space.householdId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { field: "annualRate", after: "20" },
        { field: "months", after: String(res.json().months) },
        { field: "totalInterest", after: res.json().totalInterest.amount },
      ]),
    );
    // Saved again with another value: an update; deleted: a delete — «Плану немає».
    expect((await call(space, "PUT", `/v1/debts/${visa}/plan`, { annualRate: "22" })).json().version).toBe(2);
    expect(await planAudit(space.householdId, "update")).toBe(1);
    expect((await call(space, "DELETE", `/v1/debts/${visa}/plan`)).json()).toEqual({ deleted: true });
    expect(await planAudit(space.householdId, "delete")).toBe(1);
    expect((await debts(space))[0]).toMatchObject({
      plan: null,
      progress: { plan: { status: "none", amount: null } },
    });
    expect((await call(space, "DELETE", `/v1/debts/${visa}/plan`)).statusCode).toBe(404);
  });

  it("BUD-19@PoC EC5: a one-off payment larger than the balance left is capped to it, with the month named", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const res = await call(space, "POST", `/v1/debts/${visa}/scenario`, {
      oneOffs: [{ month: "2027-01", amount: "9000.00" }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().scenario).toMatchObject({
      months: 2,
      payoffMonth: "2027-01",
      cappedOneOffs: ["2027-01"],
    });
    // A one-off in the current month or before, a zero or a malformed one is refused.
    const bad = await call(space, "POST", `/v1/debts/${visa}/scenario`, {
      oneOffs: [
        { month: "2026-11", amount: "10.00" },
        { month: "2027-02", amount: "0" },
      ],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.map((e: { path: string }) => e.path)).toEqual([
      "oneOffs.0.month",
      "oneOffs.1.amount",
    ]);
  });

  it("BUD-19@PoC FR 3: a 0 % loan — no interest, the last payment smaller", async () => {
    const space = await newSpace();
    await loan(space, "Розстрочка", "1000.00", "0", "300.00");
    const [d] = await debts(space);
    expect(d).toMatchObject({ base: { months: 4, totalInterest: eur("0") } });
    expect((d!.base as { schedule: unknown[] }).schedule.at(-2)).toEqual({
      month: "2027-02",
      balance: eur("100"),
    });
  });
});

describe("BUD-19@PoC: «Борги → Стратегія»", () => {
  it("BUD-19@PoC AC3: Avalanche 24 months / 1 581,52 €; Snowball 25 months / 1 728,58 €, Mastercard closed earlier; both at once, no mark", async () => {
    const space = await newSpace();
    const visa = await card(space, "Visa", "5000.00", "24");
    const mc = await card(space, "Mastercard", "1500.00", "18");
    const res = await call(space, "POST", "/v1/debts/strategy", {
      total: eur("340.00"),
      debts: [
        { accountId: visa, minimumPayment: "100.00" },
        { accountId: mc, minimumPayment: "40.00" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const { avalanche, snowball, included, excluded } = res.json();
    expect(avalanche).toMatchObject({ status: "paid", months: 24, totalInterest: eur("1581.52") });
    expect(snowball).toMatchObject({ status: "paid", months: 25, totalInterest: eur("1728.58") });
    const closed = (s: { debts: { accountId: string; months: number }[] }) =>
      s.debts.find((d) => d.accountId === mc)!.months;
    expect(closed(snowball)).toBeLessThan(closed(avalanche));
    expect([included, excluded]).toEqual([[visa, mc], []]);
    // Neutral: no field marks one as recommended.
    expect(JSON.stringify(res.json())).not.toMatch(/recommend/i);
  });

  it("BUD-19@PoC FR 6: a total below the minimums is refused; a debt in another currency takes no part", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "100.00");
    const res = await call(space, "POST", "/v1/debts/strategy", { total: eur("90.00") });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "total", issue: "below_minimums" }]);
    const gbp = await call(space, "POST", "/v1/debts/strategy", {
      total: { amount: "500.00", currency: "GBP" },
    });
    expect(gbp.json()).toMatchObject({ included: [], excluded: [{ accountId: visa, reason: "currency" }] });
  });
});

describe("BUD-19@PoC: «Борги → Прогрес»", () => {
  it("BUD-19@PoC AC8: «Погашено N %» and «Залишилось N міс.» from the debt and its regular payments", async () => {
    const space = await newSpace();
    const car = await loan(space, "Автокредит", "5000.00", "9.9", "310.00", "2026-10-01");
    const updated = await call(space, "POST", `/v1/accounts/${car}/balance`, { balance: eur("4100.00") });
    expect(updated.statusCode, updated.body).toBe(200);
    const [d] = await debts(space);
    expect(d).toMatchObject({ balance: eur("4100"), progress: { paidPercent: 18, remainingMonths: 15 } });
  });

  it("BUD-19@PoC FR 7: the «План» column — ahead of the saved plan by what was paid over it this month", async () => {
    const space = await newSpace();
    now = at("2026-10-17");
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00", "2026-10-01");
    expect((await call(space, "PUT", `/v1/debts/${visa}/plan`, {})).statusCode).toBe(200);
    // The month it was saved in: «За планом».
    expect((await debts(space))[0]).toMatchObject({
      progress: { plan: { status: "on-track", amount: eur("0") } },
    });
    now = at(TODAY);
    // The plan pays off 150 € in November (100 € of interest); 300 € went.
    await call(space, "POST", `/v1/accounts/${visa}/balance`, { balance: eur("4700.00") });
    expect((await debts(space))[0]).toMatchObject({
      progress: { plan: { status: "ahead", amount: eur("150") } },
    });
    await call(space, "POST", `/v1/accounts/${visa}/balance`, { balance: eur("4900.00") });
    expect((await debts(space))[0]).toMatchObject({
      progress: { plan: { status: "behind", amount: eur("50") } },
    });
  });
});

describe("BUD-19@PoC access and concurrency", () => {
  it("BUD-19@PoC AC7: saving a plan for another space's debt — not found, nothing of that space disclosed", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const visa = await loan(owner, "Visa", "5000.00", "24", "250.00");
    for (const [method, url, body] of [
      ["PUT", `/v1/debts/${visa}/plan`, { extraMonthly: "100.00" }],
      ["POST", `/v1/debts/${visa}/scenario`, {}],
      ["DELETE", `/v1/debts/${visa}/plan`, undefined],
    ] as const) {
      const res = await call(stranger, method, url, body);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain("5000");
    }
    expect(await debts(stranger)).toEqual([]);
    expect(
      await n("debt_payoff.plans WHERE household_id IN ($1, $2)", owner.householdId, stranger.householdId),
    ).toBe(0);
  });

  it("BUD-19@PoC «Права доступу»: a scoped member sees no debts; a viewer cannot save a plan", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    expect(
      (await call(space, "GET", "/v1/debts", undefined, { role: "viewer", scoped: true })).statusCode,
    ).toBe(404);
    expect(
      (await call(space, "PUT", `/v1/debts/${visa}/plan`, {}, { role: "viewer", scoped: true })).statusCode,
    ).toBe(403);
    expect(await n("debt_payoff.plans WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-19@PoC FR 5: two saves of one debt's plan at once — one plan, two versions, one create and one update audited", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const [a, b] = await Promise.all([
      call(space, "PUT", `/v1/debts/${visa}/plan`, { extraMonthly: "100.00" }),
      call(space, "PUT", `/v1/debts/${visa}/plan`, { extraMonthly: "50.00" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().version, b.json().version].sort()).toEqual([1, 2]);
    expect(a.json().id).toBe(b.json().id);
    expect(await n("debt_payoff.plans WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await planAudit(space.householdId, "create")).toBe(1);
    expect(await planAudit(space.householdId, "update")).toBe(1);
    const last = a.json().version === 2 ? a.json() : b.json();
    expect((await debts(space))[0]!.plan).toMatchObject({ version: 2, extraMonthly: last.extraMonthly });
  });
});

describe("BUD-19@PoC «Збережені плани погашення обов'язково пишуться в журнал аудиту»: the debt-payoff queue (ARC-04, ADR-0015)", () => {
  it("ARC-04@PoC FR 4: a debt-payoff audit job in state dead goes back to the queue with the daily recovery", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "debt-payoff.plan") throw new Error("injected");
      return original(householdId, entry);
    });
    expect((await call(space, "PUT", `/v1/debts/${visa}/plan`, {})).statusCode).toBe(200);
    expect(await planAudit(space.householdId, "create")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "debt_payoff.hand_off_deferred")).toBe(true);
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE debt_payoff.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    // The worker does not take a dead job.
    await runWorker(space.householdId);
    expect(await planAudit(space.householdId, "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("debt-payoff.hand-off-recovery")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("debt-payoff.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await tasks.find((t) => t.name === "debt-payoff.hand-off-recovery")!.run();
    expect(telemetry.memory.logRecords().some((r) => r.body === "debt_payoff.hand_off_requeued")).toBe(true);
    await runWorker(space.householdId);
    expect(await n("debt_payoff.jobs WHERE household_id = $1 AND state = 'done'", space.householdId)).toBe(1);
    expect(await planAudit(space.householdId, "create")).toBe(1);
    // Again: the entry is keyed, nothing is written twice.
    await tasks.find((t) => t.name === "debt-payoff.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await planAudit(space.householdId, "create")).toBe(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes its plans and queue rows", async () => {
    const space = await newSpace();
    const visa = await loan(space, "Visa", "5000.00", "24", "250.00");
    await call(space, "PUT", `/v1/debts/${visa}/plan`, {});
    const erased = await createDebtPayoffErasure(db.databases.for("debt-payoff")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ plans: 1, jobs: 1 });
    expect(await n("debt_payoff.jobs WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
