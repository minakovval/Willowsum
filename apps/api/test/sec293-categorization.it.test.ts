import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  createCategorizationCategoryUsage,
  createCategorizationServices,
} from "../src/modules/categorization/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionLookup,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-01@PoC b) (wave 2 row 20): the category of a transaction through the real API on a real PostgreSQL — «Без
 * категорії», a change by hand of one transaction (AC8), the source (FR 4), the space's tree only (FR 9), a merge moves
 * the transactions (FR 8), «порожня» категорія (FR 12), another space and a scoped member (AC12), the audit hand-off
 * with its daily recovery (ARC-04, #249), and DAT-03's «Змінити категорію» (FR 2, AC1; #272 item 1). Every name and
 * amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

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

// ===== security review of #293: probes =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { personWithSpace, rowCount, withTestErasureDatabases } from "./erasure-helpers.ts";
import { createCategoryBulkActions } from "../src/modules/categorization/index.ts";
import type { ModuleDatabase } from "../src/platform/db/module-db.ts";

/** Marks a transaction as a transfer side or a merged duplicate past the FKs (the facts read only these columns). */
async function forceFacts(householdId: string, id: string, set: "transfer_id" | "merged_into") {
  await db.owner.query("BEGIN");
  await db.owner.query("SET LOCAL session_replication_role = replica");
  await db.owner.query(
    `UPDATE transactions.transactions SET ${set} = gen_random_uuid() WHERE household_id = $1 AND id = $2`,
    [householdId, id],
  );
  await db.owner.query("COMMIT");
}

function bulk() {
  return createCategoryBulkActions({
    db: db.databases.for("categorization"),
    transactions: createTransactionLookup(db.databases.for("transactions")),
    categories: createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID }),
  });
}

describe("security review #293: refusals of a change (BUD-01 FR 6, FR 7; FIN-03 FR 11)", () => {
  it("SEC-293: a transfer side is refused 409 TRANSACTION_IN_TRANSFER, a merged duplicate 409 TRANSACTION_MERGED; nothing written", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const groceries = await category(space, "Продукти");
    const tr = await purchase(space, account, "Синтетичний переказ");
    const dup = await purchase(space, account, "Синтетичний дубль");
    await forceFacts(space.householdId, tr, "transfer_id");
    await forceFacts(space.householdId, dup, "merged_into");
    const a = await setCategory(space, tr, groceries.id);
    expect(a.statusCode).toBe(409);
    expect(a.json().code).toBe("TRANSACTION_IN_TRANSFER");
    const b = await setCategory(space, dup, groceries.id);
    expect(b.statusCode).toBe(409);
    expect(b.json().code).toBe("TRANSACTION_MERGED");
    expect(await rows(space.householdId)).toEqual([]);
  });

  it("SEC-293: a service category («Переказ») and another space's category id are refused 400 VALIDATION_FAILED with no hint", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "Синтетичний маркет");
    const directory = createCategoryDirectory({
      db: db.databases.for("categories"),
      audit,
      newId: randomUUID,
    });
    const transfer = await directory.serviceCategory(space.householdId, "transfer");
    expect((await setCategory(space, t, transfer!.id)).statusCode).toBe(400);
    const foreign = await category(other, "Продукти");
    const res = await setCategory(space, t, foreign.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.body).not.toContain(other.householdId);
    expect(await rows(space.householdId)).toEqual([]);
  });
});

