import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createGoalTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-05@PoC FR 10, AC 3 (#553): the average monthly expenses of «Подушка безпеки» served by the API — a server sum of
 * the space's expenses over the last 6 full months, without transfers between own accounts, each day at its rate into
 * the goal's currency, half to even; and FR 8 (#559): the list of «Витратити» beyond 100 transactions — not yet spent
 * from a goal, in the goal's currency, page after page. Real API, real PostgreSQL, real transactions, accounts, ledger
 * and fx-rates modules; synthetic names and amounts; the test's own clock (15 November 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-15T10:00:00Z");
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
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

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    for (let i = 0; i < 50; i++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
}

async function account(
  space: Space,
  kind = "current",
  currency = "EUR",
  amount = "50000.00",
): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind} ${currency}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function transaction(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  extra: { currency?: string; counterparty?: string } = {},
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: extra.currency ?? "EUR" },
    date,
    ...(extra.counterparty ? { counterparty: extra.counterparty } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
    [date, currency, uah],
  );
}

/** Sets the category of a transaction by its name in the space's tree (BUD-01). */
async function categoryId(space: Space, name: string): Promise<string> {
  const tree = await call(space, "GET", "/v1/categories");
  expect(tree.statusCode, tree.body).toBe(200);
  const id = (tree.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name)?.id;
  expect(id, name).toBeDefined();
  return id!;
}

async function categorise(space: Space, transactionId: string, name: string): Promise<void> {
  const id = await categoryId(space, name);
  const res = await app.inject({
    method: "PUT",
    url: `/v1/transactions/${transactionId}/category`,
    headers: {
      origin: WEB,
      "content-type": "application/json",
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
    },
    payload: JSON.stringify({ categoryId: id }),
  });
  expect(res.statusCode, res.body).toBe(200);
}

