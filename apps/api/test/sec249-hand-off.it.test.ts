import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices, createAccountsWorkerQueue } from "../src/modules/accounts/index.ts";

/**
 * Security review of PR #249 (ARC-04@PoC FR 2, FR 3; ADR-0015): the accounts hand-off under a forged or replayed job,
 * a race of the route and the worker, a step that fails after it committed, and the roles' reach. Real API, real
 * PostgreSQL, synthetic data.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let liabilities: Liabilities;
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
function call(space: Space, method: "POST" | "PATCH" | "GET", url: string, body?: unknown) {
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
const loan = {
  kind: "loan",
  name: "Синтетичний кредит",
  institution: { name: "Синтетичний банк", country: "UA" },
  balance: { amount: "5000.00", currency: "EUR" },
  balanceDate: "2026-10-01",
  annualRate: "12.5",
  monthlyPayment: "250.00",
};
const card = {
  kind: "credit-card",
  name: "Синтетична картка",
  balance: { amount: "300.00", currency: "EUR" },
  balanceDate: "2026-10-01",
  annualRate: "30",
  creditLimit: "2000.00",
};
async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}
/** Every row of every module of the hand-off in one space, as text: equal before and after = nothing written. */
async function snapshot(householdId: string): Promise<string> {
  const parts: string[] = [];
  for (const table of [
    "accounts.accounts",
    "accounts.subaccounts",
    "accounts.jobs",
    "ledger.accounts",
    "ledger.entries",
    "ledger.postings",
    "ledger.outbox_events",
    "liabilities.liabilities",
    "audit.entries",
  ]) {
    const { rows } = await db.owner.query<{ j: string }>(
      `SELECT coalesce(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]')::text AS j FROM ${table} t WHERE household_id = $1`,
      [householdId],
    );
    parts.push(`${table}=${rows[0]!.j}`);
  }
  return parts.join("\n");
}
async function written(householdId: string) {
  return {
    accounts: await n("accounts.accounts WHERE household_id = $1", householdId),
    ledgerAccounts: await n(
      "ledger.accounts WHERE household_id = $1 AND owner_module = 'accounts'",
      householdId,
    ),
    entries: await n("ledger.entries WHERE household_id = $1", householdId),
    postings: await n("ledger.postings WHERE household_id = $1", householdId),
    events: await n("ledger.outbox_events WHERE household_id = $1", householdId),
    liabilities: await n("liabilities.liabilities WHERE household_id = $1", householdId),
    audit: await n(
      "audit.entries WHERE household_id = $1 AND entity_type IN ('accounts.account', 'liabilities.liability')",
      householdId,
    ),
  };
}
const ONCE = { accounts: 1, ledgerAccounts: 1, entries: 1, postings: 1, events: 1, liabilities: 1, audit: 2 };

