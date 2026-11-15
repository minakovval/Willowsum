import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * FIN-03@PoC b) (wave 2 row 16b), through the real API on a real PostgreSQL: transfers between own accounts — the
 * proposals of «Пари · N» (FR 5, FR 6), «Підтвердити» and «Позначити як переказ» (FR 7, FR 27), the fee and the currency
 * difference in the journal (FR 8), removing the mark (FR 9), and a transfer never hidden or split (FR 18). Every name and
 * amount is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Transaction {
  id: string;
  type: string;
  hidden: boolean;
  transfer: {
    id: string;
    side: string;
    counterpartId: string;
    date: string;
    fee: { amount: string; currency: string } | null;
    rate: { rate: string; date: string; source: string } | null;
  } | null;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  principal: Principal = {},
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

async function createAccount(space: Space, amount: string, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency} ${randomUUID().slice(0, 6)}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string, date: string, currency = "EUR") {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний переказ",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Transaction;
}

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const proposals = async (space: Space, principal: Principal = {}) => {
  const res = await call(space, "GET", "/v1/transfer-proposals", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    more: boolean;
    items: {
      outflow: { transactionId: string };
      inflow: { transactionId: string };
      date: string;
      kind: string;
      fee: { amount: string } | null;
      converted: { amount: string; currency: string } | null;
      difference: { amount: string } | null;
      rate: { rate: string; date: string } | null;
    }[];
  };
};

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

/** The live journal entries of the space from the transactions module: [event type, operation date]. */
async function liveEntries(householdId: string): Promise<[string, string][]> {
  const { rows } = await db.owner.query(
    `SELECT e.event_type, e.operation_date::text AS d FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.recorded_at`,
    [householdId],
  );
  return rows.map((r: { event_type: string; d: string }) => [r.event_type, r.d]);
}

/**
 * What went through «Зовнішні кошти» from the space's transactions — every income and expense in effect, gross, per
 * currency (reversed entries and their reversals cancel out in pairs, so they are left out).
 */
async function externalFlow(householdId: string): Promise<Record<string, string>> {
  const { rows } = await db.owner.query(
    `SELECT p.currency, sum(p.amount)::text AS net
       FROM ledger.postings p
       JOIN ledger.entries e ON e.household_id = p.household_id AND e.id = p.entry_id
       JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'external-funds'
                             AND a.id IN (p.debit_account_id, p.credit_account_id)
      WHERE p.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      GROUP BY p.currency`,
    [householdId],
  );
  return Object.fromEntries(rows.map((r: { currency: string; net: string }) => [r.currency, r.net]));
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
        }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates: (requests) => fx.rates(requests),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
  // AC4: 43,50 UAH per EUR on the day of the debit.
  await rate("2026-10-14", "EUR", "43.5");
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

/** A space with A (1 000 EUR) and B (0 EUR) and the pair of AC2: −500 EUR on A, +498 EUR on B two days later. */
async function ac2() {
  const space = await newSpace();
  const a = await createAccount(space, "1000.00");
  const b = await createAccount(space, "0.00");
  const out = await add(space, a, "-500.00", "2026-10-13");
  const into = await add(space, b, "498.00", "2026-10-15");
  return { space, a, b, out, into };
}

