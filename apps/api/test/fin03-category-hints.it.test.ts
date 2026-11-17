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
import {
  categorizationRulePorts,
  createCategorizationCategoryUsage,
  createCategorizationServices,
} from "../src/modules/categorization/index.ts";
import { createMerchantDirectory } from "../src/modules/merchants/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionRuleInputs,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * FIN-03@PoC FR 30, FR 31 (issue #438 — the server part of S-048 step 2): the category hints of «Нова
 * транзакція» through the real API on a real PostgreSQL — the category for a known counterparty «за правилом» or «як
 * раніше», «Часто для <мерчанта>» and «Нещодавні», each known merchant's category, the type of the transaction, hidden
 * categories, the bounded scan, another space (П-5: none of its merchants, categories or rules), a viewer and a scoped
 * member, the release flag, and that nothing is written. Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const FLAG = "categorization.suggestions";
/** The test app reads the newest 1 000 transactions of a space (20 000 in main.ts). */
const SCAN_MAX = 1000;

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Suggestion {
  categoryId: string;
  source: "rule" | "merchant";
  rule: { id: string; position: number } | null;
}

interface Hints {
  merchant: string | null;
  suggestion: Suggestion | null;
  top: { kind: "frequent" | "recent"; merchant: string | null; categoryIds: string[] };
  merchants: { name: string; suggestion: Suggestion }[];
  truncated: boolean;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "PATCH",
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

async function category(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

async function createAccount(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "50000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** A transaction, and its category set by hand when one is given. */
async function tx(
  space: Space,
  accountId: string,
  counterparty: string | null,
  date: string,
  categoryId?: string,
  amount = "-12.30",
): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    ...(counterparty !== null ? { counterparty } : {}),
  });
  expect(t.statusCode, t.body).toBe(201);
  const id = t.json().id as string;
  if (categoryId !== undefined) {
    const put = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId });
    expect(put.statusCode, put.body).toBe(200);
  }
  return id;
}

async function rule(space: Space, conditions: unknown[], categoryId: string): Promise<string> {
  const res = await call(space, "POST", "/v1/category-rules", { conditions, categoryId });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

function query(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `/v1/category-suggestions${q ? `?${q}` : ""}`;
}

async function hints(
  space: Space,
  params: Record<string, string> = {},
  principal: Principal = {},
): Promise<Hints> {
  const res = await call(space, "GET", query(params), undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Hints;
}

const merchantIs = (value: string) => ({ field: "merchant", operator: "contains", value });

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
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
        categorization: createCategorizationServices({
          transactions: lookup,
          categories: directory,
          audit,
          rules: categorizationRulePorts({
            accounts: createAccountDirectory(db.databases.for("accounts")),
            merchants: createMerchantDirectory(db.databases.for("merchants")),
            inputs: createTransactionRuleInputs(db.databases.for("transactions")),
          }),
          scanMax: SCAN_MAX,
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

describe("FIN-03@PoC FR 30: a known counterparty fills in the category: a rule, then «як раніше»", () => {
  it("FIN-03@PoC FR 30: a rule of the merchant wins over the last category set by hand; «підставлено з правила» names the rule", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    await tx(space, account, "Синт Маркет", "2026-10-10", cafe);
    await rule(space, [merchantIs("Інший Синт")], cafe);
    const ruleId = await rule(space, [merchantIs("Синт Маркет")], groceries);

    const got = await hints(space, {
      counterparty: "Синт Маркет",
      accountId: account,
      amount: "45.50",
      currency: "EUR",
      type: "expense",
    });
    expect(got.merchant).toBe("Синт Маркет");
    expect(got.suggestion).toEqual({
      categoryId: groceries,
      source: "rule",
      rule: { id: ruleId, position: 2 },
    });
    // The list «Контрагент»: «… · Продукти» next to the merchant.
    expect(got.merchants).toEqual([
      {
        name: "Синт Маркет",
        suggestion: { categoryId: groceries, source: "rule", rule: { id: ruleId, position: 2 } },
      },
    ]);
    expect(got.truncated).toBe(false);
  });

  it("FIN-03@PoC FR 30: without a rule — «як раніше», the newest category set by hand for this merchant", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    await tx(space, account, "Синт Маркет", "2026-10-01", groceries);
    await tx(space, account, "Синт Маркет", "2026-10-12", cafe);
    await tx(space, account, "Синт Маркет", "2026-10-14");
    await tx(space, account, "Інший Синт", "2026-10-15", groceries);

    const got = await hints(space, { counterparty: "Синт Маркет", type: "expense" });
    expect(got.suggestion).toEqual({ categoryId: cafe, source: "merchant", rule: null });
    expect(got.merchants).toEqual([
      { name: "Інший Синт", suggestion: { categoryId: groceries, source: "merchant", rule: null } },
      { name: "Синт Маркет", suggestion: { categoryId: cafe, source: "merchant", rule: null } },
    ]);
  });

  it("FIN-03@PoC FR 30: a rule on «Сума» or «Рахунок» applies only with the amount and account of step 1", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    await tx(space, account, "Синт Маркет", "2026-10-10", cafe);
    const big = await rule(
      space,
      [
        merchantIs("Синт Маркет"),
        { field: "amount", operator: "greater", value: { amount: "100.00", currency: "EUR" } },
      ],
      groceries,
    );

    const none = await hints(space, { counterparty: "Синт Маркет" });
    expect(none.suggestion).toEqual({ categoryId: cafe, source: "merchant", rule: null });
    const small = await hints(space, {
      counterparty: "Синт Маркет",
      accountId: account,
      amount: "20.00",
      currency: "EUR",
    });
    expect(small.suggestion?.source).toBe("merchant");
    const large = await hints(space, {
      counterparty: "Синт Маркет",
      accountId: account,
      amount: "150.00",
      currency: "EUR",
    });
    expect(large.suggestion).toEqual({
      categoryId: groceries,
      source: "rule",
      rule: { id: big, position: 1 },
    });
  });

  it("FIN-03@PoC FR 30: a new counterparty or none — nothing is filled in", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await tx(space, account, "Синт Маркет", "2026-10-10", await category(space, "Продукти"));
    const fresh = await hints(space, { counterparty: "Зовсім Новий Синт" });
    expect(fresh.merchant).toBe("Зовсім Новий Синт");
    expect(fresh.suggestion).toBeNull();
    const empty = await hints(space);
    expect(empty.merchant).toBeNull();
    expect(empty.suggestion).toBeNull();
  });
});

