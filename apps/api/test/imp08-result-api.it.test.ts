import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createTransactionCategories,
  createTransactionCategoryRead,
} from "../src/modules/categorization/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import {
  createImportBatchTransactions,
  createImportedTransactions,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import {
  IMPORT_BATCH_TRANSACTIONS_SQL,
  importBatchTransactionsParams,
} from "../src/modules/transactions/adapters/db/import-batch-reads.ts";
import { createImportBatchProposals } from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * The wizard's step «Результат» (IMP-08@PoC FR 11, FR 12, AC7; plan row 138, the server part) on a real PostgreSQL
 * through the real API, the real parse worker, the apply, and modules transactions, categorization and
 * transfer-matching through their public interfaces: `GET /v1/import/batches/{batchId}/result` gives the stored result
 * of the apply again (the step is reopened) and what is left after it — the proposals of transfers with a side of this
 * batch, the batch's transactions without a category, the card payments recorded as transfers — as the space is now,
 * never another batch's. Another space's batch and a scoped member are «not found». The accounts module is the test's
 * port (EUR accounts). Synthetic data only; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
/** Calls of the result's module ports (transactions, categorization, transfer-matching) so far. */
let portCalls = 0;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  /** Four EUR accounts: current, savings and two more for a second batch. */
  readonly eur: readonly [string, string, string, string];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const eur = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  for (const id of eur)
    accountsOf.set(`${householdId}/${id}`, {
      accountId: id,
      kind: "current",
      status: "active",
      subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
    });
  return { accountId, householdId, eur };
}

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown, scoped = false) {
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

async function upload(space: Space, parts: readonly { name: string; bytes: Buffer }[]) {
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

/** A batch of these files, each parsed for its account. */
async function parsedBatch(space: Space, parts: readonly { name: string; bytes: Buffer; account: string }[]) {
  const batch = await upload(space, parts);
  const started = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: batch.fileIds.map((fileId, i) => ({ fileId, accountId: parts[i]!.account })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return batch;
}

const apply = (space: Space, batchId: string) => call(space, "POST", `/v1/import/batches/${batchId}/apply`);
const result = (space: Space, batchId: string, scoped = false) =>
  call(space, "GET", `/v1/import/batches/${batchId}/result`, undefined, scoped);

/**
 * Batch 1: the current account pays 60,00 to the savings account (−60,00 on the 20th, +60,00 on the 21st: one proposal
 * of a transfer), and a salary of 500,00 comes in. Three transactions of the batch, none with a category.
 */
async function appliedPair(space: Space, a = space.eur[0], b = space.eur[1], move = 60) {
  const salary = "500.00";
  const opening = "1000.00";
  const closing = (1000 + 500 - move).toFixed(2);
  const batch = await parsedBatch(space, [
    {
      name: "potochnyi.csv",
      account: a,
      bytes: statement(
        opening,
        [
          ["15.03.2026", salary, "Зарплата ТОВ «Вигадка»"],
          ["20.03.2026", `-${move}.00`, "На ощадний"],
        ],
        closing,
      ),
    },
    {
      name: "oshchadnyi.csv",
      account: b,
      bytes: statement("100.00", [["21.03.2026", `${move}.00`, "Поповнення"]], `${100 + move}.00`),
    },
  ]);
  const applied = await apply(space, batch.batchId);
  expect(applied.statusCode, applied.body).toBe(200);
  return { ...batch, applied: applied.json() as { result: unknown; appliedAt: string } };
}

const batchTransactions = async (householdId: string, batchId: string) =>
  (
    await db.owner.query<{ id: string; amount: string }>(
      `SELECT id, trim_scale(amount)::text AS amount FROM transactions.transactions
        WHERE household_id = $1 AND import_batch_id = $2 ORDER BY import_file_id, import_row`,
      [householdId, batchId],
    )
  ).rows;

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
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
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: { recipes: createImportRecipesReader(db.databases.for("import-recipes")), accounts, keys },
          apply: {
            transactions: createImportedTransactions(db.databases.for("transactions"), {
              accounts,
              ledger: createLedger(db.databases.for("ledger")),
              audit,
              newId: randomUUID,
              now: clock.now,
              // IMP-16 FR 4: the rollback reads the categories set by hand.
              categories: createTransactionCategoryRead(db.databases.for("categorization")),
            }),
          },
          result: ((): NonNullable<Parameters<typeof createImportSessionsServices>[0]["result"]> => {
            const transactions = createImportBatchTransactions(db.databases.for("transactions"));
            const categories = createTransactionCategories(db.databases.for("categorization"));
            // One currency only in these batches: no rate is asked.
            const proposals = createImportBatchProposals({
              candidates: createTransferCandidates(db.databases.for("transactions")),
              rates: async (requests) => requests.map(() => null),
            });
            // Every call of a module port is counted: a refused read reaches none (П-5).
            return {
              transactions: { page: (h, q) => (portCalls++, transactions.page(h, q)) },
              categories: { categoriesOf: (h, ids) => (portCalls++, categories.categoriesOf(h, ids)) },
              proposals: { countFor: (h, b) => (portCalls++, proposals.countFor(h, b)) },
            };
          })(),
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

describe("IMP-08@PoC FR 11: the step «Результат» reads the apply's result and what is left after it", () => {
  it("IMP-08@PoC AC7: an applied batch with a proposal of a transfer and transactions without a category — the stored counts, «1 пара переказів», «3 без категорії», no confirm action in it", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const res = await result(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      batch: expect.objectContaining({ id: batch.batchId, state: "applied" }),
      // The same stored counts as the apply's response: created, replaced, skipped rows.
      result: batch.applied.result,
      appliedAt: batch.applied.appliedAt,
      followUp: {
        cardPaymentTransfers: 0,
        transferProposals: { count: 1, more: false },
        uncategorized: 3,
      },
    });
    expect(body.result.counts).toMatchObject({ import: 3, replace: 0, duplicate: 0, files: 2 });
    // FR 12: only counts — no pair, no transaction, no amount, no text of a row in the step.
    expect(leakText(res.body)).not.toContain("Зарплата");
    expect(leakText(res.body)).not.toContain("60.00");
    for (const t of await batchTransactions(space.householdId, batch.batchId))
      expect(leakText(res.body)).not.toContain(t.id);
  });

  it("IMP-08@PoC FR 11: «без категорії» counts only the batch's transactions without one, as they are now; a confirmed transfer leaves both counts", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const [salary, out, inflow] = await batchTransactions(space.householdId, batch.batchId);
    // The salary gets a category (module categorization's own row, as the person's «Змінити категорію» leaves it).
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, gen_random_uuid(), 'manual')`,
      [space.householdId, salary!.id],
    );
    let res = await result(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().followUp).toMatchObject({ uncategorized: 2, transferProposals: { count: 1 } });

    // The pair confirmed («Підтвердити» on «Пари»): a transfer is no proposal and its sides ask no category.
    const transferId = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transfers (household_id, id, outflow_id, inflow_id) VALUES ($1, $2, $3, $4)`,
      [space.householdId, transferId, out!.id, inflow!.id],
    );
    await db.owner.query(
      `UPDATE transactions.transactions SET transfer_id = $2 WHERE household_id = $1 AND id = ANY($3::uuid[])`,
      [space.householdId, transferId, [out!.id, inflow!.id]],
    );
    res = await result(space, batch.batchId);
    expect(res.json().followUp).toEqual({
      cardPaymentTransfers: 0,
      transferProposals: { count: 0, more: false },
      uncategorized: 0,
    });
  });

  it("IMP-08@PoC FR 11: a hidden transaction of the batch asks no category", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const [salary] = await batchTransactions(space.householdId, batch.batchId);
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, salary!.id],
    );
    const res = await result(space, batch.batchId);
    expect(res.json().followUp.uncategorized).toBe(2);
  });

  it("IMP-08@PoC FR 11, FR 12: the counts are the batch's own — another batch of the space with its own pair is not in them", async () => {
    const space = await newSpace();
    const first = await appliedPair(space);
    // Another amount: no side of one batch pairs with a side of the other.
    const second = await appliedPair(space, space.eur[2], space.eur[3], 75);
    const one = await result(space, first.batchId);
    const two = await result(space, second.batchId);
    expect(one.json().followUp).toMatchObject({ transferProposals: { count: 1 }, uncategorized: 3 });
    expect(two.json().followUp).toMatchObject({ transferProposals: { count: 1 }, uncategorized: 3 });
    expect(one.json().result).toEqual(first.applied.result);
    expect(two.json().result).toEqual(second.applied.result);
  });

  it("IMP-08@PoC FR 1, AC8: the step reopened by its address gives the same result again and writes nothing", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const a = await result(space, batch.batchId);
    const b = await result(space, batch.batchId);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(await batchTransactions(space.householdId, batch.batchId)).toHaveLength(3);
  });

  it("IMP-08@PoC FR 11: a batch not applied has no result — 409 BATCH_STATE_CONFLICT", async () => {
    const space = await newSpace();
    const batch = await parsedBatch(space, [
      {
        name: "potochnyi.csv",
        account: space.eur[0],
        bytes: statement("1000.00", [["15.03.2026", "500.00", "Зарплата"]], "1500.00"),
      },
    ]);
    const res = await result(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: "BATCH_STATE_CONFLICT" });
  });
});

