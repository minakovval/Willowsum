// ===== FILE: apps/api/test/sec275-delete-category.it.test.ts =====
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
import {
  createCategoriesServices,
  createCategoryDirectory,
  type CategoryDirectory,
  type CategoryUsage,
} from "../src/modules/categories/index.ts";
import {
  createTransactionCategoryUsage,
  createTransactionsServices,
} from "../src/modules/transactions/index.ts";

/**
 * Security review of PR #275 (probes, not acceptance tests): BUD-01@PoC FR 12 delete — isolation, races, audit. Through the real API on a real
 * PostgreSQL. «Empty» is asked of every module that keeps category ids (the port `CategoryUsage`): here the split
 * parts of `transactions` (the only ones on `main`) and a stand-in for the modules not built yet — the transaction's
 * own category and the rules (categorization, BUD-01 b), limits and «План» cells (budget, BUD-02), recurring payments
 * (recurring, BUD-07; lead decision, #260 item 3). Every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const NOT_EMPTY = "CATEGORY_NOT_EMPTY";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
/** What the modules not built yet would answer: category ids their records (rules, limits, recurring) use. */
const elsewhere = new Set<string>();
/** Probe: while set, the delete waits after its usage answer (row still locked, transaction still open). */
let gate: { reached: () => void; release: Promise<void> } | null = null;
const standIn: CategoryUsage = {
  module: "budget",
  used: async (_householdId, ids) => {
    const answer = new Set(ids.filter((id) => elsewhere.has(id)));
    if (gate) {
      const g = gate;
      gate = null;
      g.reached();
      await g.release;
    }
    return answer;
  },
};
function hold() {
  let reached!: () => void;
  let release!: () => void;
  const atGate = new Promise<void>((r) => (reached = r));
  const released = new Promise<void>((r) => (release = r));
  gate = { reached, release: released };
  return { atGate, release };
}

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Category {
  id: string;
  groupId: string;
  systemKey: string | null;
  kind: "expense" | "income" | "service";
  name: string;
  hidden: boolean;
  deletable: boolean;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

async function all(space: Space): Promise<Category[]> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().groups as { categories: Category[] }[]).flatMap((g) => g.categories);
}

async function named(space: Space, name: string): Promise<Category | undefined> {
  return (await all(space)).find((c) => c.name === name);
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

/** A purchase of 4.00 € split into the category and «Продукти» (BUD-01 FR 6): a split part has the category. */
async function splitInto(space: Space, accountId: string, categoryId: string, other: string) {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount: "-4.00", currency: "EUR" },
    date: "2026-10-15",
    counterparty: "Синтетична кав'ярня",
  });
  expect(t.statusCode, t.body).toBe(201);
  const split = await call(space, "POST", `/v1/transactions/${t.json().id}/split`, {
    mode: "categories",
    parts: [
      { categoryId, amount: "-3.20" },
      { categoryId: other, amount: "-0.80" },
    ],
  });
  expect(split.statusCode, split.body).toBe(200);
  return t.json().id as string;
}
const parts = async (householdId: string) =>
  (
    await db.owner.query(
      `SELECT transaction_id, position, category_id, amount FROM transactions.transaction_parts
        WHERE household_id = $1 ORDER BY transaction_id, position`,
      [householdId],
    )
  ).rows;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
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
          usage: [createTransactionCategoryUsage(db.databases.for("transactions")), standIn],
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
  elsewhere.clear();
  gate = null;
});

describe("sec275: BUD-01@PoC FR 12 delete — isolation", () => {
  it("sec275: another space's split parts with the same category id never count as «in use» (usage is per space)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const mine = await addCategory(a, "Синтетична своя");
    // B's part with A's id is inserted by the owner (the directory would refuse it): only the query scope can tell.
    const acc = await createAccount(b);
    const t = await splitInto(
      b,
      acc,
      (await addCategory(b, "Синтетична чужа")).id,
      (await named(b, "Продукти"))!.id,
    );
    await db.owner.query(
      `UPDATE transactions.transaction_parts SET category_id = $1 WHERE household_id = $2 AND transaction_id = $3 AND position = 0`,
      [mine.id, b.householdId, t],
    );
    expect((await named(a, "Синтетична своя"))!.deletable).toBe(true);
    expect((await call(a, "DELETE", `/v1/categories/${mine.id}`)).statusCode).toBe(200);
  });

  it("sec275: deleting another space's in-use or system category gives the same 404 as an unknown id; no audit entry in either space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const used = await addCategory(a, "Синтетична в ужитку");
    elsewhere.add(used.id);
    const system = (await all(a)).find((c) => c.systemKey === "travel")!;
    await all(b);
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const unknown = await call(b, "DELETE", `/v1/categories/${randomUUID()}`);
    for (const id of [used.id, system.id]) {
      const res = await call(b, "DELETE", `/v1/categories/${id}`);
      expect(res.statusCode).toBe(404);
      expect(strip(res.body)).toEqual(strip(unknown.body));
      expect(
        (await audit.entriesFor(a.householdId, { type: "categories.category", id })).map((e) => e.action),
      ).not.toContain("delete");
    }
    expect((await named(a, "Синтетична в ужитку"))!.id).toBe(used.id);
  });
});

