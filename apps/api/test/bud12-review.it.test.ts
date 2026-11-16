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

const reviewEntries = async (space: Space, id: string) =>
  (await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })).filter((e) =>
    e.changes.some((c) => c.field === "review"),
  );

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

/** Twelve purchases of the import, the oldest first (1–12 November), all in the queue. */
async function twelveImported(space: Space): Promise<Tx[]> {
  const account = await createAccount(space);
  const added: Tx[] = [];
  for (let i = 12; i >= 1; i--)
    added.push(
      await add(space, account, `-${i}.40`, {
        date: `2026-11-${String(i).padStart(2, "0")}`,
        counterparty: i === 1 ? "Starbucks" : `Синтетичний мерчант ${i}`,
      }),
    );
  await queue(
    space,
    added.map((t) => t.id),
  );
  return added.reverse();
}

describe("BUD-12@PoC FR 2: the queue «До розбору» and its counter", () => {
  it("BUD-12@PoC AC1 (server part): 12 imported transactions — the queue has them oldest first with merchant, amount, date, account and the proposed category; progress «0 з 12»", async () => {
    const space = await newSpace();
    const added = await twelveImported(space);
    await setCategory(space, added[0]!.id, "Кафе і ресторани");
    const q = await queueList(space);
    expect(q.count).toBe(12);
    expect(await counter(space)).toBe(12);
    expect(q.items.map((t) => t.id)).toEqual(added.map((t) => t.id));
    expect(q.items[0]).toMatchObject({
      counterparty: "Starbucks",
      amount: { amount: "-1.4", currency: "EUR" },
      date: "2026-11-01",
      accountId: added[0]!.accountId,
      review: "queued",
      version: 1,
    });
    // The card's proposed category is the transaction's category (module categorization).
    const cat = await call(space, "GET", `/v1/transactions/${added[0]!.id}/category`);
    expect(cat.json().categoryId).toBe(await category(space, "Кафе і ресторани"));
  });

  it("BUD-12@PoC AC9: an empty queue has no counter (0) and no number; with 7 in the queue the counter is 7", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    expect(await counter(space)).toBe(0);
    const added: Tx[] = [];
    for (let i = 0; i < 9; i++) added.push(await add(space, account, `-${i + 1}.00`));
    expect(await counter(space)).toBe(0);
    await queue(
      space,
      added.slice(0, 7).map((t) => t.id),
    );
    expect(await counter(space)).toBe(7);
    expect((await queueList(space)).count).toBe(7);
  });

  it("BUD-12@PoC EC2: no transactions in the queue — an empty queue («Усе розібрано»)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-3.00");
    await queue(space, [t.id]);
    expect((await confirm(space, t)).statusCode).toBe(200);
    expect(await queueList(space)).toMatchObject({ count: 0, items: [] });
    expect(await counter(space)).toBe(0);
  });

  it("BUD-12@PoC FR 10: one queue per space — another space's transactions are neither counted nor confirmed; a scoped member sees none", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const [t] = await twelveImported(space);
    expect(await counter(other)).toBe(0);
    expect((await queueList(other)).count).toBe(0);
    expect((await confirm(other, t!)).statusCode).toBe(404);
    expect((await get(space, t!.id)).review).toBe("queued");
    const scoped = await call(space, "GET", "/v1/transaction-review", undefined, {
      role: "member",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect((await confirm(space, t!, { role: "member", scoped: true })).statusCode).toBe(403);
    expect((await get(space, t!.id)).review).toBe("queued");
  });

  it("BUD-12@PoC: «Розбір транзакцій» is behind the release flag `transactions.review`", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-3.00");
    await queue(space, [t.id]);
    off.add(FLAG);
    expect((await call(space, "GET", "/v1/transaction-review")).statusCode).toBe(404);
    expect((await confirm(space, t)).statusCode).toBe(404);
    expect((await reopen(space, t)).statusCode).toBe(404);
    const bulk = await call(space, "POST", "/v1/bulk-actions/preview", {
      action: "transactions.confirm-category",
      selection: { kind: "ids", ids: [t.id] },
    });
    expect(bulk.statusCode).not.toBe(200);
    expect((await get(space, t.id)).review).toBe("queued");
  });
});