describe("IMP-08@PoC FR 11: a batch rolled back or still being applied (#673)", () => {
  it("IMP-08@PoC FR 11: a rolled-back batch is shown «відкочено» — the record of its apply, no follow-up counts, no module asked", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const rolled = await call(space, "POST", `/v1/import/batches/${batch.batchId}/rollback`, {});
    expect(rolled.statusCode, rolled.body).toBe(200);
    const before = portCalls;
    const res = await result(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      batch: expect.objectContaining({ id: batch.batchId, state: "rolled-back", rollbackUntil: null }),
      result: batch.applied.result,
      appliedAt: batch.applied.appliedAt,
      followUp: null,
    });
    expect(portCalls).toBe(before);
  });

  it("IMP-08@PoC FR 11: an apply still «in progress» has no result yet — 409 BATCH_STATE_CONFLICT, no module asked", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    // The state a request that ended between the apply's steps leaves (apply.ts step A done, C not yet).
    await db.owner.query(
      `UPDATE import_sessions.batch_applications SET in_progress = true WHERE household_id = $1 AND batch_id = $2`,
      [space.householdId, batch.batchId],
    );
    const before = portCalls;
    const res = await result(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: "BATCH_STATE_CONFLICT" });
    expect(leakText(res.body)).not.toContain("followUp");
    expect(portCalls).toBe(before);
  });
});

