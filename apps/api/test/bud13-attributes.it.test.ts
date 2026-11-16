import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { bulkActionsServicesFor, schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";

/**
 * BUD-13@PoC a) (wave 2 row 21), through the real API on a real PostgreSQL: «Нотатка» and «Теги» of a transaction, the
 * space's tags (renamed, merged, deleted with their count), the filter «Теги», the bulk action «Додати теги» (DAT-03
 * FR 2) and «Вибрано N · Сума ±X €» (FR 9). Every name and amount is synthetic; the session is the test's principal
 * header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
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

interface Tx {
  id: string;
  note: string | null;
  tags: { id: string; name: string }[];
  split: unknown;
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
  principal: { role?: string; scoped?: boolean } = {},
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

async function createAccount(space: Space, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency}`,
    balance: { amount: "1000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(
  space: Space,
  accountId: string,
  amount: string,
  extra: { currency?: string; date?: string; counterparty?: string } = {},
): Promise<Tx> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: extra.currency ?? "EUR" },
    date: extra.date ?? "2026-10-15",
    counterparty: extra.counterparty ?? "Синтетичний магазин",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Tx;
}

const attributes = (space: Space, id: string, body: unknown) =>
  call(space, "PATCH", `/v1/transactions/${id}/attributes`, body);

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Tx;

const list = async (space: Space, query: string) => {
  const res = await call(space, "GET", `/v1/transactions${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { count: number; items: Tx[] };
};

const tagsOf = async (space: Space) =>
  (await call(space, "GET", "/v1/transaction-tags")).json().items as {
    id: string;
    name: string;
    count: number;
  }[];

/** Official NBU rate: 1 `currency` = `uah` UAH on `date`. */
async function rate(date: string, currency: string, uah: string) {
  await db.owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())
     ON CONFLICT DO NOTHING`,
    [date, currency, uah],
  );
}

const jobs = async (householdId: string, state: string) =>
  Number(
    (
      await db.owner.query(
        `SELECT count(*)::int AS n FROM transactions.jobs WHERE household_id = $1 AND state = $2`,
        [householdId, state],
      )
    ).rows[0]!.n,
  );

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

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
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
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          duplicates: createDuplicateCheck(),
        }),
        bulkActions: bulkActionsServicesFor(audit, db.databases, { now: () => NOW }),
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

describe("BUD-13@PoC FR 1, FR 2, FR 5: «Нотатка» and «Теги» in the details, the row and the filter", () => {
  it("BUD-13@PoC AC1: a note and two tags of the space saved — in the details, in the row, found by the tag filter, in the audit log", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const other = await add(space, account, "-10.00");
    // The space has «ремонт-кухні» and «повернути» already.
    expect((await attributes(space, other.id, { tags: ["ремонт-кухні", "повернути"] })).statusCode).toBe(200);
    const existing = await tagsOf(space);
    const t = await add(space, account, "-240.00", { counterparty: "Leroy Merlin" });
    expect(t.note).toBeNull();
    expect(t.tags).toEqual([]);

    const res = await attributes(space, t.id, {
      note: "фарба і валики",
      tags: ["ремонт-кухні", "повернути"],
    });
    expect(res.statusCode, res.body).toBe(200);
    const byName = (n: string) => existing.find((e) => e.name === n)!.id;
    const expected = [
      { id: byName("ремонт-кухні"), name: "ремонт-кухні" },
      { id: byName("повернути"), name: "повернути" },
    ];
    expect(res.json()).toMatchObject({ note: "фарба і валики", tags: expected });
    expect(await get(space, t.id)).toMatchObject({ note: "фарба і валики", tags: expected });
    // The row of the list, and the filter «Теги».
    const found = await list(space, `?filter=tag.eq:${byName("ремонт-кухні")}`);
    expect(found.count).toBe(2);
    expect(found.items.find((i) => i.id === t.id)).toMatchObject({ note: "фарба і валики", tags: expected });
    expect((await list(space, `?filter=tag.in:${byName("повернути")},${randomUUID()}`)).count).toBe(2);
    // The balance and the journal are not touched by attributes.
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id });
    const update = log.find((e) => e.action === "update")!;
    expect(update.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "note", before: null, after: AUDIT_MASK }),
        expect.objectContaining({ field: "tags", before: null, after: expected.map((e) => e.id).join(",") }),
      ]),
    );
    expect(JSON.stringify(log)).not.toContain("фарба");
    // The same again changes nothing: no new entry.
    expect((await attributes(space, t.id, { note: "фарба і валики" })).statusCode).toBe(200);
    expect(
      await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: t.id }),
    ).toHaveLength(log.length);
  });

  it("BUD-13@PoC FR 1: the note is up to 2 000 characters; null removes it", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-5.00");
    const long = await attributes(space, t.id, { note: "я".repeat(2001) });
    expect(long.statusCode).toBe(400);
    expect(long.json().errors).toEqual([{ in: "body", path: "note", issue: "invalid" }]);
    expect((await attributes(space, t.id, { note: "я".repeat(2000) })).json().note).toHaveLength(2000);
    expect((await attributes(space, t.id, { note: null })).json().note).toBeNull();
  });

  it("BUD-13@PoC FR 2: tags are the space's, unique without regard to case, trimmed, up to 60 characters and 20 on a transaction", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    await attributes(space, a.id, { tags: ["Ремонт"] });
    const res = await attributes(space, b.id, { tags: ["  ремонт ", "РЕМОНТ"] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tags).toEqual([{ id: (await get(space, a.id)).tags[0]!.id, name: "Ремонт" }]);
    expect(await tagsOf(space)).toEqual([expect.objectContaining({ name: "Ремонт", count: 2 })]);
    // «Досягнуто 20 тегів».
    const many = Array.from({ length: 21 }, (_, i) => `тег ${i}`);
    const tooMany = await attributes(space, a.id, { tags: many });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().errors).toEqual([{ in: "body", path: "tags", issue: "too_many" }]);
    expect((await attributes(space, a.id, { tags: many.slice(0, 20) })).json().tags).toHaveLength(20);
    const tooLong = await attributes(space, a.id, { tags: ["т".repeat(61)] });
    expect(tooLong.json().errors).toEqual([{ in: "body", path: "tags.0", issue: "invalid" }]);
    // Tags are no category: the category stays as it is (module categorization), and [] removes them.
    expect((await attributes(space, a.id, { tags: [] })).json().tags).toEqual([]);
  });

  it("BUD-13@PoC FR 3, FR 4: no flags and no attachments — the transaction has neither, the details take neither", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-3.00");
    const shown = await get(space, t.id);
    expect(Object.keys(shown)).not.toEqual(expect.arrayContaining(["flagged"]));
    expect(Object.keys(shown).filter((k) => /flag|attach/i.test(k))).toEqual([]);
    expect((await attributes(space, t.id, { flagged: true })).statusCode).toBe(400);
    expect((await attributes(space, t.id, { attachments: [] })).statusCode).toBe(400);
  });

  it("BUD-13@PoC FR 5: the list filters by tag, by merchant and by split together", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const lm = await add(space, account, "-240.00", { counterparty: "Leroy Merlin" });
    const other = await add(space, account, "-20.00", { counterparty: "Інший магазин" });
    await attributes(space, lm.id, { tags: ["ремонт"] });
    await attributes(space, other.id, { tags: ["ремонт"] });
    const tag = (await tagsOf(space))[0]!.id;
    const byMerchant = await list(space, `?filter=tag.eq:${tag}&filter=counterparty.eq:Leroy%20Merlin`);
    expect(byMerchant.items.map((i) => i.id)).toEqual([lm.id]);
    expect((await list(space, `?filter=tag.eq:${tag}&filter=split.eq:true`)).count).toBe(0);
    const bad = await call(space, "GET", "/v1/transactions?filter=tag.gte:x");
    expect(bad.statusCode).toBe(400);
  });

  it("BUD-13@PoC: «атрибути транзакцій» are behind the flag `transactions.attributes`", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-3.00");
    off.add("transactions.attributes");
    expect((await attributes(space, t.id, { note: "x" })).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/transaction-tags")).statusCode).toBe(404);
  });
});

describe("BUD-13@PoC FR 2: renaming, merging and deleting a tag", () => {
  it("BUD-13@PoC FR 2: renaming a tag onto the name of another merges them — each transaction keeps the tag once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    await attributes(space, a.id, { tags: ["кухня", "ремонт"] });
    await attributes(space, b.id, { tags: ["кухня"] });
    const [kitchen, repair] = await tagsOf(space);
    expect([kitchen!.name, repair!.name]).toEqual(["кухня", "ремонт"]);
    // A plain rename keeps the id; the case may change.
    const renamed = await call(space, "PATCH", `/v1/transaction-tags/${repair!.id}`, {
      name: "Ремонт кухні",
    });
    expect(renamed.json()).toEqual({ id: repair!.id, name: "Ремонт кухні", count: 1 });
    const merged = await call(space, "PATCH", `/v1/transaction-tags/${kitchen!.id}`, {
      name: " ремонт КУХНІ ",
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json()).toEqual({ id: repair!.id, name: "Ремонт кухні", count: 2 });
    expect((await get(space, a.id)).tags).toEqual([{ id: repair!.id, name: "Ремонт кухні" }]);
    expect((await get(space, b.id)).tags).toEqual([{ id: repair!.id, name: "Ремонт кухні" }]);
    expect(await tagsOf(space)).toEqual([{ id: repair!.id, name: "Ремонт кухні", count: 2 }]);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.tag", id: kitchen!.id });
    expect(log).toEqual([
      expect.objectContaining({
        action: "delete",
        changes: expect.arrayContaining([
          expect.objectContaining({ field: "mergedInto", after: repair!.id }),
          expect.objectContaining({ field: "name", before: AUDIT_MASK }),
        ]),
      }),
    ]);
    expect(JSON.stringify(log)).not.toContain("кухня");
    expect(
      (await call(space, "PATCH", `/v1/transaction-tags/${kitchen!.id}`, { name: "x" })).statusCode,
    ).toBe(404);
  });

  it("BUD-13@PoC AC6: a tag on 37 transactions — the confirmation counts 37; once confirmed, the tag is off every one", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const ids: string[] = [];
    for (let i = 0; i < 37; i++) {
      const t = await add(space, account, `-${i + 1}.00`);
      await attributes(space, t.id, { tags: ["ремонт", "інше"] });
      ids.push(t.id);
    }
    const repair = (await tagsOf(space)).find((t) => t.name === "ремонт")!;
    // «Тег буде знято з 37 транзакцій».
    expect(repair.count).toBe(37);
    const res = await call(space, "DELETE", `/v1/transaction-tags/${repair.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: true, removed: 37 });
    expect(await tagsOf(space)).toEqual([expect.objectContaining({ name: "інше", count: 37 })]);
    expect((await list(space, `?filter=tag.eq:${repair.id}`)).count).toBe(0);
    expect((await get(space, ids[0]!)).tags.map((t) => t.name)).toEqual(["інше"]);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.tag", id: repair.id });
    expect(log).toEqual([
      expect.objectContaining({
        action: "delete",
        changes: expect.arrayContaining([expect.objectContaining({ field: "transactions", before: "37" })]),
      }),
    ]);
    expect((await call(space, "DELETE", `/v1/transaction-tags/${repair.id}`)).statusCode).toBe(404);
  });

  it("BUD-13@PoC EC5: deleting a tag takes it off every transaction, hidden ones too", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const first = await add(space, account, "-30.00", { date: "2026-10-10" });
    const copy = await add(space, account, "-30.00", { date: "2026-10-11" });
    await attributes(space, copy.id, { tags: ["повернути"] });
    expect((await call(space, "POST", `/v1/transactions/${copy.id}/hide`)).statusCode).toBe(200);
    const [tag] = await tagsOf(space);
    expect(tag!.count).toBe(1);
    expect((await call(space, "DELETE", `/v1/transaction-tags/${tag!.id}`)).json().removed).toBe(1);
    expect((await get(space, copy.id)).tags).toEqual([]);
    expect((await get(space, first.id)).tags).toEqual([]);
  });
});

