import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
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
    rule?: { id: string; position: number };
  };
}

const merchantIs = (value: string, operator = "contains") => ({ field: "merchant", operator, value });

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

/** The merchants of the space's descriptions are born where the space reads them (the job, the list); «Показати» only reads. */
async function knowMerchants(space: Space): Promise<void> {
  const { rows } = await db.owner.query<{ counterparty: string }>(
    `SELECT DISTINCT counterparty FROM transactions.transactions WHERE household_id = $1 AND counterparty IS NOT NULL`,
    [space.householdId],
  );
  await createMerchantDirectory(db.databases.for("merchants")).shownMerchants(
    space.householdId,
    rows.map((r) => r.counterparty),
  );
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

/** Passes of the worker as main.ts wires it until the space's events are dispatched and its jobs have ended. */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 20; pass++) {
    const { rows } = await db.owner.query(
      `SELECT (SELECT count(*) FROM categorization.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL)
            + (SELECT count(*) FROM categories.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL) AS n`,
      [householdId],
    );
    if (Number(rows[0].n) === 0) return;
    const worker = createWorker({
      ...workerQueues(db.databases, { isEnabled }),
      households: async () => [householdId],
    });
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

describe("BUD-14@PoC security review (PR #340): guards without a test in the PR", () => {
  it("BUD-14@PoC «Права доступу»: a viewer cannot move a rule (403); a scoped member cannot create, change or move one; the order is unchanged", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const first = await createRule(space, { conditions: [merchantIs("Synth A")], categoryId: groceries });
    const second = await createRule(space, { conditions: [merchantIs("Synth B")], categoryId: groceries });
    const viewer = { role: "viewer" };
    expect(
      (await call(space, "POST", `/v1/category-rules/${second.id}/move`, { position: 1 }, viewer)).statusCode,
    ).toBe(403);
    const scoped = { role: "editor", scoped: true };
    for (const [method, url, body] of [
      ["POST", "/v1/category-rules", { conditions: [merchantIs("Synth C")], categoryId: groceries }],
      ["PATCH", `/v1/category-rules/${first.id}`, { enabled: false }],
      ["POST", `/v1/category-rules/${second.id}/move`, { position: 1 }],
    ] as const) {
      const res = await call(space, method, url, body, scoped);
      expect([403, 404], `${method} ${url}`).toContain(res.statusCode);
    }
    const rules = await listRules(space);
    expect(rules.map((r) => [r.id, r.enabled])).toEqual([
      [first.id, true],
      [second.id, true],
    ]);
  });

  it("BUD-14@PoC «Ліміти плану»: the release flag off — every rule route answers 404", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const rule = await createRule(space, { conditions: [merchantIs("Synth")], categoryId: groceries });
    off.add(FLAG);
    for (const [method, url, body] of [
      ["GET", "/v1/category-rules", undefined],
      ["POST", "/v1/category-rules", { conditions: [merchantIs("Synth C")], categoryId: groceries }],
      ["PATCH", `/v1/category-rules/${rule.id}`, { enabled: false }],
      ["POST", `/v1/category-rules/${rule.id}/move`, { position: 1 }],
      ["POST", "/v1/category-rules/matches", { conditions: [merchantIs("Synth")] }],
    ] as const)
      expect((await call(space, method, url, body)).statusCode, `${method} ${url}`).toBe(404);
  });

  it("BUD-14@PoC FR 5: a category or an account of another space is refused on create and on change, in every place it can stand", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const groceries = await category(space, "Продукти");
    const foreignCategory = await addCategory(other, "Синтетична чужа");
    const foreignAccount = await createAccount(other);
    const rule = await createRule(space, { conditions: [merchantIs("Synth")], categoryId: groceries });
    const account = { field: "account", operator: "equals", value: foreignAccount };
    for (const body of [
      { conditions: [merchantIs("Synth")], categoryId: foreignCategory },
      { conditions: [merchantIs("Synth")], categoryId: groceries, accountIds: [foreignAccount] },
      { conditions: [account], categoryId: groceries },
    ])
      expect((await call(space, "POST", "/v1/category-rules", body)).statusCode, JSON.stringify(body)).toBe(
        400,
      );
    for (const body of [
      { categoryId: foreignCategory },
      { accountIds: [foreignAccount] },
      { conditions: [account] },
    ])
      expect(
        (await call(space, "PATCH", `/v1/category-rules/${rule.id}`, body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    expect(await listRules(space)).toHaveLength(1);
    expect((await listRules(space))[0]).toMatchObject({ categoryId: groceries, accountIds: [] });
  });

  it("BUD-14@PoC FR 7: «Показати» never lists or counts a transaction of another space, even by its account id", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const mine = await purchase(space, await createAccount(space), "ADOBE *CREATIVE CLOUD");
    const foreignAccount = await createAccount(other);
    await purchase(other, foreignAccount, "ADOBE *CREATIVE CLOUD");
    await knowMerchants(space);
    const found = await matches(space, { conditions: [merchantIs("Adobe")] });
    expect(found.items.map((i) => i.transactionId)).toEqual([mine]);
    expect(found.count).toBe(1);
    const byAccount = await matches(space, {
      conditions: [{ field: "account", operator: "equals", value: foreignAccount }],
    });
    expect(byAccount).toMatchObject({ count: 0, items: [], totals: [] });
    const limited = await matches(space, { conditions: [merchantIs("Adobe")], accountIds: [foreignAccount] });
    expect(limited).toMatchObject({ count: 0, items: [] });
  });

  it("BUD-14@PoC FR 8: a hidden, a split or a merged new transaction takes no category from a rule and is not in «Показати»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await createRule(space, {
      conditions: [merchantIs("Adobe")],
      categoryId: await category(space, "Підписки"),
    });
    const keeper = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    const hidden = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    const merged = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, hidden],
    );
    await db.owner.query(
      `UPDATE transactions.transactions SET merged_into = $3 WHERE household_id = $1 AND id = $2`,
      [space.householdId, merged, keeper],
    );
    await runWorker(space.householdId);
    expect(await categoryOf(space, keeper)).toMatchObject({ source: "rule" });
    const { rows } = await db.owner.query(
      `SELECT transaction_id FROM categorization.transaction_categories WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows.map((r) => r.transaction_id)).toEqual([keeper]);
    await knowMerchants(space);
    const found = await matches(space, { conditions: [merchantIs("Adobe")] });
    expect(found.items.map((i) => i.transactionId)).toEqual([keeper]);
  });

  it("BUD-14@PoC FR 9: a category set by hand while the job of the new transaction was dead stays after the daily recovery; a second run of the job changes nothing", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const rule = await createRule(space, {
      conditions: [merchantIs("Adobe")],
      categoryId: await category(space, "Підписки"),
    });
    const byHand = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    const byRule = await purchase(space, account, "ADOBE *CREATIVE CLOUD");
    await runWorker(space.householdId);
    expect(await categoryOf(space, byRule)).toMatchObject({ source: "rule", rule: { id: rule.id } });
    // By hand after the rule: the hand wins and the rule's mark is gone.
    expect(
      (await call(space, "PUT", `/v1/transactions/${byHand}/category`, { categoryId: groceries })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    // The jobs of both new transactions run again (a recovery of dead jobs, a second delivery).
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8, finished_at = NULL
        WHERE household_id = $1 AND name = 'categorization.transaction-created'`,
      [space.householdId],
    );
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    await runWorker(space.householdId);
    const after = await categoryOf(space, byHand);
    expect(after).toMatchObject({ categoryId: groceries, source: "manual" });
    expect(after.rule).toBeUndefined();
    const entries = await audit.entriesFor(space.householdId, {
      type: "categorization.transaction-category",
      id: byRule,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorKind: "system" });
    expect((await listRules(space))[0]!.appliedCount).toBe(1);
  });
  it("BUD-14@PoC FR 4: a space holds at most 500 rules — the next «Нове правило» is refused (422 LIMIT_REACHED), nothing saved", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    await db.owner.query(
      `INSERT INTO categorization.rules (household_id, id, position, conditions, category_id, condition_key)
       SELECT $1, gen_random_uuid(), g, jsonb_build_array(jsonb_build_object('field', 'merchant', 'operator', 'contains', 'value', 'Synth ' || g)),
              $2, 'synthetic-' || g
         FROM generate_series(1, 500) AS g`,
      [space.householdId, groceries],
    );
    const res = await call(space, "POST", "/v1/category-rules", {
      conditions: [merchantIs("Synth over")],
      categoryId: groceries,
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe("LIMIT_REACHED");
    const { rows } = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.rules WHERE household_id = $1`,
      [space.householdId],
    );
    expect(Number(rows[0].n)).toBe(500);
  });
  it("BUD-14@PoC FR 7: the scan of «Показати» is bounded in the database — the query returns at most limit + 1 rows of a larger space", async () => {
    const space = await newSpace();
    const first = await purchase(space, await createAccount(space), "ADOBE *CREATIVE CLOUD");
    await copies(space.householdId, first, 60);
    const real = db.databases.for("transactions");
    const read: number[] = [];
    const counting = {
      ...real,
      inHousehold: ((householdId: string, work: (q: never) => Promise<unknown>) =>
        real.inHousehold(householdId, (q) =>
          work({
            ...q,
            query: async (text: string, values?: readonly unknown[]) => {
              const result = await q.query(text, values);
              read.push(result.rows.length);
              return result;
            },
          } as never),
        )) as typeof real.inHousehold,
    };
    const found = await createTransactionRuleInputs(counting as typeof real).candidates(
      space.householdId,
      10,
    );
    expect(found.items).toHaveLength(10);
    expect(found.more).toBe(true);
    expect(Math.max(...read)).toBe(11);
  });
});