describe("FIN-03@PoC FR 5, FR 6: «Пари · N» — the system proposes, the user decides", () => {
  it("FIN-03@PoC AC2: −500 EUR on A and +498 EUR on B two days later is proposed with a fee of 2 EUR; until accepted both stay an expense and income", async () => {
    const { space, a, b, out, into } = await ac2();
    const found = await proposals(space);
    expect(found.count).toBe(1);
    expect(found.items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      inflow: { transactionId: into.id },
      date: "2026-10-13",
      kind: "same-currency",
      fee: { amount: "-2" },
    });
    expect([await get(space, out.id), await get(space, into.id)]).toMatchObject([
      { type: "expense", transfer: null },
      { type: "income", transfer: null },
    ]);
    // FR 6: nothing is marked by the search — each still has its own event through «Зовнішні кошти».
    expect(await liveEntries(space.householdId)).toEqual([
      ["transaction", "2026-10-13"],
      ["transaction", "2026-10-15"],
    ]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "998.000000000000000000" });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
  });

  it("FIN-03@PoC FR 5: no proposal beyond 3 days, beyond 2 % in one currency, on one account, or for a hidden or pending side", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "0.00");
    await add(space, a, "-100.00", "2026-10-01");
    await add(space, b, "100.00", "2026-10-05"); // 4 days
    await add(space, a, "-200.00", "2026-10-08");
    await add(space, b, "195.00", "2026-10-08"); // 2,5 %
    await add(space, a, "-300.00", "2026-10-10");
    await add(space, a, "300.00", "2026-10-10"); // one account
    const hidden = await add(space, a, "-400.00", "2026-10-12");
    await add(space, b, "400.00", "2026-10-12");
    // FR 18: only a duplicate is hidden — its copy here is «Очікує», so no side of a proposal itself.
    const copy = await call(space, "POST", "/v1/transactions", {
      accountId: a,
      amount: { amount: "-400.00", currency: "EUR" },
      date: "2026-10-12",
      status: "pending",
    });
    expect(copy.statusCode, copy.body).toBe(201);
    expect((await call(space, "POST", `/v1/transactions/${hidden.id}/hide`)).statusCode).toBe(200);
    const pending = await call(space, "POST", "/v1/transactions", {
      accountId: a,
      amount: { amount: "-50.00", currency: "EUR" },
      date: "2026-10-14",
      status: "pending",
    });
    expect(pending.statusCode, pending.body).toBe(201);
    await add(space, b, "50.00", "2026-10-14");
    expect(await proposals(space)).toEqual({ items: [], count: 0, more: false });
  });

  it("FIN-03@PoC AC4: −1 000 EUR and +42 900 UAH a day later at 43,50 UAH per EUR are proposed as a currency transfer (1,38 % ≤ 3 %)", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "2000.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const out = await add(space, eur, "-1000.00", "2026-10-14");
    const into = await add(space, uah, "42900.00", "2026-10-15", "UAH");
    const found = await proposals(space);
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      inflow: { transactionId: into.id },
      date: "2026-10-14",
      kind: "cross-currency",
      fee: null,
      rate: { rate: "43.5", date: "2026-10-14" },
      converted: { amount: "43500", currency: "UAH" },
      difference: { amount: "-600" },
    });
  });
});

