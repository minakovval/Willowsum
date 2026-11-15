import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import {
  createLiabilities,
  createLiabilitiesErasure,
  type Liabilities,
} from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * ARC-04@PoC FR 2–4 for liabilities (issue #252 item 3, the rest; #263; ADR-0015): `liabilities.register` and
 * `changeKind` write the liability row and its audit job (`liabilities.hand-off`) in one liabilities transaction; the
 * audit entry follows only after it commits — right away, and from the liabilities queue if that fails — once per key.
 * A dead job goes back to the queue with the daily recovery. Also #263 item 3: the brackets around the transfer `OR` of
 * `pendingManaged` in accounts. Real API, real PostgreSQL, synthetic data, fixed clock.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

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

const eur = (amount: string) => ({ amount, currency: "EUR" });
const loanTerms = { kind: "loan" as const, currency: "EUR", annualRate: "6", monthlyPayment: "650.00" };
const card = {
  kind: "credit-card",
  name: "Синтетична картка",
  balance: eur("300.00"),
  balanceDate: "2026-10-01",
  annualRate: "30",
  creditLimit: "2000.00",
};
const loanAccount = {
  kind: "loan",
  name: "Синтетичний кредит",
  balance: eur("5000.00"),
  balanceDate: "2026-10-01",
  annualRate: "12.5",
  monthlyPayment: "250.00",
};

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

/** Audit entries of the space's liabilities, by action. */
const liabilityAudit = (householdId: string, action: "create" | "update") =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'liabilities.liability' AND action = $2",
    householdId,
    action,
  );

/** Audit entries of a liability the space has no row of (what a failure must never leave). */
const orphanAudit = (householdId: string) =>
  n(
    `audit.entries e WHERE e.household_id = $1 AND e.entity_type = 'liabilities.liability'
       AND NOT EXISTS (SELECT 1 FROM liabilities.liabilities l WHERE l.household_id = e.household_id
                         AND l.id = e.entity_id)`,
    householdId,
  );

const liabilityJobs = (householdId: string, state?: string) =>
  state === undefined
    ? n("liabilities.jobs WHERE household_id = $1", householdId)
    : n("liabilities.jobs WHERE household_id = $1 AND state = $2", householdId, state);

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

/** Fails `audit.record` of a liability once. */
function failLiabilityAuditOnce(): void {
  const original = audit.record.bind(audit);
  let failed = false;
  vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
    if (!failed && entry.entity.type === "liabilities.liability") {
      failed = true;
      throw new Error("injected");
    }
    return original(householdId, entry);
  });
}

/**
 * Records, at each audit write of a liability, how many liability rows of the space another connection sees — only
 * committed rows — and the kinds they have.
 */
function watchCommittedAtAudit(householdId: string): { kinds: string[][] } {
  const seen = { kinds: [] as string[][] };
  const original = audit.record.bind(audit);
  vi.spyOn(audit, "record").mockImplementation(async (h, entry) => {
    if (entry.entity.type === "liabilities.liability") {
      const { rows } = await db.owner.query<{ kind: string }>(
        `SELECT kind FROM liabilities.liabilities WHERE household_id = $1 ORDER BY id`,
        [householdId],
      );
      seen.kinds.push(rows.map((r) => r.kind));
    }
    return original(h, entry);
  });
  return seen;
}

/** Fails the first statement of the liabilities module that matches `sql` (a step of its transaction). */
function failLiabilitiesStatement(sql: RegExp): void {
  const liabilitiesDb = db.databases.for("liabilities");
  const original = liabilitiesDb.inHousehold.bind(liabilitiesDb);
  let failed = false;
  vi.spyOn(liabilitiesDb, "inHousehold").mockImplementation(((
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
    )) as typeof liabilitiesDb.inHousehold);
}

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

