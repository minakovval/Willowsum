import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { bulkActionsServicesFor } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
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
} from "../src/modules/categorization/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-02@PoC FR 23, AC 19 (the same dialog as BUD-01 «Налаштування → Категорії»): the count «N транзакцій» of the dialog «Видалити категорію…», through
 * the real API on a real PostgreSQL. Module categories asks the modules that keep transactions' categories through
 * their public port (`CategoryUsage.transactions`): categorization (the transaction's own category) and transactions
 * (split parts) — no SQL across modules. Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

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
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
      ...(method === "POST" && url === "/v1/bulk-actions" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

interface Category {
  id: string;
  name: string;
  kind: string;
  deletable: boolean;
}

async function categories(space: Space): Promise<Category[]> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().groups as { categories: Category[] }[]).flatMap((g) => g.categories);
}

async function category(space: Space, name: string): Promise<Category> {
  const found = (await categories(space)).find((c) => c.name === name);
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

async function createAccount(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function purchase(
  space: Space,
  accountId: string,
  counterparty: string,
  amount = "-12.40",
): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: "2026-10-15",
    counterparty,
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function setCategory(space: Space, transactionId: string, categoryId: string | null) {
  return call(space, "PUT", `/v1/transactions/${transactionId}/category`, { categoryId });
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
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
          flags: { isEnabled },
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

beforeEach(() => {
  off.clear();
});

async function usage(space: Space, categoryId: string, principal: Principal = {}) {
  return call(space, "GET", `/v1/categories/${categoryId}/usage`, undefined, principal);
}

/** A purchase of 4.00 € split into `a` and `b` (BUD-01 FR 6). */
async function split(space: Space, accountId: string, a: string, b: string): Promise<string> {
  const t = await purchase(space, accountId, "Синтетична кав'ярня", "-4.00");
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

describe("BUD-02@PoC FR 23: «Видалити категорію…» shows the count of the category's transactions", () => {
  it("BUD-02@PoC AC19: «Кава» with 12 transactions — the count is 12 and the category cannot be deleted", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    for (let i = 0; i < 12; i++)
      expect(
        (await setCategory(space, await purchase(space, account, "Синтетична кава"), coffee.id)).statusCode,
      ).toBe(200);
    const res = await usage(space, coffee.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ transactions: 12 });
    expect((await category(space, "Кава")).deletable).toBe(false);
  });

  it("BUD-02@PoC FR 23, BUD-01@PoC FR 13 (server part): the dialog's reason is exact — «12 транзакцій» and nothing else; a refused delete names the same reason with the same count", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    for (let i = 0; i < 12; i++)
      await setCategory(space, await purchase(space, account, "Синтетична кава"), coffee.id);
    const reason = {
      transactions: 12,
      rules: 0,
      recurringPayments: 0,
      mergedCategories: 0,
      budget: { limit: null, stored: false, planCells: 0 },
    };
    expect((await usage(space, coffee.id)).json()).toEqual({ ...reason, deletable: false });
    const refused = await call(space, "DELETE", `/v1/categories/${coffee.id}`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "CATEGORY_NOT_EMPTY", categoryUsage: reason });
  });

  it("BUD-02@PoC FR 23: a split transaction counts once, by its parts, however many parts have the category; a deleted transaction does not count; an empty category is 0", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const groceries = await category(space, "Продукти");
    expect((await usage(space, coffee.id)).json()).toMatchObject({ transactions: 0 });
    const own = await purchase(space, account, "Синтетична кава");
    expect((await setCategory(space, own, coffee.id)).statusCode).toBe(200);
    await split(space, account, coffee.id, groceries.id);
    await split(space, account, coffee.id, coffee.id);
    // A split transaction whose own category was set before it was split is still one transaction.
    const both = await purchase(space, account, "Синтетична кава", "-4.00");
    expect((await setCategory(space, both, coffee.id)).statusCode).toBe(200);
    expect(
      (
        await call(space, "POST", `/v1/transactions/${both}/split`, {
          mode: "categories",
          parts: [
            { categoryId: coffee.id, amount: "-1.00" },
            { categoryId: groceries.id, amount: "-3.00" },
          ],
        })
      ).statusCode,
    ).toBe(200);
    expect((await usage(space, coffee.id)).json()).toMatchObject({ transactions: 4 });
    expect((await call(space, "DELETE", `/v1/transactions/${own}`)).statusCode).toBe(200);
    expect((await usage(space, coffee.id)).json()).toMatchObject({ transactions: 3 });
  });

  it("BUD-02@PoC FR 23: more transactions than one page of the count (1 000) are all counted", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const ids: string[] = [];
    for (let i = 0; i < 1003; i++) ids.push(randomUUID());
    // Rows of the categorization module for transactions that do not exist do not count; real ones do.
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       SELECT $1, unnest($2::uuid[]), $3, 'manual'`,
      [space.householdId, ids, coffee.id],
    );
    for (let i = 0; i < 2; i++)
      expect(
        (await setCategory(space, await purchase(space, account, "Синтетична кава"), coffee.id)).statusCode,
      ).toBe(200);
    expect((await usage(space, coffee.id)).json()).toMatchObject({ transactions: 2 });
  });
});

describe("BUD-02@PoC FR 23 «Права доступу»: the count of a category", () => {
  it("BUD-02@PoC FR 23: another space's category, an unknown id, a scoped member and the flag off — not found; the count says nothing of another space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a);
    const secret = await addCategory(a, "Синтетична таємниця");
    expect(
      (await setCategory(a, await purchase(a, account, "Синтетичний кіоск"), secret.id)).statusCode,
    ).toBe(200);
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const foreign = await usage(b, secret.id);
    const unknown = await usage(b, randomUUID());
    expect(foreign.statusCode).toBe(404);
    expect(strip(foreign.body)).toEqual(strip(unknown.body));
    expect((await usage(a, secret.id, { role: "editor", scoped: true })).statusCode).toBe(404);
    off.add("categories.tree");
    expect((await usage(a, secret.id)).statusCode).toBe(404);
    off.clear();
    expect((await usage(a, secret.id)).json()).toMatchObject({ transactions: 1 });
  });

  it("BUD-02@PoC FR 23: a category merged away is out of use — not found", async () => {
    const space = await newSpace();
    const snacks = await addCategory(space, "Синтетичні снеки");
    const sweets = await addCategory(space, "Синтетичні солодощі");
    expect(
      (await call(space, "POST", `/v1/categories/${snacks.id}/merge`, { targetId: sweets.id })).statusCode,
    ).toBe(200);
    expect((await usage(space, snacks.id)).statusCode).toBe(404);
  });
});

describe("sec702: the count of a category — paging and isolation (security review of #702)", () => {
  it("sec702: real transactions after the first page of the count (1 000) are counted — the page boundary is crossed", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    // 1 000 rows for transactions that do not exist, with ids that sort before any real id: the first page is all of
    // them, so the real transactions are only on the second page.
    const ids = Array.from(
      { length: 1000 },
      (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
    );
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       SELECT $1, unnest($2::uuid[]), $3, 'manual'`,
      [space.householdId, ids, coffee.id],
    );
    for (let i = 0; i < 2; i++)
      expect(
        (await setCategory(space, await purchase(space, account, "Синтетична кава"), coffee.id)).statusCode,
      ).toBe(200);
    expect((await usage(space, coffee.id)).json()).toMatchObject({ transactions: 2 });
  });

  it("sec702: rows of another space that carry this space's category id are not counted (row-level security, defence in depth)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a);
    const accountB = await createAccount(b);
    const secret = await addCategory(a, "Синтетична таємниця");
    const groceriesB = await category(b, "Продукти");
    expect(
      (await setCategory(a, await purchase(a, accountA, "Синтетичний кіоск"), secret.id)).statusCode,
    ).toBe(200);
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
    expect((await usage(a, secret.id)).json()).toMatchObject({ transactions: 1 });
  });
});
