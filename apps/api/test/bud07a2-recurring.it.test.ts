import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
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
} from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-07@PoC a2) (wave 2 row 25): the decisions on the proposals and the payments through the real API on a real
 * PostgreSQL — a proposal confirmed with edits or rejected «Не регулярний» (FR 4, AC1), the freshness of a series
 * (FR 2, EC3), a payment added by hand (FR 6), the category in use and merged (BUD-01 FR 8, FR 12), the audit hand-off
 * with its daily recovery (ARC-04, #249), the space's erasure, another space, a scoped member and the release flag. Every
 * description and amount is synthetic; the clock is fixed (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const FLAG = "recurring.payments";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
const telemetry = testTelemetryForFile();

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

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
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

describe("BUD-07@PoC FR 4, AC1: the user confirms a proposal (fields may be edited) or rejects it", () => {
  it("BUD-07@PoC AC1: confirmed with edits — a regular payment with them; its merchant is proposed no more", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    const subscriptions = await categoryId(space, "Підписки");
    const res = await call(space, "POST", "/v1/recurring/proposals/confirm", {
      key: p!.key,
      name: "Netflix",
      amount: { amount: "17.99", currency: "EUR" },
      categoryId: subscriptions,
      subscription: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({
      id: expect.any(String),
      name: "Netflix",
      type: "expense",
      frequency: "month",
      expectedAmount: { amount: "17.99", currency: "EUR" },
      anchorDate: "2026-10-14",
      nextDate: "2026-12-14",
      endDate: null,
      categoryId: subscriptions,
      accountId: account,
      subscription: true,
      variable: false,
      merchantId: p!.merchant.id,
      source: "proposal",
      createdOn: "2026-11-16",
      version: 1,
    });
    // FR 4, FR 5: the analysis runs again — the merchant is a regular payment, so nothing is proposed for it.
    expect(await proposals(space)).toEqual([]);
    expect(await entries(space.householdId, "recurring.payment")).toBe(1);
    const listed = await call(space, "GET", "/v1/recurring/payments");
    expect(listed.json().items.map((x: { name: string }) => x.name)).toEqual(["Netflix"]);
    const one = await call(space, "GET", `/v1/recurring/payments/${res.json().id}`);
    expect(one.json()).toEqual(res.json());
  });

  it("BUD-07@PoC FR 4: confirmed as proposed — the merchant's name, frequency, expected amount, anchor date and account", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    const res = await call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      name: p!.merchant.name,
      frequency: "month",
      expectedAmount: { amount: "15.49", currency: "EUR" },
      anchorDate: "2026-10-14",
      accountId: account,
      categoryId: null,
      subscription: false,
    });
  });

  it("BUD-07@PoC FR 4: «Не регулярний» — the series is not proposed again, also once its key changed (#315 item 8)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const ids = await streaming(space, account);
    await tx(space, account, "2026-11-14", "-15.49", "NETFLIX.COM 8812");
    const [p] = await proposals(space);
    const res = await call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      merchantId: p!.merchant.id,
      frequency: "month",
      expectedAmount: { amount: "15.49", currency: "EUR" },
      transactionIds: p!.transactionIds,
    });
    expect(await proposals(space)).toEqual([]);
    expect(await entries(space.householdId, "recurring.rejection")).toBe(1);
    // The first charge leaves the analysis (here: deleted) — the series' key is another, it is still rejected.
    expect((await call(space, "DELETE", `/v1/transactions/${ids[0]}`)).statusCode).toBe(200);
    expect(await proposals(space)).toEqual([]);
    // Another price of the same merchant is another series (FR 3) — still proposed.
    for (const date of ["2026-09-01", "2026-10-01", "2026-11-01"])
      await tx(space, account, date, "-4.99", "NETFLIX.COM 8812");
    expect((await proposals(space)).map((x) => x.expectedAmount.amount)).toEqual(["4.99"]);
  });

  it("BUD-07@PoC FR 4: a proposal no longer offered — 409 RECURRING_PROPOSAL_GONE, nothing written", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    expect((await call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key })).statusCode).toBe(
      201,
    );
    for (const [url, body] of [
      ["/v1/recurring/proposals/confirm", { key: p!.key }],
      ["/v1/recurring/proposals/reject", { key: p!.key }],
      ["/v1/recurring/proposals/confirm", { key: "no-such-key" }],
    ] as const) {
      const res = await call(space, "POST", url, body);
      expect([res.statusCode, res.json().code], url).toEqual([409, "RECURRING_PROPOSAL_GONE"]);
    }
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await n("recurring.rejections WHERE household_id = $1", space.householdId)).toBe(1);
  });

  it("BUD-07@PoC FR 4: two confirmations of one proposal at once — one payment, the other 409; a confirm and a reject at once — one wins", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    const both = await Promise.all([
      call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key }),
      call(space, "POST", "/v1/recurring/proposals/confirm", { key: p!.key, name: "Інша назва" }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await entries(space.householdId, "recurring.payment")).toBe(1);

    const other = await newSpace();
    const card = await createAccount(other);
    await streaming(other, card);
    const [q] = await proposals(other);
    const raced = await Promise.all([
      call(other, "POST", "/v1/recurring/proposals/confirm", { key: q!.key }),
      call(other, "POST", "/v1/recurring/proposals/reject", { key: q!.key }),
    ]);
    expect(raced.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const written =
      (await n("recurring.payments WHERE household_id = $1", other.householdId)) +
      (await n("recurring.rejections WHERE household_id = $1", other.householdId));
    expect(written).toBe(1);
  });
});

