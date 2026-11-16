import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  categorizationRulePorts,
  createCategorizationCategoryUsage,
  createCategorizationErasure,
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
 * BUD-14@PoC b) (wave 2 row 23 — the server part): category rules through the real API on a real PostgreSQL — the
 * rules in priority order and their moves (FR 4, AC14), the conditions (FR 5), «Показати» and the count of «N наявних
 * транзакцій, що підходять» without a change (FR 7, AC2, AC12) on a bounded scan, new transactions through the rules
 * (FR 8, AC9, AC12) with a change by hand winning (FR 9), «Потребує уваги» and a merge of categories (FR 10, AC7),
 * the warning about identical conditions (FR 11, AC8), «за правилом №…» (FR 13), concurrent changes, another space, a
 * viewer and a scoped member, the audit entries with their dead job and daily recovery (ARC-04, #249) and the space's
 * erasure. Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const FLAG = "categorization.rules";
/** The test app matches a rule against the newest 1 000 transactions of a space (20 000 in main.ts). */
const SCAN_MAX = 1000;
const telemetry = testTelemetryForFile();

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

interface RuleBody {
  id: string;
  position: number;
  conditions: unknown[];
  accountIds: string[];
  categoryId: string;
  enabled: boolean;
  needsAttention: string | null;
  appliedCount: number;
  duplicateOf?: string | null;
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

async function addCategory(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  const group = (res.json().groups as { id: string; name: string }[]).find((g) => g.name === "Харчування")!;
  const created = await call(space, "POST", "/v1/categories", { groupId: group.id, name });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().id as string;
}

async function createAccount(space: Space, name = "Синтетичний рахунок"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name,
    balance: { amount: "50000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function purchase(
  space: Space,
  accountId: string,
  counterparty: string,
  amount = "-59.99",
  date = "2026-10-15",
): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    counterparty,
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function categoryOf(space: Space, transactionId: string) {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    categoryId: string | null;
    source: string;
    rule: { id: string; position: number } | null;
  };
}

const merchantIs = (value: string, operator = "contains") => ({ field: "merchant", operator, value });
const amountOver = (amount: string) => ({
  field: "amount",
  operator: "greater",
  value: { amount, currency: "EUR" },
});

async function createRule(space: Space, body: Record<string, unknown>): Promise<RuleBody> {
  const res = await call(space, "POST", "/v1/category-rules", body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as RuleBody;
}

async function listRules(space: Space): Promise<RuleBody[]> {
  const res = await call(space, "GET", "/v1/category-rules");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as RuleBody[];
}

async function matches(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/category-rules/matches", body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    totals: { amount: string; currency: string }[];
    items: { transactionId: string }[];
    truncated: boolean;
  };
}

/** One pass of the worker as main.ts wires it, until the jobs it took have ended; twice — a dispatch, then its job. */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
    try {
      await worker.tick();
      await worker.idle();
    } finally {
      await worker.stop();
    }
  }
}

