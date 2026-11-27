import { randomBytes, randomUUID } from "node:crypto";
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
import { createLedger } from "../src/modules/ledger/index.ts";
import { createImportCandidates, createImportedTransactions } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * The server part of the wizard's step «Перевірка розпізнавання» (IMP-08@PoC FR 6, FR 7, AC3–AC6; IMP-06@PoC FR 8;
 * IMP-04@PoC FR 3, FR 4 before the apply; plan row 137, part 1 of 2) on a real PostgreSQL through the real API,
 * the real parse worker and module transactions: each row's state, decision and readings; the file's counts, its sign
 * group and the engine's decisions with «чому так»; the duplicate preview by the apply's own plan, then the apply
 * agreeing with it. Another space and a scoped member are «not found»; the IBAN of a row is masked. Synthetic data
 * only; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// A synthetic IBAN built so no real-looking literal sits in the source.
const OTHER_IBAN = ["UA", "00", "111111", "0000000", "222222", "334821"].join("");

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
  /** A currency of three decimals: «1.234» reads both ways (IMP-05 FR 7). */
  readonly kwd: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const [eur, kwd] = [randomUUID(), randomUUID()];
  for (const [id, currency] of [
    [eur, "EUR"],
    [kwd, "KWD"],
  ] as const)
    accountsOf.set(`${householdId}/${id}`, {
      accountId: id,
      kind: "current",
      status: "active",
      subaccounts: [{ subaccountId: randomUUID(), currency, ledgerAccountId: randomUUID() }],
    });
  return { accountId, householdId, eur, kwd };
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

/** Four amounts that read both ways, all positive: every sign «не підтверджено» (majority), every amount a question. */
const AMBIGUOUS = text([
  "Дата;Сума;Опис",
  "15.03.2026;1.234;Кава один",
  "16.03.2026;2.500;Кава два",
  `17.03.2026;3.750;Книга ${OTHER_IBAN}`,
  "18.03.2026;4.100;Таксі",
]);

/** 1 000,00 → 1 440,00 EUR, its figures agree: nothing to review. */
const CLEAN = text([
  "Вхідний залишок:;1000.00 EUR",
  "Дата;Сума;Опис",
  "15.03.2026;500.00;Зарплата ТОВ «Вигадка»",
  "20.03.2026;-60.00;Кава",
  "Кінцевий залишок:;1440.00 EUR",
]);

/** The same account's next statement overlapping CLEAN by its last row (IMP-04 FR 4). */
const OVERLAP = text([
  "Вхідний залишок:;1500.00 EUR",
  "Дата;Сума;Опис",
  "20.03.2026;-60.00;Кава",
  "25.03.2026;-40.00;Книга",
  "Кінцевий залишок:;1400.00 EUR",
]);

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

