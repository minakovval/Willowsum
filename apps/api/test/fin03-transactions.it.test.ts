import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createTransactionsErasure, createTransactionsServices } from "../src/modules/transactions/index.ts";

/**
 * FIN-03@PoC a) (wave 2 row 15), through the real API on a real PostgreSQL: a transaction entered by hand is one
 * journal event on its account's subaccount, changed by a correction and deleted by a reversal; the list «Транзакції»
 * runs on the universal list engine (DAT-01) with its whitelists, numbered pages and the totals of income, expenses
 * and the difference in the profile currency at the official rate of each transaction's date. Every name and amount
 * is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
/** «Today» of these tests (Kyiv and UTC). */
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
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

async function createAccount(
  space: Space,
  body: { kind?: string; name: string; amount: string; currency?: string },
): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: body.kind ?? "current",
    name: body.name,
    balance: { amount: body.amount, currency: body.currency ?? "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const tx = (
  accountId: string,
  amount: string,
  extra: { currency?: string; date?: string; counterparty?: string; description?: string } = {},
) => ({
  accountId,
  amount: { amount, currency: extra.currency ?? "EUR" },
  date: extra.date ?? "2026-10-15",
  ...(extra.counterparty !== undefined ? { counterparty: extra.counterparty } : {}),
  ...(extra.description !== undefined ? { description: extra.description } : {}),
});

async function add(space: Space, body: ReturnType<typeof tx>, principal: Principal = {}) {
  const res = await call(space, "POST", "/v1/transactions", body, principal);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; amount: { amount: string; currency: string }; type: string };
}

const balance = async (space: Space, accountId: string, currency?: string) => {
  const account = (await call(space, "GET", `/v1/accounts/${accountId}`)).json();
  const c = (account.currencies as { currency: string; balance: { amount: string } }[]).find(
    (x) => currency === undefined || x.currency === currency,
  );
  return c?.balance.amount;
};