describe("BUD-12@PoC FR 4–7: «Підтвердити», «Пропустити» and «Відмінити» on a card", () => {
  it("BUD-12@PoC AC2: «Підтвердити» — the category is confirmed (author and time in the audit log), the transaction leaves the queue, «До розбору · 11», the next card", async () => {
    const space = await newSpace();
    const added = await twelveImported(space);
    const first = added[0]!;
    const res = await confirm(space, first);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: first.id, review: "confirmed", version: 2 });
    expect(await counter(space)).toBe(11);
    const q = await queueList(space);
    expect(q.count).toBe(11);
    expect(q.items[0]!.id).toBe(added[1]!.id);
    const [entry, ...rest] = await reviewEntries(space, first.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      actorKind: "user",
      actorId: space.accountId,
      action: "update",
      changes: [{ field: "review", before: "queued", after: "confirmed", sensitive: false }],
    });
    expect(Date.parse(entry!.occurredAt)).not.toBeNaN();
    // The journal is not touched: the balance is the same.
    expect((await get(space, first.id)).amount).toEqual(first.amount);
  });

  it("BUD-12@PoC AC3 (server part): «Пропустити» changes nothing; «Відмінити» returns the last card with its previous state — back in the queue", async () => {
    const space = await newSpace();
    const added = await twelveImported(space);
    const [confirmed, skipped] = [added[0]!, added[1]!];
    const done = (await confirm(space, confirmed)).json() as Tx;
    // «Пропустити» of the next card is the client's: the transaction keeps its state and version.
    expect(await get(space, skipped.id)).toMatchObject({ review: "queued", version: 1 });
    const undone = await reopen(space, done);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({ review: "queued", version: 3 });
    expect(await counter(space)).toBe(12);
    expect((await queueList(space)).items[0]!.id).toBe(confirmed.id);
    const entries = await reviewEntries(space, confirmed.id);
    expect(entries.map((e) => e.changes.find((c) => c.field === "review"))).toEqual([
      expect.objectContaining({ before: "queued", after: "confirmed" }),
      expect.objectContaining({ before: "confirmed", after: "queued" }),
    ]);
    // A queued card's «Відмінити» changes nothing more.
    const again = await reopen(space, undone.json() as Tx);
    expect(again.json()).toMatchObject({ review: "queued", version: 3 });
    expect(await reviewEntries(space, confirmed.id)).toHaveLength(2);
  });

  it("BUD-12@PoC AC5: the transaction was changed in another window — «Підтвердити» on the stale card is refused with the current version; the card reloads", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const shell = await add(space, account, "-52.10", { counterparty: "Shell" });
    await queue(space, [shell.id]);
    const elsewhere = await call(space, "PATCH", `/v1/transactions/${shell.id}`, {
      description: "інше вікно",
    });
    expect(elsewhere.statusCode, elsewhere.body).toBe(200);
    const stale = await confirm(space, shell);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 2 });
    const fresh = await get(space, shell.id);
    expect(fresh).toMatchObject({ review: "queued", version: 2 });
    expect(await reviewEntries(space, shell.id)).toEqual([]);
    expect((await confirm(space, fresh)).statusCode).toBe(200);
  });

  it("BUD-12@PoC AC6: a confirmed transaction's category changed — it does not return to the queue, the change is in the audit log, the budget's sums are recounted", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const cafes = await category(space, "Кафе і ресторани");
    const groceries = await category(space, "Продукти");
    const budget = await call(space, "POST", "/v1/budget", { firstPeriod: "2026-11" });
    expect(budget.statusCode, budget.body).toBe(201);
    const t = await add(space, account, "-45.00", { counterparty: "Синтетична кав'ярня" });
    await setCategory(space, t.id, "Кафе і ресторани");
    await queue(space, [t.id]);
    expect((await confirm(space, t)).statusCode).toBe(200);
    const spent = async (categoryId: string) => {
      const view = (await call(space, "GET", "/v1/budget/periods/2026-11")).json() as {
        outsidePlan: { categories: { categoryId: string; spent: unknown }[] };
      };
      return view.outsidePlan.categories.find((c) => c.categoryId === categoryId)?.spent ?? null;
    };
    expect(await spent(cafes)).toEqual({ amount: "45", currency: "EUR" });

    await setCategory(space, t.id, "Продукти");
    expect((await get(space, t.id)).review).toBe("confirmed");
    expect(await counter(space)).toBe(0);
    const changed = await audit.entriesFor(space.householdId, {
      type: "categorization.transaction-category",
      id: t.id,
    });
    expect(changed.at(-1)!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "categoryId", before: cafes, after: groceries }),
      ]),
    );
    expect(await spent(cafes)).toBeNull();
    expect(await spent(groceries)).toEqual({ amount: "45", currency: "EUR" });
    // A change of the transaction itself after the confirmation does not return it either.
    const edited = await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      amount: { amount: "-47.00", currency: "EUR" },
    });
    expect(edited.json().review).toBe("confirmed");
  });

  it("BUD-12@PoC AC7: an expense entered by hand does not go into «До розбору»; it cannot be confirmed there", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-12.00");
    expect(t.review).toBeNull();
    expect(await counter(space)).toBe(0);
    expect((await queueList(space)).count).toBe(0);
    const res = await confirm(space, t);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TRANSACTION_NOT_IN_REVIEW");
    expect((await reopen(space, t)).json().code).toBe("TRANSACTION_NOT_IN_REVIEW");
  });
});

