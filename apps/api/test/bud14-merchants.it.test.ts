import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createMerchantsErasure, createMerchantsServices } from "../src/modules/merchants/index.ts";
import { createTransactionsServices, createTransactionTexts } from "../src/modules/transactions/index.ts";

/**
 * BUD-14@PoC a) (wave 2 row 22): the merchants of a space through the real API on a real PostgreSQL — the merchant of a
 * transaction cleaned from its description with «Оригінальний опис» and «Канал» (FR 1, FR 2, AC10, AC11), «Перейменувати
 * мерчанта», «Об'єднати з…» and «Роз'єднати» for the space (FR 3, AC1, AC16), another space and a scoped member, the
 * audit hand-off with its dead job and daily recovery (ARC-04, #249), and the space's erasure. Every description and
 * amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
const ENTITY = "merchants.merchant";
const FLAG = "transactions.merchants";
const telemetry = testTelemetryForFile();

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

interface MerchantBody {
  id: string;
  name: string;
  initials: string;
  intermediary: boolean;
  mergedInto: string | null;
}

interface TransactionMerchantBody {
  transactionId: string;
  originalDescription: string | null;
  channel: string | null;
  merchant: MerchantBody | null;
  joinedFrom: MerchantBody | null;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH",
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

async function createAccount(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function purchase(space: Space, accountId: string, counterparty?: string): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount: "-4.80", currency: "EUR" },
    date: "2026-10-15",
    ...(counterparty !== undefined ? { counterparty } : {}),
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function merchantOf(space: Space, transactionId: string): Promise<TransactionMerchantBody> {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}/merchant`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as TransactionMerchantBody;
}

async function merchants(space: Space): Promise<(MerchantBody & { transactionCount: number })[]> {
  const res = await call(space, "GET", "/v1/merchants");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items;
}

async function counterpartyOf(space: Space, transactionId: string): Promise<string | null> {
  const res = await call(space, "GET", `/v1/transactions/${transactionId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().counterparty as string | null;
}

async function rows(householdId: string) {
  return (
    await db.owner.query(
      `SELECT match_key, name, intermediary, merged_into IS NOT NULL AS merged FROM merchants.merchants
        WHERE household_id = $1 ORDER BY match_key`,
      [householdId],
    )
  ).rows;
}

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
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
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

describe("BUD-14@PoC FR 1, FR 2: the merchant of a transaction in «Деталі транзакції»", () => {
  it("BUD-14@PoC FR 2: the merchant cleaned from the description, with initials, «Оригінальний опис» and no channel or logo", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SUMUP *STARBUCKS 1234 MADRID ES");
    const shown = await merchantOf(space, t);
    expect(shown).toEqual({
      transactionId: t,
      originalDescription: "SUMUP *STARBUCKS 1234 MADRID ES",
      channel: null,
      merchant: {
        id: expect.any(String),
        name: "Starbucks",
        initials: "S",
        intermediary: false,
        mergedInto: null,
      },
      joinedFrom: null,
    });
    // The same description later is the same merchant; reading creates nothing more.
    expect((await merchantOf(space, await purchase(space, account, "STARBUCKS 7781"))).merchant?.id).toBe(
      shown.merchant!.id,
    );
    expect(await rows(space.householdId)).toEqual([
      { match_key: "starbucks", name: "Starbucks", intermediary: false, merged: false },
    ]);
  });

  it("BUD-14@PoC FR 1: a transaction without a counterparty has no merchant", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account);
    expect(await merchantOf(space, t)).toEqual({
      transactionId: t,
      originalDescription: null,
      channel: null,
      merchant: null,
      joinedFrom: null,
    });
  });

  it("BUD-14@PoC AC10: «PAYPAL *SPOTIFY 35314369001» — the merchant «Spotify», «Канал: PayPal»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "PAYPAL *SPOTIFY 35314369001");
    expect(await merchantOf(space, t)).toMatchObject({
      originalDescription: "PAYPAL *SPOTIFY 35314369001",
      channel: "PayPal",
      merchant: { name: "Spotify", initials: "S", intermediary: false },
    });
  });

  it("BUD-14@PoC AC11: «PAYPAL *1234567890» — the merchant «PayPal» marked «посередник»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "PAYPAL *1234567890");
    expect(await merchantOf(space, t)).toMatchObject({
      channel: "PayPal",
      merchant: { name: "PayPal", initials: "P", intermediary: true },
    });
  });

  it("BUD-14@PoC EC6: an intermediary without a visible recipient — after a rename the channel and the mark stay", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "PAYPAL *1234567890");
    const id = (await merchantOf(space, t)).merchant!.id;
    const renamed = await call(space, "PATCH", `/v1/merchants/${id}`, { name: "Платежі онлайн" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(await merchantOf(space, t)).toMatchObject({
      originalDescription: "PAYPAL *1234567890",
      channel: "PayPal",
      merchant: { id, name: "Платежі онлайн", initials: "ПО", intermediary: true },
    });
  });

  it("BUD-14@PoC AC13: a merchant «ТОВ Ромашка» has the initials «ТР», like every merchant — no logo, the name is a plain field", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, 'ТОВ "РОМАШКА" 00123');
    const born = (await merchantOf(space, t)).merchant!;
    expect(born).toMatchObject({ name: "Ромашка", initials: "Р" });
    expect((await call(space, "PATCH", `/v1/merchants/${born.id}`, { name: "ТОВ Ромашка" })).statusCode).toBe(
      200,
    );
    const shown = (await merchantOf(space, t)).merchant!;
    expect(shown).toEqual({
      id: born.id,
      name: "ТОВ Ромашка",
      initials: "ТР",
      intermediary: false,
      mergedInto: null,
    });
    // No logo or link of a merchant directory is part of the answer.
    expect(Object.keys(shown).sort()).toEqual(["id", "initials", "intermediary", "mergedInto", "name"]);
  });
});

describe("BUD-14@PoC FR 3: rename and merge for the space; the original descriptions never change", () => {
  it("BUD-14@PoC FR 3: «Перейменувати мерчанта» — every transaction of its descriptions shows the new name, the bank's description stays; the rename is in the audit log, the names masked", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SILPO 1234");
    const id = (await merchantOf(space, t)).merchant!.id;
    const renamed = await call(space, "PATCH", `/v1/merchants/${id}`, { name: "  Сільпо " });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ id, name: "Сільпо", initials: "С" });
    expect(await merchantOf(space, t)).toMatchObject({
      originalDescription: "SILPO 1234",
      merchant: { id, name: "Сільпо" },
    });
    expect(await counterpartyOf(space, t)).toBe("SILPO 1234");
    // A new transaction with such a description is the renamed merchant.
    expect(
      (await merchantOf(space, await purchase(space, account, "POS SILPO 5678"))).merchant,
    ).toMatchObject({
      id,
      name: "Сільпо",
    });
    const entries = await audit.entriesFor(space.householdId, { type: ENTITY, id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "update",
      actorKind: "user",
      actorId: space.accountId,
      changes: [{ field: "name", masked: true }],
    });
    expect(JSON.stringify(entries)).not.toContain("Сільпо");
    expect(JSON.stringify(entries)).not.toContain("SILPO");
    // The same name again changes nothing and writes no entry.
    expect((await call(space, "PATCH", `/v1/merchants/${id}`, { name: "Сільпо" })).statusCode).toBe(200);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id })).toHaveLength(1);
  });

  it("FLW-41@PoC AC6: «SILPO 1234» renamed to «Сільпо» — the details show «Сільпо» and «Оригінальний опис: SILPO 1234»", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SILPO 1234");
    const id = (await merchantOf(space, t)).merchant!.id;
    expect((await call(space, "PATCH", `/v1/merchants/${id}`, { name: "Сільпо" })).statusCode).toBe(200);
    expect(await merchantOf(space, t)).toMatchObject({
      originalDescription: "SILPO 1234",
      merchant: { name: "Сільпо" },
    });
  });

  it("BUD-14@PoC FR 3: a name must be one line of 1–100 characters", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SILPO 1234");
    const id = (await merchantOf(space, t)).merchant!.id;
    for (const name of ["", "   ", "Два\nрядки", "я".repeat(101)]) {
      const res = await call(space, "PATCH", `/v1/merchants/${id}`, { name });
      expect(res.statusCode, name).toBe(400);
      expect(res.json().errors).toEqual([{ in: "body", path: "name", issue: "invalid" }]);
    }
    expect((await merchantOf(space, t)).merchant?.name).toBe("Silpo");
  });

  it("BUD-14@PoC AC1: «Об'єднати з…» «Starbucks Coffee» (18 transactions) into «Starbucks» — every transaction of both shows «Starbucks», new ones too, the descriptions stay; in the audit log; «Роз'єднати» is offered", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SUMUP *STARBUCKS 1234 MADRID ES");
    const coffee: string[] = [];
    for (let i = 0; i < 18; i++)
      coffee.push(await purchase(space, account, `STARBUCKS COFFEE 00${10 + i} LISBOA PT`));
    const starbucks = (await merchantOf(space, t)).merchant!;
    expect(starbucks).toMatchObject({ name: "Starbucks", initials: "S" });
    const listed = await merchants(space);
    expect(listed.map((m) => [m.name, m.transactionCount])).toEqual([
      ["Starbucks", 1],
      ["Starbucks Coffee", 18],
    ]);
    const source = listed.find((m) => m.name === "Starbucks Coffee")!;

    const merged = await call(space, "POST", `/v1/merchants/${starbucks.id}/merge`, {
      merchantId: source.id,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json()).toMatchObject({ id: starbucks.id, name: "Starbucks", mergedInto: null });

    for (const id of [t, ...coffee])
      expect((await merchantOf(space, id)).merchant).toMatchObject({ id: starbucks.id, name: "Starbucks" });
    const detail = await merchantOf(space, coffee[0]!);
    expect(detail).toMatchObject({
      originalDescription: "STARBUCKS COFFEE 0010 LISBOA PT",
      joinedFrom: { id: source.id, name: "Starbucks Coffee", mergedInto: starbucks.id },
    });
    expect((await merchantOf(space, t)).joinedFrom).toBeNull();
    expect(await counterpartyOf(space, coffee[0]!)).toBe("STARBUCKS COFFEE 0010 LISBOA PT");
    // New transactions with such descriptions go to the merged merchant.
    expect(
      (await merchantOf(space, await purchase(space, account, "STARBUCKS COFFEE 0099 PORTO PT"))).merchant,
    ).toMatchObject({
      id: starbucks.id,
      name: "Starbucks",
    });
    expect((await merchants(space)).map((m) => [m.name, m.transactionCount])).toEqual([["Starbucks", 20]]);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: source.id })).toMatchObject([
      {
        action: "update",
        actorKind: "user",
        actorId: space.accountId,
        changes: [{ field: "mergedInto", before: null, after: starbucks.id, masked: false }],
      },
    ]);
  });

  it("BUD-14@PoC AC16: «Роз'єднати» in the details of a merged transaction — «Starbucks Coffee» is its own again with its 18 transactions; the descriptions stay", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SUMUP *STARBUCKS 1234 MADRID ES");
    const coffee: string[] = [];
    for (let i = 0; i < 18; i++)
      coffee.push(await purchase(space, account, `STARBUCKS COFFEE 00${10 + i} LISBOA PT`));
    const starbucks = (await merchantOf(space, t)).merchant!;
    const source = (await merchantOf(space, coffee[0]!)).merchant!;
    expect(
      (await call(space, "POST", `/v1/merchants/${starbucks.id}/merge`, { merchantId: source.id }))
        .statusCode,
    ).toBe(200);

    const joined = (await merchantOf(space, coffee[5]!)).joinedFrom!;
    expect(joined.id).toBe(source.id);
    const unmerged = await call(space, "POST", `/v1/merchants/${joined.id}/unmerge`);
    expect(unmerged.statusCode, unmerged.body).toBe(200);
    expect(unmerged.json()).toMatchObject({ id: source.id, name: "Starbucks Coffee", mergedInto: null });
    for (const id of coffee)
      expect(await merchantOf(space, id)).toMatchObject({
        merchant: { id: source.id, name: "Starbucks Coffee" },
        joinedFrom: null,
      });
    expect((await merchantOf(space, t)).merchant).toMatchObject({ id: starbucks.id, name: "Starbucks" });
    expect((await merchants(space)).map((m) => [m.name, m.transactionCount])).toEqual([
      ["Starbucks", 1],
      ["Starbucks Coffee", 18],
    ]);
    expect(await counterpartyOf(space, coffee[5]!)).toBe(`STARBUCKS COFFEE 0015 LISBOA PT`);
    expect(
      (await audit.entriesFor(space.householdId, { type: ENTITY, id: source.id })).map((e) => e.changes[0]),
    ).toMatchObject([
      { field: "mergedInto", before: null, after: starbucks.id },
      { field: "mergedInto", before: starbucks.id, after: null },
    ]);
    // On a merchant that joined none, «Роз'єднати» changes nothing.
    expect((await call(space, "POST", `/v1/merchants/${source.id}/unmerge`)).statusCode).toBe(200);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: source.id })).toHaveLength(2);
  });

  it("BUD-14@PoC EC3: different merchants merged by mistake — «Роз'єднати» is always available, also after the merchant it joined joined another", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = (await merchantOf(space, await purchase(space, account, "SYNTH BOOKS 1001"))).merchant!;
    const b = (await merchantOf(space, await purchase(space, account, "SYNTH CAFE 2002"))).merchant!;
    const c = (await merchantOf(space, await purchase(space, account, "SYNTH FUEL 3003"))).merchant!;
    expect((await call(space, "POST", `/v1/merchants/${b.id}/merge`, { merchantId: a.id })).statusCode).toBe(
      200,
    );
    // b joins c: a, which had joined b, joins c directly — no chain.
    expect((await call(space, "POST", `/v1/merchants/${c.id}/merge`, { merchantId: b.id })).statusCode).toBe(
      200,
    );
    const listed = await merchants(space);
    expect(listed.map((m) => [m.name, m.transactionCount])).toEqual([["Synth Fuel", 3]]);
    expect((await call(space, "POST", `/v1/merchants/${a.id}/unmerge`)).json()).toMatchObject({
      name: "Synth Books",
      mergedInto: null,
    });
    expect((await merchants(space)).map((m) => [m.name, m.transactionCount])).toEqual([
      ["Synth Books", 1],
      ["Synth Fuel", 2],
    ]);
  });

  it("BUD-14@PoC FR 3: a merge with itself, from or into a merged merchant, or with an unknown one is refused; nothing changes", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = (await merchantOf(space, await purchase(space, account, "SYNTH BOOKS 1001"))).merchant!;
    const b = (await merchantOf(space, await purchase(space, account, "SYNTH CAFE 2002"))).merchant!;
    const c = (await merchantOf(space, await purchase(space, account, "SYNTH FUEL 3003"))).merchant!;
    const self = await call(space, "POST", `/v1/merchants/${a.id}/merge`, { merchantId: a.id });
    expect(self.statusCode).toBe(400);
    expect(self.json().errors).toEqual([{ in: "body", path: "merchantId", issue: "same_merchant" }]);
    expect((await call(space, "POST", `/v1/merchants/${b.id}/merge`, { merchantId: a.id })).statusCode).toBe(
      200,
    );
    const fromMerged = await call(space, "POST", `/v1/merchants/${c.id}/merge`, { merchantId: a.id });
    expect(fromMerged.statusCode).toBe(400);
    expect(fromMerged.json().errors).toEqual([{ in: "body", path: "merchantId", issue: "merged" }]);
    const intoMerged = await call(space, "POST", `/v1/merchants/${a.id}/merge`, { merchantId: c.id });
    expect(intoMerged.statusCode).toBe(409);
    expect(intoMerged.json().code).toBe("MERCHANT_MERGED");
    const rename = await call(space, "PATCH", `/v1/merchants/${a.id}`, { name: "Інша назва" });
    expect(rename.statusCode).toBe(409);
    expect(rename.json().code).toBe("MERCHANT_MERGED");
    const unknown = await call(space, "POST", `/v1/merchants/${c.id}/merge`, { merchantId: randomUUID() });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().errors).toEqual([{ in: "body", path: "merchantId", issue: "not_found" }]);
    expect(
      (await call(space, "POST", `/v1/merchants/${randomUUID()}/merge`, { merchantId: c.id })).statusCode,
    ).toBe(404);
    expect((await call(space, "PATCH", `/v1/merchants/${randomUUID()}`, { name: "Х" })).statusCode).toBe(404);
    expect((await call(space, "POST", `/v1/merchants/${randomUUID()}/unmerge`)).statusCode).toBe(404);
    expect(await rows(space.householdId)).toEqual([
      { match_key: "synth books", name: "Synth Books", intermediary: false, merged: true },
      { match_key: "synth cafe", name: "Synth Cafe", intermediary: false, merged: false },
      { match_key: "synth fuel", name: "Synth Fuel", intermediary: false, merged: false },
    ]);
  });

  it("BUD-14@PoC FR 3: the list «Об'єднати з…» searches by a part of the name in any case", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await purchase(space, account, "SYNTH BOOKS 1001");
    await purchase(space, account, "SYNTH CAFE 2002");
    const res = await call(space, "GET", "/v1/merchants?search=cAfE");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items.map((m: MerchantBody) => m.name)).toEqual(["Synth Cafe"]);
  });
});

describe("BUD-14@PoC «Права доступу»: the space's own merchants only", () => {
  it("BUD-14@PoC «Права доступу»: a transaction or a merchant of another space is «not found»; nothing of it is told or changed", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SYNTH BOOKS 1001");
    const mine = (await merchantOf(space, t)).merchant!;
    const theirs = (
      await merchantOf(stranger, await purchase(stranger, await createAccount(stranger), "SYNTH CAFE 2002"))
    ).merchant!;

    const read = await call(stranger, "GET", `/v1/transactions/${t}/merchant`);
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain("Synth Books");
    expect((await call(stranger, "PATCH", `/v1/merchants/${mine.id}`, { name: "Чуже" })).statusCode).toBe(
      404,
    );
    expect((await call(stranger, "POST", `/v1/merchants/${mine.id}/unmerge`)).statusCode).toBe(404);
    expect(
      (await call(stranger, "POST", `/v1/merchants/${mine.id}/merge`, { merchantId: theirs.id })).statusCode,
    ).toBe(404);
    const intoMine = await call(stranger, "POST", `/v1/merchants/${theirs.id}/merge`, {
      merchantId: mine.id,
    });
    expect(intoMine.statusCode).toBe(400);
    expect(intoMine.json().errors).toEqual([{ in: "body", path: "merchantId", issue: "not_found" }]);
    expect((await merchants(stranger)).map((m) => m.name)).toEqual(["Synth Cafe"]);
    expect(await merchantOf(space, t)).toMatchObject({
      merchant: { id: mine.id, name: "Synth Books", mergedInto: null },
    });
    expect((await call(space, "GET", `/v1/transactions/${randomUUID()}/merchant`)).statusCode).toBe(404);
  });

  it("BUD-14@PoC «Права доступу»: a scoped member — «Транзакції» closed: reading not found, changing 403", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SYNTH BOOKS 1001");
    const id = (await merchantOf(space, t)).merchant!.id;
    const scoped = { role: "editor", scoped: true };
    expect((await call(space, "GET", `/v1/transactions/${t}/merchant`, undefined, scoped)).statusCode).toBe(
      404,
    );
    expect((await call(space, "GET", "/v1/merchants", undefined, scoped)).statusCode).toBe(404);
    expect((await call(space, "PATCH", `/v1/merchants/${id}`, { name: "Інша" }, scoped)).statusCode).toBe(
      403,
    );
    expect((await call(space, "POST", `/v1/merchants/${id}/unmerge`, undefined, scoped)).statusCode).toBe(
      403,
    );
  });

  it("BUD-14@PoC «Права доступу»: behind the release flag transactions.merchants — off, the routes are not found", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const t = await purchase(space, account, "SYNTH BOOKS 1001");
    off.add(FLAG);
    expect((await call(space, "GET", `/v1/transactions/${t}/merchant`)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/merchants")).statusCode).toBe(404);
    expect(await rows(space.householdId)).toEqual([]);
  });
});

describe("ARC-04@PoC FR 2–4: the audit hand-off of a change, its dead job and the daily recovery (#249)", () => {
  it("ARC-04@PoC FR 4: the audit entry fails — the merge stands (200, WARN deferred); its job in state dead goes back with the daily recovery and the entry is written once", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = (await merchantOf(space, await purchase(space, account, "SYNTH BOOKS 1001"))).merchant!;
    const b = (await merchantOf(space, await purchase(space, account, "SYNTH CAFE 2002"))).merchant!;
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === ENTITY) throw new Error("injected");
      return original(householdId, entry);
    });
    const res = await call(space, "POST", `/v1/merchants/${b.id}/merge`, { merchantId: a.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "merchants.hand_off_deferred")
        .map((r) => r.severityText),
    ).toEqual(["WARN"]);
    vi.restoreAllMocks();
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: a.id })).toHaveLength(0);

    await db.owner.query(`UPDATE merchants.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    await runWorker(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: a.id })).toHaveLength(0);

    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    const names = tasks.map((task) => task.name);
    expect(names.indexOf("merchants.recovery")).toBeGreaterThan(-1);
    expect(names.indexOf("merchants.recovery")).toBeLessThan(names.indexOf("queue.retention-cleanup"));
    await tasks.find((task) => task.name === "merchants.recovery")!.run();
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "merchants.jobs_requeued")
        .map((r) => [r.severityText, r.attributes]),
    ).toEqual([["WARN", { "ws.module": "merchants" }]]);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: ENTITY, id: a.id })).toHaveLength(1);
    // The job carries no name of a merchant.
    const { rows: jobs } = await db.owner.query(
      `SELECT payload::text AS p FROM merchants.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    for (const j of jobs) expect(j.p).not.toMatch(/Synth|SYNTH/);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the merchants and the queue rows", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = (await merchantOf(space, await purchase(space, account, "SYNTH BOOKS 1001"))).merchant!;
    const b = (await merchantOf(space, await purchase(space, account, "SYNTH CAFE 2002"))).merchant!;
    expect((await call(space, "POST", `/v1/merchants/${b.id}/merge`, { merchantId: a.id })).statusCode).toBe(
      200,
    );
    const erased = await createMerchantsErasure(db.databases.for("merchants")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toEqual({ merchants: 2, jobs: 1 });
    expect(await rows(space.householdId)).toEqual([]);
  });
});
