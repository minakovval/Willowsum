import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createTransactionsServices } from "../src/modules/transactions/index.ts";
import { leakText } from "./leak-text.ts";

/**
 * FIN-03@PoC a) (wave 2 row 15), through the real API on a real PostgreSQL: a transaction entered by hand is one
 * journal event on its account's subaccount, changed by a correction and deleted by a reversal; the list «Транзакції»
 * runs on the universal list engine (DAT-01) with its whitelists, numbered pages and the totals of income, expenses
 * and the difference in the profile currency at the official rate of each transaction's date. Every name and amount
 * is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
/** «Today» of these tests (Kyiv and UTC). */
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
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
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function createAccount(
  space: Space,
  body: { kind?: string; name: string; amount: string; currency?: string },
): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: body.kind ?? "current",
    name: body.name,
    balance: { amount: body.amount, currency: body.currency ?? "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const tx = (
  accountId: string,
  amount: string,
  extra: { currency?: string; date?: string; counterparty?: string; description?: string } = {},
) => ({
  accountId,
  amount: { amount, currency: extra.currency ?? "EUR" },
  date: extra.date ?? "2026-10-15",
  ...(extra.counterparty !== undefined ? { counterparty: extra.counterparty } : {}),
  ...(extra.description !== undefined ? { description: extra.description } : {}),
});

async function add(space: Space, body: ReturnType<typeof tx>, principal: Principal = {}) {
  const res = await call(space, "POST", "/v1/transactions", body, principal);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; amount: { amount: string; currency: string }; type: string };
}

const balance = async (space: Space, accountId: string, currency?: string) => {
  const account = (await call(space, "GET", `/v1/accounts/${accountId}`)).json();
  const c = (account.currencies as { currency: string; balance: { amount: string } }[]).find(
    (x) => currency === undefined || x.currency === currency,
  );
  return c?.balance.amount;
};

