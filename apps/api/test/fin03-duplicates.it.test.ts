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
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createDuplicateCandidates,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";
import {
  createDuplicateCheck,
  createDuplicateMatchingServices,
} from "../src/modules/duplicate-matching/index.ts";

/**
 * FIN-03@PoC b) (wave 2 row 16c), through the real API on a real PostgreSQL: duplicates of a transaction — «Можливий
 * дубль» (FR 12), «Об'єднати» and «Об'єднати з іншою» (FR 11, FR 27), «Роз'єднати» (edge case 4), «Не дубль» (FR 12), and
 * hiding only a duplicate (FR 18). Every name and amount is synthetic; the session is the test's principal header; the
 * clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
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

interface Transaction {
  id: string;
  type: string;
  date: string;
  counterparty: string | null;
  description: string | null;
  amount: { amount: string; currency: string };
  hidden: boolean;
  mergedInto: string | null;
  mergedDuplicates: string[];
  /** BUD-12 FR 7: one more with each change. */
  version: number;
  transfer: {
    id: string;
    side: string;
    counterpartId: string;
    date: string;
    fee: { amount: string; currency: string } | null;
    rate: { rate: string; date: string; source: string } | null;
  } | null;
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

async function createAccount(space: Space, amount: string, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency} ${randomUUID().slice(0, 6)}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string, date: string, currency = "EUR") {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний переказ",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Transaction;
}

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const duplicates = async (space: Space, principal: Principal = {}) => {
  const res = await call(space, "GET", "/v1/duplicate-proposals", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    more: boolean;
    items: {
      first: { transactionId: string; accountId: string; amount: { amount: string }; date: string };
      second: { transactionId: string; accountId: string; amount: { amount: string }; date: string };
    }[];
  };
};

const pairsOf = async (space: Space) =>
  (await duplicates(space)).items.map((p) => [p.first.transactionId, p.second.transactionId]);

const merge = (space: Space, id: string, duplicateId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/merge`, { duplicateId }, principal);

const unmerge = (space: Space, id: string, principal: Principal = {}) =>
  call(space, "DELETE", `/v1/transactions/${id}/merge`, undefined, principal);

const notDuplicate = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/not-duplicate`, { counterpartId }, principal);

const hide = (space: Space, id: string) => call(space, "POST", `/v1/transactions/${id}/hide`);

const listed = async (space: Space, filter?: string) =>
  (
    (
      await call(space, "GET", `/v1/transactions${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`)
    ).json() as {
      items: Transaction[];
    }
  ).items.map((t) => t.id);

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