describe("BUD-07@PoC FR 2, EC3: a series whose latest charge is older than one interval + 3 days is not proposed", () => {
  it("BUD-07@PoC EC3: the monthly gym charged last on 12 October — proposed until 15 November, not on 16 November", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-12", "2026-09-12", "2026-10-12"])
      await tx(space, account, date, "-40.00", "SYNTH GYM");
    for (const date of ["2026-08-13", "2026-09-13", "2026-10-13"])
      await tx(space, account, date, "-12.00", "SYNTH PARKING");
    expect((await proposals(space)).map((p) => p.merchant.name)).toEqual(["Synth Parking"]);
  });
});

describe("BUD-07@PoC FR 6: «Додати вручну»", () => {
  it("BUD-07@PoC FR 6: name, amount, frequency, anchor date, category, account, end date, type, «Підписка», «Змінна сума»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const category = await categoryId(space, "Оренда");
    const res = await call(space, "POST", "/v1/recurring/payments", {
      ...rent,
      categoryId: category,
      accountId: account,
      endDate: "2027-08-31",
      subscription: false,
      variable: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Оренда квартири",
      type: "expense",
      frequency: "month",
      expectedAmount: { amount: "650", currency: "EUR" },
      anchorDate: "2026-11-05",
      nextDate: "2026-12-05",
      endDate: "2027-08-31",
      categoryId: category,
      accountId: account,
      subscription: false,
      variable: true,
      merchantId: null,
      source: "manual",
    });
    expect(await entries(space.householdId, "recurring.payment")).toBe(1);
    const entry = (
      await audit.entriesFor(space.householdId, { type: "recurring.payment", id: res.json().id })
    )[0]!;
    expect(entry).toMatchObject({ action: "create", actorKind: "user", actorId: space.accountId });
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name", before: null, after: "Оренда квартири" }),
        expect.objectContaining({ field: "amount", before: null, after: "650" }),
      ]),
    );
    // A regular income: type «дохід» with an income category.
    const income = await call(space, "POST", "/v1/recurring/payments", {
      ...rent,
      name: "Синтетична зарплата",
      amount: { amount: "2400.00", currency: "EUR" },
      anchorDate: "2026-11-10",
      type: "income",
      categoryId: await categoryId(space, "Дохід від оренди"),
    });
    expect(income.statusCode, income.body).toBe(201);
    // The same Idempotency-Key twice is one payment (ARC-07 FR 4).
    const key = { "idempotency-key": randomUUID() };
    const once = await call(space, "POST", "/v1/recurring/payments", { ...rent, name: "Садочок" }, {}, key);
    const twice = await call(space, "POST", "/v1/recurring/payments", { ...rent, name: "Садочок" }, {}, key);
    expect([once.statusCode, twice.statusCode]).toEqual([201, 201]);
    expect(twice.json().id).toBe(once.json().id);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(3);
  });

  it("BUD-07@PoC FR 6: the fields are checked — another space's category or account, the other type's category, a «Кредит» account, an end before the date", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const theirs = await createAccount(stranger);
    const theirCategory = await categoryId(stranger, "Оренда");
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Синтетичний кредит",
      institution: { name: "Синтетичний банк", country: "UA" },
      annualRate: "12.5",
      monthlyPayment: "250.00",
    });
    const issues = async (body: Record<string, unknown>) => {
      const res = await call(space, "POST", "/v1/recurring/payments", { ...rent, ...body });
      expect(res.statusCode, res.body).toBe(400);
      return res.json().errors as { path: string; issue: string }[];
    };
    expect(await issues({ accountId: theirs })).toMatchObject([{ path: "accountId", issue: "not_found" }]);
    expect(await issues({ categoryId: theirCategory })).toMatchObject([
      { path: "categoryId", issue: "not_found" },
    ]);
    expect(await issues({ categoryId: await categoryId(space, "Дохід від оренди") })).toMatchObject([
      { path: "categoryId", issue: "kind" },
    ]);
    expect(await issues({ accountId: loan })).toMatchObject([{ path: "accountId", issue: "loan" }]);
    expect(await issues({ endDate: "2026-11-01" })).toMatchObject([
      { path: "endDate", issue: "before_anchor" },
    ]);
    expect(await issues({ amount: { amount: "0", currency: "EUR" } })).toMatchObject([
      { path: "amount", issue: "invalid" },
    ]);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(0);
  });
});