describe("BUD-13@PoC AC7: another space's transactions and tags are not found", () => {
  it("BUD-13@PoC AC7: a user outside the space reads and changes no attribute, tag, count or sum of it", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(owner);
    const t = await add(owner, account, "-12.00");
    await attributes(owner, t.id, { note: "секрет", tags: ["приватне"] });
    const [tag] = await tagsOf(owner);
    const read = await call(stranger, "GET", `/v1/transactions/${t.id}`);
    expect(read.statusCode).toBe(404);
    const write = await attributes(stranger, t.id, { note: "x", tags: ["чуже"] });
    expect(write.statusCode).toBe(404);
    expect(write.body).not.toContain("секрет");
    expect(await tagsOf(stranger)).toEqual([]);
    expect((await call(stranger, "PATCH", `/v1/transaction-tags/${tag!.id}`, { name: "x" })).statusCode).toBe(
      404,
    );
    expect((await call(stranger, "DELETE", `/v1/transaction-tags/${tag!.id}`)).statusCode).toBe(404);
    expect((await list(stranger, `?filter=tag.eq:${tag!.id}`)).count).toBe(0);
    const sum = await call(stranger, "POST", "/v1/transactions/selection-summary", { ids: [t.id] });
    expect(sum.json()).toMatchObject({ count: 0, convertedCount: 0 });
    // A scoped member: «Транзакції» are closed.
    const scoped = { role: "editor", scoped: true };
    expect((await call(owner, "GET", "/v1/transaction-tags", undefined, scoped)).statusCode).toBe(404);
    expect(
      (await call(owner, "PATCH", `/v1/transactions/${t.id}/attributes`, { note: "x" }, scoped)).statusCode,
    ).toBe(403);
    expect((await attributes(owner, t.id, { note: "x" })).statusCode).toBe(200);
    expect(await get(owner, t.id)).toMatchObject({ note: "x", tags: [{ id: tag!.id, name: "приватне" }] });
  });
});