/** The live journal entries of the space from the transactions module: [event type, operation date]. */
async function liveEntries(householdId: string): Promise<[string, string][]> {
  const { rows } = await db.owner.query(
    `SELECT e.event_type, e.operation_date::text AS d FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.recorded_at`,
    [householdId],
  );
  return rows.map((r: { event_type: string; d: string }) => [r.event_type, r.d]);
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
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
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
        }),
        duplicateMatching: createDuplicateMatchingServices({
          candidates: createDuplicateCandidates(db.databases.for("transactions")),
        }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates: (requests) => fx.rates(requests),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
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

/** A space with one account (1 000 EUR) and the same −30 EUR entered twice, two days apart. */
async function twice() {
  const space = await newSpace();
  const a = await createAccount(space, "1000.00");
  const first = await add(space, a, "-30.00", "2026-10-10");
  const second = await add(space, a, "-30.00", "2026-10-12");
  return { space, a, first, second };
}

describe("FIN-03@PoC FR 12: «Можливий дубль» — the system marks, the user decides", () => {
  it("FIN-03@PoC FR 12: the same account, amount and currency within 3 days is a possible duplicate; nothing is merged, deleted or hidden", async () => {
    const { space, a, first, second } = await twice();
    const found = await duplicates(space);
    expect(found.count).toBe(1);
    expect(found.items[0]).toMatchObject({
      first: { transactionId: first.id, accountId: a, amount: { amount: "-30" }, date: "2026-10-10" },
      second: { transactionId: second.id, date: "2026-10-12" },
    });
    expect(found.more).toBe(false);
    // Both stay as they are: listed, counted, each with its own journal event.
    expect((await listed(space)).sort()).toEqual([first.id, second.id].sort());
    expect(await balance(space, a)).toBe("940");
    expect(await liveEntries(space.householdId)).toHaveLength(2);
  });

  it("FIN-03@PoC FR 12: 4 days apart, another account, amount or currency, a hidden one or a side of a transfer is no possible duplicate", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const b = await createAccount(space, "1000.00");
    await add(space, a, "-10.00", "2026-10-01");
    await add(space, a, "-10.00", "2026-10-05"); // 4 days
    await add(space, a, "-20.00", "2026-10-06");
    await add(space, b, "-20.00", "2026-10-06"); // another account
    await add(space, a, "-30.00", "2026-10-07");
    await add(space, a, "-30.50", "2026-10-07"); // another amount
    const out = await add(space, a, "-40.00", "2026-10-09");
    await add(space, a, "-40.00", "2026-10-09");
    const into = await add(space, b, "40.00", "2026-10-09");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    const usd = await createAccount(space, "100.00", "USD");
    await add(space, usd, "-40.00", "2026-10-09", "USD"); // another account and currency
    expect(await duplicates(space)).toEqual({ items: [], count: 0, more: false });
  });

  it("FIN-03@PoC FR 12: three copies make three pairs; a pending one is a possible duplicate too", async () => {
    const { space, a, first, second } = await twice();
    const pending = await call(space, "POST", "/v1/transactions", {
      accountId: a,
      amount: { amount: "-30.00", currency: "EUR" },
      date: "2026-10-11",
      status: "pending",
    });
    expect(pending.statusCode, pending.body).toBe(201);
    const third = pending.json().id as string;
    expect((await pairsOf(space)).map((p) => p.sort()).sort()).toEqual(
      [
        [first.id, second.id],
        [first.id, third],
        [third, second.id],
      ]
        .map((p) => p.sort())
        .sort(),
    );
  });

  it("FIN-03@PoC FR 12: «Не дубль» takes the mark off the pair for good — also after an edit — and is in the audit log", async () => {
    const { space, a, first, second } = await twice();
    const res = await notDuplicate(space, second.id, first.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((await duplicates(space)).count).toBe(0);
    // Twice changes nothing; an edit of the date and back does not bring the pair back.
    expect((await notDuplicate(space, first.id, second.id)).statusCode).toBe(200);
    await call(space, "PATCH", `/v1/transactions/${first.id}`, { date: "2026-10-01" });
    await call(space, "PATCH", `/v1/transactions/${first.id}`, { date: "2026-10-11" });
    expect((await duplicates(space)).count).toBe(0);
    const log = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: second.id,
    });
    expect(log.map((e) => e.action)).toEqual(["create", "update"]);
    expect(log[1]!.changes).toEqual([
      expect.objectContaining({ field: "notDuplicateOf", before: null, after: first.id }),
    ]);
    // The pair stays apart; a third copy is marked with each of them.
    const third = await add(space, a, "-30.00", "2026-10-12");
    expect((await pairsOf(space)).map((p) => p.sort()).sort()).toEqual(
      [[first.id, third.id].sort(), [second.id, third.id].sort()].sort(),
    );
  });

  it("FIN-03@PoC FR 12: «Не дубль» only for a pair that could be one; another space's transaction is not found", async () => {
    const { space, a, first } = await twice();
    const other = await add(space, a, "-31.00", "2026-10-10");
    const res = await notDuplicate(space, first.id, other.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "amount_mismatch" }]);
    const theirs = await twice();
    const cross = await notDuplicate(space, first.id, theirs.first.id);
    expect(cross.statusCode).toBe(400);
    expect(cross.json().errors).toEqual([{ in: "body", path: "counterpartId", issue: "not_found" }]);
    expect((await notDuplicate(space, theirs.first.id, first.id)).statusCode).toBe(404);
    expect((await duplicates(theirs.space)).count).toBe(1);
  });
});

