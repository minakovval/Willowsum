import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetErasure,
  createBudgetWorkerQueue,
  createBudgetServices,
  type BudgetServices,
} from "../src/modules/budget/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createBudgetTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** BUD-01 FR 12: the budget services the category delete removes limits with (created with the server). */
let budgetServices: BudgetServices;

/**
 * BUD-02@PoC a) (wave 2 row 29), the server part of the module `budget`, through the real API on a real PostgreSQL with
 * the real categories, accounts, transactions, categorization and fx-rates modules: one budget per space, the income
 * plan and limits from the current period on, «Поза планом», the budget's accounts, the snapshot of a finished period,
 * the deletion, the space's boundary and the audit hand-off with its daily recovery (ARC-04, #249). Every name and
 * amount is synthetic; the clock is the test's own (Kyiv).
 */
const WEB = "http://localhost:5173";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
const TODAY = "2026-11-18";
let now = at(TODAY);
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

async function account(space: Space, kind = "current", currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind}`,
    balance: { amount: "5000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
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

async function createBudget(space: Space, body: Record<string, unknown> = {}) {
  const res = await call(space, "POST", "/v1/budget", { firstPeriod: TODAY.slice(0, 7), ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; version: number; [k: string]: unknown };
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const budgetAudit = (householdId: string, entity: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3",
    householdId,
    entity,
    action,
  );

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const lookup = createTransactionLookup(db.databases.for("transactions"));
  const fx = createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx,
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: clock.now })),
            now: clock.now,
          }),
          audit,
          clock,
          newId: randomUUID,
          categories: directory,
          flags: fakeFlags(),
        }),
        categories: createCategoriesServices({
          audit,
          clock,
          newId: randomUUID,
          usage: [createBudgetCategoryUsage(db.databases.for("budget"), () => budgetServices)],
        }),
        categorization: createCategorizationServices({ transactions: lookup, categories: directory, audit }),
        budget: (budgetServices = createBudgetServices({
          planEnabled: async () => true,
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock,
          newId: randomUUID,
        })),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
  now = at(TODAY);
});

// ===== Security review PR #323 (BUD-02 a) =====
describe("sec323: deferred FK, cross-space ids, bounds, concurrent money writes, erasure", () => {
  it("deferred FK budget_accounts → budgets: a row naming no budget, or another space's budget, never commits", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const bBudget = await createBudget(b);
    const bud = db.databases.for("budget");
    const err = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      );
    // A budget id that does not exist: accepted by the statement, refused at commit.
    expect(
      await err(
        bud.inHousehold(a.householdId, (q) =>
          q.query(
            `INSERT INTO budget_accounts (household_id, account_id, budget_id, included) VALUES ($1, $2, $3, false)`,
            [a.householdId, randomUUID(), randomUUID()],
          ),
        ),
      ),
    ).toBe("23503");
    // Another space's budget id under one's own household: the composite key has no such parent (and RLS hides B's).
    expect(
      await err(
        bud.inHousehold(a.householdId, (q) =>
          q.query(
            `INSERT INTO budget_accounts (household_id, account_id, budget_id, included) VALUES ($1, $2, $3, false)`,
            [a.householdId, randomUUID(), bBudget.id],
          ),
        ),
      ),
    ).toBe("23503");
    // B's household under A's binding: the row policy refuses it.
    expect(
      await err(
        bud.inHousehold(a.householdId, (q) =>
          q.query(
            `INSERT INTO budget_accounts (household_id, account_id, budget_id, included) VALUES ($1, $2, $3, false)`,
            [b.householdId, randomUUID(), bBudget.id],
          ),
        ),
      ),
    ).not.toBe("ok");
    // A budget deleted in the same transaction after the row was written: refused at commit too.
    const aBudget = await createBudget(a);
    expect(
      await err(
        bud.inHousehold(a.householdId, async (q) => {
          await q.query(`DELETE FROM budgets WHERE household_id = $1`, [a.householdId]);
          await q.query(
            `INSERT INTO budget_accounts (household_id, account_id, budget_id, included) VALUES ($1, $2, $3, false)`,
            [a.householdId, randomUUID(), aBudget.id],
          );
        }),
      ),
    ).toBe("23503");
    expect(
      await n("budget.budget_accounts WHERE household_id = ANY($1)", [a.householdId, b.householdId]),
    ).toBe(0);
  });

  it("PUT /v1/budget/accounts/{id} with another space's account: 404, nothing written, no audit", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const bAcc = await account(b);
    await createBudget(a);
    const res = await call(a, "PUT", `/v1/budget/accounts/${bAcc}`, { included: false });
    expect(res.statusCode).toBe(404);
    expect(await n("budget.budget_accounts WHERE account_id = $1", bAcc)).toBe(0);
    expect(await budgetAudit(a.householdId, "budget.account", "update")).toBe(0);
  });

  it("limits naming another space's category are refused; removing one is a no-op", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const bCat = await category(b, "Продукти");
    const created = await call(a, "POST", "/v1/budget", {
      firstPeriod: TODAY.slice(0, 7),
      limits: [{ categoryId: bCat, amount: eur("1.00") }],
    });
    expect(created.statusCode).toBe(400);
    const budget = await createBudget(a);
    const res = await call(a, "PATCH", "/v1/budget/plan", {
      version: budget.version,
      limits: [{ categoryId: bCat, amount: null }],
    });
    expect(res.statusCode).toBe(200);
    expect(await n("budget.limits WHERE category_id = $1", bCat)).toBe(0);
  });

  it("input bounds: 21 integer digits, 3 fraction digits, a negative, a foreign currency, 301 limits, a bad period → 400; nothing written", async () => {
    const a = await newSpace();
    const groceries = await category(a, "Продукти");
    for (const amount of ["123456789012345678901", "1.001", "-1", "1e3", " 1"]) {
      const res = await call(a, "POST", "/v1/budget", {
        firstPeriod: TODAY.slice(0, 7),
        incomePlan: eur(amount),
      });
      expect(res.statusCode, amount).toBe(400);
    }
    expect(
      (
        await call(a, "POST", "/v1/budget", {
          firstPeriod: TODAY.slice(0, 7),
          incomePlan: { amount: "1", currency: "UAH" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(a, "POST", "/v1/budget", {
          firstPeriod: TODAY.slice(0, 7),
          limits: Array.from({ length: 301 }, () => ({ categoryId: groceries, amount: eur("1") })),
        })
      ).statusCode,
    ).toBe(400);
    for (const p of ["2027-01", "2026-09", "2026-13", "26-11"]) {
      const res = await call(a, "POST", "/v1/budget", { firstPeriod: p });
      expect(res.statusCode, p).toBe(400);
    }
    expect(await n("budget.budgets WHERE household_id = $1", a.householdId)).toBe(0);
    await createBudget(a);
    for (const p of ["2026-13", "2026-1", "x", "2026-11-01"])
      expect((await call(a, "GET", `/v1/budget/periods/${p}`)).statusCode, p).toBe(400);
  });

  it("two simultaneous saves of the same limit with the same version: one 200, one 409; the stored amount and the audit match the winner", async () => {
    const a = await newSpace();
    const groceries = await category(a, "Продукти");
    const budget = await createBudget(a, { limits: [{ categoryId: groceries, amount: eur("100.00") }] });
    const [r1, r2] = await Promise.all(
      ["200.00", "300.00"].map((v) =>
        call(a, "PATCH", "/v1/budget/plan", {
          version: budget.version,
          limits: [{ categoryId: groceries, amount: eur(v) }],
        }),
      ),
    );
    const codes = [r1!.statusCode, r2!.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const winner = (r1!.statusCode === 200 ? r1 : r2)!.json();
    const { rows } = await db.owner.query<{ amount: string }>(
      `SELECT amount::text AS amount FROM budget.limits WHERE household_id = $1`,
      [a.householdId],
    );
    expect(rows.map((r) => Number(r.amount))).toEqual([Number(winner.limits[0].amount.amount)]);
    expect(await budgetAudit(a.householdId, "budget.limit", "update")).toBe(1);
  });

  it("a limit save and a delete at once leave no orphan limit and one consistent audit trail", async () => {
    const a = await newSpace();
    const groceries = await category(a, "Продукти");
    const budget = await createBudget(a);
    const [p, d] = await Promise.all([
      call(a, "PATCH", "/v1/budget/plan", {
        version: budget.version,
        limits: [{ categoryId: groceries, amount: eur("50.00") }],
      }),
      call(a, "DELETE", "/v1/budget"),
    ]);
    expect(d.statusCode).toBe(200);
    expect([200, 404]).toContain(p.statusCode);
    expect(await n("budget.limits WHERE household_id = $1", a.householdId)).toBe(0);
    expect(await n("budget.budgets WHERE household_id = $1", a.householdId)).toBe(0);
    if (p.statusCode === 200) expect(await budgetAudit(a.householdId, "budget.limit", "delete")).toBe(1);
  });

  it("erasure waits for a running hand-off job; the audit sweep takes its late entry; no budget row remains", async () => {
    const a = await newSpace();
    const groceries = await category(a, "Продукти");
    const original = audit.record.bind(audit);
    // The API's immediate hand-off fails, so the worker has the job to run.
    const spy = vi.spyOn(audit, "record").mockRejectedValue(new Error("injected"));
    await createBudget(a, { limits: [{ categoryId: groceries, amount: eur("10.00") }] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const inJob = new Promise<void>((r) => (started = r));
    spy.mockImplementation(async (h, e) => {
      started();
      await gate;
      return original(h, e);
    });
    const gated = {
      record: async (h: string, e: Parameters<AuditLog["record"]>[1]) => {
        started();
        await gate;
        return original(h, e);
      },
    };
    const w = createWorker({
      queues: [createBudgetWorkerQueue(db.databases.for("budget"), gated)],
      subscriptions: [],
      households: async () => [a.householdId],
    });
    const worker = (async () => {
      try {
        await w.tick();
        await w.idle();
      } finally {
        await w.stop();
      }
    })();
    await inJob;
    let erased = false;
    const erasure = createBudgetErasure(db.databases.for("budget"))
      .eraseHousehold(a.householdId)
      .then((r) => {
        erased = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 300));
    expect(erased).toBe(false);
    release();
    await worker;
    await erasure;
    vi.restoreAllMocks();
    // The worker wrote its entry before the budget step finished: the audit step (and its sweep) runs after it.
    expect(
      await n("audit.entries WHERE household_id = $1 AND entity_type LIKE 'budget.%'", a.householdId),
    ).toBeGreaterThan(0);
    for (const t of ["budgets", "limits", "budget_accounts", "period_snapshots", "jobs", "idempotency_keys"])
      expect(await n(`budget.${t} WHERE household_id = $1`, a.householdId), t).toBe(0);
    await runWorker(a.householdId);
    expect(await n("budget.jobs WHERE household_id = $1", a.householdId)).toBe(0);
  });

  it("ARC-04 FR 2 (M6): a plan change whose immediate audit write fails is still audited by the worker", async () => {
    const a = await newSpace();
    const groceries = await category(a, "Продукти");
    const budget = await createBudget(a);
    vi.spyOn(audit, "record").mockRejectedValue(new Error("injected"));
    const res = await call(a, "PATCH", "/v1/budget/plan", {
      version: budget.version,
      incomePlan: eur("10.00"),
      limits: [{ categoryId: groceries, amount: eur("5.00") }],
    });
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    expect(await budgetAudit(a.householdId, "budget.limit", "create")).toBe(0);
    await runWorker(a.householdId);
    expect(await budgetAudit(a.householdId, "budget.limit", "create")).toBe(1);
    expect(await budgetAudit(a.householdId, "budget.budget", "update")).toBe(1);
  });
});

describe("sec323 non-blocking: a category twice in one PATCH", () => {
  it("a limit set and removed in one request is refused, so the audit never records a stale «before»", async () => {
    const a = await newSpace();
    const g = await category(a, "Продукти");
    const b = await createBudget(a, { limits: [{ categoryId: g, amount: eur("10.00") }] });
    const r = await call(a, "PATCH", "/v1/budget/plan", {
      version: b.version,
      limits: [
        { categoryId: g, amount: eur("20.00") },
        { categoryId: g, amount: null },
      ],
    });
    expect(r.statusCode).toBe(400);
    expect(await budgetAudit(a.householdId, "budget.limit", "update")).toBe(0);
    expect(await budgetAudit(a.householdId, "budget.limit", "delete")).toBe(0);
  });
});
