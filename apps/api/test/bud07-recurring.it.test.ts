import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import { createRecurringServices } from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-07@PoC a1) (wave 2 row 25): the proposals of regular payments through the real API on a real PostgreSQL — the
 * series of one merchant's charges in the last 430 days (FR 1, FR 2, AC1, AC6), variable and several-price series
 * (FR 3), what a proposal shows and which charges never make one (FR 4), a new read sees new transactions (FR 5),
 * another space, a scoped member and the release flag. Every description and amount is synthetic; the clock is fixed
 * (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const FLAG = "recurring.payments";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface ProposalBody {
  key: string;
  merchant: { id: string; name: string };
  type: "expense" | "income";
  frequency: string;
  variable: boolean;
  expectedAmount: { amount: string; currency: string };
  nextDate: string;
  lastDate: string;
  accountId: string;
  transactionIds: string[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST",
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

async function createAccount(space: Space, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** A transaction: `amount` signed (minus — an expense). */
async function tx(
  space: Space,
  accountId: string,
  date: string,
  amount: string,
  counterparty?: string,
  currency = "EUR",
): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    ...(counterparty !== undefined ? { counterparty } : {}),
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function proposals(space: Space): Promise<ProposalBody[]> {
  const res = await call(space, "GET", "/v1/recurring/proposals");
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().more).toBe(false);
  return res.json().items as ProposalBody[];
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          walletUsage: [],
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        recurring: createRecurringServices({
          history: createTransactionHistory(db.databases.for("transactions")),
          merchants: createMerchantDirectory(db.databases.for("merchants")),
          accounts: createAccountDirectory(db.databases.for("accounts")),
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
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

beforeEach(() => {
  off.clear();
});

describe("BUD-07@PoC FR 1, FR 2, FR 4: a series of one merchant's charges is proposed with its frequency, expected amount and date", () => {
  it("BUD-07@PoC AC1: three charges to one merchant ≈ 30 days apart, ± 10 % — a monthly proposal with frequency, amount and date", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const ids = [
      await tx(space, account, "2026-08-14", "-15.49", "NETFLIX.COM 8812"),
      await tx(space, account, "2026-09-14", "-15.49", "NETFLIX.COM 8812"),
      await tx(space, account, "2026-10-13", "-16.20", "NETFLIX.COM 8812"),
    ];
    await tx(space, account, "2026-10-20", "-42.00", "SYNTH MARKET 0091");
    expect(await proposals(space)).toEqual([
      {
        key: expect.any(String),
        merchant: { id: expect.any(String), name: "Netflix.com" },
        type: "expense",
        frequency: "month",
        variable: false,
        expectedAmount: { amount: "16.2", currency: "EUR" },
        nextDate: "2026-12-13",
        lastDate: "2026-10-13",
        accountId: account,
        transactionIds: ids,
      },
    ]);
  });

  it("BUD-07@PoC AC6: a yearly subscription with two charges 365 days apart — a yearly proposal", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await tx(space, account, "2025-10-01", "-59.99", "SYNTH CLOUD STORAGE");
    await tx(space, account, "2026-10-01", "-59.99", "SYNTH CLOUD STORAGE");
    expect(await proposals(space)).toMatchObject([
      { frequency: "year", variable: false, expectedAmount: { amount: "59.99" }, nextDate: "2027-10-01" },
    ]);
  });

  it("BUD-07@PoC FR 1: the last 430 days, today included — a charge 430 days ago is outside the window", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    // Today − 429 days = 13.09.2025 is the first day of the window; 12.09.2025 is not in it.
    await tx(space, account, "2025-09-12", "-80.00", "SYNTH INSURANCE");
    await tx(space, account, "2026-09-12", "-80.00", "SYNTH INSURANCE");
    await tx(space, account, "2025-09-13", "-30.00", "SYNTH DOMAIN");
    await tx(space, account, "2026-09-13", "-30.00", "SYNTH DOMAIN");
    expect((await proposals(space)).map((p) => p.merchant.name)).toEqual(["Synth Domain"]);
  });

  it("BUD-07@PoC FR 1: merchants are grouped by the cleaned counterparty — terminal prefixes, store numbers and cities apart", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const ids = [
      await tx(space, account, "2026-09-05", "-40.00", "SUMUP *SPORTLIFE 0012 KYIV UA"),
      await tx(space, account, "2026-10-05", "-40.00", "SPORTLIFE 4411"),
      await tx(space, account, "2026-11-05", "-40.00", "POS SPORTLIFE"),
    ];
    expect(await proposals(space)).toMatchObject([
      { merchant: { name: "Sportlife" }, frequency: "month", transactionIds: ids, nextDate: "2026-12-05" },
    ]);
  });

  it("BUD-07@PoC FR 1: merchants merged with «Об'єднати з…» (BUD-14) are one merchant for the analysis", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await tx(space, account, "2026-09-05", "-25.00", "SYNTH GYM");
    await tx(space, account, "2026-10-05", "-25.00", "SYNTH FITNESS CLUB");
    await tx(space, account, "2026-11-05", "-25.00", "SYNTH FITNESS CLUB");
    expect(await proposals(space)).toEqual([]);
    const target = (await call(space, "GET", `/v1/transactions/${a}/merchant`)).json().merchant.id as string;
    const listed = (await call(space, "GET", "/v1/merchants")).json().items as { id: string; name: string }[];
    const source = listed.find((m) => m.name === "Synth Fitness Club")!.id;
    expect(
      (await call(space, "POST", `/v1/merchants/${target}/merge`, { merchantId: source })).statusCode,
    ).toBe(200);
    expect(await proposals(space)).toMatchObject([
      { merchant: { id: target, name: "Synth GYM" }, frequency: "month" },
    ]);
  });

  it("BUD-07@PoC FR 1: a regular income is proposed too — type «дохід»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-10", "2026-09-10", "2026-10-09", "2026-11-10"])
      await tx(space, account, date, "2400.00", "ТОВ СИНТЕТИЧНА КОМПАНІЯ");
    expect(await proposals(space)).toMatchObject([
      {
        type: "income",
        frequency: "month",
        expectedAmount: { amount: "2400", currency: "EUR" },
        nextDate: "2026-12-10",
      },
    ]);
  });
});

