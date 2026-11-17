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
  createTransactionRuleTags,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-14@PoC b2) (wave 2 row 23 — the rest of the server part): «Видалити» a rule (FR 15, AC17); the tags action and
 * each attribute from the first rule that sets it, «Застосовано правила: №…» (FR 5, FR 8, FR 9, AC3); «Застосувати до N
 * наявних транзакцій» as one operation — up to 500 at once, the rest in the background with progress, «Пропущено: ручні
 * зміни», «Відмінити» for 7 days that restores only what was not changed since (FR 7, AC2, AC4–AC6, AC15, EC1, EC5);
 * concurrent runs and undos, another space, a viewer and a scoped member, the audit entries, a dead background part and
 * its daily recovery (ARC-04, #249), and the space's erasure. Every name and amount is synthetic; the clock is injected.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
/** A scoped member: no write permission (403); «Транзакції» closed by the visibility policy (reads 404). */
const SCOPED = { role: "editor", scoped: true };
const telemetry = testTelemetryForFile();

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
let now = NOW;
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
  categoryId: string;
  tags: string[];
}

interface RunBody {
  id: string;
  ruleId: string;
  status: "running" | "completed" | "undoing" | "undone";
  background: boolean;
  count: number;
  processed: number;
  changed: number;
  skipped: { manual: number; unchanged: number; unavailable: number };
  truncated: boolean;
  undo: { available: boolean; until: string | null; restored: number; notRestored: number };
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

/** `n` purchases of one counterparty, one a month back from 2026-10-15, through the API. */
async function purchases(
  space: Space,
  accountId: string,
  counterparty: string,
  n: number,
  amount = "-59.99",
) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 9 - i, 15)).toISOString().slice(0, 10);
    ids.push(await purchase(space, accountId, counterparty, amount, d));
  }
  return ids;
}

async function categoryOf(space: Space, transactionId: string) {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    categoryId: string | null;
    source: string;
    rule?: { id: string; position: number };
    appliedRules?: { id: string; position: number }[];
  };
}

async function tagsOf(space: Space, transactionId: string): Promise<string[]> {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().tags as { name: string }[]).map((t) => t.name);
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

async function apply(space: Space, ruleId: string): Promise<RunBody> {
  const res = await call(space, "POST", `/v1/category-rules/${ruleId}/apply`, {});
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as RunBody;
}

