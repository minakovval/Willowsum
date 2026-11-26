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
import {
  createCategoriesServices,
  createCategoryDirectory,
  type CategoryDirectory,
  type CategoryUsage,
} from "../src/modules/categories/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-01@PoC FR 12, AC18, AC19 (#260 item 1): deleting an empty custom category, through the real API on a real
 * PostgreSQL. «Empty» is asked of every module that keeps category ids (the port `CategoryUsage`): here the split
 * parts of `transactions` (the only ones on `main`) and a stand-in for the modules not built yet — the transaction's
 * own category and the rules (categorization, BUD-01 b), limits and «План» cells (budget, BUD-02), recurring payments
 * (recurring, BUD-07; lead decision, #260 item 3). Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const NOT_EMPTY = "CATEGORY_NOT_EMPTY";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
/** What the module not wired here answers: category ids its records (regular payments) hold. */
const elsewhere = new Set<string>();
const standIn: CategoryUsage = {
  module: "recurring",
  used: async (_householdId, ids) => new Set(ids.filter((id) => elsewhere.has(id))),
  holds: async (_householdId, id) => ({ recurringPayments: elsewhere.has(id) ? 1 : 0 }),
};
/** Module budget's port (its real one: bud01-delete-category-limit.it.test.ts): category ids with a limit. */
const limited = new Set<string>();
const released: string[] = [];
const LIMIT = { limit: { amount: "30.00", currency: "EUR" }, stored: true, planCells: 0 };
const NONE = { limit: null, stored: false, planCells: 0 };
const budgetStandIn: CategoryUsage = {
  module: "budget",
  limits: {
    held: async (_householdId, ids) => new Set(ids.filter((id) => limited.has(id))),
    entries: async (_householdId, id) => (limited.has(id) ? LIMIT : NONE),
    release: async (_caller, id) => {
      released.push(id);
      limited.delete(id);
      return LIMIT;
    },
  },
};

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
  groupId: string;
  systemKey: string | null;
  kind: "expense" | "income" | "service";
  name: string;
  hidden: boolean;
  deletable: boolean;
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

async function all(space: Space): Promise<Category[]> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().groups as { categories: Category[] }[]).flatMap((g) => g.categories);
}

async function named(space: Space, name: string): Promise<Category | undefined> {
  return (await all(space)).find((c) => c.name === name);
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

/** A purchase of 4.00 € split into the category and «Продукти» (BUD-01 FR 6): a split part has the category. */
async function splitInto(space: Space, accountId: string, categoryId: string, other: string) {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount: "-4.00", currency: "EUR" },
    date: "2026-10-15",
    counterparty: "Синтетична кав'ярня",
  });
  expect(t.statusCode, t.body).toBe(201);
  const split = await call(space, "POST", `/v1/transactions/${t.json().id}/split`, {
    mode: "categories",
    parts: [
      { categoryId, amount: "-3.20" },
      { categoryId: other, amount: "-0.80" },
    ],
  });
  expect(split.statusCode, split.body).toBe(200);
  return t.json().id as string;
}

const snapshot = async (householdId: string) =>
  (
    await db.owner.query(
      `SELECT id, name, state, merged_into, version FROM categories.categories WHERE household_id = $1 ORDER BY id`,
      [householdId],
    )
  ).rows;

const parts = async (householdId: string) =>
  (
    await db.owner.query(
      `SELECT transaction_id, position, category_id, amount FROM transactions.transaction_parts
        WHERE household_id = $1 ORDER BY transaction_id, position`,
      [householdId],
    )
  ).rows;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
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
          pendingPostings: [],
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
          categories: directory,
          flags: { isEnabled },
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [createTransactionCategoryUsage(db.databases.for("transactions")), standIn, budgetStandIn],
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
  elsewhere.clear();
  limited.clear();
  released.length = 0;
});

