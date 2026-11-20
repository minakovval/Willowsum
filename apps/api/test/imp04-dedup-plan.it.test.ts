import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import {
  outcomeCounts,
  planImport,
  type IncomingRow,
  type PlanDeps,
} from "../src/modules/duplicate-matching/index.ts";
import { createFileStorage, linkKey } from "../src/modules/file-storage/index.ts";
import { csv } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import {
  BatchNotFoundError,
  createImportSessionsApplications,
  createImportSessionsServices,
} from "../src/modules/import-sessions/index.ts";
import { createImportCandidates } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-04@PoC a) (wave 2 row 43) on a real PostgreSQL: the plan of a batch reads the account's transactions through the
 * transactions module's public `ImportCandidates` — bounded to the rows' window, page by page on the index by account
 * and date, only the caller's space — on an account with thousands of transactions (FR 1, FR 4, FR 5, FR 6); the same
 * file by content (FR 3); the stored result of the apply, once per batch, also for two requests at once (FR 7). The
 * apply step is not built yet: the test writes imported transactions with SQL as it will. Synthetic data only.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let app: ReturnType<typeof buildServer>;
let candidates: ReturnType<typeof createImportCandidates>;
let applications: ReturnType<typeof createImportSessionsApplications>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

async function batchWithFile(space: Space, bytes: Buffer): Promise<{ batchId: string; fileId: string }> {
  const headers = {
    origin: WEB,
    ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
  };
  const created = await app.inject({
    method: "POST",
    url: "/v1/import/batches",
    headers: { ...headers, "content-type": "application/json" },
    payload: "{}",
  });
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="vypyska.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileId: (res.json().files as { id: string }[])[0]!.id };
}

const setState = (batchId: string, state: string) =>
  db.owner.query(`UPDATE import_sessions.batches SET state = $2 WHERE id = $1`, [batchId, state]);

/**
 * `count` imported transactions of `batchId` on an account, one every few hours from 2025-01-01: amounts −1,00 …
 * −50,00 EUR, descriptions «SHOP 0» … «SHOP 36», a printed balance on every third. Returns nothing; SQL only.
 */
async function seedImported(
  householdId: string,
  accountId: string,
  batchId: string,
  count: number,
): Promise<void> {
  await db.owner.query(
    `INSERT INTO transactions.transactions
       (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, description, status, source,
        import_batch_id, balance_after)
     SELECT $1, gen_random_uuid(), $2, $2, -((i % 50) + 1)::numeric, 'EUR', DATE '2025-01-01' + (i / 8),
            'SHOP ' || (i % 37), 'posted', 'imported', $3,
            CASE WHEN i % 3 = 0 THEN (10000 - i)::numeric END
       FROM generate_series(0, $4::int - 1) AS i`,
    [householdId, accountId, batchId, count],
  );
}

