import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser, type StatementChecks } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { csv } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import {
  createImportSessionsReview,
  createImportSessionsServices,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
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

const parser = isolatedStatementParser();
const statement = (lines: readonly string[]) =>
  parser.parse(new TextEncoder().encode(lines.join("\n")), { delimiter: ";" });

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

describe("IMP-05@PoC FR 2: the control-sum mismatch", () => {
  it("IMP-05@PoC AC1: a statement 1 000,00 → 1 450,00 EUR with rows of +440,00 is refused with the difference 10,00 and both choices; «Застосувати без оновлення залишку» lets it apply", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    const parse = await statement([
      "Вхідний залишок:;1 000,00 EUR",
      "Дата;Сума;Опис",
      "15.03.2026;500,00;Зарплата",
      "20.03.2026;-60,00;Кава",
      "Кінцевий залишок:;1 450,00 EUR",
    ]);
    await parsed(space, batch, parse.checks);
    const refused = await readiness(space, batch.batchId);
    expect(refused.statusCode, refused.body).toBe(200);
    expect(refused.json()).toMatchObject({
      ready: false,
      codes: ["flags"],
      refusals: [
        {
          code: "flags",
          message: { uk: "Не підтверджені позначки" },
          files: [
            {
              fileId: batch.fileIds[0],
              flags: [{ code: "checksum-mismatch", difference: "10.00", choices: ["update", "keep"] }],
            },
          ],
        },
      ],
    });
    const chosen = await decide(space, batch.batchId, [
      { kind: "balance", fileId: batch.fileIds[0], choice: "keep" },
    ]);
    expect(chosen.statusCode, chosen.body).toBe(200);
    const ready = (await readiness(space, batch.batchId)).json();
    expect(ready).toMatchObject({ ready: true, refusals: [], files: [{ balance: "keep" }] });
  });
});

describe("IMP-05@PoC FR 11: the readiness to apply", () => {
  it("IMP-05@PoC AC9: a statement whose figures agree and that has no flag is ready with no decision", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    const parse = await statement([
      "Вхідний залишок:;1 000,00 EUR",
      "Дата;Сума;Опис",
      "15.03.2026;500,00;Зарплата",
      "20.03.2026;-60,00;Кава",
      "Кінцевий залишок:;1 440,00 EUR",
    ]);
    expect(parse.checks.flags).toEqual([]);
    await parsed(space, batch, parse.checks);
    const res = await readiness(space, batch.batchId);
    expect(res.json()).toMatchObject({ ready: true, refusals: [], codes: [], files: [{ balance: null }] });
    expect(
      (await call(space, "GET", `/v1/import/batches/${batch.batchId}/decisions`)).json().decisions,
    ).toEqual([]);
  });

  it("IMP-05@PoC AC8: an unanswered clarification refuses with «Потрібні уточнення»", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(
      space,
      batch,
      checks({
        currency: null,
        clarifications: [
          {
            kind: "amount",
            row: 2,
            cell: "1.234",
            readings: [
              { decimal: ",", value: "1234" },
              { decimal: ".", value: "1.234" },
            ],
          },
        ],
      }),
      { currency: null },
    );
    const res = (await readiness(space, batch.batchId)).json();
    expect(res.ready).toBe(false);
    expect(res.refusals).toEqual([
      {
        code: "clarifications",
        message: { uk: "Потрібні уточнення", en: "Clarifications needed" },
        files: [{ fileId: batch.fileIds[0], rows: [2], count: 1, dateOrder: false }],
      },
    ]);
  });

  it("IMP-05@PoC FR 11: a batch with a file not checked yet, or not parsed, has no readiness (409)", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space, 2);
    await setState(batch.batchId, "processing");
    await review.record(space.householdId, {
      actorId: space.accountId,
      batchId: batch.batchId,
      batchFileId: batch.fileIds[0]!,
      account: { id: ACCOUNT, currency: "EUR" },
      checks: checks(),
    });
    expect((await readiness(space, batch.batchId)).statusCode).toBe(409);
    await setState(batch.batchId, "parsed");
    expect((await readiness(space, batch.batchId)).json().code).toBe("BATCH_STATE_CONFLICT");
  });
});

