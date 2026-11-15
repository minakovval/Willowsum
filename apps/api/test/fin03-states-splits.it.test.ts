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
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";

/**
 * FIN-03@PoC b) (wave 2 row 16a), through the real API on a real PostgreSQL: «Очікує» (no journal event until posted),
 * hidden transactions (out of the list, the budget and the reports, the balance unchanged) and «Розділити» (BUD-01@PoC
 * FR 6, BUD-13@PoC FR 6, FR 8: the budget's view only — no new transaction, the journal unchanged). Every name and amount is
 * synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
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

interface Category {
  id: string;
  kind: "expense" | "income" | "service";
  systemKey: string | null;
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
    name: `Рахунок ${currency}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const tx = (accountId: string, amount: string, extra: { status?: string; date?: string } = {}) => ({
  accountId,
  amount: { amount, currency: "EUR" },
  date: extra.date ?? "2026-10-15",
  counterparty: "Синтетичний магазин",
  ...(extra.status !== undefined ? { status: extra.status } : {}),
});

async function add(space: Space, body: ReturnType<typeof tx>) {
  const res = await call(space, "POST", "/v1/transactions", body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; status: string; hidden: boolean; split: unknown };
}

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

/** The journal events of the space's transactions: [source id, reversed by another entry?]. */
async function liveEvents(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query(
    `SELECT e.source_id FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.recorded_at`,
    [householdId],
  );
  return rows.map((r: { source_id: string }) => r.source_id);
}

const allEntries = async (householdId: string) =>
  Number(
    (
      await db.owner.query(`SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`, [
        householdId,
      ])
    ).rows[0]!.n,
  );

const transactionRows = async (householdId: string) =>
  Number(
    (
      await db.owner.query(
        `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1`,
        [householdId],
      )
    ).rows[0]!.n,
  );

async function categories(space: Space): Promise<Category[]> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().groups as { categories: Category[] }[]).flatMap((g) => g.categories);
}

async function pick(space: Space) {
  const all = await categories(space);
  const expense = all.filter((c) => c.kind === "expense");
  return {
    food: expense[0]!.id,
    home: expense[1]!.id,
    pharmacy: expense[2]!.id,
    income: all.find((c) => c.kind === "income")!.id,
    transfer: all.find((c) => c.systemKey === "transfer")!.id,
  };
}

const list = async (space: Space, query = "") =>
  (await call(space, "GET", `/v1/transactions${query}`)).json();

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
          // FR 18: only a duplicate is hidden — the tests that hide enter the transaction twice (FIN-03 b, row 16c).
          duplicates: createDuplicateCheck(),
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
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => off.clear());

describe("FIN-03@PoC FR 4, FR 24: «Очікує» changes the balance only once posted", () => {
  it("FIN-03@PoC FR 4: a pending transaction has no journal event; posting it moves the balance, back to «Очікує» reverses it", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const t = await add(space, tx(account, "-45.50", { status: "pending" }));
    expect(t.status).toBe("pending");
    expect(await balance(space, account)).toBe("1000");
    expect(await liveEvents(space.householdId)).toEqual([]);

    const posted = await call(space, "PATCH", `/v1/transactions/${t.id}`, { status: "posted" });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().status).toBe("posted");
    expect(await balance(space, account)).toBe("954.5");
    expect(await liveEvents(space.householdId)).toEqual([t.id]);

    await call(space, "PATCH", `/v1/transactions/${t.id}`, { status: "pending" });
    expect(await balance(space, account)).toBe("1000");
    expect(await liveEvents(space.householdId)).toEqual([]);
    // Posted again: a new event (the reversed one is never reused), the amount changed while pending is the one posted.
    await call(space, "PATCH", `/v1/transactions/${t.id}`, { amount: { amount: "-50.00", currency: "EUR" } });
    expect(await balance(space, account)).toBe("1000");
    await call(space, "PATCH", `/v1/transactions/${t.id}`, { status: "posted" });
    expect(await balance(space, account)).toBe("950");
    expect(await liveEvents(space.householdId)).toEqual([t.id]);
  });

  it("FIN-03@PoC FR 24: the state is «Проведена» or «Очікує»; deleting a pending one writes nothing to the journal", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const pending = await add(space, tx(account, "-10.00", { status: "pending" }));
    const before = await allEntries(space.householdId);
    expect((await call(space, "DELETE", `/v1/transactions/${pending.id}`)).statusCode).toBe(200);
    expect(await allEntries(space.householdId)).toBe(before);
    const bad = await call(space, "POST", "/v1/transactions", tx(account, "-1.00", { status: "reviewed" }));
    expect(bad.statusCode).toBe(400);
    expect(await transactionRows(space.householdId)).toBe(0);
  });

  it("FIN-03@PoC FR 28: «Статус» is «Проведена» by default; «Очікує» only with the flag `transactions.states` on", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    expect((await add(space, tx(account, "-1.00"))).status).toBe("posted");
    off.add("transactions.states");
    const refused = await call(
      space,
      "POST",
      "/v1/transactions",
      tx(account, "-2.00", { status: "pending" }),
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errors).toEqual([{ in: "body", path: "status", issue: "invalid" }]);
    expect(await transactionRows(space.householdId)).toBe(1);
  });
});