describe("FIN-03@PoC FR 11, FR 27: «Об'єднати» — the operation counts once", () => {
  it("FIN-03@PoC FR 11: the one that stays keeps its categories (the split) after the merge and after «Роз'єднати»", async () => {
    const { space, first, second } = await twice();
    const cats = (await call(space, "GET", "/v1/categories"))
      .json()
      .groups.flatMap((g: { categories: { id: string; kind: string }[] }) => g.categories) as {
      id: string;
      kind: string;
    }[];
    const [food, home] = cats.filter((c) => c.kind === "expense");
    const split = await call(space, "POST", `/v1/transactions/${first.id}/split`, {
      mode: "categories",
      parts: [
        { categoryId: food!.id, amount: "-20.00" },
        { categoryId: home!.id, amount: "-10.00" },
      ],
    });
    expect(split.statusCode, split.body).toBe(200);
    const parts = (t: unknown) =>
      (t as { split: { parts: { categoryId: string; amount: { amount: string } }[] } }).split.parts.map(
        (x) => [x.categoryId, x.amount.amount],
      );
    const before = parts(await get(space, first.id));
    expect(before).toEqual([
      [food!.id, "-20"],
      [home!.id, "-10"],
    ]);
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    expect(parts(await get(space, first.id))).toEqual(before);
    expect((await unmerge(space, second.id)).statusCode).toBe(200);
    expect(parts(await get(space, first.id))).toEqual(before);
  });

  it("FIN-03@PoC FR 11: the duplicate is merged into the one that stays — hidden, without its journal event; the other keeps its fields and is «Об'єднано»", async () => {
    const { space, a, first, second } = await twice();
    await call(space, "PATCH", `/v1/transactions/${first.id}`, { description: "Синтетична нотатка" });
    const res = await merge(space, first.id, second.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      id: first.id,
      description: "Синтетична нотатка",
      date: "2026-10-10",
      hidden: false,
      mergedInto: null,
      mergedDuplicates: [second.id],
    });
    expect(await get(space, second.id)).toMatchObject({
      hidden: true,
      mergedInto: first.id,
      mergedDuplicates: [],
    });
    // Counts once: the balance, the journal, the list (shown) and its totals.
    expect(await balance(space, a)).toBe("970");
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-10"]]);
    expect(await listed(space)).toEqual([first.id]);
    expect(await listed(space, "hidden.eq:true")).toEqual([second.id]);
    expect((await duplicates(space)).count).toBe(0);
    const log = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: second.id,
    });
    expect(log.map((e) => e.action)).toEqual(["create", "update"]);
    expect(Object.fromEntries(log[1]!.changes.map((c) => [c.field, [c.before, c.after]]))).toEqual({
      hidden: [null, "true"],
      mergedInto: [null, first.id],
    });
  });

  it("FIN-03@PoC FR 27: «Об'єднати з іншою» merges two the search did not mark (more than 3 days apart); one account and amount still needed", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const b = await createAccount(space, "100.00");
    const kept = await add(space, a, "-5.00", "2026-10-01");
    const late = await add(space, a, "-5.00", "2026-10-15");
    expect((await merge(space, kept.id, late.id)).statusCode).toBe(200);
    const other = await add(space, b, "-5.00", "2026-10-01");
    const res = await merge(space, kept.id, other.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "duplicateId", issue: "account_mismatch" }]);
    const more = await add(space, a, "-5.01", "2026-10-01");
    expect((await merge(space, kept.id, more.id)).json().errors).toEqual([
      { in: "body", path: "duplicateId", issue: "amount_mismatch" },
    ]);
    expect(await balance(space, a)).toBe("89.99");
  });

  it("FIN-03@PoC FR 11: a side of a transfer, a merged duplicate, a chain or the transaction itself is not merged; nothing is written", async () => {
    const { space, a, first, second } = await twice();
    const b = await createAccount(space, "0.00");
    const out = await add(space, a, "-30.00", "2026-10-11");
    const into = await add(space, b, "30.00", "2026-10-11");
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    expect((await merge(space, first.id, out.id)).json().errors).toEqual([
      { in: "body", path: "duplicateId", issue: "in_transfer" },
    ]);
    expect((await merge(space, first.id, first.id)).json().errors).toEqual([
      { in: "body", path: "duplicateId", issue: "invalid" },
    ]);
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    expect((await merge(space, second.id, first.id)).json().errors).toEqual([
      { in: "body", path: "transactionId", issue: "merged" },
      { in: "body", path: "duplicateId", issue: "has_duplicates" },
    ]);
    const third = await add(space, a, "-30.00", "2026-10-12");
    // The one that stays may take more duplicates; one others were merged into is no duplicate itself.
    expect((await merge(space, third.id, first.id)).json().errors).toEqual([
      { in: "body", path: "duplicateId", issue: "has_duplicates" },
    ]);
    expect((await merge(space, first.id, third.id)).statusCode).toBe(200);
    expect((await get(space, first.id)).mergedDuplicates.sort()).toEqual([second.id, third.id].sort());
  });

  it("FIN-03@PoC FR 11: a merged duplicate changes only through «Роз'єднати»; the one that stays is deleted only once unmerged (409)", async () => {
    const { space, first, second } = await twice();
    await merge(space, first.id, second.id);
    const refused = [
      await call(space, "PATCH", `/v1/transactions/${second.id}`, { description: "x" }),
      await call(space, "DELETE", `/v1/transactions/${second.id}`),
      await call(space, "POST", `/v1/transactions/${second.id}/show`),
      await call(space, "DELETE", `/v1/transactions/${first.id}`),
    ];
    expect(refused.map((r) => [r.statusCode, r.json().code])).toEqual(
      Array(4).fill([409, "TRANSACTION_MERGED"]),
    );
    expect(await get(space, second.id)).toMatchObject({
      hidden: true,
      mergedInto: first.id,
      description: null,
    });
    // Its texts stay editable on the one that stays; its amount and account only once unmerged (FR 34).
    expect(
      (await call(space, "PATCH", `/v1/transactions/${first.id}`, { description: "y" })).statusCode,
    ).toBe(200);
  });
});

