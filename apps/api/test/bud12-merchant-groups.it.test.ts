import { randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { bulkActionsServicesFor, workerQueues } from "../src/wiring.ts";
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
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import {
  createMerchantDirectory,
  createMerchantsServices,
  normalizeDescription,
} from "../src/modules/merchants/index.ts";
import {
  createTransactionLookup,
  createTransactionRuleInputs,
  createTransactionTexts,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";

/**
 * BUD-12@PoC FR 14–16 (server part), through the real API on a real PostgreSQL: «До розбору» in the mode «Мерчанти» —
 * the queue grouped by merchant (count, exact sum per currency, suggested category), the ids of a group for the bulk
 * actions that confirm it or change its category, «Запам'ятати» as a rule, and a queue of a few thousand. Every name
 * and amount is synthetic; the session is the test's principal header; the clock is fixed.
 *
 * The queue is filled only by the import of statement files (FR 8; not built yet): `queue()` stands for it, as in
 * bud12-review.it.test.ts.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-17T10:00:00Z");
const FLAG = "merchants.review-groups";
const GROUPS = "/v1/transaction-review/merchant-groups";

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

interface Group {
  id: string;
  merchant: { id: string; name: string; initials: string; intermediary: boolean } | null;
  count: number;
  totals: { amount: string; currency: string }[];
  oldest: string;
  suggestedCategoryId: string | null;
  mixedCategories: boolean;
  counterparty: string | null;
}

interface GroupsPage {
  items: Group[];
  page: number;
  pageSize: number;
  count: number;
  transactionCount: number;
  truncated: boolean;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT",
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
      ...(method === "POST" && url.startsWith("/v1/bulk-actions") && !url.endsWith("/preview")
        ? { "idempotency-key": randomUUID() }
        : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** Runs the worker until the categorization jobs and the events of the space are done (as bud14-rules.it.test.ts). */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 50; pass++) {
    const { rows } = await db.owner.query(
      `SELECT (SELECT count(*) FROM categorization.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL)
            + (SELECT count(*) FROM categories.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL)
            + (SELECT count(*) FROM accounts.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL) AS n`,
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

async function createAccount(space: Space, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Синтетичний рахунок ${currency}`,
    balance: { amount: "5000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function add(
  space: Space,
  accountId: string,
  amount: string,
  counterparty: string | null,
  extra: { date?: string; currency?: string } = {},
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: extra.currency ?? "EUR" },
    date: extra.date ?? "2026-11-10",
    ...(counterparty === null ? {} : { counterparty }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** Stands for the import of a statement file (FR 8): each of `ids` is a new imported transaction in the queue. */
async function queue(space: Space, ids: readonly string[]): Promise<void> {
  await db.owner.query(
    `UPDATE transactions.transactions SET review = 'queued' WHERE household_id = $1 AND id = ANY($2::uuid[])`,
    [space.householdId, ids],
  );
}

async function groups(space: Space, query = ""): Promise<GroupsPage> {
  const res = await call(space, "GET", `${GROUPS}${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as GroupsPage;
}

/** Every id of a group, page after page. */
async function groupIds(space: Space, groupId: string, limit?: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const params = new URLSearchParams({ limit: String(limit ?? 100) });
    if (cursor) params.set("cursor", cursor);
    const res = await call(space, "GET", `${GROUPS}/${groupId}/transactions?${params}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as { items: string[]; nextCursor: string | null };
    expect(page.items.length).toBeLessThanOrEqual(limit ?? 100);
    ids.push(...page.items);
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("too many pages");
}

async function counter(space: Space): Promise<number> {
  const res = await call(space, "GET", "/v1/transaction-review");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().count as number;
}

const categoryIds = new Map<string, Map<string, string>>();
async function category(space: Space, name: string): Promise<string> {
  let ids = categoryIds.get(space.householdId);
  if (!ids) {
    const res = await call(space, "GET", "/v1/categories");
    expect(res.statusCode, res.body).toBe(200);
    ids = new Map(
      (res.json().groups as { categories: { id: string; name: string }[] }[]).flatMap((g) =>
        g.categories.map((c) => [c.name, c.id] as const),
      ),
    );
    categoryIds.set(space.householdId, ids);
  }
  expect(ids.get(name), name).toBeDefined();
  return ids.get(name)!;
}

async function setCategory(space: Space, id: string, name: string): Promise<void> {
  const res = await call(space, "PUT", `/v1/transactions/${id}/category`, {
    categoryId: await category(space, name),
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function bulk(space: Space, action: string, ids: readonly string[], params?: unknown) {
  const res = await call(space, "POST", "/v1/bulk-actions", {
    action,
    selection: { kind: "ids", ids },
    ...(params === undefined ? {} : { params }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { status: string; changed: number };
}

const categoryOf = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}/category`)).json().categoryId as string | null;
const reviewOf = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json().review as string | null;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW });
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
          fx,
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
          duplicates: createDuplicateCheck(),
          categoryOf: createTransactionCategories(db.databases.for("categorization")),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
          rules: categorizationRulePorts({
            accounts: createAccountDirectory(db.databases.for("accounts")),
            merchants: createMerchantDirectory(db.databases.for("merchants")),
            inputs: createTransactionRuleInputs(db.databases.for("transactions")),
          }),
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
          categories: createTransactionCategories(db.databases.for("categorization")),
        }),
        bulkActions: bulkActionsServicesFor(audit, db.databases, { now: () => NOW }, { isEnabled }),
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