describe("IMP-05@PoC FR 3: the history gap against the last applied statement of the account", () => {
  it("IMP-05@PoC AC2: the previous statement ends 2026-03-31 at 2 000,00 EUR, the new one starts 2026-04-15 at 2 300,00 — a gap 2026-04-01 — 2026-04-14 of 300,00", async () => {
    const space = await newSpace();
    const bounds = (start: string, end: string, opening: string, closing: string) =>
      checks({ bounds: { start, end, opening, closing, currency: "EUR" } });
    // Two applied statements of the account: the later one is the previous statement.
    const older = await batchWithFile(space);
    await parsed(space, older, bounds("2026-02-01", "2026-02-28", "1500.00", "1800.00"));
    await setState(older.batchId, "applied");
    const previous = await batchWithFile(space);
    await parsed(space, previous, bounds("2026-03-01", "2026-03-31", "1800.00", "2000.00"));
    await setState(previous.batchId, "applied");
    // Not applied, or another account's: never the previous statement.
    const open = await batchWithFile(space);
    await parsed(space, open, bounds("2026-04-01", "2026-04-10", "2000.00", "2100.00"));
    const other = await batchWithFile(space);
    await parsed(space, other, bounds("2026-04-01", "2026-04-12", "5.00", "9.00"), {
      accountId: randomUUID(),
    });
    await setState(other.batchId, "applied");

    const next = await batchWithFile(space);
    await parsed(space, next, bounds("2026-04-15", "2026-04-30", "2300.00", "2400.00"));
    const res = (await readiness(space, next.batchId)).json();
    expect(res.files[0].history).toEqual({
      status: "gap",
      range: { from: "2026-04-01", to: "2026-04-14" },
      previousClosing: "2000.00",
      newOpening: "2300.00",
      difference: "300.00",
      currency: "EUR",
    });
    const { rows } = await db.owner.query<{ previous_file_id: string }>(
      `SELECT previous_file_id FROM import_sessions.file_checks WHERE batch_file_id = $1`,
      [next.fileIds[0]],
    );
    expect(rows[0]!.previous_file_id).toBe(previous.fileIds[0]);
  });

  it("IMP-05@PoC FR 3: without an account or an applied statement the history is «невідомо»; another space's statement never counts", async () => {
    const space = await newSpace();
    const elsewhere = await newSpace();
    const theirs = await batchWithFile(elsewhere);
    await parsed(elsewhere, theirs, checks());
    await setState(theirs.batchId, "applied");
    const mine = await batchWithFile(space);
    await parsed(space, mine, checks({ bounds: { ...checks().bounds, start: "2026-04-01" } }));
    expect((await readiness(space, mine.batchId)).json().files[0].history.status).toBe("unknown");
    const none = await batchWithFile(space);
    await parsed(space, none, checks(), { accountId: null });
    expect((await readiness(space, none.batchId)).json().files[0].history.status).toBe("unknown");
  });
});

describe("IMP-05@PoC FR 4: another account's file", () => {
  it("IMP-05@PoC AC3: refused with the masked reasons and the suggested account; after «Так, це правильний рахунок» it may apply", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    const suggested = randomUUID();
    await parsed(
      space,
      batch,
      checks({
        account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
        flags: [{ code: "foreign-account", severity: "block" }],
      }),
      { suggestedAccountId: suggested },
    );
    const refused = (await readiness(space, batch.batchId)).json();
    expect(refused).toMatchObject({
      ready: false,
      refusals: [
        {
          code: "confirm-account",
          message: { uk: "Підтвердіть рахунок" },
          files: [
            {
              fileId: batch.fileIds[0],
              reasons: [{ kind: "iban", file: "…4821", account: "…1190" }],
              suggestedAccountId: suggested,
            },
          ],
        },
      ],
    });
    const confirmed = await decide(space, batch.batchId, [{ kind: "account", fileId: batch.fileIds[0] }]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((await readiness(space, batch.batchId)).json().ready).toBe(true);
    // The audit entry holds kinds and counts, never a masked value.
    const { rows } = await db.owner.query<{ changes: unknown }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch'`,
      [space.householdId],
    );
    expect(JSON.stringify(rows)).not.toMatch(/4821|1190/);
    expect(JSON.stringify(rows)).toContain("account");
  });
});