describe("IMP-08@PoC FR 11: scope of the result (П-5)", () => {
  it("IMP-08@PoC FR 11: another space's batch is «not found» — no counts of it", async () => {
    const owner = await newSpace();
    const other = await newSpace();
    const batch = await appliedPair(owner);
    const before = portCalls;
    const res = await result(other, batch.batchId);
    expect(res.statusCode, res.body).toBe(404);
    expect(leakText(res.body)).not.toContain("followUp");
    expect(leakText(res.body)).not.toContain("counts");
    const unknown = await result(owner, randomUUID());
    expect(unknown.statusCode).toBe(404);
    // No module is asked about a batch the caller may not see.
    expect(portCalls).toBe(before);
  });

  it("IMP-08@PoC FR 11: a scoped member sees no batch — 404, no counts", async () => {
    const space = await newSpace();
    const batch = await appliedPair(space);
    const before = portCalls;
    const res = await result(space, batch.batchId, true);
    expect(res.statusCode, res.body).toBe(404);
    expect(leakText(res.body)).not.toContain("followUp");
    expect(portCalls).toBe(before);
  });
});

describe("IMP-08@PoC FR 11: the read of the batch's transactions is bounded and indexed", () => {
  it("IMP-08@PoC FR 11: a page of the batch's transactions is served by the index by batch and row", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const batchId = randomUUID();
    const fileId = randomUUID();
    // 10 batches of 400 rows: the page reads only its own batch's, from the cursor on.
    for (let b = 0; b < 10; b++) {
      await db.owner.query(
        `INSERT INTO transactions.transactions
           (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, description, status, source,
            import_batch_id, import_file_id, import_row)
         SELECT $1, gen_random_uuid(), $2, $2, -((i % 50) + 1)::numeric, 'EUR', DATE '2025-01-01' + (i / 8),
                'SHOP ' || (i % 37), 'posted', 'imported', $3, $4, i + 1
           FROM generate_series(0, 399) AS i`,
        [space.householdId, account, b === 0 ? batchId : randomUUID(), b === 0 ? fileId : randomUUID()],
      );
    }
    await db.owner.query(`ANALYZE transactions.transactions`);
    const plan = await db.databases.for("transactions").inHousehold(space.householdId, async (q) => {
      const { rows } = await q.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (FORMAT JSON) ${IMPORT_BATCH_TRANSACTIONS_SQL}`,
        importBatchTransactionsParams(space.householdId, {
          batchId,
          limit: 1_000,
          after: { fileId, row: 100 },
        }),
      );
      return JSON.stringify(rows[0]!["QUERY PLAN"]);
    });
    expect(plan).toMatch(/"Index Name":"transactions_import_row"/u);
    expect(plan).not.toMatch(/"Seq Scan"/u);
    const page = await createImportBatchTransactions(db.databases.for("transactions")).page(
      space.householdId,
      {
        batchId,
        limit: 1_000,
        after: { fileId, row: 100 },
      },
    );
    expect(page).toHaveLength(300);
    expect(page[0]).toMatchObject({ fileId, row: 101 });
  });
});