describe("FIN-03@PoC EC4: «Роз'єднати» gives both back with their own fields", () => {
  it("FIN-03@PoC EC4: on the duplicate — it is shown again with its fields and journal event; the balance as before the merge", async () => {
    const { space, a, first, second } = await twice();
    await call(space, "PATCH", `/v1/transactions/${second.id}`, { counterparty: "Синтетичний дубль" });
    const before = await get(space, second.id);
    await merge(space, first.id, second.id);
    const res = await unmerge(space, second.id);
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json() as Transaction & { recordedAt: string };
    expect(after).toMatchObject({ hidden: false, mergedInto: null, counterparty: "Синтетичний дубль" });
    // BUD-12 added `version`: «Об'єднати» and «Роз'єднати» are changes, so it grows; every other field comes back.
    expect(after.version).toBeGreaterThan(before.version);
    expect({ ...after, hidden: before.hidden, version: before.version }).toEqual({ ...before });
    expect((await get(space, first.id)).mergedDuplicates).toEqual([]);
    expect(await balance(space, a)).toBe("940");
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-10"],
      ["transaction", "2026-10-12"],
    ]);
    // Not merged any more: the pair is a possible duplicate again; «Роз'єднати» twice changes nothing.
    expect((await duplicates(space)).count).toBe(1);
    expect((await unmerge(space, second.id)).statusCode).toBe(200);
    const log = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: second.id,
    });
    expect(log.map((e) => e.action)).toEqual(["create", "update", "update", "update"]);
  });

  it("FIN-03@PoC EC4: on the one that stays — every duplicate merged into it comes back", async () => {
    const { space, a, first, second } = await twice();
    const third = await add(space, a, "-30.00", "2026-10-11");
    await merge(space, first.id, second.id);
    await merge(space, first.id, third.id);
    expect(await balance(space, a)).toBe("970");
    const res = await unmerge(space, first.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: first.id, mergedDuplicates: [] });
    expect((await listed(space)).sort()).toEqual([first.id, second.id, third.id].sort());
    expect(await balance(space, a)).toBe("910");
  });
});

describe("FIN-03@PoC FR 18: hiding is for duplicates only; a transfer is never hidden", () => {
  it("FIN-03@PoC FR 18: a transaction that is no duplicate is not hidden (409); a possible duplicate is, and then its pair is no duplicate any more", async () => {
    const { space, a, first, second } = await twice();
    const single = await add(space, a, "-7.00", "2026-10-10");
    const refused = await hide(space, single.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("TRANSACTION_NOT_HIDEABLE");
    expect((await get(space, single.id)).hidden).toBe(false);
    expect((await hide(space, second.id)).statusCode).toBe(200);
    // The other copy is the one left: hiding it too would take the operation out of the budget.
    expect((await hide(space, first.id)).json().code).toBe("TRANSACTION_NOT_HIDEABLE");
    // FR 17 (owner, 2026-11-15): the hidden manual copy left the balance (1 000 − 30 − 30 − 7 = 933, plus the 30 back).
    expect(await balance(space, a)).toBe("963");
  });

  it("FIN-03@PoC AC25: 100 − 30 − 30 = 40; hiding one possible duplicate → 70; showing it again → 40; both in the audit log", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const first = await add(space, a, "-30.00", "2026-10-10");
    const second = await add(space, a, "-30.00", "2026-10-12");
    expect(await balance(space, a)).toBe("40");
    expect((await hide(space, second.id)).statusCode).toBe(200);
    expect(await balance(space, a)).toBe("70");
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-10"]]);
    expect((await get(space, first.id)).hidden).toBe(false);
    const shown = await call(space, "POST", `/v1/transactions/${second.id}/show`);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(await balance(space, a)).toBe("40");
    expect(await liveEntries(space.householdId)).toHaveLength(2);
    // Hidden twice more: each hiding is its own journal reversal and posting (no reversed event is reused).
    expect((await hide(space, second.id)).statusCode).toBe(200);
    expect(await balance(space, a)).toBe("70");
    expect((await call(space, "POST", `/v1/transactions/${second.id}/show`)).statusCode).toBe(200);
    expect(await balance(space, a)).toBe("40");
    const log = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: second.id,
    });
    expect(log.map((e) => e.action)).toEqual(["create", "update", "update", "update", "update"]);
  });

  it("FIN-03@PoC FR 18: both copies hidden at once — exactly one is hidden, the other refused", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, first, second } = await twice();
      const both = await Promise.all([hide(space, first.id), hide(space, second.id)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const hidden = [await get(space, first.id), await get(space, second.id)].filter((t) => t.hidden);
      expect(hidden).toHaveLength(1);
    }
  });

  it("FIN-03@PoC FR 18: a pair called «Не дубль» is no duplicate, so neither is hidden", async () => {
    const { space, first, second } = await twice();
    await notDuplicate(space, first.id, second.id);
    expect((await hide(space, first.id)).json().code).toBe("TRANSACTION_NOT_HIDEABLE");
    expect((await hide(space, second.id)).json().code).toBe("TRANSACTION_NOT_HIDEABLE");
  });

  it("FIN-03@PoC FR 18: a side of a transfer is not hidden even when it has a copy (409 TRANSACTION_IN_TRANSFER)", async () => {
    const { space, first } = await twice();
    const b = await createAccount(space, "0.00");
    const into = await add(space, b, "30.00", "2026-10-10");
    expect((await mark(space, first.id, into.id)).statusCode).toBe(200);
    const twin = await add(space, b, "30.00", "2026-10-11");
    expect((await hide(space, into.id)).json().code).toBe("TRANSACTION_IN_TRANSFER");
    // The copy itself is no duplicate: a side of a transfer is out of the search.
    expect((await hide(space, twin.id)).json().code).toBe("TRANSACTION_NOT_HIDEABLE");
  });
});