describe("FIN-03@PoC FR 16, FR 17: «Приховати транзакцію» takes it out of the list and its totals; a manual duplicate leaves the balance", () => {
  it("FIN-03@PoC FR 17: a hidden manual duplicate leaves the balance (owner, 2026-11-15), is not listed or totalled, and is found by «Стан: приховані»", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const kept = await add(space, tx(account, "-10.00"));
    // FR 18: entered twice, so a duplicate that may be hidden.
    const t = await add(space, tx(account, "-45.50"));
    const copy = await add(space, tx(account, "-45.50"));
    const hide = await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    expect(hide.statusCode, hide.body).toBe(200);
    expect(hide.json().hidden).toBe(true);
    expect(await balance(space, account)).toBe("944.5");
    expect(await liveEvents(space.householdId)).toEqual([kept.id, copy.id]);
    const shown = await list(space);
    expect(shown.items.map((i: { id: string }) => i.id).sort()).toEqual([kept.id, copy.id].sort());
    expect(shown.count).toBe(2);
    expect(shown.summary.expense.total).toEqual({ amount: "-55.5", currency: "EUR" });
    const hidden = await list(space, "?filter=hidden.eq:true");
    expect(hidden.items.map((i: { id: string; hidden: boolean }) => [i.id, i.hidden])).toEqual([
      [t.id, true],
    ]);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().hidden).toBe(true);
  });

  it("FIN-03@PoC FR 16: a hidden transaction can be shown again; hiding twice changes nothing", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const t = await add(space, tx(account, "-5.00"));
    await add(space, tx(account, "-5.00")); // FR 18: a duplicate
    await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    const show = await call(space, "POST", `/v1/transactions/${t.id}/show`);
    expect(show.json().hidden).toBe(false);
    expect((await list(space)).count).toBe(2);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id });
    expect(log.map((e) => [e.action, e.changes.map((c) => `${c.field}:${c.before}→${c.after}`)])).toEqual([
      ["create", expect.any(Array)],
      ["update", ["hidden:null→true"]],
      ["update", ["hidden:true→null"]],
    ]);
  });

  it("FIN-03@PoC FR 16: hiding is behind the flag `transactions.states` — off, the routes are not there", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const t = await add(space, tx(account, "-5.00"));
    off.add("transactions.states");
    expect((await call(space, "POST", `/v1/transactions/${t.id}/hide`)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().hidden).toBe(false);
  });
});