function worker(households: readonly string[]) {
  return createWorker({
    ...workerQueues(db.databases),
    households: async () => households,
    retryDelayMs: () => 0,
  });
}
async function runWorker(...households: string[]): Promise<void> {
  const w = worker(households);
  try {
    await w.tick();
    await w.idle();
  } finally {
    await w.stop();
  }
}
async function forge(householdId: string, key: string, payload: unknown): Promise<void> {
  await db.owner.query(
    `INSERT INTO accounts.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'accounts.hand-off', $2, $3::jsonb)`,
    [householdId, key, JSON.stringify(payload)],
  );
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
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
          liabilities,
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
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
afterEach(() => vi.restoreAllMocks());

describe("SEC-249 isolation: a hand-off job writes only into its own space", () => {
  it("SEC-249: a forged «account-created» job in space A that names space B's account, subaccount and ledger account writes nothing into B", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const created = (await call(b, "POST", "/v1/accounts", loan)).json();
    await runWorker(b.householdId);
    const sub = (
      await db.owner.query<{ id: string; ledger_account_id: string }>(
        `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1`,
        [b.householdId],
      )
    ).rows[0]!;
    const before = await snapshot(b.householdId);
    await forge(a.householdId, `account-created:${created.id}`, {
      kind: "account-created",
      accountId: created.id,
      actorAccountId: a.accountId,
      subaccounts: [
        {
          subaccountId: sub.id,
          ledgerAccountId: sub.ledger_account_id,
          ledgerType: "liability",
          currency: "EUR",
          opening: "-777",
          date: "2026-10-02",
        },
      ],
      liability: null,
      audit: [{ field: "name", after: "forged", sensitive: false }],
    });
    for (let i = 0; i < 9; i++) await runWorker(a.householdId, b.householdId);
    expect(await snapshot(b.householdId)).toBe(before);
    const read = await call(b, "GET", `/v1/accounts/${created.id}`);
    expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
    // Whatever the forged job wrote carries space A only.
    expect(
      await n("ledger.postings WHERE household_id <> ALL($1::uuid[]) AND amount = 777", [a.householdId]),
    ).toBe(0);
  });

  it("SEC-249: a forged «credit-kind» job in space A that names space B's card leaves B's liability and audit as they were", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const created = (await call(b, "POST", "/v1/accounts", card)).json();
    await runWorker(b.householdId);
    // The account is a loan in A's forged view of the world only: B's account stays a card.
    const before = await snapshot(b.householdId);
    await forge(a.householdId, `credit-kind:${created.id}:${randomUUID()}`, {
      kind: "credit-kind",
      accountId: created.id,
      actorAccountId: a.accountId,
    });
    await runWorker(a.householdId, b.householdId);
    expect(await snapshot(b.householdId)).toBe(before);
    expect((await liabilities.forAccount(b.householdId, created.id))?.kind).toBe("credit-card");
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", a.householdId)).toBe(0);
  });

  it("SEC-249: a job whose payload carries a household is refused by the schema (the job's row alone names the space)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const created = (await call(b, "POST", "/v1/accounts", card)).json();
    await runWorker(b.householdId);
    const before = await snapshot(b.householdId);
    await forge(a.householdId, `credit-kind:${created.id}:x`, {
      kind: "credit-kind",
      accountId: created.id,
      actorAccountId: a.accountId,
      householdId: b.householdId,
    });
    await runWorker(a.householdId);
    expect(await snapshot(b.householdId)).toBe(before);
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'done'", a.householdId)).toBe(0);
  });

  it("SEC-249: the accounts role bound to space A neither sees nor writes space B's queue rows", async () => {
    const a = await newSpace();
    const b = await newSpace();
    await call(b, "POST", "/v1/accounts", loan);
    expect(await n("accounts.jobs WHERE household_id = $1", b.householdId)).toBe(1);
    const accountsDb = db.databases.for("accounts");
    const seen = await accountsDb.inHousehold(a.householdId, async (q) => {
      const jobs = await q.query(`SELECT 1 FROM jobs`);
      const events = await q.query(`SELECT 1 FROM outbox_events`);
      const updated = await q.query(`UPDATE jobs SET state = 'queued', payload = '{}'::jsonb`);
      const deleted = await q.query(`DELETE FROM jobs`);
      return [jobs.rowCount, events.rowCount, updated.rowCount, deleted.rowCount];
    });
    expect(seen).toEqual([0, 0, 0, 0]);
    await expect(
      accountsDb.inHousehold(a.householdId, (q) =>
        q.query(
          `INSERT INTO jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'accounts.hand-off', 'k', '{}'::jsonb)`,
          [b.householdId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await n("accounts.jobs WHERE household_id = $1", b.householdId)).toBe(1);
  });

  it("SEC-249 (ADR-0002): the module roles still reach only their own schema; the audit role cannot rewrite a key", async () => {
    const a = await newSpace();
    const denied = async (module: string, sql: string) =>
      expect(
        db.databases.for(module as never).inHousehold(a.householdId, (q) => q.query(sql)),
      ).rejects.toThrow(/permission denied/);
    await denied("accounts", `SELECT 1 FROM audit.entries`);
    await denied("accounts", `SELECT 1 FROM ledger.entries`);
    await denied("accounts", `SELECT 1 FROM ledger.accounts`);
    await denied("accounts", `SELECT 1 FROM liabilities.liabilities`);
    await denied("ledger", `SELECT 1 FROM accounts.jobs`);
    await denied("audit", `SELECT 1 FROM accounts.jobs`);
    await denied("liabilities", `SELECT 1 FROM accounts.jobs`);
    await denied("audit", `UPDATE entries SET dedupe_key = NULL`);
    await denied("audit", `UPDATE entries SET dedupe_key = 'x'`);
    await denied("audit", `DELETE FROM entries`);
  });
});

describe("SEC-249 money: «Початковий залишок» is posted exactly once", () => {
  it("SEC-249: the route's hand-off racing three workers writes the entry, the liability and the audit entries once", async () => {
    for (let round = 0; round < 6; round++) {
      const space = await newSpace();
      const workers = [worker([space.householdId]), worker([space.householdId]), worker([space.householdId])];
      let stop = false;
      const spinning = workers.map(async (w) => {
        while (!stop) {
          await w.tick();
          await w.idle();
        }
      });
      const res = await call(space, "POST", "/v1/accounts", loan);
      expect(res.statusCode).toBe(201);
      for (
        let i = 0;
        i < 40 &&
        (await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)) > 0;
        i++
      )
        await new Promise((r) => setTimeout(r, 25));
      stop = true;
      await Promise.all(spinning);
      for (const w of workers) await w.stop();
      expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
      expect(await written(space.householdId)).toEqual(ONCE);
      const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
      expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
    }
  });

  it("SEC-249: the same hand-off applied by eight workers at once (job replayed as eight) posts once", async () => {
    const space = await newSpace();
    vi.spyOn(ledger, "openAccount").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    vi.restoreAllMocks();
    // Eight copies of the job under other keys: what a replay of the same payload would be.
    await db.owner.query(
      `INSERT INTO accounts.jobs (household_id, name, dedupe_key, payload)
       SELECT household_id, name, dedupe_key || ':' || g, payload FROM accounts.jobs, generate_series(1, 8) g
        WHERE household_id = $1`,
      [space.householdId],
    );
    const w = createWorker({
      ...workerQueues(db.databases),
      households: async () => [space.householdId],
      concurrency: 9,
      retryDelayMs: () => 0,
    });
    for (let i = 0; i < 5; i++) {
      await w.tick();
      await w.idle();
    }
    await w.stop();
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
    expect(await written(space.householdId)).toEqual(ONCE);
    const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
    expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
  });

  it.each(["openAccount", "post"] as const)(
    "SEC-249: ledger.%s that committed and then failed (the answer lost) is not repeated by the worker",
    async (method) => {
      const space = await newSpace();
      const original = ledger[method].bind(ledger) as (...args: unknown[]) => Promise<unknown>;
      let failed = false;
      vi.spyOn(ledger, method).mockImplementation((async (...args: unknown[]) => {
        const done = await original(...args);
        if (!failed) {
          failed = true;
          throw new Error("answer lost");
        }
        return done;
      }) as never);
      const res = await call(space, "POST", "/v1/accounts", loan);
      expect(res.statusCode).toBe(201);
      vi.restoreAllMocks();
      await runWorker(space.householdId);
      expect(await written(space.householdId)).toEqual(ONCE);
      const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
      expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
    },
  );

  it("SEC-249: liabilities.register and the audit entry that committed and then failed are not repeated", async () => {
    const space = await newSpace();
    const register = liabilities.register.bind(liabilities);
    vi.spyOn(liabilities, "register").mockImplementationOnce(async (...args) => {
      await register(...args);
      throw new Error("answer lost");
    });
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    vi.restoreAllMocks();
    const record = audit.record.bind(audit);
    let failed = false;
    vi.spyOn(audit, "record").mockImplementation(async (h, e) => {
      const done = await record(h, e);
      if (!failed && (e as { entity: { type: string } }).entity.type === "accounts.account") {
        failed = true;
        throw new Error("answer lost");
      }
      return done;
    });
    await runWorker(space.householdId);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
    expect(await written(space.householdId)).toEqual(ONCE);
  });

  it("SEC-249: a done job replayed with another amount, date and terms changes no money, liability or audit", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", loan);
    await runWorker(space.householdId);
    const before = await written(space.householdId);
    expect(before).toEqual(ONCE);
    const ledgerBefore = (
      await db.owner.query(`SELECT amount::text, currency FROM ledger.postings WHERE household_id = $1`, [
        space.householdId,
      ])
    ).rows;
    const liabilityBefore = (
      await db.owner.query(
        `SELECT to_jsonb(l)::text AS j FROM liabilities.liabilities l WHERE household_id = $1`,
        [space.householdId],
      )
    ).rows;
    await db.owner.query(
      `UPDATE accounts.jobs SET state = 'queued', attempts = 0, finished_at = NULL,
              payload = jsonb_set(jsonb_set(jsonb_set(payload, '{subaccounts,0,opening}', '"-99999"'),
                                  '{subaccounts,0,date}', '"2026-10-05"'), '{liability,monthlyPayment}', '"1"')
        WHERE household_id = $1`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await written(space.householdId)).toEqual(before);
    expect(
      (
        await db.owner.query(`SELECT amount::text, currency FROM ledger.postings WHERE household_id = $1`, [
          space.householdId,
        ])
      ).rows,
    ).toEqual(ledgerBefore);
    expect(
      (
        await db.owner.query(
          `SELECT to_jsonb(l)::text AS j FROM liabilities.liabilities l WHERE household_id = $1`,
          [space.householdId],
        )
      ).rows,
    ).toEqual(liabilityBefore);
    const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
    expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
  });

  it("SEC-249: the opening amount travels as a decimal string: 0.1 + 0.2 units of an 18-digit amount keep every digit", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний поточний",
      balance: { amount: "12345678901234567.89", currency: "EUR" },
      balanceDate: "2026-10-01",
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await db.owner.query<{ opening: string; t: string }>(
      `SELECT payload->'subaccounts'->0->>'opening' AS opening, jsonb_typeof(payload->'subaccounts'->0->'opening') AS t
         FROM accounts.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]).toEqual({ opening: "12345678901234567.89", t: "string" });
    expect(res.json().currencies[0].balance).toEqual({ amount: "12345678901234567.89", currency: "EUR" });
  });
});

describe("SEC-249 privacy: the queue holds no sensitive value", () => {
  it("SEC-249: the hand-off job's payload carries neither the note nor the full number, in the clear or sealed", async () => {
    const space = await newSpace();
    const note = ["synthetic", "note", randomUUID()].join("-");
    const number = "UA213223130000026007233566001";
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний поточний",
      institution: { name: "Синтетичний банк", country: "UA" },
      number,
      note,
      balance: { amount: "10.00", currency: "EUR" },
      balanceDate: "2026-10-01",
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await db.owner.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM accounts.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).not.toContain(note);
    expect(rows[0]!.payload).not.toContain(number);
    expect(rows[0]!.payload).not.toContain(number.slice(0, 20));
    const sealed = (
      await db.owner.query<{ s: string | null }>(
        `SELECT to_jsonb(a)::text AS s FROM accounts.accounts a WHERE household_id = $1`,
        [space.householdId],
      )
    ).rows[0]!.s!;
    expect(sealed).not.toContain(number);
    await runWorker(space.householdId);
    const logged = (
      await db.owner.query<{ c: string }>(
        `SELECT changes::text AS c FROM audit.entries WHERE household_id = $1`,
        [space.householdId],
      )
    ).rows
      .map((r) => r.c)
      .join("\n");
    expect(logged).not.toContain(note);
    expect(logged).not.toContain(number);
  });
});

describe("SEC-249 audit: the dedupe key", () => {
  const entry = (actorId: string, entityId: string, key: string) => ({
    actor: { kind: "user" as const, id: actorId },
    channel: "web" as const,
    entity: { type: "accounts.account", id: entityId },
    action: "create" as const,
    changes: [{ field: "name", before: null, after: "Синтетичний", sensitive: false }],
    key,
  });

  it("SEC-249: a key used in space A suppresses nothing in space B, and A never gets B's entry back", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const id = randomUUID();
    const key = `accounts.account-created:${id}`;
    const inB = await audit.record(b.householdId, entry(b.accountId, id, key));
    const inA = await audit.record(a.householdId, entry(a.accountId, id, key));
    expect(inA.id).not.toBe(inB.id);
    expect(inA.actorId).toBe(a.accountId);
    expect(inA.householdId).toBe(a.householdId);
    expect(await n("audit.entries WHERE household_id = $1 AND dedupe_key = $2", a.householdId, key)).toBe(1);
    expect(await n("audit.entries WHERE household_id = $1 AND dedupe_key = $2", b.householdId, key)).toBe(1);
  });

  it("SEC-249: twenty concurrent records with one key append one entry and all return it", async () => {
    const a = await newSpace();
    const id = randomUUID();
    const key = `accounts.account-created:${id}`;
    const all = await Promise.all(
      Array.from({ length: 20 }, () => audit.record(a.householdId, entry(a.accountId, id, key))),
    );
    expect(new Set(all.map((e) => e.id)).size).toBe(1);
    expect(await n("audit.entries WHERE household_id = $1", a.householdId)).toBe(
      1 + (await n("audit.entries WHERE household_id = $1 AND dedupe_key IS NULL", a.householdId)),
    );
  });

  it("SEC-249: entries without a key are never deduplicated (NULL keys do not collide)", async () => {
    const a = await newSpace();
    const id = randomUUID();
    const unkeyed = { ...entry(a.accountId, id, "x"), key: undefined };
    await Promise.all(Array.from({ length: 5 }, () => audit.record(a.householdId, unkeyed)));
    expect(await audit.entriesFor(a.householdId, { type: "accounts.account", id })).toHaveLength(5);
  });

  it("SEC-249: the create's key is the account's own: a create of another account in the same space is audited too", async () => {
    const space = await newSpace();
    const one = (await call(space, "POST", "/v1/accounts", loan)).json();
    const two = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    for (const id of [one.id, two.id])
      expect(
        (await audit.entriesFor(space.householdId, { type: "accounts.account", id })).filter(
          (e) => e.action === "create",
        ),
      ).toHaveLength(1);
  });
});

describe("SEC-249 blocking: a hand-off the worker gave up on is still finished", () => {
  const DAY = 24 * 60 * 60 * 1000;
  /** The worker with the test's own (failing) ports, until the job has used all its attempts. */
  async function exhaust(householdId: string): Promise<void> {
    const w = createWorker({
      queues: [createAccountsWorkerQueue(db.databases.for("accounts"), { ledger, liabilities, audit })],
      households: async () => [householdId],
      retryDelayMs: () => 0,
    });
    for (let i = 0; i < 9; i++) {
      await w.tick();
      await w.idle();
    }
    await w.stop();
  }
  /** The scheduler's daily tasks that touch the accounts queue, in their order, `days` later. */
  async function daily(days: number): Promise<void> {
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces,
      now: () => Date.now() + days * DAY,
    });
    for (const task of tasks)
      if (task.name === "accounts.hand-off-recovery" || task.name === "queue.retention-cleanup")
        await task.run();
  }

  it("SEC-249: «Початковий залишок» of a hand-off dead-lettered while the ledger was away is posted once the ledger is back, even 31 days later", async () => {
    const space = await newSpace();
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    await exhaust(space.householdId);
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'dead'", space.householdId)).toBe(1);
    vi.restoreAllMocks();
    // The ledger is back. Next day's tasks, and the tasks a month on (the retention of dead jobs is 30 days).
    await daily(1);
    await db.owner.query(
      `UPDATE accounts.jobs SET finished_at = finished_at - interval '31 days' WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    await daily(0);
    await runWorker(space.householdId);
    expect(await written(space.householdId)).toEqual(ONCE);
    const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
    expect(read.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
  });

  it("SEC-249: a hand-off dead-lettered while the audit log was away leaves no account without its audit entry", async () => {
    const space = await newSpace();
    const record = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (h, e) => {
      if ((e as { entity: { type: string } }).entity.type === "accounts.account") throw new Error("injected");
      return record(h, e);
    });
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    await exhaust(space.householdId);
    vi.restoreAllMocks();
    // The retention of the dead job has passed by the time the tasks run.
    await db.owner.query(
      `UPDATE accounts.jobs SET finished_at = finished_at - interval '31 days' WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    await daily(0);
    await runWorker(space.householdId);
    const created = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: res.json().id })
    ).filter((e) => e.action === "create");
    expect(created).toHaveLength(1);
    expect(await written(space.householdId)).toEqual(ONCE);
  });

  it("SEC-249: the recovery touches only dead hand-off jobs of the space: done and running ones and another space's stay", async () => {
    const a = await newSpace();
    const b = await newSpace();
    await call(a, "POST", "/v1/accounts", loan);
    await call(b, "POST", "/v1/accounts", loan);
    await runWorker(a.householdId, b.householdId);
    const before = (await snapshot(a.householdId)) + (await snapshot(b.householdId));
    await daily(0);
    expect((await snapshot(a.householdId)) + (await snapshot(b.householdId))).toBe(before);
  });
});

describe("SEC-249 follow-up: the liability's kind under the account's row lock", () => {
  it("SEC-249: a second kind change waits for the first one's hand-off, so the liability never ends on the earlier kind", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    const changeKind = liabilities.changeKind.bind(liabilities);
    let second: ReturnType<typeof call> | undefined;
    vi.spyOn(liabilities, "changeKind").mockImplementation(async (...args) => {
      if (!second) {
        // While the first change's hand-off holds the account's row, the second change is sent.
        second = call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "credit-card" });
        await new Promise((r) => setTimeout(r, 400));
      }
      return changeKind(...args);
    });
    expect((await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" })).statusCode).toBe(200);
    expect((await second!).statusCode).toBe(200);
    vi.restoreAllMocks();
    // Before any worker pass: the two already agree.
    expect((await call(space, "GET", `/v1/accounts/${created.id}`)).json().kind).toBe("credit-card");
    expect((await liabilities.forAccount(space.householdId, created.id))?.kind).toBe("credit-card");
  });
});
