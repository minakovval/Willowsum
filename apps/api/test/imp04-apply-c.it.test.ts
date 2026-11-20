import { randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createImportCategoryCarry } from "../src/modules/categorization/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createImportedTransactions } from "../src/modules/transactions/index.ts";
import { unmergeDuplicate } from "../src/modules/transactions/application/index.ts";
import { transactionsTx } from "../src/modules/transactions/adapters/index.ts";
import { transactionAudit } from "../src/modules/transactions/adapters/http/services.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * The apply of an import batch, part c (IMP-04@PoC FR 5, FR 6, AC4, AC6, AC10; #654 item 6) on a real PostgreSQL
 * through the real API, the real parse worker and modules transactions and categorization: a row merged with a single
 * manual transaction (the bank's row stays with its date, text and journal event and takes the manual one's category
 * and note; the manual one is merged into it, «Роз'єднати» gives it back), a key match whose manual one is merged into
 * the bank's row too, a posted row in place of a pending one of a previous import, and the same under a concurrent
 * change and two applies at once. The accounts module is the test's port (an EUR account). Synthetic data only; the
 * clock is the test's.
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
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  readonly eur: string;
  readonly subaccountId: string;
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
  // The account's journal account exists (as module accounts opens it), so the rows' entries are posted.
  await createLedger(db.databases.for("ledger")).openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
  );
  return { accountId, householdId, eur, subaccountId: sub.subaccountId };
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

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/**
 * A statement whose figures agree: 1 000,00 EUR, the row, then a refund of 10,00 on 20.04 (its day past 12 fixes the
 * order of day and month, so the batch needs no clarification).
 */
function statement(date: string, amount: string, description: string): Buffer {
  const closing = new Decimal("1000.00").plus(amount).plus("10.00");
  return text([
    "Вхідний залишок:;1000.00 EUR",
    "Дата;Сума;Опис",
    `${date};${amount};${description}`,
    "20.04.2026;10.00;Повернення",
    `Кінцевий залишок:;${closing.toFixed(2)} EUR`,
  ]);
}

async function batchWith(space: Space, parts: readonly { name: string; bytes: Buffer }[]) {
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

/** Runs the space's import queue until nothing is due (the parse jobs, then their audit hand-offs). */
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

async function parsedBatch(space: Space, name: string, bytes: Buffer) {
  const batch = await batchWith(space, [{ name, bytes }]);
  const started = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: batch.fileIds.map((fileId) => ({ fileId, accountId: space.eur })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return batch;
}

const apply = (space: Space, batchId: string) =>
  call(space, "POST", `/v1/import/batches/${batchId}/apply`, undefined);

/** A transaction entered by hand (as module transactions stores one), with a note. */
async function manual(space: Space, amount: string, date: string, description: string) {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                            description, note)
     VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7, 'Обід з колегами')`,
    [space.householdId, id, space.eur, space.subaccountId, amount, date, description],
  );
  return id;
}

interface Row {
  id: string;
  amount: string;
  occurred_on: string;
  source: string;
  status: string;
  hidden: boolean;
  merged_into: string | null;
  review: string | null;
  note: string | null;
  version: number;
  bank_description: string | null;
}

async function rows(householdId: string): Promise<Row[]> {
  const { rows: found } = await db.owner.query<Row>(
    `SELECT id, trim_scale(amount)::text AS amount, occurred_on::text AS occurred_on, source, status, hidden,
            merged_into, review, note, version, bank_description
       FROM transactions.transactions WHERE household_id = $1 ORDER BY source, occurred_on, id`,
    [householdId],
  );
  return found;
}

/** The live (not reversed) journal entries of one transaction. */
async function liveEntries(householdId: string, transactionId: string): Promise<number> {
  const { rows: found } = await db.owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.source_id = $2
        AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)`,
    [householdId, transactionId],
  );
  return found[0]!.n;
}

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
              merged: createImportCategoryCarry(db.databases.for("categorization")),
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

