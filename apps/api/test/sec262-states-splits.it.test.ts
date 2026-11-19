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
let realLedger: ReturnType<typeof createLedger>;
let ledgerDown = false;
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

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  realLedger = createLedger(db.databases.for("ledger"));
  const ledger = new Proxy(realLedger, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (ledgerDown && ["post", "correct", "reverse", "liveEntries"].includes(String(prop)))
          return Promise.reject(new Error("ledger away"));
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
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
          pendingPostings: [],
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
          // FR 18 (16c): hiding is for a «Можливий дубль» only.
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

beforeEach(() => {
  off.clear();
  ledgerDown = false;
});

// ---------------------------------------------------------------------------------------------------------------
// Security review of PR #262 (FIN-03@PoC b, 16a): probes. Real API, real PostgreSQL, synthetic data only.
// ---------------------------------------------------------------------------------------------------------------
import { Decimal } from "@willowsum/domain-kernel";
import { applyHandOff, type TransactionHandOff } from "../src/modules/transactions/application/index.ts";
import { transactionRows as lockedRows } from "../src/modules/transactions/adapters/queue/hand-off.ts";
import { transactionAudit } from "../src/modules/transactions/adapters/http/services.ts";
import { leakText } from "./leak-text.ts";

const patch = (space: Space, id: string, body: unknown) =>
  call(space, "PATCH", `/v1/transactions/${id}`, body);

/** Every hand-off job of the space, oldest first (the worker's view of the queue). */
async function jobs(householdId: string): Promise<TransactionHandOff[]> {
  const { rows } = await db.owner.query(
    `SELECT payload FROM transactions.jobs WHERE household_id = $1 AND name = 'transactions.hand-off' ORDER BY created_at, id`,
    [householdId],
  );
  return rows.map((r: { payload: TransactionHandOff }) => r.payload);
}

/** Runs a hand-off as the worker would (real ledger, real audit). */
async function replay(householdId: string, handOff: TransactionHandOff): Promise<void> {
  const tdb = db.databases.for("transactions");
  await applyHandOff(
    {
      accounts: createAccountDirectory(db.databases.for("accounts")),
      ledger: realLedger,
      audit: transactionAudit(audit),
    },
    lockedRows((work) => tdb.inHousehold(householdId, work)),
    householdId,
    handOff,
  );
}

/** The journal of the space's transactions: no entry reversed twice, and the entries in effect. */
async function journal(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT e.id, e.source_id, e.reverses_entry_id,
            (SELECT count(*)::int FROM ledger.entries r WHERE r.household_id = e.household_id AND r.reverses_entry_id = e.id) AS reversals
       FROM ledger.entries e WHERE e.household_id = $1 AND e.source_module = 'transactions'`,
    [householdId],
  );
  return {
    total: rows.length,
    maxReversals: Math.max(0, ...rows.map((r: { reversals: number }) => r.reversals)),
    live: rows.filter(
      (r: { reverses_entry_id: string | null; reversals: number }) =>
        r.reverses_entry_id === null && r.reversals === 0,
    ).length,
  };
}

const auditCount = async (space: Space, id: string) =>
  (await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })).length;

describe("SEC-262 journal: «Очікує» reverses and re-posts, never twice and never lost", () => {
  it("SEC-262: posted → pending → posted → hidden → split → amount → pending → posted, then every hand-off replayed in every order: one event in effect, the balance exact", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-45.50"));
    expect(await balance(space, account)).toBe("954.5");
    await patch(space, t.id, { status: "pending" });
    expect(await balance(space, account)).toBe("1000");
    await patch(space, t.id, { status: "posted" });
    expect(await balance(space, account)).toBe("954.5");
    // FR 18 (16c): only a duplicate is hidden — a copy entered; FR 17 (owner, 2026-11-15): the hidden manual row leaves the balance.
    await add(space, tx(account, "-45.50"));
    await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    expect(await balance(space, account)).toBe("954.5");
    await call(space, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 3,
      categoryId: c.home,
    });
    await patch(space, t.id, { amount: { amount: "-50.00", currency: "EUR" } });
    // FIN-03 FR 35 (owner, 2026-11-15, #281 item 5; lead decision for the copy itself): −50 is no copy of −45.50 any
    // more, so the hidden row is shown again and back in the balance: 1 000 − 45.50 − 50 = 904.50.
    expect(await balance(space, account)).toBe("904.5");
    await patch(space, t.id, { status: "pending" });
    expect(await balance(space, account)).toBe("954.5");
    await call(space, "POST", `/v1/transactions/${t.id}/show`);
    await patch(space, t.id, { status: "posted" });
    expect(await balance(space, account)).toBe("904.5");
    const before = await journal(space.householdId);
    expect(before.live).toBe(2);
    expect(before.maxReversals).toBe(1);
    const audits = await auditCount(space, t.id);
    expect(audits).toBe(9);

    const all = await jobs(space.householdId);
    expect(all.length).toBe(10);
    for (const h of [...all, ...[...all].reverse(), ...all]) await replay(space.householdId, h);
    await Promise.all(all.map((h) => replay(space.householdId, h)));
    expect(await journal(space.householdId)).toEqual(before);
    expect(await balance(space, account)).toBe("904.5");
    expect(await auditCount(space, t.id)).toBe(audits);
  });

  it.each([
    ["create", [true, true, true]],
    ["pending", [false, true, true]],
    ["re-post", [false, false, true]],
    ["create and re-post", [true, false, true]],
  ] as const)(
    "SEC-262: the ledger away at the %s hand-off — the jobs, run late and in reverse order, leave one event and the right balance",
    async (_name, down) => {
      const space = await newSpace();
      const account = await createAccount(space, "1000.00");
      ledgerDown = down[0];
      const t = await add(space, tx(account, "-45.50"));
      ledgerDown = down[1];
      expect((await patch(space, t.id, { status: "pending" })).statusCode).toBe(200);
      ledgerDown = down[2];
      expect((await patch(space, t.id, { status: "posted" })).statusCode).toBe(200);
      ledgerDown = false;
      const all = await jobs(space.householdId);
      expect(all.map((h) => `${h.action}:${h.version}`)).toEqual(["create:1", "update:2", "update:3"]);
      for (const h of [...all].reverse()) await replay(space.householdId, h);
      for (const h of all) await replay(space.householdId, h);
      const j = await journal(space.householdId);
      expect([j.live, j.maxReversals]).toEqual([1, j.total > 1 ? 1 : 0]);
      expect(await balance(space, account)).toBe("954.5");
      expect(await auditCount(space, t.id)).toBe(3);
    },
  );

  it("SEC-262: a pending row whose reversal was lost (ledger away), then deleted: the late jobs reverse the event once; the balance is as before", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const t = await add(space, tx(account, "-45.50"));
    ledgerDown = true;
    await patch(space, t.id, { status: "pending" });
    // The balance still shows the event (the hand-off waits in the queue) — never the other way round.
    ledgerDown = false;
    expect(await balance(space, account)).toBe("954.5");
    ledgerDown = true;
    expect((await call(space, "DELETE", `/v1/transactions/${t.id}`)).statusCode).toBe(200);
    ledgerDown = false;
    const all = await jobs(space.householdId);
    for (const h of [...all].reverse()) await replay(space.householdId, h);
    for (const h of all) await replay(space.householdId, h);
    const j = await journal(space.householdId);
    expect([j.total, j.live, j.maxReversals]).toEqual([2, 0, 1]);
    expect(await balance(space, account)).toBe("1000");
  });

  it("SEC-262: ten rounds pending ↔ posted with the same request sent twice each time: entries only appended, one in effect, none edited", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "1000.00");
    const t = await add(space, tx(account, "-0.01"));
    const snapshot = async () =>
      (
        await db.owner.query(
          `SELECT e.id, e.idempotency_key, e.operation_date::text AS d, e.reverses_entry_id FROM ledger.entries e
            WHERE e.household_id = $1 AND e.source_module = 'transactions' ORDER BY e.id`,
          [space.householdId],
        )
      ).rows;
    let seen = await snapshot();
    for (let i = 0; i < 10; i++) {
      const to = i % 2 === 0 ? "pending" : "posted";
      await Promise.all([patch(space, t.id, { status: to }), patch(space, t.id, { status: to })]);
      const now = await snapshot();
      // Every entry seen before is still there, unchanged (the journal is append-only).
      for (const e of seen) expect(now).toContainEqual(e);
      seen = now;
      const j = await journal(space.householdId);
      expect([j.live, j.maxReversals <= 1], `round ${i}`).toEqual([to === "posted" ? 1 : 0, true]);
      expect(await balance(space, account)).toBe(to === "posted" ? "999.99" : "1000");
    }
    const keys = seen.map((e: { idempotency_key: string }) => e.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("SEC-262 money: the shares of a split sum exactly to the transaction", () => {
  it.each([
    ["-1200.00", "EUR", 6],
    ["-100.00", "EUR", 3],
    ["-0.07", "EUR", 7],
    ["1000.01", "EUR", 60],
    ["-99999999999999999999.99", "EUR", 59],
    ["-1000", "JPY", 7],
    ["0.03", "EUR", 2],
  ] as const)(
    "SEC-262: %s %s on %i months — stored shares sum to the amount in NUMERIC, to the last digit",
    async (amount, currency, months) => {
      const space = await newSpace();
      const account = await createAccount(space, "0.00", currency);
      const c = await pick(space);
      const created = await call(space, "POST", "/v1/transactions", {
        accountId: account,
        amount: { amount, currency },
        date: "2026-10-15",
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;
      const res = await call(space, "POST", `/v1/transactions/${id}/split`, {
        mode: "months",
        startMonth: "2026-11",
        months,
        categoryId: amount.startsWith("-") ? c.home : c.income,
      });
      expect(res.statusCode, res.body).toBe(200);
      const parts = res.json().split.parts as {
        amount: { amount: string; currency: string };
        month: string;
      }[];
      expect(parts.length).toBe(months);
      const sum = parts.reduce((s, p) => s.plus(new Decimal(p.amount.amount)), new Decimal(0));
      expect(sum.equals(new Decimal(amount))).toBe(true);
      expect(parts.every((p) => p.amount.currency === currency)).toBe(true);
      expect(parts.every((p) => new Decimal(p.amount.amount).isNegative() === amount.startsWith("-"))).toBe(
        true,
      );
      expect(parts.every((p) => !new Decimal(p.amount.amount).isZero())).toBe(true);
      const { rows } = await db.owner.query(
        `SELECT (sum(p.amount) = t.amount) AS exact, count(*)::int AS n, bool_and(p.currency = t.currency) AS same
         FROM transactions.transaction_parts p JOIN transactions.transactions t
           ON t.household_id = p.household_id AND t.id = p.transaction_id
        WHERE t.id = $1 GROUP BY t.amount`,
        [id],
      );
      expect(rows).toEqual([{ exact: true, n: months, same: true }]);
    },
  );

  it("SEC-262: parts that miss the amount by one minor unit, carry a third decimal, a zero, the other sign, an exponent or a float tail are refused; nothing is stored", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-0.30"));
    const send = (a: string, b: string) =>
      call(space, "POST", `/v1/transactions/${t.id}/split`, {
        mode: "categories",
        parts: [
          { categoryId: c.food, amount: a },
          { categoryId: c.home, amount: b },
        ],
      });
    for (const [a, b] of [
      ["-0.10", "-0.19"],
      ["-0.10", "-0.21"],
      ["-0.105", "-0.195"],
      ["-0.30", "0"],
      ["-0.30", "-0.00"],
      ["-0.40", "0.10"],
      ["-1e-1", "-0.20"],
      ["-0.1", "-0.20000000000000001"],
      ["-0.10", " -0.20"],
      ["-0.10", "-0,20"],
      ["-.10", "-0.20"],
      ["NaN", "-0.20"],
      ["-Infinity", "-0.20"],
    ] as const) {
      const res = await send(a, b);
      expect(res.statusCode, `${a} ${b}: ${res.body}`).toBe(400);
      expect(leakText(res.body)).not.toContain(a.trim() === "" ? "^@" : `"${a}"`);
    }
    expect((await send("-0.1", "-0.2")).statusCode).toBe(200);
    expect((await send("-0.29", "-0.01")).statusCode).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT amount::text AS a FROM transactions.transaction_parts WHERE transaction_id = $1 ORDER BY position`,
      [t.id],
    );
    expect(rows.map((r: { a: string }) => new Decimal(r.a).toFixed(2))).toEqual(["-0.29", "-0.01"]);
  });

  it("SEC-262: 21 parts, 1 part, 61 months and 1 month are refused", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-21.00"));
    const many = (n: number) => ({
      mode: "categories",
      parts: Array.from({ length: n }, () => ({ categoryId: c.food, amount: n === 1 ? "-21.00" : "-1.00" })),
    });
    expect((await call(space, "POST", `/v1/transactions/${t.id}/split`, many(21))).statusCode).toBe(400);
    expect((await call(space, "POST", `/v1/transactions/${t.id}/split`, many(1))).statusCode).toBe(400);
    for (const months of [1, 61, 2.5, -3])
      expect(
        (
          await call(space, "POST", `/v1/transactions/${t.id}/split`, {
            mode: "months",
            startMonth: "2026-10",
            months,
            categoryId: c.food,
          })
        ).statusCode,
        String(months),
      ).toBe(400);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().split).toBeNull();
  });
});

