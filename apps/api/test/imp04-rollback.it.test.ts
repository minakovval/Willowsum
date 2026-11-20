import { randomBytes, randomUUID } from "node:crypto";
import { Decimal, Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createFxRates, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import {
  createImportCategoryCarry,
  createTransactionCategoryRead,
} from "../src/modules/categorization/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createImportedTransactions, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * «Відкотити» an applied import batch (IMP-04@PoC FR 8, FR 10, AC7, AC8, AC12, EC4; IMP-16@PoC FR 1–5, FR 9, AC1, AC2,
 * AC4, AC5; wave 2 row 44) on a real PostgreSQL through the real API, the real parse worker, modules transactions,
 * ledger and categorization: a reversal in the journal for each transaction (never a deletion), exact balances before
 * and after, «Залишити змінені» and «Відкотити все», a merged manual one and a replaced pending one back, 7 days, once,
 * another space, and the rollback racing a new apply on the same account. The accounts module is the test's port (an EUR
 * account). Synthetic data only; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-11-20T10:00:00Z");
let nowMs = start;
const clock = { now: () => nowMs };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  readonly eur: string;
  readonly subaccountId: string;
  readonly ledgerAccountId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const eur = randomUUID();
  const sub = { subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() };
  accountsOf.set(`${householdId}/${eur}`, {
    accountId: eur,
    kind: "current",
    status: "active",
    subaccounts: [sub],
  });
  await ledger.openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
  );
  return {
    accountId,
    householdId,
    eur,
    subaccountId: sub.subaccountId,
    ledgerAccountId: sub.ledgerAccountId,
  };
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

interface Line {
  readonly date: string;
  readonly amount: string;
  readonly description: string;
}

/** A statement whose figures agree (opening 1 000,00 EUR, its rows, the closing balance); a day past 12 fixes the order. */
function statement(lines: readonly Line[]): Buffer {
  const closing = lines.reduce((sum, l) => sum.plus(l.amount), new Decimal("1000.00"));
  return Buffer.from(
    [
      "Вхідний залишок:;1000.00 EUR",
      "Дата;Сума;Опис",
      ...lines.map((l) => `${l.date};${l.amount};${l.description}`),
      `Кінцевий залишок:;${closing.toFixed(2)} EUR`,
    ].join("\r\n") + "\r\n",
    "utf8",
  );
}

/** `n` purchases of 30,00 EUR on days 13–28, then 1–12 of April (a day past 12 first fixes the order). */
const purchases = (n: number, prefix = "SHOP"): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `${String(((i + 12) % 28) + 1).padStart(2, "0")}.04.2026`,
    amount: "-30.00",
    description: `${prefix} ${i + 1}`,
  }));

async function parsedBatch(space: Space, name: string, bytes: Buffer): Promise<string> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const fileIds = (uploaded.json().files as { id: string }[]).map((f) => f.id);
  const started = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
    files: fileIds.map((fileId) => ({ fileId, accountId: space.eur })),
  });
  expect(started.statusCode, started.body).toBe(200);
  const worker = createWorker({
    queues: [
      createImportSessionsWorkerQueue(db.databases.for("import-sessions"), audit, {
        modules: {
          files,
          keys,
          recipes: createImportRecipesReader(db.databases.for("import-recipes")),
          accounts,
          parser: isolatedStatementParser(),
        },
        now: clock.now,
        newId: randomUUID,
      }),
    ],
    households: async () => [space.householdId],
    retryDelayMs: () => 0,
  });
  try {
    for (let i = 0; i < 8; i++) {
      if ((await worker.tick()) === 0) break;
      await worker.idle();
    }
  } finally {
    await worker.stop();
  }
  return batchId;
}

async function applied(space: Space, name: string, lines: readonly Line[]): Promise<string> {
  const batchId = await parsedBatch(space, name, statement(lines));
  const res = await call(space, "POST", `/v1/import/batches/${batchId}/apply`);
  expect(res.statusCode, res.body).toBe(200);
  return batchId;
}

const rollback = (space: Space, batchId: string, mode?: "keep-changed" | "all") =>
  call(space, "POST", `/v1/import/batches/${batchId}/rollback`, mode === undefined ? {} : { mode });

/** The account's balance in the journal (all dates). */
async function balance(space: Space): Promise<string> {
  const money = await ledger.balanceAt(space.householdId, space.ledgerAccountId, "2026-12-31");
  return new Decimal(money.toDecimalString()).toFixed(2);
}