describe("sec275: BUD-01@PoC FR 12 delete — races", () => {
  it("sec275: two deletes of the same category at once — one 200, one 404, exactly one audit `delete`", async () => {
    const space = await newSpace();
    const c = await addCategory(space, "Синтетична двічі");
    const res = await Promise.all([
      call(space, "DELETE", `/v1/categories/${c.id}`),
      call(space, "DELETE", `/v1/categories/${c.id}`),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: c.id });
    expect(log.map((e) => e.action)).toEqual(["create", "delete"]);
  });

  it("sec275: a merge into the category while its delete holds the row waits, then finds no target; nothing points at the deleted row", async () => {
    const space = await newSpace();
    const target = await addCategory(space, "Синтетична ціль");
    const source = await addCategory(space, "Синтетичне джерело");
    const h = hold();
    const del = call(space, "DELETE", `/v1/categories/${target.id}`);
    await h.atGate;
    const merge = call(space, "POST", `/v1/categories/${source.id}/merge`, { targetId: target.id });
    await new Promise((r) => setTimeout(r, 300));
    h.release();
    const [d, m] = await Promise.all([del, merge]);
    expect(d.statusCode, d.body).toBe(200);
    expect(m.statusCode, m.body).toBe(400);
    expect((await named(space, "Синтетичне джерело"))!.id).toBe(source.id);
  });

  it("sec275: a delete while the category is in use elsewhere is refused even when the usage answer is slow", async () => {
    const space = await newSpace();
    const c = await addCategory(space, "Синтетична повільна");
    elsewhere.add(c.id);
    const h = hold();
    const del = call(space, "DELETE", `/v1/categories/${c.id}`);
    await h.atGate;
    h.release();
    const res = await del;
    expect([res.statusCode, res.json().code]).toEqual([409, NOT_EMPTY]);
  });

  // Residual race the PR documents (categories README «Порядок однієї зміни», follow-up): the split checks the
  // category through the directory without a lock, so a split saved between the delete's usage answer and its commit
  // keeps the id of a category that no longer exists. Passes while the race exists.
  it.fails(
    "sec275 (residual race, non-blocking): a split saved while the delete is between its check and commit is refused or blocks the delete",
    async () => {
      const space = await newSpace();
      const account = await createAccount(space);
      const c = await addCategory(space, "Синтетична гонка");
      const groceries = (await named(space, "Продукти"))!.id;
      const h = hold();
      const del = call(space, "DELETE", `/v1/categories/${c.id}`);
      await h.atGate;
      let split: Awaited<ReturnType<typeof call>> | null = null;
      const t = await call(space, "POST", "/v1/transactions", {
        accountId: account,
        amount: { amount: "-4.00", currency: "EUR" },
        date: "2026-10-15",
        counterparty: "Синтетична кав'ярня",
      });
      const splitting = call(space, "POST", `/v1/transactions/${t.json().id}/split`, {
        mode: "categories",
        parts: [
          { categoryId: c.id, amount: "-3.20" },
          { categoryId: groceries, amount: "-0.80" },
        ],
      }).then((r) => (split = r));
      await Promise.race([splitting, new Promise((r) => setTimeout(r, 1000))]);
      h.release();
      const d = await del;
      await splitting;
      const dangling = (await parts(space.householdId)).filter(
        (p: { category_id: string }) => p.category_id === c.id,
      );
      // Safe outcomes: the delete refused (409) or the split refused; never both succeeding.
      expect(d.statusCode === 200 && split!.statusCode === 200 && dangling.length > 0).toBe(false);
    },
  );
});