describe("IMP-05@PoC FR 7, FR 10: decisions", () => {
  const ambiguous = () =>
    checks({
      currency: null,
      clarifications: [2, 3].map((row) => ({
        kind: "amount" as const,
        row,
        cell: row === 2 ? "1.234" : "5.678",
        readings: [
          { decimal: "," as const, value: row === 2 ? "1234" : "5678" },
          { decimal: "." as const, value: row === 2 ? "1.234" : "5.678" },
        ],
      })),
      signs: {
        rows: [1, 2, 3].map((row) => ({
          row,
          basis: "balance-chain" as const,
          confidence: 0.95,
          confirmed: true,
        })),
        unconfirmed: [],
        card: null,
      },
    });

  it("IMP-05@PoC AC6: «1 234» with «застосувати до файлу» is kept, and the file's similar rows read the same way", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, ambiguous(), { currency: null });
    const res = await decide(space, batch.batchId, [
      { kind: "reading", fileId: batch.fileIds[0], row: 2, value: "1234", applyToFile: true },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().decisions).toEqual([
      {
        decision: { kind: "reading", fileId: batch.fileIds[0], row: 2, value: "1234", applyToFile: true },
        decidedAt: new Date(now).toISOString(),
      },
    ]);
    expect((await readiness(space, batch.batchId)).json().ready).toBe(true);
    const plan = await review.readiness(space.householdId, batch.batchId);
    expect(plan.files[0]!.readings).toEqual([
      { row: 2, value: "1234" },
      { row: 3, value: "5678" },
    ]);
  });

  it("IMP-05@PoC AC7: with EUR a reading with three decimals is refused and nothing is written", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, ambiguous(), { currency: "EUR" });
    const before = (await call(space, "GET", `/v1/import/batches/${batch.batchId}`)).json().version;
    const res = await decide(space, batch.batchId, [
      { kind: "row", fileId: batch.fileIds[0], row: 3, action: "accept" },
      { kind: "reading", fileId: batch.fileIds[0], row: 2, value: "1.234", applyToFile: false },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: "READING_TOO_PRECISE",
      errors: [{ in: "body", path: "decisions[1]", issue: "READING_TOO_PRECISE" }],
    });
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    expect((await call(space, "GET", `/v1/import/batches/${batch.batchId}`)).json().version).toBe(before);
    const unknown = await decide(space, batch.batchId, [
      { kind: "row", fileId: randomUUID(), row: 1, action: "accept" },
    ]);
    expect(unknown.json()).toMatchObject({ code: "IMPORT_DECISION_INVALID", status: 422 });
  });

  it("IMP-05@PoC FR 10: decisions repeat until apply — the later one replaces the earlier; a new parse of the file drops them; an applied batch takes none", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    const mismatch = checks({
      flags: [{ code: "checksum-mismatch", severity: "review", difference: "10.00" }],
    });
    await parsed(space, batch, mismatch);
    const fileId = batch.fileIds[0];
    expect(
      (await decide(space, batch.batchId, [{ kind: "balance", fileId, choice: "keep" }])).statusCode,
    ).toBe(200);
    const again = await decide(space, batch.batchId, [
      { kind: "balance", fileId, choice: "update" },
      { kind: "row", fileId, row: 1, action: "exclude" },
      { kind: "row", fileId, row: 1, action: "include" },
    ]);
    expect(again.json().decisions.map((d: { decision: unknown }) => d.decision)).toEqual([
      { kind: "balance", fileId, choice: "update" },
      { kind: "row", fileId, row: 1, action: "include" },
    ]);
    expect((await readiness(space, batch.batchId)).json().files[0].balance).toBe("update");

    await parsed(space, batch, mismatch);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    expect((await readiness(space, batch.batchId)).json().ready).toBe(false);

    await setState(batch.batchId, "applied");
    const late = await decide(space, batch.batchId, [{ kind: "balance", fileId, choice: "keep" }]);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe("BATCH_STATE_CONFLICT");
  });

  it("IMP-05@PoC FR 10: two decisions at once in the same slot — both are taken in turn, one stands, each has its audit entry", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, checks({ flags: [{ code: "checksum-mismatch", severity: "review" }] }));
    const fileId = batch.fileIds[0];
    const before = (await call(space, "GET", `/v1/import/batches/${batch.batchId}`)).json().version as number;
    const entries = () =>
      count(
        "audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND changes::text LIKE '%decisions.kinds%'",
        space.householdId,
      );
    const [a, b] = await Promise.all([
      decide(space, batch.batchId, [{ kind: "balance", fileId, choice: "keep" }]),
      decide(space, batch.batchId, [{ kind: "balance", fileId, choice: "update" }]),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const stored = await call(space, "GET", `/v1/import/batches/${batch.batchId}/decisions`);
    expect(stored.json().decisions).toHaveLength(1);
    expect(["keep", "update"]).toContain(stored.json().decisions[0].decision.choice);
    expect(stored.json().version).toBe(before + 2);
    expect(new Set([a.json().version, b.json().version])).toEqual(new Set([before + 1, before + 2]));
    expect(await entries()).toBe(2);
  });

  it("IMP-05@PoC FR 10: «Видалити» removes the batch's checks and decisions with it", async () => {
    const space = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, checks({ flags: [{ code: "no-transactions", severity: "review" }] }));
    await decide(space, batch.batchId, [{ kind: "flag", fileId: null, code: "no-transactions" }]);
    expect((await call(space, "DELETE", `/v1/import/batches/${batch.batchId}`)).statusCode).toBe(200);
    expect(await count("import_sessions.file_checks WHERE batch_id = $1", batch.batchId)).toBe(0);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
  });
});

