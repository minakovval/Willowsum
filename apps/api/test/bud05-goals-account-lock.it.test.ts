import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountsServices,
  lockAccounts,
} from "../src/modules/accounts/index.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-05@PoC FR 3 (the envelopes of an account never exceed its balance) with #298 «Залишок читається поза
 * блокуванням», checked with wave 2 row 198's lock (owner, 2026-11-17): a goal's envelope reads the account's balance
 * under the account's money lock (`lockAccounts`), the one module accounts' changes and module transactions' writes take
 * — not only the copy read before the goals transaction. The balance a lock holder leaves stands for its change (the
 * journal read is the test's: it answers the new balance once the holder has committed). Real API, real PostgreSQL,
 * synthetic data, fixed clock.
 */
const WEB = "http://localhost:5173";
const clock = { now: () => Date.parse("2026-10-17T10:00:00Z") };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let app: ReturnType<typeof buildServer>;
/** The balance the journal answers instead of its own, while set: what a committed change of the account left. */
let changedBalance: Money | null = null;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

const eur = (amount: string) => ({ amount, currency: "EUR" });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown) {
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

async function savings(space: Space, amount: string): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "savings",
    name: "Синтетичний ощадний",
    balance: eur(amount),
    balanceDate: "2026-10-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [space.householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
  return res.json().id as string;
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  const audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
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
        goals: createGoalsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger: {
            ...ledger,
            balanceAt: async (...args: Parameters<typeof ledger.balanceAt>) =>
              changedBalance ?? ledger.balanceAt(...args),
          },
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

describe("BUD-05@PoC FR 3: an envelope against the balance read under the account's lock (#298)", () => {
  it("BUD-05@PoC FR 3: while another module holds the account's lock, a new envelope waits and is checked against the balance that module's change leaves", async () => {
    const space = await newSpace();
    const accountId = await savings(space, "1000.00");
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await lockAccounts(holder, space.householdId, [accountId]);
      let done = false;
      const created = call(space, "POST", "/v1/goals", {
        template: "travel",
        name: "Відпустка в Італії",
        target: eur("4000.00"),
        targetDate: "2027-07-01",
        part: { kind: "envelope", accountId, startAmount: "800.00" },
      }).finally(() => {
        done = true;
      });
      await sleep(400);
      const waited = !done;
      // The holder's change: 500 EUR left on the account once it commits.
      changedBalance = Money.of("500", "EUR");
      await holder.query("COMMIT");
      const res = await created;
      expect(waited).toBe(true);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("300") });
    } finally {
      changedBalance = null;
      await holder.end();
    }
    const list = await call(space, "GET", "/v1/goals");
    expect(list.json().goals).toHaveLength(0);
  });
});
