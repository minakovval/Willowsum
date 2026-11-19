import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { bulkActionsServicesFor, schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
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
  createCategorizationErasure,
  createCategorizationServices,
} from "../src/modules/categorization/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { leakText } from "./leak-text.ts";

/**
 * BUD-01@PoC b) (wave 2 row 20): the category of a transaction through the real API on a real PostgreSQL — «Без
 * категорії», a change by hand of one transaction (AC8), the source (FR 4), the space's tree only (FR 9), a merge moves
 * the transactions (FR 8), «порожня» категорія (FR 12), another space and a scoped member (AC12), the audit hand-off
 * with its daily recovery (ARC-04, #249), and DAT-03's «Змінити категорію» (FR 2, AC1; #272 item 1). Every name and
 * amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const ENTITY = "categorization.transaction-category";
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

async function categoryOf(space: Space, transactionId: string) {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { transactionId: string; categoryId: string | null; source: string };
}

async function rows(householdId: string) {
  return (
    await db.owner.query(
      `SELECT transaction_id, category_id, source, version FROM categorization.transaction_categories
        WHERE household_id = $1 ORDER BY transaction_id`,
      [householdId],
    )
  ).rows;
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
  vi.restoreAllMocks();
});

describe("BUD-01@PoC FR 1, FR 4: a transaction's category and its source", () => {
  it("BUD-01@PoC FR 1: a new transaction is «Без категорії» — no category, the source «немає»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    expect(await categoryOf(space, t)).toEqual({ transactionId: t, categoryId: null, source: "none" });
    expect(await rows(space.householdId)).toEqual([]);
  });

  it("BUD-01@PoC FR 4: a change by hand is «вручну»; back to «Без категорії» is the source «немає»; each change is in the audit log with before and after", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const groceries = await category(space, "Продукти");

    const set = await setCategory(space, t, groceries.id);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ transactionId: t, categoryId: groceries.id, source: "manual" });
    expect(await categoryOf(space, t)).toEqual({
      transactionId: t,
      categoryId: groceries.id,
      source: "manual",
    });
    // The same again writes nothing.
    expect((await setCategory(space, t, groceries.id)).statusCode).toBe(200);
    const cleared = await setCategory(space, t, null);
    expect(cleared.json()).toEqual({ transactionId: t, categoryId: null, source: "none" });
    expect(await rows(space.householdId)).toEqual([
      { transaction_id: t, category_id: null, source: "none", version: 2 },
    ]);

    const log = await audit.entriesFor(space.householdId, { type: ENTITY, id: t });
    expect(log.map((e) => e.action)).toEqual(["update", "update"]);
    expect(log[0]).toMatchObject({ actorKind: "user", actorId: space.accountId });
    expect(log[0]!.changes).toEqual([
      expect.objectContaining({ field: "categoryId", before: null, after: groceries.id }),
      expect.objectContaining({ field: "source", before: "none", after: "manual" }),
    ]);
    expect(log[1]!.changes).toEqual([
      expect.objectContaining({ field: "categoryId", before: groceries.id, after: null }),
      expect.objectContaining({ field: "source", before: "manual", after: "none" }),
    ]);
  });

  it("BUD-01@PoC AC8: 14 transactions of a merchant in «Дім»; one changed to «Продукти» with the switch off — only it changes, the other 13 stay", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const home = await category(space, "Дім");
    const groceries = await category(space, "Продукти");
    const ids: string[] = [];
    for (let i = 0; i < 14; i++) ids.push(await purchase(space, account, "Синтетичний гіпермаркет"));
    for (const id of ids) expect((await setCategory(space, id, home.id)).statusCode).toBe(200);

    const one = await setCategory(space, ids[0]!, groceries.id);
    expect(one.statusCode, one.body).toBe(200);
    expect((await categoryOf(space, ids[0]!)).categoryId).toBe(groceries.id);
    for (const id of ids.slice(1)) expect(await categoryOf(space, id)).toMatchObject({ categoryId: home.id });
    // No rule appears (the switch «Застосувати до всіх транзакцій цього мерчанта» is BUD-14, wave 2 row 23).
    expect((await rows(space.householdId)).filter((r) => r.category_id === groceries.id)).toHaveLength(1);
  });
});

describe("BUD-01@PoC FR 9, FR 6: only a category of the space's tree, only a transaction that takes one", () => {
  it("BUD-01@PoC FR 9: a category of another space, an unknown, a merged-away and a service one are refused; a hidden one is taken", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const foreign = await category(other, "Продукти");
    const transfer = await category(space, "Переказ");
    const coffee = await addCategory(space, "Синтетична кава");
    const cafes = await category(space, "Кафе і ресторани");
    expect(
      (await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: cafes.id })).statusCode,
    ).toBe(200);

    for (const id of [foreign.id, randomUUID(), transfer.id, coffee.id]) {
      const res = await setCategory(space, t, id);
      expect(res.statusCode, id).toBe(400);
      expect(res.json().errors).toEqual([{ in: "body", path: "categoryId", issue: "not_found" }]);
    }
    expect(await rows(space.householdId)).toEqual([]);

    const travel = await category(space, "Подорожі");
    expect((await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: true })).statusCode).toBe(
      200,
    );
    expect((await setCategory(space, t, travel.id)).statusCode).toBe(200);
  });

  it("BUD-01@PoC FR 1: a refund (an income) takes the expense category of the purchase", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const refund = await purchase(space, account, "Синтетичний маркет", "8.00");
    const groceries = await category(space, "Продукти");
    const res = await setCategory(space, refund, groceries.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().categoryId).toBe(groceries.id);
  });

  it("BUD-01@PoC FR 6: a split transaction has the categories of its parts — its own change is refused (409 TRANSACTION_SPLIT)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний супермаркет", "-186.00");
    const groceries = await category(space, "Продукти");
    const household = await category(space, "Побутова хімія");
    const split = await call(space, "POST", `/v1/transactions/${t}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries.id, amount: "-150.00" },
        { categoryId: household.id, amount: "-36.00" },
      ],
    });
    expect(split.statusCode, split.body).toBe(200);
    const res = await setCategory(space, t, groceries.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TRANSACTION_SPLIT");
    expect(await rows(space.householdId)).toEqual([]);
  });
});

describe("BUD-01@PoC AC12: another space and a scoped member", () => {
  it("BUD-01@PoC AC12: a transaction of another space is «not found» for reading and changing; nothing of it is told or changed", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const groceries = await category(space, "Продукти");
    expect((await setCategory(space, t, groceries.id)).statusCode).toBe(200);
    const strangers = await category(stranger, "Продукти");

    const read = await call(stranger, "GET", `/v1/transactions/${t}/category`);
    expect(read.statusCode).toBe(404);
    expect(leakText(read.body)).not.toContain(groceries.id);
    const write = await setCategory(stranger, t, strangers.id);
    expect(write.statusCode).toBe(404);
    expect(await categoryOf(space, t)).toMatchObject({ categoryId: groceries.id, source: "manual" });
    expect((await call(space, "GET", `/v1/transactions/${randomUUID()}/category`)).statusCode).toBe(404);
  });

  it("BUD-01@PoC «Права доступу»: a scoped member — «Транзакції» closed: reading not found, changing 403", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const groceries = await category(space, "Продукти");
    const scoped = { role: "editor", scoped: true };
    expect((await call(space, "GET", `/v1/transactions/${t}/category`, undefined, scoped)).statusCode).toBe(
      404,
    );
    expect(
      (await call(space, "PUT", `/v1/transactions/${t}/category`, { categoryId: groceries.id }, scoped))
        .statusCode,
    ).toBe(403);
    expect(await rows(space.householdId)).toEqual([]);
  });

  it("BUD-01@PoC «Права доступу»: behind the release flag categories.tree — off, the routes are not found", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    off.add("categories.tree");
    expect((await call(space, "GET", `/v1/transactions/${t}/category`)).statusCode).toBe(404);
    expect((await setCategory(space, t, null)).statusCode).toBe(404);
  });
});

describe("BUD-01@PoC FR 8, FR 12: the category tree and the transactions' categories", () => {
  it("BUD-01@PoC FR 8: merging «Кава» into «Кафе і ресторани» moves its transactions (the event, through the worker), keeping their source", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Кава");
    const cafes = await category(space, "Кафе і ресторани");
    const ids = [
      await purchase(space, account, "Синтетична кав'ярня"),
      await purchase(space, account, "Синтетична кав'ярня"),
    ];
    for (const id of ids) expect((await setCategory(space, id, coffee.id)).statusCode).toBe(200);
    const merged = await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: cafes.id });
    expect(merged.statusCode, merged.body).toBe(200);

    await runWorker(space.householdId);
    for (const id of ids)
      expect(await categoryOf(space, id)).toEqual({
        transactionId: id,
        categoryId: cafes.id,
        source: "manual",
      });
    // The job ran once per event: a second pass moves nothing more.
    await runWorker(space.householdId);
    expect((await rows(space.householdId)).map((r) => r.version)).toEqual([2, 2]);
  });

  it("BUD-01@PoC FR 8: «Кава» into «Чай», then «Чай» into «Кафе і ресторани»; the first merge's job runs after the second's — the transactions end in «Кафе і ресторани», not in the merged-away «Чай»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Синтетична кава");
    const tea = await addCategory(space, "Синтетичний чай");
    const cafes = await category(space, "Кафе і ресторани");
    const t = await purchase(space, account, "Синтетична кав'ярня");
    expect((await setCategory(space, t, coffee.id)).statusCode).toBe(200);
    const first = await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: tea.id });
    expect(first.statusCode, first.body).toBe(200);
    // The first event reaches categorization late (a retried job, or a dead one put back by the daily recovery).
    await db.owner.query(
      `UPDATE categories.outbox_events SET dispatched_at = now() WHERE household_id = $1 AND dispatched_at IS NULL`,
      [space.householdId],
    );
    const second = await call(space, "POST", `/v1/categories/${tea.id}/merge`, { targetId: cafes.id });
    expect(second.statusCode, second.body).toBe(200);
    await runWorker(space.householdId);
    await db.owner.query(
      `UPDATE categories.outbox_events SET dispatched_at = NULL
        WHERE household_id = $1 AND payload->>'sourceId' = $2`,
      [space.householdId, coffee.id],
    );
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toEqual({ transactionId: t, categoryId: cafes.id, source: "manual" });
  });

  it("BUD-01@PoC FR 12: a custom category that a transaction has is not empty; moved away or the transaction deleted, it is empty again", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const snacks = await addCategory(space, "Синтетичні снеки");
    const groceries = await category(space, "Продукти");
    const a = await purchase(space, account, "Синтетичний кіоск");
    const b = await purchase(space, account, "Синтетичний кіоск");
    expect((await setCategory(space, a, snacks.id)).statusCode).toBe(200);
    expect((await setCategory(space, b, snacks.id)).statusCode).toBe(200);
    expect((await category(space, "Синтетичні снеки")).deletable).toBe(false);
    const refused = await call(space, "DELETE", `/v1/categories/${snacks.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("CATEGORY_NOT_EMPTY");

    expect((await setCategory(space, a, groceries.id)).statusCode).toBe(200);
    expect((await category(space, "Синтетичні снеки")).deletable).toBe(false);
    // A deleted transaction keeps no category of its own: its leftover row is no use.
    expect((await call(space, "DELETE", `/v1/transactions/${b}`)).statusCode).toBe(200);
    expect((await category(space, "Синтетичні снеки")).deletable).toBe(true);
    expect((await call(space, "DELETE", `/v1/categories/${snacks.id}`)).statusCode).toBe(200);
  });
});

describe("DAT-03@PoC FR 2: «Змінити категорію» of the selection panel (#272 item 1)", () => {
  it("DAT-03@PoC AC1: 12 selected, 2 already «Продукти» — the summary «Зміниться 10, пропущено 2: без змін» before anything is written; run, then undone", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await purchase(space, account, "Синтетичний ринок"));
    for (const id of ids.slice(0, 2))
      expect((await setCategory(space, id, groceries.id)).statusCode).toBe(200);
    const body = {
      action: "transactions.set-category",
      selection: { kind: "ids", ids },
      params: { categoryId: groceries.id },
    };

    const preview = await call(space, "POST", "/v1/bulk-actions/preview", body);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      count: 12,
      changes: 10,
      skipped: { unchanged: 2, unavailable: 0, conflict: 0, invalid: 0 },
    });
    expect((await rows(space.householdId)).filter((r) => r.category_id === groceries.id)).toHaveLength(2);

    const started = await call(space, "POST", "/v1/bulk-actions", body);
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json()).toMatchObject({ status: "completed", changed: 10 });
    for (const id of ids)
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: groceries.id, source: "manual" });

    const undo = await call(space, "POST", `/v1/bulk-actions/${started.json().id}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    for (const id of ids.slice(2))
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
    for (const id of ids.slice(0, 2)) expect((await categoryOf(space, id)).categoryId).toBe(groceries.id);
  });

  it("DAT-03@PoC FR 5 (#296 no. 6): a transaction with the category of a rule is «Зміниться» (its source becomes «вручну», as a single change does), one already «вручну» is «без змін»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const byRule = await purchase(space, account, "Синтетичний ринок");
    const byHand = await purchase(space, account, "Синтетичний ринок");
    for (const id of [byRule, byHand])
      expect((await setCategory(space, id, groceries.id)).statusCode).toBe(200);
    await db.owner.query(
      `UPDATE categorization.transaction_categories SET source = 'rule' WHERE household_id = $1 AND transaction_id = $2`,
      [space.householdId, byRule],
    );
    const body = {
      action: "transactions.set-category",
      selection: { kind: "ids", ids: [byRule, byHand] },
      params: { categoryId: groceries.id },
    };
    const preview = await call(space, "POST", "/v1/bulk-actions/preview", body);
    expect(preview.json()).toMatchObject({ count: 2, changes: 1, skipped: { unchanged: 1 } });
    const started = await call(space, "POST", "/v1/bulk-actions", body);
    expect(started.json()).toMatchObject({ status: "completed", changed: 1 });
    expect(await categoryOf(space, byRule)).toMatchObject({ categoryId: groceries.id, source: "manual" });
    // The same as the single change of a rule's category to itself.
    const single = await purchase(space, account, "Синтетичний ринок");
    expect((await setCategory(space, single, groceries.id)).statusCode).toBe(200);
    await db.owner.query(
      `UPDATE categorization.transaction_categories SET source = 'rule' WHERE household_id = $1 AND transaction_id = $2`,
      [space.householdId, single],
    );
    expect((await setCategory(space, single, groceries.id)).statusCode).toBe(200);
    expect(await categoryOf(space, single)).toMatchObject({ categoryId: groceries.id, source: "manual" });
  });

  it("DAT-03@PoC FR 2: «Вибрати всі M за фільтром» on the list's filter; a split transaction and another space's are skipped; a category outside the tree is invalid for all", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const groceries = await category(space, "Продукти");
    const household = await category(space, "Побутова хімія");
    const a = await purchase(space, account, "Синтетична крамниця");
    const b = await purchase(space, account, "Синтетична крамниця", "-10.00");
    await purchase(space, account, "Інший синтетичний продавець");
    const foreign = await purchase(other, otherAccount, "Синтетична крамниця");
    expect(
      (
        await call(space, "POST", `/v1/transactions/${b}/split`, {
          mode: "categories",
          parts: [
            { categoryId: groceries.id, amount: "-6.00" },
            { categoryId: household.id, amount: "-4.00" },
          ],
        })
      ).statusCode,
    ).toBe(200);

    const byFilter = await call(space, "POST", "/v1/bulk-actions/preview", {
      action: "transactions.set-category",
      selection: { kind: "filter", filter: ["counterparty.eq:Синтетична крамниця"], excluded: [] },
      params: { categoryId: groceries.id },
    });
    expect(byFilter.statusCode, byFilter.body).toBe(200);
    expect(byFilter.json()).toMatchObject({ count: 2, changes: 1, skipped: { invalid: 1 } });
    expect(byFilter.json().examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: b, reason: "invalid", issue: "transaction.split" }),
      ]),
    );

    const mixed = await call(space, "POST", "/v1/bulk-actions/preview", {
      action: "transactions.set-category",
      selection: { kind: "ids", ids: [a, foreign] },
      params: { categoryId: groceries.id },
    });
    expect(mixed.json()).toMatchObject({ count: 2, changes: 1, skipped: { unavailable: 1 } });

    const outside = await call(space, "POST", "/v1/bulk-actions/preview", {
      action: "transactions.set-category",
      selection: { kind: "ids", ids: [a] },
      params: { categoryId: (await category(other, "Продукти")).id },
    });
    expect(outside.json()).toMatchObject({ count: 1, changes: 0, skipped: { invalid: 1 } });
    expect(await rows(space.householdId)).toEqual([]);
    expect(await rows(other.householdId)).toEqual([]);
  });
});

describe("ARC-04@PoC FR 2–4: the audit hand-off of a change, its dead job and the daily recovery (#249)", () => {
  it("ARC-04@PoC FR 4: the audit entry fails — the change stands (200, WARN deferred); its job in state dead goes back with the daily recovery and the entry is written once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const groceries = await category(space, "Продукти");
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === ENTITY) throw new Error("injected");
      return original(householdId, entry);
    });
    const res = await setCategory(space, t, groceries.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "categorization.hand_off_deferred")
        .map((r) => r.severityText),
    ).toEqual(["WARN"]);
    vi.restoreAllMocks();
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: t })).toHaveLength(0);

    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: t })).toHaveLength(0);

    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    const names = tasks.map((task) => task.name);
    expect(names.indexOf("categorization.recovery")).toBeGreaterThan(-1);
    expect(names.indexOf("categorization.recovery")).toBeLessThan(names.indexOf("queue.retention-cleanup"));
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "categorization.jobs_requeued")
        .map((r) => [r.severityText, r.attributes]),
    ).toEqual([["WARN", { "ws.module": "categorization" }]]);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: t })).toHaveLength(1);
  });

  it("ARC-04@PoC FR 4 (#296 no. 7): the merge's job in state dead goes back with the daily recovery and moves the transactions", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const coffee = await addCategory(space, "Синтетична кава");
    const cafes = await category(space, "Кафе і ресторани");
    const t = await purchase(space, account, "Синтетична кав'ярня");
    expect((await setCategory(space, t, coffee.id)).statusCode).toBe(200);
    expect(
      (await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: cafes.id })).statusCode,
    ).toBe(200);
    // The event becomes a categorization job (the module's jobs not taken meanwhile); the job gives up (dead).
    const worker = createWorker({
      ...workerQueues(db.databases),
      households: async () => [space.householdId],
      moduleAvailable: async (module) => module !== "categorization",
    });
    await worker.tick();
    await worker.idle();
    await worker.stop();
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'categorization.category-merged' AND state = 'queued'`,
      [space.householdId],
    );
    expect(
      (
        await db.owner.query(
          `SELECT count(*)::int AS n FROM categorization.jobs WHERE household_id = $1 AND state = 'dead'`,
          [space.householdId],
        )
      ).rows[0].n,
    ).toBe(1);
    await runWorker(space.householdId);
    expect((await categoryOf(space, t)).categoryId).toBe(coffee.id);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    await runWorker(space.householdId);
    expect((await categoryOf(space, t)).categoryId).toBe(cafes.id);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the transactions' categories and the queue rows", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    expect((await setCategory(space, t, (await category(space, "Продукти")).id)).statusCode).toBe(200);
    const erased = await createCategorizationErasure(db.databases.for("categorization")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ transactionCategories: 1, jobs: 1 });
    expect(await rows(space.householdId)).toEqual([]);
  });
});
