import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImportSessionsApplications } from "../src/modules/import-sessions/index.ts";
import { createImportCandidates } from "../src/modules/transactions/index.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #638 (IMP-04@PoC a) on a real PostgreSQL: the isolation of `ImportCandidates`,
 * `sameFileApplied` and the stored result of the apply. Synthetic data only; rows are written with SQL as the apply
 * step will write them.
 */
const now = Date.parse("2026-11-20T10:00:00Z");

let db: RealModulesDatabase;
let candidates: ReturnType<typeof createImportCandidates>;
let applications: ReturnType<typeof createImportSessionsApplications>;

async function newSpace(): Promise<{ accountId: string; householdId: string }> {
  const accountId = randomUUID();
  const { householdId } = await householdSpaces(db).ensureFirstSpace({
    accountId,
    displayName: "Олена Синтетична",
  });
  return { accountId, householdId };
}

async function addTransaction(
  householdId: string,
  accountId: string,
  over: { mergedInto?: string; transferId?: string; date?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO transactions.transactions
       (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, description, merged_into, transfer_id)
     VALUES ($1, $2, $3, $3, -42, 'EUR', $4::date, 'Synthetic', $5, $6)`,
    [householdId, id, accountId, over.date ?? "2026-04-10", over.mergedInto ?? null, over.transferId ?? null],
  );
  return id;
}

async function addBatch(
  householdId: string,
  createdBy: string,
  over: { state?: string; deleting?: boolean; sha?: string } = {},
): Promise<{ batchId: string; fileId: string }> {
  const batchId = randomUUID();
  const fileId = randomUUID();
  await db.owner.query(
    `INSERT INTO import_sessions.batches (household_id, id, state, created_by, deleting_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [householdId, batchId, over.state ?? "parsed", createdBy, over.deleting ? new Date(now) : null],
  );
  await db.owner.query(
    `INSERT INTO import_sessions.batch_files
       (household_id, id, batch_id, position, file_name, file_id, format, size_bytes, content_sha256)
     VALUES ($1, $2, $3, 1, 'vypyska.csv', $4, 'csv', 100, $5)`,
    [householdId, fileId, batchId, randomUUID(), over.sha ?? null],
  );
  return { batchId, fileId };
}

/** The stored result of a finished apply, as the apply step stores it (application/apply.ts step C). */
async function storeResult(householdId: string, batchId: string, actorId: string, counts: object) {
  await db.owner.query(
    `INSERT INTO import_sessions.batch_applications (household_id, batch_id, result, applied_by, applied_at)
     VALUES ($1, $2, $3::jsonb, $4, now())`,
    [householdId, batchId, JSON.stringify({ counts }), actorId],
  );
}

/** The file's checks with its account (the parse step's record), so FR 3 compares the same account. */
async function checkedFor(
  householdId: string,
  batch: { batchId: string; fileId: string },
  accountId: string,
) {
  await db.owner.query(
    `INSERT INTO import_sessions.file_checks (household_id, batch_file_id, batch_id, account_id, checks, history)
     VALUES ($1, $2, $3, $4, '{}', '{}')`,
    [householdId, batch.fileId, batch.batchId, accountId],
  );
}

const WINDOW = { from: "2026-04-01", to: "2026-04-30", limit: 1_000 };

beforeAll(async () => {
  db = await setupRealModules(4);
  candidates = createImportCandidates(db.databases.for("transactions"));
  applications = createImportSessionsApplications({ db: db.databases.for("import-sessions") });
});

afterAll(async () => {
  await db?.close();
});

describe("IMP-04@PoC FR 1: `ImportCandidates` reads one account of one space", () => {
  it("IMP-04@PoC FR 1: a transaction of another account of the space, dated in the window, is never read", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const neighbour = randomUUID();
    const mine = await addTransaction(space.householdId, account);
    await addTransaction(space.householdId, neighbour);
    const got = await candidates.page(space.householdId, { accountId: account, ...WINDOW });
    expect(got.map((t) => t.transactionId)).toEqual([mine]);
    expect(await candidates.page(space.householdId, { accountId: neighbour, ...WINDOW })).toHaveLength(1);
  });

  it("IMP-04@PoC FR 1: the same account id asked from another space gives nothing", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = randomUUID();
    await addTransaction(space.householdId, account);
    expect(await candidates.page(other.householdId, { accountId: account, ...WINDOW })).toEqual([]);
  });

  it("IMP-04@PoC FR 1, FR 5: a merged duplicate is not read, the one it is merged into is matched, a side of a transfer is marked", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const kept = await addTransaction(space.householdId, account);
    await addTransaction(space.householdId, account, { mergedInto: kept });
    const side = await addTransaction(space.householdId, account, {
      transferId: randomUUID(),
      date: "2026-04-11",
    });
    const got = await candidates.page(space.householdId, { accountId: account, ...WINDOW });
    expect(got.map((t) => [t.transactionId, t.matched, t.transfer])).toEqual([
      [kept, true, false],
      [side, false, true],
    ]);
  });
});