describe("IMP-05@PoC: the space's boundary", () => {
  it("IMP-05@PoC FR 10, FR 11: another space's batch is «not found» on every route, and a scoped member sees none; nothing is written", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const batch = await batchWithFile(space);
    await parsed(space, batch, checks({ flags: [{ code: "no-transactions", severity: "review" }] }));
    const decision = [{ kind: "flag", fileId: null, code: "no-transactions" }];
    for (const res of [
      await readiness(stranger, batch.batchId),
      await call(stranger, "GET", `/v1/import/batches/${batch.batchId}/decisions`),
      await decide(stranger, batch.batchId, decision),
      await call(space, "GET", `/v1/import/batches/${batch.batchId}/readiness`, undefined, true),
      await call(space, "GET", `/v1/import/batches/${batch.batchId}/decisions`, undefined, true),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
    // A scoped viewer has no write right at all (403) or sees no batch (404).
    const scoped = await call(
      space,
      "POST",
      `/v1/import/batches/${batch.batchId}/decisions`,
      { decisions: decision },
      true,
    );
    expect([403, 404]).toContain(scoped.statusCode);
    expect(await count("import_sessions.decisions WHERE batch_id = $1", batch.batchId)).toBe(0);
    await expect(
      review.record(stranger.householdId, {
        actorId: stranger.accountId,
        batchId: batch.batchId,
        batchFileId: batch.fileIds[0]!,
        account: { id: null, currency: null },
        checks: checks(),
      }),
    ).rejects.toThrow("Batch not found");
  });
});
