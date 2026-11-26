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
import { transactionsWithCategories } from "../src/modules/categorization/adapters/index.ts";
import { splitTransactionsIn } from "../src/modules/transactions/adapters/db/store.ts";

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

/** Security review of PR #714 (FIN-03@PoC FR 22 «Права доступу»): isolation and bounds of the category filter. */
async function asOwner<T>(schema: string, work: () => Promise<T>): Promise<T> {
  await db.owner.query(`SET search_path TO ${schema}`);
  try {
    return await work();
  } finally {
    await db.owner.query("RESET search_path");
  }
}

describe("FIN-03@PoC FR 22 «Права доступу» (security, PR 714): the category filter", () => {
  it("FIN-03@PoC FR 22: both id reads bind the space in their own SQL — run past row-level security they still give this space's rows only", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a);
    const accountB = await createAccount(b);
    const shared = await addCategory(a, "Синтетична таємниця");
    const groceriesA = await category(a, "Продукти");
    const groceriesB = await category(b, "Продукти");
    const ownA = await bought(a, accountA, shared.id);
    const splitA = await split(a, accountA, shared.id, groceriesA.id);
    const ownB = await purchase(b, accountB, "Синтетичний кіоск");
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, 'manual')`,
      [b.householdId, ownB, shared.id],
    );
    const splitB = await split(b, accountB, groceriesB.id, groceriesB.id);
    await db.owner.query(
      `UPDATE transactions.transaction_parts SET category_id = $3 WHERE household_id = $1 AND transaction_id = $2`,
      [b.householdId, splitB, shared.id],
    );
    const owner = {
      query: (text: string, values?: readonly unknown[]) => db.owner.query(text, values as unknown[]),
    };
    const own = await asOwner("categorization", () =>
      transactionsWithCategories(
        { ...owner, householdId: a.householdId } as never,
        a.householdId,
        [shared.id],
        100,
      ),
    );
    expect(own).toEqual([ownA]);
    const parts = await asOwner("transactions", () =>
      splitTransactionsIn(owner as never, a.householdId, [shared.id], 100),
    );
    expect(parts).toEqual([splitA]);
  });

  it("FIN-03@PoC FR 22: bounded on the parts too — more than 20 000 split transactions in a category is 422; the bound is no oracle for a scoped member or another space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const coffee = await addCategory(a, "Кава");
    await db.owner.query("SET session_replication_role = replica");
    try {
      await db.owner.query(
        `INSERT INTO transactions.transaction_parts (household_id, transaction_id, position, category_id, amount, currency)
         SELECT $1, gen_random_uuid(), 0, $2, -1, 'EUR' FROM generate_series(1, 20001)`,
        [a.householdId, coffee.id],
      );
    } finally {
      await db.owner.query("SET session_replication_role = origin");
    }
    const res = await list(a, [`category.eq:${coffee.id}`]);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 20000 });
    const scoped = await list(a, [`category.eq:${coffee.id}`], { role: "editor", scoped: true });
    expect(scoped.statusCode).toBe(404);
    const scopedUnknown = await list(a, [`category.eq:${randomUUID()}`], { role: "editor", scoped: true });
    const scopedBad = await list(a, ["category.eq:not-an-id"], { role: "editor", scoped: true });
    const strip = (body: string) =>
      JSON.stringify({ ...JSON.parse(body), supportId: undefined, traceId: undefined, instance: undefined });
    expect(scopedUnknown.statusCode).toBe(404);
    expect(scopedBad.statusCode).toBe(404);
    expect(strip(scoped.body)).toBe(strip(scopedUnknown.body));
    expect(strip(scopedBad.body)).toBe(strip(scopedUnknown.body));
    const foreign = await list(b, [`category.eq:${coffee.id}`]);
    const unknown = await list(b, [`category.eq:${randomUUID()}`]);
    expect(foreign.statusCode, foreign.body).toBe(200);
    expect(foreign.json()).toEqual(unknown.json());
    await db.owner.query(`DELETE FROM transactions.transaction_parts WHERE household_id = $1`, [
      a.householdId,
    ]);
  });

  it("FIN-03@PoC FR 22: the bound is the request's — 49 copies of one filter are read once, and two categories that are each within the bound but over it together are 422", async () => {
    const a = await newSpace();
    await createAccount(a);
    const coffee = await addCategory(a, "Кава");
    const tea = await addCategory(a, "Чай");
    const seed = (categoryId: string, n: number) =>
      db.owner.query(
        `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
         SELECT $1, gen_random_uuid(), $2, 'manual' FROM generate_series(1, $3::int)`,
        [a.householdId, categoryId, n],
      );
    await seed(coffee.id, 20_000);
    const copies = await list(
      a,
      Array.from({ length: 49 }, () => `category.eq:${coffee.id}`),
    );
    expect(copies.statusCode, copies.body).toBe(200);
    expect(copies.json()).toMatchObject({ count: 0 });
    await db.owner.query(`DELETE FROM categorization.transaction_categories WHERE household_id = $1`, [
      a.householdId,
    ]);
    await seed(coffee.id, 12_000);
    await seed(tea.id, 12_000);
    expect((await list(a, [`category.eq:${coffee.id}`])).statusCode).toBe(200);
    expect((await list(a, [`category.eq:${tea.id}`])).statusCode).toBe(200);
    const both = await list(a, [`category.eq:${coffee.id}`, `category.eq:${tea.id}`]);
    expect(both.statusCode, both.body).toBe(422);
    expect(both.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 20000 });
    expect(leakText(both.body)).not.toContain(coffee.id);
    await db.owner.query(`DELETE FROM categorization.transaction_categories WHERE household_id = $1`, [
      a.householdId,
    ]);
  });
});