describe("IMP-04@PoC FR 5: a row and a manual transaction through the apply", () => {
  it("IMP-04@PoC AC4: a manual −42,00 EUR of 2026-04-10 with «Кафе і ресторани» and a row −42,00 of 2026-04-11 — merged: the category and the note kept, the merge in the audit log, «Роз'єднати» gives the manual one back", async () => {
    const space = await newSpace();
    const manualId = await manual(space, "-42.00", "2026-04-10", "Обід");
    const categoryId = randomUUID();
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, 'manual')`,
      [space.householdId, manualId, categoryId],
    );
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ merge: 1, import: 1, "possible-duplicate": 0 });

    const all = await rows(space.householdId);
    const merged = all.find((r) => r.id === manualId);
    const row = all.find((r) => r.source === "imported" && r.amount === "-42");
    // FR 5: the bank's row is the one shown — its date and text, the manual one's note, its own journal event.
    expect(row).toMatchObject({
      source: "imported",
      occurred_on: "2026-04-11",
      bank_description: "CAFE CENTRAL",
      hidden: false,
      merged_into: null,
      note: "Обід з колегами",
      version: 1,
    });
    expect(await liveEntries(space.householdId, row!.id)).toBe(1);
    // The manual one merged into it: hidden, no event of its own, its fields kept for «Роз'єднати».
    expect(merged).toMatchObject({
      source: "manual",
      occurred_on: "2026-04-10",
      hidden: true,
      merged_into: row!.id,
      note: "Обід з колегами",
      version: 2,
    });
    expect(await liveEntries(space.householdId, manualId)).toBe(0);
    // The category «вручну» carried to the bank's row; the manual one's row untouched.
    const { rows: categories } = await db.owner.query<{
      transaction_id: string;
      category_id: string;
      source: string;
    }>(
      `SELECT transaction_id, category_id, source FROM categorization.transaction_categories
        WHERE household_id = $1 ORDER BY transaction_id = $2 DESC`,
      [space.householdId, row!.id],
    );
    expect(categories).toEqual([
      { transaction_id: row!.id, category_id: categoryId, source: "manual" },
      { transaction_id: manualId, category_id: categoryId, source: "manual" },
    ]);
    // The event «Злито з імпортом» in module transactions' outbox: categorization's job carries it again if the
    // request's own run failed.
    const { rows: events } = await db.owner.query<{ payload: unknown }>(
      `SELECT payload FROM transactions.outbox_events WHERE household_id = $1 AND event_name = 'transactions.import-merged'`,
      [space.householdId],
    );
    expect(events.map((e) => e.payload)).toEqual([
      { transactionId: row!.id, duplicateId: manualId, actorAccountId: space.accountId },
    ]);
    // FIN-03 FR 11: the merge is the manual one's audit entry (field mergedInto), the one «Роз'єднати» undoes.
    const { rows: entries } = await db.owner.query<{
      key: string;
      changes: { field: string; after: string }[];
    }>(
      `SELECT dedupe_key AS key, changes FROM audit.entries WHERE household_id = $1 AND entity_id = $2 ORDER BY dedupe_key`,
      [space.householdId, manualId],
    );
    expect(entries.map((e) => e.key)).toEqual([`transactions.merge:${manualId}:2`]);
    expect(entries[0]!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "mergedInto", after: row!.id })]),
    );

    // «Роз'єднати» on the bank's row: the manual one comes back on its own, with its date.
    const deps = {
      accounts,
      ledger: createLedger(db.databases.for("ledger")),
      audit: transactionAudit(audit),
      newId: randomUUID,
      today: () => "2026-11-20",
      statesEnabled: async () => true,
      duplicates: null,
    };
    const unmerged = await unmergeDuplicate(
      deps,
      (work) =>
        db.databases.for("transactions").inHousehold(space.householdId, (q) => work(transactionsTx(q))),
      { householdId: space.householdId, accountId: space.accountId },
      row!.id,
    );
    expect(unmerged).toMatchObject({ kind: "ok" });
    expect((await rows(space.householdId)).find((r) => r.id === manualId)).toMatchObject({
      occurred_on: "2026-04-10",
      hidden: false,
      merged_into: null,
      version: 3,
    });
  });

  it("IMP-04@PoC FR 5: the merged record takes the bank's description and posting date; the manual one's category and note stay (#658)", async () => {
    const space = await newSpace();
    const manualId = await manual(space, "-42.00", "2026-04-10", "Обід");
    const categoryId = randomUUID();
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, 'manual')`,
      [space.householdId, manualId, categoryId],
    );
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ merge: 1 });
    // One operation is shown: dated by the bank and described by it (FR 5, FIN-03 FR 11, AC5) ...
    const { rows: shown } = await db.owner.query<{
      id: string;
      occurred_on: string;
      text: string;
      note: string | null;
    }>(
      `SELECT id, occurred_on::text AS occurred_on, COALESCE(bank_description, description) AS text, note
         FROM transactions.transactions
        WHERE household_id = $1 AND amount = -42 AND NOT hidden AND merged_into IS NULL`,
      [space.householdId],
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      occurred_on: "2026-04-11",
      text: "CAFE CENTRAL",
      note: "Обід з колегами",
    });
    // ... with the manual one's category.
    const { rows: category } = await db.owner.query<{ category_id: string }>(
      `SELECT category_id FROM categorization.transaction_categories WHERE household_id = $1 AND transaction_id = $2`,
      [space.householdId, shown[0]!.id],
    );
    expect(category).toEqual([{ category_id: categoryId }]);
  });

  it("IMP-04@PoC FR 5: a key match with a manual one (same date, amount and text) — a duplicate, the manual one merged into the bank's row; the statement again adds nothing", async () => {
    const space = await newSpace();
    const manualId = await manual(space, "-42.00", "2026-04-11", "CAFE CENTRAL");
    const first = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    const res = await apply(space, first.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ duplicate: 1, merge: 0, import: 1 });
    const all = await rows(space.householdId);
    const link = all.find((r) => r.source === "imported" && r.amount === "-42");
    expect(link).toMatchObject({
      source: "imported",
      hidden: false,
      merged_into: null,
      note: "Обід з колегами",
    });
    expect(all.find((r) => r.id === manualId)).toMatchObject({ hidden: true, merged_into: link!.id });
    expect(await liveEntries(space.householdId, link!.id)).toBe(1);
    expect(await liveEntries(space.householdId, manualId)).toBe(0);

    // The same statement in another format: the bank's row is its row's key match — a duplicate, nothing written.
    const again = await parsedBatch(
      space,
      "kviten.tsv",
      Buffer.from(statement("11.04.2026", "-42.00", "CAFE CENTRAL").toString("utf8").replaceAll(";", "\t")),
    );
    const second = await apply(space, again.batchId);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().result.counts).toMatchObject({ duplicate: 2, import: 0, "possible-duplicate": 0 });
    expect(await rows(space.householdId)).toHaveLength(3);
  });

  it("IMP-04@PoC FR 5: the manual one changes while the batch is planned (hidden meanwhile) — no merge, the row written as «Можливий дубль»", async () => {
    const space = await newSpace();
    const manualId = await manual(space, "-42.00", "2026-04-10", "Обід");
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    // Another change of the manual one holds its row; the apply plans, then waits for the row's lock.
    const res = await db.databases.for("transactions").inHousehold(space.householdId, async (q) => {
      await q.query(`SELECT 1 FROM transactions WHERE household_id = $1 AND id = $2 FOR UPDATE`, [
        space.householdId,
        manualId,
      ]);
      const applying = apply(space, batch.batchId);
      let found = false;
      for (let i = 0; i < 2000 && !found; i++) {
        const { rows: waiting } = await db.owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
        );
        found = waiting[0]!.n > 0;
        if (!found) await new Promise((r) => setTimeout(r, 5));
      }
      // The apply did wait for the row (the change below lands between its plan and its re-check).
      expect(found).toBe(true);
      await q.query(
        `UPDATE transactions SET hidden = true, version = version + 1 WHERE household_id = $1 AND id = $2`,
        [space.householdId, manualId],
      );
      // Wrapped: an async callback returning the promise itself would wait for the apply, which waits for this lock.
      return { applying };
    });
    const done = await res.applying;
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().result.counts).toMatchObject({ merge: 0, "possible-duplicate": 1 });
    const row = (await rows(space.householdId)).find((r) => r.source === "imported" && r.amount === "-42");
    expect(row).toMatchObject({ source: "imported", hidden: false, merged_into: null, review: "queued" });
  });

  it("IMP-04@PoC FR 5: two batches with a row for one manual transaction applied at once — exactly one merges, the other is «Можливий дубль» on its own", async () => {
    const space = await newSpace();
    const manualId = await manual(space, "-42.00", "2026-04-10", "Обід");
    const a = await parsedBatch(space, "a.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    const b = await parsedBatch(space, "b.csv", statement("12.04.2026", "-42.00", "CAFE CENTRAL 2"));
    const [ra, rb] = await Promise.all([apply(space, a.batchId), apply(space, b.batchId)]);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(rb.statusCode, rb.body).toBe(200);
    const merges = [ra, rb].map((r) => r.json().result.counts.merge as number).sort();
    expect(merges).toEqual([0, 1]);
    const all = await rows(space.householdId);
    const kept = all.find((r) => r.id === manualId)!;
    expect(kept).toMatchObject({ hidden: true });
    // The import lock of the account orders the two: the second plans after the first commits, when the manual one is
    // merged already — never a second link. Its row is shown on its own as «Можливий дубль».
    const second = [ra, rb].find((r) => r.json().result.counts.merge === 0)!;
    expect(second.json().result.counts).toMatchObject({ "possible-duplicate": 1 });
    const imported = all.filter((r) => r.source === "imported" && r.amount === "-42");
    expect(imported).toHaveLength(2);
    expect(imported.every((r) => !r.hidden && r.merged_into === null)).toBe(true);
    // The first one's row took the manual one's state; the second one's is in «До розбору».
    expect(imported.find((r) => r.id !== kept.merged_into)).toMatchObject({ review: "queued", note: null });
  });
});