async function entries(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT id, source_module, source_id, event_type, operation_date::text AS operation_date, reverses_entry_id
       FROM ledger.entries WHERE household_id = $1 ORDER BY recorded_at, id`,
    [householdId],
  );
  return rows as {
    id: string;
    source_module: string;
    source_id: string;
    event_type: string;
    operation_date: string;
    reverses_entry_id: string | null;
  }[];
}

const transactionEntries = async (householdId: string) =>
  (await entries(householdId)).filter((e) => e.source_module === "transactions");

const rows = async (householdId: string) =>
  Number(
    (
      await db.owner.query(
        `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1`,
        [householdId],
      )
    ).rows[0]!.n,
  );

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
    [date, currency, uah],
  );
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
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
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
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

beforeEach(() => off.clear());

describe("FIN-03@PoC FR 1–3: «Нова транзакція» is one journal event; the balance is recounted at once", () => {
  it("FIN-03@PoC AC1: 1 000 EUR, the Owner adds −45,50 EUR with date, counterparty, description, «Проведена» → in the list, balance 954,50 EUR", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "1000.00" });
    const created = await add(
      space,
      tx(account, "-45.50", {
        date: "2026-10-14",
        counterparty: "Сільпо",
        description: "Продукти на тиждень",
      }),
    );
    expect(created).toMatchObject({
      accountId: account,
      amount: { amount: "-45.5", currency: "EUR" },
      type: "expense",
      date: "2026-10-14",
      counterparty: "Сільпо",
      description: "Продукти на тиждень",
      status: "posted",
      source: "manual",
    });
    expect(await balance(space, account)).toBe("954.5");
    const list = (await call(space, "GET", "/v1/transactions")).json();
    expect(list.items.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(list.items[0]).toMatchObject({ counterparty: "Сільпо", date: "2026-10-14", status: "posted" });
    expect(list.items[0].recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect((await call(space, "GET", `/v1/transactions/${created.id}`)).json()).toEqual(list.items[0]);
  });

  it("FIN-03@PoC FR 3: each transaction is one `transaction` event of the journal with the transaction as its source; plus is income, minus an expense", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const income = await add(space, tx(account, "2500.00", { counterparty: "Синтетичний роботодавець" }));
    const expense = await add(space, tx(account, "-12.40"));
    expect([income.type, expense.type]).toEqual(["income", "expense"]);
    const posted = await transactionEntries(space.householdId);
    expect(posted).toEqual([
      expect.objectContaining({
        source_id: income.id,
        event_type: "transaction",
        operation_date: "2026-10-15",
      }),
      expect.objectContaining({
        source_id: expense.id,
        event_type: "transaction",
        operation_date: "2026-10-15",
      }),
    ]);
    expect(await balance(space, account)).toBe("2587.6");
  });

  it("FIN-03@PoC FR 3: on a credit card a purchase increases the debt, a payment decreases it", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Кредитна картка",
      amount: "100.00",
    });
    await add(space, tx(card, "-45.50", { counterparty: "Синтетична АЗС" }));
    let account = (await call(space, "GET", `/v1/accounts/${card}`)).json();
    expect(account.creditCard.debt).toEqual({ amount: "145.5", currency: "EUR" });
    await add(space, tx(card, "100.00"));
    account = (await call(space, "GET", `/v1/accounts/${card}`)).json();
    expect(account.creditCard.debt).toEqual({ amount: "45.5", currency: "EUR" });
  });

  it("FIN-03@PoC FR 2: on a multi-currency account the amount goes to the subaccount of its currency", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Мультивалютний",
      balance: { amount: "100.00", currency: "EUR" },
      balanceDate: "2026-01-01",
      extraCurrencies: [{ amount: "50.00", currency: "USD", date: "2026-01-01" }],
    });
    const account = res.json().id as string;
    await add(space, tx(account, "-20.00", { currency: "USD" }));
    expect(await balance(space, account, "USD")).toBe("30");
    expect(await balance(space, account, "EUR")).toBe("100");
  });

  it("FIN-03@PoC EC2: a currency other than the account's on a single-currency account is refused («Валюта не відповідає рахунку»); nothing written", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Гривневий", amount: "1000.00", currency: "UAH" });
    const res = await call(space, "POST", "/v1/transactions", tx(account, "-10.00", { currency: "EUR" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "amount.currency", issue: "currency_mismatch" }]);
    expect(await rows(space.householdId)).toBe(0);
    expect(await transactionEntries(space.householdId)).toEqual([]);
    expect(await balance(space, account)).toBe("1000");
  });

  it("FIN-03@PoC FR 29: «Дата» may be today, never after it; FR 32: «Рахунок» is required and must be the space's; 0 and malformed amounts are refused", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "10.00" });
    expect(
      (await call(space, "POST", "/v1/transactions", tx(account, "-1.00", { date: TODAY }))).statusCode,
    ).toBe(201);
    const future = await call(
      space,
      "POST",
      "/v1/transactions",
      tx(account, "-1.00", { date: "2026-10-18" }),
    );
    expect(future.statusCode).toBe(400);
    expect(future.json().errors).toEqual([{ in: "body", path: "date", issue: "date_in_future" }]);
    const unknown = await call(space, "POST", "/v1/transactions", tx(randomUUID(), "-1.00"));
    expect(unknown.json().errors).toEqual([{ in: "body", path: "accountId", issue: "not_found" }]);
    const missing = await call(space, "POST", "/v1/transactions", {
      amount: { amount: "-1", currency: "EUR" },
    });
    expect(missing.statusCode).toBe(400);
    for (const [amount, issue] of [
      ["0.00", "zero"],
      ["-1.005", "invalid"],
      ["1e3", "invalid"],
      ["-", "invalid"],
    ] as const) {
      const res = await call(space, "POST", "/v1/transactions", tx(account, amount));
      expect(res.json().errors, amount).toEqual([{ in: "body", path: "amount", issue }]);
    }
    expect(await rows(space.householdId)).toBe(1);
  });

  it("FIN-03@PoC FR 1: a repeated create with the same Idempotency-Key makes one transaction and one journal event", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "10.00" });
    const key = { "idempotency-key": randomUUID() };
    const first = await call(space, "POST", "/v1/transactions", tx(account, "-3.00"), {}, key);
    const again = await call(space, "POST", "/v1/transactions", tx(account, "-3.00"), {}, key);
    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    expect(again.json().id).toBe(first.json().id);
    expect(await rows(space.householdId)).toBe(1);
    expect(await transactionEntries(space.householdId)).toHaveLength(1);
    expect(await balance(space, account)).toBe("7");
  });
});

describe("FIN-03@PoC FR 2, FR 16: change and delete through the journal", () => {
  it("FIN-03@PoC FR 2: changing the amount, date or account corrects the journal event; the balances follow at once", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "1000.00" });
    const b = await createAccount(space, { name: "Ощадний", kind: "savings", amount: "500.00" });
    const t = await add(space, tx(a, "-45.50", { counterparty: "Сільпо" }));

    const changed = await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      amount: { amount: "-60.00", currency: "EUR" },
      date: "2026-10-10",
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ amount: { amount: "-60", currency: "EUR" }, date: "2026-10-10" });
    expect(await balance(space, a)).toBe("940");

    const moved = await call(space, "PATCH", `/v1/transactions/${t.id}`, { accountId: b });
    expect(moved.json()).toMatchObject({ accountId: b, counterparty: "Сільпо" });
    expect([await balance(space, a), await balance(space, b)]).toEqual(["1000", "440"]);

    // Create, then two corrections: each a reversal and a new entry; one entry in effect, dated as changed.
    const journal = await transactionEntries(space.householdId);
    expect(journal.map((e) => e.event_type).sort()).toEqual([
      "reversal",
      "reversal",
      "transaction",
      "transaction",
      "transaction",
    ]);
    const reversed = new Set(journal.map((e) => e.reverses_entry_id).filter((id) => id !== null));
    const live = journal.filter((e) => e.event_type === "transaction" && !reversed.has(e.id));
    expect(live.map((e) => [e.source_id, e.operation_date])).toEqual([[t.id, "2026-10-10"]]);
  });

  it("FIN-03@PoC FR 2: changing only the counterparty or description writes no journal entry; an unchanged save writes nothing", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const t = await add(space, tx(a, "-5.00", { counterparty: "Кав'ярня" }));
    const res = await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      counterparty: null,
      description: "Кава з колегою",
    });
    expect(res.json()).toMatchObject({ counterparty: null, description: "Кава з колегою" });
    await call(space, "PATCH", `/v1/transactions/${t.id}`, { description: "Кава з колегою" });
    expect(await transactionEntries(space.householdId)).toHaveLength(1);
    const actions = (
      await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id })
    ).map((e) => e.action);
    expect(actions).toEqual(["create", "update"]);
  });

  it("FIN-03@PoC EC2: moving a transaction to an account of another currency without its amount is refused; nothing changes", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const uah = await createAccount(space, { name: "Гривневий", amount: "100.00", currency: "UAH" });
    const t = await add(space, tx(a, "-5.00"));
    const res = await call(space, "PATCH", `/v1/transactions/${t.id}`, { accountId: uah });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "amount.currency", issue: "currency_mismatch" }]);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().accountId).toBe(a);
    expect(await transactionEntries(space.householdId)).toHaveLength(1);
  });

  it("FIN-03@PoC AC10: deleting a transaction entered by hand reverses its postings; the balance is back to what it was", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "1000.00" });
    const t = await add(space, tx(a, "-45.50"));
    expect(await balance(space, a)).toBe("954.5");
    const res = await call(space, "DELETE", `/v1/transactions/${t.id}`);
    expect(res.statusCode).toBe(200);
    expect(await balance(space, a)).toBe("1000");
    const journal = await transactionEntries(space.householdId);
    expect(journal.map((e) => [e.event_type, e.reverses_entry_id])).toEqual([
      ["transaction", null],
      ["reversal", journal[0]!.id],
    ]);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/transactions")).json().count).toBe(0);
    expect((await call(space, "DELETE", `/v1/transactions/${t.id}`)).statusCode).toBe(404);
  });

  it("FIN-12@PoC FR 8 via FIN-03: a closed account is read only — no new, changed or deleted transaction (409 ACCOUNT_CLOSED)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Старий", amount: "0.00" });
    const kept = await add(space, tx(a, "10.00"));
    await add(space, tx(a, "-10.00"));
    expect((await call(space, "POST", `/v1/accounts/${a}/close`, { closedOn: TODAY })).statusCode).toBe(200);
    const results = [
      await call(space, "POST", "/v1/transactions", tx(a, "-1.00")),
      await call(space, "PATCH", `/v1/transactions/${kept.id}`, { description: "Пізніше" }),
      await call(space, "DELETE", `/v1/transactions/${kept.id}`),
    ];
    expect(results.map((r) => [r.statusCode, r.json().code])).toEqual([
      [409, "ACCOUNT_CLOSED"],
      [409, "ACCOUNT_CLOSED"],
      [409, "ACCOUNT_CLOSED"],
    ]);
    expect(await rows(space.householdId)).toBe(2);
  });
});

describe("FIN-03@PoC FR 20: every change is in the space's audit log", () => {
  it("FIN-03@PoC FR 20: create, update and delete each write an entry with the fields before and after; the texts masked", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const t = await add(space, tx(a, "-5.00", { counterparty: "Синтетична Особа", description: "Борг" }));
    await call(space, "PATCH", `/v1/transactions/${t.id}`, { amount: { amount: "-7.00", currency: "EUR" } });
    await call(space, "DELETE", `/v1/transactions/${t.id}`);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id });
    expect(log.map((e) => e.action)).toEqual(["create", "update", "delete"]);
    expect(log.every((e) => e.actorKind === "user" && e.actorId === space.accountId)).toBe(true);
    const field = (i: number, name: string) => log[i]!.changes.find((c) => c.field === name);
    expect(field(0, "amount")).toMatchObject({ before: null, after: "-5" });
    expect(field(0, "counterparty")).toMatchObject({ after: AUDIT_MASK, masked: true });
    expect(field(0, "description")).toMatchObject({ after: AUDIT_MASK, masked: true });
    expect(log[1]!.changes.map((c) => c.field)).toEqual(["amount"]);
    expect(field(1, "amount")).toMatchObject({ before: "-5", after: "-7" });
    expect(field(2, "amount")).toMatchObject({ before: "-7", after: null });
    expect(JSON.stringify(log)).not.toContain("Синтетична Особа");
  });
});

describe("FIN-03@PoC FR 13, FR 22: the list on the universal list engine (DAT-01)", () => {
  it("FIN-03@PoC AC7: thousands of transactions on several accounts — by account and period, sorted by amount, searched by counterparty; totals of income and expenses in EUR at each date's rate", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "1000.00" });
    const uah = await createAccount(space, { name: "Гривневий", amount: "100000.00", currency: "UAH" });
    const other = await createAccount(space, { name: "Ощадний", kind: "savings", amount: "5000.00" });
    // 2 400 more on the third account (the list reads its own table; their journal events are not needed here).
    await db.owner.query(
      `INSERT INTO transactions.transactions
         (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, counterparty)
       SELECT $1, gen_random_uuid(), $2, gen_random_uuid(), -(1 + n % 50), 'EUR',
              DATE '2025-01-01' + (n % 600), 'Сільпо ' || n
         FROM generate_series(1, 2400) n`,
      [space.householdId, other],
    );
    await add(space, tx(a, "-30.00", { date: "2026-10-01", counterparty: "Сільпо Київ" }));
    await add(
      space,
      tx(a, "20.00", { date: "2026-10-04", counterparty: "Сільпо", description: "Повернення" }),
    );
    await add(space, tx(a, "-5.25", { date: "2026-10-06", description: "Сільпо, вода" }));
    await add(space, tx(a, "-12.40", { date: "2026-10-07", counterparty: "АТБ" }));
    await add(space, tx(a, "-8.00", { date: "2026-09-20", counterparty: "Сільпо" }));
    await add(space, tx(uah, "-1000.00", { currency: "UAH", date: "2026-10-02", counterparty: "Сільпо" }));
    await add(space, tx(uah, "-880.00", { currency: "UAH", date: "2026-10-05", counterparty: "Сільпо" }));
    await rate("2026-10-02", "EUR", "40");
    await rate("2026-10-05", "EUR", "50");

    const query = [
      `filter=accountId.in:${a},${uah}`,
      "filter=date.gte:2026-10-01",
      "filter=date.lte:2026-10-10",
      `filter=search.has:${encodeURIComponent("Сільпо")}`,
      "sort=-amount",
    ].join("&");
    const res = await call(space, "GET", `/v1/transactions?${query}`);
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.items.map((t: { amount: { amount: string; currency: string } }) => t.amount)).toEqual([
      { amount: "20", currency: "EUR" },
      { amount: "-5.25", currency: "EUR" },
      { amount: "-30", currency: "EUR" },
      { amount: "-880", currency: "UAH" },
      { amount: "-1000", currency: "UAH" },
    ]);
    expect(list).toMatchObject({ count: 5, page: 1, pageSize: 25, from: 1, to: 5 });
    // −1 000 UAH at 40 → −25 €, −880 UAH at 50 → −17,60 €: each at the rate of its own date.
    expect(list.summary).toEqual({
      currency: "EUR",
      income: {
        total: { amount: "20", currency: "EUR" },
        converted: false,
        approximate: false,
        nearestRateCount: 0,
        partial: false,
        noRateCount: 0,
      },
      expense: {
        total: { amount: "-77.85", currency: "EUR" },
        converted: true,
        approximate: false,
        nearestRateCount: 0,
        partial: false,
        noRateCount: 0,
      },
      difference: {
        total: { amount: "-57.85", currency: "EUR" },
        converted: true,
        approximate: false,
        nearestRateCount: 0,
        partial: false,
        noRateCount: 0,
      },
    });
    expect((await call(space, "GET", "/v1/transactions")).json().count).toBe(2407);
  });

  it("FIN-03@PoC AC13: without a sort the list is by «Дата і час», newest first", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    for (const date of ["2026-10-03", "2026-10-12", "2026-09-30", "2026-10-07"])
      await add(space, tx(a, "-1.00", { date }));
    const list = (await call(space, "GET", "/v1/transactions")).json();
    expect(list.items.map((t: { date: string }) => t.date)).toEqual([
      "2026-10-12",
      "2026-10-07",
      "2026-10-03",
      "2026-09-30",
    ]);
  });

  it("FIN-03@PoC AC13: within one date the list is by the time of «Дата і час», newest first (default and sort=date)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    for (let i = 0; i < 8; i++) await add(space, tx(a, "-1.00", { date: "2026-10-15" }));
    const list = (await call(space, "GET", "/v1/transactions")).json();
    const times = list.items.map((t: { recordedAt: string }) => t.recordedAt);
    expect(times).toEqual([...times].sort().reverse());
    const asc = (await call(space, "GET", "/v1/transactions?sort=date")).json();
    const ascTimes = asc.items.map((t: { recordedAt: string }) => t.recordedAt);
    expect(ascTimes).toEqual([...ascTimes].sort());
  });

  it("FIN-03@PoC AC14: 42 transactions, page size 25 by default → «1–25 з 42»; the next page «26–42 з 42»; sizes 25, 50, 100 only", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { name: "Щоденний", amount: "1000.00" });
    for (let i = 0; i < 42; i++)
      await add(space, tx(a, "-1.00", { date: `2026-10-${String(1 + (i % 16)).padStart(2, "0")}` }));
    const first = (await call(space, "GET", "/v1/transactions")).json();
    expect(first).toMatchObject({ page: 1, pageSize: 25, count: 42, from: 1, to: 25 });
    expect(first.items).toHaveLength(25);
    const second = (await call(space, "GET", "/v1/transactions?page=2")).json();
    expect(second).toMatchObject({ page: 2, count: 42, from: 26, to: 42 });
    const ids = new Set([...first.items, ...second.items].map((t: { id: string }) => t.id));
    expect(ids.size).toBe(42);
    expect((await call(space, "GET", "/v1/transactions?pageSize=50")).json()).toMatchObject({
      from: 1,
      to: 42,
    });
    expect((await call(space, "GET", "/v1/transactions?pageSize=10")).statusCode).toBe(400);
  });

  it("FIN-03@PoC AC21: «Рахунки: Поточний» and «Тип: списання» → only such transactions, their count in the page row", async () => {
    const space = await newSpace();
    const current = await createAccount(space, { name: "Поточний", amount: "1000.00" });
    const savings = await createAccount(space, { name: "Ощадний", kind: "savings", amount: "1000.00" });
    await add(space, tx(current, "-10.00"));
    await add(space, tx(current, "-20.00"));
    await add(space, tx(current, "300.00"));
    await add(space, tx(savings, "-40.00"));
    const list = (
      await call(space, "GET", `/v1/transactions?filter=accountId.eq:${current}&filter=type.eq:out`)
    ).json();
    expect(list.count).toBe(2);
    expect(list.items.map((t: { amount: { amount: string } }) => t.amount.amount).sort()).toEqual([
      "-10",
      "-20",
    ]);
    expect(list.summary.income.total).toEqual({ amount: "0", currency: "EUR" });
    expect(list.summary.expense.total).toEqual({ amount: "-30", currency: "EUR" });
    // «Сума від / до» is the amount without its sign.
    const big = (
      await call(space, "GET", "/v1/transactions?filter=amount.gte:25&filter=amount.lte:100")
    ).json();
    expect(big.items.map((t: { amount: { amount: string } }) => t.amount.amount)).toEqual(["-40"]);
  });

  it("FIN-03@PoC FR 22: a filter or sort outside the whitelist, or a malformed value, is 400; nothing is echoed", async () => {
    const space = await newSpace();
    for (const q of [
      "filter=household_id.eq:x",
      "filter=amount.gte:1e3",
      "filter=type.eq:income",
      "sort=household_id",
      "filter=date.gte:2026-13-01",
    ]) {
      const res = await call(space, "GET", `/v1/transactions?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(res.body).not.toContain("household_id");
    }
  });
});