describe("BUD-12@PoC FR 14 (server part): the mode «Мерчанти» — the queue grouped by merchant", () => {
  it("BUD-12@PoC FR 14: a row per merchant — name, count, the sum per currency (exact, mixed currencies) and the suggested category; descriptions of one merchant are one group", async () => {
    const space = await newSpace();
    const eur = await createAccount(space);
    const usd = await createAccount(space, "USD");
    const silpo = [
      await add(space, eur, "-0.10", "POS SILPO 1234", { date: "2026-11-03" }),
      await add(space, eur, "-0.20", "SILPO 0042 KYIV", { date: "2026-11-01" }),
      await add(space, usd, "-5.55", "POS SILPO 1234", { currency: "USD" }),
    ];
    const shell = [
      await add(space, eur, "-50.00", "SHELL 077"),
      await add(space, eur, "-12.30", "SHELL 078"),
    ];
    const manual = await add(space, eur, "-99.00", "POS SILPO 1234");
    await queue(space, [...silpo, ...shell]);
    for (const id of silpo.slice(0, 2)) await setCategory(space, id, "Продукти");
    await setCategory(space, silpo[2]!, "Кафе і ресторани");
    await setCategory(space, manual, "Кафе і ресторани");

    const page = await groups(space);
    expect(page).toMatchObject({ page: 1, pageSize: 25, count: 2, transactionCount: 5, truncated: false });
    expect(page.transactionCount).toBe(await counter(space));
    const [first, second] = page.items;
    expect(first).toMatchObject({
      merchant: { name: "Silpo", initials: "S", intermediary: false },
      count: 3,
      // 0.1 + 0.2 is exactly 0.3; each currency on its own, never converted.
      totals: [
        { amount: "-0.3", currency: "EUR" },
        { amount: "-5.55", currency: "USD" },
      ],
      oldest: "2026-11-01",
      suggestedCategoryId: await category(space, "Продукти"),
      mixedCategories: true,
      counterparty: "POS SILPO 1234",
    });
    expect(first!.id).toBe(first!.merchant!.id);
    expect(second).toMatchObject({
      merchant: { name: "Shell" },
      count: 2,
      totals: [{ amount: "-62.3", currency: "EUR" }],
      suggestedCategoryId: null,
      mixedCategories: false,
    });
    // The manual transaction of the same merchant is not in the queue (FR 8) and so in no group.
    expect((await groupIds(space, first!.id)).sort()).toEqual([...silpo].sort());
  });

  it("BUD-12@PoC FR 14: a merge of merchants joins their groups; transactions without a description are the bucket `none` (the web reads their ids and shows them one by one, no group)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00", "STARBUCKS 0042");
    const b = await add(space, account, "-2.00", "Starbucks Coffee 0001");
    const none = await add(space, account, "-3.00", null);
    await queue(space, [a, b, none]);
    const before = await groups(space);
    expect(before.items.map((g) => g.count)).toEqual([1, 1, 1]);
    const target = before.items.find((g) => g.merchant?.name === "Starbucks")!;
    const source = before.items.find((g) => g.merchant?.name === "Starbucks Coffee")!;
    const merged = await call(space, "POST", `/v1/merchants/${target.id}/merge`, {
      merchantId: source.id,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    const after = await groups(space);
    expect(after.items.map((g) => [g.merchant?.name ?? null, g.count])).toEqual([
      ["Starbucks", 2],
      [null, 1],
    ]);
    expect(after.items[1]).toMatchObject({ id: "none", merchant: null, counterparty: null });
    expect(await groupIds(space, "none")).toEqual([none]);
    expect((await groupIds(space, target.id)).sort()).toEqual([a, b].sort());
    // The merchant that joined another is no group of its own.
    expect((await call(space, "GET", `${GROUPS}/${source.id}/transactions`)).statusCode).toBe(404);
  });

  it("BUD-12@PoC FR 14: pages of 25 / 50 / 100 groups, the largest first; other page sizes are refused", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await add(space, account, "-1.00", "Велика група"));
    ids.push(await add(space, account, "-1.00", "Мала група"));
    await queue(space, ids);
    const page = await groups(space, "?pageSize=50");
    expect(page.items.map((g) => [g.merchant?.name, g.count])).toEqual([
      ["Велика група", 3],
      ["Мала група", 1],
    ]);
    expect((await groups(space, "?page=2")).items).toEqual([]);
    expect((await call(space, "GET", `${GROUPS}?pageSize=1000`)).statusCode).toBe(400);
    expect((await call(space, "GET", `${GROUPS}/none/transactions?limit=101`)).statusCode).toBe(400);
  });

  it("BUD-12@PoC FR 10: one queue per space — another space sees no group and no id of it; a scoped member sees nothing", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    await queue(space, [await add(space, account, "-7.00", "Сільпо")]);
    const mine = (await groups(space)).items[0]!;
    expect(await groups(other)).toMatchObject({ count: 0, transactionCount: 0, items: [] });
    expect((await call(other, "GET", `${GROUPS}/${mine.id}/transactions`)).statusCode).toBe(404);
    expect(await groupIds(other, "none")).toEqual([]);
    const scoped = { role: "editor", scoped: true };
    expect((await call(space, "GET", GROUPS, undefined, scoped)).statusCode).toBe(404);
    expect(
      (await call(space, "GET", `${GROUPS}/${mine.id}/transactions`, undefined, scoped)).statusCode,
    ).toBe(404);
  });

  it("BUD-12@PoC FR 14: the mode «Мерчанти» is behind the release flag `merchants.review-groups`", async () => {
    const space = await newSpace();
    off.add(FLAG);
    expect((await call(space, "GET", GROUPS)).statusCode).toBe(404);
    expect((await call(space, "GET", `${GROUPS}/none/transactions`)).statusCode).toBe(404);
  });
});