describe("BUD-13@PoC FR 9: «Вибрано N · Сума ±X €» of the selection panel", () => {
  it("BUD-13@PoC AC4: 5 selected, two in złoty — «Вибрано 5 · Сума −75,50 €», «2 транзакції конвертовано»", async () => {
    // 1 EUR = 40 UAH and 1 PLN = 10 UAH on the date: 1 PLN = 0,25 EUR (a cross rate through the hryvnia).
    await rate("2026-10-15", "EUR", "40");
    await rate("2026-10-15", "PLN", "10");
    const space = await newSpace();
    const eur = await createAccount(space);
    const pln = await createAccount(space, "PLN");
    const picked = [
      await add(space, eur, "-12.00"),
      await add(space, pln, "-34.00", { currency: "PLN" }), // −8,50 €
      await add(space, eur, "-40.00"),
      await add(space, pln, "20.00", { currency: "PLN" }), // +5,00 € повернення
    ].map((t) => t.id);
    const four = await call(space, "POST", "/v1/transactions/selection-summary", { ids: picked });
    expect(four.json()).toMatchObject({
      count: 4,
      sum: { amount: "-55.5", currency: "EUR" },
      convertedCount: 2,
    });
    const fifth = await add(space, eur, "-20.00");
    const res = await call(space, "POST", "/v1/transactions/selection-summary", {
      ids: [...picked, fifth.id],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      count: 5,
      currency: "EUR",
      sum: { amount: "-75.5", currency: "EUR" },
      convertedCount: 2,
      approximate: false,
      nearestRateCount: 0,
      noRateCount: 0,
    });
  });

  it("BUD-13@PoC AC9: −12,00 € and −1 000,00 UAH without a rate on its date, the nearest 40,00 — «Сума −37,00 €», «приблизно», «1 транзакція за найближчим курсом»", async () => {
    await rate("2026-09-01", "EUR", "40");
    const space = await newSpace();
    const eur = await createAccount(space);
    const uah = await createAccount(space, "UAH");
    const a = await add(space, eur, "-12.00", { date: "2026-09-02" });
    const b = await add(space, uah, "-1000.00", { currency: "UAH", date: "2026-09-02" });
    const res = await call(space, "POST", "/v1/transactions/selection-summary", { ids: [a.id, b.id] });
    expect(res.json()).toMatchObject({
      count: 2,
      sum: { amount: "-37", currency: "EUR" },
      approximate: true,
      nearestRateCount: 1,
      convertedCount: 1,
    });
  });

  it("BUD-13@PoC EC1: once the rate of the date appears, the sum is exact and no longer «приблизно»", async () => {
    await rate("2026-08-01", "EUR", "40");
    const space = await newSpace();
    const uah = await createAccount(space, "UAH");
    const t = await add(space, uah, "-1000.00", { currency: "UAH", date: "2026-08-03" });
    const before = await call(space, "POST", "/v1/transactions/selection-summary", { ids: [t.id] });
    expect(before.json()).toMatchObject({ sum: { amount: "-25" }, approximate: true, nearestRateCount: 1 });
    await rate("2026-08-03", "EUR", "50");
    const after = await call(space, "POST", "/v1/transactions/selection-summary", { ids: [t.id] });
    expect(after.json()).toMatchObject({ sum: { amount: "-20" }, approximate: false, nearestRateCount: 0 });
  });
});