describe("ARC-04@PoC FR 2: `liabilities.register` writes its audit entry after the liability's commit", () => {
  it("ARC-04@PoC FR 2: the audit entry of a registered liability is written once the liability is committed", async () => {
    const space = await newSpace();
    const seen = watchCommittedAtAudit(space.householdId);
    const result = await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId: randomUUID(),
      terms: loanTerms,
    });
    expect(result.kind).toBe("registered");
    // Another connection already sees the committed liability when its audit entry is written.
    expect(seen.kinds).toEqual([["loan"]]);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    // Its job is in the liabilities queue, written with the liability.
    expect(await liabilityJobs(space.householdId)).toBe(1);
  });

  it("ARC-04@PoC FR 2: a failure in the liabilities transaction leaves neither the liability, its job nor an audit entry", async () => {
    const space = await newSpace();
    failLiabilitiesStatement(/^\s*INSERT INTO jobs\b/);
    await expect(
      liabilities.register(space.householdId, {
        actorAccountId: space.accountId,
        accountId: randomUUID(),
        terms: loanTerms,
      }),
    ).rejects.toThrow();
    expect(await n("liabilities.liabilities WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await liabilityJobs(space.householdId)).toBe(0);
    expect(await liabilityAudit(space.householdId, "create")).toBe(0);
  });

  it("ARC-04@PoC FR 2: a failed audit write right after the commit keeps the liability; the worker writes the entry", async () => {
    const space = await newSpace();
    failLiabilityAuditOnce();
    const result = await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId: randomUUID(),
      terms: loanTerms,
    });
    expect(result.kind).toBe("registered");
    expect(await n("liabilities.liabilities WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await liabilityAudit(space.householdId, "create")).toBe(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    expect(await liabilityJobs(space.householdId, "done")).toBe(1);
    expect(await orphanAudit(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 3: registering again and running the worker after the route write one job and one audit entry", async () => {
    const space = await newSpace();
    const accountId = randomUUID();
    const input = { actorAccountId: space.accountId, accountId, terms: loanTerms };
    await liabilities.register(space.householdId, input);
    await liabilities.register(space.householdId, { ...input, terms: { ...loanTerms, annualRate: "7" } });
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await liabilityJobs(space.householdId)).toBe(1);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    const stored = await liabilities.forAccount(space.householdId, accountId);
    const [entry] = await audit.entriesFor(space.householdId, {
      type: "liabilities.liability",
      id: stored!.id,
    });
    expect(entry!.changes).toEqual(
      expect.arrayContaining([
        { field: "accountId", before: null, after: accountId, masked: false },
        { field: "annualRate", before: null, after: "6", masked: false },
        { field: "monthlyPayment", before: null, after: "650", masked: false },
      ]),
    );
    expect(entry!.actor).toEqual({ kind: "user", id: space.accountId });
  });

  it("ARC-04@PoC FR 2: the job carries ids, codes and amounts only", async () => {
    const space = await newSpace();
    const accountId = randomUUID();
    await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId,
      terms: loanTerms,
    });
    const { rows } = await db.owner.query<{ name: string; payload: Record<string, unknown> }>(
      `SELECT name, payload FROM liabilities.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("liabilities.hand-off");
    expect(Object.keys(rows[0]!.payload).sort()).toEqual(
      ["action", "actorAccountId", "changeId", "changes", "liabilityId"].sort(),
    );
  });
});

describe("ARC-04@PoC FR 2: `liabilities.changeKind` writes its audit entry after the liability's commit", () => {
  async function registered(space: Space) {
    const accountId = randomUUID();
    const result = await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId,
      terms: loanTerms,
    });
    if (result.kind !== "registered") throw new Error("not registered");
    return { accountId, liabilityId: result.liability.id };
  }

  it("ARC-04@PoC FR 2: the audit entry of a kind change is written once the new kind is committed", async () => {
    const space = await newSpace();
    const { accountId } = await registered(space);
    const seen = watchCommittedAtAudit(space.householdId);
    const changed = await liabilities.changeKind(space.householdId, {
      actorAccountId: space.accountId,
      accountId,
      kind: "credit-card",
    });
    expect(changed.kind).toBe("changed");
    expect(seen.kinds).toEqual([["credit-card"]]);
    expect(await liabilityAudit(space.householdId, "update")).toBe(1);
  });

  it("ARC-04@PoC FR 2: a failure in the liabilities transaction leaves the kind as it was and no audit entry", async () => {
    const space = await newSpace();
    const { accountId } = await registered(space);
    failLiabilitiesStatement(/^\s*INSERT INTO jobs\b/);
    await expect(
      liabilities.changeKind(space.householdId, {
        actorAccountId: space.accountId,
        accountId,
        kind: "credit-card",
      }),
    ).rejects.toThrow();
    expect((await liabilities.forAccount(space.householdId, accountId))?.kind).toBe("loan");
    expect(await liabilityAudit(space.householdId, "update")).toBe(0);
    expect(await liabilityJobs(space.householdId)).toBe(1);
  });

  it("ARC-04@PoC FR 2, FR 3: a failed audit write after the commit is written by the worker, each change once", async () => {
    const space = await newSpace();
    const { accountId, liabilityId } = await registered(space);
    failLiabilityAuditOnce();
    const input = { actorAccountId: space.accountId, accountId };
    expect((await liabilities.changeKind(space.householdId, { ...input, kind: "credit-card" })).kind).toBe(
      "changed",
    );
    vi.restoreAllMocks();
    expect((await liabilities.changeKind(space.householdId, { ...input, kind: "loan" })).kind).toBe(
      "changed",
    );
    // The same kind again writes nothing, not even a job.
    expect((await liabilities.changeKind(space.householdId, { ...input, kind: "loan" })).kind).toBe(
      "unchanged",
    );
    expect(await liabilityAudit(space.householdId, "update")).toBe(1);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await liabilityJobs(space.householdId)).toBe(3);
    const updates = (
      await audit.entriesFor(space.householdId, { type: "liabilities.liability", id: liabilityId })
    ).filter((e) => e.action === "update");
    expect(updates).toHaveLength(2);
    expect(updates.flatMap((e) => e.changes.filter((c) => c.field === "kind"))).toEqual(
      expect.arrayContaining([
        { field: "kind", before: "loan", after: "credit-card", masked: false },
        { field: "kind", before: "credit-card", after: "loan", masked: false },
      ]),
    );
  });
});

describe("ARC-04@PoC FR 2: through accounts — a loan's create and «Кредит» ↔ «Кредитна картка»", () => {
  it("ARC-04@PoC FR 2: a failed liability audit write does not fail «Новий рахунок»; the worker writes it once", async () => {
    const space = await newSpace();
    failLiabilityAuditOnce();
    const res = await call(space, "POST", "/v1/accounts", loanAccount);
    expect(res.statusCode).toBe(201);
    expect(await n("liabilities.liabilities WHERE household_id = $1", space.householdId)).toBe(1);
    // The account's own audit entry is in; the liability's waits in the liabilities queue.
    expect(await n("accounts.jobs WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await liabilityAudit(space.householdId, "create")).toBe(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
    expect(await liabilityJobs(space.householdId, "done")).toBe(1);
  });

  it("ARC-04@PoC FR 2: a failed liability audit write of a kind change keeps the change; the worker writes it once", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    failLiabilityAuditOnce();
    const res = await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" });
    expect(res.statusCode).toBe(200);
    expect((await liabilities.forAccount(space.householdId, created.id))?.kind).toBe("loan");
    expect(await liabilityAudit(space.householdId, "update")).toBe(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "update")).toBe(1);
  });
});

describe("ARC-04@PoC FR 4: the liabilities queue — dead jobs, daily recovery, erasure", () => {
  it("ARC-04@PoC FR 4: an audit job in state dead goes back to the liabilities queue with the daily recovery", async () => {
    const space = await newSpace();
    failLiabilityAuditOnce();
    await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId: randomUUID(),
      terms: loanTerms,
    });
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE liabilities.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    // The worker does not take a dead job.
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    const names = tasks.map((t) => t.name);
    expect(names).toContain("liabilities.hand-off-recovery");
    expect(names.indexOf("liabilities.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await tasks.find((t) => t.name === "liabilities.hand-off-recovery")!.run();
    expect(await liabilityJobs(space.householdId, "queued")).toBe(1);
    await runWorker(space.householdId);
    expect(await liabilityJobs(space.householdId, "done")).toBe(1);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
  });

  it("ARC-04@PoC FR 2: the space's erasure takes the liabilities queue's rows with its liabilities", async () => {
    const space = await newSpace();
    await liabilities.register(space.householdId, {
      actorAccountId: space.accountId,
      accountId: randomUUID(),
      terms: loanTerms,
    });
    const erased = await createLiabilitiesErasure(db.databases.for("liabilities")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ liabilities: 1, jobs: 1 });
    expect(await liabilityJobs(space.householdId)).toBe(0);
  });
});

describe("ARC-04@PoC FR 2 (#263 item 3): `pendingManaged` takes only the account's managed jobs not done", () => {
  it("ARC-04@PoC FR 2: a done closing whose transfer went to this account is not moved again by its «Оновити залишок»", async () => {
    const space = await newSpace();
    const open = async (name: string, amount: string) => {
      const res = await call(space, "POST", "/v1/accounts", {
        kind: "current",
        name,
        balance: eur(amount),
        balanceDate: "2026-10-01",
      });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };
    const from = await open("Готівка", "100.00");
    const to = await open("Ощадний", "500.00");
    await runWorker(space.householdId);
    const sub = async (accountId: string) =>
      (
        await db.owner.query<{ id: string; ledger_account_id: string }>(
          `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
          [space.householdId, accountId],
        )
      ).rows[0]!;
    const fromSub = await sub(from);
    const toSub = await sub(to);
    const job = (state: string, name: string) => {
      const changeId = randomUUID();
      return db.owner.query(
        `INSERT INTO accounts.jobs (household_id, name, dedupe_key, payload, state, finished_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'done' THEN now() END)`,
        [
          space.householdId,
          name,
          `managed:${from}:${changeId}`,
          JSON.stringify({
            kind: "managed",
            accountId: from,
            changeId,
            actor: { kind: "user", id: space.accountId },
            channel: "web",
            moves: [
              {
                op: "transfer",
                subaccountId: fromSub.id,
                currency: "EUR",
                toAccountId: to,
                from: fromSub.ledger_account_id,
                to: toSub.ledger_account_id,
                balance: "100",
                date: TODAY,
              },
            ],
            status: null,
          }),
          state,
        ],
      );
    };
    // Its transfer is done (and, here, never posted, so a repeat would post it now), and one of another job's name:
    // without the brackets around the transfer `OR`, either would be taken as pending.
    await job("done", "accounts.hand-off");
    await job("queued", "accounts.other-job");
    const res = await call(space, "POST", `/v1/accounts/${to}/balance`, { balance: eur("450.00") });
    expect(res.statusCode).toBe(200);
    expect(
      await n("ledger.entries WHERE household_id = $1 AND event_type = 'transfer'", space.householdId),
    ).toBe(0);
  });
});
