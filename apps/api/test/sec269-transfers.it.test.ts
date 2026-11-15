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
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * FIN-03@PoC b) (wave 2 row 16b), through the real API on a real PostgreSQL: transfers between own accounts — the
 * proposals of «Пари · N» (FR 5, FR 6), «Підтвердити» and «Позначити як переказ» (FR 7, FR 27), the fee and the currency
 * difference in the journal (FR 8), removing the mark (FR 9), and a transfer never hidden or split (FR 18). Every name and
 * amount is synthetic; the session is the test's principal header; the clock is fixed.
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
let beforeRate: (() => Promise<unknown>) | undefined;

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
  hidden: boolean;
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

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

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

/**
 * What went through «Зовнішні кошти» from the space's transactions — every income and expense in effect, gross, per
 * currency (reversed entries and their reversals cancel out in pairs, so they are left out).
 */
async function externalFlow(householdId: string): Promise<Record<string, string>> {
  const { rows } = await db.owner.query(
    `SELECT p.currency, sum(p.amount)::text AS net
       FROM ledger.postings p
       JOIN ledger.entries e ON e.household_id = p.household_id AND e.id = p.entry_id
       JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'external-funds'
                             AND a.id IN (p.debit_account_id, p.credit_account_id)
      WHERE p.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      GROUP BY p.currency`,
    [householdId],
  );
  return Object.fromEntries(rows.map((r: { currency: string; net: string }) => [r.currency, r.net]));
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
          // The probe's hook runs between markTransfer's first read and its locked recheck (TOCTOU probe).
          rates: async (requests) => {
            const hook = beforeRate;
            beforeRate = undefined;
            await hook?.();
            return fx.rates(requests);
          },
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
  // AC4: 43,50 UAH per EUR on the day of the debit.
  await rate("2026-10-14", "EUR", "43.5");
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

/** A space with A (1 000 EUR) and B (0 EUR) and the pair of AC2: −500 EUR on A, +498 EUR on B two days later. */
async function ac2() {
  const space = await newSpace();
  const a = await createAccount(space, "1000.00");
  const b = await createAccount(space, "0.00");
  const out = await add(space, a, "-500.00", "2026-10-13");
  const into = await add(space, b, "498.00", "2026-10-15");
  return { space, a, b, out, into };
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

/** Defers every inline hand-off of `work`, so the queue holds them for the probe to order. */
async function deferred<T>(work: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(ledger, "liveEntries").mockRejectedValue(new Error("injected"));
  try {
    return await work();
  } finally {
    spy.mockRestore();
  }
}

const holdJobOf = (householdId: string, transactionId: string, hold: boolean) =>
  db.owner.query(
    `UPDATE transactions.jobs SET run_after = now() + ($3::text)::interval, state = 'queued'
      WHERE household_id = $1 AND payload->>'transactionId' = $2 AND state <> 'done'`,
    [householdId, transactionId, hold ? "1 day" : "-1 second"],
  );

describe("PR #269 security probes", () => {
  it("SEC-269 race: the outflow's hand-off runs first, then the inflow's — the active transfer event stays (deterministic)", async () => {
    const { space, a, b, out, into } = await ac2();
    // The create hand-offs ran inline already; the mark's two are deferred.
    const res = await deferred(() => mark(space, out.id, into.id));
    expect(res.statusCode, res.body).toBe(200);
    await holdJobOf(space.householdId, into.id, true);
    await runWorker(space.householdId);
    // The outflow's hand-off alone: fee and transfer posted, the inflow's own event still in effect.
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transaction", "2026-10-15"],
      ["transfer", "2026-10-13"],
    ]);
    await holdJobOf(space.householdId, into.id, false);
    await runWorker(space.householdId);
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transfer", "2026-10-13"],
    ]);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
  });

  it("SEC-269 race: unmark, re-mark with a late untransfer hand-off of the inflow last — only the new transfer is in effect", async () => {
    const { space, a, b, out, into } = await ac2();
    await mark(space, out.id, into.id);
    await deferred(() => call(space, "DELETE", `/v1/transactions/${out.id}/transfer`));
    const again = await deferred(() => mark(space, into.id, out.id));
    expect(again.statusCode, again.body).toBe(200);
    // Every inflow job waits; the outflow's (untransfer, then transfer of the new pair) run first.
    await holdJobOf(space.householdId, into.id, true);
    await runWorker(space.householdId);
    await holdJobOf(space.householdId, into.id, false);
    await runWorker(space.householdId);
    expect((await liveEntries(space.householdId)).sort()).toEqual([
      ["transaction", "2026-10-13"],
      ["transfer", "2026-10-13"],
    ]);
    expect([await balance(space, a), await balance(space, b)]).toEqual(["500", "498"]);
    expect(await externalFlow(space.householdId)).toEqual({ EUR: "2.000000000000000000" });
  });

  it("SEC-269 isolation: a scoped member gets 404 on proposals with no count, ids or amounts; a scoped write is refused before any lookup", async () => {
    const { space, out, into } = await ac2();
    const res = await call(space, "GET", "/v1/transfer-proposals", undefined, {
      role: "editor",
      scoped: true,
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(out.id);
    expect(res.body).not.toContain(into.id);
    expect(res.body).not.toMatch(/"count"|500|498/);
    const unknown = await mark(space, randomUUID(), into.id, { role: "editor", scoped: true });
    const known = await mark(space, out.id, into.id, { role: "editor", scoped: true });
    expect([known.statusCode, known.json().code]).toEqual([unknown.statusCode, unknown.json().code]);
    expect((await get(space, out.id)).transfer).toBeNull();
  });

  it("SEC-269 isolation: an unknown counterpart and another space's answer alike; the error names no value", async () => {
    const mine = await ac2();
    const theirs = await ac2();
    const cross = await mark(mine.space, mine.out.id, theirs.into.id);
    const unknown = await mark(mine.space, mine.out.id, randomUUID());
    expect([cross.statusCode, cross.json().errors]).toEqual([unknown.statusCode, unknown.json().errors]);
    expect(cross.body).not.toContain(theirs.into.id);
    expect(cross.body).not.toMatch(/498/);
  });

  it("SEC-269 erasure: erasing a space removes its transfers and leaves another space's", async () => {
    const { createTransactionsErasure } = await import("../src/modules/transactions/index.ts");
    const mine = await ac2();
    const theirs = await ac2();
    await mark(mine.space, mine.out.id, mine.into.id);
    await mark(theirs.space, theirs.out.id, theirs.into.id);
    await createTransactionsErasure(db.databases.for("transactions")).eraseHousehold(mine.space.householdId);
    const count = async (h: string) =>
      (
        await db.owner.query(
          `SELECT count(*)::int AS n FROM transactions.transfers WHERE household_id = $1`,
          [h],
        )
      ).rows[0].n;
    expect(await count(mine.space.householdId)).toBe(0);
    expect(await count(theirs.space.householdId)).toBe(1);
  });

  it("SEC-269 money: a currency transfer posts fx-transfer with the stored dated NBU rate; nothing passes through a JS number", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "2000.00");
    const u = await createAccount(space, "0.00", "UAH");
    const out = await add(space, a, "-1000.00", "2026-10-14");
    const into = await add(space, u, "42900.00", "2026-10-15", "UAH");
    const res = await mark(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer.rate).toMatchObject({ date: "2026-10-14", source: "NBU" });
    const stored = await db.owner.query(
      `SELECT rate::text AS rate, rate_date::text AS d, rate_source FROM transactions.transfers WHERE household_id = $1`,
      [space.householdId],
    );
    expect(stored.rows[0]).toMatchObject({ d: "2026-10-14", rate_source: "NBU" });
    expect((await liveEntries(space.householdId)).map((e) => e[0]).sort()).toEqual(["fx-transfer"]);
    expect(await externalFlow(space.householdId)).toEqual({});
  });

  it("SEC-269 privacy: the hand-off job payloads carry ids and masked values only, never the counterparty", async () => {
    const { space, out, into } = await ac2();
    await mark(space, out.id, into.id);
    const { rows } = await db.owner.query(
      `SELECT payload::text AS p FROM transactions.jobs WHERE household_id = $1 AND payload->>'action' = 'transfer'`,
      [space.householdId],
    );
    expect(rows.length).toBe(2);
    for (const r of rows as { p: string }[]) expect(r.p).not.toContain("Синтетичний");
  });
});
