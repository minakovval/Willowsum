import { randomBytes, randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
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
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import {
  createImportedTransactions,
  createTransactionsServices,
  createTransactionsWorkerQueue,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-02@PoC FR 5, AC11 (#698 owner report) on a real PostgreSQL through the real API, the real parse worker, the
 * transactions hand-off and the journal: a monobank card statement whose rows carry the bank's commission is applied
 * whole — no row refused for its fee — each such row is one transaction with the bank's fee beside its amount and one
 * journal entry with a main leg and a fee leg, and the account ends where the file's «Залишок після операції» does.
 * Synthetic merchants and amounts; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
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
  readonly account: string;
}

const households = new Set<string>();

async function newSpace(currency: string): Promise<Space & { readonly ledgerAccountId: string }> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const account = randomUUID();
  const sub = { subaccountId: randomUUID(), currency, ledgerAccountId: randomUUID() };
  accountsOf.set(`${householdId}/${account}`, {
    accountId: account,
    kind: "current",
    status: "active",
    subaccounts: [sub],
  });
  await ledger.openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency, id: sub.ledgerAccountId },
  );
  households.add(householdId);
  return { accountId, householdId, account, ledgerAccountId: sub.ledgerAccountId };
}

function call(space: Space, method: "GET" | "POST" | "PATCH", url: string, body?: unknown, scoped = false) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({
        userId: space.accountId,
        householdId: space.householdId,
        ...(scoped ? { role: "editor", scoped: true } : {}),
      }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function parsed(
  space: Space,
  name: string,
  bytes: Buffer,
): Promise<{ batchId: string; fileId: string }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const uploaded = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const fileId = (uploaded.json().files as { id: string }[])[0]!.id;
  const started = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
    files: [{ fileId, accountId: space.account }],
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
  return { batchId, fileId };
}

const apply = (space: Space, batchId: string) => call(space, "POST", `/v1/import/batches/${batchId}/apply`);

async function applied(space: Space, name: string, bytes: Buffer) {
  const batch = await parsed(space, name, bytes);
  const res = await apply(space, batch.batchId);
  expect(res.statusCode, res.body).toBe(200);
  await handedOff();
  return { ...batch, result: res.json().result as { counts: Record<string, number> } };
}

