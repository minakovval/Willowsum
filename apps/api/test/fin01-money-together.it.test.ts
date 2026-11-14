import { randomUUID } from "node:crypto";
import { Decimal, Money } from "@willowsum/domain-kernel";
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
 * FIN-01@PoC b), server side (wave 2 row 12), through the real API on a real PostgreSQL: «Гроші разом» and the list of
 * «Рахунки» — balances from the ledger, the breakdown by currency, the total in the profile currency at the dated NBU
 * rate of fx-rates (the VAL-04 «приблизно» rule reused), closed accounts and ledger accounts that no account points to.
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
const card = (name: string, debt: string, limit: string) => ({
  kind: "credit-card",
  name,
  balance: { amount: debt, currency: "EUR" },
  creditLimit: limit,
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

describe("FIN-01@PoC FR 18: «Гроші разом» in the profile currency at the NBU rate, with the breakdown by currency", () => {
  it("FIN-01@PoC AC12: 11 400,00 EUR and 829 680,00 UAH, a card with no debt: 30 280,00 € at «курс НБУ на 2026-11-02», UAH 62 % and EUR 38 %", async () => {
    const space = await newSpace();
    await create(space, cash("Євро", "11400.00", "EUR"));
    await create(space, cash("Гривня", "829680.00", "UAH"));
    await create(space, card("Картка", "0", "5000.00"));

    const s = await summary(space);
    expect(s.currency).toBe("EUR");
    expect(cents(s.moneyTogether.total)).toBe("30280.00");
    expect(s.moneyTogether.total.currency).toBe("EUR");
    expect(s.moneyTogether.rate).toEqual({ source: "NBU", date: "2026-11-02" });
    expect(s.moneyTogether.approximate).toBe(false);
    const legend = s.moneyTogether.breakdown.map((b: Converted & { percent: number | null }) => ({
      currency: b.currency,
      amount: cents(b.amount),
      equivalent: cents(b.equivalent),
      percent: b.percent,
    }));
    // The bar has a segment per currency; the largest first.
    expect(legend).toEqual([
      { currency: "UAH", amount: "829680.00", equivalent: "18880.00", percent: 62 },
      { currency: "EUR", amount: "11400.00", equivalent: "11400.00", percent: 38 },
    ]);
    // The original amount stays in its currency; the rate is kept with the conversion.
    expect(s.moneyTogether.breakdown[0].amount.currency).toBe("UAH");
    expect(s.moneyTogether.breakdown[0].rateDate).toBe("2026-11-02");
    expect(s.moneyTogether.breakdown[1].rateDate).toBeNull();
  });

  it("FIN-01@PoC FR 18: a credit card's debt is subtracted; the total and the legend are exact Decimal sums", async () => {
    const space = await newSpace();
    await create(space, cash("Щоденний", "5000.10", "EUR"));
    await create(space, cash("Готівка", "0.20", "EUR", { kind: "cash" }));
    await create(space, card("Картка", "1200.00", "5000.00"));
    const s = await summary(space);
    expect(s.moneyTogether.total).toEqual({ amount: "3800.3", currency: "EUR" });
    expect(s.moneyTogether.breakdown).toMatchObject([
      { currency: "EUR", amount: { amount: "3800.3", currency: "EUR" }, percent: 100 },
    ]);
  });

  it("FIN-01@PoC AC18: a loan «Іпотека» of 120 000,00 € leaves «Гроші разом» as it was; the «Кредитні» header has «Кредити: −120 000,00 €»", async () => {
    const space = await newSpace();
    await create(space, cash("Щоденний", "2500.00", "EUR"));
    const before = await summary(space);
    const loanId = await create(space, {
      kind: "loan",
      name: "Іпотека",
      balance: { amount: "120000.00", currency: "EUR" },
      annualRate: "4.2",
      monthlyPayment: "650.00",
    });
    const after = await summary(space);
    expect(after.moneyTogether).toEqual(before.moneyTogether);
    expect(cents(after.credit.loanDebt.total)).toBe("120000.00");
    expect(cents(after.credit.cardDebt.total)).toBe("0.00");

    const credit = await list(space, "?group=credit");
    expect(credit.items).toHaveLength(1);
    expect(credit.items[0]).toMatchObject({
      id: loanId,
      group: "credit",
      kind: "loan",
      name: "Іпотека",
      loan: { annualRate: "4.2", monthlyPayment: { amount: "650", currency: "EUR" } },
      creditCard: null,
    });
    expect(cents(credit.items[0]!.loan.debt)).toBe("120000.00");
    expect(cents(credit.items[0]!.inProfileCurrency.total)).toBe("-120000.00");
  });

  it("FIN-01@PoC EC1: without today's rate the last known one is used with its date; older than 3 days it is «приблизно» (VAL-04)", async () => {
    await db.owner.query("TRUNCATE fx_rates.rates");
    await seedRates([["2026-10-30", "EUR", EUR_UAH]]); // a Friday
    const space = await newSpace();
    await create(space, cash("Гривня", "829680.00", "UAH"));

    const monday = await summary(space); // 2026-11-02: three calendar days, no mark
    expect(monday.moneyTogether.rate).toEqual({ source: "NBU", date: "2026-10-30" });
    expect(cents(monday.moneyTogether.total)).toBe("18880.00");
    expect(monday.moneyTogether.approximate).toBe(false);
    expect(monday.moneyTogether.breakdown[0]).toMatchObject({ rateDate: "2026-10-30", approximate: false });

    now = Date.parse("2026-11-04T10:00:00Z"); // five days: «приблизно»
    const wednesday = await summary(space);
    expect(wednesday.moneyTogether.rate).toEqual({ source: "NBU", date: "2026-10-30" });
    expect(cents(wednesday.moneyTogether.total)).toBe("18880.00");
    expect(wednesday.moneyTogether).toMatchObject({ approximate: true, staleRateCount: 1 });
    expect(wednesday.moneyTogether.breakdown[0]).toMatchObject({ rateDate: "2026-10-30", approximate: true });
    const row = (await list(space)).items[0]!;
    expect(row.currencies[0]).toMatchObject({ rateDate: "2026-10-30", approximate: true });
    expect(row.inProfileCurrency.approximate).toBe(true);
  });

  it("FIN-01@PoC EC1: a currency with no rate at all is left out of the total (never 0) and has no segment", async () => {
    const space = await newSpace();
    await create(space, cash("Євро", "100.00", "EUR"));
    await create(space, cash("Долари", "50.00", "USD"));
    const s = await summary(space);
    expect(s.moneyTogether).toMatchObject({ approximate: true, unavailableCount: 1 });
    expect(s.moneyTogether.total).toEqual({ amount: "100", currency: "EUR" });
    expect(s.moneyTogether.breakdown).toEqual([
      expect.objectContaining({ currency: "EUR", percent: 100 }),
      expect.objectContaining({
        currency: "USD",
        amount: { amount: "50", currency: "USD" },
        equivalent: null,
        rateDate: null,
        percent: null,
      }),
    ]);
  });

  it("FIN-01@PoC FR 18: only the ledger accounts of the space's accounts are summed; a ledger account no account points to stays hidden", async () => {
    const space = await newSpace();
    await create(space, cash("Щоденний", "700.00", "EUR"));
    // An orphan of a failed create (#207 follow-up): owned by «accounts», with a balance, but no subaccount names it.
    const orphan = await ledger.openAccount(
      space.householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "EUR" },
    );
    await ledger.post(space.householdId, {
      source: { module: "accounts", id: orphan.id },
      idempotencyKey: `test.orphan:${orphan.id}`,
      operationDate: "2026-11-01",
      event: { type: "opening-balance", account: orphan.id, amount: Money.of("9999.00", "EUR") },
    });
    const s = await summary(space);
    expect(s.moneyTogether.total).toEqual({ amount: "700", currency: "EUR" });
    expect((await list(space)).items).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain("9999");
  });
});

describe("FIN-01@PoC FR 13, FR 14: the list of «Рахунки» — groups, balances in the profile currency, the original amount", () => {
  it("FIN-01@PoC AC4: 1 000 EUR with a subaccount of 4 300 UAH is one row in EUR at today's NBU rate that expands into its subaccounts", async () => {
    const space = await newSpace();
    const id = await create(
      space,
      cash("Мультивалютний", "1000.00", "EUR", {
        extraCurrencies: [{ amount: "4300.00", currency: "UAH", date: "2026-11-01" }],
      }),
    );
    const { items } = await list(space);
    expect(items).toHaveLength(1);
    const row = items[0]!;
    expect(row.id).toBe(id);
    const expected = new Decimal("1000").plus(new Decimal("4300").div(EUR_UAH)).toDecimalPlaces(2).toFixed(2);
    expect(cents(row.inProfileCurrency.total)).toBe(expected);
    expect(row.inProfileCurrency.total.currency).toBe("EUR");
    expect(row.currencies.map((c: Converted) => ({ amount: c.amount, rateDate: c.rateDate }))).toEqual([
      { amount: { amount: "1000", currency: "EUR" }, rateDate: null },
      { amount: { amount: "4300", currency: "UAH" }, rateDate: "2026-11-02" },
    ]);
    expect(cents(row.currencies[1]!.equivalent)).toBe(
      new Decimal("4300").div(EUR_UAH).toDecimalPlaces(2).toFixed(2),
    );
  });

  it("FIN-01@PoC AC5: manual and imported accounts of several institutions are in «Готівкові» and «Кредитні» with institution, currency, balance in EUR and in the account's currency, last update and source", async () => {
    const space = await newSpace();
    const mono = await create(
      space,
      cash("Гривня", "829680.00", "UAH", {
        institution: { name: "monobank", country: "UA" },
        balanceDate: "2026-10-20",
      }),
    );
    const bbva = await create(
      space,
      cash("Євро", "11400.00", "EUR", { institution: { name: "BBVA", country: "ES" } }),
    );
    const cardId = await create(space, {
      ...card("Картка", "1200.00", "5000.00"),
      institution: { name: "Revolut", country: "LT" },
    });
    await db.owner.query(
      `UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`,
      [space.householdId, mono],
    );

    const cashRows = (await list(space, "?group=cash")).items;
    expect(cashRows.map((r) => r.id)).toEqual([mono, bbva]);
    expect(cashRows[0]).toMatchObject({
      group: "cash",
      name: "Гривня",
      institution: { name: "monobank", country: "UA" },
      source: "import",
      updatedOn: "2026-10-20",
      status: "active",
    });
    expect(cents(cashRows[0]!.inProfileCurrency.total)).toBe("18880.00");
    expect(cashRows[0]!.currencies[0]!.amount).toEqual({ amount: "829680", currency: "UAH" });
    expect(cashRows[1]).toMatchObject({
      institution: { name: "BBVA", country: "ES" },
      source: "manual",
      updatedOn: "2026-11-01",
    });
    expect(cashRows[1]!.inProfileCurrency.total).toEqual({ amount: "11400", currency: "EUR" });

    const creditRows = (await list(space, "?group=credit")).items;
    expect(creditRows.map((r) => r.id)).toEqual([cardId]);
    expect(creditRows[0]).toMatchObject({ group: "credit", institution: { name: "Revolut", country: "LT" } });

    const all = (await list(space)).items;
    expect(all.map((r) => r.id)).toEqual([mono, bbva, cardId]);
    expect((await summary(space)).sources).toEqual({ import: 1, manual: 2 });
  });

  it("FIN-01@PoC AC14: an account without transactions for 120 days is active, with no automatic «Неактивний» mark", async () => {
    const space = await newSpace();
    await create(space, cash("Старий", "10.00", "EUR", { balanceDate: "2026-07-05" }));
    const row = (await list(space)).items[0]!;
    expect(row.status).toBe("active");
    expect(row.updatedOn).toBe("2026-07-05");
    expect(JSON.stringify(row).toLowerCase()).not.toContain("inactive");
  });

  it("FIN-01@PoC FR 14: the list is paged on the server (ARC-07): a cursor continues where the page ended", async () => {
    const space = await newSpace();
    const ids = [];
    for (const name of ["Перший", "Другий", "Третій"])
      ids.push(await create(space, cash(name, "1.00", "EUR")));
    const first = await list(space, "?limit=2");
    expect(first.items.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const second = await list(space, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((r) => r.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
    expect((await call(space, "GET", "/v1/accounts?cursor=bm90LWEtY3Vyc29y")).statusCode).toBe(400);
    // Another space's account as the cursor continues nothing and reveals nothing.
    const other = await newSpace("Петро Інший");
    const theirs = await create(other, cash("Чужий", "1.00", "EUR"));
    const foreign = Buffer.from(JSON.stringify({ i: theirs }), "utf8").toString("base64url");
    expect(await list(space, `?cursor=${foreign}`)).toEqual({ items: [], nextCursor: null });
  });
});

describe("FIN-01@PoC FR 19, FR 21: the «Кредитні» header and «Джерела даних»", () => {
  it("FIN-01@PoC AC13: a card with a limit of 5 000,00 € and a debt of 1 200,00 €: the «Кредитні» header owes 1 200,00 €, the row has the limit and 3 800,00 € available", async () => {
    const space = await newSpace();
    const id = await create(space, card("Картка", "1200.00", "5000.00"));
    const s = await summary(space);
    expect(s.credit.cardDebt).toMatchObject({
      total: { amount: "1200", currency: "EUR" },
      approximate: false,
    });
    expect(s.credit.loanDebt.total).toEqual({ amount: "0", currency: "EUR" });
    const row = (await list(space, "?group=credit")).items[0]!;
    expect(row.id).toBe(id);
    expect(row.creditCard).toEqual({
      creditLimit: { amount: "5000", currency: "EUR" },
      debt: { amount: "1200", currency: "EUR" },
      available: { amount: "3800", currency: "EUR" },
    });
    expect(row.inProfileCurrency.total).toEqual({ amount: "-1200", currency: "EUR" });
    expect(row.loan).toBeNull();
  });

  it("FIN-01@PoC FR 21: «Джерела даних» counts the active accounts imported and entered by hand", async () => {
    const space = await newSpace();
    const imported = await create(space, cash("Виписка", "10.00", "EUR"));
    await create(space, cash("Вручну", "20.00", "EUR"));
    await create(space, card("Картка", "5.00", "100.00"));
    await db.owner.query(
      `UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`,
      [space.householdId, imported],
    );
    expect((await summary(space)).sources).toEqual({ import: 1, manual: 2 });
  });
});

describe("FIN-01@PoC FR 22: a closed account leaves the active list and «Гроші разом»; «Показати закриті» shows it", () => {
  it("FIN-01@PoC FR 22: closed on 2026-10-31, it is listed only with includeClosed, read-only data unchanged, and not summed", async () => {
    const space = await newSpace();
    const open = await create(space, cash("Щоденний", "300.00", "EUR"));
    const closed = await create(space, cash("Старий", "50.00", "EUR"));
    await db.owner.query(
      `UPDATE accounts.accounts SET status = 'closed', closed_on = '2026-10-31' WHERE household_id = $1 AND id = $2`,
      [space.householdId, closed],
    );
    expect((await list(space)).items.map((r) => r.id)).toEqual([open]);
    const withClosed = (await list(space, "?includeClosed=true")).items;
    expect(withClosed.map((r) => r.id)).toEqual([open, closed]);
    expect(withClosed[1]).toMatchObject({ status: "closed", closedOn: "2026-10-31" });
    expect(withClosed[1]!.inProfileCurrency.total).toEqual({ amount: "50", currency: "EUR" });
    const s = await summary(space);
    expect(s.moneyTogether.total).toEqual({ amount: "300", currency: "EUR" });
    expect(s.sources).toEqual({ import: 0, manual: 1 });
  });
});

describe("FIN-01@PoC «Права доступу»: only the session's space, and nothing for a member outside the area", () => {
  it("FIN-01@PoC AC9: the Owner and an unscoped viewer read the list and «Гроші разом»", async () => {
    const space = await newSpace();
    await create(space, cash("Щоденний", "300.00", "EUR"));
    for (const role of ["owner", "viewer"]) {
      expect((await list(space, "", { role })).items).toHaveLength(1);
      expect((await summary(space, { role })).moneyTogether.total).toEqual({
        amount: "300",
        currency: "EUR",
      });
    }
  });

  it("FIN-01@PoC AC10: another space's accounts are in no list, count or sum of this one", async () => {
    const a = await newSpace();
    const b = await newSpace("Петро Інший");
    await create(a, cash("Чужий", "4321.00", "EUR"));
    await create(a, card("Чужа картка", "765.00", "5000.00"));
    const theirs = await summary(b);
    expect(theirs.moneyTogether.total).toEqual({ amount: "0", currency: "EUR" });
    expect(theirs.moneyTogether.breakdown).toEqual([]);
    expect(theirs.credit.cardDebt.total).toEqual({ amount: "0", currency: "EUR" });
    expect(theirs.sources).toEqual({ import: 0, manual: 0 });
    const page = await list(b, "?includeClosed=true");
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(JSON.stringify(theirs)).not.toMatch(/4321|765/);
  });

  it("FIN-01@PoC AC10: a scoped member (accounts closed by the visibility policy) gets «not found» from both, with no amount or count", async () => {
    const space = await newSpace();
    await create(space, cash("Щоденний", "4321.00", "EUR"));
    for (const url of ["/v1/accounts", "/v1/accounts?includeClosed=true", "/v1/accounts/summary"]) {
      const res = await call(space, "GET", url, undefined, { role: "editor", scoped: true });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toMatch(/4321|items|moneyTogether|sources/);
      const viewer = await call(space, "GET", url, undefined, { role: "viewer", scoped: true });
      expect(viewer.statusCode).toBe(404);
    }
  });

  it("FIN-01@PoC «Ліміти плану»: the flag accounts.manual off: the list and the summary answer 404 as if absent", async () => {
    const space = await newSpace();
    off.add("accounts.manual");
    expect((await call(space, "GET", "/v1/accounts")).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/accounts/summary")).statusCode).toBe(404);
  });
});