describe("BUD-12@PoC FR 12, FR 14: «Підтвердити категорії» — the selection panel and a merchant's group", () => {
  const confirmAll = (space: Space, selection: unknown, preview = false) =>
    call(space, "POST", preview ? "/v1/bulk-actions/preview" : "/v1/bulk-actions", {
      action: "transactions.confirm-category",
      selection,
    });

  it("BUD-12@PoC FR 12: «Дії з вибраними» → «Підтвердити категорії» confirms the queued ones in one group audit entry; «Відмінити» puts them back", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const manual = await add(space, account, "-9.00");
    const added = [await add(space, account, "-1.00"), await add(space, account, "-2.00")];
    await queue(
      space,
      added.map((t) => t.id),
    );
    const selection = { kind: "ids", ids: [...added.map((t) => t.id), manual.id] };
    expect((await confirmAll(space, selection, true)).json()).toMatchObject({
      count: 3,
      changes: 2,
      skipped: { unchanged: 1 },
    });
    const started = await confirmAll(space, selection);
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json()).toMatchObject({ status: "completed", changed: 2 });
    expect(await counter(space)).toBe(0);
    for (const t of added) expect((await get(space, t.id)).review).toBe("confirmed");
    expect((await get(space, manual.id)).review).toBeNull();
    // One group entry with each record's value before and after; no entry per transaction.
    const group = await audit.entriesFor(space.householdId, {
      type: "bulk-actions.action",
      id: started.json().id,
    });
    expect(group).toHaveLength(1);
    expect(JSON.stringify(group[0]!.changes)).toContain("confirmed");
    for (const t of added) expect(await reviewEntries(space, t.id)).toEqual([]);
    const undo = await call(space, "POST", `/v1/bulk-actions/${started.json().id}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(await counter(space)).toBe(2);
  });

  it("BUD-12@PoC AC10 (server part): a group «Shell» of 4 — «Пальне» set and confirmed for all 4 of the group", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const shell: Tx[] = [];
    for (let i = 0; i < 4; i++)
      shell.push(await add(space, account, `-${50 + i}.00`, { counterparty: "Shell" }));
    const other = await add(space, account, "-5.00", { counterparty: "Інший мерчант" });
    await queue(space, [...shell.map((t) => t.id), other.id]);
    const ids = shell.map((t) => t.id);
    const set = await call(space, "POST", "/v1/bulk-actions", {
      action: "transactions.set-category",
      selection: { kind: "ids", ids },
      params: { categoryId: await category(space, "Пальне") },
    });
    expect(set.statusCode, set.body).toBe(201);
    const confirmed = await confirmAll(space, { kind: "ids", ids });
    expect(confirmed.json()).toMatchObject({ status: "completed", changed: 4 });
    for (const id of ids) {
      expect((await get(space, id)).review).toBe("confirmed");
      expect((await call(space, "GET", `/v1/transactions/${id}/category`)).json().categoryId).toBe(
        await category(space, "Пальне"),
      );
    }
    expect((await queueList(space)).items.map((t) => t.id)).toEqual([other.id]);
  });

  it("BUD-12@PoC FR 14: the whole queue is selected by its filter («Вибрати всі M за фільтром»), oldest first", async () => {
    const space = await newSpace();
    await twelveImported(space);
    const res = await confirmAll(space, { kind: "filter", filter: ["review.eq:queued"] });
    expect(res.json()).toMatchObject({ status: "completed", changed: 12 });
    expect(await counter(space)).toBe(0);
  });

  it("BUD-12@PoC FR 7: a card changed after the selection's read is not confirmed over the change (version check)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-4.00");
    await queue(space, [t.id]);
    // The card's confirmation and the panel's run: the second sees the first's version and skips it «без змін».
    expect((await confirm(space, t)).statusCode).toBe(200);
    const res = await confirmAll(space, { kind: "ids", ids: [t.id] });
    expect(res.json()).toMatchObject({ changed: 0, skipped: { unchanged: 1 } });
  });
});

describe("sensitive: two requests at once", () => {
  it("BUD-12@PoC FR 7: two «Підтвердити» of the same card at once — one confirms, the other is a version conflict; one audit entry", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-6.40", { counterparty: "Starbucks" });
    await queue(space, [t.id]);
    const results = await Promise.all([confirm(space, t), confirm(space, t)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json()).toMatchObject({
      code: "VERSION_CONFLICT",
      currentVersion: 2,
    });
    expect(await get(space, t.id)).toMatchObject({ review: "confirmed", version: 2 });
    expect(await reviewEntries(space, t.id)).toHaveLength(1);
    expect(await counter(space)).toBe(0);
  });

  it("BUD-12@PoC FR 6: «Відмінити» and a second «Підтвердити» at once on the same version — one wins, the other conflicts", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await add(space, account, "-6.40");
    await queue(space, [t.id]);
    const done = (await confirm(space, t)).json() as Tx;
    const [a, b] = await Promise.all([reopen(space, done), confirm(space, done)]);
    // The confirmation of a confirmed card changes nothing (200) or, after the reopen, meets its new version (409).
    expect(a.statusCode).toBe(200);
    expect([200, 409]).toContain(b.statusCode);
    expect(await get(space, t.id)).toMatchObject({ review: "queued", version: 3 });
    expect(await reviewEntries(space, t.id)).toHaveLength(2);
    expect(await counter(space)).toBe(1);
  });
});