/** Runs the transactions hand-off jobs: the journal follows the rows. */
async function handedOff() {
  const worker = createWorker({
    queues: [createTransactionsWorkerQueue(db.databases.for("transactions"), { accounts, ledger, audit })],
    households: async () => [...households],
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

/** The space's listed transactions, oldest first. */
async function listed(space: Space) {
  const res = await call(space, "GET", "/v1/transactions?sort=date");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as Record<string, unknown>[];
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

const HEADER =
  '"Дата i час операції","Деталі операції",MCC,"Сума в валюті картки (UAH)","Сума в валюті операції",Валюта,Курс,"Сума комісій (UAH)","Сума кешбеку (UAH)","Залишок після операції"';
/** Newest first, as the bank prints it; two operations of one moment printed out of the chain's order. Opening 50 000,00. */
const MONO_FEES = Buffer.from(
  "﻿" +
    [
      HEADER,
      '"16.11.2026 18:00:00","Банкомат Синтетик",6011,-2020.00,-2000.00,UAH,—,20.00,—,62994.00',
      '"15.11.2026 09:00:00","Кав\'ярня Тест",5814,-50.00,-50.00,UAH,—,—,—,65044.00',
      '"15.11.2026 09:00:00","Пекарня Тест",5462,-30.00,-30.00,UAH,—,—,—,65014.00',
      '"15.11.2026 08:30:00","SYNTH SHOP EU",5999,-4641.00,-100.00,EUR,45.5000,91.00,—,65094.00',
      '"14.11.2026 12:00:00","Переказ на картку",4829,-10265.00,-10265.00,UAH,—,265.00,—,69735.00',
      '"13.11.2026 10:00:00","Зарплата Синтетик",4829,30000.00,30000.00,UAH,—,—,—,80000.00',
    ].join("\r\n") +
    "\r\n",
  "utf8",
);
const OPENING = "50000";
const CLOSING = "62994";

const entryOf = async (space: { householdId: string }, transactionId: string) =>
  (
    await ledger.liveEntries(space.householdId, { module: "transactions", id: transactionId }, "transaction")
  )[0]!;
const legs = (entry: Awaited<ReturnType<typeof entryOf>>) =>
  entry.legs.map((l) => [l.kind, l.amount.toDecimalString()]);

describe("IMP-02@PoC FR 5: a monobank statement with commissions is applied whole (#698)", () => {
  it("IMP-02@PoC AC11: every row is written — the fee rows with the bank's fee and a main and a fee leg; the account ends at the file's closing balance", async () => {
    const space = await newSpace("UAH");
    const { result } = await applied(space, "mono-lystopad.csv", MONO_FEES);
    expect(result.counts).toMatchObject({ import: 6 });
    const items = await listed(space);
    expect(items).toHaveLength(6);
    const by = (text: string) => items.find((t) => t["bankDescription"] === text)!;
    expect(by("Банкомат Синтетик")).toMatchObject({
      amount: { amount: "-2020", currency: "UAH" },
      bankFee: { amount: "20", currency: "UAH" },
      balanceAfter: { amount: "62994", currency: "UAH" },
    });
    expect(by("SYNTH SHOP EU")).toMatchObject({
      amount: { amount: "-4641", currency: "UAH" },
      bankFee: { amount: "91", currency: "UAH" },
      originalAmount: { amount: "-100", currency: "EUR" },
      exchangeRate: "45.5",
    });
    expect(by("Кав'ярня Тест")).toMatchObject({ bankFee: null });
    // The fee is a leg of its own: main = card amount less the fee, the fee charged from the account.
    expect(legs(await entryOf(space, String(by("Банкомат Синтетик")["id"])))).toEqual([
      ["main", "-2000"],
      ["fee", "20"],
    ]);
    expect(legs(await entryOf(space, String(by("Переказ на картку")["id"])))).toEqual([
      ["main", "-10000"],
      ["fee", "265"],
    ]);
    expect(legs(await entryOf(space, String(by("Кав'ярня Тест")["id"])))).toEqual([]);
    // Opening + the card amounts = the file's closing balance.
    const balance = await ledger.balanceAt(space.householdId, space.ledgerAccountId, "2026-12-31");
    expect(balance.plus(Money.of(OPENING, "UAH")).equals(Money.of(CLOSING, "UAH"))).toBe(true);
    // Stored exactly (numeric), never a float.
    const { rows } = await db.owner.query<{ fee: string | null }>(
      `SELECT trim_scale(bank_fee)::text AS fee FROM transactions.transactions WHERE household_id = $1 ORDER BY import_row`,
      [space.householdId],
    );
    expect(rows.map((r) => r.fee).sort()).toEqual(["20", "265", "91", null, null, null].sort());
  });

  it("IMP-02@PoC FR 5: an edit of a fee row's amount keeps the fee leg and moves the account by the new amount; an amount of the fee alone is one plain posting", async () => {
    const space = await newSpace("UAH");
    await applied(space, "mono-lystopad.csv", MONO_FEES);
    const atm = (await listed(space)).find((t) => t["bankDescription"] === "Банкомат Синтетик")!;
    const edited = await call(space, "PATCH", `/v1/transactions/${String(atm["id"])}`, {
      amount: { amount: "-1020.00", currency: "UAH" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    await handedOff();
    expect(legs(await entryOf(space, String(atm["id"])))).toEqual([
      ["main", "-1000"],
      ["fee", "20"],
    ]);
    const balance = await ledger.balanceAt(space.householdId, space.ledgerAccountId, "2026-12-31");
    expect(balance.plus(Money.of(OPENING, "UAH")).equals(Money.of("63994", "UAH"))).toBe(true);
    // An amount set to the fee itself leaves no operation beside it: the entry is the amount alone.
    const again = await call(space, "PATCH", `/v1/transactions/${String(atm["id"])}`, {
      amount: { amount: "-20.00", currency: "UAH" },
    });
    expect(again.statusCode, again.body).toBe(200);
    await handedOff();
    expect(legs(await entryOf(space, String(atm["id"])))).toEqual([]);
    const after = await ledger.balanceAt(space.householdId, space.ledgerAccountId, "2026-12-31");
    expect(after.plus(Money.of(OPENING, "UAH")).equals(Money.of("64994", "UAH"))).toBe(true);
  });

  it("IMP-02@PoC FR 5: the same batch applied twice at once writes each fee row and its fee once", async () => {
    const space = await newSpace("UAH");
    const { batchId } = await parsed(space, "mono-lystopad.csv", MONO_FEES);
    const [a, b] = await Promise.all([apply(space, batchId), apply(space, batchId)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json().result).toEqual(b.json().result);
    await handedOff();
    expect(await listed(space)).toHaveLength(6);
    const balance = await ledger.balanceAt(space.householdId, space.ledgerAccountId, "2026-12-31");
    expect(balance.plus(Money.of(OPENING, "UAH")).equals(Money.of(CLOSING, "UAH"))).toBe(true);
  });

  it("IMP-02@PoC FR 5: another space never sees the bank's fee — the transaction is «not found»", async () => {
    const owner = await newSpace("UAH");
    await applied(owner, "mono-lystopad.csv", MONO_FEES);
    const atm = (await listed(owner)).find((t) => t["bankDescription"] === "Банкомат Синтетик")!;
    const other = await newSpace("UAH");
    const res = await call(other, "GET", `/v1/transactions/${String(atm["id"])}`);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain("Банкомат");
    expect(await listed(other)).toEqual([]);
  });
});
