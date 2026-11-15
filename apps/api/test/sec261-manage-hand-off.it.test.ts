// ===== FILE: apps/api/test/sec261-manage-hand-off.it.test.ts =====
// Security review of PR #261 (ARC-04 c). Harness copied from arc04-accounts-manage-hand-off.it.test.ts.
import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import {
  createAccountsWorkerQueue,
  createAccountStatements,
  createAccountsServices,
  type AccountsServices,
} from "../src/modules/accounts/index.ts";

/**
 * ARC-04@PoC FR 2–4 (issue #252 item 3; ADR-0015): managing an account — closing with its balance transferred or
 * written off, «Відкрити знову», «Оновити залишок», deleting its adjustment, a statement's recount — and the audit
 * entries of «Основне» and «Реквізити» write the accounts row and the hand-off job in one accounts transaction; the
 * journal and the audit log follow only after it commits, right away and — if that fails — from the worker, each step
 * once. A later change of the same account's money is planned only after the earlier one's journal entries are in.
 * Real API, real PostgreSQL, synthetic data.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let liabilities: Liabilities;
let services: AccountsServices;
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

function call(space: Space, method: "POST" | "PATCH" | "GET" | "DELETE", url: string, body?: unknown) {
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

/** A current account with its hand-off finished. */
async function account(space: Space, name: string, amount: string): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name,
    balance: eur(amount),
    balanceDate: "2026-10-01",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function balance(space: Space, accountId: string): Promise<string> {
  const res = await call(space, "GET", `/v1/accounts/${accountId}`);
  expect(res.statusCode).toBe(200);
  return res.json().currencies[0].balance.amount as string;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const entriesOf = (householdId: string, eventType: string) =>
  n("ledger.entries WHERE household_id = $1 AND event_type = $2", householdId, eventType);

/** The audit entries of one account and of its adjustments (entity `accounts.balance-adjustment`). */
async function auditOf(householdId: string, accountId: string) {
  const ofAccount = await audit.entriesFor(householdId, { type: "accounts.account", id: accountId });
  const { rows } = await db.owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit.entries e JOIN accounts.subaccounts s
        ON s.household_id = e.household_id AND s.id = e.entity_id
      WHERE e.household_id = $1 AND e.entity_type = 'accounts.balance-adjustment' AND s.account_id = $2`,
    [householdId, accountId],
  );
  return {
    updates: ofAccount.filter((e) => e.action === "update"),
    adjustments: rows[0]!.n,
  };
}

/** The hand-off jobs of the space that are not done yet. */
const pendingJobs = (householdId: string) =>
  n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", householdId);

/** One pass of the worker as main.ts wires it, until the jobs it took have ended. */
async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

/** Fails `audit.record` of the entity type once (or until restored, with `always`). */
function failAuditOf(type: string, always = false): void {
  const original = audit.record.bind(audit);
  let failed = false;
  vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
    if ((always || !failed) && entry.entity.type === type) {
      failed = true;
      throw new Error("injected");
    }
    return original(householdId, entry);
  });
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  services = createAccountsServices({
    walletUsage: [],
    ledger,
    liabilities,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    audit,
    clock: { now: () => NOW },
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => vi.restoreAllMocks());

const jobsText = async (householdId: string) =>
  JSON.stringify(
    (
      await db.owner.query(
        `SELECT dedupe_key, payload, last_error FROM accounts.jobs WHERE household_id = $1`,
        [householdId],
      )
    ).rows,
  );
const auditText = async (householdId: string) =>
  JSON.stringify(
    (await db.owner.query(`SELECT * FROM audit.entries WHERE household_id = $1`, [householdId])).rows,
  );
const live = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/accounts/${id}`)).json().adjustments as { id: string; amount: unknown }[];
const updateTo = (space: Space, id: string, amount: string) =>
  call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur(amount) });