describe("FIN-03@PoC FR 7, FR 8: a confirmed pair is a transfer — neither income nor expense", () => {
  it("FIN-03@PoC AC3: «Підтвердити» −500 EUR / +498 EUR — both marked «Переказ», out of income and expenses; 2 EUR is the expense; net worth less by 2 EUR only", async () => {
    const { space, a, b, out, into } = await ac2();
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    const transfer = {
      id: res.json().transfer.id,
      date: "2026-10-13",
      fee: { amount: "-2", currency: "EUR" },
    };
    expect(res.json().transfer).toEqual({ ...transfer, side: "outflow", counterpartId: into.id, rate: null });
    expect((await get(space, into.id)).transfer).toEqual({
      ...transfer,
      side: "inflow",
      counterpartId: out.id,
      rate: null,
    });
    // The journal: one transfer event A → B of 498 EUR and the fee as the outflow's own event, both on the earlier date.
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transfer", "2026-10-13"],
    ]);
    // Only the fee leaves the space: net worth 1 000 → 998 EUR.
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    // FR 6: a confirmed pair is no proposal any more.
    expect((await proposals(space)).count).toBe(0);
  });

  it("FIN-03@PoC FR 8: a currency transfer keeps both actual amounts; the difference goes through «Валютна різниця» at the rate of the date", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "2000.00");
    const uah = await createAccount(space, "0.00", "UAH");
    const out = await add(space, eur, "-1000.00", "2026-10-14");
    const into = await add(space, uah, "42900.00", "2026-10-15", "UAH");
    const res = await mark(space, into.id, out.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer).toMatchObject({
      side: "inflow",
      date: "2026-10-14",
      fee: null,
      rate: { rate: "0.022988505747126437", date: "2026-10-14", source: "NBU" },
    });
    expect(await liveEntries(space.householdId)).toEqual([["fx-transfer", "2026-10-14"]]);
    expect(await externalFlow(space.householdId)).toEqual({});
    expect([await balance(space, eur), await balance(space, uah)]).toEqual(["1000", "42900"]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM ledger.postings p
         JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'fx-difference'
                               AND a.id IN (p.debit_account_id, p.credit_account_id)
        WHERE p.household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(2);
  });

  it("FIN-03@PoC FR 8: a currency transfer needs the official rate of its date; without one nothing is marked", async () => {
    const space = await newSpace();
    const eur = await createAccount(space, "100.00");
    const pln = await createAccount(space, "0.00", "PLN");
    const out = await add(space, eur, "-10.00", "2026-10-14");
    const into = await add(space, pln, "42.00", "2026-10-14", "PLN");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "rate_unavailable" }]);
    expect((await get(space, out.id)).transfer).toBeNull();
  });

  it("FIN-03@PoC EC1: a transfer whose sides have different dates is accounted on the earlier side's date", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-60.00", "2026-10-13");
    const into = await add(space, b, "60.00", "2026-10-11");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer).toMatchObject({ date: "2026-10-11", fee: null });
    expect(await liveEntries(space.householdId)).toEqual([["transfer", "2026-10-11"]]);
  });

  it("FIN-03@PoC FR 27: «Позначити як переказ» pairs two transactions the search did not propose; the credit may not exceed the debit", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-40.00", "2026-10-01");
    const far = await add(space, b, "30.00", "2026-10-09");
    const more = await add(space, b, "41.00", "2026-10-01");
    expect((await proposals(space)).count).toBe(0);
    const bad = await mark(space, out.id, more.id);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "amount_mismatch" }]);
    const res = await mark(space, out.id, far.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer).toMatchObject({ date: "2026-10-01", fee: { amount: "-10" } });
    // A side is in one transfer at most.
    const again = await mark(space, more.id, out.id);
    expect(again.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "in_transfer" }]);
  });

  it("FIN-03@PoC FR 22, FR 23: «Стан: переказ» lists the transfer's two sides — visible in the lists of both accounts", async () => {
    const { space, a, b, out, into } = await ac2();
    await mark(space, out.id, into.id);
    await add(space, a, "-5.00", "2026-10-16");
    const listed = (await call(space, "GET", "/v1/transactions?filter=transfer.eq:true")).json();
    expect(listed.items.map((t: Transaction) => t.id).sort()).toEqual([out.id, into.id].sort());
    expect(listed.items.every((t: Transaction) => t.transfer !== null)).toBe(true);
    const onB = (await call(space, "GET", `/v1/transactions?filter=accountId.eq:${b}`)).json();
    expect(onB.items).toMatchObject([{ id: into.id, transfer: { side: "inflow", counterpartId: out.id } }]);
    const others = (await call(space, "GET", "/v1/transactions?filter=transfer.eq:false")).json();
    expect(others.count).toBe(1);
  });

  it("FIN-03@PoC FR 20: marking and removing a transfer are in the audit log of both transactions", async () => {
    const { space, out, into } = await ac2();
    const marked = await mark(space, out.id, into.id);
    await call(space, "DELETE", `/v1/transactions/${into.id}/transfer`);
    for (const [id, side, other] of [
      [out.id, "outflow", into.id],
      [into.id, "inflow", out.id],
    ] as const) {
      const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
      const fields = (i: number) =>
        Object.fromEntries(log[i]!.changes.map((ch) => [ch.field, [ch.before, ch.after]]));
      expect(log.map((e) => e.action)).toEqual(["create", "update", "update"]);
      expect(fields(1)).toEqual({ "transfer.side": [null, side], "transfer.with": [null, other] });
      expect(fields(2)).toEqual({ "transfer.side": [side, null], "transfer.with": [other, null] });
    }
    expect(marked.statusCode).toBe(200);
  });
});