describe("ARC-03 FR 2: row-level security of the table and columns of this slice", () => {
  it("ARC-03 FR 2: `batch_applications` has forced row-level security; a module transaction of one space sees no row of another without any predicate", async () => {
    const { rows } = await db.owner.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'import_sessions' AND p.tablename = 'batch_applications') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'import_sessions' AND c.relname = 'batch_applications'`,
    );
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(rows[0]!.policies).toBeGreaterThan(0);

    const space = await newSpace();
    const other = await newSpace();
    const sha = createHash("sha256").update(randomUUID()).digest("hex");
    const theirs = await addBatch(other.householdId, other.accountId, { state: "applied", sha });
    await storeResult(other.householdId, theirs.batchId, other.accountId, { import: 7 });
    const account = randomUUID();
    await addTransaction(other.householdId, account);

    const seen = await db.databases.for("import-sessions").inHousehold(space.householdId, async (q) => ({
      applications: (await q.query(`SELECT 1 FROM batch_applications`)).rowCount,
      hashes: (await q.query(`SELECT 1 FROM batch_files WHERE content_sha256 = $1`, [sha])).rowCount,
    }));
    expect(seen).toEqual({ applications: 0, hashes: 0 });
    const tx = await db.databases
      .for("transactions")
      .inHousehold(space.householdId, (q) =>
        q.query(`SELECT import_batch_id, balance_after FROM transactions WHERE account_id = $1`, [account]),
      );
    expect(tx.rowCount).toBe(0);
  });
});

describe("IMP-04@PoC FR 3: the same file — only a batch that is applied and stays", () => {
  it("IMP-04@PoC FR 3: an applied batch being deleted is not «already imported»", async () => {
    const space = await newSpace();
    const sha = createHash("sha256").update(randomUUID()).digest("hex");
    const account = randomUUID();
    const gone = await addBatch(space.householdId, space.accountId, {
      state: "applied",
      deleting: true,
      sha,
    });
    await checkedFor(space.householdId, gone, account);
    await storeResult(space.householdId, gone.batchId, space.accountId, { import: 1 });
    const again = await addBatch(space.householdId, space.accountId, { sha });
    expect(await applications.sameFileApplied(space.householdId, again.fileId, account)).toBeNull();
  });

  it("IMP-04@PoC FR 3: a file without a hash (uploaded before it was kept) matches no other file without one", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const first = await addBatch(space.householdId, space.accountId, { state: "applied" });
    await checkedFor(space.householdId, first, account);
    await storeResult(space.householdId, first.batchId, space.accountId, { import: 1 });
    const again = await addBatch(space.householdId, space.accountId);
    expect(await applications.sameFileApplied(space.householdId, again.fileId, account)).toBeNull();
  });
});

describe("IMP-04@PoC FR 7: one stored result per batch", () => {
  it("IMP-04@PoC FR 7: the stored result of one batch is never returned for another batch of the space", async () => {
    const space = await newSpace();
    const one = await addBatch(space.householdId, space.accountId);
    const two = await addBatch(space.householdId, space.accountId);
    await storeResult(space.householdId, one.batchId, space.accountId, { import: 5 });
    expect(await applications.find(space.householdId, two.batchId)).toBeNull();
    await storeResult(space.householdId, two.batchId, space.accountId, { duplicate: 5 });
    expect(await applications.find(space.householdId, two.batchId)).toMatchObject({
      batchId: two.batchId,
      inProgress: false,
      result: { counts: { duplicate: 5 } },
    });
    expect((await applications.find(space.householdId, one.batchId))?.result).toEqual({
      counts: { import: 5 },
    });
  });
});