const average = async (space: Space, query = "") => {
  const res = await call(space, "GET", `/v1/goals/emergency-average${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
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
          pendingPostings: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: clock.now })),
            now: clock.now,
          }),
          rates: (requests) =>
            createFxRates({ db: db.databases.for("fx-rates"), now: clock.now }).rates(requests),
          audit,
          clock,
          newId: randomUUID,
        }),
        categories: createCategoriesServices({ audit, clock, newId: randomUUID, usage: [] }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
        }),
        goals: createGoalsServices({
          accounts,
          ledger,
          transactions: createTransactionLookup(db.databases.for("transactions")),
          reads: {
            transactions: createGoalTransactions(db.databases.for("transactions")),
            fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
            categorization: createTransactionCategories(db.databases.for("categorization")),
            categories: directory,
          },
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

describe("BUD-05@PoC FR 10: the average monthly expenses of «Подушка безпеки» come from the API", () => {
  it("BUD-05@PoC AC3: 6 months of expenses at 4 200 € a month — the average is 4 200,00 € «за 6 міс.»; 3 months make the goal 12 600 €", async () => {
    const space = await newSpace();
    const current = await account(space);
    const savings = await account(space, "savings");
    // May–October 2026: 4 200 € a month in two expenses each.
    for (const month of ["05", "06", "07", "08", "09", "10"]) {
      await transaction(space, current, "-3000.00", `2026-${month}-03`);
      await transaction(space, current, "-1200.00", `2026-${month}-20`);
    }
    // Not expenses of the window: an income, this month's expense, April's expense (7 months back).
    await transaction(space, current, "9000.00", "2026-10-01");
    await transaction(space, current, "-777.00", "2026-11-02");
    await transaction(space, current, "-555.00", "2026-04-30");
    // A transfer between own accounts is no expense.
    const transfer = await call(space, "POST", "/v1/transactions/transfers", {
      fromAccountId: current,
      toAccountId: savings,
      amount: eur("2500.00"),
      date: "2026-09-10",
    });
    expect(transfer.statusCode, transfer.body).toBe(201);

    const a = await average(space);
    expect(a).toEqual({
      currency: "EUR",
      average: eur("4200"),
      months: 6,
      from: "2026-05-01",
      to: "2026-10-31",
      approximate: false,
      unavailableCount: 0,
    });

    // AC 3: the user keeps 3 months — the goal is 3 × 4 200 € = 12 600 €.
    const res = await call(space, "POST", "/v1/goals", {
      template: "emergency",
      name: "Подушка безпеки",
      target: eur("12600.00"),
      emergencyMonths: 3,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ target: eur("12600"), emergencyMonths: 3 });
  });

  it("BUD-05@PoC FR 10: spending as the budget counts it — a refund lowers its category, service and income categories are not spending", async () => {
    const space = await newSpace();
    const current = await account(space);
    // A 1 000 € purchase in «Одяг» refunded the same month: 0 € of spending (BUD-02@PoC, BUD-06@PoC edge cases).
    const bought = await transaction(space, current, "-1000.00", "2026-09-03");
    await categorise(space, bought, "Одяг");
    const refund = await transaction(space, current, "1000.00", "2026-09-10");
    await categorise(space, refund, "Одяг");
    // «Переказ» (a card repayment without its pair) is a service category: no spending (BUD-01@PoC FR 1).
    const repay = await transaction(space, current, "-700.00", "2026-09-12");
    // The API refuses a service category for a person (categoryAllowed); the system sets it, so set it here directly.
    await categorise(space, repay, "Одяг");
    await db.owner.query(
      `UPDATE categorization.transaction_categories SET category_id = $3
        WHERE household_id = $1 AND transaction_id = $2`,
      [space.householdId, repay, await categoryId(space, "Переказ")],
    );
    // An outflow of an income category lowers income, not spending; an uncategorised inflow is no refund.
    const back = await transaction(space, current, "-50.00", "2026-09-14");
    await categorise(space, back, "Зарплата");
    await transaction(space, current, "300.00", "2026-09-20");
    // What does count: 120 € uncategorised and 60 € «Одяг» less a 20 € refund of it.
    await transaction(space, current, "-120.00", "2026-10-02");
    const shirt = await transaction(space, current, "-60.00", "2026-10-05");
    await categorise(space, shirt, "Одяг");
    const partial = await transaction(space, current, "20.00", "2026-10-07");
    await categorise(space, partial, "Одяг");
    // 160 € over September–October (the first counted outflow is the purchase on 3 September).
    expect(await average(space)).toMatchObject({ average: eur("80"), months: 2 });
  });

  it("BUD-05@PoC FR 10: a shorter history averages over its own months, half to even to cents", async () => {
    const space = await newSpace();
    const current = await account(space);
    // September and October only: 100,01 € ÷ 2 = 50,005 € → 50,00 € (half to even; half up would give 50,01 €).
    await transaction(space, current, "-60.00", "2026-09-15");
    await transaction(space, current, "-40.01", "2026-10-15");
    expect(await average(space)).toMatchObject({ average: eur("50"), months: 2 });
  });

  it("BUD-05@PoC FR 10: another currency counts at its day's rate; a day without a rate is left out and marked", async () => {
    const space = await newSpace();
    const current = await account(space);
    const uah = await account(space, "current", "UAH", "900000.00");
    await rate("2026-10-01", "EUR", "50.00");
    await rate("2026-10-10", "EUR", "50.00");
    await transaction(space, current, "-100.00", "2026-10-05");
    await transaction(space, uah, "-5000.00", "2026-10-10", { currency: "UAH" });
    // 2 000 UAH on 2026-05-02: no rate on or before that day — left out, the average is approximate.
    await transaction(space, uah, "-2000.00", "2026-05-02", { currency: "UAH" });
    const a = await average(space);
    // (100 + 5 000 / 50) € over May–October = 200 € ÷ 6 = 33,333… → 33,33 €.
    expect(a).toMatchObject({ average: eur("33.33"), months: 6, approximate: true, unavailableCount: 1 });
    // In the goal's currency when it is not the space's (a goal in hryvnias): 100 € at the rate of 1 October (the
    // nearest earlier) × 50 + 5 000 UAH + 2 000 UAH = 12 000 UAH ÷ 6 = 2 000 UAH, approximate.
    expect(await average(space, "?currency=UAH")).toMatchObject({
      currency: "UAH",
      average: { amount: "2000", currency: "UAH" },
      approximate: true,
      unavailableCount: 0,
    });
    const bad = await call(space, "GET", "/v1/goals/emergency-average?currency=XXX1");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "query", path: "currency", issue: "invalid" }]);
  });

  it("BUD-05@PoC FR 10: without expenses there is no average; another space's expenses are never counted; a scoped member is refused", async () => {
    const owner = await newSpace();
    const current = await account(owner);
    await transaction(owner, current, "-900.00", "2026-10-05");
    const other = await newSpace();
    expect(await average(other)).toMatchObject({ average: null, months: 0 });
    const scoped = await call(owner, "GET", "/v1/goals/emergency-average", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(Object.keys(scoped.json()).sort()).not.toContain("average");
  });
});

describe("BUD-05@PoC FR 8: «Витратити» reads beyond 100 transactions, only those not spent from a goal yet (#559)", () => {
  it("BUD-05@PoC FR 8: 105 outgoing transactions on the goal's account come page by page, newest first; spent, incoming, other-currency and other-account ones never come", async () => {
    const space = await newSpace();
    const savings = await account(space, "savings");
    const current = await account(space);
    const uah = await account(space, "savings", "UAH");
    const goal = await call(space, "POST", "/v1/goals", {
      template: "travel",
      name: "Відпустка",
      target: eur("40000.00"),
      part: { kind: "envelope", accountId: savings, startAmount: "30000.00" },
    });
    expect(goal.statusCode, goal.body).toBe(201);
    const goalId = goal.json().id as string;
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = i < 28 ? "07" : i < 56 ? "08" : i < 84 ? "09" : "10";
      ids.push(
        await transaction(space, savings, "-10.00", `2026-${month}-${day}`, { counterparty: `Готель ${i}` }),
      );
    }
    await transaction(space, savings, "500.00", "2026-10-20");
    await transaction(space, current, "-15.00", "2026-10-20");
    await transaction(space, uah, "-15.00", "2026-10-20", { currency: "UAH" });
    // One is already spent from the goal: it is left out.
    const spent = ids[104]!;
    const spend = await call(space, "POST", `/v1/goals/${goalId}/spends`, {
      transactions: [{ transactionId: spent, accountId: savings }],
    });
    expect(spend.statusCode, spend.body).toBe(201);

    const seen: { id: string; date: string }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const query: string = `?limit=50${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await call(space, "GET", `/v1/goals/${goalId}/spendable${query}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.count).toBe(104);
      for (const item of body.items) {
        expect(item).toMatchObject({ accountId: savings, amount: eur("10") });
        seen.push({ id: item.id, date: item.date });
      }
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(104);
    expect(new Set(seen.map((s) => s.id))).toEqual(new Set(ids.slice(0, 104)));
    expect(seen.map((s) => s.date)).toEqual([...seen.map((s) => s.date)].sort().reverse());

    // The search field above the list: counterparty or description, «%» and «_» literal.
    const found = await call(
      space,
      "GET",
      `/v1/goals/${goalId}/spendable?search=${encodeURIComponent("Готель 10")}`,
    );
    expect(
      found
        .json()
        .items.map((t: { counterparty: string }) => t.counterparty)
        .sort(),
    ).toEqual(["Готель 10", "Готель 100", "Готель 101", "Готель 102", "Готель 103"].sort());
    const literal = await call(
      space,
      "GET",
      `/v1/goals/${goalId}/spendable?search=${encodeURIComponent("%")}`,
    );
    expect(literal.json()).toMatchObject({ items: [], count: 0 });
  });

  it("BUD-05@PoC FR 8: a goal of marks lists any account of the space; another space's goal is not found and its transactions never leak", async () => {
    const owner = await newSpace();
    const current = await account(owner);
    const marks = await call(owner, "POST", "/v1/goals", {
      template: "purchase",
      name: "Диван",
      target: eur("900.00"),
    });
    const goalId = marks.json().id as string;
    const mine = await transaction(owner, current, "-120.00", "2026-10-12");
    const other = await newSpace();
    const theirs = await transaction(other, await account(other), "-80.00", "2026-10-12");

    const list = await call(owner, "GET", `/v1/goals/${goalId}/spendable`);
    expect(list.json().items.map((t: { id: string }) => t.id)).toEqual([mine]);
    expect(leakText(list.body)).not.toContain(theirs);

    // Another space asks for this goal: the same problem as a goal that does not exist.
    const foreign = await call(other, "GET", `/v1/goals/${goalId}/spendable`);
    const missing = await call(other, "GET", `/v1/goals/${randomUUID()}/spendable`);
    expect(foreign.statusCode).toBe(404);
    expect(Object.keys(foreign.json()).sort()).toEqual(Object.keys(missing.json()).sort());
    expect(foreign.json().code).toBe(missing.json().code);
    expect(leakText(foreign.body)).not.toContain(mine);

    const bad = await call(owner, "GET", `/v1/goals/${goalId}/spendable?cursor=bm90LWEtY3Vyc29y`);
    expect(bad.statusCode).toBe(400);
    const scoped = await call(owner, "GET", `/v1/goals/${goalId}/spendable`, undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
  });

  it("BUD-05@PoC FR 8: rows of one day page by (date, time of recording, id) with no gap or repeat", async () => {
    const space = await newSpace();
    const current = await account(space);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await transaction(space, current, "-1.00", "2026-10-07"));
    const goal = await call(space, "POST", "/v1/goals", {
      template: "custom",
      name: "Синтетична",
      target: eur("900.00"),
    });
    expect(goal.statusCode, goal.body).toBe(201);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await call(
        space,
        "GET",
        `/v1/goals/${goal.json().id}/spendable?limit=3${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.json().count).toBe(8);
      seen.push(...res.json().items.map((t: { id: string }) => t.id));
      cursor = res.json().nextCursor;
    } while (cursor !== null);
    expect(seen.sort()).toEqual(ids.sort());
  });
});

