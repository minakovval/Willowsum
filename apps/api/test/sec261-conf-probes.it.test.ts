// Security review of PR #261 (ARC-04 c). Harness copied from arc04-accounts-manage-hand-off.it.test.ts.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices, type AccountsServices } from "../src/modules/accounts/index.ts";

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

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  services = createAccountsServices({
    ledger,
    liabilities,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    audit,
    clock: { now: () => NOW },
    newId: randomUUID,
    walletUsage: [],
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

const updateTo = (space: Space, id: string, amount: string) =>
  call(space, "POST", `/v1/accounts/${id}/balance`, { balance: eur(amount) });

describe("pr261-confirm: the widened pendingManaged", () => {
  it("pr261-confirm: a deferred closing whose debt is paid from this account is in before this account's «Оновити залишок»", async () => {
    const space = await newSpace();
    const from = await account(space, "Овердрафт", "-200.00");
    const to = await account(space, "Ощадний", "500.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    vi.restoreAllMocks();
    // 500 − 200 paid = 300 once the debt is paid; the user enters 350: +50, not −150.
    expect((await updateTo(space, to, "350.00")).statusCode).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, to)).toBe("350");
    expect(await balance(space, from)).toBe("0");
  });

  it("pr261-confirm: a deferred closing whose debt is paid from this account keeps this account from closing as if it held 500", async () => {
    const space = await newSpace();
    const from = await account(space, "Овердрафт", "-500.00");
    const to = await account(space, "Ощадний", "500.00");
    await runWorker(space.householdId);
    vi.spyOn(ledger, "post").mockRejectedValueOnce(new Error("injected"));
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: to } };
    expect((await call(space, "POST", `/v1/accounts/${from}/close`, body)).statusCode).toBe(200);
    vi.restoreAllMocks();
    // Its balance is 0 once the debt is paid: closing with no settlement is allowed, and nothing is left on it.
    expect((await call(space, "POST", `/v1/accounts/${to}/close`, { closedOn: TODAY })).statusCode).toBe(200);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await entriesOf(space.householdId, "transfer")).toBe(1);
    expect(await balance(space, to)).toBe("0");
  });

  it("pr261-confirm: a forged job of another space with a transfer into this space's account is not finished by this space's next change", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const id = await account(mine, "Готівка", "300.00");
    const other = await account(theirs, "Чужий", "50.00");
    await runWorker(mine.householdId);
    await runWorker(theirs.householdId);
    const ledgerOf = async (space: Space, accountId: string) =>
      (
        await db.owner.query<{ id: string; ledger_account_id: string }>(
          `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
          [space.householdId, accountId],
        )
      ).rows[0]!;
    const mineSub = await ledgerOf(mine, id);
    const theirSub = await ledgerOf(theirs, other);
    const changeId = randomUUID();
    await db.owner.query(
      `INSERT INTO accounts.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'accounts.hand-off', $2, $3)`,
      [
        theirs.householdId,
        `managed:${other}:${changeId}`,
        JSON.stringify({
          kind: "managed",
          accountId: other,
          changeId,
          actor: { kind: "user", id: theirs.accountId },
          channel: "web",
          moves: [
            {
              op: "transfer",
              subaccountId: mineSub.id,
              currency: "EUR",
              toAccountId: id,
              from: mineSub.ledger_account_id,
              to: theirSub.ledger_account_id,
              balance: "299",
              date: TODAY,
            },
          ],
          status: null,
        }),
      ],
    );
    expect((await updateTo(mine, id, "290.00")).statusCode).toBe(200);
    await runWorker(mine.householdId);
    expect(await balance(mine, id)).toBe("290");
    expect(await entriesOf(mine.householdId, "transfer")).toBe(0);
    expect(await entriesOf(theirs.householdId, "transfer")).toBe(0);
  });
});