describe("BUD-12@PoC AC8, AC10, FR 15, FR 16 (server part): a group confirmed, «Запам'ятати», «Змінити категорію»", () => {
  it("BUD-12@PoC AC8 (server part): 18 of 103 from «Сільпо» suggested «Продукти» — «Запам'ятати» makes a rule, «Підтвердити» on the group confirms 18, the progress «18 з 103 · лишилось 85»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const silpo: string[] = [];
    for (let i = 0; i < 18; i++) silpo.push(await add(space, account, `-${10 + i}.00`, `SILPO ${1000 + i}`));
    for (const id of silpo) await setCategory(space, id, "Продукти");
    const others: string[] = [];
    for (let i = 0; i < 85; i++) others.push(await add(space, account, "-1.00", `Синтетичний ${i % 5}`));
    await queue(space, [...silpo, ...others]);
    // The jobs of the 103 new transactions are done before the rule exists (as the import would have them).
    await runWorker(space.householdId);
    const before = await groups(space);
    expect(before.transactionCount).toBe(103);
    const group = before.items.find((g) => g.merchant?.name === "Silpo")!;
    expect(group).toMatchObject({ count: 18, suggestedCategoryId: groceries, mixedCategories: false });

    // «Запам'ятати: Silpo → Продукти» — a rule for the merchant's new transactions.
    const rule = await call(space, "POST", "/v1/category-rules", {
      conditions: [{ field: "merchant", operator: "equals", value: group.merchant!.name }],
      categoryId: groceries,
    });
    expect(rule.statusCode, rule.body).toBe(201);
    // «Підтвердити» on the group: its ids, confirmed by the bulk action.
    const ids = await groupIds(space, group.id);
    expect(ids.sort()).toEqual([...silpo].sort());
    expect(await bulk(space, "transactions.confirm-category", ids)).toMatchObject({
      status: "completed",
      changed: 18,
    });
    for (const id of silpo) expect(await reviewOf(space, id)).toBe("confirmed");
    // FR 15: «18 з 103 · лишилось 85» — transactions, not groups.
    expect(await counter(space)).toBe(85);
    const after = await groups(space);
    expect(after.transactionCount).toBe(85);
    expect(after.items.some((g) => g.merchant?.name === "Silpo")).toBe(false);
    // The rule applies to a new transaction of the merchant.
    const fresh = await add(space, account, "-4.00", "SILPO 2001");
    await runWorker(space.householdId);
    expect(await categoryOf(space, fresh)).toBe(groceries);
  });

  it("BUD-12@PoC FR 16 (server part): the pencil on a group — «Часто для <мерчанта>» from the group's description, the choice applied to the whole group and confirmed", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    // History: the merchant's earlier transactions, by hand, in «Пальне».
    const earlier = await add(space, account, "-40.00", "SHELL 112", { date: "2026-10-01" });
    await setCategory(space, earlier, "Пальне");
    const shell: string[] = [];
    for (let i = 0; i < 4; i++) shell.push(await add(space, account, `-${50 + i}.00`, `SHELL ${120 + i}`));
    await setCategory(space, shell[0]!, "Кафе і ресторани");
    await queue(space, shell);
    const group = (await groups(space)).items[0]!;
    expect(group).toMatchObject({ merchant: { name: "Shell" }, count: 4, mixedCategories: true });
    const hints = await call(
      space,
      "GET",
      `/v1/category-suggestions?counterparty=${encodeURIComponent(group.counterparty!)}`,
    );
    expect(hints.statusCode, hints.body).toBe(200);
    expect(hints.json().merchant).toBe("Shell");
    expect(JSON.stringify(hints.json().top)).toContain(await category(space, "Пальне"));
    const ids = await groupIds(space, group.id, 3);
    expect(ids).toHaveLength(4);
    await bulk(space, "transactions.set-category", ids, { categoryId: await category(space, "Пальне") });
    await bulk(space, "transactions.confirm-category", ids);
    for (const id of shell) {
      expect(await categoryOf(space, id)).toBe(await category(space, "Пальне"));
      expect(await reviewOf(space, id)).toBe("confirmed");
    }
    expect(await groups(space)).toMatchObject({ count: 0, transactionCount: 0 });
  });
});