async function entries(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT id, source_module, source_id, event_type, operation_date::text AS operation_date, reverses_entry_id
       FROM ledger.entries WHERE household_id = $1 ORDER BY recorded_at, id`,
    [householdId],
  );
  return rows as {
    id: string;
    source_module: string;
    source_id: string;
    event_type: string;
    operation_date: string;
    reverses_entry_id: string | null;
  }[];
}

const transactionEntries = async (householdId: string) =>
  (await entries(householdId)).filter((e) => e.source_module === "transactions");

const rows = async (householdId: string) =>
  Number(
    (
      await db.owner.query(
        `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1`,
        [householdId],
      )
    ).rows[0]!.n,
  );

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
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
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
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

beforeEach(() => off.clear());

/** Security review of PR #235 (FIN-03 a): extra properties, each killed by a mutant of its guard. */
describe("PR #235 security: isolation, whitelists, idempotency, erasure", () => {
  it("RLS alone hides another space's rows from the transactions role (no household filter in SQL)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, { name: "Щоденний", amount: "100.00" });
    await add(a, tx(account, "-1.00"));
    await call(a, "POST", "/v1/transactions", tx(account, "-2.00"), {}, { "idempotency-key": randomUUID() });
    const seen = await db.databases.for("transactions").inHousehold(b.householdId, async (q) => ({
      t: (await q.query(`SELECT count(*)::int AS n FROM transactions`)).rows[0]!.n,
      k: (await q.query(`SELECT count(*)::int AS n FROM idempotency_keys`)).rows[0]!.n,
      j: (await q.query(`SELECT count(*)::int AS n FROM jobs`)).rows[0]!.n,
      sum: (await q.query(`SELECT coalesce(sum(amount), 0)::text AS s FROM transactions`)).rows[0]!.s,
    }));
    expect(seen).toEqual({ t: 0, k: 0, j: 0, sum: "0" });
    const { rows: rls } = await db.owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'transactions' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(rls).toEqual([
      // «Не дубль» pairs (FIN-03 b, migrations/0006_duplicates.sql).
      { relname: "duplicate_dismissals", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "idempotency_keys", relrowsecurity: true, relforcerowsecurity: true },
      // The rollback records of import batches (IMP-16 FR 3, migrations/0012_import_rollbacks.sql).
      { relname: "import_rollbacks", relrowsecurity: true, relforcerowsecurity: true },
      // The write records of import batches (IMP-01 FR 11, migrations/0010_import_rows.sql).
      { relname: "import_voids", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "import_writes", relrowsecurity: true, relforcerowsecurity: true },
      // The hand-off queue (ARC-04, migrations/0003_queue.sql).
      { relname: "jobs", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "outbox_events", relrowsecurity: true, relforcerowsecurity: true },
      // The space's tags (BUD-13 a, migrations/0007_attributes.sql).
      { relname: "tags", relrowsecurity: true, relforcerowsecurity: true },
      // The parts of a split (FIN-03 b, migrations/0004_states_and_splits.sql).
      { relname: "transaction_parts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "transactions", relrowsecurity: true, relforcerowsecurity: true },
      // The pairs of transfers between own accounts (FIN-03 b, migrations/0005_transfers.sql).
      { relname: "transfers", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("the list never counts or sums another space's rows, whatever the filter, sort or injection attempt", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const account = await createAccount(a, { name: "Щоденний", amount: "100.00" });
    await add(a, tx(account, "-7.00", { counterparty: "Сільпо", description: "x" }));
    for (const q of [
      "",
      `filter=accountId.eq:${account}`,
      "filter=search.has:%25",
      "filter=counterparty.has:_",
      "filter=search.has:' OR 1=1 --",
      "filter=counterparty.eq:Сільпо",
      "filter=type.eq:out",
      "filter=amount.gte:0",
      "sort=-amount",
      "pageSize=100&page=1",
    ]) {
      const res = await call(b, "GET", `/v1/transactions?${encodeURI(q).replaceAll("'", "%27")}`);
      expect(res.statusCode, q).toBe(200);
      const body = res.json();
      expect(body, q).toMatchObject({ items: [], count: 0, from: 0, to: 0 });
      for (const k of ["income", "expense", "difference"])
        expect(body.summary[k].total?.amount ?? "0", `${q} ${k}`).toBe("0");
    }
    for (const q of [
      "sort=amount;DROP TABLE transactions",
      "sort=household_id",
      "sort=subaccount_id",
      "filter=household_id.eq:" + a.householdId,
      "filter=subaccount_id.eq:" + randomUUID(),
      "filter=accountId.has:x",
      "filter=amount.gte:1);--",
      "filter=date.gte:2026-01-01'--",
    ]) {
      const res = await call(b, "GET", `/v1/transactions?${encodeURI(q).replaceAll("'", "%27")}`);
      expect(res.statusCode, q).toBe(400);
      expect(leakText(res.body)).not.toContain(a.householdId);
    }
  });

  it("an Idempotency-Key is the space's own: the same key and body from another space never replays the first space's answer", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a, { name: "Щоденний", amount: "100.00" });
    const accountB = await createAccount(b, { name: "Щоденний", amount: "100.00" });
    const key = randomUUID();
    const first = await call(
      a,
      "POST",
      "/v1/transactions",
      tx(accountA, "-1.00"),
      {},
      { "idempotency-key": key },
    );
    expect(first.statusCode).toBe(201);
    const same = await call(
      b,
      "POST",
      "/v1/transactions",
      tx(accountA, "-1.00"),
      {},
      { "idempotency-key": key },
    );
    expect(same.statusCode).toBe(400);
    expect(leakText(same.body)).not.toContain(first.json().id);
    const own = await call(
      b,
      "POST",
      "/v1/transactions",
      tx(accountB, "-1.00"),
      {},
      { "idempotency-key": key },
    );
    expect(own.statusCode).toBe(201);
    expect(own.json().id).not.toBe(first.json().id);
  });

  it("a change never moves a transaction to another space's account; nothing changes in either space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const accountA = await createAccount(a, { name: "Щоденний", amount: "100.00" });
    const accountB = await createAccount(b, { name: "Чужий", amount: "100.00" });
    const t = await add(a, tx(accountA, "-5.00"));
    const res = await call(a, "PATCH", `/v1/transactions/${t.id}`, { accountId: accountB });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "accountId", issue: "not_found" }]);
    expect(await balance(a, accountA)).toBe("95");
    expect(await balance(b, accountB)).toBe("100");
    expect(await transactionEntries(b.householdId)).toHaveLength(0);
  });

  it.each(["viewer", "advisor"])("a scoped %s gets 404 on reads and 403 on changes", async (role) => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const t = await add(space, tx(account, "-1.00"));
    const scoped = { role, scoped: true };
    expect((await call(space, "GET", "/v1/transactions", undefined, scoped)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/transactions/${t.id}`, undefined, scoped)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/transactions/${randomUUID()}`, undefined, scoped)).statusCode).toBe(
      404,
    );
    for (const [m, u, body] of [
      ["POST", "/v1/transactions", tx(account, "-2.00")],
      ["PATCH", `/v1/transactions/${t.id}`, { description: "x" }],
      ["PATCH", `/v1/transactions/${randomUUID()}`, { description: "x" }],
      ["DELETE", `/v1/transactions/${t.id}`, undefined],
      ["DELETE", `/v1/transactions/${randomUUID()}`, undefined],
    ] as const)
      expect((await call(space, m, u, body, scoped)).statusCode, `${m} ${u}`).toBe(403);
    expect(await rows(space.householdId)).toBe(1);
  });

  it("the journal stays balanced and append-only after create, change and delete", async () => {
    const space = await newSpace();
    const a1 = await createAccount(space, { name: "Перший", amount: "100.00" });
    const a2 = await createAccount(space, { name: "Другий", amount: "100.00" });
    const t = await add(space, tx(a1, "-10.00"));
    const before = await entries(space.householdId);
    await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      accountId: a2,
      amount: { amount: "-12.50", currency: "EUR" },
    });
    await call(space, "DELETE", `/v1/transactions/${t.id}`);
    const after = await entries(space.householdId);
    expect(after.slice(0, before.length)).toEqual(before);
    // Each reversal points at an entry of this transaction; postings are balanced by the ledger's constraints.
    expect(
      after
        .filter((e) => e.reverses_entry_id !== null)
        .every((e) => before.concat(after).some((x) => x.id === e.reverses_entry_id)),
    ).toBe(true);
    expect(await balance(space, a1)).toBe("100");
    expect(await balance(space, a2)).toBe("100");
  });
});

describe("PR #235 security: a closed account stays read only", () => {
  it("FIN-12@PoC FR 8 via FIN-03: a transaction cannot be moved off a closed account to an active one (409); balances unchanged", async () => {
    const space = await newSpace();
    const closed = await createAccount(space, { name: "Старий", amount: "0.00" });
    const open = await createAccount(space, { name: "Новий", amount: "0.00" });
    const kept = await add(space, tx(closed, "10.00"));
    await add(space, tx(closed, "-10.00"));
    expect((await call(space, "POST", `/v1/accounts/${closed}/close`, { closedOn: TODAY })).statusCode).toBe(
      200,
    );
    const before = await transactionEntries(space.householdId);
    const res = await call(space, "PATCH", `/v1/transactions/${kept.id}`, { accountId: open });
    expect([res.statusCode, res.json().code]).toEqual([409, "ACCOUNT_CLOSED"]);
    expect(await transactionEntries(space.householdId)).toEqual(before);
    expect(await balance(space, open)).toBe("0");
  });
});

describe("PR #235 security: the journal follows a change of date alone", () => {
  it("FIN-03@PoC FR 2: changing only «Дата» corrects the journal event to the new operation date", async () => {
    const space = await newSpace();
    const account = await createAccount(space, { name: "Щоденний", amount: "100.00" });
    const t = await add(space, tx(account, "-10.00", { date: "2026-10-15" }));
    const res = await call(space, "PATCH", `/v1/transactions/${t.id}`, { date: "2026-10-01" });
    expect(res.statusCode, res.body).toBe(200);
    const live = (await transactionEntries(space.householdId)).filter((e) => e.event_type === "transaction");
    expect(live.map((e) => e.operation_date)).toEqual(["2026-10-15", "2026-10-01"]);
    expect((await entries(space.householdId)).some((e) => e.reverses_entry_id === live[0]!.id)).toBe(true);
  });
});