describe("FIN-03@PoC FR 9: the mark can be removed — income and expense again", () => {
  it("FIN-03@PoC FR 9: removing the mark returns both transactions to an expense and income; the balances stay, the pair is proposed again", async () => {
    const { space, a, b, out, into } = await ac2();
    await mark(space, out.id, into.id);
    const res = await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ type: "expense", transfer: null });
    expect((await get(space, into.id)).transfer).toBeNull();
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transaction", "2026-10-15"],
    ]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "998.000000000000000000" });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    expect((await proposals(space)).count).toBe(1);
    // Removing it again changes nothing; marking again makes a new transfer.
    expect((await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`)).statusCode).toBe(200);
    const again = await mark(space, into.id, out.id);
    expect(again.statusCode, again.body).toBe(200);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
  });
});

describe("FIN-03@PoC FR 18: a transfer between own accounts is never hidden or split", () => {
  it("FIN-03@PoC FR 18: hiding or splitting a side of a transfer is refused (409); nothing is written", async () => {
    const { space, out, into } = await ac2();
    await mark(space, out.id, into.id);
    const hide = await call(space, "POST", `/v1/transactions/${into.id}/hide`);
    expect(hide.statusCode).toBe(409);
    expect(hide.json().code).toBe("TRANSACTION_IN_TRANSFER");
    const categories = (await call(space, "GET", "/v1/categories"))
      .json()
      .groups.flatMap((g: { categories: { id: string; kind: string }[] }) => g.categories);
    const food = categories.find((c: { kind: string }) => c.kind === "expense").id;
    const split = await call(space, "POST", `/v1/transactions/${out.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: food,
    });
    expect(split.statusCode).toBe(409);
    expect(await get(space, into.id)).toMatchObject({ hidden: false });
    expect((await get(space, out.id)).transfer).not.toBeNull();
  });

  it("FIN-03@PoC FR 18: a hidden or split transaction cannot be marked as a transfer", async () => {
    const { space, b, out, into } = await ac2();
    await add(space, b, "498.00", "2026-10-15"); // FR 18: a duplicate, so it may be hidden
    expect((await call(space, "POST", `/v1/transactions/${into.id}/hide`)).statusCode).toBe(200);
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "hidden" }]);
  });

  it("FIN-03@PoC FR 9: a side's account, amount, date and state change, and it is deleted, only once the mark is removed; its texts change", async () => {
    const { space, a, out, into } = await ac2();
    await mark(space, out.id, into.id);
    for (const change of [
      { amount: { amount: "-501.00", currency: "EUR" } },
      { date: "2026-10-14" },
      { status: "pending" },
    ]) {
      const res = await call(space, "PATCH", `/v1/transactions/${out.id}`, change);
      expect(res.statusCode, JSON.stringify(change)).toBe(409);
      expect(res.json().code).toBe("TRANSACTION_IN_TRANSFER");
    }
    expect((await call(space, "DELETE", `/v1/transactions/${into.id}`)).statusCode).toBe(409);
    const text = await call(space, "PATCH", `/v1/transactions/${out.id}`, {
      description: "Синтетичне поповнення",
    });
    expect(text.statusCode, text.body).toBe(200);
    expect(text.json().transfer).toMatchObject({ counterpartId: into.id });
    expect(await balance(space, a)).toBe("500");
  });
});