describe("security review #293: the bulk target re-checks at write time (TOCTOU between plan and part)", () => {
  it("SEC-293: write() refuses a transaction split after the plan, another space's id, a category of another space and a scoped caller", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const groceries = await category(space, "Продукти");
    const chem = await category(space, "Побутова хімія");
    const t = await purchase(space, account, "Синтетична крамниця", "-10.00");
    const plain = await purchase(space, account, "Синтетична крамниця", "-11.00");
    const foreign = await purchase(other, otherAccount, "Синтетична крамниця");
    const split = await call(space, "POST", `/v1/transactions/${t}/split`, {
      mode: "categories",
      parts: [
        { categoryId: groceries.id, amount: "-6.00" },
        { categoryId: chem.id, amount: "-4.00" },
      ],
    });
    expect(split.statusCode, split.body).toBe(200);
    const target = bulk().targets[0]!;
    const caller = { householdId: space.householdId, actorId: space.accountId, scoped: false };
    const values = { category: groceries.id, source: "manual" };
    expect(await target.write(caller, t, 0, values)).toEqual({ kind: "invalid", issue: "transaction.split" });
    expect(await target.write(caller, foreign, 0, values)).toEqual({ kind: "unavailable" });
    expect(
      await target.write(caller, plain, 0, {
        category: (await category(other, "Продукти")).id,
        source: "manual",
      }),
    ).toEqual({ kind: "invalid", issue: "category.not_found" });
    expect(await target.write({ ...caller, scoped: true }, plain, 0, values)).toEqual({
      kind: "unavailable",
    });
    expect((await target.read(caller, [foreign, plain])).has(foreign)).toBe(false);
    expect((await target.read({ ...caller, scoped: true }, [plain])).size).toBe(0);
    expect(await rows(space.householdId)).toEqual([]);
    expect(await rows(other.householdId)).toEqual([]);
  });

  it("SEC-293: «Вибрати всі за фільтром» — another space's account filter selects nothing; excluded ids are left out", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const a = await purchase(space, account, "Синтетична крамниця");
    const b = await purchase(space, account, "Синтетична крамниця");
    await purchase(other, otherAccount, "Синтетична крамниця");
    const target = bulk().targets[0]!;
    const caller = { householdId: space.householdId, actorId: space.accountId, scoped: false };
    expect(await target.select(caller, [`accountId.eq:${otherAccount}`], [], 100)).toEqual({
      ids: [],
      count: 0,
    });
    expect(await target.select(caller, ["counterparty.eq:Синтетична крамниця"], [a], 100)).toEqual({
      ids: [b],
      count: 1,
    });
    expect(await target.select({ ...caller, scoped: true }, [], [], 100)).toEqual({ ids: [], count: 0 });
  });

  it("DAT-03@PoC FR 2 (#296 no. 15, M27): «Вибрати всі за фільтром» without a state filter leaves out the hidden transactions, with `hidden.eq:true` it takes them", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const shown = await purchase(space, account, "Синтетична крамниця");
    const hidden = await purchase(space, account, "Синтетична крамниця");
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, hidden],
    );
    const target = bulk().targets[0]!;
    const caller = { householdId: space.householdId, actorId: space.accountId, scoped: false };
    expect(await target.select(caller, [], [], 100)).toEqual({ ids: [shown], count: 1 });
    expect(await target.select(caller, ["hidden.eq:true"], [], 100)).toEqual({ ids: [hidden], count: 1 });
  });
});

describe("security review #293: «categories.merged» moves only the merged category's transactions (BUD-01 FR 8)", () => {
  it("SEC-293: a merge moves the transactions of the merged category only; another category's and another space's stay", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const otherAccount = await createAccount(other);
    const coffee = await addCategory(space, "Синтетична кава");
    const cafes = await category(space, "Кафе і ресторани");
    const groceries = await category(space, "Продукти");
    const moved = await purchase(space, account, "Синтетична кав'ярня");
    const kept = await purchase(space, account, "Синтетичний ринок");
    const foreign = await purchase(other, otherAccount, "Синтетичний ринок");
    const foreignGroceries = await category(other, "Продукти");
    expect((await setCategory(space, moved, coffee.id)).statusCode).toBe(200);
    expect((await setCategory(space, kept, groceries.id)).statusCode).toBe(200);
    expect((await setCategory(other, foreign, foreignGroceries.id)).statusCode).toBe(200);
    expect(
      (await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: cafes.id })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await categoryOf(space, moved)).toMatchObject({ categoryId: cafes.id });
    expect(await categoryOf(space, kept)).toMatchObject({ categoryId: groceries.id });
    expect(await categoryOf(other, foreign)).toMatchObject({ categoryId: foreignGroceries.id });
  });
});

