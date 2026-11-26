import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * IMP-03@PoC b) (wave 2 row 48), through the real API on a real PostgreSQL: transfers between own accounts in «Пари · N»
 * scored 0–100 with a confidence (FR 3, AC1, AC3, AC14), one-to-one with «неоднозначно з…» (FR 7, FR 12, AC6, EC4),
 * «Не пара» never proposed again (FR 12, AC5) and in the audit log (FR 19), another space (AC13). Every name and amount
 * is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-03-10";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

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

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const proposals = async (space: Space, principal: Principal = {}) => {
  const res = await call(space, "GET", "/v1/transfer-proposals", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    more: boolean;
    items: {
      outflow: { transactionId: string };
      inflow: { transactionId: string };
      date: string;
      pairKind: string;
      kind: string;
      bankRate: string | null;
      rateBand: string | null;
      fee: { amount: string } | null;
      converted: { amount: string; currency: string } | null;
      difference: { amount: string } | null;
      rate: { rate: string; date: string } | null;
      score: number;
      confidence: string;
      evidence: { code: string; points: number; days: number | null }[];
      ambiguousWith: { transactionId: string; score: number }[];
    }[];
  };
};

const dismiss = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/not-transfer`, { counterpartId }, principal);

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
          pendingPostings: [],
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
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
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
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

/** A space with «Поточний» and «Ощадний» (EUR) and the pair of AC1: −500,00 EUR on 2 March, +500,00 EUR on 3 March. */
async function ac1() {
  const space = await newSpace();
  const current = await createAccount(space, "3000.00");
  const savings = await createAccount(space, "0.00");
  const out = await add(space, current, "-500.00", "2026-03-02");
  const into = await add(space, savings, "500.00", "2026-03-03");
  return { space, current, savings, out, into };
}

const RANDOM_ID = "99999999-9999-4999-8999-999999999999";
const stored = async (householdId: string) =>
  (
    await db.owner.query(
      `SELECT outflow_id, inflow_id FROM transactions.transfer_dismissals WHERE household_id = $1`,
      [householdId],
    )
  ).rows as { outflow_id: string; inflow_id: string }[];

describe("PR #725 security: «Не пара» and scored proposals", () => {
  it("sec725 П-5: another space's transaction as either side answers exactly as a random id, and nothing is stored in either space", async () => {
    const a = await ac1();
    const b = await ac1();
    // The path id of another space: the same 404 as a random id.
    const foreignPath = await dismiss(b.space, a.out.id, b.into.id);
    const randomPath = await dismiss(b.space, RANDOM_ID, b.into.id);
    expect(foreignPath.statusCode).toBe(404);
    expect(leakText(foreignPath.body).replaceAll(a.out.id, "ID")).toBe(
      leakText(randomPath.body).replaceAll(RANDOM_ID, "ID"),
    );
    // The counterpart of another space: the same 400 as a random id.
    const foreignOther = await dismiss(b.space, b.out.id, a.into.id);
    const randomOther = await dismiss(b.space, b.out.id, RANDOM_ID);
    expect(foreignOther.statusCode).toBe(400);
    expect(foreignOther.json().errors ?? foreignOther.json().issues).toEqual(
      randomOther.json().errors ?? randomOther.json().issues,
    );
    expect(leakText(foreignOther.body)).not.toContain("500");
    expect(await stored(a.space.householdId)).toEqual([]);
    expect(await stored(b.space.householdId)).toEqual([]);
    expect((await proposals(a.space)).count).toBe(1);
    expect((await get(a.space, a.out.id)).transfer).toBeNull();
  });

  it("sec725 ARC-03: the module's role bound to another space neither reads nor writes a space's «Не пара» pairs", async () => {
    const a = await ac1();
    const b = await newSpace();
    expect((await dismiss(a.space, a.out.id, a.into.id)).statusCode).toBe(200);
    const tdb = db.databases.for("transactions");
    const seen = await tdb.inHousehold(
      b.householdId,
      async (q) => (await q.query(`SELECT count(*)::int AS n FROM transfer_dismissals`)).rows[0]!.n,
    );
    expect(seen).toBe(0);
    await expect(
      tdb.inHousehold(b.householdId, (q) =>
        q.query(`INSERT INTO transfer_dismissals (household_id, outflow_id, inflow_id) VALUES ($1, $2, $3)`, [
          a.space.householdId,
          a.into.id,
          a.out.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const gone = await tdb.inHousehold(
      b.householdId,
      async (q) => (await q.query(`DELETE FROM transfer_dismissals`)).rowCount,
    );
    expect(gone).toBe(0);
    expect(await stored(a.space.householdId)).toEqual([{ outflow_id: a.out.id, inflow_id: a.into.id }]);
    // A pair of one space with a transaction of another cannot exist at all (the household-scoped foreign key).
    await expect(
      db.owner.query(
        `INSERT INTO transactions.transfer_dismissals (household_id, outflow_id, inflow_id) VALUES ($1, $2, $3)`,
        [b.householdId, a.out.id, a.into.id],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("sec725 FR 12: a «Не пара» pair is gone with either transaction, and the deletion is not blocked", async () => {
    const { space, out, into } = await ac1();
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(200);
    expect(await stored(space.householdId)).toHaveLength(1);
    expect((await call(space, "DELETE", `/v1/transactions/${into.id}`)).statusCode).toBeLessThan(300);
    expect(await stored(space.householdId)).toEqual([]);
  });

  it("sec725 FR 19, П-10: the audit entry of «Не пара» carries the other transaction's id only — no amount, no text", async () => {
    const { space, out, into } = await ac1();
    expect((await dismiss(space, into.id, out.id)).statusCode).toBe(200);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: into.id });
    const entry = log.filter((e) => e.changes.some((ch) => ch.field === "notTransferOf"));
    expect(entry).toHaveLength(1);
    expect(entry[0]!.changes).toHaveLength(1);
    expect(entry[0]!.changes[0]).toMatchObject({ field: "notTransferOf", before: null, after: out.id });
    // Ids and timestamps are random (a uuid or the milliseconds may hold «500» by chance): blanked, the rest is checked.
    const text = JSON.stringify(entry[0])
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>");
    expect(text).not.toContain("500");
    expect(text).not.toContain("Синтетичний");
    // The other side has no entry and is unchanged.
    const otherLog = await audit.entriesFor(space.householdId, {
      type: "transactions.transaction",
      id: out.id,
    });
    expect(otherLog.filter((e) => e.changes.some((ch) => ch.field === "notTransferOf"))).toEqual([]);
  });

  it("sec725 money: «Не пара» moves no money — the journal's balances and both transactions' amounts stay", async () => {
    const { space, current, savings, out, into } = await ac1();
    const balances = async () =>
      Promise.all(
        [current, savings].map(async (id) => (await call(space, "GET", `/v1/accounts/${id}`)).json().balance),
      );
    const before = await balances();
    const entriesBefore = (
      await db.owner.query(`SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`, [
        space.householdId,
      ])
    ).rows[0].n;
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(200);
    expect(await balances()).toEqual(before);
    const entriesAfter = (
      await db.owner.query(`SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`, [
        space.householdId,
      ])
    ).rows[0].n;
    expect(entriesAfter).toBe(entriesBefore);
    expect((await get(space, out.id)).transfer).toBeNull();
  });

  it("sec725 FR 12: «Не пара» on a transaction of a closed account is refused (409) and nothing is stored", async () => {
    const { space, current, out, into } = await ac1();
    await db.owner.query(
      `UPDATE accounts.accounts SET status = 'closed', closed_on = $3 WHERE household_id = $1 AND id = $2`,
      [space.householdId, current, TODAY],
    );
    const res = await dismiss(space, out.id, into.id);
    expect(res.statusCode).toBe(409);
    expect(await stored(space.householdId)).toEqual([]);
  });

  it("sec725 NFR: the read looks at 500 + 1 candidate pairs at most, whatever the space holds", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "3000.00");
    const savings = await createAccount(space, "0.00");
    // 24 debits x 24 credits of one amount on one day: 576 candidate pairs.
    for (let i = 0; i < 24; i++) {
      await add(space, current, "-10.00", "2026-03-02");
      await add(space, savings, "10.00", "2026-03-02");
    }
    const res = await proposals(space);
    expect(res.more).toBe(true);
    // One-to-one: at most 24 pairs can be open, and no transaction is in two.
    const sides = res.items.flatMap((p) => [p.outflow.transactionId, p.inflow.transactionId]);
    expect(new Set(sides).size).toBe(sides.length);
    expect(res.count).toBeLessThanOrEqual(24);
    expect(res.count).toBe(res.items.length);
  });

  it("sec725 concurrency: «Не пара» waits for the row's lock and keeps a change committed meanwhile (no stale write)", async () => {
    const { space, out, into } = await ac1();
    const row = async () =>
      (
        await db.owner.query(
          `SELECT counterparty, version, amount::text AS amount FROM transactions.transactions WHERE household_id = $1 AND id = $2`,
          [space.householdId, out.id],
        )
      ).rows[0] as { counterparty: string; version: number; amount: string };
    const before = await row();
    await db.owner.query("BEGIN");
    let waiting: ReturnType<typeof dismiss>;
    try {
      await db.owner.query(
        `SELECT 1 FROM transactions.transactions WHERE household_id = $1 AND id = $2 FOR UPDATE`,
        [space.householdId, out.id],
      );
      waiting = dismiss(space, out.id, into.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await db.owner.query(
        `UPDATE transactions.transactions SET counterparty = 'Змінено тим часом', version = version + 1 WHERE household_id = $1 AND id = $2`,
        [space.householdId, out.id],
      );
      await db.owner.query("COMMIT");
    } catch (error) {
      await db.owner.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    expect((await waiting).statusCode).toBe(200);
    expect(await row()).toEqual({
      counterparty: "Змінено тим часом",
      version: before.version + 2,
      amount: before.amount,
    });
  });

  it("sec725 privacy: the hand-off job of «Не пара» carries ids only — no counterparty, no amount", async () => {
    const { space, out, into } = await ac1();
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT payload::text AS p FROM transactions.jobs WHERE household_id = $1 AND payload->>'action' = 'not-transfer'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].p).not.toContain("Синтетичний");
    expect(rows[0].p).not.toContain("500");
    expect(rows[0].p).toContain(into.id);
  });
});
