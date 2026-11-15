import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createGoalsErasure, createGoalsServices, createGoalSpends } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createTransactionLookup, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

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
    // Twice: a ledger event becomes a goals job on the first pass, the spend's audit hand-off on the next.
    for (let i = 0; i < 3; i++) {
      await worker.tick();
      await worker.idle();
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

const spendAudit = (householdId: string, action: string, actor = "user") =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'goals.spend' AND action = $2 AND actor_kind = $3",
    householdId,
    action,
    actor,
  );

const spent = (householdId: string, ids: string[]) =>
  createGoalSpends(db.databases.for("goals")).spent(householdId, ids);

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

describe("BUD-05@PoC FR 8: «Витратити» from a goal", () => {
  it("BUD-05@PoC AC2 (server part): hotel 1 800 € and flights 1 100 € spent from «Відпустка» with 4 000 € — 1 100 € left; both «з цілі», no longer in «Можна витратити»", async () => {
    const { space, savings, g, hotel, flights } = await vacation();
    expect((await spent(space.householdId, [hotel, flights])).size).toBe(0);
    const res = await spend(space, g.id, [
      [hotel, savings],
      [flights, savings],
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const after = res.json() as GoalJson;
    expect(after.collected).toEqual(eur("1100"));
    expect(after.spends.map((s) => [s.transactionId, s.amount.amount])).toEqual([
      [flights, "1100"],
      [hotel, "1800"],
    ]);
    // The account paid 2 900 €, and the envelope gave it up: 3 100 € on the account, 1 100 € reserved, 2 000 € free.
    expect(after["part"]).toMatchObject({ freeBalance: eur("2000") });
    // «Можна витратити» (BUD-03) and the comparison of expenses (BUD-06) read these as written off from the goal.
    const marked = await spent(space.householdId, [hotel, flights]);
    expect([...marked.keys()].sort()).toEqual([hotel, flights].sort());
    expect(marked.get(hotel)).toMatchObject({ goalId: g.id });
    expect(marked.get(hotel)!.amount.toDecimalString()).toBe("1800");
    expect(await spendAudit(space.householdId, "create")).toBe(2);
  });

  it("BUD-05@PoC FR 8: only outgoing transactions of the goal's account in its currency, each once — else refused, nothing written", async () => {
    const { space, savings, g, hotel } = await vacation();
    const current = await account(space, "500.00", "current");
    const coffee = await transaction(space, current, "-4.50");
    const salary = await transaction(space, savings, "200.00");
    const stranger = await newSpace();
    const theirs = await transaction(stranger, await account(stranger, "100.00"), "-10.00");
    const res = await spend(space, g.id, [
      [hotel, savings],
      [coffee, current],
      [salary, savings],
      [theirs, savings],
      [hotel, savings],
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      { in: "body", path: "transactions.1", issue: "not_goal_account" },
      { in: "body", path: "transactions.2", issue: "not_outflow" },
      { in: "body", path: "transactions.3", issue: "not_found" },
      { in: "body", path: "transactions.4", issue: "duplicate" },
    ]);
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
    // A transaction is spent from one goal at most.
    expect((await spend(space, g.id, [[hotel, savings]])).statusCode).toBe(201);
    const other = await goal(space, { name: "Ремонт", part: { kind: "marks", startAmount: "3000.00" } });
    const again = await spend(space, other.id, [[hotel, savings]]);
    expect(again.json().errors).toEqual([{ in: "body", path: "transactions.0", issue: "spent" }]);
  });

  it("BUD-05@PoC FR 8: a goal of marks only takes an outflow of any account of the space; never more than it holds (409, nothing written)", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    const g = await goal(space, { part: { kind: "marks", startAmount: "1000.00" } });
    const sofa = await transaction(space, current, "-900.00");
    const tv = await transaction(space, current, "-200.00");
    const over = await spend(space, g.id, [
      [sofa, current],
      [tv, current],
    ]);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "GOAL_SPEND_OVER_COLLECTED", excess: eur("100") });
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
    const ok = await spend(space, g.id, [[sofa, current]]);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().collected).toEqual(eur("100"));
  });

  it("BUD-05@PoC FR 8: a goal on its own account — the spend already took from its balance, so collected stays the balance and the pace is not lowered", async () => {
    const space = await newSpace();
    const reserve = await account(space, "3000.00");
    const g = await goal(space, {
      template: "emergency",
      name: "Подушка",
      part: { kind: "account", accountId: reserve },
    });
    const repair = await transaction(space, reserve, "-500.00");
    const before = await getGoal(space, g.id);
    expect(before.collected).toEqual(eur("2500"));
    const res = await spend(space, g.id, [[repair, reserve]]);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ collected: eur("2500"), pace: before["pace"] });
  });
});

