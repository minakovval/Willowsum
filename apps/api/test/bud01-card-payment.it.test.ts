import { randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createTransactionCategoryRead } from "../src/modules/categorization/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import {
  createBudgetTransactions,
  createCashflowMovements,
  createImportedTransactions,
  createTransactionsServices,
  createTransferCandidates,
  createTransferMarking,
} from "../src/modules/transactions/index.ts";
import {
  createCardPaymentTransfers,
  type CardPaymentTransfers,
  createTransferMatchingServices,
} from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-01@PoC FR 7, AC4 (owner, 2026-11-26, decision 2; #722 D), through the real API on a real PostgreSQL: the one
 * exception to «лише пропозиція» — a payment to a credit card from a known own account of the space is a transfer at
 * once, without confirmation: after an import batch's apply and after «Нова транзакція» the pair «списання з рахунку
 * простору — зарахування на кредитну картку простору» gets the transfer mark (category «Переказ»), leaves the budget's
 * expenses and income and «Грошовий потік»'s, and the journal keeps one transfer instead of an expense and an income.
 * A card payment with no own source stays an income; a pair between two current accounts stays a proposal (AC22);
 * another space's account never matches; a repeated import marks nothing again. The accounts module is the test's port
 * (EUR accounts with their journal accounts opened); every name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-20T10:00:00Z");
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
let cardPayments: CardPaymentTransfers;
const accountsOf = new Map<string, PostingAccount>();
const accounts: AccountDirectory = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Transaction {
  id: string;
  type: string;
  transfer: { id: string; side: string; counterpartId: string } | null;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

/** An EUR account of the space — a current account or a credit card — with its journal account opened. */
async function account(space: Space, kind: "current" | "credit-card" = "current"): Promise<string> {
  const id = randomUUID();
  const sub = { subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() };
  accountsOf.set(`${space.householdId}/${id}`, { accountId: id, kind, status: "active", subaccounts: [sub] });
  await ledger.openAccount(
    space.householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: kind === "credit-card" ? "liability" : "asset", currency: "EUR", id: sub.ledgerAccountId },
  );
  return id;
}

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
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

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A clean statement: opening, rows, closing — its figures agree. */
function statement(opening: string, rows: readonly [string, string, string][], closing: string): Buffer {
  return text([
    `Вхідний залишок:;${opening} EUR`,
    "Дата;Сума;Опис",
    ...rows.map((r) => r.join(";")),
    `Кінцевий залишок:;${closing} EUR`,
  ]);
}

interface Part {
  readonly name: string;
  readonly bytes: Buffer;
  readonly account: string;
}

async function upload(space: Space, parts: readonly Part[]) {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const body = Buffer.concat([
    ...parts.map((p) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        p.bytes,
        Buffer.from("\r\n"),
      ]),
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileIds: (res.json().files as { id: string }[]).map((f) => f.id) };
}

async function work(householdId: string): Promise<void> {
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
    households: async () => [householdId],
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
}

/** A batch of these files, each parsed for its account, then applied. */
async function imported(space: Space, parts: readonly Part[]) {
  const batch = await upload(space, parts);
  const started = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: batch.fileIds.map((fileId, i) => ({ fileId, accountId: parts[i]!.account })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  const applied = await call(space, "POST", `/v1/import/batches/${batch.batchId}/apply`);
  expect(applied.statusCode, applied.body).toBe(200);
  return { batchId: batch.batchId, applied };
}

/** −1 200,00 EUR on the current account on the 13th («Погашення картки»). */
const currentFile = (current: string, amount = "1200.00"): Part => ({
  name: "potochnyi.csv",
  account: current,
  bytes: statement(
    "3000.00",
    [["13.10.2026", `-${amount}`, "Погашення картки"]],
    new Decimal("3000").minus(amount).toFixed(2),
  ),
});

/** +1 200,00 EUR on the credit card two days later («Payment received — thank you»). */
const cardFile = (card: string, amount = "1200.00", name = "kartka.csv"): Part => ({
  name,
  account: card,
  bytes: statement(
    "-1500.00",
    [["15.10.2026", amount, "Payment received - thank you"]],
    new Decimal(amount).minus("1500").toFixed(2),
  ),
});

/** The space's transactions of `accountId`, oldest first. */
async function rows(householdId: string, accountId: string) {
  return (
    await db.owner.query<{ id: string; transfer_id: string | null; batch: string | null }>(
      `SELECT id, transfer_id, import_batch_id AS batch FROM transactions.transactions
        WHERE household_id = $1 AND account_id = $2 ORDER BY occurred_on, id`,
      [householdId, accountId],
    )
  ).rows;
}

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const proposals = async (space: Space) =>
  (await call(space, "GET", "/v1/transfer-proposals")).json() as { count: number };

/** The budget's read as main.ts wires it: the counted rows of October (expenses and income; transfers are not). */
const budget = async (householdId: string, accountIds: string[]) =>
  (
    await createBudgetTransactions(db.databases.for("transactions"), {
      feeCategory: async () => null,
    }).inPeriod(householdId, accountIds, "2026-10-01", "2026-10-31")
  ).map((r) => [r.accountId, r.amount.toDecimalString()]);

/** «Грошовий потік»'s transfers of October (BUD-08 FR 5): the marked pairs, never an income or an expense. */
const cashflowTransfers = async (householdId: string) =>
  (
    await createCashflowMovements(db.databases.for("transactions")).transfers(
      householdId,
      "2026-10-01",
      "2026-10-31",
    )
  ).map((t) => [t.outflow.id, t.inflow.id]);

/** What went through «Зовнішні кошти» from the space's transactions (live entries): the income and expenses in effect. */
async function externalFlow(householdId: string): Promise<string | null> {
  const { rows: found } = await db.owner.query<{ net: string | null }>(
    `SELECT sum(p.amount)::text AS net
       FROM ledger.postings p
       JOIN ledger.entries e ON e.household_id = p.household_id AND e.id = p.entry_id
       JOIN ledger.accounts a ON a.household_id = p.household_id AND a.service_kind = 'external-funds'
                             AND a.id IN (p.debit_account_id, p.credit_account_id)
      WHERE p.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)`,
    [householdId],
  );
  return found[0]?.net ?? null;
}

/** The live journal events of the space from the transactions module. */
async function liveEvents(householdId: string): Promise<string[]> {
  const { rows: found } = await db.owner.query<{ event_type: string }>(
    `SELECT e.event_type FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.event_type`,
    [householdId],
  );
  return found.map((r) => r.event_type);
}

beforeAll(async () => {
  db = await setupRealModules(9);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys,
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  // One currency only: no rate is asked.
  const rates = async (requests: readonly unknown[]) => requests.map(() => null);
  cardPayments = createCardPaymentTransfers({
    candidates: createTransferCandidates(db.databases.for("transactions")),
    rates,
    cards: async (householdId, ids) =>
      new Set(ids.filter((id) => accountsOf.get(`${householdId}/${id}`)?.kind === "credit-card")),
    enabled: (householdId) => isEnabled(householdId, "transactions.transfers"),
    mark: (householdId, actor, outflowId, inflowId) =>
      createTransferMarking(db.databases.for("transactions"), {
        accounts,
        ledger,
        audit,
        newId: randomUUID,
        rates,
      }).mark(householdId, actor, outflowId, inflowId),
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({
            rates: {
              rates: async (requests) => requests.map(() => null),
              covers: () => true,
              staleForToday: () => false,
            },
            now: clock.now,
          }),
          audit,
          clock,
          newId: randomUUID,
          flags: { isEnabled },
          rates,
          duplicates: createDuplicateCheck(),
          cardPayments,
        }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates,
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
              categories: createTransactionCategoryRead(db.databases.for("categorization")),
            }),
            cardPayments,
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

beforeEach(() => off.clear());

describe("BUD-01@PoC FR 7: a payment to a credit card from a known own account is a transfer at once", () => {
  it("BUD-01@PoC AC4: −1 200 € on the current account and +1 200 € on the card of the space 2 days later — both «Переказ» at once, without confirmation; out of the budget's expenses and income, «Грошовий потік» and the journal's income and expenses", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    await imported(space, [currentFile(current), cardFile(card)]);
    const [out] = await rows(space.householdId, current);
    const [into] = await rows(space.householdId, card);
    // Both sides carry one transfer mark — category «Переказ» — with nothing confirmed by the person.
    expect(out!.transfer_id).not.toBeNull();
    expect(into!.transfer_id).toBe(out!.transfer_id);
    expect([await get(space, out!.id), await get(space, into!.id)]).toMatchObject([
      { transfer: { side: "outflow", counterpartId: into!.id } },
      { transfer: { side: "inflow", counterpartId: out!.id } },
    ]);
    expect((await proposals(space)).count).toBe(0);
    // Budget («Можна витратити» counts these rows): neither an expense nor an income.
    expect(await budget(space.householdId, [current, card])).toEqual([]);
    // «Грошовий потік»: a transfer between own accounts, not income or expenses.
    expect(await cashflowTransfers(space.householdId)).toEqual([[out!.id, into!.id]]);
    // The journal: one transfer between the two accounts, nothing through «Зовнішні кошти».
    expect(await liveEvents(space.householdId)).toEqual(["transfer"]);
    expect(await externalFlow(space.householdId)).toBeNull();
  });

  it("BUD-01@PoC FR 7: the payment is marked at once also when its two sides come in two imports — the card's statement first, the current account's later", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    await imported(space, [cardFile(card)]);
    const [into] = await rows(space.householdId, card);
    // Until its source arrives the card's credit is an income (the source unknown).
    expect(into!.transfer_id).toBeNull();
    expect(await budget(space.householdId, [card])).toEqual([[card, "1200"]]);
    await imported(space, [currentFile(current)]);
    const [out] = await rows(space.householdId, current);
    expect((await rows(space.householdId, card))[0]!.transfer_id).toBe(out!.transfer_id);
    expect(out!.transfer_id).not.toBeNull();
    expect(await budget(space.householdId, [current, card])).toEqual([]);
  });

  it("BUD-01@PoC FR 7: «Нова транзакція» +1 200 € on the card with the debit of the current account in the space — the answer is already a transfer", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    const debit = await call(space, "POST", "/v1/transactions", {
      accountId: current,
      amount: { amount: "-1200.00", currency: "EUR" },
      date: "2026-10-13",
      counterparty: "Погашення картки",
    });
    expect(debit.statusCode, debit.body).toBe(201);
    expect(debit.json().transfer).toBeNull();
    const credit = await call(space, "POST", "/v1/transactions", {
      accountId: card,
      amount: { amount: "1200.00", currency: "EUR" },
      date: "2026-10-15",
      counterparty: "Payment received",
    });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(credit.json()).toMatchObject({
      transfer: { side: "inflow", counterpartId: debit.json().id },
    });
    expect(await budget(space.householdId, [current, card])).toEqual([]);
    expect(await liveEvents(space.householdId)).toEqual(["transfer"]);
  });

  it("BUD-01@PoC FR 7: a payment to the card with no debit of the space that fits it (the source unknown) stays an income until the person confirms a transfer", async () => {
    const space = await newSpace();
    const card = await account(space, "credit-card");
    await imported(space, [cardFile(card, "600.00")]);
    const [into] = await rows(space.householdId, card);
    expect(into!.transfer_id).toBeNull();
    expect(await get(space, into!.id)).toMatchObject({ type: "income", transfer: null });
    expect(await budget(space.householdId, [card])).toEqual([[card, "600"]]);
    // The journal: the card's own event — an income through «Зовнішні кошти».
    expect(await liveEvents(space.householdId)).toEqual(["transaction"]);
    expect(await externalFlow(space.householdId)).not.toBeNull();
  });

  it("BUD-01@PoC FR 7: a pair between two current accounts is not the exception — it stays a proposal in «Пари» (AC22)", async () => {
    const space = await newSpace();
    const current = await account(space);
    const savings = await account(space);
    await imported(space, [currentFile(current), cardFile(savings)]);
    expect((await rows(space.householdId, current))[0]!.transfer_id).toBeNull();
    expect((await rows(space.householdId, savings))[0]!.transfer_id).toBeNull();
    expect((await proposals(space)).count).toBe(1);
  });

  it("BUD-01@PoC FR 7: a debit that fits payments to two cards is ambiguous — both stay proposals for the person", async () => {
    const space = await newSpace();
    const current = await account(space);
    const one = await account(space, "credit-card");
    const two = await account(space, "credit-card");
    await imported(space, [currentFile(current), cardFile(one), cardFile(two, "1200.00", "kartka-2.csv")]);
    for (const id of [current, one, two])
      expect((await rows(space.householdId, id))[0]!.transfer_id).toBeNull();
    expect((await proposals(space)).count).toBe(2);
  });

  it("BUD-01@PoC FR 7: while transfers (`transactions.transfers`) are off for the space, nothing is marked", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    off.add("transactions.transfers");
    await imported(space, [currentFile(current), cardFile(card)]);
    expect((await rows(space.householdId, card))[0]!.transfer_id).toBeNull();
  });
});