describe("FIN-03@PoC «Права доступу»: the Owner works with transactions; nobody else learns about them", () => {
  it("FIN-03@PoC AC11: a change or delete from a user outside the space is «not found», like an unknown id; nothing changes", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, { name: "Щоденний", amount: "1000.00" });
    const t = await add(a, tx(account, "-45.50", { counterparty: "Сільпо" }));
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    for (const [method, body] of [
      ["PATCH", { amount: { amount: "-1.00", currency: "EUR" } }],
      ["DELETE", undefined],
    ] as const) {
      const foreign = await call(b, method, `/v1/transactions/${t.id}`, body);
      const unknown = await call(b, method, `/v1/transactions/${randomUUID()}`, body);
      expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
      expect(foreign.body).not.toContain("Сільпо");
    }
    // An account of another space is unknown too: nothing written in either space.
    const into = await call(b, "POST", "/v1/transactions", tx(account, "-1.00"));
    expect(into.json().errors).toEqual([{ in: "body", path: "accountId", issue: "not_found" }]);
    expect((await call(a, "GET", `/v1/transactions/${t.id}`)).json().amount.amount).toBe("-45.5");
    expect(await balance(a, account)).toBe("954.5");
    expect(await transactionEntries(a.householdId)).toHaveLength(1);
    expect(await rows(b.householdId)).toBe(0);
  });

  it("FIN-03@PoC AC12: viewing from a user outside the space shows no records, counts or sums of it", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, { name: "Щоденний", amount: "1000.00" });
    const t = await add(a, tx(account, "-45.50"));
    expect((await call(b, "GET", `/v1/transactions/${t.id}`)).statusCode).toBe(404);
    const list = (await call(b, "GET", "/v1/transactions")).json();
    expect(list).toMatchObject({ items: [], count: 0, from: 0, to: 0 });
    expect(list.summary.difference.total).toEqual({ amount: "0", currency: "EUR" });
    const filtered = (await call(b, "GET", `/v1/transactions?filter=accountId.eq:${account}`)).json();
    expect(filtered.count).toBe(0);
  });

  it.each(["owner", "admin", "editor"])(
    "FIN-03@PoC «Права доступу»: a %s creates, reads, changes and deletes transactions",
    async (role) => {
      const space = await newSpace();
      const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
      const t = await add(space, tx(account, "-1.00"), { role });
      expect((await call(space, "GET", `/v1/transactions/${t.id}`, undefined, { role })).statusCode).toBe(
        200,
      );
      expect((await call(space, "GET", "/v1/transactions", undefined, { role })).json().count).toBe(1);
      const patch = await call(space, "PATCH", `/v1/transactions/${t.id}`, { description: "x" }, { role });
      expect(patch.statusCode).toBe(200);
      expect((await call(space, "DELETE", `/v1/transactions/${t.id}`, undefined, { role })).statusCode).toBe(
        200,
      );
    },
  );

  it.each(["viewer", "advisor"])(
    "FIN-03@PoC «Права доступу»: a %s reads but may not create, change or delete (403); nothing written",
    async (role) => {
      const space = await newSpace();
      const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
      const t = await add(space, tx(account, "-1.00"));
      expect((await call(space, "GET", "/v1/transactions", undefined, { role })).json().count).toBe(1);
      expect((await call(space, "POST", "/v1/transactions", tx(account, "-2.00"), { role })).statusCode).toBe(
        403,
      );
      expect(
        (await call(space, "PATCH", `/v1/transactions/${t.id}`, { description: "x" }, { role })).statusCode,
      ).toBe(403);
      expect((await call(space, "DELETE", `/v1/transactions/${t.id}`, undefined, { role })).statusCode).toBe(
        403,
      );
      expect(await rows(space.householdId)).toBe(1);
      expect(await balance(space, account)).toBe("99");
    },
  );

  it("FIN-03@PoC «Права доступу»: a scoped member — «Транзакції» closed by the visibility policy's default: reads not found, changes 403", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const t = await add(space, tx(account, "-1.00"));
    const scoped = { role: "editor", scoped: true };
    const getOne = await call(space, "GET", `/v1/transactions/${t.id}`, undefined, scoped);
    const list = await call(space, "GET", "/v1/transactions", undefined, scoped);
    expect([getOne.statusCode, list.statusCode]).toEqual([404, 404]);
    expect(list.body).not.toContain("count");
    expect((await call(space, "POST", "/v1/transactions", tx(account, "-2.00"), scoped)).statusCode).toBe(
      403,
    );
    expect(
      (await call(space, "PATCH", `/v1/transactions/${t.id}`, { description: "x" }, scoped)).statusCode,
    ).toBe(403);
    expect((await call(space, "DELETE", `/v1/transactions/${t.id}`, undefined, scoped)).statusCode).toBe(403);
    expect(await rows(space.householdId)).toBe(1);
  });

  it("FIN-03@PoC: the flag transactions.manual off — every route answers 404 as if absent; nothing written", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    off.add("transactions.manual");
    const results = [
      await call(space, "POST", "/v1/transactions", tx(account, "-1.00")),
      await call(space, "GET", "/v1/transactions"),
      await call(space, "GET", `/v1/transactions/${randomUUID()}`),
      await call(space, "PATCH", `/v1/transactions/${randomUUID()}`, { description: "x" }),
      await call(space, "DELETE", `/v1/transactions/${randomUUID()}`),
    ];
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404]);
    expect(await rows(space.householdId)).toBe(0);
    expect(await balance(space, account)).toBe("100");
  });
});

describe("NFR-12@PoC FR 3: a space's transactions are erased with it", () => {
  it("NFR-12@PoC FR 3: the erasure deletes every transaction and stored create response of the space; the neighbour keeps its own", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a, { name: "Щоденний", amount: "100.00" });
    const accountB = await createAccount(b, { name: "Щоденний", amount: "100.00" });
    await call(a, "POST", "/v1/transactions", tx(accountA, "-1.00"), {}, { "idempotency-key": randomUUID() });
    await add(a, tx(accountA, "-2.00"));
    await add(b, tx(accountB, "-3.00"));
    const erased = await createTransactionsErasure(db.databases.for("transactions")).eraseHousehold(
      a.householdId,
    );
    expect(erased).toEqual({ transactions: 2, idempotencyKeys: 1 });
    expect(await rows(a.householdId)).toBe(0);
    expect(await rows(b.householdId)).toBe(1);
  });
});