describe("FIN-03@PoC FR 31: «Часто для <мерчанта>», otherwise «Нещодавні»", () => {
  it("FIN-03@PoC FR 31: a known counterparty — «Часто для» its merchant, the most used first; an unknown one — «Нещодавні»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    const chemicals = await category(space, "Побутова хімія");
    const fuel = await category(space, "Пальне");
    await tx(space, account, "Синт Маркет", "2026-10-01", groceries);
    await tx(space, account, "Синт Маркет", "2026-10-02", groceries);
    await tx(space, account, "Синт Маркет", "2026-10-03", chemicals);
    await tx(space, account, "Синт Заправка", "2026-10-11", fuel);
    await tx(space, account, null, "2026-10-12", cafe);

    const known = await hints(space, { counterparty: "Синт Маркет", type: "expense" });
    expect(known.top).toEqual({
      kind: "frequent",
      merchant: "Синт Маркет",
      categoryIds: [groceries, chemicals],
    });

    const unknown = await hints(space, { counterparty: "Зовсім Новий Синт", type: "expense" });
    expect(unknown.top).toEqual({ kind: "recent", merchant: null, categoryIds: [cafe, fuel, chemicals] });
    expect((await hints(space)).top.kind).toBe("recent");
  });

  it("FIN-03@PoC FR 31: only categories of the type, not hidden; a hidden «як раніше» gives way to the older one", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const cafe = await category(space, "Кафе і ресторани");
    const salary = await category(space, "Зарплата");
    await tx(space, account, "Синт Маркет", "2026-10-01", groceries);
    await tx(space, account, "Синт Маркет", "2026-10-05", cafe);
    await tx(space, account, "Синт Роботодавець", "2026-10-06", salary, "1500.00");
    const hide = await call(space, "PATCH", `/v1/categories/${cafe}`, { hidden: true });
    expect(hide.statusCode, hide.body).toBe(200);

    const expense = await hints(space, { counterparty: "Синт Маркет", type: "expense" });
    expect(expense.suggestion).toEqual({ categoryId: groceries, source: "merchant", rule: null });
    expect(expense.top.categoryIds).toEqual([groceries]);
    const income = await hints(space, { type: "income" });
    expect(income.top).toEqual({ kind: "recent", merchant: null, categoryIds: [salary] });
    expect(income.merchants).toEqual([
      { name: "Синт Роботодавець", suggestion: { categoryId: salary, source: "merchant", rule: null } },
    ]);
  });

  it("FIN-03@PoC FR 31: the newest transactions of the space are read (a bounded scan, `truncated`)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const id = await tx(space, account, "Синт Старий", "2026-01-01", groceries);
    // SCAN_MAX newer transactions without a category push the old one out of the scan.
    await db.owner.query(
      `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                              counterparty, description, status, source, version)
       SELECT household_id, gen_random_uuid(), account_id, subaccount_id, amount, currency, DATE '2026-10-01' + (g % 10),
              'Синт Новий', description, status, source, version
         FROM transactions.transactions, generate_series(1, $3::int) AS g
        WHERE household_id = $1 AND id = $2`,
      [space.householdId, id, SCAN_MAX],
    );
    const got = await hints(space, { counterparty: "Синт Старий" });
    expect(got.truncated).toBe(true);
    expect(got.suggestion).toBeNull();
    expect(got.top).toEqual({ kind: "recent", merchant: null, categoryIds: [] });
  });
});

