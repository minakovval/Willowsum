import { randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
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
import { leakText } from "./leak-text.ts";

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

async function categorize(householdId: string, transactionId: string, categoryId: string): Promise<void> {
  await db.owner.query(
    `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
     VALUES ($1, $2, $3, 'manual')
     ON CONFLICT (household_id, transaction_id) DO UPDATE SET category_id = $3, source = 'manual', version = 2`,
    [householdId, transactionId, categoryId],
  );
}

async function batchAudit(
  householdId: string,
  batchId: string,
): Promise<{ fields: { field: string; after: string | null }[]; actors: string[] }> {
  const { rows } = await db.owner.query<{
    actor_id: string;
    changes: { field: string; after: string | null }[];
  }>(
    `SELECT actor_id, changes FROM audit.entries
      WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2
        AND changes::text LIKE '%rollback%' ORDER BY occurred_at`,
    [householdId, batchId],
  );
  return {
    fields: rows.flatMap((r) => r.changes.map((c) => ({ field: c.field, after: c.after }))),
    actors: [...new Set(rows.map((r) => r.actor_id))],
  };
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

/** Security review of PR #728: `GET /v1/import/batches/{batchId}/rollback` (IMP-16@PoC FR 4, FR 1; NFR-01 «Ізоляція даних»). */
const as = (
  space: Space,
  method: "GET" | "POST",
  url: string,
  principal: { role?: string; scoped?: boolean } = {},
  body?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });

/** What a caller can tell two answers apart by: the status, the body without its random support id, the header names. */
const shape = (res: { statusCode: number; body: string; headers: Record<string, unknown> }) => ({
  status: res.statusCode,
  body: leakText(res.body),
  headers: Object.keys(res.headers).sort(),
  type: res.headers["content-type"],
  length: leakText(res.body).length,
});

describe("IMP-16@PoC FR 4: the rollback dialog's counts (security review #728)", () => {
  it("IMP-16@PoC FR 4: another space's batch answers exactly as a random id — status, body, headers — for the owner of another space, its viewer and a scoped member", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "sichen.csv", purchases(4));
    const all = await transactions(space.householdId);
    await categorize(space.householdId, all[0]!.id, randomUUID());
    nowMs = start + DAY;
    const other = await newSpace();
    for (const principal of [{}, { role: "viewer" }, { role: "editor", scoped: true }]) {
      const foreign = await as(other, "GET", `/v1/import/batches/${batchId}/rollback`, principal);
      const random = await as(other, "GET", `/v1/import/batches/${randomUUID()}/rollback`, principal);
      expect(foreign.statusCode).toBe(404);
      expect(shape(foreign)).toEqual(shape(random));
      for (const secret of [
        batchId,
        space.householdId,
        space.eur,
        '"rollback"',
        '"changed"',
        '"transactions"',
        "sichen",
      ])
        expect(leakText(foreign.body)).not.toContain(secret);
    }
    // A scoped member of the batch's own space: the same answer as for a random id.
    for (const role of ["editor", "viewer"]) {
      const scoped = await as(space, "GET", `/v1/import/batches/${batchId}/rollback`, { role, scoped: true });
      const scopedRandom = await as(space, "GET", `/v1/import/batches/${randomUUID()}/rollback`, {
        role,
        scoped: true,
      });
      expect(scoped.statusCode, role).toBe(404);
      expect(shape(scoped)).toEqual(shape(scopedRandom));
      expect(leakText(scoped.body)).not.toContain('"changed"');
    }
    // Its own space still reads it.
    expect((await as(space, "GET", `/v1/import/batches/${batchId}/rollback`)).json().rollback).toEqual({
      transactions: 3,
      changed: 1,
      transfers: 0,
    });
  });

  it("IMP-16@PoC FR 4: the counts are of this batch only — another batch of the space and another space's batch add nothing", async () => {
    nowMs = start;
    const space = await newSpace();
    const first = await applied(space, "one.csv", purchases(3, "ONE"));
    const second = await applied(space, "two.csv", purchases(5, "TWO"));
    const other = await newSpace();
    const theirs = await applied(other, "three.csv", purchases(7, "THREE"));
    for (const t of await transactions(other.householdId))
      await categorize(other.householdId, t.id, randomUUID());
    nowMs = start + DAY;
    expect((await as(space, "GET", `/v1/import/batches/${first}/rollback`)).json().rollback).toEqual({
      transactions: 3,
      changed: 0,
      transfers: 0,
    });
    expect((await as(space, "GET", `/v1/import/batches/${second}/rollback`)).json().rollback).toEqual({
      transactions: 5,
      changed: 0,
      transfers: 0,
    });
    expect((await as(space, "GET", `/v1/import/batches/${theirs}/rollback`)).statusCode).toBe(404);
  });

  it("IMP-16@PoC FR 1: reading the counts gives nobody the rollback — Admin, Editor, Viewer and a scoped member are refused, nothing changes; the read writes no audit entry and no journal entry", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "liutyi.csv", purchases(3));
    nowMs = start + DAY;
    const before = await batchAudit(space.householdId, batchId);
    for (const role of ["admin", "editor", "viewer"]) {
      expect((await as(space, "GET", `/v1/import/batches/${batchId}/rollback`, { role })).statusCode).toBe(
        200,
      );
      const res = await as(space, "POST", `/v1/import/batches/${batchId}/rollback`, { role }, {});
      expect(res.statusCode, role).toBe(403);
      expect(leakText(res.body)).not.toContain('"counts"');
    }
    const scoped = await as(
      space,
      "POST",
      `/v1/import/batches/${batchId}/rollback`,
      { role: "owner", scoped: true },
      {},
    );
    expect(scoped.statusCode).toBe(403);
    expect(await journal(space.householdId)).toEqual({ entries: 3, reversals: 0 });
    expect((await transactions(space.householdId)).every((t) => !t.hidden)).toBe(true);
    expect((await batchAudit(space.householdId, batchId)).fields).toHaveLength(before.fields.length);
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("applied");
  });

  it("IMP-16@PoC FR 4: a batch that is not applied has no dialog; «Відкотити все» takes the changed ones too, as the counts said", async () => {
    nowMs = start;
    const space = await newSpace();
    const draft = await parsedBatch(space, "draft.csv", statement(purchases(2)));
    const res = await as(space, "GET", `/v1/import/batches/${draft}/rollback`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback).toBeNull();
    const batchId = await applied(space, "traven.csv", purchases(6, "MAY"));
    const all = (await transactions(space.householdId)).filter((t) => !t.hidden);
    await categorize(space.householdId, all[1]!.id, randomUUID());
    nowMs = start + DAY;
    const counts = (await as(space, "GET", `/v1/import/batches/${batchId}/rollback`)).json().rollback;
    expect(counts.transactions + counts.changed).toBe(6);
    expect(counts.changed).toBe(1);
    const done = await rollback(space, batchId, "all");
    expect(done.json().rollback.counts).toMatchObject({
      rolledBack: counts.transactions + counts.changed,
      kept: 0,
    });
  });
});