describe("DAT-03@PoC FR 2: «Додати теги» of the selection panel", () => {
  const run = (space: Space, body: unknown, preview = false) =>
    app.inject({
      method: "POST",
      url: preview ? "/v1/bulk-actions/preview" : "/v1/bulk-actions",
      headers: {
        origin: WEB,
        "content-type": "application/json",
        ...(preview ? {} : { "idempotency-key": randomUUID() }),
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
      payload: JSON.stringify(body),
    });

  it("BUD-13@PoC FR 2: «Додати теги» adds the tags to each selected transaction once; «Відмінити» gives the tags back", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    const c = await add(space, account, "-3.00");
    await attributes(space, a.id, { tags: ["Ремонт"] });
    const body = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [a.id, b.id, c.id] },
      params: { tags: ["ремонт", "кухня"] },
    };
    const preview = await run(space, body, true);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ count: 3, changes: 3 });
    // The preview writes nothing: no new tag.
    expect((await tagsOf(space)).map((t) => t.name)).toEqual(["Ремонт"]);
    const started = await run(space, body);
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json()).toMatchObject({ status: "completed", changed: 3 });
    expect((await get(space, a.id)).tags.map((t) => t.name)).toEqual(["Ремонт", "кухня"]);
    expect((await get(space, c.id)).tags.map((t) => t.name)).toEqual(["Ремонт", "кухня"]);
    expect(await tagsOf(space)).toEqual([
      expect.objectContaining({ name: "кухня", count: 3 }),
      expect.objectContaining({ name: "Ремонт", count: 3 }),
    ]);
    // The group audit entry masks the names (П-10).
    const group = await audit.entriesFor(space.householdId, {
      type: "bulk-actions.action",
      id: started.json().id,
    });
    expect(JSON.stringify(group)).not.toContain("кухня");
    // The same again: «без змін».
    expect((await run(space, body, true)).json()).toMatchObject({ changes: 0, skipped: { unchanged: 3 } });
    const undo = await app.inject({
      method: "POST",
      url: `/v1/bulk-actions/${started.json().id}/undo`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
    });
    expect(undo.statusCode, undo.body).toBe(200);
    expect((await get(space, a.id)).tags.map((t) => t.name)).toEqual(["Ремонт"]);
    expect((await get(space, b.id)).tags).toEqual([]);
  });

  it("BUD-13@PoC FR 2: «Додати теги» past 20 on a transaction is «невалідний»; a tag renamed since is «не відновлено» on undo", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const full = await add(space, account, "-1.00");
    const free = await add(space, account, "-2.00");
    await attributes(space, full.id, { tags: Array.from({ length: 20 }, (_, i) => `тег ${i}`) });
    const body = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [full.id, free.id] },
      params: { tags: ["новий"] },
    };
    const started = await run(space, body);
    expect(started.json()).toMatchObject({ changed: 1, skipped: { invalid: 1 } });
    expect(started.json().skippedRecords).toEqual([
      expect.objectContaining({ id: full.id, reason: "invalid", issue: "tags.too_many" }),
    ]);
    const tag = (await tagsOf(space)).find((t) => t.name === "новий")!;
    await call(space, "PATCH", `/v1/transaction-tags/${tag.id}`, { name: "перейменований" });
    const undo = await app.inject({
      method: "POST",
      url: `/v1/bulk-actions/${started.json().id}/undo`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
    });
    expect(undo.json().undo).toMatchObject({ restored: 0, notRestored: 1 });
  });
});

