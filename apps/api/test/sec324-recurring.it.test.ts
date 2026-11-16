import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createTransactionCategories } from "../src/modules/categorization/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringErasure,
  createRecurringServices,
  createRecurringWorkerQueue,
  HAND_OFF_JOB,
} from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";
import { listProposals, rejectProposal } from "../src/modules/recurring/application/index.ts";
import { recurringTx } from "../src/modules/recurring/adapters/index.ts";

/**
 * sec324 (security review of #324, BUD-07@PoC a2): idempotency keys of the new create routes, the merchant lock,
 * another space's references, row-level security and a late hand-off after the space's erasure. Synthetic data; the
 * clock is fixed (16 November 2026 in Kyiv). Setup as test/bud07a2-recurring.it.test.ts.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface ProposalBody {
  key: string;
  merchant: { id: string; name: string };
  frequency: string;
  expectedAmount: { amount: string; currency: string };
  anchorDate: string;
  accountId: string;
  transactionIds: string[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
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

async function createAccount(space: Space, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function tx(space: Space, accountId: string, date: string, amount: string, counterparty: string) {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    counterparty,
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function proposals(space: Space): Promise<ProposalBody[]> {
  const res = await call(space, "GET", "/v1/recurring/proposals");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as ProposalBody[];
}

/** A monthly streaming subscription on the 14th: Aug, Sep, Oct — proposed today (FR 2). */
async function streaming(space: Space, account: string): Promise<string[]> {
  const ids: string[] = [];
  for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
    ids.push(await tx(space, account, date, "-15.49", "NETFLIX.COM 8812"));
  return ids;
}

async function categoryId(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const all = (res.json().groups as { categories: { id: string; name: string }[] }[]).flatMap(
    (g) => g.categories,
  );
  return all.find((c) => c.name === name)!.id;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const entries = (householdId: string, entity: string, action = "create") =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3",
    householdId,
    entity,
    action,
  );

const rent = {
  name: "Оренда квартири",
  amount: { amount: "650.00", currency: "EUR" },
  frequency: "month",
  anchorDate: "2026-11-05",
  type: "expense",
};

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const categories = createCategoryDirectory({
    db: db.databases.for("categories"),
    audit,
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          walletUsage: [],
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
          categories,
          flags: { isEnabled },
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [createRecurringCategoryUsage(db.databases.for("recurring"))],
        }),
        recurring: createRecurringServices({
          history: createTransactionHistory(db.databases.for("transactions")),
          merchants: createMerchantDirectory(db.databases.for("merchants")),
          accounts: createAccountDirectory(db.databases.for("accounts")),
          categories,
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          transactionCategories: createTransactionCategories(db.databases.for("categorization")),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
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

afterEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

const KEY = { "idempotency-key": "sec324-key-0001" };

describe("sec324: idempotency keys of the recurring create routes (ARC-07 FR 4)", () => {
  it("sec324: the same key — one payment; a different body — 409; another space with the same key — its own payment", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const first = await call(a, "POST", "/v1/recurring/payments", rent, {}, KEY);
    expect(first.statusCode, first.body).toBe(201);
    const again = await call(a, "POST", "/v1/recurring/payments", rent, {}, KEY);
    expect([again.statusCode, again.headers["idempotent-replayed"]]).toEqual([201, "true"]);
    expect(again.json().id).toBe(first.json().id);
    const other = await call(a, "POST", "/v1/recurring/payments", { ...rent, name: "Інше" }, {}, KEY);
    expect([other.statusCode, other.json().code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(await n("recurring.payments WHERE household_id = $1", a.householdId)).toBe(1);
    expect(await entries(a.householdId, "recurring.payment")).toBe(1);

    const theirs = await call(b, "POST", "/v1/recurring/payments", rent, {}, KEY);
    expect(theirs.statusCode, theirs.body).toBe(201);
    expect(theirs.headers["idempotent-replayed"]).toBeUndefined();
    expect(theirs.json().id).not.toBe(first.json().id);
    expect(await n("recurring.payments WHERE household_id = $1", b.householdId)).toBe(1);
  });

  it("sec324: a confirm's key reused on reject with the same body — 409, the series is not rejected; a refused unknown key leaves the key free", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    const gone = await call(space, "POST", "/v1/recurring/proposals/confirm", { key: "no-such" }, {}, KEY);
    expect([gone.statusCode, gone.json().code]).toEqual([404, "NOT_FOUND"]);
    expect(await n("recurring.idempotency_keys WHERE household_id = $1", space.householdId)).toBe(0);
    const ok = await call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key }, {}, KEY);
    expect(ok.statusCode, ok.body).toBe(201);
    const reject = await call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key }, {}, KEY);
    expect([reject.statusCode, reject.json().code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(await n("recurring.rejections WHERE household_id = $1", space.householdId)).toBe(0);
  });
});