describe("BUD-05@PoC AC5, EC5: a spent transaction changed or deleted — the spend is cancelled automatically", () => {
  it("BUD-05@PoC AC5: the hotel's amount changed by hand to 1 600 € — 1 800 € go back to the goal, the transaction counts in «Можна витратити» again", async () => {
    const { space, savings, g, hotel, flights } = await vacation();
    await spend(space, g.id, [
      [hotel, savings],
      [flights, savings],
    ]);
    const changed = await call(space, "PATCH", `/v1/transactions/${hotel}`, { amount: eur("-1600.00") });
    expect(changed.statusCode, changed.body).toBe(200);
    await runWorker(space.householdId);
    const after = await getGoal(space, g.id);
    expect(after.collected).toEqual(eur("2900"));
    expect(after.spends.map((s) => s.transactionId)).toEqual([flights]);
    expect([...(await spent(space.householdId, [hotel, flights])).keys()]).toEqual([flights]);
    expect(await spendAudit(space.householdId, "delete", "system")).toBe(1);
  });

  it("BUD-05@PoC EC5: the spent transaction deleted — the spend is cancelled; a change the journal does not record (the description) keeps it", async () => {
    const { space, savings, g, hotel, flights } = await vacation();
    await spend(space, g.id, [
      [hotel, savings],
      [flights, savings],
    ]);
    const described = await call(space, "PATCH", `/v1/transactions/${flights}`, {
      description: "Квитки до Риму",
    });
    expect(described.statusCode, described.body).toBe(200);
    expect((await call(space, "DELETE", `/v1/transactions/${hotel}`)).statusCode).toBe(200);
    await runWorker(space.householdId);
    const after = await getGoal(space, g.id);
    expect(after.spends.map((s) => s.transactionId)).toEqual([flights]);
    expect(after.collected).toEqual(eur("2900"));
    // Again: the cancel is idempotent — the job's retry finds nothing more to cancel.
    await runWorker(space.householdId);
    expect(await spendAudit(space.householdId, "delete", "system")).toBe(1);
  });

  it("BUD-05@PoC AC5: «Скасувати витрату» cancels the spend without changing the transaction", async () => {
    const { space, savings, g, hotel } = await vacation();
    const s = (await spend(space, g.id, [[hotel, savings]])).json() as GoalJson;
    const res = await call(space, "DELETE", `/v1/goals/${g.id}/spends/${s.spends[0]!.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ collected: eur("4000"), spends: [] });
    const t = (await call(space, "GET", `/v1/transactions/${hotel}`)).json();
    expect(t.amount).toEqual(eur("-1800"));
    expect(await spendAudit(space.householdId, "delete")).toBe(1);
    expect((await call(space, "DELETE", `/v1/goals/${g.id}/spends/${s.spends[0]!.id}`)).statusCode).toBe(404);
  });

  it("BUD-05@PoC AC5: a transaction changed while «Витратити» is saved is cancelled right after the commit", async () => {
    const { space, savings, g, hotel } = await vacation();
    afterLiveEntries = () => call(space, "PATCH", `/v1/transactions/${hotel}`, { amount: eur("-1700.00") });
    const res = await spend(space, g.id, [[hotel, savings]]);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ collected: eur("4000"), spends: [] });
    expect(await spendAudit(space.householdId, "delete", "system")).toBe(1);
  });
});

describe("BUD-05@PoC FR 9, FR 13: closing and deleting a goal", () => {
  it("BUD-05@PoC FR 9: a goal not fully collected is closed — it leaves the list and the card, its spends stay, its account is free", async () => {
    const { space, savings, g, hotel } = await vacation();
    await spend(space, g.id, [[hotel, savings]]);
    const res = await call(space, "POST", `/v1/goals/${g.id}/close`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ closed: true });
    expect((await call(space, "GET", "/v1/goals")).json()).toEqual({ goals: [] });
    expect((await call(space, "GET", `/v1/goals/${g.id}`)).statusCode).toBe(404);
    expect((await call(space, "POST", `/v1/goals/${g.id}/close`)).statusCode).toBe(404);
    expect((await call(space, "PATCH", `/v1/goals/${g.id}`, { name: "Знову" })).statusCode).toBe(404);
    // No archive in this release; the transaction stays written off from the goal, the history is in the audit log.
    expect((await spent(space.householdId, [hotel])).get(hotel)).toMatchObject({ goalId: g.id });
    expect(
      await n(
        "audit.entries e, jsonb_array_elements(e.changes) c WHERE e.household_id = $1 AND e.entity_type = 'goals.goal' AND e.action = 'update' AND c->>'field' = 'closedOn'",
        space.householdId,
      ),
    ).toBe(1);
    // The closed envelope reserves nothing: the account is free for its own goal.
    const own = await goal(space, { name: "Окремий", part: { kind: "account", accountId: savings } });
    expect(own["collected"]).toEqual(eur("4200"));
  });

  it("BUD-05@PoC FR 13: «Закрити без витрати» of a reached goal, and «Видалити» of a goal with spends — their transactions are ordinary expenses again", async () => {
    const space = await newSpace();
    const current = await account(space, "3000.00", "current");
    const reached = await goal(space, {
      name: "Ноутбук",
      target: eur("500.00"),
      part: { kind: "marks", startAmount: "500.00" },
    });
    expect(reached["achieved"]).toBe(true);
    expect((await call(space, "POST", `/v1/goals/${reached.id}/close`)).statusCode).toBe(200);
    const g = await goal(space, { part: { kind: "marks", startAmount: "1000.00" } });
    const sofa = await transaction(space, current, "-900.00");
    await spend(space, g.id, [[sofa, current]]);
    expect((await call(space, "DELETE", `/v1/goals/${g.id}`)).statusCode).toBe(200);
    expect((await spent(space.householdId, [sofa])).size).toBe(0);
    expect(await n("goals.spends WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await spendAudit(space.householdId, "delete")).toBe(1);
  });
});

describe("BUD-05@PoC AC6: the space's boundary of «Витратити» and closing", () => {
  it("BUD-05@PoC AC6: another space's user gets «not found» for spending from, cancelling and closing this space's goal", async () => {
    const { space, savings, g, hotel } = await vacation();
    const s = (await spend(space, g.id, [[hotel, savings]])).json() as GoalJson;
    const stranger = await newSpace();
    for (const [method, url, body] of [
      ["POST", `/v1/goals/${g.id}/spends`, { transactions: [{ transactionId: hotel, accountId: savings }] }],
      ["DELETE", `/v1/goals/${g.id}/spends/${s.spends[0]!.id}`, undefined],
      ["POST", `/v1/goals/${g.id}/close`, undefined],
    ] as const) {
      const res = await call(stranger, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.body).not.toContain("1800");
    }
    expect((await getGoal(space, g.id)).spends).toHaveLength(1);
  });
});

describe("BUD-05@PoC «Кожна … списання … пишуться в журнал аудиту»: the goals queue (ARC-04, #249)", () => {
  it("ARC-04@PoC FR 4: a goals job of a reversed transaction in state dead goes back with the daily recovery and cancels the spend", async () => {
    const { space, savings, g, hotel } = await vacation();
    await spend(space, g.id, [[hotel, savings]]);
    await runWorker(space.householdId);
    expect((await call(space, "DELETE", `/v1/transactions/${hotel}`)).statusCode).toBe(200);
    // The ledger's event becomes a goals job (goals' jobs not taken meanwhile); the job gives up (dead).
    const worker = createWorker({
      ...workerQueues(db.databases),
      households: async () => [space.householdId],
      moduleAvailable: async (module) => module !== "goals",
    });
    await worker.tick();
    await worker.idle();
    await worker.stop();
    await db.owner.query(
      `UPDATE goals.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'goals.entry-recorded' AND state = 'queued'`,
      [space.householdId],
    );
    expect(
      await n("goals.jobs WHERE household_id = $1 AND state = 'dead'", space.householdId),
    ).toBeGreaterThan(0);
    await runWorker(space.householdId);
    expect((await getGoal(space, g.id)).spends).toHaveLength(1);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    await tasks.find((t) => t.name === "goals.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect((await getGoal(space, g.id)).spends).toHaveLength(0);
    expect(await spendAudit(space.householdId, "delete", "system")).toBe(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes its spends and closed goals too", async () => {
    const { space, savings, g, hotel } = await vacation();
    await spend(space, g.id, [[hotel, savings]]);
    await call(space, "POST", `/v1/goals/${g.id}/close`);
    const erased = await createGoalsErasure(db.databases.for("goals")).eraseHousehold(space.householdId);
    expect(erased).toMatchObject({ goals: 1, spends: 1 });
    expect(await n("goals.goals WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
