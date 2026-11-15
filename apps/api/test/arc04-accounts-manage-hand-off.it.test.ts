import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
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

/** Fails the first statement of the accounts module that matches `sql` (a step of its transaction). */
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

describe("ARC-04@PoC FR 2: closing an account hands its transfer and audit entries over atomically", () => {
  it.each([
    ["the account's status", /^\s*UPDATE accounts SET status\b/],
    ["the hand-off job", /^\s*INSERT INTO jobs\b/],
  ])(
    "ARC-04@PoC FR 2: a failure at %s rolls the closing back and moves no money, with no audit entry",
    async (_step, sql) => {
      const space = await newSpace();
      const from = await account(space, "Поточний", "430.00");
      const to = await account(space, "Ощадний", "0.00");
      failAccountsStatement(sql);
      const res = await call(space, "POST", `/v1/accounts/${from}/close`, {
        closedOn: TODAY,
        settlement: { kind: "transfer", toAccountId: to },
      });
      expect(res.statusCode).toBe(500);
      vi.restoreAllMocks();
      await runWorker(space.householdId);
      expect(await entriesOf(space.householdId, "transfer")).toBe(0);
      expect(await balance(space, from)).toBe("430");
      expect((await auditOf(space.householdId, from)).updates).toEqual([]);
      expect((await call(space, "GET", `/v1/accounts/${from}`)).json().status).toBe("active");
    },
  );

  it("ARC-04@PoC FR 2: a failure of the transfer after the commit closes the account; the worker moves the balance once with its audit entries", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "POST", `/v1/accounts/${from}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: to },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");
    // Nothing reached the journal or the audit log yet: no audit entry of a transfer that did not happen.
    expect(await entriesOf(space.householdId, "transfer")).toBe(0);
    expect((await auditOf(space.householdId, from)).updates).toEqual([]);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, from)).toBe("0");
    expect(await balance(space, to)).toBe("430");
    const changes = (await auditOf(space.householdId, from)).updates.flatMap((e) =>
      e.changes.map((c) => [c.field, c.after]),
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        ["status", "closed"],
        ["settlement.kind", "transfer"],
        ["settlement.EUR", "430"],
      ]),
    );
    // The transfer's entry and the closing's: two entries, each once.
    expect((await auditOf(space.householdId, from)).updates).toHaveLength(2);
  });

  it("ARC-04@PoC FR 3: an audit outage after a closing's transfer is finished by the worker without a second transfer", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    failAuditOf("accounts.account", true);
    const res = await call(space, "POST", `/v1/accounts/${from}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: to },
    });
    expect(res.statusCode).toBe(200);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, to)).toBe("430");
    expect((await auditOf(space.householdId, from)).updates).toHaveLength(2);
  });

  it("ARC-04@PoC FR 3: a closing handed over right away and again by the worker writes everything once", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "120.00");
    const res = await call(space, "POST", `/v1/accounts/${from}/close`, {
      closedOn: TODAY,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currencies[0].balance.amount).toBe("0");
    const before = await auditOf(space.householdId, from);
    expect(before).toMatchObject({ adjustments: 1 });
    expect(before.updates).toHaveLength(1);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await entriesOf(space.householdId, "balance-adjustment")).toBe(1);
    expect(await auditOf(space.householdId, from)).toEqual(before);
  });

  it("ARC-04@PoC FR 3: closed, reopened and closed again before the first closing's transfer was handed over — the balance moves once", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect((await call(space, "POST", `/v1/accounts/${from}/reopen`)).statusCode).toBe(200);
    // The first closing's transfer goes in before this one is planned: its balance is zero then, nothing to move.
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, from)).toBe("0");
    expect(await balance(space, to)).toBe("430");
    expect(await pendingJobs(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 3: «Оновити залишок» of the receiving account before a closing's transfer into it was handed over leaves the balance entered", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "100.00");
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    vi.restoreAllMocks();
    // The transfer into this account goes in before the adjustment is planned: 530 → 500.
    const res = await call(space, "POST", `/v1/accounts/${to}/balance`, { balance: eur("500.00") });
    expect(res.statusCode).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, to)).toBe("500");
  });

  it("ARC-04@PoC FR 3: the receiving account of a closing's transfer not handed over yet cannot be closed as if its balance were zero", async () => {
    const space = await newSpace();
    const from = await account(space, "Поточний", "430.00");
    const to = await account(space, "Ощадний", "0.00");
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    vi.restoreAllMocks();
    // FIN-12 FR 7: its balance is 430 once the transfer is in, so closing without a settlement is refused.
    expect((await call(space, "POST", `/v1/accounts/${to}/close`, { closedOn: TODAY })).statusCode).toBe(409);
    await runWorker(space.householdId);
    expect((await call(space, "GET", `/v1/accounts/${to}`)).json().status).toBe("active");
    expect(await balance(space, to)).toBe("430");
  });

  it("ARC-04@PoC FR 2: «Відкрити знову» with the audit log away is made, and its audit entry is written once by the worker", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "0.00");
    expect((await call(space, "POST", `/v1/accounts/${id}/close`, { closedOn: TODAY })).statusCode).toBe(200);
    failAuditOf("accounts.account");
    const res = await call(space, "POST", `/v1/accounts/${id}/reopen`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
    expect((await auditOf(space.householdId, id)).updates).toHaveLength(1);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    const statuses = (await auditOf(space.householdId, id)).updates.map(
      (e) => e.changes.find((c) => c.field === "status")?.after,
    );
    expect(statuses).toEqual(["closed", "active"]);
  });
});