async function run(space: Space, runId: string): Promise<RunBody> {
  const res = await call(space, "GET", `/v1/category-rule-runs/${runId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as RunBody;
}

/**
 * Passes of the worker as main.ts wires it until the space's events are dispatched and its jobs have ended (a run of
 * 1 200 records leaves one audit job per changed transaction: more at a time than the worker's default).
 */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 200; pass++) {
    const { rows } = await db.owner.query(
      `SELECT (SELECT count(*) FROM categorization.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL)
            + (SELECT count(*) FROM categories.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL) AS n`,
      [householdId],
    );
    if (Number(rows[0].n) === 0) return;
    const worker = createWorker({
      ...workerQueues(db.databases, { isEnabled }),
      households: async () => [householdId],
      concurrency: 50,
    });
    try {
      await worker.tick();
      await worker.idle();
    } finally {
      await worker.stop();
    }
  }
}

/** `n` copies of transaction `id` straight in the transactions schema (one a day back): a run of over 500. */
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
  const accounts = createAccountDirectory(db.databases.for("accounts"));
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
          accounts,
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
            accounts,
            merchants: createMerchantDirectory(db.databases.for("merchants")),
            inputs: createTransactionRuleInputs(db.databases.for("transactions")),
            tags: createTransactionRuleTags({
              db: db.databases.for("transactions"),
              accounts,
              newId: randomUUID,
              flags: { isEnabled },
            }),
          }),
          scanMax: 2000,
          clock: { now: () => now },
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
  now = NOW;
  vi.restoreAllMocks();
});

describe("BUD-14@PoC FR 15: «Видалити» a rule", () => {
  it("BUD-14@PoC AC17: rule №2 «Мерчант містить Netflix → Підписки» categorized 14 transactions — «Видалити» takes it off the list and new transactions, the 14 keep «Підписки» without «за правилом №2», the audit log has the delete", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const subscriptions = await category(space, "Підписки");
    const first = await createRule(space, {
      conditions: [merchantIs("Synth Market")],
      categoryId: groceries,
    });
    const netflix = await createRule(space, {
      conditions: [merchantIs("Netflix")],
      categoryId: subscriptions,
      tags: ["стрімінг"],
    });
    const third = await createRule(space, {
      conditions: [merchantIs("Synth Bakery")],
      categoryId: groceries,
    });
    const past = await purchases(space, account, "NETFLIX.COM 866-579-7172", 14, "-12.99");
    await runWorker(space.householdId);
    expect(await categoryOf(space, past[0]!)).toMatchObject({
      categoryId: subscriptions,
      source: "rule",
      rule: { id: netflix.id, position: 2 },
      appliedRules: [{ id: netflix.id, position: 2 }],
    });

    const res = await call(space, "DELETE", `/v1/category-rules/${netflix.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    const listed = (await call(space, "GET", "/v1/category-rules")).json().items as RuleBody[];
    expect(listed.map((r) => [r.id, r.position])).toEqual([
      [first.id, 1],
      [third.id, 2],
    ]);
    for (const id of past) {
      const c = await categoryOf(space, id);
      expect(c).toMatchObject({ categoryId: subscriptions, source: "rule" });
      expect(c.rule).toBeUndefined();
      expect(c.appliedRules).toBeUndefined();
      expect(await tagsOf(space, id)).toEqual(["стрімінг"]);
    }
    const fresh = await purchase(space, account, "NETFLIX.COM 866-579-7172", "-12.99", "2026-10-16");
    await runWorker(space.householdId);
    expect((await categoryOf(space, fresh)).source).toBe("none");
    expect(await tagsOf(space, fresh)).toEqual([]);

    const entries = await audit.entriesFor(space.householdId, {
      type: "categorization.rule",
      id: netflix.id,
    });
    expect(entries.map((e) => e.action)).toEqual(["create", "delete"]);
    expect(entries[1]).toMatchObject({ actorKind: "user", actorId: space.accountId });
    expect(entries[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "conditions", before: AUDIT_MASK, after: null }),
        expect.objectContaining({ field: "categoryId", before: subscriptions, after: null }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toMatch(/Netflix|стрімінг/);
    // Twice — not found.
    expect((await call(space, "DELETE", `/v1/category-rules/${netflix.id}`)).statusCode).toBe(404);
  });

  it("BUD-14@PoC FR 15, «Права доступу»: a rule of another space is not found; a viewer and a scoped member cannot delete, a scoped member sees nothing; the flag off — no route", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth")],
      categoryId: await category(space, "Продукти"),
    });
    expect((await call(other, "DELETE", `/v1/category-rules/${rule.id}`)).statusCode).toBe(404);
    expect(
      (await call(space, "DELETE", `/v1/category-rules/${rule.id}`, undefined, { role: "viewer" }))
        .statusCode,
    ).toBe(403);
    expect((await call(space, "DELETE", `/v1/category-rules/${rule.id}`, undefined, SCOPED)).statusCode).toBe(
      403,
    );
    expect((await call(space, "GET", "/v1/category-rules", undefined, SCOPED)).statusCode).toBe(404);
    off.add("categorization.rules");
    expect((await call(space, "DELETE", `/v1/category-rules/${rule.id}`)).statusCode).toBe(404);
    off.clear();
    expect((await call(space, "GET", "/v1/category-rules")).json().items).toHaveLength(1);
  });
});