/** The space's journal: every entry and the reversals among them. */
async function journal(householdId: string): Promise<{ entries: number; reversals: number }> {
  const { rows } = await db.owner.query<{ entries: number; reversals: number }>(
    `SELECT count(*)::int AS entries, count(reverses_entry_id)::int AS reversals
       FROM ledger.entries WHERE household_id = $1`,
    [householdId],
  );
  return rows[0]!;
}

interface TxRow {
  id: string;
  amount: string;
  source: string;
  status: string;
  hidden: boolean;
  merged_into: string | null;
  note: string | null;
  rolled_back: boolean;
  import_batch_id: string | null;
}

async function transactions(householdId: string): Promise<TxRow[]> {
  const { rows } = await db.owner.query<TxRow>(
    `SELECT id, trim_scale(amount)::text AS amount, source, status, hidden, merged_into, note,
            rolled_back_at IS NOT NULL AS rolled_back, import_batch_id
       FROM transactions.transactions WHERE household_id = $1 ORDER BY occurred_on, id`,
    [householdId],
  );
  return rows;
}

/** The journal's balance as the rows say it should be: every posted row still in the books, once. */
async function expectedBalance(householdId: string): Promise<string> {
  const { rows } = await db.owner.query<{ sum: string }>(
    `SELECT trim_scale(coalesce(sum(amount), 0))::text AS sum FROM transactions.transactions
      WHERE household_id = $1 AND status = 'posted' AND merged_into IS NULL AND rolled_back_at IS NULL
        AND NOT (hidden AND source = 'manual')`,
    [householdId],
  );
  return rows[0]!.sum;
}

async function categorize(householdId: string, transactionId: string, categoryId: string): Promise<void> {
  await db.owner.query(
    `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
     VALUES ($1, $2, $3, 'manual')
     ON CONFLICT (household_id, transaction_id) DO UPDATE SET category_id = $3, source = 'manual', version = 2`,
    [householdId, transactionId, categoryId],
  );
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  ledger = createLedger(db.databases.for("ledger"));
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys,
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        transactions: createTransactionsServices({
          accounts: accounts as AccountDirectory,
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: clock.now })),
            now: clock.now,
          }),
          audit,
          clock,
          newId: randomUUID,
        }),
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
          apply: {
            transactions: createImportedTransactions(db.databases.for("transactions"), {
              accounts,
              ledger,
              audit,
              newId: randomUUID,
              now: clock.now,
              merged: createImportCategoryCarry(db.databases.for("categorization")),
              categories: createTransactionCategoryRead(db.databases.for("categorization")),
            }),
          },
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

describe("IMP-16@PoC FR 2: the rollback reverses each transaction in the journal", () => {
  it("IMP-16@PoC AC1: a batch of 80 transactions for −2 400,00 EUR applied 2 days ago — the balance grows by exactly 2 400,00, 80 reversals, no entry deleted", async () => {
    nowMs = start;
    const space = await newSpace();
    const before = await balance(space);
    const batchId = await applied(space, "berezen.csv", purchases(80));
    expect(await balance(space)).toBe(new Decimal(before).minus("2400").toFixed(2));
    const posted = await journal(space.householdId);
    expect(posted).toEqual({ entries: 80, reversals: 0 });

    nowMs = start + 2 * DAY;
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      batch: { state: "rolled-back", rollbackUntil: null },
      rollback: {
        mode: "keep-changed",
        counts: { rolledBack: 80, kept: 0, transfers: 0, restored: 0 },
        kept: [],
      },
      first: true,
    });
    // Exactly the balance before the import; every entry still there, each of the 80 reversed once.
    expect(await balance(space)).toBe(new Decimal(before).toFixed(2));
    expect(await journal(space.householdId)).toEqual({ entries: 160, reversals: 80 });
    // FR 2: the transactions stay (the batch's history), rolled back and hidden.
    const all = await transactions(space.householdId);
    expect(all).toHaveLength(80);
    expect(all.every((t) => t.rolled_back && t.hidden && t.import_batch_id === batchId)).toBe(true);
  });

  it("IMP-16@PoC FR 2: a rolled-back transaction is out of the list «Транзакції» — shown and hidden ones — and of a single read", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "berezen.csv", purchases(3));
    const listed = await call(space, "GET", "/v1/transactions");
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toHaveLength(3);
    const one = listed.json().items[0].id as string;
    expect((await rollback(space, batchId)).statusCode).toBe(200);
    for (const url of ["/v1/transactions", "/v1/transactions?filter=hidden.eq:true"]) {
      const res = await call(space, "GET", url);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().items).toEqual([]);
    }
    expect((await call(space, "GET", `/v1/transactions/${one}`)).statusCode).toBe(404);
  });

  it("IMP-16@PoC FR 2: the same statement imported again after the rollback writes its transactions again (rolled-back ones are no duplicates)", async () => {
    nowMs = start;
    const space = await newSpace();
    const lines = purchases(3);
    const batchId = await applied(space, "berezen.csv", lines);
    expect((await rollback(space, batchId)).statusCode).toBe(200);
    const again = await parsedBatch(space, "berezen-2.csv", statement(lines));
    const res = await call(space, "POST", `/v1/import/batches/${again}/apply`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ import: 3, duplicate: 0, "already-imported": 0 });
    expect(await balance(space)).toBe("-90.00");
  });
});