describe("ARC-04@PoC FR 2: «Оновити залишок» hands its adjustment and audit entry over atomically", () => {
  it("ARC-04@PoC FR 2: a failure at the hand-off job rolls «Оновити залишок» back — no adjustment, no audit entry", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    failAccountsStatement(/^\s*INSERT INTO jobs\b/);
    const res = await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("250.00") });
    expect(res.statusCode).toBe(500);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "balance-adjustment")).toBe(0);
    expect((await auditOf(space.householdId, id)).adjustments).toBe(0);
    expect(await balance(space, id)).toBe("300");
  });

  it("ARC-04@PoC FR 2: a failure of the adjustment after the commit is finished by the worker: the balance entered, one audit entry", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("250.00") });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(true);
    expect((await auditOf(space.householdId, id)).adjustments).toBe(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, id)).toBe("250");
    expect(await entriesOf(space.householdId, "balance-adjustment")).toBe(1);
    expect((await auditOf(space.householdId, id)).adjustments).toBe(1);
  });

  it("ARC-04@PoC FR 3: a second «Оновити залишок» before the first was handed over leaves one adjustment and the balance last entered", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    expect(
      (await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("280.00") })).statusCode,
    ).toBe(200);
    vi.restoreAllMocks();
    const second = await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("250.00") });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ changed: true, adjustment: { amount: eur("-50") } });
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("250");
    const adjustments = (await call(space, "GET", `/v1/accounts/${id}`)).json().adjustments;
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toEqual(eur("-50"));
    // Created by the first, changed by the second: two audit entries of the adjustment.
    expect((await auditOf(space.householdId, id)).adjustments).toBe(2);
  });

  it("ARC-04@PoC FR 2: deleting the adjustment with its reversal failing after the commit is finished by the worker; its audit entry once", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    const updated = await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("250.00") });
    const adjustmentId = updated.json().adjustment.id as string;
    vi.spyOn(ledger, "reverse").mockRejectedValueOnce(new Error("injected"));
    const res = await call(space, "DELETE", `/v1/accounts/${id}/balance-adjustments/${adjustmentId}`);
    expect(res.statusCode).toBe(200);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("300");
    expect((await call(space, "GET", `/v1/accounts/${id}`)).json().adjustments).toEqual([]);
    expect((await auditOf(space.householdId, id)).adjustments).toBe(2);
    expect(await pendingJobs(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 2: a statement's recount with the journal away is finished by the worker", async () => {
    const space = await newSpace();
    const created = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Імпортований",
      balance: eur("1000.00"),
      balanceDate: "2026-10-01",
    });
    const id = created.json().id as string;
    // A temporary adjustment, as an imported account has (FIN-12 FR 15).
    await db.owner.query(
      `UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`,
      [space.householdId, id],
    );
    expect(
      (await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("1040.00") })).statusCode,
    ).toBe(200);
    vi.spyOn(ledger, "correct").mockRejectedValueOnce(new Error("injected"));
    const statements = createAccountStatements(db.databases.for("accounts"), services);
    const result = await statements.reconcile(space.householdId, {
      accountId: id,
      statementEnd: TODAY,
      closingBalance: Money.of("1030.00", "EUR"),
    });
    expect(result.kind).toBe("changed");
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await balance(space, id)).toBe("1030");
    expect((await auditOf(space.householdId, id)).adjustments).toBe(2);
  });
});