describe("security review #293: row policy of categorization.transaction_categories", () => {
  it("SEC-293: the module role bound to one space sees and changes no row of another, even without a household filter", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(other);
    const t = await purchase(other, account, "Синтетичний маркет");
    expect((await setCategory(other, t, (await category(other, "Продукти")).id)).statusCode).toBe(200);
    const cat: ModuleDatabase = db.databases.for("categorization");
    const seen = await cat.inHousehold(space.householdId, async (q) => {
      const r = await q.query(`SELECT * FROM transaction_categories`);
      const u = await q.query(`UPDATE transaction_categories SET version = version + 1`);
      const d = await q.query(`DELETE FROM jobs`);
      return [r.rowCount, u.rowCount, d.rowCount];
    });
    expect(seen).toEqual([0, 0, 0]);
    await expect(
      cat.inHousehold(space.householdId, (q) =>
        q.query(
          `INSERT INTO transaction_categories (household_id, transaction_id, category_id, source) VALUES ($1, $2, NULL, 'none')`,
          [other.householdId, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
    expect((await rows(other.householdId))[0]).toMatchObject({ version: 1 });
  });
});

describe("security review #293: completeness of the space's erasure (NFR-12 FR 3)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ws-sec293-"));
    return () => rmSync(dir, { recursive: true, force: true });
  });
  const erase = (databases: Pick<typeof db.databases, "for">, accountId: string) =>
    withTestErasureDatabases(db, async (erasureDatabases) => {
      const e = createDataErasure({
        databases,
        erasureDatabases,
        log: localErasureLog({ dir }),
        now: () => NOW,
      });
      const r = await e.request({ accountId });
      return e.run(r.requestId);
    });

  it("SEC-293: a space with a transaction's category and its queued hand-off is erased to the last row", async () => {
    const person = await personWithSpace(db, "sec293-a");
    const tx = (
      await db.owner.query(`SELECT id FROM transactions.transactions WHERE household_id = $1 LIMIT 1`, [
        person.householdId,
      ])
    ).rows[0]!.id as string;
    await db.databases.for("categorization").inHousehold(person.householdId, async (q) => {
      await q.query(
        `INSERT INTO transaction_categories (household_id, transaction_id, category_id, source) VALUES ($1, $2, $3, 'manual')`,
        [person.householdId, tx, randomUUID()],
      );
      await q.query(
        `INSERT INTO jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'categorization.hand-off', 'k', '{}'::jsonb)`,
        [person.householdId],
      );
    });
    expect(await rowCount(db, person.householdId)).toBeGreaterThan(0);
    await erase(db.databases, person.accountId);
    expect(await rowCount(db, person.householdId)).toBe(0);
  });

  // BLOCKING (if failing): categorization is erased before categories, the publisher of «categories.merged». A worker
  // pass between the two steps dispatches the pending event into categorization.jobs of the erased space; the space's
  // record goes last, so no worker or retention pass ever visits that household again.
  it("SEC-293: one worker pass at any moment of the erasure leaves no categorization job of the erased space (publisher before consumer)", async () => {
    // The always-running worker makes one pass just before the step of `at` (the erasure's first use of its pool).
    for (const at of ["transactions", "categorization", "categories", "accounts", "goals"]) {
      const person = await personWithSpace(db, `sec293-${at}`); // seeds a pending categories.merged in the categories outbox
      let passes = 0;
      const real = db.databases.for(at as never);
      let first = true;
      const hooked = new Proxy(real, {
        get(t, p, r) {
          if (p !== "inHousehold") return Reflect.get(t, p, r);
          return async (householdId: string, work: never) => {
            if (first && householdId === person.householdId) {
              first = false;
              passes += 1;
              await runWorker(householdId);
            }
            return t.inHousehold(householdId, work);
          };
        },
      });
      const databases = { for: (m: string) => (m === at ? hooked : db.databases.for(m as never)) };
      await erase(databases as unknown as Pick<typeof db.databases, "for">, person.accountId);
      expect(passes, at).toBe(1);
      const left = await db.owner.query(
        `SELECT name, state FROM categorization.jobs WHERE household_id = $1`,
        [person.householdId],
      );
      expect(left.rows, `a worker pass before the step of ${at}`).toEqual([]);
      expect(await rowCount(db, person.householdId), at).toBe(0);
    }
  });
});