describe("sensitive: two requests at once", () => {
  it("BUD-13@PoC FR 2: two transactions get the same new tag at once — one tag of the space, on both", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    const [ra, rb] = await Promise.all([
      attributes(space, a.id, { tags: ["Відпустка", "море"] }),
      attributes(space, b.id, { tags: ["море", "відпустка"] }),
    ]);
    expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
    const tags = await tagsOf(space);
    expect(tags.map((t) => [t.name.toLowerCase(), t.count])).toEqual([
      ["відпустка", 2],
      ["море", 2],
    ]);
  });

  it("BUD-13@PoC FR 2: one transaction's tags changed twice at once — the last saved wins whole, no lost tag id, no 500", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    const [r1, r2] = await Promise.all([
      attributes(space, t.id, { tags: ["перший"], note: "один" }),
      attributes(space, t.id, { tags: ["другий"], note: "два" }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const shown = await get(space, t.id);
    expect([
      ["один", ["перший"]],
      ["два", ["другий"]],
    ]).toContainEqual([shown.note, shown.tags.map((x) => x.name)]);
    const versions = await db.owner.query(`SELECT version FROM transactions.transactions WHERE id = $1`, [
      t.id,
    ]);
    expect(versions.rows[0].version).toBe(3);
  });

  it("BUD-13@PoC FR 2: a tag deleted while another request attaches it — never left on a transaction as an unknown id", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    await attributes(space, a.id, { tags: ["тимчасовий"] });
    const [tag] = await tagsOf(space);
    const [del, attach] = await Promise.all([
      call(space, "DELETE", `/v1/transaction-tags/${tag!.id}`),
      attributes(space, b.id, { tags: ["тимчасовий"] }),
    ]);
    expect([del.statusCode, attach.statusCode]).toEqual([200, 200]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transactions t
        WHERE t.household_id = $1
          AND EXISTS (SELECT 1 FROM unnest(t.tag_ids) x(id)
                       WHERE NOT EXISTS (SELECT 1 FROM transactions.tags g WHERE g.household_id = t.household_id AND g.id = x.id))`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("ARC-04@PoC FR 2–4: a tag change's audit entry follows the commit, from the worker if need be", () => {
  it("ARC-04@PoC FR 4: a tag's audit job the worker gave up on (dead) goes back with the daily recovery and is written once", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    await attributes(space, t.id, { tags: ["старий"] });
    const [tag] = await tagsOf(space);
    vi.spyOn(audit, "record").mockRejectedValue(new Error("injected"));
    const res = await call(space, "PATCH", `/v1/transaction-tags/${tag!.id}`, { name: "новий" });
    expect(res.statusCode, res.body).toBe(200);
    vi.restoreAllMocks();
    expect(await audit.entriesFor(space.householdId, { type: "transactions.tag", id: tag!.id })).toEqual([]);
    await db.owner.query(
      `UPDATE transactions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1 AND name = 'transactions.tag-audit'`,
      [space.householdId],
    );
    expect(await jobs(space.householdId, "dead")).toBe(1);
    const recovery = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    }).find((task) => task.name === "transactions.hand-off-recovery");
    await recovery!.run();
    expect(await jobs(space.householdId, "dead")).toBe(0);
    await runWorker(space.householdId);
    expect(await jobs(space.householdId, "queued")).toBe(0);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.tag", id: tag!.id });
    expect(log).toEqual([expect.objectContaining({ action: "update" })]);
    await runWorker(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: "transactions.tag", id: tag!.id })).toHaveLength(
      1,
    );
  });
});