describe("BUD-07@PoC FR 3: variable series and several series of one merchant", () => {
  it("BUD-07@PoC EC1: utilities with a varying amount — «змінна», expected = the average of the last 3", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const [date, amount] of [
      ["2026-07-20", "-40.00"],
      ["2026-08-20", "-70.00"],
      ["2026-09-21", "-55.00"],
      ["2026-10-20", "-90.00"],
    ] as const)
      await tx(space, account, date, amount, "SYNTH ENERGY SUPPLY");
    expect(await proposals(space)).toMatchObject([
      { frequency: "month", variable: true, expectedAmount: { amount: "71.67" }, nextDate: "2026-11-20" },
    ]);
  });

  it("BUD-07@PoC FR 3: two subscriptions of one merchant at different prices are proposed separately", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-07-31", "2026-08-30", "2026-09-29", "2026-10-29"])
      await tx(space, account, date, "-0.99", "SYNTH APPS STORE");
    for (const date of ["2026-07-15", "2026-08-14", "2026-09-13", "2026-10-13"])
      await tx(space, account, date, "-9.99", "SYNTH APPS STORE");
    const found = await proposals(space);
    expect(found.map((p) => [p.expectedAmount.amount, p.frequency, p.nextDate])).toEqual([
      ["0.99", "month", "2026-11-29"],
      ["9.99", "month", "2026-12-13"],
    ]);
    expect(new Set(found.map((p) => p.merchant.id)).size).toBe(1);
  });

  it("BUD-07@PoC FR 2: a series in another currency is its own; amounts are compared in their currency", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { balance: { amount: "100.00", currency: "GBP" } });
    for (const date of ["2026-09-03", "2026-10-03", "2026-11-03"])
      await tx(space, account, date, "-10.00", "SYNTH NEWS", "GBP");
    expect(await proposals(space)).toMatchObject([
      { frequency: "month", expectedAmount: { amount: "10", currency: "GBP" } },
    ]);
  });
});