describe("BUD-14@PoC FR 5: the tags action", () => {
  it("BUD-14@PoC FR 5: «Додатково» → «Теги» are saved with the rule, changed by «Змінити правило»; invalid tags — 400, nothing saved", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const rule = await createRule(space, {
      conditions: [merchantIs("Adobe")],
      categoryId: groceries,
      tags: [" софт ", "Софт", "робота"],
    });
    expect(rule.tags).toEqual(["софт", "робота"]);
    const patched = await call(space, "PATCH", `/v1/category-rules/${rule.id}`, { tags: ["дім"] });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().tags).toEqual(["дім"]);
    for (const tags of [
      ["x".repeat(61)],
      ["two\nlines"],
      [""],
      Array.from({ length: 21 }, (_, i) => `t${i}`),
    ]) {
      const res = await call(space, "POST", "/v1/category-rules", {
        conditions: [merchantIs("Synth")],
        categoryId: groceries,
        tags,
      });
      expect(res.statusCode, res.body).toBe(400);
    }
    expect((await call(space, "GET", "/v1/category-rules")).json().items).toHaveLength(1);
    const entries = await audit.entriesFor(space.householdId, { type: "categorization.rule", id: rule.id });
    expect(entries[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "tags", before: AUDIT_MASK, after: AUDIT_MASK }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toMatch(/софт|дім/);
  });

  it("BUD-14@PoC AC3: №1 «Мерчант містить Costco → Продукти», №2 «Рахунок = Amex · сума більше за 200 € → тег «великі», Дім»; «Costco» −312,00 € from Amex gets «Продукти» (№1) and the tag «великі» (№2), «Застосовано правила: №1, №2»", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "Синтетичний поточний");
    const amex = await createAccount(space, "Синтетичний Amex");
    const groceries = await category(space, "Продукти");
    const home = await category(space, "Дім");
    const r1 = await createRule(space, { conditions: [merchantIs("Costco")], categoryId: groceries });
    const r2 = await createRule(space, {
      conditions: [{ field: "account", operator: "equals", value: amex }, amountOver("200")],
      categoryId: home,
      tags: ["великі"],
    });
    const t = await purchase(space, amex, "COSTCO WHOLESALE 0042", "-312.00", "2026-10-16");
    const small = await purchase(space, current, "COSTCO WHOLESALE 0042", "-312.00", "2026-10-16");
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({
      categoryId: groceries,
      source: "rule",
      rule: { id: r1.id, position: 1 },
      appliedRules: [
        { id: r1.id, position: 1 },
        { id: r2.id, position: 2 },
      ],
    });
    expect(await tagsOf(space, t)).toEqual(["великі"]);
    expect(await categoryOf(space, small)).toMatchObject({ appliedRules: [{ id: r1.id, position: 1 }] });
    expect(await tagsOf(space, small)).toEqual([]);
    // The system added the tag: the transaction's audit entry is the system's, its tag names masked.
    const entries = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t });
    const tagged = entries.find((e) => e.changes.some((c) => c.field === "tags"));
    expect(tagged).toMatchObject({ actorKind: "system" });
    // Running the job again adds nothing.
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'queued', run_after = now() WHERE household_id = $1
          AND name = 'categorization.transaction-created'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await tagsOf(space, t)).toEqual(["великі"]);
  });

  it("BUD-14@PoC FR 9: a category set by hand is not replaced, yet the rule's tags are added", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const home = await category(space, "Дім");
    const rule = await createRule(space, {
      conditions: [merchantIs("Costco")],
      categoryId: groceries,
      tags: ["опт"],
    });
    const t = await purchase(space, account, "COSTCO WHOLESALE 0042", "-80.00");
    expect(
      (await call(space, "PUT", `/v1/transactions/${t}/category`, { categoryId: home })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await categoryOf(space, t)).toMatchObject({
      categoryId: home,
      source: "manual",
      appliedRules: [{ id: rule.id, position: 1 }],
    });
    expect(await tagsOf(space, t)).toEqual(["опт"]);
  });
});