describe("sec261: no balance moves twice, no journal move is lost", () => {
  it("sec261: create, change, delete and create the adjustment again with every hand-off replayed by the worker afterwards — each journal move once, the balance last entered, one audit entry per change", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    // 1: deferred (the journal is away right after the commit).
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await updateTo(space, id, "280.00")).statusCode).toBe(200);
    vi.restoreAllMocks();
    // 2: finishes 1, corrects it; 3: deletes; 4: a new one; 5: corrects 4 — the worker has run none of them.
    expect((await updateTo(space, id, "250.00")).statusCode).toBe(200);
    const [adjustment] = await live(space, id);
    expect(
      (await call(space, "DELETE", `/v1/accounts/${id}/balance-adjustments/${adjustment!.id}`)).statusCode,
    ).toBe(200);
    expect(await balance(space, id)).toBe("300");
    expect((await updateTo(space, id, "310.00")).statusCode).toBe(200);
    expect((await updateTo(space, id, "305.50")).statusCode).toBe(200);
    expect(await pendingJobs(space.householdId)).toBe(5);
    const journal = async () =>
      (
        await db.owner.query(
          `SELECT event_type, count(*)::int AS n FROM ledger.entries WHERE household_id = $1 GROUP BY 1 ORDER BY 1`,
          [space.householdId],
        )
      ).rows;
    const before = await journal();
    for (let i = 0; i < 3; i++) await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await journal()).toEqual(before);
    // post, correct (reversal + entry), reverse, post, correct (reversal + entry): 4 adjustments, 3 reversals.
    expect(before).toEqual(
      expect.arrayContaining([
        { event_type: "balance-adjustment", n: 4 },
        { event_type: "reversal", n: 3 },
      ]),
    );
    expect(await balance(space, id)).toBe("305.5");
    const now = await live(space, id);
    expect(now).toHaveLength(1);
    expect(now[0]!.amount).toEqual(eur("5.5"));
    expect((await auditOf(space.householdId, id)).adjustments).toBe(5);
  });

  it("sec261: twelve concurrent «Оновити залишок» with the worker running beside them leave one adjustment in effect, a balance one of them entered, and one audit entry per change made", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    const amounts = Array.from({ length: 12 }, (_, i) => `${200 + i * 7}.25`);
    const results = await Promise.all([
      ...amounts.map((a) => updateTo(space, id, a)),
      runWorker(space.householdId),
      runWorker(space.householdId),
    ]);
    const answers = results.filter((r): r is Awaited<ReturnType<typeof updateTo>> => r !== undefined);
    expect(answers.map((r) => r.statusCode)).toEqual(amounts.map(() => 200));
    for (let i = 0; i < 3; i++) await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    const now = await live(space, id);
    expect(now).toHaveLength(1);
    const end = await balance(space, id);
    expect(amounts.map((a) => Money.of(a, "EUR").toDecimalString())).toContain(end);
    // The journal's own sum: the opening balance plus the one adjustment in effect.
    expect(
      Money.of("300", "EUR")
        .plus(Money.of((now[0]!.amount as { amount: string }).amount, "EUR"))
        .toDecimalString(),
    ).toBe(end);
    const made = answers.filter((r) => r.json().changed).length;
    expect((await auditOf(space.householdId, id)).adjustments).toBe(made);
    expect(
      await n("accounts.jobs WHERE household_id = $1 AND payload->>'kind' = 'managed'", space.householdId),
    ).toBe(made);
  });

  it("sec261: a closing by write-off deferred, reopened, then «Оновити залишок»: the write-off goes in before the new balance is planned, once", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "120.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect(
      (
        await call(space, "POST", `/v1/accounts/${id}/close`, {
          closedOn: TODAY,
          settlement: { kind: "adjustment" },
        })
      ).statusCode,
    ).toBe(200);
    vi.restoreAllMocks();
    expect((await call(space, "POST", `/v1/accounts/${id}/reopen`)).statusCode).toBe(200);
    expect((await updateTo(space, id, "50.00")).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("50");
    expect(await live(space, id)).toHaveLength(1);
    expect(await pendingJobs(space.householdId)).toBe(0);
    // Written off (created), then changed: two audit entries of the adjustment; closed and reopened: two of the account.
    const log = await auditOf(space.householdId, id);
    expect(log.adjustments).toBe(2);
    expect(log.updates).toHaveLength(2);
  });

  it("sec261: with the journal away, a later change of the account's money is refused rather than planned without the earlier one's moves", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    expect((await updateTo(space, id, "280.00")).statusCode).toBe(200);
    const second = await updateTo(space, id, "250.00");
    expect(second.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(
      await n("accounts.jobs WHERE household_id = $1 AND payload->>'kind' = 'managed'", space.householdId),
    ).toBe(1);
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("280");
  });
});