describe("SEC-262 isolation: the parts, the hidden rows and the categories of a space stay in it", () => {
  it("SEC-262: space B never reads A's split or hidden rows — list, «Стан» filters, count, totals and the row itself", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, "100.00");
    const c = await pick(a);
    const t = await add(a, tx(account, "-10.00"));
    const h = await add(a, tx(account, "-7.00"));
    await call(a, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: c.home,
    });
    await call(a, "POST", `/v1/transactions/${h.id}/hide`);
    for (const query of [
      "",
      "?filter=hidden.eq:true",
      "?filter=split.eq:true",
      "?filter=status.in:posted,pending",
    ]) {
      const res = await call(b, "GET", `/v1/transactions${query}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect([body.count, body.items.length, body.summary.expense.total?.amount ?? "0"], query).toEqual([
        0,
        0,
        "0",
      ]);
      expect(leakText(res.body)).not.toContain(c.home);
    }
    for (const id of [t.id, h.id])
      expect((await call(b, "GET", `/v1/transactions/${id}`)).statusCode).toBe(404);
  });

  it("SEC-262: the transactions role bound to space B cannot read, write, move or delete A's parts, with or without a household filter", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, "100.00");
    const accountB = await createAccount(b, "100.00");
    const c = await pick(a);
    const t = await add(a, tx(account, "-10.00"));
    const tb = await add(b, tx(accountB, "-10.00"));
    await call(a, "POST", `/v1/transactions/${t.id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: c.home,
    });
    const asB = db.databases.for("transactions");
    const seen = await asB.inHousehold(b.householdId, async (q) => {
      const all = await q.query(`SELECT 1 FROM transaction_parts`);
      const named = await q.query(`SELECT 1 FROM transaction_parts WHERE household_id = $1`, [a.householdId]);
      const updated = await q.query(`UPDATE transaction_parts SET amount = amount * 2`);
      const deleted = await q.query(`DELETE FROM transaction_parts`);
      return [all.rowCount, named.rowCount, updated.rowCount, deleted.rowCount];
    });
    expect(seen).toEqual([0, 0, 0, 0]);
    const part = (household: string, transaction: string) =>
      asB.inHousehold(b.householdId, (q) =>
        q.query(
          `INSERT INTO transaction_parts (household_id, transaction_id, position, category_id, amount, currency)
           VALUES ($1, $2, 5, $3, -1, 'EUR')`,
          [household, transaction, c.home],
        ),
      );
    // A's household named from B's context: the policy's check refuses it.
    await expect(part(a.householdId, t.id)).rejects.toThrow();
    // B's household with A's transaction: the composite key to the row refuses it.
    await expect(part(b.householdId, t.id)).rejects.toThrow();
    // B's own row is fine (the probe itself works).
    await expect(part(b.householdId, tb.id)).resolves.toBeDefined();
    const { rows } = await db.owner.query(
      `SELECT household_id, count(*)::int AS n FROM transactions.transaction_parts WHERE transaction_id = ANY($1::uuid[])
        GROUP BY household_id ORDER BY n DESC`,
      [[t.id, tb.id]],
    );
    expect(rows).toEqual([
      { household_id: a.householdId, n: 2 },
      { household_id: b.householdId, n: 1 },
    ]);
  });

  it("SEC-262: transaction_parts has the forced row policy for every command, and only the module's roles hold rights on it", async () => {
    const { rows: rls } = await db.owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT array_agg(p.polcmd::text || ':' || (p.polqual IS NOT NULL)::text || ':' || (p.polwithcheck IS NOT NULL)::text)
                 FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'transactions' AND c.relname = 'transaction_parts'`,
    );
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: true, policies: ["*:true:true"] }]);
    const { rows: same } = await db.owner.query(
      `SELECT (SELECT array_agg(DISTINCT grantee::text ORDER BY grantee::text) FROM information_schema.role_table_grants
                WHERE table_schema = 'transactions' AND table_name = 'transaction_parts') AS parts,
              (SELECT array_agg(DISTINCT grantee::text ORDER BY grantee::text) FROM information_schema.role_table_grants
                WHERE table_schema = 'transactions' AND table_name = 'transactions') AS base`,
    );
    expect(same[0]!.parts).toEqual(same[0]!.base);
    for (const other of ["ledger", "audit", "categories", "accounts"])
      await expect(
        db.databases
          .for(other as "ledger")
          .inHousehold(randomUUID(), (q) => q.query(`SELECT 1 FROM transactions.transaction_parts`)),
        other,
      ).rejects.toThrow();
  });

  it("SEC-262: a category of another space answers exactly like an unknown one, in both modes and among own ones; nothing is stored", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, "100.00");
    const own = await pick(a);
    const foreign = await pick(b);
    const t = await add(a, tx(account, "-10.00"));
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const months = (categoryId: string) =>
      call(a, "POST", `/v1/transactions/${t.id}/split`, {
        mode: "months",
        startMonth: "2026-10",
        months: 2,
        categoryId,
      });
    const cats = (categoryId: string) =>
      call(a, "POST", `/v1/transactions/${t.id}/split`, {
        mode: "categories",
        parts: [
          { categoryId: own.food, amount: "-4.00" },
          { categoryId, amount: "-6.00" },
        ],
      });
    for (const send of [months, cats]) {
      const theirs = await send(foreign.food);
      const unknown = await send(randomUUID());
      expect([theirs.statusCode, unknown.statusCode]).toEqual([400, 400]);
      expect(strip(theirs.body)).toEqual(strip(unknown.body));
      expect(leakText(theirs.body)).not.toContain(foreign.food);
    }
    // The same on a transaction that does not exist: the category answer does not depend on the transaction.
    const ghost = await call(a, "POST", `/v1/transactions/${randomUUID()}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: foreign.food,
    });
    expect(ghost.statusCode).toBe(400);
    expect((await call(a, "GET", `/v1/transactions/${t.id}`)).json().split).toBeNull();
    const { rows } = await db.owner.query(
      `SELECT 1 FROM transactions.transaction_parts WHERE transaction_id = $1`,
      [t.id],
    );
    expect(rows.length).toBe(0);
  });
});