describe("ARC-04@PoC FR 2: the audit entries of «Основне» and «Реквізити» follow the commit", () => {
  it("ARC-04@PoC FR 2: a failure in the accounts transaction of a rename writes no audit entry and no job", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "10.00");
    await runWorker(space.householdId);
    failAccountsStatement(/^\s*UPDATE accounts SET name\b/);
    expect((await call(space, "PATCH", `/v1/accounts/${id}`, { name: "Сімейний" })).statusCode).toBe(500);
    vi.restoreAllMocks();
    expect((await auditOf(space.householdId, id)).updates).toEqual([]);
    expect(await pendingJobs(space.householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 2: a rename with the audit log away is made; the worker writes its audit entry once", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "10.00");
    failAuditOf("accounts.account");
    const res = await call(space, "PATCH", `/v1/accounts/${id}`, { name: "Сімейний" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Сімейний");
    expect((await auditOf(space.householdId, id)).updates).toEqual([]);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    const updates = (await auditOf(space.householdId, id)).updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toContainEqual({
      field: "name",
      before: "Поточний",
      after: "Сімейний",
      masked: false,
    });
  });

  it("ARC-04@PoC FR 2: «Реквізити» with the audit log away are changed; the job holds no note or full number, the entry is masked", async () => {
    const space = await newSpace();
    const id = await account(space, "Поточний", "10.00");
    failAuditOf("accounts.account");
    const iban = "UA113223130000026007233561234";
    const res = await call(space, "PATCH", `/v1/accounts/${id}/details`, {
      number: iban,
      note: "Синтетична нотатка",
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await db.owner.query<{ payload: unknown }>(
      `SELECT payload FROM accounts.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    const payload = JSON.stringify(rows.map((r) => r.payload));
    expect(payload).not.toContain("Синтетична нотатка");
    expect(payload).not.toContain(iban);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    const updates = (await auditOf(space.householdId, id)).updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toContainEqual({
      field: "note",
      before: null,
      after: AUDIT_MASK,
      masked: true,
    });
    expect(updates[0]!.changes).toContainEqual({
      field: "numberLast4",
      before: null,
      after: "••1234",
      masked: false,
    });
  });
});

describe("ARC-04@PoC FR 4: a managing hand-off the worker gave up on", () => {
  it("ARC-04@PoC FR 4: a dead hand-off of «Оновити залишок» goes back to the accounts queue with the daily recovery and is finished", async () => {
    const space = await newSpace();
    const id = await account(space, "Готівка", "300.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValue(new Error("injected"));
    // The worker with the test's own (failing) journal, until the job has used all its attempts.
    const w = createWorker({
      queues: [createAccountsWorkerQueue(db.databases.for("accounts"), { ledger, liabilities, audit })],
      households: async () => [space.householdId],
      retryDelayMs: () => 0,
    });
    expect(
      (await call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur("250.00") })).statusCode,
    ).toBe(200);
    for (let i = 0; i < 9; i++) {
      await w.tick();
      await w.idle();
    }
    await w.stop();
    expect(await n("accounts.jobs WHERE household_id = $1 AND state = 'dead'", space.householdId)).toBe(1);
    vi.restoreAllMocks();
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((t) => t.name === "accounts.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await pendingJobs(space.householdId)).toBe(0);
    expect(await balance(space, id)).toBe("250");
    expect((await auditOf(space.householdId, id)).adjustments).toBe(1);
  });
});