describe("sec261: survivors of the mutation run", () => {
  it("sec261: a dead hand-off's moves are finished before the account's next «Оновити залишок»; the recovery then moves nothing again", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await updateTo(space, id, "280.00")).statusCode).toBe(200);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE accounts.jobs SET state = 'dead', attempts = 8, finished_at = now() WHERE household_id = $1 AND state = 'queued'`,
      [space.householdId],
    );
    expect((await updateTo(space, id, "250.00")).statusCode).toBe(200);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((t) => t.name === "accounts.hand-off-recovery")!.run();
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, id)).toBe("250");
    const now = await live(space, id);
    expect(now).toHaveLength(1);
    expect(now[0]!.amount).toEqual(eur("-50"));
  });

  it("sec261: a running hand-off whose worker ended (its lease still held) is finished before the account's next change", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await updateTo(space, id, "280.00")).statusCode).toBe(200);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE accounts.jobs SET state = 'running', attempts = 1, lease_owner = gen_random_uuid(), lease_until = now() + interval '1 second'
        WHERE household_id = $1 AND state = 'queued'`,
      [space.householdId],
    );
    expect((await updateTo(space, id, "250.00")).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("250");
    expect(await live(space, id)).toHaveLength(1);
  });

  it("sec261: «Основне» and «Реквізити» handed over right away and again by the worker — one audit entry each", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "10.00");
    await runWorker(space.householdId);
    expect((await call(space, "PATCH", `/v1/accounts/${id}`, { name: "Сімейний" })).statusCode).toBe(200);
    expect(
      (await call(space, "PATCH", `/v1/accounts/${id}/details`, { note: "Синтетична нотатка 31" }))
        .statusCode,
    ).toBe(200);
    expect((await auditOf(space.householdId, id)).updates).toHaveLength(2);
    expect(await pendingJobs(space.householdId)).toBe(2);
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect((await auditOf(space.householdId, id)).updates).toHaveLength(2);
  });

  it("sec261: two closings by transfer of the same account, each with money on it, are two transfers — the second is not taken for the first", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    expect((await call(space, "POST", `/v1/accounts/${from}/reopen`)).statusCode).toBe(200);
    expect((await updateTo(space, from, "100.00")).statusCode).toBe(200);
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(2);
    expect(await balance(space, from)).toBe("0");
    expect(await balance(space, to)).toBe("530");
    // Two transfers, two closings, one reopening.
    expect((await auditOf(space.householdId, from)).updates).toHaveLength(5);
  });

  it("sec261: a statement's recount right after a deferred «Оновити залишок» recounts the adjustment that is on its way", async () => {
    const space = await newSpace();
    const id = await account(space, "Імпортований", "1000.00");
    await db.owner.query(
      `UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`,
      [space.householdId, id],
    );
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await updateTo(space, id, "1040.00")).statusCode).toBe(200);
    vi.restoreAllMocks();
    const statements = createAccountStatements(db.databases.for("accounts"), services);
    const result = await statements.reconcile(space.householdId, {
      accountId: id,
      statementEnd: TODAY,
      closingBalance: Money.of("1030.00", "EUR"),
    });
    expect(result.kind).toBe("changed");
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("1030");
    expect(await live(space, id)).toHaveLength(1);
  });
});

describe("sec261: the money of another account", () => {
  // Finding (non-blocking candidate): the moves of a closing by transfer that are not handed over yet are finished only
  // before a change of the closed account itself, not of the account the balance goes to.
  it("sec261: a transfer on its way to an account is in before that account is closed (FIN-12 FR 7: closed only with a zero balance)", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect(
      (
        await call(space, "POST", `/v1/accounts/${from}/close`, {
          closedOn: TODAY,
          settlement: { kind: "transfer", toAccountId: to },
        })
      ).statusCode,
    ).toBe(200);
    vi.restoreAllMocks();
    const closing = await call(space, "POST", `/v1/accounts/${to}/close`, { closedOn: TODAY });
    for (let i = 0; i < 3; i++) await runWorker(space.householdId);
    const end = (await call(space, "GET", `/v1/accounts/${to}`)).json();
    // Either the closing was refused (the balance is not zero), or the account is not closed with money on it.
    expect(
      closing.statusCode === 409 || end.currencies[0].balance.amount === "0" || end.status === "active",
    ).toBe(true);
  });
});