describe("BUD-14@PoC FR 7: «Застосувати до N наявних транзакцій, що підходять» as one operation", () => {
  it("BUD-14@PoC AC2: 14 «Adobe» by 59,99 € — «Показати» lists 14 on 839,86 €, then «Зберегти правило» with the box applies «Підписки» and the tag «софт» to the 14 at once, «Відмінити» for 7 days", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const subscriptions = await category(space, "Підписки");
    const past = await purchases(space, account, "ADOBE *CREATIVE CLOUD", 12);
    past.push(...(await purchases(space, account, "ADOBE *ACROBAT PRO", 2)));
    const conditions = [merchantIs("Adobe"), amountOver("50")];
    const shown = await call(space, "POST", "/v1/category-rules/matches", { conditions });
    expect(shown.json()).toMatchObject({ count: 14, totals: [{ amount: "-839.86", currency: "EUR" }] });
    const rule = await createRule(space, { conditions, categoryId: subscriptions, tags: ["софт"] });
    const report = await apply(space, rule.id);
    expect(report).toMatchObject({
      ruleId: rule.id,
      status: "completed",
      background: false,
      count: 14,
      processed: 14,
      changed: 14,
      skipped: { manual: 0, unchanged: 0, unavailable: 0 },
      truncated: false,
      undo: { available: true, until: new Date(NOW + 7 * DAY).toISOString(), restored: 0, notRestored: 0 },
    });
    for (const id of past) {
      expect(await categoryOf(space, id)).toMatchObject({
        categoryId: subscriptions,
        source: "rule",
        rule: { id: rule.id, position: 1 },
      });
      expect(await tagsOf(space, id)).toEqual(["софт"]);
    }
    expect(await run(space, report.id)).toEqual(report);
    await runWorker(space.householdId);
    // One entry per transaction's category (the user's), one per transaction's tags, one for the run.
    const one = await audit.entriesFor(space.householdId, {
      type: "categorization.transaction-category",
      id: past[0]!,
    });
    expect(one).toEqual([
      expect.objectContaining({ actorKind: "user", actorId: space.accountId, action: "update" }),
    ]);
    const runEntries = await audit.entriesFor(space.householdId, {
      type: "categorization.rule-run",
      id: report.id,
    });
    expect(runEntries).toHaveLength(1);
    expect(runEntries[0]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "ruleId", after: rule.id }),
        expect.objectContaining({ field: "changed", after: "14" }),
      ]),
    );
    // The categories as module budget reads them: the past months count the 14 under «Підписки».
    const { rows } = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.transaction_categories WHERE household_id = $1 AND category_id = $2`,
      [space.householdId, subscriptions],
    );
    expect(Number(rows[0].n)).toBe(14);
  });

  it("BUD-14@PoC AC15: «Мерчант дорівнює Shell» and «Сума більше за 40 €» → «Пальне», «Застосувати до 9» — the 9 get «Пальне» and can be undone; without the box they do not change", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const fuel = await category(space, "Пальне");
    const shell = await purchases(space, account, "SHELL", 9, "-45.10");
    const cheap = await purchase(space, account, "SHELL", "-12.00", "2026-10-01");
    const conditions = [merchantIs("Shell", "equals"), amountOver("40")];
    const rule = await createRule(space, { conditions, categoryId: fuel });
    for (const id of shell) expect((await categoryOf(space, id)).source).toBe("none");
    const report = await apply(space, rule.id);
    expect(report).toMatchObject({ count: 9, changed: 9, status: "completed" });
    for (const id of shell) expect(await categoryOf(space, id)).toMatchObject({ categoryId: fuel });
    expect((await categoryOf(space, cheap)).source).toBe("none");
    const undone = await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {});
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({
      status: "undone",
      undo: { available: false, restored: 9, notRestored: 0 },
    });
    for (const id of shell)
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
  });

  it("BUD-14@PoC AC4: «Продукти» «за правилом №1» changed by hand to «Дім»; the next day rule №1 is changed and applied — the manual category stays, «Пропущено: ручні зміни (1)»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const home = await category(space, "Дім");
    const rule = await createRule(space, { conditions: [merchantIs("Synth Market")], categoryId: groceries });
    const ids = [
      await purchase(space, account, "SYNTH MARKET 01", "-20.00", "2026-10-14"),
      await purchase(space, account, "SYNTH MARKET 02", "-21.00", "2026-10-15"),
      await purchase(space, account, "SYNTH MARKET 03", "-22.00", "2026-10-16"),
    ];
    await runWorker(space.householdId);
    expect(await categoryOf(space, ids[0]!)).toMatchObject({ source: "rule", rule: { position: 1 } });
    expect(
      (await call(space, "PUT", `/v1/transactions/${ids[0]}/category`, { categoryId: home })).statusCode,
    ).toBe(200);
    now = NOW + DAY;
    await call(space, "PATCH", `/v1/category-rules/${rule.id}`, { tags: ["щодня"] });
    const report = await apply(space, rule.id);
    expect(report).toMatchObject({
      count: 3,
      changed: 3,
      skipped: { manual: 1, unchanged: 0, unavailable: 0 },
    });
    expect(await categoryOf(space, ids[0]!)).toMatchObject({ categoryId: home, source: "manual" });
    // FR 9: the other action of the rule (tags) still applies to the transaction changed by hand.
    expect(await tagsOf(space, ids[0]!)).toEqual(["щодня"]);
    expect(await categoryOf(space, ids[1]!)).toMatchObject({ categoryId: groceries, source: "rule" });
  });

  it("BUD-14@PoC AC5, EC1: a rule that would change 1 200 past transactions — the first 500 at once, the rest in the background with «Оброблено X з N»; «Відмінити» runs in the background too", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const subscriptions = await category(space, "Підписки");
    const seed = await purchase(space, account, "SYNTH STREAM 77", "-9.99", "2026-10-16");
    await copies(space.householdId, seed, 1199);
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Stream")],
      categoryId: subscriptions,
    });
    const report = await apply(space, rule.id);
    expect(report).toMatchObject({
      status: "running",
      background: true,
      count: 1200,
      processed: 500,
      changed: 500,
    });
    expect((await run(space, report.id)).processed).toBe(500);
    // Another run in the space waits for this one.
    const second = await call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {});
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json().code).toBe("RULE_RUN_RUNNING");
    expect((await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {})).json().code).toBe(
      "RULE_RUN_RUNNING",
    );
    await runWorker(space.householdId);
    expect(await run(space, report.id)).toMatchObject({
      status: "completed",
      processed: 1200,
      changed: 1200,
    });
    const { rows } = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.transaction_categories
        WHERE household_id = $1 AND category_id = $2 AND rule_id = $3`,
      [space.householdId, subscriptions, rule.id],
    );
    expect(Number(rows[0].n)).toBe(1200);

    const undo = await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toMatchObject({ status: "undoing", undo: { restored: 500 } });
    await runWorker(space.householdId);
    expect(await run(space, report.id)).toMatchObject({
      status: "undone",
      undo: { restored: 1200, notRestored: 0 },
    });
    const left = await db.owner.query(
      `SELECT count(*) AS n FROM categorization.transaction_categories WHERE household_id = $1 AND category_id = $2`,
      [space.householdId, subscriptions],
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it("BUD-14@PoC AC6: the run ended 8 days ago — «Відмінити» is refused with «Час для відміни минув»; an undone run — «Запуск уже відмінено»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Cafe")],
      categoryId: await category(space, "Продукти"),
    });
    await purchase(space, account, "SYNTH CAFE", "-4.50");
    const old = await apply(space, rule.id);
    now = NOW + 8 * DAY;
    expect((await run(space, old.id)).undo).toMatchObject({ available: false });
    const late = await call(space, "POST", `/v1/category-rule-runs/${old.id}/undo`, {});
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json().code).toBe("RULE_RUN_UNDO_EXPIRED");

    const fresh = await apply(space, rule.id);
    expect((await call(space, "POST", `/v1/category-rule-runs/${fresh.id}/undo`, {})).statusCode).toBe(200);
    const again = await call(space, "POST", `/v1/category-rule-runs/${fresh.id}/undo`, {});
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().code).toBe("RULE_RUN_UNDONE");
  });

  it("BUD-14@PoC EC5: a transaction changed after the run — «Відмінити» keeps that change and reports it as not restored; the others get their values back", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const home = await category(space, "Дім");
    const ids = [
      await purchase(space, account, "SYNTH DELI 1", "-10.00", "2026-10-13"),
      await purchase(space, account, "SYNTH DELI 2", "-11.00", "2026-10-14"),
      await purchase(space, account, "SYNTH DELI 3", "-12.00", "2026-10-15"),
    ];
    // The third had a tag of its own before the run.
    await call(space, "PATCH", `/v1/transactions/${ids[2]}/attributes`, { tags: ["свій"] });
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Deli")],
      categoryId: groceries,
      tags: ["делі"],
    });
    const report = await apply(space, rule.id);
    expect(report.changed).toBe(3);
    // After the run: the first's category changed by hand, the second's tags changed by hand.
    await call(space, "PUT", `/v1/transactions/${ids[0]}/category`, { categoryId: home });
    await call(space, "PATCH", `/v1/transactions/${ids[1]}/attributes`, { tags: ["делі", "моє"] });
    const undone = await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {});
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({ status: "undone", undo: { restored: 1, notRestored: 2 } });
    expect(await categoryOf(space, ids[0]!)).toMatchObject({ categoryId: home, source: "manual" });
    expect(await tagsOf(space, ids[0]!)).toEqual([]);
    expect(await categoryOf(space, ids[1]!)).toMatchObject({ categoryId: null, source: "none" });
    expect(await tagsOf(space, ids[1]!)).toEqual(["делі", "моє"]);
    expect(await categoryOf(space, ids[2]!)).toMatchObject({ categoryId: null, source: "none" });
    expect(await tagsOf(space, ids[2]!)).toEqual(["свій"]);
    await runWorker(space.householdId);
    const entries = await audit.entriesFor(space.householdId, {
      type: "categorization.rule-run",
      id: report.id,
    });
    expect(entries.map((e) => e.action)).toEqual(["create", "update"]);
  });

  it("BUD-14@PoC FR 10: a rule that needs attention is not applied to the existing transactions", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const res = await call(space, "GET", "/v1/categories");
    const group = (res.json().groups as { id: string; name: string }[]).find((g) => g.name === "Харчування")!;
    const coffee = (await call(space, "POST", "/v1/categories", { groupId: group.id, name: "Кава" })).json()
      .id as string;
    const rule = await createRule(space, { conditions: [merchantIs("Synth Coffee")], categoryId: coffee });
    await purchase(space, account, "SYNTH COFFEE", "-3.20");
    expect((await call(space, "DELETE", `/v1/categories/${coffee}`)).statusCode).toBeLessThan(300);
    const refused = await call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {});
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe("RULE_NEEDS_ATTENTION");
  });
});