describe("BUD-07@PoC FR 1, FR 4: charges that never make a proposal", () => {
  it("BUD-07@PoC FR 1: hidden transactions, sides of a transfer and transactions without a counterparty are not analysed", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const hidden = [
      await tx(space, account, "2026-09-02", "-12.00", "SYNTH HIDDEN"),
      await tx(space, account, "2026-10-02", "-12.00", "SYNTH HIDDEN"),
      await tx(space, account, "2026-11-02", "-12.00", "SYNTH HIDDEN"),
    ];
    const transfer = [
      await tx(space, account, "2026-09-02", "-300.00", "SYNTH SAVINGS"),
      await tx(space, account, "2026-10-02", "-300.00", "SYNTH SAVINGS"),
      await tx(space, account, "2026-11-02", "-300.00", "SYNTH SAVINGS"),
    ];
    for (const date of ["2026-09-04", "2026-10-04", "2026-11-04"]) await tx(space, account, date, "-7.00");
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = ANY($2::uuid[])`,
      [space.householdId, hidden],
    );
    await db.owner.query(
      `UPDATE transactions.transactions SET transfer_id = gen_random_uuid() WHERE household_id = $1 AND id = ANY($2::uuid[])`,
      [space.householdId, transfer],
    );
    expect(await proposals(space)).toEqual([]);
  });

  it("BUD-07@PoC FR 4: no proposals from a «Кредит» account — its payments are the account's monthly payment", async () => {
    const space = await newSpace();
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Синтетичний кредит",
      institution: { name: "Синтетичний банк", country: "UA" },
      balance: { amount: "5000.00", currency: "EUR" },
      annualRate: "12.5",
      monthlyPayment: "250.00",
    });
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Синтетична картка",
      balance: { amount: "300.00", currency: "EUR" },
      annualRate: "30",
      creditLimit: "2000.00",
    });
    for (const date of ["2026-09-07", "2026-10-07", "2026-11-07"]) {
      await tx(space, loan, date, "250.00", "SYNTH BANK LOAN");
      await tx(space, card, date, "-5.99", "SYNTH MUSIC");
    }
    expect((await proposals(space)).map((p) => [p.merchant.name, p.accountId])).toEqual([
      ["Synth Music", card],
    ]);
  });
});

describe("BUD-07@PoC FR 5, AC9: a new analysis on every read; the space's own transactions only", () => {
  it("BUD-07@PoC FR 5: the analysis runs again when the screen is opened — a new charge makes a proposal at once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await tx(space, account, "2026-09-11", "-8.00", "SYNTH PODCASTS");
    await tx(space, account, "2026-10-11", "-8.00", "SYNTH PODCASTS");
    expect(await proposals(space)).toEqual([]);
    await tx(space, account, "2026-11-11", "-8.00", "SYNTH PODCASTS");
    expect(await proposals(space)).toMatchObject([{ frequency: "month", nextDate: "2026-12-11" }]);
  });

  it("BUD-07@PoC AC9: another space's transactions never appear — its series are not proposed, counted or summed here", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const account = await createAccount(owner);
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      await tx(owner, account, date, "-15.49", "NETFLIX.COM 8812");
    expect(await proposals(owner)).toHaveLength(1);
    expect(await proposals(other)).toEqual([]);
    // Another space's id in the session's place gets that space's own proposals only — none of the owner's.
    const res = await call(other, "GET", "/v1/recurring/proposals");
    expect(res.body).not.toContain(account);
  });

  it("BUD-07@PoC «Права доступу»: a scoped member — not found; behind the release flag recurring.payments — off, not found", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      await tx(space, account, date, "-15.49", "NETFLIX.COM 8812");
    expect(
      (await call(space, "GET", "/v1/recurring/proposals", undefined, { role: "editor", scoped: true }))
        .statusCode,
    ).toBe(404);
    off.add(FLAG);
    expect((await call(space, "GET", "/v1/recurring/proposals")).statusCode).toBe(404);
  });
});