describe("sec261: isolation of the hand-off jobs between spaces", () => {
  it("sec261: a managing job of another space that names this space's account is neither finished by this space's next change nor run on this space's journal", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const id = await account(mine, "Готівка", "300.00");
    const other = await account(theirs, "Чужий", "50.00");
    await runWorker(mine.householdId);
    await runWorker(theirs.householdId);
    const sub = (
      await db.owner.query<{ id: string; ledger_account_id: string }>(
        `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
        [mine.householdId, id],
      )
    ).rows[0]!;
    // A forged row in the other space's queue (only the database owner can write one): this space's account and ledger account.
    const changeId = randomUUID();
    await db.owner.query(
      `INSERT INTO accounts.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'accounts.hand-off', $2, $3)`,
      [
        theirs.householdId,
        `managed:${id}:${changeId}`,
        JSON.stringify({
          kind: "managed",
          accountId: id,
          changeId,
          actor: { kind: "user", id: theirs.accountId },
          channel: "web",
          moves: [
            {
              op: "adjust",
              subaccountId: sub.id,
              currency: "EUR",
              ledgerAccountId: sub.ledger_account_id,
              date: TODAY,
              plan: { kind: "post", amount: "-299" },
              before: null,
            },
          ],
          status: null,
        }),
      ],
    );
    expect((await updateTo(mine, id, "290.00")).statusCode).toBe(200);
    for (let i = 0; i < 2; i++) {
      await runWorker(mine.householdId);
      await runWorker(theirs.householdId);
    }
    expect(await balance(mine, id)).toBe("290");
    expect(await live(mine, id)).toHaveLength(1);
    expect(await balance(theirs, other)).toBe("50");
    expect(
      await n(
        "ledger.entries WHERE household_id = $1 AND event_type = 'balance-adjustment'",
        mine.householdId,
      ),
    ).toBe(1);
    expect(
      await n(
        "ledger.entries WHERE household_id = $1 AND event_type = 'balance-adjustment'",
        theirs.householdId,
      ),
    ).toBe(0);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'accounts.balance-adjustment'",
        theirs.householdId,
      ),
    ).toBe(0);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'accounts.balance-adjustment'",
        mine.householdId,
      ),
    ).toBe(1);
  });

  it("sec261: the daily recovery of one space's dead hand-offs leaves another space's dead job as it is; the worker of one space runs no job of another", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const a = await account(mine, "Готівка", "300.00");
    const b = await account(theirs, "Чужий", "50.00");
    await runWorker(mine.householdId);
    await runWorker(theirs.householdId);
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    expect((await updateTo(mine, a, "250.00")).statusCode).toBe(200);
    expect((await updateTo(theirs, b, "40.00")).statusCode).toBe(200);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE accounts.jobs SET state = 'dead', attempts = 8, finished_at = now() WHERE state = 'queued' AND household_id = ANY($1)`,
      [[mine.householdId, theirs.householdId]],
    );
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [mine.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((t) => t.name === "accounts.hand-off-recovery")!.run();
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'dead'", theirs.householdId)).toBe(1);
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'queued'", mine.householdId)).toBe(1);
    await runWorker(mine.householdId);
    expect(await balance(mine, a)).toBe("250");
    expect(await balance(theirs, b)).toBe("50");
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'dead'", theirs.householdId)).toBe(1);
  });

  it("sec261: another space's member gets 404 for close, reopen, «Оновити залишок» and deleting an adjustment, and nothing is queued in either space", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const id = await account(mine, "Готівка", "300.00");
    await runWorker(mine.householdId);
    const updated = await updateTo(mine, id, "250.00");
    await runWorker(mine.householdId);
    const jobs = () =>
      n("accounts.jobs WHERE household_id = ANY($1)", [mine.householdId, theirs.householdId]);
    const before = await jobs();
    const unknown = randomUUID();
    for (const [method, path, body] of [
      ["POST", "close", { closedOn: TODAY, settlement: { kind: "adjustment" } }],
      ["POST", "reopen", undefined],
      ["POST", "balance", { balance: eur("1.00") }],
      ["DELETE", `balance-adjustments/${updated.json().adjustment.id}`, undefined],
      ["PATCH", "details", { note: "x" }],
    ] as const) {
      const res = await call(theirs, method, `/v1/accounts/${id}/${path}`, body);
      const ref = await call(theirs, method, `/v1/accounts/${unknown}/${path}`, body);
      expect([path, res.statusCode]).toEqual([path, 404]);
      expect(res.json().code).toEqual(ref.json().code);
    }
    expect(await jobs()).toBe(before);
    expect(await balance(mine, id)).toBe("250");
  });
});

