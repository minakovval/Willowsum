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
 * Security review of PR #666 («Відкотити» an applied import batch; IMP-04@PoC FR 8, AC8, AC12; IMP-16@PoC FR 1, FR 3–5):
 * Owner only, the 7 days to the millisecond, once under concurrent requests of both choices, a rolled-back transaction
 * never back in the books, the restore within the batch's accounts and space. Real PostgreSQL, the real API. Synthetic data.
 */
const WEB = "http://localhost:5173";
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

const PROBLEM_KEYS = ["code", "status", "title", "type"];

function as(space: Space, principal: Record<string, unknown>, batchId: string, body: unknown = {}) {
  return app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/rollback`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: randomUUID(), householdId: space.householdId, ...principal }),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
}

describe("IMP-16@PoC FR 1: only the Owner rolls a batch back (security review of PR 666)", () => {
  it.each(["admin", "editor"] as const)(
    "IMP-16@PoC FR 1: a member of the space with the role %s (not scoped) is refused, and nothing is rolled back",
    async (role) => {
      nowMs = start;
      const space = await newSpace();
      const batchId = await applied(space, "kviten.csv", purchases(3));
      const res = await as(space, { role, scoped: false }, batchId, { mode: "all" });
      expect([403, 404], res.body).toContain(res.statusCode);
      expect(leakText(res.body)).not.toContain("rolledBack");
      // The same answer for a batch that does not exist: no way to tell.
      const unknown = await as(space, { role, scoped: false }, randomUUID(), { mode: "all" });
      expect([unknown.statusCode, unknown.json().code]).toEqual([res.statusCode, res.json().code]);
      expect(await balance(space)).toBe("-90.00");
      expect(await journal(space.householdId)).toEqual({ entries: 3, reversals: 0 });
      expect((await transactions(space.householdId)).some((t) => t.rolled_back)).toBe(false);
      expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("applied");
    },
  );

  it("IMP-16@PoC FR 1: a viewer and a scoped editor are refused with one answer for a known and an unknown batch", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    for (const principal of [
      { role: "viewer", scoped: false },
      { role: "editor", scoped: true },
      { role: "advisor", scoped: false },
    ]) {
      const res = await as(space, principal, batchId);
      const unknown = await as(space, principal, randomUUID());
      expect(res.statusCode, res.body).toBe(403);
      expect([unknown.statusCode, unknown.json().code]).toEqual([res.statusCode, res.json().code]);
      expect(Object.keys(res.json()).sort()).toEqual(PROBLEM_KEYS);
    }
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
  });

  it("IMP-04@PoC AC12: the Owner of another space gets the same «not found» for this space's batch and for no batch at all", async () => {
    nowMs = start;
    const space = await newSpace();
    const stranger = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const known = await rollback(stranger, batchId, "all");
    const unknown = await rollback(stranger, randomUUID(), "all");
    expect([known.statusCode, known.json().code]).toEqual([404, "NOT_FOUND"]);
    expect([unknown.statusCode, unknown.json().code]).toEqual([404, "NOT_FOUND"]);
    expect(Object.keys(known.json()).sort()).toEqual(Object.keys(unknown.json()).sort());
    expect(leakText(known.body)).not.toContain(space.householdId);
    expect(leakText(known.body)).not.toContain(space.eur);
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
  });
});

describe("IMP-16@PoC FR 1: 7 days to the millisecond (security review of PR 666)", () => {
  it("IMP-04@PoC AC8: one millisecond past 7 days is refused and changes nothing; at exactly 7 days the batch is rolled back", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const until = Date.parse(
      (await call(space, "GET", `/v1/import/batches/${batchId}`)).json().rollbackUntil,
    );
    nowMs = until + 1;
    const late = await rollback(space, batchId, "all");
    expect([late.statusCode, late.json().code]).toEqual([409, "IMPORT_ROLLBACK_EXPIRED"]);
    expect(Object.keys(late.json()).sort()).toEqual(PROBLEM_KEYS);
    expect(leakText(late.body)).not.toContain(space.eur);
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
    // A body cannot move the clock or the moment of the apply.
    const forged = await call(space, "POST", `/v1/import/batches/${batchId}/rollback`, {
      mode: "all",
      appliedAt: new Date(nowMs).toISOString(),
      now: new Date(start).toISOString(),
    });
    expect([400, 409, 422]).toContain(forged.statusCode);
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
    nowMs = until;
    const onTime = await rollback(space, batchId);
    expect(onTime.statusCode, onTime.body).toBe(200);
    expect(await balance(space)).toBe("0.00");
  });
});

describe("IMP-16@PoC FR 3: once, whatever comes at the same time (security review of PR 666)", () => {
  it("IMP-16@PoC FR 3: four requests at once with both choices — one rollback, each transaction reversed once", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(6));
    const changed = (await transactions(space.householdId))[0]!.id;
    await categorize(space.householdId, changed, randomUUID());
    const answers = await Promise.all([
      rollback(space, batchId, "all"),
      rollback(space, batchId, "keep-changed"),
      rollback(space, batchId, "all"),
      rollback(space, batchId),
    ]);
    // A request that met another one's lock may be asked to try again (409); none fails otherwise.
    for (const a of answers) expect([200, 409], a.body).toContain(a.statusCode);
    const done = answers.filter((a) => a.statusCode === 200);
    expect(done.filter((a) => a.json().first === true)).toHaveLength(1);
    const { rolledBack, kept } = done[0]!.json().rollback.counts as { rolledBack: number; kept: number };
    expect(rolledBack + kept).toBe(6);
    for (const a of done) expect(a.json().rollback.counts).toEqual(done[0]!.json().rollback.counts);
    expect(await journal(space.householdId)).toEqual({ entries: 6 + rolledBack, reversals: rolledBack });
    expect(await balance(space)).toBe(new Decimal(-30 * kept).toFixed(2));
    expect(await balance(space)).toBe(new Decimal(await expectedBalance(space.householdId)).toFixed(2));
    const { rows: own } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.entries
        WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2
          AND changes @> '[{"field":"state","after":"rolled-back"}]'::jsonb`,
      [space.householdId, batchId],
    );
    expect(own[0]!.n).toBe(1);
  });

  it("IMP-16@PoC FR 3: an overlapping statement applied first, then the first batch rolled back, then the second — the journal matches the rows after each", async () => {
    nowMs = start;
    const space = await newSpace();
    const lines = purchases(4);
    const first = await applied(space, "berezen.csv", lines);
    const second = await applied(space, "berezen-kviten.csv", [
      ...lines,
      { date: "28.04.2026", amount: "-5.55", description: "LATE" },
    ]);
    expect(await balance(space)).toBe("-125.55");
    expect((await rollback(space, first)).statusCode).toBe(200);
    expect(await balance(space)).toBe(new Decimal(await expectedBalance(space.householdId)).toFixed(2));
    expect(await balance(space)).toBe("-5.55");
    expect((await rollback(space, second)).statusCode).toBe(200);
    expect(await balance(space)).toBe("0.00");
    const j = await journal(space.householdId);
    expect(j.entries).toBe(2 * j.reversals);
  });
});

