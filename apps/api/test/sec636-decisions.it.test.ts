import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import type { StatementChecks } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { csv } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import {
  createImportSessionsCleanup,
  createImportSessionsReview,
  createImportSessionsServices,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-05@PoC part 2 (wave 2 row 42), the module `import-sessions` on a real PostgreSQL through the real API: each file's
 * checks stored with the history gap against the last applied statement of the same account (FR 3, AC2), the decisions
 * (FR 10, FR 4, FR 2, FR 7, AC6, AC7) and the readiness to apply (FR 11, AC1, AC3, AC8, AC9); the space's boundary, the
 * batch's states, the audit entries and two decisions at once. The parse step is not a route yet: the test records the
 * checks through the module's `createImportSessionsReview` while the batch is «в обробці» and then marks it «розібрано»,
 * as the parse step will. Every file and name is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let app: ReturnType<typeof buildServer>;
let review: ReturnType<typeof createImportSessionsReview>;
const flags = fakeFlags();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, scoped = false) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({
        userId: space.accountId,
        householdId: space.householdId,
        ...(scoped ? { role: "viewer", scoped: true } : {}),
      }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** A batch with one accepted synthetic CSV; returns the batch's and the batch file's ids. */
async function batchWithFile(space: Space, count = 1): Promise<{ batchId: string; fileIds: string[] }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const parts = Array.from({ length: count }, (_, i) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="vypyska-${i}.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      csv(),
      Buffer.from("\r\n"),
    ]),
  );
  const res = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
  });
  expect(res.statusCode, res.body).toBe(201);
  return { batchId, fileIds: (res.json().files as { id: string }[]).map((f) => f.id) };
}

async function setState(batchId: string, state: string): Promise<void> {
  await db.owner.query(`UPDATE import_sessions.batches SET state = $2 WHERE id = $1`, [batchId, state]);
}

const ACCOUNT = "00000000-0000-4000-8000-00000000ac01";

/** Records each file's checks as the parse step will (the batch «в обробці»), then marks the batch «розібрано». */
async function parsed(
  space: Space,
  batch: { batchId: string; fileIds: string[] },
  checks: StatementChecks | readonly StatementChecks[],
  extra: { accountId?: string | null; currency?: string | null; suggestedAccountId?: string } = {},
): Promise<void> {
  await setState(batch.batchId, "processing");
  for (const [i, fileId] of batch.fileIds.entries())
    await review.record(space.householdId, {
      actorId: space.accountId,
      batchId: batch.batchId,
      batchFileId: fileId,
      account: {
        id: extra.accountId === undefined ? ACCOUNT : extra.accountId,
        currency: extra.currency === undefined ? "EUR" : extra.currency,
      },
      ...(extra.suggestedAccountId ? { suggestedAccountId: extra.suggestedAccountId } : {}),
      checks: Array.isArray(checks) ? checks[i]! : (checks as StatementChecks),
    });
  await setState(batch.batchId, "parsed");
}

function checks(over: Partial<StatementChecks> = {}): StatementChecks {
  return {
    currency: "EUR",
    figures: {
      opening: null,
      closing: null,
      debitTotal: null,
      creditTotal: null,
      operations: null,
      period: null,
      currency: null,
      rows: [],
    },
    controls: [],
    bounds: {
      start: "2026-03-01",
      end: "2026-03-31",
      opening: "1000.00",
      closing: "1440.00",
      currency: "EUR",
    },
    account: { status: "match", reasons: [] },
    signs: {
      rows: [1, 2].map((row) => ({
        row,
        basis: "balance-chain" as const,
        confidence: 0.95,
        confirmed: true,
      })),
      unconfirmed: [],
      card: null,
    },
    clarifications: [],
    flags: [],
    ...over,
  };
}

const readiness = (space: Space, batchId: string) =>
  call(space, "GET", `/v1/import/batches/${batchId}/readiness`);