// ===== sec584 (security review of #584): append to apps/api/test/bud05-goals-cushion-spendable.it.test.ts =====
const forged = (position: unknown) => Buffer.from(JSON.stringify(position), "utf8").toString("base64url");

describe("BUD-05@PoC FR 8, FR 10: the goals' reads hold against forged input and other states (sec584)", () => {
  it("BUD-05@PoC FR 10: a hidden expense is not counted in the average", async () => {
    const space = await newSpace();
    const current = await account(space);
    await transaction(space, current, "-600.00", "2026-10-05");
    const hidden = await transaction(space, current, "-5000.00", "2026-10-06");
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hidden]);
    expect(await average(space)).toMatchObject({ average: eur("600"), months: 1 });
  });

  it("BUD-05@PoC FR 8: a goal of marks lists only its currency; «Очікує» and hidden transactions never come, in the list or in the count", async () => {
    const space = await newSpace();
    const current = await account(space);
    const uah = await account(space, "current", "UAH", "900000.00");
    const goal = await call(space, "POST", "/v1/goals", {
      template: "purchase",
      name: "Диван",
      target: eur("900.00"),
    });
    const goalId = goal.json().id as string;
    const mine = await transaction(space, current, "-120.00", "2026-10-12");
    await transaction(space, uah, "-130.00", "2026-10-12", { currency: "UAH" });
    const pending = await transaction(space, current, "-140.00", "2026-10-13");
    const hidden = await transaction(space, current, "-150.00", "2026-10-14");
    await db.owner.query(`UPDATE transactions.transactions SET status = 'pending' WHERE id = $1`, [pending]);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hidden]);
    const list = await call(space, "GET", `/v1/goals/${goalId}/spendable`);
    expect(list.json().items.map((t: { id: string }) => t.id)).toEqual([mine]);
    expect(list.json().count).toBe(1);
  });

  it("BUD-05@PoC FR 8: a side of a transfer between own accounts is not listed", async () => {
    const space = await newSpace();
    const current = await account(space);
    const savings = await account(space, "savings");
    const goal = await call(space, "POST", "/v1/goals", {
      template: "purchase",
      name: "Диван",
      target: eur("900.00"),
    });
    const transfer = await call(space, "POST", "/v1/transactions/transfers", {
      fromAccountId: current,
      toAccountId: savings,
      amount: eur("250.00"),
      date: "2026-10-10",
    });
    expect(transfer.statusCode, transfer.body).toBe(201);
    const list = await call(space, "GET", `/v1/goals/${goal.json().id}/spendable`);
    expect(list.json()).toMatchObject({ items: [], count: 0 });
  });

  it("BUD-05@PoC FR 8: a transaction spent from a goal of another space is not taken out of this space's list; the page size is 1–100", async () => {
    const owner = await newSpace();
    const current = await account(owner);
    const goal = await call(owner, "POST", "/v1/goals", {
      template: "purchase",
      name: "Диван",
      target: eur("900.00"),
    });
    const goalId = goal.json().id as string;
    const mine = await transaction(owner, current, "-120.00", "2026-10-12");
    // Another space's spend row that names this space's transaction (only a broken write could make one).
    const other = await newSpace();
    const otherAccount = await account(other);
    const otherGoal = await call(other, "POST", "/v1/goals", {
      template: "purchase",
      name: "Стіл",
      target: eur("900.00"),
    });
    await db.owner.query(
      `INSERT INTO goals.spends (household_id, id, goal_id, transaction_id, account_id, entry_id, amount, currency, spent_on)
       VALUES ($1, $2, $3, $4, $5, $6, 120, 'EUR', '2026-10-12')`,
      [other.householdId, randomUUID(), otherGoal.json().id, mine, otherAccount, randomUUID()],
    );
    const list = await call(owner, "GET", `/v1/goals/${goalId}/spendable`);
    expect(list.json().items.map((t: { id: string }) => t.id)).toEqual([mine]);
    for (const limit of ["0", "-1", "101", "1000000000", "abc", "1.5"])
      expect(
        (await call(owner, "GET", `/v1/goals/${goalId}/spendable?limit=${limit}`)).statusCode,
        limit,
      ).toBe(400);
  });

  // Defect (Blocking 2): `d` and `r` of the cursor reach `$6::date` / `$7::timestamptz` unchecked — SQLSTATE 22007/22008/22021, 500.
  it("BUD-05@PoC FR 8: a forged cursor that is not a position of this list is 400, never 500", async () => {
    const owner = await newSpace();
    const goal = await call(owner, "POST", "/v1/goals", {
      template: "purchase",
      name: "Диван",
      target: eur("900.00"),
    });
    const i = randomUUID();
    const r = "2026-10-12 10:00:00.123456+00";
    const positions = [
      { d: "not-a-date", r, i },
      { d: "0000-00-00", r, i },
      { d: "2026-02-30", r, i },
      { d: "-1", r, i },
      { d: "2026-10-12", r: "garbage", i },
      { d: "2026-10-12", r: "2026-13-45 99:99:99+00", i },
      { d: "2026-10-12", r: "2026-10-12 10:00:00+99", i },
      { d: "2026-10-12", r: "2026-10-12\u0000", i },
    ];
    const statuses: number[] = [];
    for (const p of positions)
      statuses.push(
        (await call(owner, "GET", `/v1/goals/${goal.json().id}/spendable?cursor=${forged(p)}`)).statusCode,
      );
    expect(statuses).toEqual(positions.map(() => 400));
    // The same for a NUL in the search text (SQLSTATE 22021).
    expect((await call(owner, "GET", `/v1/goals/${goal.json().id}/spendable?search=%00`)).statusCode).toBe(
      400,
    );
  });

  // Defect (Blocking 1): the sums leave NUMERIC(38,18) inside `expensesByDay` (Money.of) or `fx.total` — AmountOutOfRangeError, 500.
  it("BUD-05@PoC FR 10: expenses whose sum or conversion leaves the money range give no average, never 500", async () => {
    const big = "-90000000000000000000.00"; // 20 integer digits: accepted by POST /v1/transactions
    await rate("2026-09-01", "EUR", "50.00").catch(() => undefined);
    const results: unknown[] = [];
    for (const dates of [["2026-10-05"], ["2026-10-05", "2026-10-05"], ["2026-10-01", "2026-10-02"]]) {
      const space = await newSpace();
      const current = await account(space);
      for (const date of dates) await transaction(space, current, big, date);
      for (const query of ["", "?currency=UAH"]) {
        if (dates.length === 1 && query === "") continue; // one amount in its own currency fits
        const res = await call(space, "GET", `/v1/goals/emergency-average${query}`);
        results.push([res.statusCode, res.statusCode === 200 ? res.json().average : res.json().code]);
      }
    }
    expect(results).toEqual(results.map(() => [200, null]));
  });
});