describe("FIN-03@PoC «Права доступу»: duplicates are the space's own", () => {
  it("FIN-03@PoC AC11: a transaction of another space is «not found» as the one acted on and as the duplicate; no pair crosses spaces", async () => {
    const mine = await twice();
    const theirs = await twice();
    expect((await merge(mine.space, theirs.first.id, mine.second.id)).statusCode).toBe(404);
    const cross = await merge(mine.space, mine.first.id, theirs.second.id);
    expect(cross.statusCode).toBe(400);
    expect(cross.json().errors).toEqual([{ in: "body", path: "duplicateId", issue: "not_found" }]);
    expect((await unmerge(mine.space, theirs.first.id)).statusCode).toBe(404);
    expect((await hide(mine.space, theirs.first.id)).statusCode).toBe(404);
    expect(await pairsOf(mine.space)).toEqual([[mine.first.id, mine.second.id]]);
    expect((await get(theirs.space, theirs.second.id)).mergedInto).toBeNull();
  });

  it("FIN-03@PoC AC12: the possible duplicates are bound to the space by the row policy too", async () => {
    const mine = await twice();
    const theirs = await twice();
    const txDb = db.databases.for("transactions");
    const seen = await txDb.inHousehold(
      theirs.space.householdId,
      async (q) =>
        (
          await q.query<{ id: string }>(
            `SELECT first_id AS id FROM duplicate_dismissals UNION ALL SELECT id FROM transactions`,
          )
        ).rows,
    );
    expect(seen.map((r) => r.id)).not.toContain(mine.first.id);
    const found = await createDuplicateCandidates(txDb).candidatePairs(mine.space.householdId, {
      windowDays: 3,
      limit: 10,
    });
    expect(found.map((p) => p.first.transactionId)).toEqual([mine.first.id]);
  });

  it.each(["owner", "admin", "editor"])(
    "FIN-03@PoC «Права доступу»: a %s sees possible duplicates, merges, unmerges and calls a pair «Не дубль»",
    async (role) => {
      const { space, first, second } = await twice();
      expect((await duplicates(space, { role })).count).toBe(1);
      expect((await merge(space, first.id, second.id, { role })).statusCode).toBe(200);
      expect((await unmerge(space, second.id, { role })).statusCode).toBe(200);
      expect((await notDuplicate(space, first.id, second.id, { role })).statusCode).toBe(200);
    },
  );

  it.each([
    ["viewer", {}],
    ["advisor", {}],
    ["editor", { scoped: true }],
  ] as const)(
    "FIN-03@PoC «Права доступу»: a %s %o may not merge, unmerge or call a pair «Не дубль» (403); nothing written",
    async (role, extra) => {
      const { space, first, second } = await twice();
      const who = { role, ...extra };
      expect((await merge(space, first.id, second.id, who)).statusCode).toBe(403);
      expect((await notDuplicate(space, first.id, second.id, who)).statusCode).toBe(403);
      await merge(space, first.id, second.id);
      expect((await unmerge(space, second.id, who)).statusCode).toBe(403);
      expect((await get(space, second.id)).mergedInto).toBe(first.id);
      if ("scoped" in extra)
        expect((await call(space, "GET", "/v1/duplicate-proposals", undefined, who)).statusCode).toBe(404);
    },
  );

  it("FIN-03@PoC «Права доступу»: on a closed account nothing is merged or unmerged (409)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "60.00");
    const first = await add(space, a, "-30.00", "2026-10-10");
    const second = await add(space, a, "-30.00", "2026-10-11");
    const third = await add(space, a, "-30.00", "2026-10-11");
    await call(space, "POST", `/v1/transactions/${third.id}/merge`, { duplicateId: second.id });
    const closed = await call(space, "POST", `/v1/accounts/${a}/close`, { closedOn: TODAY });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await merge(space, third.id, first.id)).statusCode).toBe(409);
    expect((await unmerge(space, second.id)).statusCode).toBe(409);
    expect((await notDuplicate(space, first.id, third.id)).statusCode).toBe(409);
  });

  it("FIN-03@PoC FR 12: duplicates are behind the flag `transactions.duplicates` — off, the routes are not there", async () => {
    const { space, first, second } = await twice();
    off.add("transactions.duplicates");
    expect((await merge(space, first.id, second.id)).statusCode).toBe(404);
    expect((await unmerge(space, second.id)).statusCode).toBe(404);
    expect((await notDuplicate(space, first.id, second.id)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/duplicate-proposals")).statusCode).toBe(404);
    expect((await get(space, second.id)).mergedInto).toBeNull();
  });
});

