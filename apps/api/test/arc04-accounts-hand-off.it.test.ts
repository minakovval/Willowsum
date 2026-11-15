import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsErasure, createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * ARC-04@PoC FR 2, FR 3 (issue #210 «Атомарна передача між модулями», #238 item 1): «Новий рахунок» and «Основне»
 * write the accounts row and its hand-off job in one accounts transaction; the ledger accounts and entries, the
 * liability and the audit entries follow only after it commits, each idempotent, right away and — if that fails —
 * from the worker. A failure injected at each step leaves no ledger entry, liability or audit entry without its
 * account, and a retried create publishes «Початковий залишок» once. Real API, real PostgreSQL, synthetic data.
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

function call(space: Space, method: "POST" | "PATCH" | "GET", url: string, body?: unknown, key?: string) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key !== undefined ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** A loan touches every module of the hand-off: two ledger accounts' worth of steps, a liability, two audit entries. */
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

async function n(sql: string, householdId: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, [
    householdId,
  ]);
  return rows[0]!.n;
}

/** Everything a create writes in every module of the space. */
async function written(householdId: string) {
  return {
    accounts: await n("accounts.accounts WHERE household_id = $1", householdId),
    ledgerAccounts: await n(
      "ledger.accounts WHERE household_id = $1 AND owner_module = 'accounts'",
      householdId,
    ),
    entries: await n("ledger.entries WHERE household_id = $1", householdId),
    events: await n("ledger.outbox_events WHERE household_id = $1", householdId),
    liabilities: await n("liabilities.liabilities WHERE household_id = $1", householdId),
    audit: await n(
      "audit.entries WHERE household_id = $1 AND entity_type IN ('accounts.account', 'liabilities.liability')",
      householdId,
    ),
  };
}

/** Rows of another module that no account of the space points to (what a failed hand-off must never leave). */
async function orphans(householdId: string) {
  return {
    ledgerAccounts: await n(
      `ledger.accounts l WHERE l.household_id = $1 AND l.owner_module = 'accounts'
         AND NOT EXISTS (SELECT 1 FROM accounts.subaccounts s WHERE s.household_id = l.household_id
                           AND s.ledger_account_id = l.id AND s.id = l.owner_id)`,
      householdId,
    ),
    entries: await n(
      `ledger.entries e WHERE e.household_id = $1 AND e.source_module = 'accounts'
         AND NOT EXISTS (SELECT 1 FROM accounts.subaccounts s WHERE s.household_id = e.household_id
                           AND s.id = e.source_id)`,
      householdId,
    ),
    liabilities: await n(
      `liabilities.liabilities l WHERE l.household_id = $1
         AND NOT EXISTS (SELECT 1 FROM accounts.accounts a WHERE a.household_id = l.household_id AND a.id = l.account_id)`,
      householdId,
    ),
    audit: await n(
      `audit.entries e WHERE e.household_id = $1 AND e.entity_type = 'accounts.account'
         AND NOT EXISTS (SELECT 1 FROM accounts.accounts a WHERE a.household_id = e.household_id AND a.id = e.entity_id)`,
      householdId,
    ),
  };
}
const NO_ORPHANS = { ledgerAccounts: 0, entries: 0, liabilities: 0, audit: 0 };

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

/**
 * Fails the first statement of the accounts module that matches `sql` (a step of its transaction). The route, the
 * idempotency store and the worker share this database object, so only the matching statement fails.
 */
function failAccountsStatement(sql: RegExp): void {
  const accountsDb = db.databases.for("accounts");
  const original = accountsDb.inHousehold.bind(accountsDb);
  let failed = false;
  vi.spyOn(accountsDb, "inHousehold").mockImplementation(((
    householdId: string,
    work: (q: HouseholdQueryRunner) => Promise<unknown>,
  ) =>
    original(householdId, (q) =>
      work({
        ...q,
        query: ((text: string, values?: readonly unknown[]) => {
          if (!failed && sql.test(text)) {
            failed = true;
            return Promise.reject(new Error("injected failure"));
          }
          return q.query(text, values);
        }) as HouseholdQueryRunner["query"],
      }),
    )) as typeof accountsDb.inHousehold);
}

/** The ports of the other modules the create calls, each failing once at its step of the hand-off. */
const portSteps: readonly [string, () => void][] = [
  [
    "ledger.openAccount",
    () => void vi.spyOn(ledger, "openAccount").mockRejectedValueOnce(new Error("injected")),
  ],
  ["ledger.post", () => void vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"))],
  [
    "liabilities.register",
    () => void vi.spyOn(liabilities, "register").mockRejectedValueOnce(new Error("injected")),
  ],
  [
    "audit.record of the account",
    () => {
      const original = audit.record.bind(audit);
      let failed = false;
      vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
        const type = (entry as { entity?: { type?: string } }).entity?.type;
        if (!failed && type === "accounts.account") {
          failed = true;
          throw new Error("injected");
        }
        return original(householdId, entry);
      });
    },
  ],
];