describe("FIN-03@PoC FR 22, FR 23: «Стан» filters and the split in the list", () => {
  it("FIN-03@PoC FR 22: «Стан» — очікує, розділені, приховані — each a filter of the list", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const c = await pick(space);
    const pending = await add(space, tx(account, "-1.00", { status: "pending" }));
    const split = await add(space, tx(account, "-2.00"));
    const hidden = await add(space, tx(account, "-3.00"));
    await add(space, tx(account, "-3.00")); // FR 18: a duplicate, so it may be hidden
    await add(space, tx(account, "-4.00"));
    await call(space, "POST", `/v1/transactions/${split.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: c.food, amount: "-1.50" },
        { categoryId: c.home, amount: "-0.50" },
      ],
    });
    await call(space, "POST", `/v1/transactions/${hidden.id}/hide`);
    const ids = async (q: string) => (await list(space, q)).items.map((i: { id: string }) => i.id);
    expect(await ids("?filter=status.eq:pending")).toEqual([pending.id]);
    expect(await ids("?filter=split.eq:true")).toEqual([split.id]);
    expect(await ids("?filter=hidden.eq:true")).toEqual([hidden.id]);
    expect((await list(space)).count).toBe(4);
    expect((await call(space, "GET", "/v1/transactions?filter=status.eq:reviewed")).statusCode).toBe(400);
  });

  it("FIN-03@PoC FR 23: a transaction split by categories lists its parts in order — «Категорія» shows the first", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-132.40"));
    await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: c.home, amount: "-35.00" },
        { categoryId: c.food, amount: "-85.00" },
        { categoryId: c.pharmacy, amount: "-12.40" },
      ],
    });
    const [item] = (await list(space)).items;
    expect(item.split).toEqual({
      mode: "categories",
      needsReview: false,
      parts: [
        { categoryId: c.home, month: null, amount: { amount: "-35", currency: "EUR" } },
        { categoryId: c.food, month: null, amount: { amount: "-85", currency: "EUR" } },
        { categoryId: c.pharmacy, month: null, amount: { amount: "-12.4", currency: "EUR" } },
      ],
    });
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json()).toEqual(item);
  });
});

describe("BUD-13@PoC FR 6, FR 8 / BUD-01@PoC FR 6: «Розділити» is the budget's view only", () => {
  it("BUD-13@PoC AC2: −1 200,00 € on 6 months from March — no new transaction, six shares of −200,00 €, the balance and the journal unchanged", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "5000.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-1200.00", { date: "2026-03-01" }));
    const entries = await allEntries(space.householdId);
    const res = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-03",
      months: 6,
      categoryId: c.home,
    });
    expect(res.statusCode, res.body).toBe(200);
    const split = res.json().split;
    expect(
      split.parts.map((p: { month: string; amount: { amount: string } }) => [p.month, p.amount.amount]),
    ).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => [m, "-200"]));
    expect(await transactionRows(space.householdId)).toBe(1);
    expect(await allEntries(space.householdId)).toBe(entries);
    expect(await balance(space, account)).toBe("3800");
    const listed = await list(space);
    expect(
      listed.items.map((i: { date: string; amount: { amount: string } }) => [i.date, i.amount.amount]),
    ).toEqual([["2026-03-01", "-1200"]]);
    expect(listed.summary.expense.total).toEqual({ amount: "-1200", currency: "EUR" });
  });

  it("BUD-13@PoC FR 8: «Об'єднати назад» makes the transaction whole again; the journal is untouched", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "500.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-100.00"));
    await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 3,
      categoryId: c.home,
    });
    const entries = await allEntries(space.householdId);
    const back = await call(space, "DELETE", `/v1/transactions/${t.id}/split`);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().split).toBeNull();
    expect(await allEntries(space.householdId)).toBe(entries);
    expect(await balance(space, account)).toBe("400");
    expect((await list(space, "?filter=split.eq:true")).count).toBe(0);
  });

  it("BUD-13@PoC AC3: the parts must sum to the amount exactly — «Залишилось 12,40 €» is refused, with «Аптека» 12,40 € saved", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "500.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-132.40"));
    const short = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: c.food, amount: "-85.00" },
        { categoryId: c.home, amount: "-35.00" },
      ],
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().errors).toEqual([{ in: "body", path: "parts", issue: "sum_mismatch" }]);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().split).toBeNull();
    const full = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: c.food, amount: "-85.00" },
        { categoryId: c.home, amount: "-35.00" },
        { categoryId: c.pharmacy, amount: "-12.40" },
      ],
    });
    expect(full.statusCode, full.body).toBe(200);
  });

  it("BUD-01@PoC FR 6: a change of the amount keeps the split, «потребує перегляду»; saving it again clears that; no parts cancel it", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "500.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-186.00"));
    const parts = [
      { categoryId: c.food, amount: "-120.00" },
      { categoryId: c.home, amount: "-66.00" },
    ];
    await call(space, "POST", `/v1/transactions/${t.id}/split`, { mode: "categories", parts });
    const changed = await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      amount: { amount: "-190.00", currency: "EUR" },
    });
    expect(changed.json().split).toMatchObject({
      needsReview: true,
      parts: [{ amount: { amount: "-120" } }, {}],
    });
    // A text change alone does not mark it.
    const resaved = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [parts[0], { categoryId: c.home, amount: "-70.00" }],
    });
    expect(resaved.json().split.needsReview).toBe(false);
    await call(space, "PATCH", `/v1/transactions/${t.id}`, { description: "Синтетичний опис" });
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().split.needsReview).toBe(false);
    const cancelled = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [],
    });
    expect(cancelled.json().split).toBeNull();
  });

  it("BUD-01@PoC FR 6: a part's category is of the space's tree, not a service one, and of the transaction's type", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space, "500.00");
    const c = await pick(space);
    const foreign = (await pick(other)).food;
    const t = await add(space, tx(account, "-10.00"));
    const split = (categoryId: string) =>
      call(space, "POST", `/v1/transactions/${t.id}/split`, {
        mode: "categories",
        parts: [
          { categoryId: c.food, amount: "-4.00" },
          { categoryId, amount: "-6.00" },
        ],
      });
    for (const [categoryId, issue] of [
      [foreign, "not_found"],
      [randomUUID(), "not_found"],
      [c.transfer, "not_found"],
      [c.income, "kind_mismatch"],
    ] as const) {
      const res = await split(categoryId);
      expect(res.statusCode, categoryId).toBe(400);
      expect(res.json().errors).toEqual([{ in: "body", path: "parts.1.categoryId", issue }]);
    }
    const tooMany = await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: Array.from({ length: 21 }, () => ({ categoryId: c.food, amount: "-0.10" })),
    });
    expect(tooMany.statusCode).toBe(400);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().split).toBeNull();
  });

  it("BUD-13@PoC FR 6: every split is in the audit log, its parts by category and amount; the flag `transactions.attributes` hides it", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "500.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: c.food, amount: "-4.00" },
        { categoryId: c.home, amount: "-6.00" },
      ],
    });
    await call(space, "DELETE", `/v1/transactions/${t.id}/split`);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id });
    const fields = (i: number) =>
      Object.fromEntries(log[i]!.changes.map((ch) => [ch.field, [ch.before, ch.after]]));
    expect(fields(1)).toEqual({
      "split.mode": [null, "categories"],
      "split.part.1": [null, `${c.food} -4`],
      "split.part.2": [null, `${c.home} -6`],
    });
    expect(fields(2)["split.mode"]).toEqual(["categories", null]);
    off.add("transactions.attributes");
    expect((await call(space, "DELETE", `/v1/transactions/${t.id}/split`)).statusCode).toBe(404);
  });
});

describe("FIN-03@PoC «Права доступу» / BUD-13@PoC AC7: splitting and hiding are the space's own", () => {
  it("BUD-13@PoC AC7: a split or a hide from a user outside the space is «not found», like an unknown id; nothing changes", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, "100.00");
    const c = await pick(a);
    const t = await add(a, tx(account, "-10.00"));
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const body = {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: (await pick(b)).food,
    };
    for (const [method, path, payload] of [
      ["POST", "split", body],
      ["DELETE", "split", undefined],
      ["POST", "hide", undefined],
      ["POST", "show", undefined],
    ] as const) {
      const foreign = await call(b, method, `/v1/transactions/${t.id}/${path}`, payload);
      const unknown = await call(b, method, `/v1/transactions/${randomUUID()}/${path}`, payload);
      expect([foreign.statusCode, unknown.statusCode], path).toEqual([404, 404]);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
    }
    // A's own category from B's session is unknown too.
    const crossed = await call(b, "POST", `/v1/transactions/${t.id}/split`, { ...body, categoryId: c.food });
    expect(crossed.json().errors).toEqual([{ in: "body", path: "categoryId", issue: "not_found" }]);
    expect((await call(a, "GET", `/v1/transactions/${t.id}`)).json()).toMatchObject({
      hidden: false,
      split: null,
    });
  });

  it("FIN-03@PoC «Права доступу»: the parts of a split are bound to the space by the row policy alone (no household filter in SQL)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, "100.00");
    const c = await pick(a);
    const t = await add(a, tx(account, "-10.00"));
    await call(a, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: c.home,
    });
    const count = (householdId: string) =>
      db.databases
        .for("transactions")
        .inHousehold(
          householdId,
          async (q) => (await q.query(`SELECT count(*)::int AS n FROM transaction_parts`)).rows[0]!.n,
        );
    expect([await count(a.householdId), await count(b.householdId)]).toEqual([2, 0]);
  });

  it.each(["owner", "admin", "editor"])(
    "FIN-03@PoC «Права доступу»: a %s splits, hides and shows",
    async (role) => {
      const space = await newSpace();
      const account = await createAccount(space, "100.00");
      const c = await pick(space);
      const t = await add(space, tx(account, "-10.00"));
      await add(space, tx(account, "-10.00")); // FR 18: a duplicate, so it may be hidden
      const split = await call(
        space,
        "POST",
        `/v1/transactions/${t.id}/split`,
        { mode: "months", startMonth: "2026-10", months: 2, categoryId: c.home },
        { role },
      );
      expect(split.statusCode, split.body).toBe(200);
      expect(
        (await call(space, "POST", `/v1/transactions/${t.id}/hide`, undefined, { role })).statusCode,
      ).toBe(200);
      expect(
        (await call(space, "POST", `/v1/transactions/${t.id}/show`, undefined, { role })).statusCode,
      ).toBe(200);
      expect(
        (await call(space, "DELETE", `/v1/transactions/${t.id}/split`, undefined, { role })).statusCode,
      ).toBe(200);
    },
  );

  it.each([
    ["viewer", {}],
    ["advisor", {}],
    ["editor", { scoped: true }],
  ] as const)(
    "FIN-03@PoC «Права доступу»: a %s %o may not split or hide (403); nothing written",
    async (role, extra) => {
      const space = await newSpace();
      const account = await createAccount(space, "100.00");
      const c = await pick(space);
      const t = await add(space, tx(account, "-10.00"));
      const who = { role, ...extra };
      const body = { mode: "months", startMonth: "2026-10", months: 2, categoryId: c.home };
      expect((await call(space, "POST", `/v1/transactions/${t.id}/split`, body, who)).statusCode).toBe(403);
      expect((await call(space, "DELETE", `/v1/transactions/${t.id}/split`, undefined, who)).statusCode).toBe(
        403,
      );
      expect((await call(space, "POST", `/v1/transactions/${t.id}/hide`, undefined, who)).statusCode).toBe(
        403,
      );
      const pending = await call(space, "PATCH", `/v1/transactions/${t.id}`, { status: "pending" }, who);
      expect(pending.statusCode).toBe(403);
      expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json()).toMatchObject({
        status: "posted",
        hidden: false,
        split: null,
      });
      // A scoped member does not even see the space's transactions (the visibility policy's default).
      if ("scoped" in extra)
        expect(
          (await call(space, "GET", "/v1/transactions?filter=hidden.eq:true", undefined, who)).statusCode,
        ).toBe(404);
    },
  );

  it("FIN-03@PoC «Права доступу»: on a closed account a transaction is read only — no split, hiding or «Очікує» (409)", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "10.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    const closed = await call(space, "POST", `/v1/accounts/${account}/close`, { closedOn: TODAY });
    expect(closed.statusCode, closed.body).toBe(200);
    const body = { mode: "months", startMonth: "2026-10", months: 2, categoryId: c.home };
    expect((await call(space, "POST", `/v1/transactions/${t.id}/split`, body)).statusCode).toBe(409);
    expect((await call(space, "POST", `/v1/transactions/${t.id}/hide`)).statusCode).toBe(409);
    expect((await call(space, "PATCH", `/v1/transactions/${t.id}`, { status: "pending" })).statusCode).toBe(
      409,
    );
  });
});