describe("IMP-16@PoC FR 4: transactions the person changed after the apply", () => {
  it("IMP-16@PoC AC2: two transactions of the batch with a category set by hand — «Залишити змінені»: 78 rolled back, 2 kept and named", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "berezen.csv", purchases(80));
    const all = await transactions(space.householdId);
    const [a, b] = [all[3]!.id, all[40]!.id];
    await categorize(space.householdId, a, randomUUID());
    await categorize(space.householdId, b, randomUUID());
    nowMs = start + 2 * DAY;
    const res = await rollback(space, batchId, "keep-changed");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback.counts).toEqual({ rolledBack: 78, kept: 2, transfers: 0, restored: 0 });
    expect([...res.json().rollback.kept].sort()).toEqual([a, b].sort());
    // The two kept ones stay in the balance: −60,00 EUR.
    expect(await balance(space)).toBe("-60.00");
    expect(await journal(space.householdId)).toEqual({ entries: 158, reversals: 78 });
    const after = await transactions(space.householdId);
    expect(
      after
        .filter((t) => !t.rolled_back)
        .map((t) => t.id)
        .sort(),
    ).toEqual([a, b].sort());
  });

  it("IMP-04@PoC AC7, EC4: applied 2 days ago, one transaction re-categorized — the others reversed in the journal, none deleted, the changed one kept and named", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", [
      { date: "10.04.2026", amount: "-42.00", description: "CAFE CENTRAL" },
      { date: "20.04.2026", amount: "-17.35", description: "BOOKS" },
      { date: "21.04.2026", amount: "250.00", description: "REFUND" },
    ]);
    const changed = (await transactions(space.householdId)).find((t) => t.amount === "-17.35")!.id;
    await categorize(space.householdId, changed, randomUUID());
    expect(await balance(space)).toBe("190.65");
    nowMs = start + 2 * DAY;
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback).toMatchObject({ counts: { rolledBack: 2, kept: 1 }, kept: [changed] });
    expect(await balance(space)).toBe("-17.35");
    expect(await journal(space.householdId)).toEqual({ entries: 5, reversals: 2 });
  });

  it("IMP-16@PoC FR 4: «Відкотити все» rolls back the changed ones too; a note of the person's own also counts as a change", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(4));
    const all = await transactions(space.householdId);
    await categorize(space.householdId, all[0]!.id, randomUUID());
    await db.owner.query(
      `UPDATE transactions.transactions SET note = 'Подарунок' WHERE household_id = $1 AND id = $2`,
      [space.householdId, all[1]!.id],
    );
    const res = await rollback(space, batchId, "all");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback).toMatchObject({ mode: "all", counts: { rolledBack: 4, kept: 0 }, kept: [] });
    expect(await balance(space)).toBe("0.00");
  });
});