describe("FIN-03@PoC FR 30, FR 31: one space (П-5), its roles, the flag", () => {
  it("FIN-03@PoC FR 30: another space's merchants, categories and rules never appear", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const otherGroceries = await category(other, "Продукти");
    const otherCafe = await category(other, "Кафе і ресторани");
    await tx(other, otherAccount, "Синт Маркет", "2026-10-10", otherCafe);
    await tx(other, otherAccount, "Чужий Синт", "2026-10-11", otherGroceries);
    await rule(other, [merchantIs("Синт Маркет")], otherGroceries);
    await tx(space, account, "Синт Маркет", "2026-10-01");

    const got = await hints(space, {
      counterparty: "Синт Маркет",
      accountId: otherAccount,
      amount: "1.00",
      currency: "EUR",
    });
    expect(got).toEqual({
      merchant: "Синт Маркет",
      suggestion: null,
      top: { kind: "recent", merchant: null, categoryIds: [] },
      merchants: [],
      truncated: false,
    });
    const text = JSON.stringify(await hints(space, { counterparty: "Чужий Синт" }));
    expect(text).not.toContain(otherGroceries);
    expect(text).not.toContain(otherCafe);
    // The other space still has its own.
    expect((await hints(other, { counterparty: "Синт Маркет" })).suggestion?.categoryId).toBe(otherGroceries);
  });

  it("FIN-03@PoC FR 30: a viewer reads the hints; a scoped member gets «not found»; the flag off — not there", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await tx(space, account, "Синт Маркет", "2026-10-01", await category(space, "Продукти"));
    expect((await hints(space, { counterparty: "Синт Маркет" }, { role: "viewer" })).suggestion?.source).toBe(
      "merchant",
    );
    const scoped = await call(space, "GET", query({ counterparty: "Синт Маркет" }), undefined, {
      role: "editor",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(scoped.body).not.toContain("Синт");
    off.add(FLAG);
    expect((await call(space, "GET", query({}))).statusCode).toBe(404);
  });

  it("FIN-03@PoC FR 30: read only — no merchant is born, no category or audit entry written; bad input is refused", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await tx(space, account, "Синт Маркет", "2026-10-01", await category(space, "Продукти"));
    const count = async () => {
      const { rows } = await db.owner.query(
        `SELECT (SELECT count(*) FROM merchants.merchants WHERE household_id = $1)
              + (SELECT count(*) FROM categorization.transaction_categories WHERE household_id = $1)
              + (SELECT count(*) FROM audit.entries WHERE household_id = $1) AS n`,
        [space.householdId],
      );
      return Number(rows[0].n);
    };
    const before = await count();
    await hints(space, {
      counterparty: "Зовсім Новий Синт",
      accountId: account,
      amount: "3.00",
      currency: "EUR",
    });
    expect(await count()).toBe(before);

    for (const params of [
      { amount: "3.00" },
      { currency: "EUR" },
      { amount: "3.001", currency: "EUR" },
      { amount: "-3.00", currency: "EUR" },
      { accountId: "not-a-uuid" },
      { type: "transfer" },
      { counterparty: "a\nb" },
      { counterparty: "x".repeat(201) },
    ]) {
      const res = await call(space, "GET", query(params));
      expect(res.statusCode, JSON.stringify(params)).toBe(400);
    }
  });
});