describe("IMP-16@PoC FR 2: a rolled-back transaction never comes back into the books (security review of PR 666)", () => {
  it("IMP-16@PoC FR 2: a transaction the person hid before the rollback is reversed once; after it no change or delete finds the row, and the journal stays", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(3));
    const [one, two] = (await transactions(space.householdId)).map((t) => t.id);
    // «Видалити» an imported one hides it; its journal entry stays (IMP-04 FR 9).
    const hidden = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${one}`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      },
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(await balance(space)).toBe("-90.00");
    expect((await rollback(space, batchId, "all")).statusCode).toBe(200);
    expect(await balance(space)).toBe("0.00");
    const after = await journal(space.householdId);
    expect(after).toEqual({ entries: 6, reversals: 3 });
    for (const [method, url, body] of [
      ["PATCH", `/v1/transactions/${two}`, { description: "back" }],
      ["PATCH", `/v1/transactions/${two}`, { status: "posted" }],
      ["DELETE", `/v1/transactions/${two}`, undefined],
      ["GET", `/v1/transactions/${two}/history`, undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: {
          origin: WEB,
          ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { payload: JSON.stringify(body) } : {}),
      });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(404);
    }
    expect(await journal(space.householdId)).toEqual(after);
    expect(await balance(space)).toBe("0.00");
  });
});

describe("IMP-16@PoC FR 5: the restore stays in the batch's accounts and space (security review of PR 666)", () => {
  const merged = (householdId: string, accountId: string, subaccountId: string, into: string) => {
    const id = randomUUID();
    return db.owner
      .query(
        `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                                description, hidden, merged_into)
         VALUES ($1, $2, $3, $4, -30.00, 'EUR', '2026-04-13', 'Власна', true, $5)`,
        [householdId, id, accountId, subaccountId, into],
      )
      .then(() => id);
  };

  it("IMP-16@PoC FR 5: a transaction of another space that points at a transaction of the batch is not read, restored or counted", async () => {
    nowMs = start;
    const space = await newSpace();
    const stranger = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const target = (await transactions(space.householdId))[0]!.id;
    const foreign = await merged(stranger.householdId, stranger.eur, stranger.subaccountId, target);
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rollback.counts).toMatchObject({ rolledBack: 2, restored: 0 });
    expect(leakText(res.body)).not.toContain(foreign);
    expect((await transactions(stranger.householdId)).find((t) => t.id === foreign)).toMatchObject({
      hidden: true,
      merged_into: target,
    });
    expect(await journal(stranger.householdId)).toEqual({ entries: 0, reversals: 0 });
  });

  it("IMP-16@PoC FR 5: a merged transaction on an account outside the batch's (not under its locks) — the rollback is refused, nothing changed", async () => {
    nowMs = start;
    const space = await newSpace();
    const batchId = await applied(space, "kviten.csv", purchases(2));
    const target = (await transactions(space.householdId))[0]!.id;
    const other = randomUUID();
    const sub = { subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() };
    accountsOf.set(`${space.householdId}/${other}`, {
      accountId: other,
      kind: "current",
      status: "active",
      subaccounts: [sub],
    });
    await ledger.openAccount(
      space.householdId,
      { module: "accounts", id: sub.subaccountId },
      { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
    );
    const elsewhere = await merged(space.householdId, other, sub.subaccountId, target);
    const res = await rollback(space, batchId);
    expect(res.statusCode, res.body).toBe(409);
    expect(await balance(space)).toBe("-60.00");
    expect(await journal(space.householdId)).toEqual({ entries: 2, reversals: 0 });
    const rows = await transactions(space.householdId);
    expect(rows.some((t) => t.rolled_back)).toBe(false);
    expect(rows.find((t) => t.id === elsewhere)).toMatchObject({ hidden: true, merged_into: target });
  });
});