describe("BUD-12@PoC FR 14: «Так розбирають і великі черги (тисячі транзакцій)»", () => {
  it("BUD-12@PoC FR 14: a queue of 3 000 with 1 300 descriptions — groups aggregated in SQL with exact sums, a bounded page, every id of a group paged by 100", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const seed = await add(space, account, "-1.00", "Seed");
    // 3 000 imported transactions: 1 200 «Silpo» under 500 descriptions (store numbers), 600 «Shell» under 200, and
    // 1 200 of 600 small merchants of two each. Amounts in cents with up to 2 decimals.
    await db.owner.query(
      `INSERT INTO transactions.transactions
         (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, counterparty, review)
       SELECT t.household_id, gen_random_uuid(), t.account_id, t.subaccount_id,
              -((g % 997) + 1)::numeric / 100, t.currency, DATE '2026-11-10' - (g % 60),
              CASE WHEN g <= 1200 THEN 'POS SILPO ' || lpad((g % 500)::text, 4, '0')
                   WHEN g <= 1800 THEN 'SHELL ' || lpad((g % 200)::text, 3, '0')
                   ELSE 'Кав''ярня ' || chr(1072 + (g % 600) % 30) || chr(1072 + (g % 600) / 30) END,
              'queued'
         FROM transactions.transactions t, generate_series(1, 3000) g
        WHERE t.household_id = $1 AND t.id = $2`,
      [space.householdId, seed],
    );
    const expected = async (like: string) =>
      (
        await db.owner.query<{ n: number; total: string }>(
          `SELECT count(*)::int AS n, sum(amount)::text AS total FROM transactions.transactions
            WHERE household_id = $1 AND review = 'queued' AND counterparty LIKE $2`,
          [space.householdId, like],
        )
      ).rows[0]!;
    expect(await counter(space)).toBe(3000);

    const started = performance.now();
    const res = await call(space, "GET", `${GROUPS}?pageSize=100`);
    const took = performance.now() - started;
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as GroupsPage;
    // The page is bounded by its size, not by the queue.
    expect(res.body.length).toBeLessThan(64 * 1024);
    expect(page.items).toHaveLength(100);
    // The groups: one per merchant the descriptions normalize to (BUD-14 FR 1), counted here independently.
    const descriptions = await db.owner.query<{ counterparty: string }>(
      `SELECT DISTINCT counterparty FROM transactions.transactions WHERE household_id = $1 AND review = 'queued'`,
      [space.householdId],
    );
    const merchantCount = new Set(descriptions.rows.map((r) => normalizeDescription(r.counterparty)!.key))
      .size;
    expect(merchantCount).toBeGreaterThan(500);
    expect(page).toMatchObject({ count: merchantCount, transactionCount: 3000, truncated: false });
    const [silpo, shell] = page.items;
    const silpoSql = await expected("POS SILPO %");
    const shellSql = await expected("SHELL %");
    expect(silpo).toMatchObject({ merchant: { name: "Silpo" }, count: silpoSql.n });
    expect(new Decimal(silpo!.totals[0]!.amount).equals(new Decimal(silpoSql.total))).toBe(true);
    expect(shell).toMatchObject({ merchant: { name: "Shell" }, count: shellSql.n });
    expect(new Decimal(shell!.totals[0]!.amount).equals(new Decimal(shellSql.total))).toBe(true);
    expect(page.items.slice(2).every((g) => g.count >= 2 && g.count < shellSql.n)).toBe(true);
    // Generous: a few thousand must not take long (the slices are counted in SQL).
    expect(took).toBeLessThan(10_000);

    const ids = await groupIds(space, silpo!.id);
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);
    // The last page: every group is on one page of 100 or another.
    expect((await groups(space, "?page=6&pageSize=100")).items).toHaveLength(merchantCount - 500);
  }, 60_000);
});