beforeAll(async () => {
  db = await setupRealModules(6);
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

describe("ARC-04@PoC FR 2: «Новий рахунок» hands its ledger entries, liability and audit entry over atomically", () => {
  it.each([
    ["the account", /^\s*INSERT INTO accounts\b/],
    ["a subaccount", /^\s*INSERT INTO subaccounts\b/],
    ["the Owner", /^\s*INSERT INTO account_owners\b/],
    ["the hand-off job", /^\s*INSERT INTO jobs\b/],
  ])(
    "ARC-04@PoC FR 2: a failure at %s rolls the create back and leaves nothing in ledger, liabilities or audit",
    async (_step, sql) => {
      const space = await newSpace();
      failAccountsStatement(sql);
      const res = await call(space, "POST", "/v1/accounts", loan);
      expect(res.statusCode).toBe(500);
      expect(await written(space.householdId)).toEqual({
        accounts: 0,
        ledgerAccounts: 0,
        entries: 0,
        events: 0,
        liabilities: 0,
        audit: 0,
      });
      expect(await pendingJobs(space.householdId)).toBe(0);
    },
  );

  it.each(portSteps)(
    "ARC-04@PoC FR 2: a failure at %s after the commit leaves the account whole once the worker hands it over",
    async (_step, inject) => {
      const space = await newSpace();
      inject();
      const res = await call(space, "POST", "/v1/accounts", loan);
      // The account is created: its hand-off is in the accounts queue, committed with it.
      expect(res.statusCode).toBe(201);
      expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
      expect(await pendingJobs(space.householdId)).toBe(1);

      vi.restoreAllMocks();
      await runWorker(space.householdId);
      expect(await pendingJobs(space.householdId)).toBe(0);
      expect(await written(space.householdId)).toEqual({
        accounts: 1,
        ledgerAccounts: 1,
        entries: 1,
        events: 1,
        liabilities: 1,
        audit: 2,
      });
      expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
      const read = await call(space, "GET", `/v1/accounts/${res.json().id}`);
      expect(read.json()).toMatchObject({
        currencies: [{ currency: "EUR", balance: { amount: "-5000", currency: "EUR" } }],
        loan: { annualRate: "12.5", monthlyPayment: { amount: "250", currency: "EUR" } },
      });
    },
  );

  it("ARC-04@PoC FR 3: the hand-off done right away and again by the worker writes everything once", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    expect(res.json().currencies[0].balance).toEqual({ amount: "-5000", currency: "EUR" });
    const before = await written(space.householdId);
    expect(before).toEqual({
      accounts: 1,
      ledgerAccounts: 1,
      entries: 1,
      events: 1,
      liabilities: 1,
      audit: 2,
    });
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await written(space.householdId)).toEqual(before);
  });

  it("ARC-04@PoC FR 3: a create retried with its Idempotency-Key after a failure publishes «Початковий залишок» once", async () => {
    const space = await newSpace();
    const key = randomUUID();
    // The last write of the accounts transaction fails: the ledger has not been touched yet.
    failAccountsStatement(/^\s*INSERT INTO account_owners\b/);
    expect((await call(space, "POST", "/v1/accounts", loan, key)).statusCode).toBe(500);
    vi.restoreAllMocks();
    const retry = await call(space, "POST", "/v1/accounts", loan, key);
    expect(retry.statusCode).toBe(201);
    const replay = await call(space, "POST", "/v1/accounts", loan, key);
    expect(replay.json().id).toBe(retry.json().id);
    await runWorker(space.householdId);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger.outbox_events
        WHERE household_id = $1 AND event_name = 'ledger.entry-recorded' AND payload->>'eventType' = 'opening-balance'`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(1);
    expect(await written(space.householdId)).toEqual({
      accounts: 1,
      ledgerAccounts: 1,
      entries: 1,
      events: 1,
      liabilities: 1,
      audit: 2,
    });
    expect(await orphans(space.householdId)).toEqual(NO_ORPHANS);
  });

  it("ARC-04@PoC FR 2 (#210 item 3): the accounts transaction never waits on the ledger, liabilities or audit pools", async () => {
    const space = await newSpace();
    const accountsDb = db.databases.for("accounts");
    const original = accountsDb.inHousehold.bind(accountsDb);
    let open = 0;
    vi.spyOn(accountsDb, "inHousehold").mockImplementation((async (
      householdId: string,
      work: (q: HouseholdQueryRunner) => Promise<unknown>,
    ) =>
      original(householdId, async (q) => {
        open++;
        try {
          return await work(q);
        } finally {
          open--;
        }
      })) as typeof accountsDb.inHousehold);
    const insideAccounts: string[] = [];
    const watch = <T extends object>(target: T, name: string, methods: readonly (keyof T)[]) => {
      for (const method of methods) {
        const fn = (target[method] as (...args: unknown[]) => unknown).bind(target);
        vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
          if (open > 0) insideAccounts.push(`${name}.${String(method)}`);
          return fn(...args);
        }) as never);
      }
    };
    watch(ledger, "ledger", ["openAccount", "post"]);
    watch(liabilities, "liabilities", ["register"]);
    watch(audit, "audit", ["record"]);
    const res = await call(space, "POST", "/v1/accounts", loan);
    expect(res.statusCode).toBe(201);
    expect(insideAccounts).toEqual([]);
    expect(await written(space.householdId)).toMatchObject({ entries: 1, liabilities: 1, audit: 2 });
  });
});

describe("ARC-04@PoC FR 2 (#238 item 1): «Кредит» ↔ «Кредитна картка» hands the liability's kind over atomically", () => {
  const kindOf = async (householdId: string, accountId: string) =>
    (await liabilities.forAccount(householdId, accountId))?.kind;
  const liabilityUpdates = (householdId: string) =>
    n(
      "audit.entries WHERE household_id = $1 AND entity_type = 'liabilities.liability' AND action = 'update'",
      householdId,
    );

  it("ARC-04@PoC FR 2: a failure in the accounts transaction leaves the liability's kind as it was", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    failAccountsStatement(/^\s*UPDATE accounts SET name\b/);
    const res = await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" });
    expect(res.statusCode).toBe(500);
    expect(await kindOf(space.householdId, created.id)).toBe("credit-card");
    expect(await liabilityUpdates(space.householdId)).toBe(0);
    expect(await pendingJobs(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 2: a failure of the liability's change after the commit is finished by the worker", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    vi.spyOn(liabilities, "changeKind").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("loan");
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await kindOf(space.householdId, created.id)).toBe("loan");
    expect(await liabilityUpdates(space.householdId)).toBe(1);
    expect(await pendingJobs(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 3: a late hand-off of an earlier change never undoes a later one", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    // The first change's hand-off fails right away; the second (back to the card) goes through.
    vi.spyOn(liabilities, "changeKind").mockRejectedValueOnce(new Error("injected"));
    expect((await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" })).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(
      (await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "credit-card" })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect(await kindOf(space.householdId, created.id)).toBe("credit-card");
    expect((await call(space, "GET", `/v1/accounts/${created.id}`)).json().kind).toBe("credit-card");
    expect(await pendingJobs(space.householdId)).toBe(0);
  });
});

describe("ARC-04@PoC FR 3: the other modules' steps of the hand-off can run again", () => {
  it("ARC-04@PoC FR 3: audit.record with the same key appends one entry and returns it; the platform log takes no key", async () => {
    const space = await newSpace();
    const entityId = randomUUID();
    const entry = {
      actor: { kind: "user" as const, id: space.accountId },
      channel: "web" as const,
      entity: { type: "accounts.account", id: entityId },
      action: "create" as const,
      changes: [{ field: "name", before: null, after: "Синтетичний", sensitive: false }],
      key: `accounts.account-created:${entityId}`,
    };
    const first = await audit.record(space.householdId, entry);
    const again = await audit.record(space.householdId, entry);
    expect(again.id).toBe(first.id);
    expect(await audit.entriesFor(space.householdId, entry.entity)).toHaveLength(1);
    // Without a key every call appends, as before.
    const unkeyed = { ...entry, key: undefined };
    await audit.record(space.householdId, unkeyed);
    await audit.record(space.householdId, unkeyed);
    expect(await audit.entriesFor(space.householdId, entry.entity)).toHaveLength(3);
    // Another space's same key is its own entry.
    const other = await newSpace();
    await audit.record(other.householdId, { ...entry, actor: { kind: "user", id: other.accountId } });
    expect(await audit.entriesFor(other.householdId, entry.entity)).toHaveLength(1);
    await expect(audit.record(space.householdId, { ...entry, key: "not a code" })).rejects.toThrow();
    await expect(
      audit.recordPlatform({ ...entry, actor: { kind: "system" }, channel: "system" }),
    ).rejects.toThrow();
  });

  it("ARC-04@PoC FR 3: ledger.openAccount with the owner's id opens it once; another id for the same owner is ACCOUNT_CONFLICT", async () => {
    const space = await newSpace();
    const owner = { module: "accounts", id: randomUUID() };
    const id = randomUUID();
    const opened = await ledger.openAccount(space.householdId, owner, { type: "asset", currency: "EUR", id });
    expect(opened.id).toBe(id);
    expect(
      (await ledger.openAccount(space.householdId, owner, { type: "asset", currency: "EUR", id })).id,
    ).toBe(id);
    expect((await ledger.openAccount(space.householdId, owner, { type: "asset", currency: "EUR" })).id).toBe(
      id,
    );
    await expect(
      ledger.openAccount(space.householdId, owner, { type: "asset", currency: "EUR", id: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CONFLICT" });
  });

  it("ARC-04@PoC FR 2: the space's erasure takes the accounts queue's rows with its accounts", async () => {
    const space = await newSpace();
    expect((await call(space, "POST", "/v1/accounts", loan)).statusCode).toBe(201);
    const erased = await createAccountsErasure(db.databases.for("accounts")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ accounts: 1, idempotencyKeys: 0, jobs: 1 });
    expect(await n("accounts.jobs WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
