import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createImportCategoryCarry } from "../src/modules/categorization/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createImportedTransactions, type ImportedRowInput } from "../src/modules/transactions/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #658, round 2 (IMP-04@PoC FR 5): the category of a merge on import. The event
 * `transactions.import-merged` and its job `categorization.import-merged` through the worker as src/wiring.ts wires it
 * (the request's own run is the port `merged`, left out here — as when it fails), the job's dead row and the daily
 * recovery, another space's ids in the payload, a split manual transaction under the row lock, and a late run of the
 * job after the user cleared the category. Synthetic data only.
 */
let db: RealModulesDatabase;
let audit: AuditLog;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly householdId: string;
  readonly actorId: string;
  readonly eur: string;
  readonly sub: string;
}

async function newSpace(): Promise<Space> {
  const actorId = randomUUID();
  const { householdId } = await householdSpaces(db).ensureFirstSpace({
    accountId: actorId,
    displayName: "Олена Синтетична",
  });
  const eur = randomUUID();
  const sub = { subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() };
  accountsOf.set(`${householdId}/${eur}`, {
    accountId: eur,
    kind: "current",
    status: "active",
    subaccounts: [sub],
  });
  await createLedger(db.databases.for("ledger")).openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
  );
  return { householdId, actorId, eur, sub: sub.subaccountId };
}