describe("sec324: a confirmation names only the space's own category and account", () => {
  it("sec324: another space's category or account in a confirmation — 400, nothing written; the proposal stays", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(owner);
    await streaming(owner, account);
    const theirAccount = await createAccount(stranger);
    const theirCategory = await categoryId(stranger, "Підписки");
    const [p] = await proposals(owner);
    for (const edit of [{ categoryId: theirCategory }, { accountId: theirAccount }]) {
      const res = await call(owner, "POST", "/v1/recurring/proposals/confirm", { key: p!.key, ...edit });
      expect([res.statusCode, res.json().code], JSON.stringify(edit)).toEqual([400, "VALIDATION_FAILED"]);
      expect(JSON.stringify(res.json().errors)).toContain("not_found");
    }
    expect(await n("recurring.payments WHERE household_id = $1", owner.householdId)).toBe(0);
    expect(await n("recurring.jobs WHERE household_id = $1", owner.householdId)).toBe(0);
    expect(await proposals(owner)).toHaveLength(1);
  });
});

describe("sec324: the merchant lock", () => {
  it("sec324: two rejections of one proposal at once — one rejection, one audit entry, the other 409", async () => {
    for (let round = 0; round < 3; round++) {
      const space = await newSpace();
      const account = await createAccount(space);
      await streaming(space, account);
      const [p] = await proposals(space);
      const both = await Promise.all([
        call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key }),
        call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key }),
      ]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await n("recurring.rejections WHERE household_id = $1", space.householdId)).toBe(1);
      expect(await entries(space.householdId, "recurring.rejection")).toBe(1);
    }
  });

  it("sec324: a confirm and a reject at once, three rounds — never both written", async () => {
    for (let round = 0; round < 3; round++) {
      const space = await newSpace();
      const account = await createAccount(space);
      await streaming(space, account);
      const [p] = await proposals(space);
      const raced = await Promise.all([
        call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key }),
        call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key }),
      ]);
      expect(raced.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const written =
        (await n("recurring.payments WHERE household_id = $1", space.householdId)) +
        (await n("recurring.rejections WHERE household_id = $1", space.householdId));
      expect(written).toBe(1);
    }
  });
});

describe("sec324: audit entries of the new changes", () => {
  it("sec324: confirm, reject and a manual payment each write one entry by the caller (user, web)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    for (const date of ["2026-08-20", "2026-09-20", "2026-10-20"])
      await tx(space, account, date, "-9.99", "SPOTIFY P1");
    const [p1, p2] = await proposals(space);
    expect((await call(space, "POST", "/v1/recurring/proposals/confirm", { key: p1!.key })).statusCode).toBe(
      201,
    );
    expect((await call(space, "POST", "/v1/recurring/proposals/reject", { key: p2!.key })).statusCode).toBe(
      201,
    );
    expect((await call(space, "POST", "/v1/recurring/payments", rent)).statusCode).toBe(201);
    const { rows } = await db.owner.query<{
      entity_type: string;
      actor_kind: string;
      actor_id: string;
      channel: string;
    }>(
      `SELECT entity_type, actor_kind, actor_id::text, channel FROM audit.entries
       WHERE household_id = $1 AND entity_type LIKE 'recurring.%'`,
      [space.householdId],
    );
    expect(rows.map((r) => r.entity_type).sort()).toEqual([
      "recurring.payment",
      "recurring.payment",
      "recurring.rejection",
    ]);
    for (const r of rows)
      expect([r.actor_kind, r.actor_id, r.channel]).toEqual(["user", space.accountId, "web"]);
  });
});