describe("FIN-03@PoC «Права доступу»: transfers are the space's own", () => {
  it("FIN-03@PoC AC11: a transaction of another space is «not found» as the one acted on and as the other side; no proposal crosses spaces", async () => {
    const mine = await ac2();
    const theirs = await ac2();
    expect((await mark(mine.space, theirs.out.id, mine.into.id)).statusCode).toBe(404);
    const cross = await mark(mine.space, mine.out.id, theirs.into.id);
    expect(cross.statusCode).toBe(400);
    expect(cross.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "not_found" }]);
    expect((await call(mine.space, "DELETE", `/v1/transactions/${theirs.out.id}/transfer`)).statusCode).toBe(
      404,
    );
    const found = await proposals(mine.space);
    expect(found.items.map((p) => p.outflow.transactionId)).toEqual([mine.out.id]);
    expect((await get(theirs.space, theirs.out.id)).transfer).toBeNull();
  });

  it("FIN-03@PoC AC12: the candidate pairs are bound to the space by the row policy too (no household filter in SQL)", async () => {
    const mine = await ac2();
    const theirs = await ac2();
    const txDb = db.databases.for("transactions");
    // The module's own role in the other space's context, asked without any filter: none of this space's rows.
    const seen = await txDb.inHousehold(
      theirs.space.householdId,
      async (q) =>
        (await q.query<{ id: string }>(`SELECT id FROM transfers UNION ALL SELECT id FROM transactions`))
          .rows,
    );
    expect(seen.map((r) => r.id)).not.toContain(mine.out.id);
    const pairs = await createTransferCandidates(txDb).candidatePairs(mine.space.householdId, {
      windowDays: 3,
      sameCurrencyMinShare: "0.98",
      limit: 10,
    });
    expect(pairs.map((p) => p.outflow.transactionId)).toEqual([mine.out.id]);
  });

  it.each(["owner", "admin", "editor"])(
    "FIN-03@PoC «Права доступу»: a %s sees proposals, marks and removes a transfer",
    async (role) => {
      const { space, out, into } = await ac2();
      expect((await proposals(space, { role })).count).toBe(1);
      expect((await mark(space, out.id, into.id, { role })).statusCode).toBe(200);
      expect(
        (await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`, undefined, { role })).statusCode,
      ).toBe(200);
    },
  );

  it.each([
    ["viewer", {}],
    ["advisor", {}],
    ["editor", { scoped: true }],
  ] as const)(
    "FIN-03@PoC «Права доступу»: a %s %o may not mark or remove a transfer (403); nothing written",
    async (role, extra) => {
      const { space, out, into } = await ac2();
      const who = { role, ...extra };
      expect((await mark(space, out.id, into.id, who)).statusCode).toBe(403);
      await mark(space, out.id, into.id);
      expect(
        (await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`, undefined, who)).statusCode,
      ).toBe(403);
      expect((await get(space, out.id)).transfer).not.toBeNull();
      // A scoped member does not even see the space's proposals (the visibility policy's default).
      if ("scoped" in extra)
        expect((await call(space, "GET", "/v1/transfer-proposals", undefined, who)).statusCode).toBe(404);
    },
  );

  it("FIN-03@PoC «Права доступу»: on a closed account a transfer is not marked (409)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "10.00");
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-10.00", "2026-10-13");
    const into = await add(space, b, "10.00", "2026-10-13");
    const closed = await call(space, "POST", `/v1/accounts/${a}/close`, { closedOn: TODAY });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await mark(space, out.id, into.id)).statusCode).toBe(409);
  });

  it("FIN-03@PoC FR 27: transfers are behind the flag `transactions.transfers` — off, the routes are not there", async () => {
    const { space, out, into } = await ac2();
    off.add("transactions.transfers");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/transfer-proposals")).statusCode).toBe(404);
    expect((await get(space, out.id)).transfer).toBeNull();
  });
});

describe("ARC-04@PoC FR 2–4: a transfer's journal follows the commit, from the worker if need be", () => {
  async function runWorker(householdId: string): Promise<void> {
    const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
    try {
      // Other modules' jobs of the space (accounts, ledger) share the worker's slots: pass until nothing is left.
      for (let pass = 0; pass < 10; pass++) {
        const handled = await worker.tick();
        await worker.idle();
        if (handled === 0) break;
      }
    } finally {
      await worker.stop();
    }
  }

  it("ARC-04@PoC FR 4: a transfer's hand-off the worker gave up on (dead) goes back with the daily recovery and the journal comes right", async () => {
    const { space, a, b, out, into } = await ac2();
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    const res = await mark(space, out.id, into.id);
    // The mark is made; the journal is not yet: the request answers as usual.
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );
    const dead = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    expect(dead.rows[0].n).toBeGreaterThan(0);
    const recovery = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    }).find((t) => t.name === "transactions.hand-off-recovery");
    await recovery!.run();
    await runWorker(space.householdId);
    const left = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );
    expect(left.rows[0].n).toBe(0);
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transfer", "2026-10-13"],
    ]);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
  });
});