describe("IMP-04@PoC FR 5: the category of a merge on import (module categorization, #658)", () => {
  async function categorized(householdId: string, transactionId: string, categoryId: string, source: string) {
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, $3, $4)`,
      [householdId, transactionId, categoryId, source],
    );
  }
  async function categoryOf(householdId: string, transactionId: string) {
    const { rows: found } = await db.owner.query<{ category_id: string; source: string; version: number }>(
      `SELECT category_id, source, version FROM categorization.transaction_categories
        WHERE household_id = $1 AND transaction_id = $2`,
      [householdId, transactionId],
    );
    return found[0] ?? null;
  }

  it("IMP-04@PoC FR 5: «вручну» wins over the bank's or a rule's category; a weaker source never replaces a stronger one; run again, nothing changes", async () => {
    const space = await newSpace();
    const carry = createImportCategoryCarry(db.databases.for("categorization"));
    const [kept, duplicate, kept2, duplicate2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [mine, banks, ruled] = [randomUUID(), randomUUID(), randomUUID()];
    await categorized(space.householdId, kept, banks, "bank");
    await categorized(space.householdId, duplicate, mine, "manual");
    await categorized(space.householdId, kept2, ruled, "rule");
    await categorized(space.householdId, duplicate2, banks, "bank");
    const merge = (transactionId: string, duplicateId: string) => ({
      transactionId,
      duplicateId,
      actorAccountId: space.accountId,
    });
    await carry(space.householdId, merge(kept, duplicate));
    await carry(space.householdId, merge(kept2, duplicate2));
    expect(await categoryOf(space.householdId, kept)).toEqual({
      category_id: mine,
      source: "manual",
      version: 2,
    });
    expect(await categoryOf(space.householdId, kept2)).toEqual({
      category_id: ruled,
      source: "rule",
      version: 1,
    });
    await carry(space.householdId, merge(kept, duplicate));
    expect(await categoryOf(space.householdId, kept)).toMatchObject({ version: 2 });
    // The change of the bank's row is the categorization audit hand-off (keyed by its version).
    const { rows: jobs } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM categorization.jobs WHERE household_id = $1 AND dedupe_key = $2`,
      [space.householdId, `set:${kept}:2`],
    );
    expect(jobs[0]!.n).toBe(1);
  });
});