describe("ARC-04@PoC FR 2–4: a merge's journal follows the commit, from the worker if need be", () => {
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

  it("ARC-04@PoC FR 4: a merge's hand-off the worker gave up on (dead) goes back with the daily recovery and the journal counts once", async () => {
    const { space, a, first, second } = await twice();
    vi.spyOn(ledger, "reverse").mockRejectedValue(new Error("injected"));
    const res = await merge(space, first.id, second.id);
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    expect(await balance(space, a)).toBe("940");
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );
    const dead = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    expect(dead.rows[0].n).toBeGreaterThan(0);
    const recovery = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    }).find((t) => t.name === "transactions.hand-off-recovery");
    await recovery!.run();
    await runWorker(space.householdId);
    const left = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state <> 'done'`,
      [space.householdId],
    );
    expect(left.rows[0].n).toBe(0);
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-10"]]);
    expect(await balance(space, a)).toBe("970");
  });
});

describe("pr278-confirm: «Роз'єднати» checks the duplicate's own account", () => {
  it("FIN-03@PoC FR 34: the one that stays is not moved to another account while a duplicate is merged into it (409), so «Роз'єднати» finds both on one account", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "0.00");
    const b = await createAccount(space, "1000.00");
    const first = await add(space, a, "-30.00", "2026-10-10");
    const second = await add(space, a, "-30.00", "2026-10-11");
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    const moved = await call(space, "PATCH", `/v1/transactions/${first.id}`, { accountId: b });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(moved.json().code).toBe("TRANSACTION_HAS_DUPLICATES");
    expect(await balance(space, b)).toBe("1000");
    expect(await balance(space, a)).toBe("-30");
    expect((await get(space, second.id)).mergedInto).toBe(first.id);
  });
});

describe("FIN-03@PoC FR 12, FR 17, FR 35: «Не дубль» never leaves a hidden copy out of the balance", () => {
  it("FIN-03@PoC FR 35: one copy hidden (100 − 30 = 70) — «Не дубль» on the pair, from either side, shows it again: 40", async () => {
    for (const fromHidden of [false, true]) {
      const space = await newSpace();
      const a = await createAccount(space, "100.00");
      const first = await add(space, a, "-30.00", "2026-10-10");
      const second = await add(space, a, "-30.00", "2026-10-12");
      expect((await hide(space, second.id)).statusCode).toBe(200);
      expect(await balance(space, a)).toBe("70");
      const res = fromHidden
        ? await notDuplicate(space, second.id, first.id)
        : await notDuplicate(space, first.id, second.id);
      expect(res.statusCode, res.body).toBe(200);
      expect((await get(space, second.id)).hidden).toBe(false);
      expect(await balance(space, a)).toBe("40");
      expect(await pairsOf(space)).toEqual([]);
    }
  });
});

/** A space with 100 EUR and the same −30 EUR entered twice, the second copy hidden (FR 17): 100 − 30 = 70. */
async function hiddenCopy() {
  const space = await newSpace();
  const a = await createAccount(space, "100.00");
  const first = await add(space, a, "-30.00", "2026-10-10");
  const second = await add(space, a, "-30.00", "2026-10-12");
  expect((await hide(space, second.id)).statusCode).toBe(200);
  expect(await balance(space, a)).toBe("70");
  return { space, a, first, second };
}

const patch = (space: Space, id: string, body: unknown) =>
  call(space, "PATCH", `/v1/transactions/${id}`, body);

describe("FIN-03@PoC FR 34: the amount and the account of a transaction others were merged into change only after «Роз'єднати»", () => {
  it("FIN-03@PoC AC27: 100 − 30 − 30, one merged into the other (70): a new amount or account is refused (409) and nothing changes; the description changes; after «Роз'єднати» −25 is saved (45)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const b = await createAccount(space, "0.00");
    const first = await add(space, a, "-30.00", "2026-10-10");
    const second = await add(space, a, "-30.00", "2026-10-12");
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    expect(await balance(space, a)).toBe("70");
    const refused = [
      await patch(space, first.id, { amount: { amount: "-25.00", currency: "EUR" } }),
      await patch(space, first.id, { accountId: b }),
      await patch(space, first.id, { accountId: b, description: "x" }),
    ];
    for (const r of refused) {
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json()).toMatchObject({ code: "TRANSACTION_HAS_DUPLICATES", status: 409 });
      // The refusal explains why; the client offers «Роз'єднати» by the code.
      expect(r.json().title).toMatch(/unmerge/i);
    }
    expect(await get(space, first.id)).toMatchObject({
      amount: { amount: "-30", currency: "EUR" },
      description: null,
      mergedDuplicates: [second.id],
    });
    expect(await balance(space, a)).toBe("70");
    expect(await balance(space, b)).toBe("0");
    // The other fields change as usual (lead decision: only the amount and the account are refused).
    expect((await patch(space, first.id, { description: "Синтетичний опис" })).statusCode).toBe(200);
    expect((await patch(space, first.id, { date: "2026-10-11" })).statusCode).toBe(200);
    // The same amount sent again is no change of it.
    expect((await patch(space, first.id, { amount: { amount: "-30.00", currency: "EUR" } })).statusCode).toBe(
      200,
    );
    expect(await balance(space, a)).toBe("70");
    expect((await unmerge(space, first.id)).statusCode).toBe(200);
    expect(await balance(space, a)).toBe("40");
    const saved = await patch(space, first.id, { amount: { amount: "-25.00", currency: "EUR" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await balance(space, a)).toBe("45");
  });

  it("FIN-03@PoC FR 34: a merge and a change of the amount at once — either the change is refused or it went first and the merge is refused; the balance is one of the two", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, a, first, second } = await twice();
      const [merged, changed] = await Promise.all([
        merge(space, first.id, second.id),
        patch(space, first.id, { amount: { amount: "-25.00", currency: "EUR" } }),
      ]);
      const codes = [merged.statusCode, changed.statusCode].sort();
      if (merged.statusCode === 200) {
        expect(changed.statusCode, changed.body).toBe(409);
        expect(await balance(space, a)).toBe("970");
      } else {
        expect(codes).toEqual([200, 400]);
        expect(await balance(space, a)).toBe("945");
      }
    }
  });
});

describe("FIN-03@PoC FR 35: a hidden copy whose pair is no duplicate any more is shown again and back in the balance", () => {
  it("FIN-03@PoC AC28: the other copy deleted — the hidden one is shown again, the balance stays 70 (not 100), one journal event", async () => {
    const { space, a, first, second } = await hiddenCopy();
    const res = await call(space, "DELETE", `/v1/transactions/${first.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(false);
    expect(await balance(space, a)).toBe("70");
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-12"]]);
    expect(await listed(space)).toEqual([second.id]);
    const log = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: second.id,
    });
    // Created, hidden, shown again by the delete of its pair (FR 20).
    expect(log.map((e) => e.action)).toEqual(["create", "update", "update"]);
  });

  it("FIN-03@PoC AC28: the other copy's amount changed to −25 — the hidden one is shown again: 100 − 25 − 30 = 45", async () => {
    const { space, a, first, second } = await hiddenCopy();
    const res = await patch(space, first.id, { amount: { amount: "-25.00", currency: "EUR" } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(false);
    expect(await balance(space, a)).toBe("45");
    expect(await liveEntries(space.householdId)).toHaveLength(2);
  });

  it("FIN-03@PoC AC28: «Не дубль» on the pair — the hidden one is shown again: 40", async () => {
    const { space, a, first, second } = await hiddenCopy();
    expect((await notDuplicate(space, first.id, second.id)).statusCode).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(false);
    expect(await balance(space, a)).toBe("40");
  });

  it("FIN-03@PoC AC28: a third copy −30 is still a pair of the hidden one — the other deleted, it stays hidden (70); that pair called «Не дубль» too — shown (40)", async () => {
    const { space, a, first, second } = await hiddenCopy();
    const third = await add(space, a, "-30.00", "2026-10-13");
    expect(await balance(space, a)).toBe("40");
    expect((await call(space, "DELETE", `/v1/transactions/${first.id}`)).statusCode).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(true);
    expect(await balance(space, a)).toBe("70");
    // The last pair broken too — shown again.
    expect((await notDuplicate(space, third.id, second.id)).statusCode).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(false);
    expect(await balance(space, a)).toBe("40");
  });

  it("FIN-03@PoC FR 35: the other copy moved to another account or 4 days away — shown again; a change of its texts or state only — it stays hidden", async () => {
    for (const change of ["account", "date"] as const) {
      const { space, a, first, second } = await hiddenCopy();
      const b = await createAccount(space, "0.00");
      const body = change === "account" ? { accountId: b } : { date: "2026-10-16" };
      expect((await patch(space, first.id, body)).statusCode).toBe(200);
      expect((await get(space, second.id)).hidden).toBe(false);
      expect(await balance(space, a)).toBe(change === "account" ? "70" : "40");
    }
    const { space, a, first, second } = await hiddenCopy();
    expect((await patch(space, first.id, { description: "Синтетичний опис" })).statusCode).toBe(200);
    expect((await patch(space, first.id, { status: "pending" })).statusCode).toBe(200);
    expect((await get(space, second.id)).hidden).toBe(true);
    expect(await balance(space, a)).toBe("100");
  });

  it("FIN-03@PoC FR 35: the hidden copy itself changed so that it is no duplicate — shown again and in the balance (100 − 30 − 20 = 50)", async () => {
    const { space, a, second } = await hiddenCopy();
    const res = await patch(space, second.id, { amount: { amount: "-20.00", currency: "EUR" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().hidden).toBe(false);
    expect(await balance(space, a)).toBe("50");
  });

  it("FIN-03@PoC FR 35: hiding one copy and deleting the other at once — whichever goes first, the copy left is shown and counted once (70)", async () => {
    for (let round = 0; round < 6; round++) {
      const { space, a, first, second } = await twice();
      const [hidden, deleted] = await Promise.all([
        hide(space, second.id),
        call(space, "DELETE", `/v1/transactions/${first.id}`),
      ]);
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect([200, 409]).toContain(hidden.statusCode);
      if (hidden.statusCode === 409) expect(hidden.json().code).toBe("TRANSACTION_NOT_HIDEABLE");
      expect((await get(space, second.id)).hidden).toBe(false);
      expect(await balance(space, a)).toBe("970");
      expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-12"]]);
    }
  });

  it("FIN-03@PoC FR 35: hiding one copy and changing the other's amount at once — the copy left is shown: 1 000 − 25 − 30 = 945", async () => {
    for (let round = 0; round < 6; round++) {
      const { space, a, first, second } = await twice();
      const [hidden, changed] = await Promise.all([
        hide(space, second.id),
        patch(space, first.id, { amount: { amount: "-25.00", currency: "EUR" } }),
      ]);
      expect(changed.statusCode, changed.body).toBe(200);
      expect([200, 409]).toContain(hidden.statusCode);
      expect((await get(space, second.id)).hidden).toBe(false);
      expect(await balance(space, a)).toBe("945");
    }
  });

  it("FIN-03@PoC FR 35: hiding one copy and «Не дубль» on the pair at once — the copy is shown in the end: 940", async () => {
    for (let round = 0; round < 6; round++) {
      const { space, a, first, second } = await twice();
      const [hidden, dismissed] = await Promise.all([
        hide(space, second.id),
        notDuplicate(space, first.id, second.id),
      ]);
      expect(dismissed.statusCode, dismissed.body).toBe(200);
      expect([200, 409]).toContain(hidden.statusCode);
      expect((await get(space, second.id)).hidden).toBe(false);
      expect(await balance(space, a)).toBe("940");
    }
  });

  it("ARC-04@PoC FR 2: the shown copy's posting follows from the worker when the request's hand-off fails, and counts once", async () => {
    const { space, a, first, second } = await hiddenCopy();
    for (const method of ["post", "correct", "reverse"] as const)
      vi.spyOn(ledger, method).mockRejectedValue(new Error("injected"));
    const res = await call(space, "DELETE", `/v1/transactions/${first.id}`);
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    expect((await get(space, second.id)).hidden).toBe(false);
    const worker = createWorker({
      ...workerQueues(db.databases),
      households: async () => [space.householdId],
    });
    try {
      for (let pass = 0; pass < 10; pass++) {
        const handled = await worker.tick();
        await worker.idle();
        if (handled === 0) break;
      }
    } finally {
      await worker.stop();
    }
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-12"]]);
    expect(await balance(space, a)).toBe("70");
  });
});
