import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createCategorizationServices } from "../src/modules/categorization/index.ts";
import { createTransactionLookup, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";

/**
 * FIN-03@PoC FR 27 (issue #439), through the real API on a real PostgreSQL: «Історія змін» of the details S-047 —
 * `GET /v1/transactions/{id}/history`, the transaction's entries of the space's own audit log (FR 20) and of its
 * category, never reconstructed. Space isolation (AC12, П-rules): another space's transaction is not found and nothing
 * of its log is returned; the history carries no free text and no account id. Every name and amount is synthetic;
 * the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-16";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const FLAG = "transactions.history";
const SHOP = "Синтетичний магазин Ромашка";
const SHOP2 = "Синтетична аптека Волошка";
const NOTE = "Синтетична нотатка про подарунок";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface HistoryEntry {
  id: string;
  occurredAt: string;
  actor: string;
  channel: string;
  action: string;
  changes: { field: string; before: string | null; after: string | null; masked: boolean }[];
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
  principal: { userId?: string; role?: string; scoped?: boolean } = {},
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
    balance: { amount: "100.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: "2026-11-10",
    counterparty: SHOP,
    description: "Синтетичний опис покупки",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function categoryId(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

const history = (space: Space, id: string, principal = {}) =>
  call(space, "GET", `/v1/transactions/${id}/history`, undefined, principal);

/** A transaction with a create, an edit of amount and counterparty, a category and a note — all through the API. */
async function edited(space: Space): Promise<{ id: string; category: string }> {
  const account = await createAccount(space);
  const id = await add(space, account, "-30.00");
  const patch = await call(space, "PATCH", `/v1/transactions/${id}`, {
    amount: { amount: "-25.00", currency: "EUR" },
    counterparty: SHOP2,
  });
  expect(patch.statusCode, patch.body).toBe(200);
  const category = await categoryId(space, "Продукти");
  const put = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId: category });
  expect(put.statusCode, put.body).toBe(200);
  const note = await call(space, "PATCH", `/v1/transactions/${id}/attributes`, { note: NOTE });
  expect(note.statusCode, note.body).toBe(200);
  await runWorker(space.householdId);
  return { id, category };
}

beforeAll(async () => {
  db = await setupRealModules(4);
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

describe("FIN-03@PoC FR 27: «Історія змін» of a transaction", () => {
  it("FIN-03@PoC FR 27: the history is what the audit log recorded — create, the edit, the category and the note, oldest first", async () => {
    const space = await newSpace();
    const { id, category } = await edited(space);
    const res = await history(space, id);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as HistoryEntry[];

    // Exactly the log's entries of the transaction and of its category, in the log's order (not reconstructed).
    const logged = [
      ...(await audit.entriesFor(space.householdId, { type: "transactions.transaction", id })),
      ...(await audit.entriesFor(space.householdId, { type: "categorization.transaction-category", id })),
    ];
    expect(items.map((e) => e.id).sort()).toEqual(logged.map((e) => e.id).sort());
    const times = items.map((e) => e.occurredAt);
    expect(times).toEqual([...times].sort());
    expect(items.length).toBe(4);

    const [created, edit, categorised, noted] = items;
    expect(created!.action).toBe("create");
    expect(created!.actor).toBe("you");
    expect(created!.changes).toContainEqual({ field: "amount", before: null, after: "-30", masked: false });
    expect(edit!.action).toBe("update");
    expect(edit!.changes).toContainEqual({ field: "amount", before: "-30", after: "-25", masked: false });
    expect(edit!.changes).toContainEqual({
      field: "counterparty",
      before: AUDIT_MASK,
      after: AUDIT_MASK,
      masked: true,
    });
    expect(categorised!.changes).toContainEqual({
      field: "categoryId",
      before: null,
      after: category,
      masked: false,
    });
    expect(noted!.changes).toContainEqual({ field: "note", before: null, after: AUDIT_MASK, masked: true });
    for (const e of items) expect(Date.parse(e.occurredAt)).not.toBeNaN();
  });

  it("FIN-03@PoC FR 20: the history leaks no free text, no account id and no space id", async () => {
    const space = await newSpace();
    const { id } = await edited(space);
    const body = (await history(space, id)).body;
    for (const text of [SHOP, SHOP2, NOTE, "Синтетичний опис покупки", space.accountId, space.householdId])
      expect(body).not.toContain(text);
    expect(body).not.toMatch(/dedupe|householdId|actorId|entityType/);
  });

  it("FIN-03@PoC FR 20: another member's change is told as «member», without its account id", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await add(space, account, "-12.00");
    const member = randomUUID();
    const res = await call(
      space,
      "PATCH",
      `/v1/transactions/${id}`,
      { date: "2026-11-09" },
      { userId: member },
    );
    expect(res.statusCode, res.body).toBe(200);
    const read = await history(space, id);
    const items = read.json().items as HistoryEntry[];
    expect(items.map((e) => e.actor)).toEqual(["you", "member"]);
    expect(read.body).not.toContain(member);
  });
});

describe("FIN-03@PoC AC12: another space's history is not readable", () => {
  it("FIN-03@PoC AC12 (history): a user of another space gets 404 and nothing of the log; the owner's history is unchanged", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const { id } = await edited(owner);
    const before = (await history(owner, id)).json();

    const res = await history(stranger, id);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("changes");
    expect(res.body).not.toContain("occurredAt");
    // The session's space wins over anything the caller could send: a request naming the owner's account but carrying
    // another space is still that other space's.
    const forged = await history(stranger, id, { userId: owner.accountId });
    expect(forged.statusCode).toBe(404);
    expect((await history(owner, id)).json()).toEqual(before);
  });

  it("FIN-03@PoC AC12 (history): an unknown or deleted transaction is not found — 404 for both alike", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await add(space, account, "-7.00");
    const del = await call(space, "DELETE", `/v1/transactions/${id}`);
    expect(del.statusCode, del.body).toBe(200);
    const deleted = await history(space, id);
    const unknown = await history(space, randomUUID());
    expect(deleted.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(deleted.json().code).toBe(unknown.json().code);
  });

  it("FIN-03@PoC AC12 (history): a scoped member of the space reads no history (404, like the transaction)", async () => {
    const space = await newSpace();
    const { id } = await edited(space);
    const res = await history(space, id, { userId: randomUUID(), role: "editor", scoped: true });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("changes");
  });
});

describe("FIN-03@PoC FR 27: behind its release flag", () => {
  it("FIN-03@PoC FR 27: «Історія змін» is behind the release flag `transactions.history` (404 when off)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const id = await add(space, account, "-3.00");
    off.add(FLAG);
    expect((await history(space, id)).statusCode).toBe(404);
    off.delete(FLAG);
    expect((await history(space, id)).statusCode).toBe(200);
  });
});
