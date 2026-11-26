import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import {
  bankDirectory,
  type AccountCandidates,
  type AccountDirectory,
  type PostingAccount,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser, type StatementParser } from "../src/modules/file-parsers/index.ts";
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

/** The space's accounts as accounts' `AccountCandidates` gives them (institution and last 4 characters). */
const candidatesOf = new Map<
  string,
  { accountId: string; institution: string | null; last4: string | null }[]
>();
const candidates: AccountCandidates = {
  candidates: async (householdId) => candidatesOf.get(householdId) ?? [],
};

/** Adds an active account to the space: both ports see it. */
function addAccount(
  space: Space,
  institution: string | null,
  last4: string | null,
  currency = "EUR",
): string {
  const id = randomUUID();
  accountsOf.set(`${space.householdId}/${id}`, {
    accountId: id,
    kind: "current",
    status: "active",
    subaccounts: [{ subaccountId: randomUUID(), currency, ledgerAccountId: randomUUID() }],
  });
  candidatesOf.set(space.householdId, [
    ...(candidatesOf.get(space.householdId) ?? []),
    { accountId: id, institution, last4 },
  ]);
  return id;
}

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
async function work(householdId: string, parser: StatementParser = isolatedStatementParser()): Promise<void> {
  const worker = createWorker({
    queues: [
      createImportSessionsWorkerQueue(db.databases.for("import-sessions"), audit, {
        modules: {
          files,
          keys,
          recipes: createImportRecipesReader(db.databases.for("import-recipes")),
          accounts,
          banks: bankDirectory,
          candidates,
          parser,
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

/** A Revolut-like EUR statement: its bank is not in the NBU directory; a masked card and an IBAN. */
const REVOLUT = text([
  "Bank;Revolut Bank UAB",
  "Card;**** 5678",
  `IBAN;${IBAN.replace(/(.{4})/g, "$1 ").trim()}`,
  "Date;Amount;Currency;Description",
  "01.03.2026;-12.50;EUR;Coffee",
  "02.03.2026;-40.00;EUR;Groceries",
]);

describe("SEC #718: the import boundary re-checks a forged worker's bank", () => {
  const digits = ["4149", "4999", "1234", "5678"];
  const forged = `Revolut ${digits.join(" ")}`;
  /** A worker that answers a bank name with a card number in it (the worker's answer is not trusted, #711). */
  const lying: StatementParser = {
    parse: async (...args) => {
      const p = await isolatedStatementParser().parse(...args);
      return {
        ...p,
        checks: { ...p.checks, detected: { ...p.checks.detected, bank: forged, bankInDirectory: false } },
      };
    },
  };

  it("runParse: a forged bank never matches an account by its name (no auto-pick, nothing stored)", async () => {
    const space = await newSpace();
    addAccount(space, forged, null);
    const batch = await batchWith(space, [
      {
        name: "plain.csv",
        bytes: text(["Date;Amount;Currency;Description", "01.03.2026;-12.50;EUR;Coffee"]),
      },
    ]);
    await parse(space, batch.batchId);
    await work(space.householdId, lying);
    const res = await view(space, batch.batchId);
    const [file] = res.json().files;
    expect(file.accountId).toBeNull();
    expect(file.detected.bank).toBeUndefined();
    expect(leakText(res.body)).not.toContain(digits.slice(0, 2).join(" "));
  });

  it("API: a stored bank with more than 4 digits is never answered", async () => {
    const space = await newSpace();
    const batch = await batchWith(space, [{ name: "revolut.csv", bytes: REVOLUT }]);
    await parse(space, batch.batchId);
    await work(space.householdId);
    await db.owner.query(
      `UPDATE import_sessions.file_checks SET checks = jsonb_set(checks, '{detected,bank}', to_jsonb($2::text))
        WHERE household_id = $1`,
      [space.householdId, forged],
    );
    const res = await view(space, batch.batchId);
    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].detected.bank).toBeUndefined();
    expect(leakText(res.body)).not.toContain(digits.slice(0, 2).join(" "));
  });
});
