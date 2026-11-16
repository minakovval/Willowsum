import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
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
  createTransactionsErasure,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";
import {
  createDuplicateCheck,
  createDuplicateMatchingServices,
} from "../src/modules/duplicate-matching/index.ts";

/**
 * Security review probes of PR #278 (FIN-03 16c): money integrity of «Об'єднати», races of merge / delete / hide,
 * idempotency of the hand-off and erasure during it. Copied harness of fin03-duplicates.it.test.ts.
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
          pendingPostings: [],
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

describe("pr278-sec: money integrity of «Об'єднати»", () => {
  it("FIN-03@PoC FR 11, FR 24: a posted duplicate merged into an «Очікує» one — the operation still counts once (balance unchanged)", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "1000.00");
    const res0 = await call(space, "POST", "/v1/transactions", {
      accountId: a,
      amount: { amount: "-30.00", currency: "EUR" },
      date: "2026-10-10",
      counterparty: "Синтетичний переказ",
      status: "pending",
    });
    expect(res0.statusCode, res0.body).toBe(201);
    const pending = res0.json() as Transaction;
    const posted = await add(space, a, "-30.00", "2026-10-11");
    expect(await balance(space, a)).toBe("970");
    const res = await merge(space, pending.id, posted.id);
    // Either the merge is refused, or the operation keeps counting once.
    if (res.statusCode === 200) expect(await balance(space, a)).toBe("970");
    else expect(res.statusCode).toBe(400);
  });

  it("FIN-03@PoC FR 11: the hand-off of a merge and an unmerge run again by the worker changes nothing (idempotent)", async () => {
    const { space, a, first, second } = await twice();
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    await db.owner
      .query(
        `UPDATE transactions.jobs SET state = 'queued', attempts = 0, run_after = now() WHERE household_id = $1`,
        [space.householdId],
      )
      .catch(() => undefined);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("970");
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-10"]]);
    expect((await unmerge(space, second.id)).statusCode).toBe(200);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("940");
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("970");
    expect(await liveEntries(space.householdId)).toEqual([["transaction", "2026-10-10"]]);
  });
});

describe("pr278-sec: refusals of «Об'єднати»", () => {
  it("FIN-03@PoC FR 11, FR 18: a hidden one is neither merged nor the one that stays; nothing is written", async () => {
    const { space, a, first, second } = await twice();
    const third = await add(space, a, "-30.00", "2026-10-11");
    expect((await hide(space, second.id)).statusCode).toBe(200);
    expect((await merge(space, first.id, second.id)).json().errors).toEqual([
      { in: "body", path: "duplicateId", issue: "hidden" },
    ]);
    expect((await merge(space, second.id, third.id)).json().errors).toEqual([
      { in: "body", path: "transactionId", issue: "hidden" },
    ]);
    expect((await get(space, second.id)).mergedInto).toBeNull();
    expect((await get(space, third.id)).mergedInto).toBeNull();
  });
});

describe("pr278-sec: races", () => {
  it("FIN-03@PoC EC4: «Роз'єднати» on both at once — the duplicate comes back once (one audit entry, one posting)", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, a, first, second } = await twice();
      expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
      const both = await Promise.all([unmerge(space, first.id), unmerge(space, second.id)]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
      const log = await audit.entriesFor(space.householdId, {
        type: "transactions.transaction",
        id: second.id,
      });
      expect(log.map((e) => e.action)).toEqual(["create", "update", "update"]);
      expect(await balance(space, a)).toBe("940");
    }
  });

  it("FIN-03@PoC FR 11: one duplicate merged into two others at once — exactly one merge, counts once", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, a, first, second } = await twice();
      const third = await add(space, a, "-30.00", "2026-10-11");
      const both = await Promise.all([merge(space, first.id, second.id), merge(space, third.id, second.id)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400]);
      expect(await balance(space, a)).toBe("940");
    }
  });

  it("FIN-03@PoC FR 11: A into B and B into A at once — exactly one, never both hidden", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, a, first, second } = await twice();
      const both = await Promise.all([merge(space, first.id, second.id), merge(space, second.id, first.id)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400]);
      const hidden = [await get(space, first.id), await get(space, second.id)].filter((t) => t.hidden);
      expect(hidden).toHaveLength(1);
      expect(await balance(space, a)).toBe("970");
    }
  });

  it("FIN-03@PoC FR 11: deleting the one that stays while a duplicate is merged into it — never an orphan merged duplicate", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, a, first, second } = await twice();
      const [m, d] = await Promise.all([
        merge(space, first.id, second.id),
        call(space, "DELETE", `/v1/transactions/${first.id}`),
      ]);
      const dup = await get(space, second.id);
      if (d.statusCode === 204 || d.statusCode === 200) {
        expect(m.statusCode).not.toBe(200);
        expect(dup.mergedInto).toBeNull();
        expect(await balance(space, a)).toBe("970");
      } else {
        expect(m.statusCode).toBe(200);
        expect(d.statusCode).toBe(409);
        expect(await balance(space, a)).toBe("970");
      }
    }
  });

  it("FIN-03@PoC FR 18: hiding one copy while the other is merged — the operation stays in the list once", async () => {
    for (let round = 0; round < 5; round++) {
      const { space, first, second } = await twice();
      await Promise.all([hide(space, first.id), merge(space, first.id, second.id)]);
      const shown = await listed(space);
      expect(shown.length).toBeLessThanOrEqual(1);
      const rows = [await get(space, first.id), await get(space, second.id)];
      // Never both out of the list unless one is merged into the other (then «Роз'єднати» gives it back).
      if (rows.every((r) => r.hidden)) expect(rows.some((r) => r.mergedInto !== null)).toBe(true);
    }
  });
});

describe("pr278-sec: isolation and erasure", () => {
  it("FIN-03@PoC AC11: «Роз'єднати» and «Не дубль» with another space's ids find nothing and write nothing", async () => {
    const mine = await twice();
    const theirs = await twice();
    await merge(theirs.space, theirs.first.id, theirs.second.id);
    expect((await unmerge(mine.space, theirs.second.id)).statusCode).toBe(404);
    expect((await unmerge(mine.space, theirs.first.id)).statusCode).toBe(404);
    expect((await notDuplicate(mine.space, theirs.first.id, mine.first.id)).statusCode).toBe(404);
    const cross = await notDuplicate(mine.space, mine.first.id, theirs.first.id);
    expect(cross.statusCode).toBe(400);
    expect((await get(theirs.space, theirs.second.id)).mergedInto).toBe(theirs.first.id);
    const mineSeen = await call(mine.space, "GET", `/v1/transactions/${theirs.first.id}`);
    expect(mineSeen.statusCode).toBe(404);
  });

  it("NFR-12@PoC FR 3: erasure while a merge's hand-off is queued leaves no row of the space, «Не дубль» included; the worker then does nothing", async () => {
    const { space, a, first, second } = await twice();
    const third = await add(space, a, "-30.00", "2026-10-11");
    vi.spyOn(ledger, "reverse").mockRejectedValue(new Error("injected"));
    expect((await merge(space, first.id, second.id)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect((await notDuplicate(space, first.id, third.id)).statusCode).toBe(200);
    await createTransactionsErasure(db.databases.for("transactions")).eraseHousehold(space.householdId);
    for (const table of ["transactions", "duplicate_dismissals", "jobs"]) {
      const { rows } = await db.owner.query(
        `SELECT count(*)::int AS n FROM transactions.${table} WHERE household_id = $1`,
        [space.householdId],
      );
      expect(rows[0].n, table).toBe(0);
    }
    await runWorker(space.householdId);
  });
});