/** `n` copies of transaction `id` straight in the transactions schema (one a day back), for the bounded scan. */
async function copies(householdId: string, id: string, n: number): Promise<void> {
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                            counterparty, description, status, source, version)
     SELECT household_id, gen_random_uuid(), account_id, subaccount_id, amount, currency, occurred_on - g,
            counterparty, description, status, source, version
       FROM transactions.transactions, generate_series(1, $3::int) AS g
      WHERE household_id = $1 AND id = $2`,
    [householdId, id, n],
  );
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
  vi.restoreAllMocks();
});

describe("BUD-14@PoC FR 4: «Правила категорій» in priority order", () => {
  it("BUD-14@PoC AC14: 12 rules in order; «#» moving №5 to the first place makes it the highest priority", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const made: RuleBody[] = [];
    for (let i = 1; i <= 12; i++)
      made.push(await createRule(space, { conditions: [merchantIs(`Synth ${i}`)], categoryId: groceries }));
    expect(made.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const listed = await listRules(space);
    expect(listed.map((r) => r.id)).toEqual(made.map((r) => r.id));
    expect(listed[0]).toEqual({
      id: made[0]!.id,
      position: 1,
      conditions: [{ field: "merchant", operator: "contains", value: "Synth 1" }],
      accountIds: [],
      categoryId: groceries,
      enabled: true,
      needsAttention: null,
      appliedCount: 0,
    });

    const res = await call(space, "POST", `/v1/category-rules/${made[4]!.id}/move`, { position: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const order = (res.json().items as RuleBody[]).map((r) => r.id);
    expect(order).toEqual([
      made[4]!.id,
      ...made.slice(0, 4).map((r) => r.id),
      ...made.slice(5).map((r) => r.id),
    ]);
    expect((res.json().items as RuleBody[]).map((r) => r.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // «Нижче» from the last place does not exist; a position past the end is refused, nothing moves.
    const past = await call(space, "POST", `/v1/category-rules/${made[0]!.id}/move`, { position: 13 });
    expect(past.statusCode).toBe(400);
    expect((await listRules(space)).map((r) => r.id)).toEqual(order);
  });

  it("BUD-14@PoC FR 4: «Увімкнено» and «Змінити правило» change the rule in place, keeping its priority", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const subscriptions = await category(space, "Підписки");
    const a = await createRule(space, { conditions: [merchantIs("Synth A")], categoryId: groceries });
    const b = await createRule(space, { conditions: [merchantIs("Synth B")], categoryId: groceries });
    const off1 = await call(space, "PATCH", `/v1/category-rules/${a.id}`, { enabled: false });
    expect(off1.statusCode, off1.body).toBe(200);
    expect(off1.json()).toMatchObject({ id: a.id, position: 1, enabled: false, duplicateOf: null });
    const edited = await call(space, "PATCH", `/v1/category-rules/${b.id}`, {
      conditions: [merchantIs("Synth B", "equals"), amountOver("10")],
      categoryId: subscriptions,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      position: 2,
      categoryId: subscriptions,
      conditions: [
        { field: "merchant", operator: "equals", value: "Synth B" },
        { field: "amount", operator: "greater", value: { amount: "10", currency: "EUR" } },
      ],
    });
    expect(
      (await call(space, "PATCH", `/v1/category-rules/${randomUUID()}`, { enabled: true })).statusCode,
    ).toBe(404);
  });
});

describe("BUD-14@PoC FR 5: conditions and actions", () => {
  it("BUD-14@PoC FR 5: invalid conditions, a category or an account outside the space — 400, nothing saved", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const groceries = await category(space, "Продукти");
    const foreignCategory = await category(other, "Продукти");
    const foreignAccount = await createAccount(other);
    const bad: [Record<string, unknown>, string][] = [
      [{ conditions: [], categoryId: groceries }, "conditions"],
      [{ conditions: [merchantIs(" ")], categoryId: groceries }, "conditions.0.value"],
      [{ conditions: [merchantIs("a\nb")], categoryId: groceries }, "conditions.0.value"],
      [
        { conditions: [{ field: "merchant", operator: "greater", value: "x" }], categoryId: groceries },
        "conditions.0.operator",
      ],
      [{ conditions: [amountOver("50.001")], categoryId: groceries }, "conditions.0.value"],
      [{ conditions: [amountOver("0")], categoryId: groceries }, "conditions.0.value"],
      [{ conditions: [merchantIs("Synth")], categoryId: foreignCategory }, "categoryId"],
      [
        { conditions: [merchantIs("Synth")], categoryId: groceries, accountIds: [foreignAccount] },
        "accountIds",
      ],
      [
        {
          conditions: [{ field: "account", operator: "equals", value: foreignAccount }],
          categoryId: groceries,
        },
        "conditions.0.value",
      ],
    ];
    for (const [body, path] of bad) {
      const res = await call(space, "POST", "/v1/category-rules", body);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(400);
      expect(JSON.stringify(res.json().errors), res.body).toContain(path.split(".")[0]!);
    }
    expect(await listRules(space)).toEqual([]);
  });

  it("BUD-14@PoC FR 12: a rule has no «приховати» action — an action other than the category is refused", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    for (const extra of [{ hide: true }, { action: "hide" }, { hidden: true }]) {
      const res = await call(space, "POST", "/v1/category-rules", {
        conditions: [merchantIs("Synth")],
        categoryId: groceries,
        ...extra,
      });
      expect(res.statusCode, res.body).toBe(400);
    }
    expect(await listRules(space)).toEqual([]);
  });
});

describe("BUD-14@PoC FR 7: «Показати» — the existing transactions a rule matches, nothing changed", () => {
  it("BUD-14@PoC FR 7, FR 6: «Показати» for «Мерчант містить Adobe» and «Сума більше за 50 €» — 14 transactions on 839,86 €, a list without «було → стане»; nothing changes", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const adobe: string[] = [];
    for (let m = 0; m < 14; m++)
      adobe.push(
        await purchase(
          space,
          account,
          "ADOBE *CREATIVE CLOUD",
          "-59.99",
          `2026-${String((m % 10) + 1).padStart(2, "0")}-0${(m % 7) + 1}`,
        ),
      );
    await purchase(space, account, "ADOBE *STOCK", "-9.99");
    await purchase(space, account, "SYNTH BAKERY 1001", "-70.00");
    const before = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.transaction_categories WHERE household_id = $1`,
      [space.householdId],
    );
    const found = await matches(space, {
      conditions: [merchantIs("Adobe"), amountOver("50")],
      accountIds: [],
    });
    expect(found.count).toBe(14);
    expect(found.totals).toEqual([{ amount: "-839.86", currency: "EUR" }]);
    expect(found.items.map((i) => i.transactionId).sort()).toEqual([...adobe].sort());
    expect(found.truncated).toBe(false);
    // FR 6: no preview panel «було → стане» — the list names the transactions, not their categories before and after.
    expect(Object.keys(found.items[0]!).sort()).toEqual([
      "accountId",
      "amount",
      "counterparty",
      "date",
      "transactionId",
    ]);
    const after = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.transaction_categories WHERE household_id = $1`,
      [space.householdId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    for (const t of adobe) expect((await categoryOf(space, t)).source).toBe("none");
  });

  it("BUD-14@PoC FR 7: the matches look at the newest transactions only, up to a bound — 1 200 rows, 1 000 matched, «truncated»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SYNTH STREAMING 4411", "-12.00");
    await copies(space.householdId, t, 1199);
    const many = await matches(space, { conditions: [merchantIs("Synth Streaming")] });
    expect(many).toMatchObject({
      count: SCAN_MAX,
      truncated: true,
      totals: [{ amount: "-12000.00", currency: "EUR" }],
    });
    expect(many.items).toHaveLength(100);
    // Within the bound every row counts.
    const small = await newSpace();
    const smallAccount = await createAccount(small);
    await copies(
      small.householdId,
      await purchase(small, smallAccount, "SYNTH STREAMING 4411", "-12.00"),
      899,
    );
    expect(await matches(small, { conditions: [merchantIs("Synth Streaming")] })).toMatchObject({
      count: 900,
      truncated: false,
    });
  });
});

describe("BUD-14@PoC FR 8: new transactions go through the rules", () => {
  it("BUD-14@PoC AC9: a rule saved without «Застосувати до N наявних…» leaves the 14 past transactions as they were; a new «Adobe» gets «Підписки» «за правилом №1»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const other = await addCategory(space, "Інші витрати синт.");
    const subscriptions = await category(space, "Підписки");
    const past: string[] = [];
    for (let i = 0; i < 14; i++) {
      const t = await purchase(space, account, "ADOBE *CREATIVE CLOUD", "-59.99", `2026-0${(i % 9) + 1}-10`);
      expect(
        (await call(space, "PUT", `/v1/transactions/${t}/category`, { categoryId: other })).statusCode,
      ).toBe(200);
      past.push(t);
    }
    const uncategorized = await purchase(space, account, "ADOBE *CREATIVE CLOUD", "-59.99", "2026-09-30");
    await runWorker(space.householdId);
    const rule = await createRule(space, { conditions: [merchantIs("Adobe")], categoryId: subscriptions });
    await runWorker(space.householdId);
    for (const t of past)
      expect(await categoryOf(space, t)).toMatchObject({ categoryId: other, source: "manual", rule: null });
    expect(await categoryOf(space, uncategorized)).toMatchObject({ categoryId: null, source: "none" });

    const fresh = await purchase(space, account, "ADOBE *CREATIVE CLOUD", "-59.99", "2026-10-16");
    await runWorker(space.householdId);
    expect(await categoryOf(space, fresh)).toEqual({
      transactionId: fresh,
      categoryId: subscriptions,
      source: "rule",
      rule: { id: rule.id, position: 1 },
    });
    expect((await listRules(space))[0]!.appliedCount).toBe(1);
    // The system's entry of the rule's category (П-10).
    const entries = await audit.entriesFor(space.householdId, {
      type: "categorization.transaction-category",
      id: fresh,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorKind: "system",
      actorId: null,
      channel: "system",
      action: "update",
    });
    expect(entries[0]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "categoryId", before: null, after: subscriptions }),
        expect.objectContaining({ field: "source", before: "none", after: "rule" }),
        expect.objectContaining({ field: "ruleId", after: rule.id }),
      ]),
    );
    // A second run of the same event changes nothing more.
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'pending', run_at = now() WHERE household_id = $1 AND name = 'categorization.transaction-created'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(
      await audit.entriesFor(space.householdId, { type: "categorization.transaction-category", id: fresh }),
    ).toHaveLength(1);
  });

  it("BUD-14@PoC FR 8, FR 13: the first matching rule sets the category and is shown as «за правилом №…»; moving rules changes only what new transactions get, never the past ones", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "Синтетичний поточний");
    const amex = await createAccount(space, "Синтетична Amex");
    const groceries = await category(space, "Продукти");
    const home = await addCategory(space, "Дім синт.");
    const r1 = await createRule(space, { conditions: [merchantIs("Costco")], categoryId: groceries });
    const r2 = await createRule(space, {
      conditions: [{ field: "account", operator: "equals", value: amex }, amountOver("200")],
      categoryId: home,
    });
    const costco = await purchase(space, amex, "COSTCO WHOLESALE 0412", "-312.00");
    const other = await purchase(space, amex, "SYNTH FURNITURE 77", "-450.00");
    const small = await purchase(space, current, "COSTCO WHOLESALE 0412", "-12.00");
    await runWorker(space.householdId);
    expect(await categoryOf(space, costco)).toMatchObject({
      categoryId: groceries,
      rule: { id: r1.id, position: 1 },
    });
    expect(await categoryOf(space, other)).toMatchObject({
      categoryId: home,
      rule: { id: r2.id, position: 2 },
    });
    expect(await categoryOf(space, small)).toMatchObject({ categoryId: groceries });

    expect((await call(space, "POST", `/v1/category-rules/${r2.id}/move`, { position: 1 })).statusCode).toBe(
      200,
    );
    await runWorker(space.householdId);
    // FR 7: the order changed nothing in the past; «за правилом №…» follows the order now.
    expect(await categoryOf(space, costco)).toMatchObject({
      categoryId: groceries,
      rule: { id: r1.id, position: 2 },
    });
    const next = await purchase(space, amex, "COSTCO WHOLESALE 0412", "-312.00");
    await runWorker(space.householdId);
    expect(await categoryOf(space, next)).toMatchObject({
      categoryId: home,
      rule: { id: r2.id, position: 1 },
    });
  });

  it("BUD-14@PoC AC12: a disabled rule №2 is not applied to a new transaction; once enabled, «Показати» lists the past transactions it matches", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const subscriptions = await category(space, "Підписки");
    await createRule(space, { conditions: [merchantIs("Synth Market")], categoryId: groceries });
    const r2 = await createRule(space, {
      conditions: [merchantIs("Netflix")],
      categoryId: subscriptions,
      enabled: false,
    });
    const t = await purchase(space, account, "NETFLIX.COM 866-579", "-13.99");
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({ categoryId: null, source: "none", rule: null });
    const on = await call(space, "PATCH", `/v1/category-rules/${r2.id}`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    // Enabling changes no past transaction (FR 7); «Показати» lists the one it would.
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({ source: "none" });
    const found = await matches(space, { conditions: [merchantIs("Netflix")] });
    expect(found.items.map((i) => i.transactionId)).toEqual([t]);
  });

  it("BUD-14@PoC FR 9: a category set by hand before the rules ran is not replaced by a rule", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const subscriptions = await category(space, "Підписки");
    await createRule(space, { conditions: [merchantIs("Adobe")], categoryId: subscriptions });
    const t = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    expect(
      (await call(space, "PUT", `/v1/transactions/${t}/category`, { categoryId: groceries })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({ categoryId: groceries, source: "manual", rule: null });
  });

  it("BUD-14@PoC FR 8: a rule is never applied to a transaction of another space", async () => {
    const space = await newSpace();
    const other = await newSpace();
    await createRule(space, {
      conditions: [merchantIs("Adobe")],
      categoryId: await category(space, "Підписки"),
    });
    const t = await purchase(other, await createAccount(other), "ADOBE *CREATIVE CLOUD");
    await runWorker(other.householdId);
    expect(await categoryOf(other, t)).toMatchObject({ categoryId: null, source: "none" });
  });
});

describe("BUD-14@PoC FR 10: «Потребує уваги» and a merge of categories", () => {
  it("BUD-14@PoC AC7, EC2: the category «Кава» deleted — the rule is marked «Потребує уваги» and not applied until edited", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава синт.");
    const groceries = await category(space, "Продукти");
    const rule = await createRule(space, { conditions: [merchantIs("Synth Coffee")], categoryId: coffee });
    const fallback = await createRule(space, { conditions: [merchantIs("Synth")], categoryId: groceries });
    expect((await call(space, "DELETE", `/v1/categories/${coffee}`)).statusCode).toBe(200);
    const listed = await listRules(space);
    expect(listed.map((r) => [r.id, r.needsAttention])).toEqual([
      [rule.id, "category_deleted"],
      [fallback.id, null],
    ]);
    // Skipped: the next rule that matches decides; the rule is never removed silently.
    const t = await purchase(space, account, "SYNTH COFFEE 12");
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({ categoryId: groceries, rule: { id: fallback.id } });
    // Edited with a category in use — applied again.
    const subscriptions = await category(space, "Підписки");
    const edited = await call(space, "PATCH", `/v1/category-rules/${rule.id}`, { categoryId: subscriptions });
    expect(edited.json()).toMatchObject({ needsAttention: null });
    const next = await purchase(space, account, "SYNTH COFFEE 12");
    await runWorker(space.householdId);
    expect(await categoryOf(space, next)).toMatchObject({ categoryId: subscriptions, rule: { id: rule.id } });
  });

  it("BUD-14@PoC FR 10: a merge of categories rewrites the rules that used the merged one", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Кава синт.");
    const cafes = await category(space, "Кафе і ресторани");
    const rule = await createRule(space, { conditions: [merchantIs("Synth Coffee")], categoryId: coffee });
    const merged = await call(space, "POST", `/v1/categories/${coffee}/merge`, { targetId: cafes });
    expect(merged.statusCode, merged.body).toBe(200);
    await runWorker(space.householdId);
    expect(await listRules(space)).toEqual([
      expect.objectContaining({ id: rule.id, categoryId: cafes, needsAttention: null }),
    ]);
  });
});

describe("BUD-14@PoC FR 11: identical conditions", () => {
  it("BUD-14@PoC AC8, EC4: «Мерчант містить Netflix» exists — a new rule with the same condition is saved with a warning that links to it", async () => {
    const space = await newSpace();
    const subscriptions = await category(space, "Підписки");
    const first = await createRule(space, { conditions: [merchantIs("Netflix")], categoryId: subscriptions });
    expect(first.duplicateOf).toBeNull();
    const second = await createRule(space, {
      conditions: [merchantIs("  NETFLIX ")],
      categoryId: await category(space, "Продукти"),
    });
    expect(second.duplicateOf).toBe(first.id);
    // An edit that makes another rule identical warns too; a different operator does not.
    const third = await createRule(space, {
      conditions: [merchantIs("Netflix", "equals")],
      categoryId: subscriptions,
    });
    expect(third.duplicateOf).toBeNull();
    const edited = await call(space, "PATCH", `/v1/category-rules/${third.id}`, {
      conditions: [merchantIs("netflix")],
    });
    expect(edited.json().duplicateOf).toBe(first.id);
  });
});

describe("BUD-14@PoC «Права доступу»: one space, its Owner", () => {
  it("BUD-14@PoC «Права доступу»: a rule of another space is not found; a viewer reads but cannot change; a scoped member sees nothing", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth")],
      categoryId: await category(space, "Продукти"),
    });
    expect(await listRules(other)).toEqual([]);
    expect((await call(other, "PATCH", `/v1/category-rules/${rule.id}`, { enabled: false })).statusCode).toBe(
      404,
    );
    expect(
      (await call(other, "POST", `/v1/category-rules/${rule.id}/move`, { position: 1 })).statusCode,
    ).toBe(404);

    const viewer = { role: "viewer" };
    expect((await call(space, "GET", "/v1/category-rules", undefined, viewer)).statusCode).toBe(200);
    expect(
      (await call(space, "PATCH", `/v1/category-rules/${rule.id}`, { enabled: false }, viewer)).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          space,
          "POST",
          "/v1/category-rules",
          { conditions: [merchantIs("X")], categoryId: rule.categoryId },
          viewer,
        )
      ).statusCode,
    ).toBe(403);

    const scoped = { role: "member", scoped: true };
    expect((await call(space, "GET", "/v1/category-rules", undefined, scoped)).statusCode).toBe(404);
    expect(
      (await call(space, "POST", "/v1/category-rules/matches", { conditions: [merchantIs("Synth")] }, scoped))
        .statusCode,
    ).toBe(404);
    expect((await listRules(space)).map((r) => r.enabled)).toEqual([true]);
  });

  it("BUD-14@PoC «Ліміти плану»: the release flag off — the rules are not there", async () => {
    const space = await newSpace();
    off.add(FLAG);
    expect((await call(space, "GET", "/v1/category-rules")).statusCode).toBe(404);
  });
});

describe("Concurrency: two simultaneous changes of the rules of one space", () => {
  it("BUD-14@PoC FR 4: two «Нове правило» at once take two positions; two moves at once leave positions 1…n without gaps", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    for (let round = 0; round < 5; round++) {
      const [a, b] = await Promise.all([
        call(space, "POST", "/v1/category-rules", {
          conditions: [merchantIs(`Synth A${round}`)],
          categoryId: groceries,
        }),
        call(space, "POST", "/v1/category-rules", {
          conditions: [merchantIs(`Synth B${round}`)],
          categoryId: groceries,
        }),
      ]);
      expect([a!.statusCode, b!.statusCode]).toEqual([201, 201]);
    }
    let rules = await listRules(space);
    expect(rules.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all([
        call(space, "POST", `/v1/category-rules/${rules[9]!.id}/move`, { position: 1 }),
        call(space, "POST", `/v1/category-rules/${rules[0]!.id}/move`, { position: 10 }),
        call(space, "PATCH", `/v1/category-rules/${rules[4]!.id}`, { enabled: round % 2 === 0 }),
        call(space, "PATCH", `/v1/category-rules/${rules[4]!.id}`, { categoryId: groceries, enabled: true }),
      ]);
      for (const r of results) expect(r.statusCode, r.body).toBe(200);
      rules = await listRules(space);
      expect(rules.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(new Set(rules.map((r) => r.id)).size).toBe(10);
    }
    // Every committed change of the rule has its own version and audit entry.
    const { rows } = await db.owner.query(
      `SELECT id, version FROM categorization.rules WHERE household_id = $1`,
      [space.householdId],
    );
    for (const row of rows) {
      const entries = await audit.entriesFor(space.householdId, { type: "categorization.rule", id: row.id });
      expect(entries.length).toBeLessThanOrEqual(row.version);
      expect(entries[0]!.action).toBe("create");
    }
  });
});

describe("ARC-04@PoC FR 2–4: the audit entries of the rules, their dead job and the daily recovery (#249)", () => {
  it("BUD-14@PoC «Права доступу»: a change of a rule is in the audit log with the conditions masked; no condition text in the queue", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Private Name")],
      categoryId: groceries,
    });
    await call(space, "PATCH", `/v1/category-rules/${rule.id}`, {
      conditions: [merchantIs("Synth Other Name")],
      enabled: false,
    });
    const entries = await audit.entriesFor(space.householdId, { type: "categorization.rule", id: rule.id });
    expect(entries.map((e) => e.action)).toEqual(["create", "update"]);
    expect(entries[0]).toMatchObject({ actorKind: "user", actorId: space.accountId });
    expect(entries[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "conditions", before: AUDIT_MASK, after: AUDIT_MASK }),
        expect.objectContaining({ field: "enabled", before: "true", after: "false" }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toMatch(/Synth/);
    const { rows: jobs } = await db.owner.query(
      `SELECT payload::text AS p FROM categorization.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) expect(j.p).not.toMatch(/Synth/);
  });

  it("ARC-04@PoC FR 4: the audit entry and the rules of a new transaction fail — dead jobs go back with the daily recovery and each runs once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const subscriptions = await category(space, "Підписки");
    vi.spyOn(audit, "record").mockRejectedValue(new Error("injected"));
    const res = await call(space, "POST", "/v1/category-rules", {
      conditions: [merchantIs("Adobe")],
      categoryId: subscriptions,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "categorization.hand_off_deferred")
        .map((r) => r.severityText),
    ).toContain("WARN");
    vi.restoreAllMocks();
    const ruleId = res.json().id as string;
    const t = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    // The dispatch hands the event to the queue; both jobs die before they run.
    const worker = createWorker({
      ...workerQueues(db.databases),
      households: async () => [space.householdId],
    });
    await worker.tick();
    await worker.idle();
    await worker.stop();
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(
      await audit.entriesFor(space.householdId, { type: "categorization.rule", id: ruleId }),
    ).toHaveLength(0);
    expect((await categoryOf(space, t)).source).toBe("none");

    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "categorization.jobs_requeued")
        .map((r) => r.severityText),
    ).toContain("WARN");
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(
      await audit.entriesFor(space.householdId, { type: "categorization.rule", id: ruleId }),
    ).toHaveLength(1);
    expect(await categoryOf(space, t)).toMatchObject({ categoryId: subscriptions, source: "rule" });
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the rules", async () => {
    const space = await newSpace();
    await createRule(space, {
      conditions: [merchantIs("Synth")],
      categoryId: await category(space, "Продукти"),
    });
    await createCategorizationErasure(db.databases.for("categorization")).eraseHousehold(space.householdId);
    const left = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.rules WHERE household_id = $1`,
      [space.householdId],
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });
});
