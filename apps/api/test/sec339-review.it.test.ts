import { randomUUID } from "node:crypto";
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
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
} from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createCategorizationServices,
  createTransactionCategories,
} from "../src/modules/categorization/index.ts";
import { createBudgetServices } from "../src/modules/budget/index.ts";
import {
  createBudgetTransactions,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransactionReviewBulkActions } from "../src/modules/transactions/index.ts";
import { reviewQueueCount } from "../src/modules/transactions/adapters/db/store.ts";
import type { ModuleDatabase, ModuleQueryRunner } from "../src/platform/db/module-db.ts";

/**
 * BUD-12@PoC a) (wave 2 row 24), through the real API on a real PostgreSQL: «До розбору» — the queue (the list with
 * `review.eq:queued`, oldest first), its counter, «Підтвердити» and «Відмінити» of a card with the version check, and
 * «Підтвердити категорії» of the selection panel and of a merchant's group (bulk action). Every name and amount is
 * synthetic; the session is the test's principal header; the clock is fixed.
 *
 * The queue is filled only by the import of statement files (FR 8; IMP rows of the plan, not built yet): `queue()`
 * stands for it — it marks transactions entered through the API as the import marks every one it adds.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-16";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const FLAG = "transactions.review";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Tx {
  id: string;
  accountId: string;
  amount: { amount: string; currency: string };
  date: string;
  counterparty: string | null;
  review: "queued" | "confirmed" | null;
  version: number;
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
      ...(method === "POST" && url.startsWith("/v1/bulk-actions") && !url.endsWith("/preview")
        ? { "idempotency-key": randomUUID() }
        : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    for (let pass = 0; pass < 10; pass++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
}

async function createAccount(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
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
  extra: { date?: string; counterparty?: string } = {},
): Promise<Tx> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: extra.date ?? "2026-11-10",
    counterparty: extra.counterparty ?? "Синтетичний магазин",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Tx;
}

/** Stands for the import of a statement file (FR 8): each of `ids` is a new imported transaction in the queue. */
async function queue(space: Space, ids: readonly string[]): Promise<void> {
  await db.owner.query(
    `UPDATE transactions.transactions SET review = 'queued' WHERE household_id = $1 AND id = ANY($2::uuid[])`,
    [space.householdId, ids],
  );
}

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Tx;

/** «До розбору»: the queue, oldest first. */
async function queueList(space: Space): Promise<{ count: number; items: Tx[] }> {
  const res = await call(space, "GET", "/v1/transactions?filter=review.eq:queued&sort=date&pageSize=100");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { count: number; items: Tx[] };
}

async function counter(space: Space): Promise<number> {
  const res = await call(space, "GET", "/v1/transaction-review");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().count as number;
}

const confirm = (space: Space, t: { id: string; version: number }, principal = {}) =>
  call(space, "POST", `/v1/transactions/${t.id}/review/confirm`, { version: t.version }, principal);