describe("sec324: row-level security of the recurring tables (migrations 0001–0003)", () => {
  it("sec324: the module role in one space sees and writes no row of another space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    expect((await call(b, "POST", "/v1/recurring/payments", rent, {}, KEY)).statusCode).toBe(201);
    const recurring = db.databases.for("recurring");
    const seen = await recurring.inHousehold(a.householdId, async (q) => {
      const counts: number[] = [];
      for (const t of ["payments", "rejections", "idempotency_keys", "jobs", "outbox_events"]) {
        const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
        counts.push(rows[0]!.n);
      }
      return counts;
    });
    expect(seen).toEqual([0, 0, 0, 0, 0]);
    await expect(
      recurring.inHousehold(a.householdId, (q) =>
        q.query(
          `INSERT INTO payments (household_id, id, name, type, frequency, expected_amount, expected_currency, anchor_date,
             source, created_on) VALUES ($1, gen_random_uuid(), 'x', 'expense', 'month', 1, 'EUR', '2026-11-01', 'manual', '2026-11-16')`,
          [b.householdId],
        ),
      ),
    ).rejects.toThrow();
    const updated = await recurring.inHousehold(a.householdId, (q) =>
      q.query(`UPDATE payments SET name = 'x' WHERE household_id = $1`, [b.householdId]),
    );
    expect(updated.rowCount).toBe(0);
    const { rows } = await db.owner.query<{ relname: string; rls: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c
       JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'recurring' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'household_id')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) expect([r.relname, r.rls]).toEqual([r.relname, true]);
  });
});

describe("sec324: a hand-off claimed before the space's erasure writes nothing after it (late worker write)", () => {
  it("sec324: the job claimed, the space erased, then the handler runs — no audit entry, the lease is lost", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "recurring.payment") throw new Error("injected");
      return original(householdId, entry);
    });
    expect((await call(space, "POST", "/v1/recurring/payments", rent)).statusCode).toBe(201);
    vi.restoreAllMocks();
    const queue = createRecurringWorkerQueue(db.databases.for("recurring"), audit);
    const owner = randomUUID();
    const { claimed } = await queue.store.claim(space.householdId, {
      owner,
      names: [HAND_OFF_JOB.name],
      heavy: false,
      limit: 10,
      leaseMs: () => 60_000,
      maxAttempts: 8,
    });
    expect(claimed).toHaveLength(1);
    const job = claimed[0]!;
    await createRecurringErasure(db.databases.for("recurring")).eraseHousehold(space.householdId);
    const handler = queue.handlers.find((h) => h.job.name === HAND_OFF_JOB.name)!;
    await expect(
      queue.store.complete(job, owner, (q) =>
        handler.run(
          {
            id: job.id,
            householdId: job.householdId,
            key: job.key,
            payload: handler.job.schema.parse(job.payload),
            attempt: job.attempt,
            signal: new AbortController().signal,
          },
          q,
        ),
      ),
    ).rejects.toThrow();
    expect(await entries(space.householdId, "recurring.payment")).toBe(0);
  });
});

describe("sec324: the merchant lock holds a second decision until the first commits", () => {
  it("sec324: a rejection waits under the lock while another is open, then finds the series gone — never two", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const services = createRecurringServices({
      history: createTransactionHistory(db.databases.for("transactions")),
      merchants: createMerchantDirectory(db.databases.for("merchants")),
      accounts: createAccountDirectory(db.databases.for("accounts")),
      categories: createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID }),
      audit,
      clock: { now: () => NOW },
      newId: randomUUID,
      transactionCategories: createTransactionCategories(db.databases.for("categorization")),
      fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    });
    const {
      items: [proposal],
    } = await listProposals(services.deps, space.householdId);
    const caller = { householdId: space.householdId, accountId: space.accountId };
    const recurring = db.databases.for("recurring");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let written!: () => void;
    const firstWritten = new Promise<void>((r) => (written = r));
    const first = recurring.inHousehold(space.householdId, async (q) => {
      const r = await rejectProposal(services.payments, recurringTx(q), caller, proposal!);
      written();
      await gate;
      return r.result;
    });
    await firstWritten;
    const second = recurring.inHousehold(
      space.householdId,
      async (q) => (await rejectProposal(services.payments, recurringTx(q), caller, proposal!)).result,
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    const results = await Promise.all([first, second]);
    expect(results[0]).not.toBe("gone");
    expect(results[1]).toBe("gone");
    expect(await n("recurring.rejections WHERE household_id = $1", space.householdId)).toBe(1);
  });
});

describe("sec324: a payment's name is one line of visible text", () => {
  it("sec324: a control character in the name — 400 VALIDATION_FAILED, not 500; nothing written", async () => {
    const space = await newSpace();
    for (const name of ["a\u0000b", "a\u0007b", "a\u2028b", "a\u2029b", "a\u009fb"]) {
      const res = await call(space, "POST", "/v1/recurring/payments", { ...rent, name });
      expect([res.statusCode, res.json().code], JSON.stringify(name)).toEqual([400, "VALIDATION_FAILED"]);
    }
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
