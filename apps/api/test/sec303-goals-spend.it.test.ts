import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { rowCount, withTestErasureDatabases } from "./erasure-helpers.ts";
import { publishEvent } from "../src/platform/queue/index.ts";
import { entryRecorded } from "../src/modules/ledger/index.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createTransactionLookup, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { leakText } from "./leak-text.ts";

/**
 * BUD-05@PoC b) (wave 2 row 28), the server part: «Витратити» from a goal, «Скасувати витрату», the automatic cancel when
 * the spent transaction is changed or deleted (through the journal's reversal of its event, ARC-11), and closing a goal
 * — through the real API on a real PostgreSQL with the real transactions, accounts and ledger modules. Every name and
 * amount is synthetic; the clock is the test's own (October 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
/** Runs once after the next read of a transaction's journal events by goals — a change by another request meanwhile. */
let afterLiveEntries: (() => Promise<unknown>) | undefined;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    // Until nothing is left: a ledger event becomes a goals job on one pass, the spend's audit hand-off on a later one.
    for (let i = 0; i < 50; i++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
}

async function account(space: Space, amount: string, kind = "savings"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind}`,
    balance: eur(amount),
    balanceDate: "2026-10-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

/** A transaction entered by hand (FIN-03): negative — an expense. */
async function transaction(space: Space, accountId: string, amount: string, date = "2026-10-12") {
  const res = await call(space, "POST", "/v1/transactions", { accountId, amount: eur(amount), date });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

interface GoalJson {
  readonly id: string;
  readonly collected: { amount: string };
  readonly spends: { id: string; transactionId: string; amount: { amount: string } }[];
  readonly [field: string]: unknown;
}

async function goal(space: Space, body: Record<string, unknown>): Promise<GoalJson> {
  const res = await call(space, "POST", "/v1/goals", {
    template: "travel",
    name: "Відпустка",
    target: eur("4000.00"),
    targetDate: "2027-07-01",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const spend = (space: Space, goalId: string, items: [string, string][]) =>
  call(space, "POST", `/v1/goals/${goalId}/spends`, {
    transactions: items.map(([transactionId, accountId]) => ({ transactionId, accountId })),
  });

const getGoal = async (space: Space, id: string): Promise<GoalJson> =>
  (await call(space, "GET", `/v1/goals/${id}`)).json();

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const accounts = createAccountDirectory(db.databases.for("accounts"));
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
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
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
        }),
        goals: createGoalsServices({
          accounts,
          ledger: {
            ...ledger,
            liveEntries: async (...args: Parameters<typeof ledger.liveEntries>) => {
              const live = await ledger.liveEntries(...args);
              const hook = afterLiveEntries;
              afterLiveEntries = undefined;
              await hook?.();
              return live;
            },
          },
          transactions: createTransactionLookup(db.databases.for("transactions")),
          audit,
          clock,
          newId: randomUUID,
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

afterEach(() => {
  vi.restoreAllMocks();
  afterLiveEntries = undefined;
});

/** AC2's space: «Відпустка» with 4 000 € in an envelope on savings, the hotel 1 800 € and the flights 1 100 € paid from it. */
async function vacation() {
  const space = await newSpace();
  const savings = await account(space, "6000.00");
  const g = await goal(space, { part: { kind: "envelope", accountId: savings, startAmount: "4000.00" } });
  const hotel = await transaction(space, savings, "-1800.00", "2026-10-10");
  const flights = await transaction(space, savings, "-1100.00", "2026-10-12");
  return { space, savings, g, hotel, flights };
}

// ===== security review of #303: probes =====
describe("security review #303: «Витратити» guards", () => {
  it("SEC-303: a transfer side and a pending («Очікує») transaction are refused; nothing written", async () => {
    const { space, savings, g } = await vacation();
    const out = await transaction(space, savings, "-300.00");
    await runWorker(space.householdId);
    // The facts read only the column: a side of a transfer, set past the FKs (as #293's probes).
    await db.owner.query("BEGIN");
    await db.owner.query("SET LOCAL session_replication_role = replica");
    await db.owner.query(
      `UPDATE transactions.transactions SET transfer_id = gen_random_uuid() WHERE household_id = $1 AND id = $2`,
      [space.householdId, out],
    );
    await db.owner.query("COMMIT");
    // No journal event in effect («Очікує» has none): the posted event reversed in the ledger directly.
    const unposted = await transaction(space, savings, "-50.00");
    const merged = await transaction(space, savings, "-60.00");
    await runWorker(space.householdId);
    const ledger = createLedger(db.databases.for("ledger"));
    const [live] = await ledger.liveEntries(
      space.householdId,
      { module: "transactions", id: unposted },
      "transaction",
    );
    await ledger.reverse(space.householdId, live!.id, `sec303:${live!.id}`);
    await db.owner.query("BEGIN");
    await db.owner.query("SET LOCAL session_replication_role = replica");
    await db.owner.query(
      `UPDATE transactions.transactions SET merged_into = gen_random_uuid() WHERE household_id = $1 AND id = $2`,
      [space.householdId, merged],
    );
    await db.owner.query("COMMIT");
    const res = await spend(space, g.id, [
      [out, savings],
      [unposted, savings],
      [merged, savings],
    ]);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors).toEqual([
      { in: "body", path: "transactions.0", issue: "transfer" },
      { in: "body", path: "transactions.1", issue: "not_posted" },
      { in: "body", path: "transactions.2", issue: "not_posted" },
    ]);
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("SEC-303: a goal of marks only — another space's account or transaction is «not found», with nothing of theirs in the answer", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    await runWorker(space.householdId);
    const g = await goal(space, { part: { kind: "marks", startAmount: "1000.00" } });
    const mine = await transaction(space, current, "-100.00");
    const stranger = await newSpace();
    const theirAccount = await account(stranger, "777.00", "current");
    const theirs = await transaction(stranger, theirAccount, "-77.00");
    await runWorker(space.householdId);
    await runWorker(stranger.householdId);
    const res = await spend(space, g.id, [
      [mine, theirAccount],
      [theirs, theirAccount],
      [randomUUID(), current],
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual(
      [0, 1, 2].map((i) => ({ in: "body", path: `transactions.${i}`, issue: "not_found" })),
    );
    expect(leakText(res.body)).not.toContain("77");
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
    const again = await spend(space, g.id, [[theirs, current]]);
    expect(again.json().errors).toEqual([{ in: "body", path: "transactions.0", issue: "not_found" }]);
  });

  it("SEC-303: a goal of marks gives exactly what it holds, and an earlier spend counts", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    const g = await goal(space, { part: { kind: "marks", startAmount: "1000.00" } });
    const a = await transaction(space, current, "-600.00");
    const b = await transaction(space, current, "-400.00");
    const c = await transaction(space, current, "-0.01");
    await runWorker(space.householdId);
    expect((await spend(space, g.id, [[a, current]])).statusCode).toBe(201);
    expect((await spend(space, g.id, [[b, current]])).statusCode).toBe(201);
    const over = await spend(space, g.id, [[c, current]]);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "GOAL_SPEND_OVER_COLLECTED", excess: eur("0.01") });
  });

  it("SEC-303: an envelope gives at most what it holds", async () => {
    const space = await newSpace();
    const savings = await account(space, "6000.00");
    const g = await goal(space, { part: { kind: "envelope", accountId: savings, startAmount: "1000.00" } });
    const big = await transaction(space, savings, "-1000.50");
    await runWorker(space.householdId);
    const over = await spend(space, g.id, [[big, savings]]);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "GOAL_SPEND_OVER_COLLECTED", excess: eur("0.5") });
  });

  it("SEC-303: «Скасувати витрату» through another goal's address cancels nothing (404)", async () => {
    const { space, savings, g, hotel } = await vacation();
    await runWorker(space.householdId);
    const s = (await spend(space, g.id, [[hotel, savings]])).json() as GoalJson;
    const other = await goal(space, { name: "Ремонт", part: { kind: "marks", startAmount: "10.00" } });
    expect((await call(space, "DELETE", `/v1/goals/${other.id}/spends/${s.spends[0]!.id}`)).statusCode).toBe(
      404,
    );
    expect((await getGoal(space, g.id)).spends).toHaveLength(1);
  });

  it("SEC-303: a closed goal takes no spend (404)", async () => {
    const { space, savings, g, hotel } = await vacation();
    await runWorker(space.householdId);
    expect((await call(space, "POST", `/v1/goals/${g.id}/close`)).statusCode).toBe(200);
    expect((await spend(space, g.id, [[hotel, savings]])).statusCode).toBe(404);
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
  });
});

describe("security review #303: concurrency", () => {
  it("SEC-303: two simultaneous spends of one transaction from two goals write one spend at most (money)", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    const g1 = await goal(space, { name: "Перша", part: { kind: "marks", startAmount: "1000.00" } });
    const g2 = await goal(space, { name: "Друга", part: { kind: "marks", startAmount: "1000.00" } });
    const t = await transaction(space, current, "-100.00");
    await runWorker(space.householdId);
    const codes: number[] = [];
    for (let round = 0; round < 5; round++) {
      const res = await Promise.all([
        spend(space, g1.id, [[t, current]]),
        spend(space, g2.id, [[t, current]]),
      ]);
      codes.push(...res.map((r) => r.statusCode));
      expect(
        await n("goals.spends WHERE household_id = $1 AND transaction_id = $2", space.householdId, t),
      ).toBe(1);
      await db.owner.query(`DELETE FROM goals.spends WHERE household_id = $1`, [space.householdId]);
    }
    console.log("SEC-303 two goals, one transaction: statuses", codes.join(","));
  });

  it("SEC-303: two simultaneous spends from one goal of marks never take more than it holds", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    const g = await goal(space, { part: { kind: "marks", startAmount: "1000.00" } });
    const ts: string[] = [];
    for (let i = 0; i < 10; i++) ts.push(await transaction(space, current, "-600.00"));
    await runWorker(space.householdId);
    for (let i = 0; i < 10; i += 2) {
      const res = await Promise.all([
        spend(space, g.id, [[ts[i]!, current]]),
        spend(space, g.id, [[ts[i + 1]!, current]]),
      ]);
      expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      await db.owner.query(`DELETE FROM goals.spends WHERE household_id = $1`, [space.householdId]);
    }
  });

  it("SEC-303: simultaneous «Внести» refusal and a spend keep the envelope within its account", async () => {
    const space = await newSpace();
    const savings = await account(space, "1000.00");
    const g = await goal(space, { part: { kind: "envelope", accountId: savings, startAmount: "1000.00" } });
    const t = await transaction(space, savings, "-500.00");
    await runWorker(space.householdId);
    // The account now holds 500 €, the envelope 1 000 € (over the balance); the spend brings it to 500 €.
    const [s, c] = await Promise.all([
      spend(space, g.id, [[t, savings]]),
      call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("1.00"), date: "2026-10-12" }),
    ]);
    expect(s.statusCode, s.body).toBe(201);
    const after = await getGoal(space, g.id);
    expect(after["part"]).toMatchObject({ freeBalance: c.statusCode === 201 ? eur("-1") : eur("0") });
  });
});

describe("security review #303: erasure — publisher (ledger) before consumer (goals)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ws-sec303-"));
    return () => rmSync(dir, { recursive: true, force: true });
  });
  const ERASURE_POOL = new Set(["ledger", "audit"]);
  const erase = (
    hook: (pools: Pick<typeof db.databases, "for">, erasurePool: boolean) => Pick<typeof db.databases, "for">,
    accountId: string,
  ) =>
    withTestErasureDatabases(db, async (erasureDatabases) => {
      const e = createDataErasure({
        databases: hook(db.databases, false),
        erasureDatabases: hook(erasureDatabases, true),
        log: localErasureLog({ dir }),
        now: clock.now,
      });
      const r = await e.request({ accountId });
      return e.run(r.requestId);
    });

  it("SEC-303: one worker pass before any step of the erasure leaves no goals job or row of the erased space", async () => {
    for (const at of [
      "bulk-actions",
      "transactions",
      "categories",
      "categorization",
      "accounts",
      "liabilities",
      "ledger",
      "goals",
      "audit",
    ]) {
      const { space, savings, g, hotel } = await vacation();
      await runWorker(space.householdId);
      expect((await spend(space, g.id, [[hotel, savings]])).statusCode).toBe(201);
      await runWorker(space.householdId);
      const [s] = (
        await db.owner.query(`SELECT entry_id FROM goals.spends WHERE household_id = $1`, [space.householdId])
      ).rows;
      // A pending reversal of the spent event in the ledger's outbox: the worker hands it to goals as a job.
      await db.databases.for("ledger").inHousehold(space.householdId, (q) =>
        publishEvent(q, entryRecorded, {
          entryId: randomUUID(),
          sourceModule: "transactions",
          sourceId: hotel,
          eventType: "reversal",
          operationDate: "2026-10-10",
          recordedAt: "2026-10-17T10:00:00.000000Z",
          reversesEntryId: s!.entry_id as string,
        }),
      );
      let passes = 0;
      let first = true;
      const wrap = (real: ReturnType<typeof db.databases.for>) =>
        new Proxy(real, {
          get(t, p, r) {
            if (p !== "inHousehold") return Reflect.get(t, p, r);
            return async (householdId: string, work: never) => {
              if (first && householdId === space.householdId) {
                first = false;
                passes += 1;
                await runWorker(householdId);
              }
              return t.inHousehold(householdId, work);
            };
          },
        });
      await erase(
        (pools, erasurePool) =>
          ({
            for: (m: string) =>
              m === at && ERASURE_POOL.has(m) === erasurePool
                ? wrap(pools.for(m as never))
                : pools.for(m as never),
          }) as unknown as Pick<typeof db.databases, "for">,
        space.accountId,
      );
      expect(passes, at).toBe(1);
      const left = await db.owner.query(`SELECT name, state FROM goals.jobs WHERE household_id = $1`, [
        space.householdId,
      ]);
      expect(left.rows, `a worker pass before the step of ${at}`).toEqual([]);
      expect(await rowCount(db, space.householdId), at).toBe(0);
    }
  });
});