const reopen = (space: Space, t: { id: string; version: number }) =>
  call(space, "POST", `/v1/transactions/${t.id}/review/reopen`, { version: t.version });

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
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
        }),
        budget: createBudgetServices({
          categories: directory,
          accounts: createAccountList(db.databases.for("accounts")),
          transactions: createBudgetTransactions(db.databases.for("transactions")),
          categorization: createTransactionCategories(db.databases.for("categorization")),
          fx,
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
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

/**
 * Security review of PR #339 (BUD-12@PoC a): the guards of «До розбору» that the PR's own tests do not pin — roles,
 * the flag on the bulk action's start, another space through the bulk action, the SQL's own space filter without the
 * row policy, a merged duplicate, and two requests at once through the bulk action.
 */
const bulk = (space: Space, ids: readonly string[], principal = {}, preview = false) =>
  call(
    space,
    "POST",
    preview ? "/v1/bulk-actions/preview" : "/v1/bulk-actions",
    { action: "transactions.confirm-category", selection: { kind: "ids", ids } },
    principal,
  );

async function queued(space: Space, n = 1): Promise<Tx[]> {
  const account = await createAccount(space);
  const out: Tx[] = [];
  for (let i = 0; i < n; i++) out.push(await add(space, account, `-${i + 1}.00`));
  await queue(
    space,
    out.map((t) => t.id),
  );
  return out;
}

/** The module's SQL on the owner's connection (no row policy), rolled back. */
async function withoutRowPolicy<T>(
  run: (q: ModuleQueryRunner, db: ModuleDatabase) => Promise<T>,
): Promise<T> {
  await db.owner.query("BEGIN");
  try {
    await db.owner.query(`SET LOCAL search_path TO transactions, public`);
    const q = {
      query: (text: string, values?: readonly unknown[]) => db.owner.query(text, values as unknown[]),
    } as unknown as ModuleQueryRunner;
    const fake = {
      inHousehold: (_h: string, fn: (q: ModuleQueryRunner) => unknown) => fn(q),
    } as unknown as ModuleDatabase;
    return await run(q, fake);
  } finally {
    await db.owner.query("ROLLBACK");
  }
}

describe("sec339: «До розбору» — roles", () => {
  it("sec339: a viewer reads the counter but cannot confirm, reopen or run «Підтвердити категорії»; nothing changes", async () => {
    const space = await newSpace();
    const [t] = await queued(space);
    const viewer = { role: "viewer" };
    const count = await call(space, "GET", "/v1/transaction-review", undefined, viewer);
    expect(count.statusCode, count.body).toBe(200);
    expect((await confirm(space, t!, viewer)).statusCode).toBe(403);
    expect(
      (await call(space, "POST", `/v1/transactions/${t!.id}/review/reopen`, { version: 1 }, viewer))
        .statusCode,
    ).toBe(403);
    expect((await bulk(space, [t!.id], viewer)).statusCode).toBe(403);
    expect((await bulk(space, [t!.id], viewer, true)).statusCode).toBe(403);
    expect(await get(space, t!.id)).toMatchObject({ review: "queued", version: 1 });
  });

  it("sec339: a scoped member cannot run «Підтвердити категорії» (start or preview); nothing changes", async () => {
    const space = await newSpace();
    const [t] = await queued(space);
    for (const role of ["editor", "admin"]) {
      const scoped = { role, scoped: true };
      expect([403, 404]).toContain((await bulk(space, [t!.id], scoped)).statusCode);
      expect([403, 404]).toContain((await bulk(space, [t!.id], scoped, true)).statusCode);
      expect([403, 404]).toContain((await confirm(space, t!, scoped)).statusCode);
    }
    expect(await get(space, t!.id)).toMatchObject({ review: "queued", version: 1 });
  });
});

describe("sec339: «До розбору» — the release flag on every path", () => {
  it("sec339: with `transactions.review` off the bulk action is unknown on start and on preview (400), and writes nothing", async () => {
    const space = await newSpace();
    const [t] = await queued(space);
    off.add(FLAG);
    const started = await bulk(space, [t!.id]);
    expect(started.statusCode, started.body).toBe(400);
    expect(started.json()).toMatchObject({ errors: [{ in: "body", path: "action", issue: "unknown" }] });
    expect((await bulk(space, [t!.id], {}, true)).statusCode).toBe(400);
    expect(await get(space, t!.id)).toMatchObject({ review: "queued", version: 1 });
  });
});

describe("sec339: «До розбору» — another space", () => {
  it("sec339: another space's ids in «Підтвердити категорії» — not found alone, «unavailable» among mine; reopen is 404; theirs unchanged", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const [own] = await queued(mine);
    const [foreign] = await queued(theirs);
    expect((await bulk(mine, [foreign!.id])).statusCode).toBe(404);
    expect((await bulk(mine, [foreign!.id], {}, true)).statusCode).toBe(404);
    const mixed = await bulk(mine, [own!.id, foreign!.id]);
    expect(mixed.statusCode, mixed.body).toBe(201);
    expect(mixed.json()).toMatchObject({ changed: 1, skipped: { unavailable: 1 } });
    expect((await reopen(mine, { id: foreign!.id, version: 1 })).statusCode).toBe(404);
    // A wrong version of another space's card is «not found» too — no version leaks.
    const stale = await confirm(mine, { id: foreign!.id, version: 7 });
    expect(stale.statusCode).toBe(404);
    expect(stale.body).not.toContain("currentVersion");
    expect(await get(theirs, foreign!.id)).toMatchObject({ review: "queued", version: 1 });
    expect(await counter(theirs)).toBe(1);
  });

  it("sec339: the SQL of the counter and of the bulk target filters by the space itself (without the row policy)", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const [foreign] = await queued(theirs);
    await withoutRowPolicy(async (q, fake) => {
      expect(await reviewQueueCount(q, mine.householdId)).toBe(0);
      expect(await reviewQueueCount(q, theirs.householdId)).toBe(1);
      const { targets, actions } = createTransactionReviewBulkActions({
        db: fake,
        flags: { isEnabled: async () => true },
      });
      const caller = { householdId: mine.householdId, actorId: mine.accountId, scoped: false };
      expect((await targets[0]!.read(caller, [foreign!.id])).size).toBe(0);
      expect(await targets[0]!.write(caller, foreign!.id, 1, { review: "confirmed" })).toEqual({
        kind: "unavailable",
      });
      // The plan's own query (merged duplicates) must not see theirs either.
      await q.query(
        `UPDATE transactions SET hidden = true, merged_into = $2 WHERE household_id = $1 AND id = $3`,
        [theirs.householdId, randomUUID(), foreign!.id] /* no FK on merged_into */,
      );
      const plans = await actions[0]!.plan(
        caller,
        [{ id: foreign!.id, version: 1, values: { review: "queued" } }],
        undefined,
      );
      expect(plans.get(foreign!.id)).toEqual({ kind: "change", after: { review: "confirmed" } });
    });
    expect(await get(theirs, foreign!.id)).toMatchObject({ review: "queued", version: 1 });
  });
});

