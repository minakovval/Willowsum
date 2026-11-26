import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { bankDirectory, type AccountDirectory, type PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  createImportRecipesReader,
  createImportRecipesServices,
} from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { leakText } from "./leak-text.ts";

/**
 * IMP-08@PoC FR 2, server part (plan row 230): `GET /v1/import/batches/{id}/parse` gives each parsed file
 * `detected { bank?, currency?, mask? }` — the bank of accounts' directory the file names (exact or normalised match;
 * none — absent), the one currency and the card or IBAN as «…» and its last 4 characters — for «Створити рахунок».
 * Real PostgreSQL, the real API, the real worker queue and parse worker, accounts' real directory of banks. Every
 * file, name and number is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// Synthetic IBANs, built so no real-looking literal sits in the source.
const IBAN = ["LT", "00", "0000", "0000", "0000", "5678"].join("");
const CARD = ["5375", "41", "**", "****", "1234"].join("");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;
const flags = fakeFlags();
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => {
    const found = accountsOf.get(`${householdId}/${accountId}`);
    return found ?? null;
  },
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  /** The space's EUR account (the accounts port). */
  readonly eur: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const eur = randomUUID();
  accountsOf.set(`${householdId}/${eur}`, {
    accountId: eur,
    kind: "current",
    status: "active",
    subaccounts: [{ subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() }],
  });
  return { accountId, householdId, eur };
}

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  options: { scoped?: boolean } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({
        userId: space.accountId,
        householdId: space.householdId,
        ...(options.scoped ? { role: "viewer", scoped: true } : {}),
      }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const text = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A batch with the files uploaded; returns its id and the batch files' ids in order. */
async function batchWith(
  space: Space,
  parts: readonly { name: string; bytes: Buffer; type?: string }[],
): Promise<{ batchId: string; fileIds: string[] }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const body = Buffer.concat([
    ...parts.map((p) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\nContent-Type: ${p.type ?? "text/csv"}\r\n\r\n`,
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

const parse = (space: Space, batchId: string, body: unknown = {}) =>
  call(space, "POST", `/v1/import/batches/${batchId}/parse`, body);
const view = (space: Space, batchId: string) => call(space, "GET", `/v1/import/batches/${batchId}/parse`);

/** Runs the space's queue until nothing is due: the parse jobs, then the audit hand-offs they queued. */
async function work(householdId: string): Promise<void> {
  const worker = createWorker({
    queues: [
      createImportSessionsWorkerQueue(db.databases.for("import-sessions"), audit, {
        modules: {
          files,
          keys,
          recipes: createImportRecipesReader(db.databases.for("import-recipes")),
          accounts,
          banks: bankDirectory,
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

beforeAll(async () => {
  db = await setupRealModules(6);
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
        flags,
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          parse: {
            recipes: createImportRecipesReader(db.databases.for("import-recipes")),
            accounts,
            keys,
          },
        }),
        importRecipes: createImportRecipesServices({ keys, audit, clock, newId: randomUUID }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

/** A monobank-like card statement: the bank's name and a masked card before the table, hryvnias. */
const MONOBANK = text([
  "Банк;АТ «Універсал Банк» (monobank)",
  `Картка;${CARD.slice(0, 4)} ${CARD.slice(4, 8)} ${CARD.slice(8, 12)} ${CARD.slice(12)}`,
  "Дата;Сума;Валюта;Опис",
  "01.03.2026;-12.50;UAH;Кава",
  "02.03.2026;-40.00;UAH;Продукти",
]);

/** A Revolut-like EUR statement: its bank is not in the NBU directory; a masked card and an IBAN. */
const REVOLUT = text([
  "Bank;Revolut Bank UAB",
  "Card;**** 5678",
  `IBAN;${IBAN.replace(/(.{4})/g, "$1 ").trim()}`,
  "Date;Amount;Currency;Description",
  "01.03.2026;-12.50;EUR;Coffee",
  "02.03.2026;-40.00;EUR;Groceries",
]);

/** A statement that names no bank, card or IBAN. */
const PLAIN = text([
  "Виписка;за березень",
  "Дата;Сума;Опис",
  "01.03.2026;-1.00;Кава",
  "02.03.2026;-2.00;Чай",
]);

describe("IMP-08@PoC FR 2 (server part): the parse gives each file what it says about its account", () => {
  it("IMP-08@PoC FR 2: a monobank-like and a Revolut-like statement without an account — bank, currency and card masked; no directory bank for Revolut", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [
      { name: "mono.csv", bytes: MONOBANK },
      { name: "revolut.csv", bytes: REVOLUT },
      { name: "plain.csv", bytes: PLAIN },
    ]);
    const pending = (await view(space, batch.batchId)).json();
    expect(pending.files.every((f: { detected: unknown }) => f.detected === undefined)).toBe(true);
    expect((await parse(space, batch.batchId)).statusCode).toBe(200);
    await work(space.householdId);
    const res = await view(space, batch.batchId);
    expect(res.statusCode, res.body).toBe(200);
    const byId = new Map(
      (res.json().files as { fileId: string; state: string; detected: unknown; checks: object }[]).map(
        (f) => [f.fileId, f],
      ),
    );
    const [mono, revolut, plain] = batch.fileIds.map((id) => byId.get(id)!);
    expect(mono!.state).toBe("parsed");
    expect(mono!.detected).toEqual({ bank: "Універсал Банк (monobank)", currency: "UAH", mask: "…1234" });
    expect(revolut!.detected).toEqual({ currency: "EUR", mask: "…5678" });
    expect(plain!.detected).toEqual({});
    // Only the masked form leaves the API: no full IBAN and no visible card digits but the last 4; `detected` is
    // its own field, not repeated in the checks.
    expect(leakText(res.body)).not.toContain(IBAN);
    expect(leakText(res.body)).not.toContain(IBAN.slice(2, 12));
    expect(leakText(res.body)).not.toContain("537541");
    expect(mono!.checks).not.toHaveProperty("detected");
    // Stored masked too.
    const { rows } = await db.owner.query<{ checks: string }>(
      "SELECT checks::text AS checks FROM import_sessions.file_checks WHERE household_id = $1",
      [space.householdId],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.checks).not.toContain(IBAN);
      expect(r.checks).not.toContain("537541");
    }
  });

  it("IMP-08@PoC FR 2: another space's batch is not found — its detected facts are never shown", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const batch = await batchWith(owner, [{ name: "mono.csv", bytes: MONOBANK }]);
    await parse(owner, batch.batchId);
    await work(owner.householdId);
    const res = await view(stranger, batch.batchId);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain("…1234");
    expect((await view(owner, batch.batchId)).json().files[0].detected.mask).toBe("…1234");
  });
});