describe("SEC-262 roles and scope: who reads and who changes", () => {
  it("SEC-262: a scoped member (any role) gets «not found» or «forbidden» on every transactions route, with no row, count or total — hidden or not", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    await add(space, tx(account, "-10.00")); // FR 18: a hidden row is a duplicate
    await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    const body = { mode: "months", startMonth: "2026-10", months: 2, categoryId: c.home };
    for (const role of ["owner", "admin", "editor", "viewer", "advisor"]) {
      const who = { role, scoped: true };
      for (const [method, url, payload] of [
        ["GET", "/v1/transactions", undefined],
        ["GET", "/v1/transactions?filter=hidden.eq:true", undefined],
        ["GET", "/v1/transactions?filter=hidden.eq:false", undefined],
        ["GET", `/v1/transactions/${t.id}`, undefined],
        ["POST", `/v1/transactions/${t.id}/show`, undefined],
        ["POST", `/v1/transactions/${t.id}/hide`, undefined],
        ["POST", `/v1/transactions/${t.id}/split`, body],
        ["DELETE", `/v1/transactions/${t.id}/split`, undefined],
        ["PATCH", `/v1/transactions/${t.id}`, { status: "pending" }],
      ] as const) {
        const res = await call(space, method, url, payload, who);
        expect([403, 404], `${role} ${method} ${url}: ${res.statusCode}`).toContain(res.statusCode);
        expect(leakText(res.body)).not.toContain(t.id);
        expect(leakText(res.body)).not.toContain("count");
        expect(leakText(res.body)).not.toContain("10");
      }
    }
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json()).toMatchObject({
      hidden: true,
      split: null,
      status: "posted",
    });
  });

  it("SEC-262: a viewer and an advisor of the space read (the space's own data) but change nothing: show, hide, split, unsplit, «Очікує» are 403 and write no audit entry or job", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    await call(space, "POST", `/v1/transactions/${t.id}/hide`);
    const before = [(await jobs(space.householdId)).length, await auditCount(space, t.id)];
    const body = { mode: "months", startMonth: "2026-10", months: 2, categoryId: c.home };
    for (const role of ["viewer", "advisor"]) {
      for (const [method, url, payload] of [
        ["POST", `/v1/transactions/${t.id}/show`, undefined],
        ["POST", `/v1/transactions/${t.id}/hide`, undefined],
        ["POST", `/v1/transactions/${t.id}/split`, body],
        ["DELETE", `/v1/transactions/${t.id}/split`, undefined],
        ["PATCH", `/v1/transactions/${t.id}`, { status: "pending" }],
        ["DELETE", `/v1/transactions/${t.id}`, undefined],
      ] as const)
        expect((await call(space, method, url, payload, { role })).statusCode, `${role} ${url}`).toBe(403);
    }
    expect([(await jobs(space.householdId)).length, await auditCount(space, t.id)]).toEqual(before);
  });

  it("SEC-262: a hidden row is out of the default list's rows, count and each total, whatever other filter or repeated hidden filter is sent", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const shown = await add(space, tx(account, "-10.00"));
    const hidden = await add(space, tx(account, "-7.00"));
    const copy = await add(space, tx(account, "-7.00")); // FR 18: a hidden row is a duplicate; its copy stays shown
    await call(space, "POST", `/v1/transactions/${hidden.id}/hide`);
    for (const query of [
      "",
      "?filter=status.eq:posted",
      "?filter=split.eq:false",
      "?filter=type.eq:out",
      "?filter=hidden.eq:false",
      `?filter=accountId.eq:${account}`,
      "?search=x",
      "?sort=amount",
    ]) {
      const res = await call(space, "GET", `/v1/transactions${query}`);
      if (res.statusCode !== 200) continue;
      const body = res.json();
      expect(leakText(res.body), query).not.toContain(hidden.id);
      expect([body.count, body.summary.expense.total?.amount], query).toEqual([2, "-17"]);
      expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual([shown.id, copy.id].sort());
    }
    const both = await call(space, "GET", "/v1/transactions?filter=hidden.eq:true&filter=hidden.eq:false");
    if (both.statusCode === 200) expect(both.json().count).toBe(0);
    const asked = (await call(space, "GET", "/v1/transactions?filter=hidden.eq:true")).json();
    expect([asked.count, asked.items[0].id, asked.summary.expense.total.amount]).toEqual([
      1,
      hidden.id,
      "-7",
    ]);
  });

  it("SEC-262: with the flags off «Очікує», hiding and splitting are closed for the owner too, and nothing is written", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    off.add("transactions.states");
    off.add("transactions.attributes");
    expect((await patch(space, t.id, { status: "pending" })).statusCode).toBe(400);
    expect(
      (await call(space, "POST", "/v1/transactions", tx(account, "-1.00", { status: "pending" }))).statusCode,
    ).toBe(400);
    expect((await call(space, "POST", `/v1/transactions/${t.id}/hide`)).statusCode).toBe(404);
    expect((await call(space, "POST", `/v1/transactions/${t.id}/show`)).statusCode).toBe(404);
    expect(
      (
        await call(space, "POST", `/v1/transactions/${t.id}/split`, {
          mode: "months",
          startMonth: "2026-10",
          months: 2,
          categoryId: c.home,
        })
      ).statusCode,
    ).toBe(404);
    off.clear();
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json()).toMatchObject({
      status: "posted",
      hidden: false,
      split: null,
    });
    expect(await transactionRows(space.householdId)).toBe(1);
  });

  it("SEC-262: the audit entries and the queue payloads of hide, split and «Очікує» carry no counterparty or description text", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const secret = ["Приватний", "контрагент", randomUUID()].join(" ");
    const res = await call(space, "POST", "/v1/transactions", {
      ...tx(account, "-10.00"),
      counterparty: secret,
      description: secret,
    });
    const id = res.json().id as string;
    await add(space, tx(account, "-10.00")); // FR 18: a hidden row is a duplicate
    await call(space, "POST", `/v1/transactions/${id}/hide`);
    await call(space, "POST", `/v1/transactions/${id}/split`, {
      mode: "months",
      startMonth: "2026-10",
      months: 2,
      categoryId: c.home,
    });
    await patch(space, id, { status: "pending" });
    await call(space, "DELETE", `/v1/transactions/${id}`);
    expect(JSON.stringify(await jobs(space.householdId))).not.toContain(secret);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    expect(log.length).toBe(5);
    expect(JSON.stringify(log)).not.toContain(secret);
  });
});

