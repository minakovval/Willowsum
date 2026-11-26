import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { bulkActionsServicesFor } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationCategoryUsage,
  createCategorizationServices,
  createCategoryTransactions,
} from "../src/modules/categorization/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * FIN-03@PoC FR 22 «Категорії» of the list «Транзакції», the server part of «Показати транзакції» in the dialog
 * «Видалити категорію…» (BUD-01@PoC AC 20, BUD-02@PoC AC 19): `filter=category.eq:<id>` lists the transactions the
 * dialog counts — an unsplit one by its own category (module categorization, through its port), a split one by its
 * parts (module transactions) — through the real API on a real PostgreSQL. Every name and amount is synthetic; the
 * clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;

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
  method: "GET" | "POST" | "PUT" | "DELETE",
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

interface Category {
  id: string;
  name: string;
}

async function category(space: Space, name: string): Promise<Category> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: Category[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!;
}

async function addCategory(space: Space, name: string, groupName = "Харчування"): Promise<Category> {
  const res = await call(space, "GET", "/v1/categories");
  const group = (res.json().groups as { id: string; name: string }[]).find((g) => g.name === groupName)!;
  const created = await call(space, "POST", "/v1/categories", { groupId: group.id, name });
  expect(created.statusCode, created.body).toBe(201);
  return created.json() as Category;
}

async function createAccount(space: Space, name = "Синтетичний рахунок"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name,
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function purchase(space: Space, accountId: string, counterparty: string, amount = "-12.40") {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: "2026-10-15",
    counterparty,
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function bought(space: Space, accountId: string, categoryId: string, amount = "-12.40") {
  const id = await purchase(space, accountId, "Синтетична кав'ярня", amount);
  const set = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId });
  expect(set.statusCode, set.body).toBe(200);
  return id;
}

/** A purchase of 4.00 € split into `a` (3.20) and `b` (0.80) (BUD-01 FR 6). */
async function split(space: Space, accountId: string, a: string, b: string): Promise<string> {
  const t = await purchase(space, accountId, "Синтетичний супермаркет", "-4.00");
  const res = await call(space, "POST", `/v1/transactions/${t}/split`, {
    mode: "categories",
    parts: [
      { categoryId: a, amount: "-3.20" },
      { categoryId: b, amount: "-0.80" },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  return t;
}

function list(space: Space, filters: string[], principal: Principal = {}) {
  const query = filters.map((f) => `filter=${encodeURIComponent(f)}`).join("&");
  return call(space, "GET", `/v1/transactions?pageSize=100&${query}`, undefined, principal);
}

const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id).sort();

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
  const ledger = createLedger(db.databases.for("ledger"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
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
          categories: directory,
          categoryTransactions: createCategoryTransactions(db.databases.for("categorization")),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [
            createTransactionCategoryUsage(db.databases.for("transactions")),
            createCategorizationCategoryUsage(db.databases.for("categorization"), lookup),
          ],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        bulkActions: bulkActionsServicesFor(audit, db.databases, { now: () => NOW }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("BUD-01@PoC AC 20, BUD-02@PoC AC 19 (server part): «Показати транзакції» opens the list with «Категорія: <назва>»", () => {
  it("BUD-01@PoC AC20: «Кава» with its transactions — `category.eq` lists exactly them, the same number as the dialog's «N транзакцій», with their totals", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const groceries = await category(space, "Продукти");
    const own: string[] = [];
    for (let i = 0; i < 5; i++) own.push(await bought(space, account, coffee.id, "-2.50"));
    await bought(space, account, groceries.id);
    await purchase(space, account, "Синтетичний кіоск");
    const res = await list(space, [`category.eq:${coffee.id}`]);
    expect(res.statusCode, res.body).toBe(200);
    expect(ids(res.json())).toEqual([...own].sort());
    expect(res.json()).toMatchObject({ count: 5, from: 1, to: 5 });
    expect(res.json().summary.expense.total).toEqual({ amount: "-12.5", currency: "EUR" });
    const usage = await call(space, "GET", `/v1/categories/${coffee.id}/usage`);
    expect(usage.json()).toMatchObject({ transactions: res.json().count });
  });

  it("BUD-02@PoC AC19: the budget row «Кава» with 12 transactions — the list by its category has the 12", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    for (let i = 0; i < 12; i++) await bought(space, account, coffee.id);
    const res = await list(space, [`category.eq:${coffee.id}`]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().count).toBe(12);
    expect((await call(space, "GET", `/v1/categories/${coffee.id}/usage`)).json()).toMatchObject({
      transactions: 12,
    });
  });
});

describe("FIN-03@PoC FR 22 «Категорії»: the filter of the list «Транзакції»", () => {
  it("FIN-03@PoC FR 22: a split transaction is in a category by its parts — once — and not by the own category it had before the split; a deleted transaction is not listed", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const groceries = await category(space, "Продукти");
    const own = await bought(space, account, coffee.id);
    const mixed = await split(space, account, coffee.id, groceries.id);
    const twice = await split(space, account, coffee.id, coffee.id);
    // Its own category was «Кава» before it was split into «Продукти» only: it is no longer in «Кава».
    const moved = await bought(space, account, coffee.id, "-4.00");
    const res = await call(space, "POST", `/v1/transactions/${moved}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries.id, amount: "-1.00" },
        { categoryId: groceries.id, amount: "-3.00" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const gone = await bought(space, account, coffee.id);
    expect((await call(space, "DELETE", `/v1/transactions/${gone}`)).statusCode).toBe(200);

    const inCoffee = await list(space, [`category.eq:${coffee.id}`]);
    expect(inCoffee.statusCode, inCoffee.body).toBe(200);
    expect(ids(inCoffee.json())).toEqual([own, mixed, twice].sort());
    expect(inCoffee.json().count).toBe(3);
    expect((await call(space, "GET", `/v1/categories/${coffee.id}/usage`)).json()).toMatchObject({
      transactions: 3,
    });
    const inGroceries = await list(space, [`category.eq:${groceries.id}`]);
    expect(ids(inGroceries.json())).toEqual([mixed, moved].sort());
  });

  it("FIN-03@PoC FR 22: «Категорії» with several ticked is any of them (`category.in`); the exact categories only — another category of the same group is not in; with other filters all must hold", async () => {
    const space = await newSpace();
    const card = await createAccount(space, "Синтетична картка");
    const cash = await createAccount(space, "Синтетична готівка");
    const coffee = await addCategory(space, "Кава");
    const tea = await addCategory(space, "Чай");
    const sweets = await addCategory(space, "Солодощі");
    const coffeeCard = await bought(space, card, coffee.id);
    const coffeeCash = await bought(space, cash, coffee.id);
    const teaCard = await bought(space, card, tea.id);
    await bought(space, card, sweets.id);

    const any = await list(space, [`category.in:${coffee.id},${tea.id}`]);
    expect(any.statusCode, any.body).toBe(200);
    expect(ids(any.json())).toEqual([coffeeCard, coffeeCash, teaCard].sort());
    const onCard = await list(space, [`category.in:${coffee.id},${tea.id}`, `accountId.eq:${card}`]);
    expect(ids(onCard.json())).toEqual([coffeeCard, teaCard].sort());
    expect(onCard.json().count).toBe(2);
    // Two category filters: both must hold — no transaction is in two categories by its own category.
    const both = await list(space, [`category.eq:${coffee.id}`, `category.eq:${tea.id}`]);
    expect(both.json()).toMatchObject({ count: 0, items: [] });
    // A split one with parts in both is in both.
    const parts = await split(space, card, coffee.id, tea.id);
    expect(ids((await list(space, [`category.eq:${coffee.id}`, `category.eq:${tea.id}`])).json())).toEqual([
      parts,
    ]);
  });

  it("FIN-03@PoC FR 22: a malformed category filter is 400 without echoing it; an unknown operator is an unknown filter", async () => {
    const space = await newSpace();
    const bad = await list(space, ["category.eq:Синтетична-не-ідентифікатор"]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ path: "filter", issue: "invalid_value" }],
    });
    expect(leakText(bad.body)).not.toContain("Синтетична-не-ідентифікатор");
    const op = await list(space, [`category.ne:${randomUUID()}`]);
    expect(op.statusCode).toBe(400);
    expect(op.json()).toMatchObject({ errors: [{ path: "filter", issue: "unknown_filter" }] });
    const empty = await list(space, ["category.in:"]);
    expect(empty.statusCode).toBe(400);
  });

  it("FIN-03@PoC FR 22: bounded — a category with more than 20 000 transactions is 422 LIMIT_REACHED, never a partial list", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Кава");
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       SELECT $1, gen_random_uuid(), $2, 'manual' FROM generate_series(1, 20001)`,
      [space.householdId, coffee.id],
    );
    const res = await list(space, [`category.eq:${coffee.id}`]);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 20000 });
  });
});