describe("BUD-12@PoC FR 10 and «лише з записів у межах прав» (security review of #491)", () => {
  it("BUD-12@PoC FR 10: two spaces with the same merchant — each gets only its own count, sums and ids, also with the other space's cursor", async () => {
    const [a, b] = [await newSpace(), await newSpace()];
    const [accountA, accountB] = [await createAccount(a), await createAccount(b)];
    const idsA = [
      await add(a, accountA, "-1.11", "Сільпо"),
      await add(a, accountA, "-2.22", "Сільпо"),
      await add(a, accountA, "-3.01", null),
    ];
    const idsB = [await add(b, accountB, "-40.01", "Сільпо"), await add(b, accountB, "-9.09", null)];
    await queue(a, idsA);
    await queue(b, idsB);
    const [pageA, pageB] = [await groups(a), await groups(b)];
    expect(pageA).toMatchObject({ count: 2, transactionCount: 3 });
    expect(pageB).toMatchObject({ count: 2, transactionCount: 2 });
    const [groupA, groupB] = [pageA.items.find((g) => g.merchant)!, pageB.items.find((g) => g.merchant)!];
    expect(groupA).toMatchObject({ count: 2, totals: [{ amount: "-3.33", currency: "EUR" }] });
    expect(groupB).toMatchObject({ count: 1, totals: [{ amount: "-40.01", currency: "EUR" }] });
    expect(pageB.items.find((g) => g.id === "none")!.totals).toEqual([{ amount: "-9.09", currency: "EUR" }]);
    expect(groupB.id).not.toBe(groupA.id);
    expect((await groupIds(a, groupA.id)).sort()).toEqual(idsA.slice(0, 2).sort());
    expect(await groupIds(b, groupB.id)).toEqual([idsB[0]]);
    expect(await groupIds(b, "none")).toEqual([idsB[1]]);
    // A cursor is only a position: one cut in space A opens nothing of A in space B.
    const first = await call(a, "GET", `${GROUPS}/${groupA.id}/transactions?limit=1`);
    const cursor = (first.json() as { nextCursor: string }).nextCursor;
    for (const group of [groupB.id, "none"]) {
      const res = await call(
        b,
        "GET",
        `${GROUPS}/${group}/transactions?cursor=${encodeURIComponent(cursor)}`,
      );
      for (const id of (res.json() as { items: string[] }).items) expect(idsB).toContain(id);
    }
  });

  it("BUD-12@PoC FR 14: a hidden transaction and a confirmed one are in no group, sum or id list; a viewer reads the groups", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const [queued, hidden, confirmed] = [
      await add(space, account, "-10.01", "SHELL 077"),
      await add(space, account, "-20.02", "SHELL 077"),
      await add(space, account, "-30.03", "SHELL 077"),
    ];
    await queue(space, [queued, hidden, confirmed]);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hidden]);
    await db.owner.query(`UPDATE transactions.transactions SET review = 'confirmed' WHERE id = $1`, [
      confirmed,
    ]);
    const res = await call(space, "GET", GROUPS, undefined, { role: "viewer" });
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as GroupsPage;
    expect(page).toMatchObject({ count: 1, transactionCount: 1 });
    expect(page.items[0]).toMatchObject({ count: 1, totals: [{ amount: "-10.01", currency: "EUR" }] });
    expect(await groupIds(space, page.items[0]!.id)).toEqual([queued]);
  });
});