describe("sec261: nothing sensitive in the queue or the audit log", () => {
  it("sec261: a note and a full number replaced by others — neither the old nor the new value is in accounts.jobs or audit.entries, before or after the worker", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "10.00");
    // Valid IBANs built here (mod 97), synthetic.
    const iban = (bban: string) => {
      const digits = `${bban}301000`; // "UA00" moved to the end: U = 30, A = 10
      const check = 98n - (BigInt(digits) % 97n);
      return `UA${check.toString().padStart(2, "0")}${bban}`;
    };
    const numbers = [iban("3223130000026007233560001"), iban("3223130000026007233569992")];
    const notes = ["Перша синтетична нотатка 7781", "Друга синтетична нотатка 9934"];
    failAuditOf("accounts.account", true);
    for (const i of [0, 1])
      expect(
        (await call(space, "PATCH", `/v1/accounts/${id}/details`, { number: numbers[i], note: notes[i] }))
          .statusCode,
      ).toBe(200);
    expect(
      (await call(space, "PATCH", `/v1/accounts/${id}/details`, { number: null, note: null })).statusCode,
    ).toBe(200);
    const check = async () => {
      const text = (await jobsText(space.householdId)) + (await auditText(space.householdId));
      for (const secret of [...numbers, ...notes, "нотатка", "0000260072335", "sealed"])
        expect(text).not.toContain(secret);
    };
    await check();
    expect(
      await n(
        "accounts.jobs WHERE household_id = $1 AND payload->>'kind' = 'settings-changed'",
        space.householdId,
      ),
    ).toBe(3);
    vi.restoreAllMocks();
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    await check();
    const updates = (await auditOf(space.householdId, id)).updates;
    expect(updates).toHaveLength(3);
    for (const u of updates)
      for (const c of u.changes.filter((c) => c.field === "note" || c.field === "number")) {
        expect(c.masked).toBe(true);
        expect([null, AUDIT_MASK]).toContain(c.before);
        expect([null, AUDIT_MASK]).toContain(c.after);
      }
  });

  it("sec261: a managing job carries no name, note or number of the account", async () => {
    const space = await newSpace();
    const name = "Назва-синтетична-5521";
    const from = await account(space, name, "430.00");
    const to = await account(space, "Ощадний-синтетичний-8812", "0.00");
    await call(space, "PATCH", `/v1/accounts/${from}/details`, {
      number: "UA113223130000026007233563333",
      note: "Нотатка 4410",
    });
    expect(
      (
        await call(space, "POST", `/v1/accounts/${from}/close`, {
          closedOn: TODAY,
          settlement: { kind: "transfer", toAccountId: to },
        })
      ).statusCode,
    ).toBe(200);
    const { rows } = await db.owner.query<{ payload: unknown }>(
      `SELECT payload FROM accounts.jobs WHERE household_id = $1 AND payload->>'kind' = 'managed'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    for (const secret of [name, "Ощадний", "Нотатка", "UA1132", "3333"]) expect(text).not.toContain(secret);
  });
});

describe("sec261: every change gets its audit entry in the end", () => {
  it("sec261: an audit log away for all 8 attempts — the dead job keeps the change's audit entry, and the daily recovery writes it once (close by transfer, reopen, rename)", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    await runWorker(space.householdId);
    failAuditOf("accounts.account", true);
    const w = createWorker({
      queues: [createAccountsWorkerQueue(db.databases.for("accounts"), { ledger, liabilities, audit })],
      households: async () => [space.householdId],
      retryDelayMs: () => 0,
    });
    expect(
      (
        await call(space, "POST", `/v1/accounts/${from}/close`, {
          closedOn: TODAY,
          settlement: { kind: "transfer", toAccountId: to },
        })
      ).statusCode,
    ).toBe(200);
    expect((await call(space, "POST", `/v1/accounts/${from}/reopen`)).statusCode).toBe(200);
    expect((await call(space, "PATCH", `/v1/accounts/${from}`, { name: "Інша назва" })).statusCode).toBe(200);
    for (let i = 0; i < 9; i++) {
      await w.tick();
      await w.idle();
    }
    await w.stop();
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'dead'", space.householdId)).toBe(3);
    expect((await auditOf(space.householdId, from)).updates).toEqual([]);
    // The retention cleanup of the same day deletes none of them.
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => Date.now() + 40 * 24 * 60 * 60 * 1000,
    });
    vi.restoreAllMocks();
    for (const name of ["accounts.hand-off-recovery", "queue.retention-cleanup"])
      await tasks.find((t) => t.name === name)!.run();
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'queued'", space.householdId)).toBe(3);
    for (let i = 0; i < 2; i++) await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    // transferred, closed, reopened, renamed.
    expect((await auditOf(space.householdId, from)).updates).toHaveLength(4);
  });
});