describe("SEC-262 survivors of the mutation run", () => {
  it("SEC-262 (mutant M28): a category merged away («retired») is refused for a part exactly like an unknown one", async () => {
    const space = await newSpace();
    const account = await createAccount(space, "100.00");
    const c = await pick(space);
    const t = await add(space, tx(account, "-10.00"));
    // A custom expense category, merged into «food»: taken out of use («retired») by the categories module itself.
    const groups = (await call(space, "GET", "/v1/categories")).json().groups as {
      id: string;
      categories: { id: string }[];
    }[];
    const groupId = groups.find((g) => g.categories.some((x) => x.id === c.food))!.id;
    const custom = await call(space, "POST", "/v1/categories", { groupId, name: "Синтетична категорія" });
    expect(custom.statusCode, custom.body).toBe(201);
    const customId = custom.json().id as string;
    const merged = await call(space, "POST", `/v1/categories/${customId}/merge`, { targetId: c.food });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json().sourceState).toBe("retired");
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const send = (categoryId: string) =>
      call(space, "POST", `/v1/transactions/${t.id}/split`, {
        mode: "months",
        startMonth: "2026-10",
        months: 2,
        categoryId,
      });
    const retired = await send(customId);
    const unknown = await send(randomUUID());
    expect([retired.statusCode, unknown.statusCode]).toEqual([400, 400]);
    expect(strip(retired.body)).toEqual(strip(unknown.body));
    expect((await call(space, "GET", `/v1/transactions/${t.id}`)).json().split).toBeNull();
  });
});