describe("sec339: «До розбору» — the bulk target's write guards", () => {
  it("sec339: the target refuses a scoped caller, a value outside the queue's states, a row never queued, a stale version and a merged duplicate", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const manual = await add(space, account, "-1.00");
    const inQueue = await add(space, account, "-2.00");
    const merged = await add(space, account, "-3.00");
    await queue(space, [inQueue.id, merged.id]);
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true, merged_into = $2 WHERE household_id = $1 AND id = $3`,
      [space.householdId, inQueue.id, merged.id],
    );
    const { targets } = createTransactionReviewBulkActions({ db: db.databases.for("transactions") });
    const target = targets[0]!;
    const caller = { householdId: space.householdId, actorId: space.accountId, scoped: false };
    expect(await target.write({ ...caller, scoped: true }, inQueue.id, 1, { review: "confirmed" })).toEqual({
      kind: "unavailable",
    });
    expect((await target.read({ ...caller, scoped: true }, [inQueue.id])).size).toBe(0);
    expect(await target.select({ ...caller, scoped: true }, ["review.eq:queued"], [], 500)).toEqual({
      ids: [],
      count: 0,
    });
    expect((await target.write(caller, inQueue.id, 1, { review: null })).kind).toBe("invalid");
    expect((await target.write(caller, inQueue.id, 1, { review: "anything" })).kind).toBe("invalid");
    expect(await target.write(caller, manual.id, 1, { review: "queued" })).toEqual({
      kind: "invalid",
      issue: "transaction.not_in_review",
    });
    expect(await target.write(caller, inQueue.id, 5, { review: "confirmed" })).toEqual({ kind: "conflict" });
    expect(await target.write(caller, merged.id, 1, { review: "confirmed" })).toEqual({
      kind: "invalid",
      issue: "transaction.merged",
    });
    expect(await get(space, manual.id)).toMatchObject({ review: null, version: 1 });
    expect(await get(space, inQueue.id)).toMatchObject({ review: "queued", version: 1 });
    // The card's own routes refuse the merged duplicate too.
    const res = await confirm(space, { id: merged.id, version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TRANSACTION_MERGED");
    // Without the flag runtime the action is off.
    const { actions } = createTransactionReviewBulkActions({ db: db.databases.for("transactions") });
    expect(await actions[0]!.enabled!(caller)).toBe(false);
  });
});

describe("sec339: «До розбору» — two requests at once through the bulk action", () => {
  it("sec339: two «Підтвердити категорії» of the same cards at once — each card is confirmed once (version 2)", async () => {
    const space = await newSpace();
    const cards = await queued(space, 3);
    const ids = cards.map((t) => t.id);
    const [a, b] = await Promise.all([bulk(space, ids), bulk(space, ids)]);
    // The second is refused while the first runs (409 BULK_ACTION_RUNNING) or runs after it and finds nothing to do.
    const done = [a, b].filter((r) => r.statusCode === 201);
    expect(done.length, `${a.body} ${b.body}`).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) expect([201, 409]).toContain(r.statusCode);
    for (const id of ids) expect(await get(space, id)).toMatchObject({ review: "confirmed", version: 2 });
    expect(await counter(space)).toBe(0);
  });

  it("sec339: the card's «Підтвердити» and the panel's at once — one write, one version; the bulk target's write alone is under the row's lock", async () => {
    const space = await newSpace();
    const [t] = await queued(space);
    const [one, many] = await Promise.all([confirm(space, t!), bulk(space, [t!.id])]);
    expect([200, 409]).toContain(one.statusCode);
    expect(many.statusCode, many.body).toBe(201);
    expect(await get(space, t!.id)).toMatchObject({ review: "confirmed", version: 2 });
    // Two writes of the target on the same version at once: exactly one changes the row.
    const [u] = await queued(space);
    const { targets } = createTransactionReviewBulkActions({ db: db.databases.for("transactions") });
    const caller = { householdId: space.householdId, actorId: space.accountId, scoped: false };
    const writes = await Promise.all(
      Array.from({ length: 6 }, () => targets[0]!.write(caller, u!.id, 1, { review: "confirmed" })),
    );
    expect(writes.filter((w) => w.kind === "changed")).toHaveLength(1);
    expect(writes.filter((w) => w.kind === "conflict")).toHaveLength(5);
    expect(await get(space, u!.id)).toMatchObject({ review: "confirmed", version: 2 });
  });
});

describe("sec339: «До розбору» — the counter", () => {
  it("sec339: a hidden transaction of the queue (a merged duplicate) is not counted", async () => {
    const space = await newSpace();
    const [kept, copy] = await queued(space, 2);
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true, merged_into = $2 WHERE household_id = $1 AND id = $3`,
      [space.householdId, kept!.id, copy!.id],
    );
    expect(await counter(space)).toBe(1);
    expect((await queueList(space)).count).toBe(1);
  });
});