async function parsed(space: Space, bytes: Buffer, accountId: string) {
  const batch = await batchWith(space, [{ name: "berezen.csv", bytes }]);
  const started = await call(space, "POST", `/v1/import/batches/${batch.batchId}/parse`, {
    files: batch.fileIds.map((fileId) => ({ fileId, accountId })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return { batchId: batch.batchId, fileId: batch.fileIds[0]! };
}

const fileUrl = (b: { batchId: string; fileId: string }, tail: string) =>
  `/v1/import/batches/${b.batchId}/files/${b.fileId}/${tail}`;

const decide = (space: Space, batchId: string, decisions: unknown[]) =>
  call(space, "POST", `/v1/import/batches/${batchId}/decisions`, { decisions });

interface Row {
  row: number;
  state: string;
  decision: { action: string; from: string } | null;
  changed: boolean;
  signUnconfirmed: boolean;
  sign: { basis: string; confidence: number; confirmed: boolean } | null;
  reading: {
    cell: string;
    readings: { decimal: string; value: string }[];
    chosen: string | null;
    evidence: { code: string }[];
  } | null;
  issue: string | null;
  bankStatus: string | null;
}

async function rows(space: Space, b: { batchId: string; fileId: string }, query = ""): Promise<Row[]> {
  const res = await call(space, "GET", fileUrl(b, `review/rows${query}`));
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as Row[];
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
            }),
          },
          preview: { candidates: createImportCandidates(db.databases.for("transactions")) },
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

describe("IMP-08@PoC: the rows of «Перевірка розпізнавання»", () => {
  it("IMP-08@PoC FR 7, AC4: an ambiguous amount offers its readings with «чому так»; the reading chosen in one decision answers the row and marks it changed", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    const before = await rows(space, b);
    expect(before.map((r) => r.row)).toEqual([2, 3, 4, 5]);
    const first = before[0]!;
    expect(first).toMatchObject({
      row: 2,
      state: "needs-clarification",
      decision: null,
      changed: false,
      reading: { cell: "1.234", chosen: null },
      bankStatus: null,
    });
    expect(first.reading!.readings.map((r) => r.value).sort()).toEqual(["1.234", "1234"]);
    // «чому так»: the evidence of the file's number format.
    expect(first.reading!.evidence.map((e) => e.code)).toContain("ambiguous-integers");

    // The candidate value is what a `reading` decision takes, as served.
    const value = first.reading!.readings.find((r) => r.value === "1.234")!.value;
    const res = await decide(space, b.batchId, [
      { kind: "reading", fileId: b.fileId, row: 2, value, applyToFile: false },
      { kind: "row", fileId: b.fileId, row: 2, action: "accept" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const after = (await rows(space, b))[0]!;
    expect(after).toMatchObject({
      state: "ok",
      changed: true,
      decision: { action: "accept", from: "row" },
      reading: { chosen: "1.234" },
    });
    expect(after.reading!.evidence.length).toBeGreaterThan(0);
  });

  it("IMP-08@PoC FR 6, AC5: the group «знак не підтверджено» lists its rows; «Перевернути знак» for the group flips them all and no recipe changes", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    const review = await call(space, "GET", fileUrl(b, "review"));
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().signGroup).toEqual({ rows: 4, action: null });
    const group = await rows(space, b, "?filter=sign-unconfirmed");
    expect(group.map((r) => [r.row, r.signUnconfirmed, r.sign?.confirmed])).toEqual([
      [2, true, false],
      [3, true, false],
      [4, true, false],
      [5, true, false],
    ]);

    const res = await decide(space, b.batchId, [
      { kind: "group", fileId: b.fileId, group: "review", action: "flip-sign" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const flipped = await rows(space, b, "?filter=sign-unconfirmed");
    expect(
      flipped.every((r) => r.changed && r.decision?.action === "flip-sign" && r.decision.from === "group"),
    ).toBe(true);
    expect((await call(space, "GET", fileUrl(b, "review"))).json().signGroup).toEqual({
      rows: 4,
      action: "flip-sign",
    });
    const { rows: recipes } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM import_recipes.recipes WHERE household_id = $1`,
      [space.householdId],
    );
    expect(recipes[0]!.n).toBe(0);
  });

  it("IMP-08@PoC FR 6, AC6: a row the person changed is marked changed and found by the filter «змінені»", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    expect(await rows(space, b, "?filter=changed")).toEqual([]);
    const res = await decide(space, b.batchId, [
      { kind: "row", fileId: b.fileId, row: 3, action: "flip-sign" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const changed = await rows(space, b, "?filter=changed");
    expect(changed.map((r) => [r.row, r.changed, r.decision])).toEqual([
      [3, true, { action: "flip-sign", from: "row" }],
    ]);
    // Excluding a row is a decision, not a changed value.
    await decide(space, b.batchId, [{ kind: "row", fileId: b.fileId, row: 4, action: "exclude" }]);
    expect((await rows(space, b, "?filter=excluded")).map((r) => [r.row, r.changed])).toEqual([[4, false]]);
  });

  it("IMP-08@PoC AC3: the file's counts by state follow the decisions", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    const counts = async () => (await call(space, "GET", fileUrl(b, "review"))).json().counts;
    expect(await counts()).toEqual({
      rows: 4,
      states: { ok: 0, "needs-review": 0, "needs-clarification": 4, error: 0, excluded: 0 },
      changed: 0,
      signUnconfirmed: 4,
    });
    await decide(space, b.batchId, [
      { kind: "reading", fileId: b.fileId, row: 2, value: "1.234", applyToFile: true },
      { kind: "row", fileId: b.fileId, row: 5, action: "exclude" },
    ]);
    expect(await counts()).toEqual({
      rows: 4,
      states: { ok: 0, "needs-review": 3, "needs-clarification": 0, error: 0, excluded: 1 },
      changed: 3,
      signUnconfirmed: 4,
    });
  });

  it("IMP-06@PoC FR 8: the engine's decisions come with alternatives, scores, examples and evidence; a number in a text of the file is masked", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    const res = await call(space, "GET", fileUrl(b, "review"));
    expect(res.statusCode, res.body).toBe(200);
    const { analysis, encoding, delimiter } = res.json();
    expect(analysis.numbers.chosen.score).toBeGreaterThan(0);
    expect(analysis.numbers.alternatives.length).toBeGreaterThan(0);
    expect(analysis.numbers.chosen.examples[0]).toEqual({ cell: "1.234", reads: expect.any(String) });
    expect(analysis.columns.map((c: { role: { chosen: { value: string } } }) => c.role.chosen.value)).toEqual(
      ["date", "amount", "description"],
    );
    expect(encoding.chosen).toMatchObject({ value: expect.any(String), score: expect.any(Number) });
    expect(delimiter.chosen.value).toBe(";");
    expect(leakText(res.body)).not.toContain(OTHER_IBAN);
    expect(leakText(res.body)).not.toContain("0000000222222");
  });

  it("ARC-07@PoC FR 4: the review's rows come a page at a time in the order of the file", async () => {
    const space = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    const first = await call(space, "GET", fileUrl(b, "review/rows?limit=3"));
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items.map((r: Row) => r.row)).toEqual([2, 3, 4]);
    const next = await call(
      space,
      "GET",
      fileUrl(b, `review/rows?limit=3&cursor=${first.json().nextCursor}`),
    );
    expect(next.json()).toMatchObject({ items: [{ row: 5 }], nextCursor: null });
    expect((await call(space, "GET", fileUrl(b, "review/rows?limit=101"))).statusCode).toBe(400);
  });

  it("IMP-08@PoC: another space, a scoped member, a file not of the batch — «not found»; an unparsed file — 409 without a value", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const b = await parsed(space, AMBIGUOUS, space.kwd);
    for (const tail of ["review", "review/rows", "duplicates"]) {
      expect((await call(stranger, "GET", fileUrl(b, tail))).statusCode, tail).toBe(404);
      expect((await call(space, "GET", fileUrl(b, tail), undefined, true)).statusCode, tail).toBe(404);
      expect((await call(space, "GET", fileUrl({ ...b, fileId: randomUUID() }, tail))).statusCode, tail).toBe(
        404,
      );
    }
    const pending = await batchWith(space, [{ name: "berezen.csv", bytes: AMBIGUOUS }]);
    await call(space, "POST", `/v1/import/batches/${pending.batchId}/parse`, {});
    const res = await call(
      space,
      "GET",
      fileUrl({ batchId: pending.batchId, fileId: pending.fileIds[0]! }, "review"),
    );
    expect(res.statusCode).toBe(409);
    expect(leakText(res.body)).not.toContain("1.234");
  });
});

describe("IMP-04@PoC before the apply: the duplicate preview", () => {
  it("IMP-04@PoC FR 4: a row of an overlapping statement shows «дубль» with the transaction it matches; the apply leaves out the same rows", async () => {
    const space = await newSpace();
    const first = await parsed(space, CLEAN, space.eur);
    expect((await call(space, "POST", `/v1/import/batches/${first.batchId}/apply`)).statusCode).toBe(200);
    const { rows: written } = await db.owner.query<{ id: string; import_row: number }>(
      `SELECT id, import_row FROM transactions.transactions WHERE household_id = $1 ORDER BY import_row`,
      [space.householdId],
    );
    const coffee = written.find((r) => r.import_row === 4)!.id;

    const next = await parsed(space, OVERLAP, space.eur);
    const res = await call(space, "GET", fileUrl(next, "duplicates"));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      accountId: space.eur,
      afterEarlierFile: false,
      items: [
        { row: 3, occurrence: 1, kind: "duplicate", transactionIds: [coffee], batchId: null, merge: false },
      ],
      nextCursor: null,
    });
    // Read only: nothing written by the preview.
    const { rows: count } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions WHERE household_id = $1`,
      [space.householdId],
    );
    expect(count[0]!.n).toBe(2);

    const applied = await call(space, "POST", `/v1/import/batches/${next.batchId}/apply`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().result.counts).toMatchObject({ import: 1, duplicate: 1 });
  });

  it("IMP-04@PoC FR 3, JRN-06 FR 1: the same file again — every row «дубль — уже імпортовано» with the batch it was applied in", async () => {
    const space = await newSpace();
    const first = await parsed(space, CLEAN, space.eur);
    expect((await call(space, "POST", `/v1/import/batches/${first.batchId}/apply`)).statusCode).toBe(200);
    const again = await parsed(space, CLEAN, space.eur);
    const res = await call(space, "GET", fileUrl(again, "duplicates?limit=1"));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toEqual([
      {
        row: 3,
        occurrence: 1,
        kind: "already-imported",
        transactionIds: [],
        batchId: first.batchId,
        merge: false,
      },
    ]);
    const page2 = await call(
      space,
      "GET",
      fileUrl(again, `duplicates?limit=1&cursor=${res.json().nextCursor}`),
    );
    expect(page2.json()).toMatchObject({ items: [{ row: 4, kind: "already-imported" }], nextCursor: null });
    // Only before the apply: the applied batch's own rows are in the books.
    expect((await call(space, "GET", fileUrl(first, "duplicates"))).statusCode).toBe(409);
  });
});