async function manual(s: Space, split: "categories" | null = null) {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                            description, note, split_mode)
     VALUES ($1, $2, $3, $4, '-42.00', 'EUR', '2026-04-10', 'Обід', 'Синтетична нотатка', $5)`,
    [s.householdId, id, s.eur, s.sub, split],
  );
  return id;
}

async function categorized(householdId: string, transactionId: string, categoryId: string, source: string) {
  await db.owner.query(
    `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
     VALUES ($1, $2, $3, $4)`,
    [householdId, transactionId, categoryId, source],
  );
}

interface CategoryRow {
  household_id: string;
  transaction_id: string;
  category_id: string | null;
  source: string;
  version: number;
}

async function categoryRows(householdId: string): Promise<CategoryRow[]> {
  const { rows } = await db.owner.query<CategoryRow>(
    `SELECT household_id, transaction_id, category_id, source, version FROM categorization.transaction_categories
      WHERE household_id = $1 ORDER BY transaction_id`,
    [householdId],
  );
  return rows;
}

/** The apply's write with a row merged with `mergeInto`, without the port `merged`: only the event carries. */
async function writeMerged(s: Space, mergeInto: string) {
  const fileId = randomUUID();
  const row: ImportedRowInput = {
    fileId,
    row: 1,
    accountId: s.eur,
    amount: Money.of("-42.00", "EUR"),
    date: "2026-04-11",
    description: "CAFE CENTRAL",
    counterparty: null,
    balanceAfter: null,
    mergeInto,
  };
  let unlinked: readonly { fileId: string; row: number }[] = [];
  await createImportedTransactions(db.databases.for("transactions"), {
    accounts,
    ledger: createLedger(db.databases.for("ledger")),
    audit,
    newId: randomUUID,
    now: () => Date.parse("2026-11-20T10:00:00Z"),
  }).write(
    s.householdId,
    {
      batchId: randomUUID(),
      attemptId: randomUUID(),
      actorId: s.actorId,
      accountIds: [s.eur],
      fileIds: [fileId],
    },
    async (context) => {
      ({ unlinked } = await context.create([row]));
      return { merge: 1 };
    },
  );
  const { rows } = await db.owner.query<{ id: string; hidden: boolean; merged_into: string | null }>(
    `SELECT id, hidden, merged_into FROM transactions.transactions
      WHERE household_id = $1 AND source = 'imported'`,
    [s.householdId],
  );
  return { unlinked, bank: rows[0]! };
}

async function runWorker(householdId: string, without?: string): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    const worker = createWorker({
      ...workerQueues(db.databases),
      households: async () => [householdId],
      moduleAvailable: async (module) => module !== without,
    });
    try {
      await worker.tick();
      await worker.idle();
    } finally {
      await worker.stop();
    }
  }
}

beforeAll(async () => {
  db = await setupRealModules(6);
  audit = createAuditLog(db.databases.for("audit"));
});

afterAll(async () => {
  await db?.close();
});

describe("PR #658 security: the job of «Злито з імпортом» (categorization.import-merged)", () => {
  it("sec658: the request's own run did not happen — the event becomes the job and the bank's row takes the manual one's category once", async () => {
    const s = await newSpace();
    const m = await manual(s);
    const mine = randomUUID();
    await categorized(s.householdId, m, mine, "manual");
    const { unlinked, bank } = await writeMerged(s, m);
    expect(unlinked).toEqual([]);
    expect((await categoryRows(s.householdId)).map((r) => r.transaction_id)).toEqual([m]);
    await runWorker(s.householdId);
    const carried = (await categoryRows(s.householdId)).find((r) => r.transaction_id === bank.id);
    expect(carried).toMatchObject({ category_id: mine, source: "manual", version: 1 });
    // Run again (a retry): nothing changes.
    await createImportCategoryCarry(db.databases.for("categorization"))(s.householdId, {
      transactionId: bank.id,
      duplicateId: m,
      actorAccountId: s.actorId,
    });
    expect((await categoryRows(s.householdId)).find((r) => r.transaction_id === bank.id)).toMatchObject({
      version: 1,
    });
  });

  it("sec658: ARC-04@PoC FR 4 — the job in state dead carries nothing; the daily recovery puts it back and the category is carried", async () => {
    const s = await newSpace();
    const m = await manual(s);
    const mine = randomUUID();
    await categorized(s.householdId, m, mine, "manual");
    const { bank } = await writeMerged(s, m);
    // The event becomes a categorization job (the module's jobs not taken meanwhile); the job gives up (dead).
    await runWorker(s.householdId, "categorization");
    const { rowCount } = await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'categorization.import-merged' AND state = 'queued'`,
      [s.householdId],
    );
    expect(rowCount).toBe(1);
    await runWorker(s.householdId);
    expect(
      (await categoryRows(s.householdId)).some((r) => r.transaction_id === bank.id && r.category_id),
    ).toBe(false);
    const spaces = householdSpaces(db);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [s.householdId], membershipOf: spaces.membershipOf },
      now: () => Date.parse("2026-11-21T03:00:00Z"),
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    await runWorker(s.householdId);
    expect((await categoryRows(s.householdId)).find((r) => r.transaction_id === bank.id)).toMatchObject({
      category_id: mine,
      source: "manual",
      version: 1,
    });
  });

  it("sec658: a payload that names another space's transactions — nothing of the other space is read or written", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const [dupB, keptB, dupA, keptA] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [catA, catB, bankB] = [randomUUID(), randomUUID(), randomUUID()];
    await categorized(b.householdId, dupB, catB, "manual");
    await categorized(b.householdId, keptB, bankB, "bank");
    await categorized(a.householdId, dupA, catA, "manual");
    const before = await categoryRows(b.householdId);
    const carry = createImportCategoryCarry(db.databases.for("categorization"));
    // The other space's manual one as the source: its category never reaches this space.
    await carry(a.householdId, { transactionId: keptA, duplicateId: dupB, actorAccountId: a.actorId });
    expect((await categoryRows(a.householdId)).map((r) => r.transaction_id)).toEqual([dupA]);
    // The other space's transaction as the target: its row stays as it was (the bank's category, version 1).
    await carry(a.householdId, { transactionId: keptB, duplicateId: dupA, actorAccountId: a.actorId });
    expect(await categoryRows(b.householdId)).toEqual(before);
    const { rows: jobs } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM categorization.jobs WHERE household_id = $1`,
      [b.householdId],
    );
    expect(jobs[0]!.n).toBe(0);
  });
});

describe("PR #658 security: the re-check under the row lock (round 2)", () => {
  it("sec658: a split manual one named as `mergeInto` — no link, it stays shown with its parts' budget view", async () => {
    const s = await newSpace();
    const m = await manual(s, "categories");
    const { unlinked, bank } = await writeMerged(s, m);
    expect(unlinked).toHaveLength(1);
    expect(bank).toMatchObject({ hidden: false, merged_into: null });
    const { rows } = await db.owner.query<{ hidden: boolean; merged_into: string | null; version: number }>(
      `SELECT hidden, merged_into, version FROM transactions.transactions WHERE id = $1`,
      [m],
    );
    expect(rows[0]).toEqual({ hidden: false, merged_into: null, version: 1 });
    const { rows: events } = await db.owner.query(
      `SELECT 1 FROM transactions.outbox_events WHERE household_id = $1 AND event_name = 'transactions.import-merged'`,
      [s.householdId],
    );
    expect(events).toHaveLength(0);
  });
});

describe("PR #658 security: a late run of the job (a retry, a dead job put back a day later)", () => {
  // #658 round 2: «Без категорії» past the row's first version is the user's choice — a late run never undoes it.
  it("sec658: the user set «Без категорії» on the bank's row after the carry — a late run of the job does not bring the category back", async () => {
    const s = await newSpace();
    const [kept, duplicate, mine] = [randomUUID(), randomUUID(), randomUUID()];
    await categorized(s.householdId, duplicate, mine, "manual");
    const carry = createImportCategoryCarry(db.databases.for("categorization"));
    const merge = { transactionId: kept, duplicateId: duplicate, actorAccountId: s.actorId };
    await carry(s.householdId, merge);
    // The user's «Без категорії» (`setCategory` with null: the source «немає», the next version).
    await db.owner.query(
      `UPDATE categorization.transaction_categories SET category_id = NULL, source = 'none', version = version + 1
        WHERE household_id = $1 AND transaction_id = $2`,
      [s.householdId, kept],
    );
    await carry(s.householdId, merge);
    expect((await categoryRows(s.householdId)).find((r) => r.transaction_id === kept)).toMatchObject({
      category_id: null,
      source: "none",
      version: 2,
    });
  });

  it("sec658: a row made only by a tags rule («Без категорії», version 1) still takes the manual one's category", async () => {
    const s = await newSpace();
    const [kept, duplicate, mine] = [randomUUID(), randomUUID(), randomUUID()];
    await categorized(s.householdId, duplicate, mine, "manual");
    await db.owner.query(
      `INSERT INTO categorization.transaction_categories (household_id, transaction_id, category_id, source)
       VALUES ($1, $2, NULL, 'none')`,
      [s.householdId, kept],
    );
    await createImportCategoryCarry(db.databases.for("categorization"))(s.householdId, {
      transactionId: kept,
      duplicateId: duplicate,
      actorAccountId: s.actorId,
    });
    expect((await categoryRows(s.householdId)).find((r) => r.transaction_id === kept)).toMatchObject({
      category_id: mine,
      source: "manual",
      version: 2,
    });
  });
});