describe("BUD-01@PoC FR 8, FR 12: the category of a regular payment", () => {
  it("BUD-01@PoC FR 12: a custom category used by a regular payment is not deleted", async () => {
    const space = await newSpace();
    const list = await call(space, "GET", "/v1/categories");
    const group = (list.json().groups as { id: string; name: string }[]).find((g) => g.name === "Житло")!;
    const custom = await call(space, "POST", "/v1/categories", {
      groupId: group.id,
      name: "Синтетичний гараж",
    });
    expect(custom.statusCode, custom.body).toBe(201);
    const id = custom.json().id as string;
    expect(
      (await call(space, "POST", "/v1/recurring/payments", { ...rent, name: "Гараж", categoryId: id }))
        .statusCode,
    ).toBe(201);
    const res = await call(space, "DELETE", `/v1/categories/${id}`);
    expect([res.statusCode, res.json().code]).toEqual([409, "CATEGORY_NOT_EMPTY"]);
  });

  it("BUD-01@PoC FR 8: merging the category moves the payment to the target, with an audit entry from the system", async () => {
    const space = await newSpace();
    const list = await call(space, "GET", "/v1/categories");
    const group = (list.json().groups as { id: string; name: string }[]).find((g) => g.name === "Житло")!;
    const custom = await call(space, "POST", "/v1/categories", {
      groupId: group.id,
      name: "Синтетичний гараж",
    });
    const source = custom.json().id as string;
    const target = await categoryId(space, "Оренда");
    const created = await call(space, "POST", "/v1/recurring/payments", { ...rent, categoryId: source });
    const merge = await call(space, "POST", `/v1/categories/${source}/merge`, { targetId: target });
    expect(merge.statusCode, merge.body).toBe(200);
    // Merged away: a new payment cannot take it.
    const refused = await call(space, "POST", "/v1/recurring/payments", { ...rent, categoryId: source });
    expect(refused.json().errors).toMatchObject([{ path: "categoryId", issue: "merged" }]);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    const moved = await call(space, "GET", `/v1/recurring/payments/${created.json().id}`);
    expect(moved.json()).toMatchObject({ categoryId: target, version: 2 });
    const updates = await audit.entriesFor(space.householdId, {
      type: "recurring.payment",
      id: created.json().id,
    });
    expect(updates.find((e) => e.action === "update")).toMatchObject({
      actorKind: "system",
      changes: [expect.objectContaining({ field: "categoryId", before: source, after: target })],
    });
  });
});