describe("IMP-16@PoC FR 5: what was merged into the batch's transactions comes back", () => {
  it("IMP-16@PoC FR 5: a manual −42,00 merged on apply comes back with its category, note and own journal event; the balance counts it once", async () => {
    nowMs = start;
    const space = await newSpace();
    const manualId = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                              description, note)
       VALUES ($1, $2, $3, $4, -42.00, 'EUR', '2026-04-10', 'Обід', 'Обід з колегами')`,
      [space.householdId, manualId, space.eur, space.subaccountId],
    );
    await ledger.post(space.householdId, {
      source: { module: "transactions", id: manualId },
      idempotencyKey: `transactions.create:${manualId}`,
      operationDate: "2026-04-10",
      event: { type: "transaction", account: space.ledgerAccountId, amount: Money.of("-42.00", "EUR") },
    });
    const categoryId = randomUUID();
    await categorize(space.householdId, manualId, categoryId);
    const batchId = await applied(space, "kviten.csv", [
      { date: "11.04.2026", amount: "-42.00", description: "CAFE CENTRAL" },
      { date: "20.04.2026", amount: "10.00", description: "REFUND" },
    ]);
    // Merged on apply: the bank's row carries the manual one's category (not a change of the person's).
    expect(await balance(space)).toBe("-32.00");
    expect((await transactions(space.householdId)).find((t) => t.id === manualId)).toMatchObject({
      hidden: true,
    });

    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback.counts).toEqual({ rolledBack: 2, kept: 0, transfers: 0, restored: 1 });
    expect((await transactions(space.householdId)).find((t) => t.id === manualId)).toMatchObject({
      hidden: false,
      merged_into: null,
      note: "Обід з колегами",
      rolled_back: false,
    });
    expect(await balance(space)).toBe("-42.00");
    expect(await balance(space)).toBe(new Decimal(await expectedBalance(space.householdId)).toFixed(2));
    const { rows: category } = await db.owner.query<{ category_id: string }>(
      `SELECT category_id FROM categorization.transaction_categories WHERE household_id = $1 AND transaction_id = $2`,
      [space.householdId, manualId],
    );
    expect(category).toEqual([{ category_id: categoryId }]);
  });

  it("IMP-16@PoC FR 5: a pending row the batch's posted one replaced comes back, pending, with no journal event", async () => {
    nowMs = start;
    const space = await newSpace();
    const pendingId = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                              description, status, source, import_batch_id, import_file_id, import_row,
                                              bank_description, review)
       VALUES ($1, $2, $3, $4, -30.00, 'EUR', '2026-04-08', 'HOLD SHOP', 'pending', 'imported', $5, $6, 3, 'HOLD SHOP', 'queued')`,
      [space.householdId, pendingId, space.eur, space.subaccountId, randomUUID(), randomUUID()],
    );
    const batchId = await applied(space, "kviten.csv", [
      { date: "11.04.2026", amount: "-30.10", description: "SHOP" },
      { date: "20.04.2026", amount: "10.00", description: "REFUND" },
    ]);
    expect((await transactions(space.householdId)).find((t) => t.id === pendingId)).toMatchObject({
      hidden: true,
    });
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback.counts).toMatchObject({ rolledBack: 2, restored: 1 });
    expect((await transactions(space.householdId)).find((t) => t.id === pendingId)).toMatchObject({
      status: "pending",
      hidden: false,
      merged_into: null,
      rolled_back: false,
    });
    expect(await balance(space)).toBe("0.00");
  });
});

describe("IMP-16@PoC FR 1, FR 3: 7 days, once", () => {
  it("IMP-04@PoC AC8, IMP-16@PoC AC4: applied 8 days ago — no «Відкотити» in the batch, the request refused with «Строк відкату минув», nothing changed", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const read = await call(space, "GET", `/v1/import/batches/${batchId}`);
    expect(read.json().rollbackUntil).toBe(new Date(start + 7 * DAY).toISOString());
    nowMs = start + 8 * DAY;
    // AC4: the batch says until when; past it the client shows no «Відкотити».
    expect(Date.parse(read.json().rollbackUntil)).toBeLessThan(nowMs);
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("IMPORT_ROLLBACK_EXPIRED");
    expect(await balance(space)).toBe("-60.00");
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("applied");
  });

  it("IMP-16@PoC FR 3: rolled back again, and twice at once — the stored result, no second reversal", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(5));
    const [a, b] = await Promise.all([rollback(space, batchId), rollback(space, batchId)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    expect([a.json().first, b.json().first].sort()).toEqual([false, true]);
    expect(a.json().rollback.counts).toEqual(b.json().rollback.counts);
    const third = await rollback(space, batchId, "all");
    expect(third.json()).toMatchObject({ first: false, rollback: { mode: "keep-changed" } });
    expect(await journal(space.householdId)).toEqual({ entries: 10, reversals: 5 });
    expect(await balance(space)).toBe("0.00");
  });

  it("IMP-16@PoC FR 3: a crash after module transactions rolled the batch back — the next «Відкотити» finishes it, past the 7 days too, nothing reversed twice", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    // Step B alone (the request ended before step C): the transactions are rolled back, the batch still «застосовано».
    const transactionsPort = createImportedTransactions(db.databases.for("transactions"), {
      accounts,
      ledger,
      audit,
      newId: randomUUID,
      now: clock.now,
      categories: createTransactionCategoryRead(db.databases.for("categorization")),
    });
    const done = await transactionsPort.rollback(space.householdId, {
      batchId,
      actorId: space.accountId,
      accountIds: [space.eur],
      mode: "keep-changed",
    });
    expect(done).toMatchObject({ first: true, counts: { rolledBack: 2 } });
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("applied");
    nowMs = start + 8 * DAY;
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      batch: { state: "rolled-back" },
      rollback: { counts: { rolledBack: 2 } },
    });
    expect(await journal(space.householdId)).toEqual({ entries: 4, reversals: 2 });
    expect(await balance(space)).toBe("0.00");
  });

  it("IMP-16@PoC FR 1: the account is closed — refused (ACCOUNT_CLOSED), nothing changed", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const key = `${space.householdId}/${space.eur}`;
    accountsOf.set(key, { ...accountsOf.get(key)!, status: "closed" });
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_CLOSED");
    expect(await balance(space)).toBe("-60.00");
    expect((await transactions(space.householdId)).some((t) => t.rolled_back)).toBe(false);
  });

  it("IMP-16@PoC FR 1: a batch that is not applied cannot be rolled back (409), nothing changed", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await parsedBatch(space, "kviten.csv", statement(purchases(2)));
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("BATCH_STATE_CONFLICT");
  });
});