/** The rows a statement file gives for the seeded transactions number `from` … `to` − 1 (the same text and amounts). */
function sameRows(from: number, to: number, firstRow = 1): IncomingRow[] {
  return Array.from({ length: to - from }, (_, k) => {
    const i = from + k;
    const date = new Date(Date.UTC(2025, 0, 1 + Math.floor(i / 8))).toISOString().slice(0, 10);
    return {
      row: firstRow + k,
      date,
      // Another format prints the amount with another scale and the text in another case.
      amount: Money.of(`-${(i % 50) + 1}.00`, "EUR"),
      description: `shop  ${i % 37}`,
      balance: i % 3 === 0 ? Money.of(`${10000 - i}.00`, "EUR") : null,
      status: "posted",
    };
  });
}

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  const audit = createAuditLog(db.databases.for("audit"));
  const files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  candidates = createImportCandidates(db.databases.for("transactions"));
  applications = createImportSessionsApplications({
    db: db.databases.for("import-sessions"),
    now: clock.now,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({ files, audit, clock, newId: randomUUID }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("IMP-04@PoC FR 1, FR 4: the plan on an account with thousands of transactions", () => {
  it("IMP-04@PoC AC3: 3 000 imported transactions, a file overlapping its last 600 and 100 rows after — 600 duplicates, 100 imported; only the window of the caller's account is read, page by page", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = randomUUID();
    const neighbour = randomUUID();
    const oldBatch = randomUUID();
    await seedImported(space.householdId, account, oldBatch, 3_000);
    // The same dates and amounts on another account of the space and on the same account id in another space.
    await seedImported(space.householdId, neighbour, oldBatch, 2_000);
    await seedImported(other.householdId, account, oldBatch, 2_000);
    await db.owner.query(`ANALYZE transactions.transactions`);

    const fresh: IncomingRow[] = Array.from({ length: 100 }, (_, k) => ({
      row: 601 + k,
      date: new Date(Date.UTC(2025, 0, 376 + Math.floor(k / 4))).toISOString().slice(0, 10),
      amount: Money.of(`-${1000 + k}.37`, "EUR"),
      description: `NEW ${k}`,
      balance: null,
      status: "posted",
    }));
    const rows = [...sameRows(2_400, 3_000), ...fresh];

    const reads: { accountId: string; from: string; to: string; got: number }[] = [];
    const counted: PlanDeps = {
      candidates: {
        async page(householdId, query) {
          const got = await candidates.page(householdId, query);
          reads.push({ accountId: query.accountId, from: query.from, to: query.to, got: got.length });
          return got;
        },
      },
    };
    const started = performance.now();
    const out = await planImport(counted, space.householdId, {
      batchId: randomUUID(),
      accountId: account,
      rows,
      sameFileAppliedIn: null,
    });
    const elapsed = performance.now() - started;

    const counts = outcomeCounts(out);
    expect(counts.duplicate).toBe(600);
    expect(counts.import + counts.repeat).toBe(100);
    expect(out.slice(600).every((o) => o.kind === "import")).toBe(true);

    // Bounded: the rows of this account dated in the window (dates ± 10 days), never the neighbour's or the other
    // space's, in pages of at most 1 000.
    const { rows: inWindow } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions
        WHERE household_id = $1 AND account_id = $2 AND occurred_on BETWEEN $3::date AND $4::date`,
      [space.householdId, account, reads[0]!.from, reads[0]!.to],
    );
    expect(reads.reduce((n, r) => n + r.got, 0)).toBe(inWindow[0]!.n);
    expect(inWindow[0]!.n).toBeLessThan(800);
    expect(reads.every((r) => r.accountId === account && r.got <= 1_000)).toBe(true);
    // A generous bound only: it fails when the read stops being narrowed (all 7 000 rows on every page).
    expect(elapsed).toBeLessThan(10_000);
  });

  it("IMP-04@PoC FR 1: the window query is served by the index by account and date", async () => {
    const space = await newSpace();
    const account = randomUUID();
    await seedImported(space.householdId, account, randomUUID(), 3_000);
    await db.owner.query(`ANALYZE transactions.transactions`);
    const { rows } = await db.owner.query<{ "QUERY PLAN": unknown }>(
      `EXPLAIN (FORMAT JSON)
       SELECT t.id FROM transactions.transactions t
        WHERE t.household_id = $1 AND t.account_id = $2 AND t.occurred_on BETWEEN DATE '2025-06-01' AND DATE '2025-06-21'
          AND t.merged_into IS NULL
        ORDER BY t.occurred_on, t.id LIMIT 1000`,
      [space.householdId, account],
    );
    const plan = JSON.stringify(rows[0]!["QUERY PLAN"]);
    expect(plan).toMatch(/transactions_by_account|transactions_duplicate_search/u);
    expect(plan).not.toMatch(/"Seq Scan"/u);
  });

  it("IMP-04@PoC FR 5: a manual transaction is read as manual and merged; an imported one of another batch is «Можливий дубль»", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const manual = randomUUID();
    const imported = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transactions
         (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, description, source, import_batch_id)
       VALUES ($1, $2, $3, $3, -42.00, 'EUR', DATE '2026-04-10', 'Обід', 'manual', NULL),
              ($1, $4, $3, $3, -25.00, 'EUR', DATE '2026-05-10', 'CARD PAYMENT 4411', 'imported', gen_random_uuid())`,
      [space.householdId, manual, account, imported],
    );
    const out = await planImport({ candidates }, space.householdId, {
      batchId: randomUUID(),
      accountId: account,
      rows: [
        {
          row: 1,
          date: "2026-04-11",
          amount: Money.of("-42.00", "EUR"),
          description: "REST",
          balance: null,
          status: "posted",
        },
        {
          row: 2,
          date: "2026-05-12",
          amount: Money.of("-25.00", "EUR"),
          description: "SHOP ONLINE",
          balance: null,
          status: "posted",
        },
      ],
      sameFileAppliedIn: null,
    });
    expect(out).toMatchObject([
      { kind: "merge", with: manual },
      { kind: "possible-duplicate", candidates: [imported] },
    ]);
  });

  it("IMP-04@PoC FR 6: a pending transaction of a previous import is replaced by the posted row", async () => {
    const space = await newSpace();
    const account = randomUUID();
    const pending = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transactions
         (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, description, status, source,
          import_batch_id)
       VALUES ($1, $2, $3, $3, -30.00, 'EUR', DATE '2026-05-01', 'HOLD', 'pending', 'imported', gen_random_uuid())`,
      [space.householdId, pending, account],
    );
    const out = await planImport({ candidates }, space.householdId, {
      batchId: randomUUID(),
      accountId: account,
      rows: [
        {
          row: 1,
          date: "2026-05-04",
          amount: Money.of("-30.10", "EUR"),
          description: "SHOP",
          balance: null,
          status: "posted",
        },
      ],
      sameFileAppliedIn: null,
    });
    expect(out).toMatchObject([{ kind: "replace", replaces: pending }]);
  });

  it("IMP-04@PoC FR 1: the schema keeps a batch only on an imported transaction", async () => {
    const space = await newSpace();
    await expect(
      db.owner.query(
        `INSERT INTO transactions.transactions
           (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, source, import_batch_id)
         VALUES ($1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), -1, 'EUR', DATE '2026-05-01', 'manual',
                 gen_random_uuid())`,
        [space.householdId],
      ),
    ).rejects.toThrow(/transactions_import_batch_check/u);
  });
});

describe("IMP-04@PoC FR 3: the same file by content", () => {
  it("IMP-04@PoC AC2: the same bytes uploaded again are the same file once its first batch is applied; another file or space is not", async () => {
    const space = await newSpace();
    const bytes = csv();
    const first = await batchWithFile(space, bytes);
    const again = await batchWithFile(space, bytes);
    const { rows } = await db.owner.query<{ content_sha256: string }>(
      `SELECT content_sha256 FROM import_sessions.batch_files WHERE id = $1`,
      [again.fileId],
    );
    expect(rows[0]!.content_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    expect(await applications.sameFileApplied(space.householdId, again.fileId)).toBeNull();
    await setState(first.batchId, "applied");
    expect(await applications.sameFileApplied(space.householdId, again.fileId)).toBe(first.batchId);
    // The applied batch's own file is not «the same file» of itself.
    expect(await applications.sameFileApplied(space.householdId, first.fileId)).toBeNull();

    const different = await batchWithFile(
      space,
      Buffer.concat([bytes, Buffer.from("2026-05-30,Synthetic,-1.00\r\n")]),
    );
    expect(await applications.sameFileApplied(space.householdId, different.fileId)).toBeNull();

    // A rolled-back batch is no longer «already imported».
    await setState(first.batchId, "rolled-back");
    expect(await applications.sameFileApplied(space.householdId, again.fileId)).toBeNull();

    // Another space with the same bytes applied: never seen from this one.
    const other = await newSpace();
    const theirs = await batchWithFile(other, bytes);
    await setState(theirs.batchId, "applied");
    expect(await applications.sameFileApplied(space.householdId, again.fileId)).toBeNull();
    expect(await applications.sameFileApplied(other.householdId, again.fileId)).toBeNull();
  });
});

describe("IMP-04@PoC FR 7: the stored result of the apply", () => {
  it("IMP-04@PoC AC9: a second apply gets the stored result back, also when both arrive at once", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space, csv());
    expect(await applications.find(space.householdId, batch.batchId)).toBeNull();

    const [a, b] = await Promise.all([
      applications.recordOnce(space.householdId, {
        batchId: batch.batchId,
        actorId: space.accountId,
        result: { counts: { import: 2, duplicate: 1 } },
      }),
      applications.recordOnce(space.householdId, {
        batchId: batch.batchId,
        actorId: space.accountId,
        result: { counts: { import: 3, duplicate: 0 } },
      }),
    ]);
    expect([a.first, b.first].sort()).toEqual([false, true]);
    expect(a.application.result).toEqual(b.application.result);
    const later = await applications.recordOnce(space.householdId, {
      batchId: batch.batchId,
      actorId: space.accountId,
      result: { counts: { import: 9 } },
    });
    expect(later).toMatchObject({ first: false, application: { result: a.application.result } });
    expect((await applications.find(space.householdId, batch.batchId))?.result).toEqual(a.application.result);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM import_sessions.batch_applications WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("IMP-04@PoC FR 7: a batch of another space is not found and nothing is stored; a result with text is refused", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const batch = await batchWithFile(other, csv());
    await expect(
      applications.recordOnce(space.householdId, {
        batchId: batch.batchId,
        actorId: space.accountId,
        result: { counts: { import: 1 } },
      }),
    ).rejects.toBeInstanceOf(BatchNotFoundError);
    expect(await applications.find(space.householdId, batch.batchId)).toBeNull();
    await expect(
      applications.recordOnce(other.householdId, {
        batchId: batch.batchId,
        actorId: other.accountId,
        result: { counts: { "Кава 3,20": 1 } },
      }),
    ).rejects.toThrow(/not a set of counts/u);
    expect(await applications.find(other.householdId, batch.batchId)).toBeNull();
  });
});