describe("BUD-01@PoC FR 12: an empty custom category is deleted", () => {
  it("BUD-01@PoC AC18: «Кава з собою» without transactions, rules, limit and plan cells — «Видалити» is offered; deleted, it leaves the tree, its name is free again and the action is in the audit log", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Кава з собою");
    expect(coffee.deletable).toBe(true);
    expect((await named(space, "Кава з собою"))!.deletable).toBe(true);

    const res = await call(space, "DELETE", `/v1/categories/${coffee.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect(await named(space, "Кава з собою")).toBeUndefined();
    expect((await call(space, "GET", `/v1/categories/${coffee.id}`)).statusCode).toBe(404);
    // The other modules check categories through the directory: a deleted one is unknown, a new part is refused.
    expect(await directory.category(space.householdId, coffee.id)).toBeNull();
    // The name is free again.
    const again = await addCategory(space, "Кава з собою");
    expect(again.id).not.toBe(coffee.id);

    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: coffee.id });
    expect(log.map((e) => e.action)).toEqual(["create", "delete"]);
    expect(log[1]).toMatchObject({ actorKind: "user", actorId: space.accountId });
    expect(log[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name", before: "Кава з собою", after: null }),
        expect.objectContaining({ field: "state", before: "active", after: null }),
      ]),
    );
    // Deleted once: a second request finds nothing and writes nothing.
    const twice = await call(space, "DELETE", `/v1/categories/${coffee.id}`);
    expect(twice.statusCode).toBe(404);
    expect(
      await audit.entriesFor(space.householdId, { type: "categories.category", id: coffee.id }),
    ).toHaveLength(2);
  });

  it("BUD-01@PoC FR 12: a hidden empty custom category is deleted too; a split part once moved away frees the category", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const hidden = await addCategory(space, "Синтетичні снеки");
    await call(space, "PATCH", `/v1/categories/${hidden.id}`, { hidden: true });
    expect((await named(space, "Синтетичні снеки"))!).toMatchObject({ hidden: true, deletable: true });
    expect((await call(space, "DELETE", `/v1/categories/${hidden.id}`)).statusCode).toBe(200);

    const tea = await addCategory(space, "Синтетичний чай");
    const groceries = (await named(space, "Продукти"))!.id;
    const t = await splitInto(space, account, tea.id, groceries);
    expect((await named(space, "Синтетичний чай"))!.deletable).toBe(false);
    expect((await call(space, "DELETE", `/v1/transactions/${t}/split`)).statusCode).toBe(200);
    expect((await named(space, "Синтетичний чай"))!.deletable).toBe(true);
    expect((await call(space, "DELETE", `/v1/categories/${tea.id}`)).statusCode).toBe(200);
  });
});

describe("BUD-01@PoC FR 12: a category only its limit holds is deleted after confirmation", () => {
  it("BUD-01@PoC FR 12: «Видалити» is offered; unconfirmed the request is refused naming the limit and nothing changes; with `confirmLimit=true` module budget removes the limit, then the category goes, and the audit entry names the limit", async () => {
    const space = await newSpace();
    const subs = await addCategory(space, "Абонементи");
    limited.add(subs.id);
    expect((await named(space, "Абонементи"))!.deletable).toBe(true);
    const unconfirmed = await call(space, "DELETE", `/v1/categories/${subs.id}`);
    expect(unconfirmed.statusCode, unconfirmed.body).toBe(409);
    expect(unconfirmed.json()).toMatchObject({
      code: "CATEGORY_LIMIT_CONFIRM",
      categoryUsage: { transactions: 0, rules: 0, recurringPayments: 0, budget: LIMIT },
    });
    expect(released).toEqual([]);
    expect(await named(space, "Абонементи")).toBeDefined();

    const res = await call(space, "DELETE", `/v1/categories/${subs.id}?confirmLimit=true`);
    expect(res.statusCode, res.body).toBe(200);
    expect(released).toEqual([subs.id]);
    expect(await named(space, "Абонементи")).toBeUndefined();
    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: subs.id });
    expect(log.map((e) => e.action)).toEqual(["create", "delete"]);
    expect(log[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "limit", before: "30.00 EUR", after: null }),
        expect.objectContaining({ field: "planCells", before: "0", after: null }),
      ]),
    );
  });

  it("BUD-01@PoC FR 12: a category without a limit needs no confirmation; `confirmLimit=false` is the same as none", async () => {
    const space = await newSpace();
    const plain = await addCategory(space, "Синтетичні дрібниці");
    const res = await call(space, "DELETE", `/v1/categories/${plain.id}?confirmLimit=false`);
    expect(res.statusCode, res.body).toBe(200);
    expect(released).toEqual([]);
  });
});

describe("BUD-01@PoC FR 12: a category in use is not deleted", () => {
  it("BUD-01@PoC AC19: «Кава» with 40 transactions and a budget limit — no «Видалити»; the reason is the 40 transactions (the limit is not named); the request is refused with the same reason and count; the category, transactions and limit are unchanged", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const groceries = (await named(space, "Продукти"))!.id;
    for (let i = 0; i < 40; i++) await splitInto(space, account, coffee.id, groceries);
    limited.add(coffee.id);
    expect((await named(space, "Кава"))!.deletable).toBe(false);
    expect((await call(space, "GET", `/v1/categories/${coffee.id}`)).json().deletable).toBe(false);
    const reason = {
      transactions: 40,
      rules: 0,
      recurringPayments: 0,
      mergedCategories: 0,
      budget: LIMIT,
    };
    expect((await call(space, "GET", `/v1/categories/${coffee.id}/usage`)).json()).toEqual({
      ...reason,
      deletable: false,
    });
    const before = { categories: await snapshot(space.householdId), parts: await parts(space.householdId) };

    // Confirming the limit changes nothing: the transactions hold the category.
    for (const url of [`/v1/categories/${coffee.id}`, `/v1/categories/${coffee.id}?confirmLimit=true`]) {
      const res = await call(space, "DELETE", url);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({
        code: NOT_EMPTY,
        title: "Transactions, category rules or regular payments hold this category — hide or merge it",
        categoryUsage: reason,
      });
    }
    expect(released).toEqual([]);
    expect(limited.has(coffee.id)).toBe(true);
    expect(await snapshot(space.householdId)).toEqual(before.categories);
    expect(await parts(space.householdId)).toEqual(before.parts);
    expect(before.parts.filter((p: { category_id: string }) => p.category_id === coffee.id)).toHaveLength(40);
    expect(
      (await audit.entriesFor(space.householdId, { type: "categories.category", id: coffee.id })).map(
        (e) => e.action,
      ),
    ).toEqual(["create"]);
    // «Приховати» and «Об'єднати з іншою…» stay available.
    expect((await call(space, "PATCH", `/v1/categories/${coffee.id}`, { hidden: true })).statusCode).toBe(
      200,
    );
    const merge = await call(space, "POST", `/v1/categories/${coffee.id}/merge`, {
      targetId: (await named(space, "Кафе і ресторани"))!.id,
    });
    expect(merge.statusCode, merge.body).toBe(200);
  });

  it.each(["the transactions' split parts", "a recurring payment"])(
    "BUD-01@PoC FR 12: a category used only by %s is not deleted",
    async (by) => {
      const space = await newSpace();
      const coffee = await addCategory(space, "Кава");
      if (by.startsWith("the transactions"))
        await splitInto(space, await createAccount(space), coffee.id, (await named(space, "Продукти"))!.id);
      else elsewhere.add(coffee.id);
      const res = await call(space, "DELETE", `/v1/categories/${coffee.id}`);
      expect([res.statusCode, res.json().code]).toEqual([409, NOT_EMPTY]);
      expect((await named(space, "Кава"))!.deletable).toBe(false);
    },
  );

  it("BUD-01@PoC FR 12: a category another was merged into is not deleted — the merged records went to it (FR 8)", async () => {
    const space = await newSpace();
    const snacks = await addCategory(space, "Синтетичні снеки");
    const sweets = await addCategory(space, "Синтетичні солодощі");
    await call(space, "POST", `/v1/categories/${snacks.id}/merge`, { targetId: sweets.id });
    expect((await named(space, "Синтетичні солодощі"))!.deletable).toBe(false);
    const res = await call(space, "DELETE", `/v1/categories/${sweets.id}`);
    expect([res.statusCode, res.json().code]).toEqual([409, NOT_EMPTY]);
    // A category merged away is out of use: not found.
    expect((await call(space, "DELETE", `/v1/categories/${snacks.id}`)).statusCode).toBe(404);
  });

  it("BUD-01@PoC FR 12: a system category is never deleted, empty or not — only hidden; the request is refused and nothing changes", async () => {
    const space = await newSpace();
    const cats = await all(space);
    expect(cats.filter((c) => c.systemKey !== null).every((c) => !c.deletable)).toBe(true);
    const before = await snapshot(space.householdId);
    for (const key of ["travel", "transfer"]) {
      const c = cats.find((x) => x.systemKey === key)!;
      const res = await call(space, "DELETE", `/v1/categories/${c.id}`);
      expect([res.statusCode, res.json().code], key).toEqual([409, "CATEGORY_SYSTEM_FIXED"]);
    }
    expect(await snapshot(space.householdId)).toEqual(before);
  });
});

describe("BUD-01@PoC «Права доступу»: deleting a category", () => {
  it("BUD-01@PoC AC12: a user outside the space deleting its category gets «not found», like an unknown id; the category stays", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const secret = await addCategory(a, "Синтетична таємниця");
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const foreign = await call(b, "DELETE", `/v1/categories/${secret.id}`);
    const unknown = await call(b, "DELETE", `/v1/categories/${randomUUID()}`);
    expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
    expect(strip(foreign.body)).toEqual(strip(unknown.body));
    expect((await named(a, "Синтетична таємниця"))!.id).toBe(secret.id);
  });

  it.each(["owner", "admin", "editor"])(
    "BUD-01@PoC «Права доступу»: a %s deletes an empty custom category",
    async (role) => {
      const space = await newSpace();
      const c = await addCategory(space, `Кат ${role}`);
      expect((await call(space, "DELETE", `/v1/categories/${c.id}`, undefined, { role })).statusCode).toBe(
        200,
      );
    },
  );

  it.each([
    [{ role: "viewer" }, 403],
    [{ role: "advisor" }, 403],
    [{ role: "editor", scoped: true }, 403],
  ] as const)("BUD-01@PoC «Права доступу»: %o may not delete (%i); nothing written", async (p, status) => {
    const space = await newSpace();
    const c = await addCategory(space, "Синтетична категорія");
    const before = await snapshot(space.householdId);
    expect((await call(space, "DELETE", `/v1/categories/${c.id}`, undefined, p)).statusCode).toBe(status);
    expect(await snapshot(space.householdId)).toEqual(before);
  });

  it("BUD-01@PoC: the flag categories.tree off — delete answers 404 as if absent; nothing written", async () => {
    const space = await newSpace();
    const c = await addCategory(space, "Синтетична категорія");
    off.add("categories.tree");
    expect((await call(space, "DELETE", `/v1/categories/${c.id}`)).statusCode).toBe(404);
    off.clear();
    expect((await named(space, "Синтетична категорія"))!.id).toBe(c.id);
  });
});