describe("Concurrency: two simultaneous runs and undos of one space", () => {
  it("BUD-14@PoC FR 7: two «Застосувати» at once change each transaction once; two «Відмінити» at once restore once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const ids = await purchases(space, account, "SYNTH GROCER", 6, "-15.00");
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Grocer")],
      categoryId: groceries,
      tags: ["їжа"],
    });
    const both = await Promise.all([
      call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {}),
      call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {}),
    ]);
    const ok = both.filter((r) => r.statusCode === 201).map((r) => r.json() as RunBody);
    for (const r of both) expect([201, 409], r.body).toContain(r.statusCode);
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.reduce((n, r) => n + r.changed, 0)).toBe(6);
    for (const id of ids) {
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: groceries });
      expect(await tagsOf(space, id)).toEqual(["їжа"]);
    }
    const changedRun = ok.find((r) => r.changed === 6)!;
    const undos = await Promise.all([
      call(space, "POST", `/v1/category-rule-runs/${changedRun.id}/undo`, {}),
      call(space, "POST", `/v1/category-rule-runs/${changedRun.id}/undo`, {}),
    ]);
    expect(undos.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(undos.find((r) => r.statusCode === 200)!.json().undo.restored).toBe(6);
    for (const id of ids) {
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
      expect(await tagsOf(space, id)).toEqual([]);
    }
    await runWorker(space.householdId);
    for (const id of ids)
      expect(
        await audit.entriesFor(space.householdId, { type: "categorization.transaction-category", id }),
      ).toHaveLength(2);
  });
});