describe("BUD-07@PoC AC9, «Права доступу»: the space's boundary", () => {
  it("BUD-07@PoC AC9: a user of another space gets «not found» — no records, counts or sums", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(owner);
    await streaming(owner, account);
    const [p] = await proposals(owner);
    const created = await call(owner, "POST", "/v1/recurring/payments", rent);
    expect((await call(stranger, "GET", "/v1/recurring/payments")).json()).toEqual({ items: [] });
    const res = await call(stranger, "GET", `/v1/recurring/payments/${created.json().id}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("650");
    const confirm = await call(stranger, "POST", "/v1/recurring/proposals/confirm", { key: p!.key });
    expect([confirm.statusCode, confirm.json().code]).toEqual([409, "RECURRING_PROPOSAL_GONE"]);
    expect(await n("recurring.payments WHERE household_id = $1", stranger.householdId)).toBe(0);
    expect(await n("recurring.payments WHERE household_id = $1", owner.householdId)).toBe(1);
  });

  it("BUD-07@PoC «Права доступу»: a scoped member — not found on reads, refused on changes; the flag off — not found", async () => {
    const space = await newSpace();
    const scoped = { role: "viewer", scoped: true };
    expect((await call(space, "GET", "/v1/recurring/payments", undefined, scoped)).statusCode).toBe(404);
    expect((await call(space, "POST", "/v1/recurring/payments", rent, scoped)).statusCode).toBe(403);
    expect(
      (await call(space, "POST", "/v1/recurring/payments", rent, { role: "editor", scoped: true }))
        .statusCode,
    ).toBe(404);
    expect((await call(space, "POST", "/v1/recurring/payments", rent, { role: "viewer" })).statusCode).toBe(
      403,
    );
    off.add(FLAG);
    expect((await call(space, "GET", "/v1/recurring/payments")).statusCode).toBe(404);
    expect((await call(space, "POST", "/v1/recurring/payments", rent)).statusCode).toBe(404);
    expect(await n("recurring.payments WHERE household_id = $1", space.householdId)).toBe(0);
  });
});

describe("BUD-07@PoC «Кожна зміна пишеться в журнал аудиту»: the recurring queue (ARC-04, ADR-0015)", () => {
  it("ARC-04@PoC FR 4: a recurring audit job in state dead goes back to the queue with the daily recovery", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "recurring.payment") throw new Error("injected");
      return original(householdId, entry);
    });
    const res = await call(space, "POST", "/v1/recurring/payments", rent);
    expect(res.statusCode, res.body).toBe(201);
    expect(await entries(space.householdId, "recurring.payment")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "recurring.hand_off_deferred")).toBe(true);
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE recurring.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    // The worker does not take a dead job.
    await runWorker(space.householdId);
    expect(await entries(space.householdId, "recurring.payment")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("recurring.hand-off-recovery")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("recurring.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await tasks.find((t) => t.name === "recurring.hand-off-recovery")!.run();
    expect(telemetry.memory.logRecords().some((r) => r.body === "recurring.hand_off_requeued")).toBe(true);
    await runWorker(space.householdId);
    expect(await n("recurring.jobs WHERE household_id = $1 AND state = 'done'", space.householdId)).toBe(1);
    expect(await entries(space.householdId, "recurring.payment")).toBe(1);
    // Again: the entry is keyed, nothing is written twice.
    await tasks.find((t) => t.name === "recurring.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await entries(space.householdId, "recurring.payment")).toBe(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes its payments, rejected series and queue rows", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await streaming(space, account);
    const [p] = await proposals(space);
    await call(space, "POST", "/v1/recurring/proposals/reject", { key: p!.key });
    await call(space, "POST", "/v1/recurring/payments", rent);
    const erased = await createRecurringErasure(db.databases.for("recurring")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ payments: 1, rejections: 1, jobs: 2 });
    expect(await n("recurring.jobs WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