describe("FIN-03@PoC FR 22 «Права доступу»: the category filter and other spaces", () => {
  it("FIN-03@PoC FR 22: another space's category matches nothing — the same answer as an unknown id, without its names or amounts; a scoped member is not found", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a, "Синтетичний рахунок А");
    const secret = await addCategory(a, "Синтетична таємниця");
    await bought(a, accountA, secret.id, "-77.77");
    await createAccount(b);
    const foreign = await list(b, [`category.eq:${secret.id}`]);
    const unknown = await list(b, [`category.eq:${randomUUID()}`]);
    expect(foreign.statusCode, foreign.body).toBe(200);
    expect(foreign.json()).toEqual(unknown.json());
    expect(foreign.json()).toMatchObject({ count: 0, items: [] });
    for (const leaked of ["77.77", "Синтетична таємниця", "Синтетичний рахунок А", "кав'ярня"])
      expect(leakText(foreign.body)).not.toContain(leaked);
    const scoped = await list(a, [`category.eq:${secret.id}`], { role: "editor", scoped: true });
    expect(scoped.statusCode).toBe(404);
    expect((await list(a, [`category.eq:${secret.id}`])).json().count).toBe(1);
  });

  it("FIN-03@PoC FR 22: rows of another space that carry this space's category id are not listed (row-level security, defence in depth)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a);
    const accountB = await createAccount(b);
    const secret = await addCategory(a, "Синтетична таємниця");
    const groceriesB = await category(b, "Продукти");
    const mine = await bought(a, accountA, secret.id);
    // Space B: an own-category row and a split part that point at A's category (seeded as the owner, past every check).
    const ownB = await purchase(b, accountB, "Синтетичний кіоск");
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, 'manual')`,
      [b.householdId, ownB, secret.id],
    );
    const splitB = await split(b, accountB, groceriesB.id, groceriesB.id);
    await db.owner.query(
      `UPDATE transactions.transaction_parts SET category_id = $3 WHERE household_id = $1 AND transaction_id = $2`,
      [b.householdId, splitB, secret.id],
    );
    expect(ids((await list(a, [`category.eq:${secret.id}`])).json())).toEqual([mine]);
    // B sees its own rows by the id it holds, never A's transaction.
    expect(ids((await list(b, [`category.eq:${secret.id}`])).json())).toEqual([ownB, splitB].sort());
  });
});