describe("IMP-04@PoC FR 6: a posted row in place of a pending one of a previous import", () => {
  /** A pending row of a previous import (as an apply that reads the bank's status will write it). */
  async function pending(space: Space, amount: string, date: string) {
    const id = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                              description, status, source, import_batch_id, import_file_id, import_row,
                                              bank_description, review)
       VALUES ($1, $2, $3, $4, $5, 'EUR', $6, 'HOLD SHOP', 'pending', 'imported', $7, $8, 3, 'HOLD SHOP', 'queued')`,
      [space.householdId, id, space.eur, space.subaccountId, amount, date, randomUUID(), randomUUID()],
    );
    return id;
  }

  it("IMP-04@PoC AC6, EC3: a pending −30,00 EUR and a posted −30,10 three days later — replaced, not doubled; the pending one kept hidden for the rollback", async () => {
    const space = await newSpace();
    const pendingId = await pending(space, "-30.00", "2026-04-08");
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-30.10", "SHOP"));
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ replace: 1, import: 1 });
    const all = await rows(space.householdId);
    expect(all).toHaveLength(3);
    const posted = all.find((r) => r.amount === "-30.1")!;
    expect(posted).toMatchObject({ amount: "-30.1", status: "posted", hidden: false, review: "queued" });
    expect(all.find((r) => r.id === pendingId)).toMatchObject({
      status: "pending",
      hidden: true,
      merged_into: posted.id,
      version: 2,
    });
    // The posted row is the one operation in the balance; the pending one never had an event.
    expect(await liveEntries(space.householdId, posted.id)).toBe(1);
    expect(await liveEntries(space.householdId, pendingId)).toBe(0);
  });

  it("IMP-04@PoC FR 6: past the tolerance min(0,25; 10 %) — −3,00 pending and −3,31 posted are two operations, nothing replaced", async () => {
    const space = await newSpace();
    await pending(space, "-3.00", "2026-04-08");
    // 10 % of 3,31 is 0,331 > 0,25: the tolerance is 0,25 and 0,31 is past it.
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-3.31", "SHOP"));
    const res = await apply(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.counts).toMatchObject({ replace: 0, import: 2 });
    expect((await rows(space.householdId)).filter((r) => !r.hidden)).toHaveLength(3);
  });
});

describe("IMP-04@PoC AC10: the apply's audit entry", () => {
  it("IMP-04@PoC AC10: the engine's version and the count of every outcome, the merge and the replacement too", async () => {
    const space = await newSpace();
    await manual(space, "-42.00", "2026-04-10", "Обід");
    const batch = await parsedBatch(space, "kviten.csv", statement("11.04.2026", "-42.00", "CAFE CENTRAL"));
    expect((await apply(space, batch.batchId)).statusCode).toBe(200);
    const { rows: entries } = await db.owner.query<{ changes: { field: string; after: string | null }[] }>(
      `SELECT changes FROM audit.entries
        WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND entity_id = $2`,
      [space.householdId, batch.batchId],
    );
    expect(entries.flatMap((r) => r.changes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "engine", after: "1" }),
        expect.objectContaining({ field: "rows.merge", after: "1" }),
        expect.objectContaining({ field: "rows.replace", after: "0" }),
        expect.objectContaining({ field: "rows.import", after: "1" }),
      ]),
    );
  });
});