describe("BUD-14@PoC «Права доступу» of the runs", () => {
  it("BUD-14@PoC «Права доступу»: a run of another space is not found; a viewer reads but cannot apply or undo; a scoped member cannot apply and sees nothing; the flag off — no route", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Kiosk")],
      categoryId: await category(space, "Продукти"),
    });
    await purchase(space, account, "SYNTH KIOSK", "-2.00");
    expect((await call(other, "POST", `/v1/category-rules/${rule.id}/apply`, {})).statusCode).toBe(404);
    expect(
      (await call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {}, { role: "viewer" })).statusCode,
    ).toBe(403);
    expect((await call(space, "POST", `/v1/category-rules/${rule.id}/apply`, {}, SCOPED)).statusCode).toBe(
      403,
    );
    const report = await apply(space, rule.id);
    expect((await call(other, "GET", `/v1/category-rule-runs/${report.id}`)).statusCode).toBe(404);
    expect((await call(other, "POST", `/v1/category-rule-runs/${report.id}/undo`, {})).statusCode).toBe(404);
    expect(
      (await call(space, "GET", `/v1/category-rule-runs/${report.id}`, undefined, { role: "viewer" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {}, { role: "viewer" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(space, "GET", `/v1/category-rule-runs/${report.id}`, undefined, SCOPED)).statusCode,
    ).toBe(404);
    expect((await call(space, "GET", "/v1/category-rule-runs", undefined, SCOPED)).statusCode).toBe(404);
    off.add("categorization.rules");
    expect((await call(space, "GET", `/v1/category-rule-runs/${report.id}`)).statusCode).toBe(404);
    expect((await call(space, "POST", `/v1/category-rule-runs/${report.id}/undo`, {})).statusCode).toBe(404);
  });
});