describe("IMP-04@PoC FR 10, IMP-16@PoC FR 9: the rollback in the audit log", () => {
  it("IMP-16@PoC FR 9: who, the state and how many rolled back, kept and restored; each transaction's reversal is its own entry", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(3));
    expect((await rollback(space, batchId)).statusCode).toBe(200);
    const { rows: entries } = await db.owner.query<{
      actor_id: string;
      changes: { field: string; after: string | null }[];
    }>(
      `SELECT actor_id, changes FROM audit.entries
        WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2`,
      [space.householdId, batchId],
    );
    const changes = entries.flatMap((e) => e.changes);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "state", after: "rolled-back" }),
        expect.objectContaining({ field: "rollback.mode", after: "keep-changed" }),
        expect.objectContaining({ field: "rollback.rolledBack", after: "3" }),
        expect.objectContaining({ field: "rollback.kept", after: "0" }),
        expect.objectContaining({ field: "rollback.restored", after: "0" }),
      ]),
    );
    expect(entries.every((e) => e.actor_id === space.accountId)).toBe(true);
    const { rows: own } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.entries WHERE household_id = $1 AND dedupe_key LIKE 'transactions.rollback:%'`,
      [space.householdId],
    );
    expect(own[0]!.n).toBe(3);
  });
});

describe("IMP-04@PoC AC12, IMP-16@PoC AC5: another space", () => {
  it("IMP-04@PoC AC12, IMP-16@PoC AC5: a rollback from a user outside the space — «not found», no records, counts or sums; nothing changed", async () => {
    nowMs = start;
    const space = await newSpace();
    const stranger = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const res = await rollback(stranger, batchId);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(res.body).not.toContain("rollback");
    expect(res.body).not.toContain("-60");
    expect(await balance(space)).toBe("-60.00");
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("applied");
  });
});

describe("IMP-16@PoC FR 3: the rollback and a new apply on the same account at once", () => {
  it("IMP-16@PoC FR 3: a rollback racing the apply of an overlapping statement — both answer, one after the other under the account's import lock; the journal matches the rows exactly", async () => {
    nowMs = start;
    const space = await newSpace();
    const lines = purchases(4);
    const first = await applied(space, "berezen.csv", lines);
    const second = await parsedBatch(
      space,
      "berezen-kviten.csv",
      statement([...lines, { date: "28.04.2026", amount: "-5.55", description: "LATE" }]),
    );
    const [rolled, apply] = await Promise.all([
      rollback(space, first),
      call(space, "POST", `/v1/import/batches/${second}/apply`),
    ]);
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect(apply.statusCode, apply.body).toBe(200);
    expect(rolled.json().rollback.counts.rolledBack).toBe(4);
    // Whichever went first, every operation the books still hold is in the journal once, never twice.
    expect(await balance(space)).toBe(new Decimal(await expectedBalance(space.householdId)).toFixed(2));
    const counts = apply.json().result.counts as Record<string, number>;
    // The apply after the rollback writes all 5; before it, the 4 shared rows are its duplicates (IMP-16 FR 7 later).
    expect([5, 1]).toContain(counts["import"]);
    expect(await balance(space)).toBe(counts["import"] === 5 ? "-125.55" : "-5.55");
  });
});