const decide = (space: Space, batchId: string, decisions: unknown[]) =>
  call(space, "POST", `/v1/import/batches/${batchId}/decisions`, { decisions });

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  review = createImportSessionsReview({
    db: db.databases.for("import-sessions"),
    audit,
    now: clock.now,
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags,
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

/**
 * Security review of PR #636 (IMP-05@PoC part 2) at 3a669065: the properties the PR's own tests leave open — the file
 * of another batch or space in a decision, the roles, the request's bounds, the batch's states, the 30-day cleanup, the
 * row policies of the new tables and the audit entries. The harness above is the PR's own (imp05-batch-decisions).
 */
const mismatch = (): StatementChecks =>
  checks({
    account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
    flags: [
      { code: "foreign-account", severity: "block" },
      { code: "checksum-mismatch", severity: "review", difference: "10.00" },
    ],
  });

describe("SEC-636 IMP-05@PoC FR 10: a decision names only files of its own batch", () => {
  it("a file of another batch of the space and a file of another space are refused alike (422 UNKNOWN_FILE); nothing is written and neither batch gets ready", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const a = await batchWithFile(space);
    const b = await batchWithFile(space);
    const foreign = await batchWithFile(stranger);
    for (const [s, x] of [
      [space, a],
      [space, b],
      [stranger, foreign],
    ] as const)
      await parsed(s, x, mismatch());
    const answers = [];
    for (const fileId of [b.fileIds[0], foreign.fileIds[0], randomUUID()]) {
      const res = await decide(space, a.batchId, [
        { kind: "account", fileId },
        { kind: "balance", fileId, choice: "keep" },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().code).toBe("IMPORT_DECISION_INVALID");
      expect(res.json().errors).toEqual([{ in: "body", path: "decisions[0]", issue: "UNKNOWN_FILE" }]);
      answers.push(JSON.stringify({ ...res.json(), traceId: null, instance: null }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(await count("import_sessions.decisions")).toBe(0);
    // The batch's own decisions settle only this batch.
    expect(
      (
        await decide(space, a.batchId, [
          { kind: "account", fileId: a.fileIds[0] },
          { kind: "balance", fileId: a.fileIds[0], choice: "keep" },
          { kind: "group", fileId: null, group: "review", action: "accept" },
        ])
      ).statusCode,
    ).toBe(200);
    expect((await readiness(space, a.batchId)).json().ready).toBe(true);
    for (const [s, x] of [
      [space, b],
      [stranger, foreign],
    ] as const) {
      const r = (await readiness(s, x.batchId)).json();
      expect(r.ready).toBe(false);
      expect(r.codes).toEqual(["confirm-account", "flags"]);
    }
    // The stored decisions of batch A are not listed under batch B.
    expect((await call(space, "GET", `/v1/import/batches/${b.batchId}/decisions`)).json().decisions).toEqual(
      [],
    );
  });

  it("a forged flag confirmation of «чужий рахунок» or of the control-sum mismatch is refused and leaves the batch refused", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    for (const code of ["foreign-account", "checksum-mismatch"])
      for (const fileId of [batch.fileIds[0], null]) {
        const res = await decide(space, batch.batchId, [{ kind: "flag", fileId, code }]);
        expect(res.statusCode, res.body).toBe(422);
      }
    // All or none: a valid decision before a refused one is not written either.
    const half = await decide(space, batch.batchId, [
      { kind: "account", fileId: batch.fileIds[0] },
      { kind: "balance", fileId: batch.fileIds[0], choice: "sideways" },
    ]);
    expect(half.statusCode).toBe(400);
    const none = await decide(space, batch.batchId, [
      { kind: "account", fileId: batch.fileIds[0] },
      { kind: "flag", fileId: null, code: "card-sign" },
    ]);
    expect(none.statusCode).toBe(422);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    expect((await readiness(space, batch.batchId)).json().codes).toEqual(["confirm-account", "flags"]);
  });
});

describe("SEC-636 IMP-05@PoC: roles and states", () => {
  it("a viewer of the space reads but never decides (403); nothing is written", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    const viewer = (method: "GET" | "POST", url: string, body?: unknown) =>
      app.inject({
        method,
        url,
        headers: {
          origin: WEB,
          ...principalHeader({ userId: randomUUID(), householdId: space.householdId, role: "viewer" }),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
    const res = await viewer("POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [{ kind: "account", fileId: batch.fileIds[0] }],
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    expect((await viewer("GET", `/v1/import/batches/${batch.batchId}/readiness`)).statusCode).toBe(200);
    // No session at all.
    const anonymous = await app.inject({
      method: "GET",
      url: `/v1/import/batches/${batch.batchId}/readiness`,
      headers: { origin: WEB },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("only «розібрано» and «потребує перегляду» take a decision; every other state is 409 and writes nothing", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    const decision = [{ kind: "account", fileId: batch.fileIds[0] }];
    for (const state of ["uploaded", "processing", "failed", "applied", "rolled-back", "cancelled"]) {
      await setState(batch.batchId, state);
      const res = await decide(space, batch.batchId, decision);
      expect([state, res.statusCode]).toEqual([state, 409]);
      expect([state, (await readiness(space, batch.batchId)).statusCode]).toEqual([state, 409]);
    }
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    await setState(batch.batchId, "needs-review");
    expect((await decide(space, batch.batchId, decision)).statusCode).toBe(200);
  });
});

describe("SEC-636 IMP-05@PoC: the request's bounds", () => {
  it("201 decisions, an unknown key, a row out of range, an overlong reading, a body over 64 KiB and a deep JSON are refused; nothing is written", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    const fileId = batch.fileIds[0];
    const one = { kind: "row", fileId, row: 1, action: "accept" };
    const bad: unknown[][] = [
      Array.from({ length: 201 }, () => one),
      [],
      [{ ...one, extra: 1 }],
      [{ ...one, row: 0 }],
      [{ ...one, row: 1_000_001 }],
      [{ ...one, row: 1.5 }],
      [{ kind: "reading", fileId, row: 1, value: "1".repeat(81), applyToFile: false }],
      [{ kind: "reading", fileId, row: 1, value: "1e3", applyToFile: false }],
      [{ kind: "reading", fileId, row: 1, value: "１２３４", applyToFile: false }],
      [{ kind: "account", fileId: "not-a-uuid" }],
      [{ kind: "account", fileId: null }],
      [{ kind: "balance", fileId: null, choice: "keep" }],
      [{ kind: "flag", fileId, code: "__proto__" }],
    ];
    for (const [i, decisions] of bad.entries()) {
      const res = await decide(space, batch.batchId, decisions);
      expect([i, res.statusCode]).toEqual([i, 400]);
      expect(leakText(res.body)).not.toContain("１２３４");
    }
    const big = await call(space, "POST", `/v1/import/batches/${batch.batchId}/decisions`, {
      decisions: [one],
      pad: "x".repeat(70 * 1024),
    });
    expect(big.statusCode).toBe(413);
    const depth = 5000;
    const nested = await app.inject({
      method: "POST",
      url: `/v1/import/batches/${batch.batchId}/decisions`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
        "content-type": "application/json",
      },
      payload: `{"decisions":${"[".repeat(depth)}${"]".repeat(depth)}}`,
    });
    expect(nested.statusCode).toBe(400);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
  });

  it("the slots of a batch are bounded by its checks: 200 decisions in one slot leave one row, and a row outside the checks takes none", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    const fileId = batch.fileIds[0];
    const res = await decide(
      space,
      batch.batchId,
      Array.from({ length: 200 }, (_, i) => ({
        kind: "row",
        fileId,
        row: 1,
        action: i % 2 ? "accept" : "exclude",
      })),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(1);
    expect(
      (await decide(space, batch.batchId, [{ kind: "row", fileId, row: 999, action: "accept" }])).statusCode,
    ).toBe(422);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(1);
  });
});

describe("SEC-636 IMP-05@PoC: the schema of `file_checks` and `decisions`", () => {
  it("both tables have forced row-level security on household_id, and the module's role sees and writes only the bound space", async () => {
    const { rows } = await db.owner.query<{
      relname: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'import_sessions' AND c.relname IN ('file_checks', 'decisions') ORDER BY 1`,
    );
    expect(rows.map((r) => [r.relname, r.rls, r.forced, r.policies > 0])).toEqual([
      ["decisions", true, true, true],
      ["file_checks", true, true, true],
    ]);
    const space = await newSpace();
    const stranger = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    await decide(space, batch.batchId, [{ kind: "account", fileId: batch.fileIds[0] }]);
    const moduleDb = db.databases.for("import-sessions");
    const seen = await moduleDb.inHousehold(stranger.householdId, async (q) => ({
      // No space in the statement: the row policy alone hides the other space's rows.
      checks: (await q.query(`SELECT 1 FROM file_checks`)).rows.length,
      decisions: (await q.query(`SELECT 1 FROM decisions`)).rows.length,
      updated: (await q.query(`UPDATE decisions SET decision = '{"kind":"account"}' RETURNING 1`)).rowCount,
      deleted: (await q.query(`DELETE FROM file_checks RETURNING 1`)).rowCount,
    }));
    expect(seen).toEqual({ checks: 0, decisions: 0, updated: 0, deleted: 0 });
    // A row written for another space than the bound one is refused by the policy.
    await expect(
      moduleDb.inHousehold(stranger.householdId, (q) =>
        q.query(
          `INSERT INTO decisions (household_id, batch_id, slot, decision, decided_by, decided_at)
           VALUES ($1, $2, 'account:x', '{}', $3, now())`,
          [space.householdId, batch.batchId, stranger.accountId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(1);
    expect(await count("import_sessions.file_checks WHERE batch_id = $1", batch.batchId)).toBe(1);
  });

  it("the 30-day cleanup of an unapplied batch removes its checks and decisions; another space's and a fresh batch's stay", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const stale = await batchWithFile(space);
    const kept = await batchWithFile(other);
    await parsed(space, stale, mismatch());
    await parsed(other, kept, mismatch());
    await decide(space, stale.batchId, [{ kind: "account", fileId: stale.fileIds[0] }]);
    await decide(other, kept.batchId, [{ kind: "account", fileId: kept.fileIds[0] }]);
    await db.owner.query(`UPDATE import_sessions.batches SET last_action_at = $2 WHERE id = $1`, [
      kept.batchId,
      new Date(now + 20 * 86_400_000),
    ]);
    const cleanup = createImportSessionsCleanup({
      db: db.databases.for("import-sessions"),
      files,
      audit,
      households: async () => [space.householdId, other.householdId],
      now: () => now + 31 * 86_400_000,
      newId: randomUUID,
    });
    expect(await cleanup.run()).toBe(1);
    for (const table of ["file_checks", "decisions", "batch_files"])
      expect([table, await count(`import_sessions.${table} WHERE batch_id = $1`, stale.batchId)]).toEqual([
        table,
        0,
      ]);
    expect(await count("import_sessions.file_checks WHERE batch_id = $1", kept.batchId)).toBe(1);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", kept.batchId)).toBe(1);
  });
});

describe("SEC-636 IMP-05@PoC: masked values only", () => {
  it("the answers and the audit entries of the checks and decisions carry the masked reasons only — never a reading, a row's cell or an account number", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    const digits = ["UA", "21", "3223", "1300", "0002", "6007", "2335", "6600", "1"].join("");
    await parsed(
      space,
      batch,
      checks({
        currency: null,
        account: {
          status: "mismatch",
          reasons: [{ kind: "iban", file: `…${digits.slice(-4)}`, account: "…1190" }],
        },
        clarifications: [
          {
            kind: "amount",
            row: 1,
            cell: "7.531",
            readings: [
              { decimal: ",", value: "7531" },
              { decimal: ".", value: "7.531" },
            ],
          },
        ],
        flags: [{ code: "foreign-account", severity: "block" }],
      }),
      { currency: null },
    );
    const refused = await decide(space, batch.batchId, [
      { kind: "reading", fileId: batch.fileIds[0], row: 1, value: "75.31", applyToFile: false },
    ]);
    expect(refused.statusCode).toBe(422);
    expect(leakText(refused.body)).not.toContain("75.31");
    const ok = await decide(space, batch.batchId, [
      { kind: "reading", fileId: batch.fileIds[0], row: 1, value: "7531", applyToFile: true },
      { kind: "account", fileId: batch.fileIds[0] },
    ]);
    expect(ok.statusCode, ok.body).toBe(200);
    const ready = await readiness(space, batch.batchId);
    expect(leakText(ready.body)).not.toContain(digits);
    const { rows } = await db.owner.query<{ changes: string }>(
      `SELECT changes::text AS changes FROM audit.entries WHERE household_id = $1 AND entity_id = $2`,
      [space.householdId, batch.batchId],
    );
    expect(rows.length).toBeGreaterThan(0);
    const all = rows.map((r) => r.changes).join("\n");
    for (const secret of ["7531", "7.531", digits, digits.slice(-4), "1190", "…"])
      expect(all).not.toContain(secret);
    const stored = await db.owner.query<{ t: string }>(
      `SELECT checks::text || history::text AS t FROM import_sessions.file_checks WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(stored.rows[0]!.t).not.toContain(digits);
  });
});

describe("SEC-636 IMP-05@PoC FR 10: the checks are recorded only for the batch's own file while it is «в обробці»", () => {
  const input = (space: Space, batchId: string, batchFileId: string) => ({
    actorId: space.accountId,
    batchId,
    batchFileId,
    account: { id: ACCOUNT, currency: "EUR" },
    checks: checks(),
  });

  it("a file of another batch of the space is «not found»: no checks appear under the batch", async () => {
    const space = await newSpace();
    const a = await batchWithFile(space);
    const b = await batchWithFile(space);
    await setState(a.batchId, "processing");
    await setState(b.batchId, "processing");
    await expect(review.record(space.householdId, input(space, a.batchId, b.fileIds[0]!))).rejects.toThrow(
      "Batch not found",
    );
    expect(await count("import_sessions.file_checks WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("a parsed or applied batch takes no new record: its mismatch and the decisions on it stay as they were", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, mismatch());
    expect(
      (await decide(space, batch.batchId, [{ kind: "balance", fileId: batch.fileIds[0], choice: "keep" }]))
        .statusCode,
    ).toBe(200);
    for (const state of ["parsed", "needs-review", "applied", "rolled-back", "cancelled"]) {
      await setState(batch.batchId, state);
      await expect(
        review.record(space.householdId, input(space, batch.batchId, batch.fileIds[0]!)),
      ).rejects.toThrow();
    }
    expect(
      await count(
        "import_sessions.file_checks WHERE batch_id = $1 AND checks -> 'account' ->> 'status' = 'mismatch'",
        batch.batchId,
      ),
    ).toBe(1);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(1);
  });
});