describe("ARC-04@PoC FR 2–4: a background part that dies and the daily recovery (#249)", () => {
  it("ARC-04@PoC FR 4: the background part of a run is dead — nothing more is processed until the daily recovery puts it back, then the run completes once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const seed = await purchase(space, account, "SYNTH BULK 5", "-1.00", "2026-10-16");
    await copies(space.householdId, seed, 599);
    const rule = await createRule(space, { conditions: [merchantIs("Synth Bulk")], categoryId: groceries });
    const report = await apply(space, rule.id);
    expect(report).toMatchObject({ status: "running", processed: 500 });
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'categorization.rule-run-part' AND state <> 'done'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await run(space, report.id)).toMatchObject({ status: "running", processed: 500 });

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
    expect(await run(space, report.id)).toMatchObject({ status: "completed", processed: 600, changed: 600 });
    expect(
      await audit.entriesFor(space.householdId, { type: "categorization.rule-run", id: report.id }),
    ).toHaveLength(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the runs and their records", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const rule = await createRule(space, {
      conditions: [merchantIs("Synth Erase")],
      categoryId: await category(space, "Продукти"),
    });
    await purchase(space, account, "SYNTH ERASE", "-1.00");
    await apply(space, rule.id);
    await createCategorizationErasure(db.databases.for("categorization")).eraseHousehold(space.householdId);
    for (const table of ["rule_runs", "rule_run_items"]) {
      const left = await db.owner.query(
        `SELECT count(*) AS n FROM categorization.${table} WHERE household_id = $1`,
        [space.householdId],
      );
      expect(Number(left.rows[0].n), table).toBe(0);
    }
  });
});