describe("BUD-01@PoC FR 7: the card payment's mark is idempotent and stays in its space", () => {
  it("BUD-01@PoC FR 7: the same statements imported again and the apply repeated mark nothing again — one transfer, the journal unchanged", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    const first = await imported(space, [currentFile(current), cardFile(card)]);
    const transferId = (await rows(space.householdId, card))[0]!.transfer_id;
    const events = await liveEvents(space.householdId);
    // The apply of the same batch again: the stored result, nothing written or marked.
    const again = await call(space, "POST", `/v1/import/batches/${first.batchId}/apply`);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().first).toBe(false);
    // The same files in a new batch: «уже імпортовано», no new transaction, no second transfer.
    const second = await imported(space, [currentFile(current), cardFile(card)]);
    expect(second.applied.json().result.counts).toMatchObject({ import: 0 });
    expect(await rows(space.householdId, current)).toHaveLength(1);
    expect(await rows(space.householdId, card)).toEqual([
      expect.objectContaining({ transfer_id: transferId }),
    ]);
    const { rows: transfers } = await db.owner.query(
      `SELECT id FROM transactions.transfers WHERE household_id = $1`,
      [space.householdId],
    );
    expect(transfers).toHaveLength(1);
    expect(await liveEvents(space.householdId)).toEqual(events);
  });

  it("BUD-01@PoC FR 7: a card payment the person unmarked (FIN-03 FR 9) is not marked again by a later import of something else", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    await imported(space, [currentFile(current), cardFile(card)]);
    const [into] = await rows(space.householdId, card);
    const unmarked = await call(space, "DELETE", `/v1/transactions/${into!.id}/transfer`);
    expect(unmarked.statusCode, unmarked.body).toBe(200);
    const other = await account(space);
    await imported(space, [
      {
        name: "inshyi.csv",
        account: other,
        bytes: statement("10.00", [["16.10.2026", "5.00", "Кешбек"]], "15.00"),
      },
    ]);
    expect((await rows(space.householdId, card))[0]!.transfer_id).toBeNull();
    expect((await proposals(space)).count).toBe(1);
  });

  it("BUD-01@PoC FR 7: two runs at once on the same card payment (two requests, or the mark and «Підтвердити») — one transfer, one journal event", async () => {
    const space = await newSpace();
    const current = await account(space);
    const card = await account(space, "credit-card");
    off.add("transactions.transfers");
    await imported(space, [currentFile(current), cardFile(card)]);
    off.clear();
    const [out] = await rows(space.householdId, current);
    const [into] = await rows(space.householdId, card);
    const fresh = { transactionIds: [into!.id] };
    const [one, two, confirmed] = await Promise.all([
      cardPayments.markFor(space.householdId, space.accountId, fresh),
      cardPayments.markFor(space.householdId, space.accountId, fresh),
      call(space, "POST", `/v1/transactions/${out!.id}/transfer`, { counterpartId: into!.id }),
    ]);
    // The confirm that lost is refused as a request on a pair taken, never a server error.
    expect([200, 400, 409], confirmed.body).toContain(confirmed.statusCode);
    // Exactly one of the three made the mark; the others found the pair taken and changed nothing.
    expect(one + two + (confirmed.statusCode === 200 ? 1 : 0)).toBe(1);
    const { rows: transfers } = await db.owner.query(
      `SELECT id FROM transactions.transfers WHERE household_id = $1`,
      [space.householdId],
    );
    expect(transfers).toHaveLength(1);
    expect((await rows(space.householdId, card))[0]!.transfer_id).toBe(transfers[0]!.id);
    expect(await liveEvents(space.householdId)).toEqual(["transfer"]);
  });

  it("BUD-01@PoC FR 7: another space's account never matches — a debit in one space and a card's credit in another stay an expense and an income, and nothing of one shows in the other", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const current = await account(a);
    const card = await account(b, "credit-card");
    await imported(a, [currentFile(current)]);
    const applied = await imported(b, [cardFile(card)]);
    const [out] = await rows(a.householdId, current);
    const [into] = await rows(b.householdId, card);
    expect(out!.transfer_id).toBeNull();
    expect(into!.transfer_id).toBeNull();
    expect(await budget(b.householdId, [card])).toEqual([[card, "1200"]]);
    expect((await proposals(b)).count).toBe(0);
    // Space B reads nothing of space A: not its debit, not its account.
    const res = await call(b, "GET", `/v1/transactions/${out!.id}`);
    expect(res.statusCode).toBe(404);
    for (const secret of [out!.id, current, "Погашення картки"]) {
      expect(leakText(res.body)).not.toContain(secret);
      expect(leakText(applied.applied.body)).not.toContain(secret);
    }
  });
});
