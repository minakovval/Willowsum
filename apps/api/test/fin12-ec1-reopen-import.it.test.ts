import { randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import {
  createAccountDirectory,
  createAccountsServices,
  type AccountDirectory,
} from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createImportCategoryCarry } from "../src/modules/categorization/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import { createImportSessionsServices } from "../src/modules/import-sessions/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import {
  createImportedTransactions,
  createTransactionPendingPostings,
  createTransactionsServices,
  createTransactionWalletUsage,
} from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * FIN-12@PoC EC1 («Повторне відкриття закритого рахунку — імпорт відновлюється з дати відкриття без дублювання
 * історії») and FR 8 (a closed account takes no new imported transactions), on a real PostgreSQL through the real API:
 * the real accounts module (create, close, «Відкрити знову»), the real parse worker, modules import-sessions,
 * transactions and ledger. A statement imported before the closing; a second one, overlapping it, is refused while the
 * account is closed and goes in once it is open again — only its new row, the earlier rows not twice, the balance from
 * the journal. Synthetic data only; the API's clock is fixed.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-20T10:00:00Z");
const TODAY = "2026-11-20";
const CLOSED_ON = "2026-10-16";
const clock = { now: () => NOW };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let files: FileStorage;
let keys: SpaceKeys;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
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

/** The worker as main.ts wires it (the parse step with the originals and the space's key), until nothing is due. */
async function work(householdId: string): Promise<void> {
  const worker = createWorker({
    ...workerQueues(db.databases, undefined, { files, keys }),
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

/** A statement whose figures agree: the opening balance, the rows (date, amount, text), the closing balance. */
function statement(opening: string, rows: readonly (readonly [string, string, string])[]): Buffer {
  const closing = rows.reduce((sum, [, amount]) => sum.plus(amount), new Decimal(opening));
  const lines = [
    `Вхідний залишок:;${opening} EUR`,
    "Дата;Сума;Опис",
    ...rows.map(([date, amount, text]) => `${date};${amount};${text}`),
    `Кінцевий залишок:;${closing.toFixed(2)} EUR`,
  ];
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}

/** A batch of one statement file for `accountId`, parsed. */
async function parsedBatch(space: Space, accountId: string, name: string, bytes: Buffer): Promise<string> {
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
    files: fileIds.map((fileId) => ({ fileId, accountId })),
  });
  expect(started.statusCode, started.body).toBe(200);
  await work(space.householdId);
  return batchId;
}

const apply = (space: Space, batchId: string) => call(space, "POST", `/v1/import/batches/${batchId}/apply`);

/** The account's transactions that are not hidden: date and amount, in order. */
async function shown(space: Space, accountId: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ occurred_on: string; amount: string }>(
    `SELECT occurred_on::text AS occurred_on, trim_scale(amount)::text AS amount FROM transactions.transactions
      WHERE household_id = $1 AND account_id = $2 AND NOT hidden ORDER BY occurred_on, amount`,
    [space.householdId, accountId],
  );
  return rows.map((r) => `${r.occurred_on} ${r.amount}`);
}

/** The account's EUR balance as the journal has it today. */
async function balance(space: Space, accountId: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT ledger_account_id AS id FROM accounts.subaccounts
      WHERE household_id = $1 AND account_id = $2 AND currency = 'EUR'`,
    [space.householdId, accountId],
  );
  return (await ledger.balanceAt(space.householdId, rows[0]!.id, TODAY)).toDecimalString();
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys,
    objects: memoryObjectStorage(),
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  const accounts: AccountDirectory = createAccountDirectory(db.databases.for("accounts"));
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: clock.now });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [createTransactionWalletUsage(db.databases.for("transactions"))],
          pendingPostings: [
            createTransactionPendingPostings(db.databases.for("transactions"), { accounts, ledger, audit }),
          ],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys,
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: clock.now }),
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
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

describe("FIN-12@PoC EC1: import after «Відкрити знову»", () => {
  it("FIN-12@PoC EC1: a closed account takes no import; once reopened, an overlapping statement brings only its new row — the history before the closing is not imported twice", async () => {
    const space = await newSpace();
    const created = await call(space, "POST", "/v1/accounts", {
      kind: "current",
      name: "Синтетичний поточний",
      balance: { amount: "0.00", currency: "EUR" },
      balanceDate: "2026-01-01",
    });
    expect(created.statusCode, created.body).toBe(201);
    const accountId = created.json().id as string;
    await work(space.householdId);

    // The history: a statement of April imported while the account is active.
    const april: [string, string, string][] = [
      ["05.04.2026", "-42.00", "CAFE CENTRAL"],
      ["20.04.2026", "10.00", "Повернення"],
    ];
    const first = await parsedBatch(space, accountId, "kviten.csv", statement("0.00", april));
    const applied = await apply(space, first);
    expect(applied.statusCode, applied.body).toBe(200);
    await work(space.householdId);
    expect(await shown(space, accountId)).toEqual(["2026-04-05 -42", "2026-04-20 10"]);

    // A later statement repeats April and adds a row of the day the account is opened again; it is parsed before the
    // closing, applied after it.
    const later = await parsedBatch(
      space,
      accountId,
      "kviten-lystopad.csv",
      statement("0.00", [...april, [TODAY.split("-").reverse().join("."), "-15.00", "BAKERY"]]),
    );

    const closed = await call(space, "POST", `/v1/accounts/${accountId}/close`, {
      closedOn: CLOSED_ON,
      settlement: { kind: "adjustment" },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ status: "closed", closedOn: CLOSED_ON });

    // FR 8: closed — nothing is imported: the apply is refused and a new parse does not take the account.
    const refused = await apply(space, later);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe("ACCOUNT_CLOSED");
    expect(await shown(space, accountId)).toEqual(["2026-04-05 -42", "2026-04-20 10"]);
    const batch = (await call(space, "POST", "/v1/import/batches", {})).json().id as string;
    const notOffered = await call(space, "POST", `/v1/import/batches/${batch}/parse`, {
      files: [{ fileId: randomUUID(), accountId }],
    });
    expect(notOffered.statusCode, notOffered.body).toBe(422);
    expect(notOffered.json().errors).toEqual([
      { in: "body", path: "files[0].accountId", issue: "UNKNOWN_ACCOUNT" },
    ]);

    // «Відкрити знову»: the import goes on — the same batch now applies.
    const reopened = await call(space, "POST", `/v1/accounts/${accountId}/reopen`);
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json()).toMatchObject({ status: "active", closedOn: null });
    const resumed = await apply(space, later);
    expect(resumed.statusCode, resumed.body).toBe(200);
    await work(space.householdId);

    // Only the new row came in; April is there once; the balance is the closing's zero plus the new row.
    expect(await shown(space, accountId)).toEqual(["2026-04-05 -42", "2026-04-20 10", `${TODAY} -15`]);
    const { rows: imported } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions
        WHERE household_id = $1 AND account_id = $2 AND source = 'imported'`,
      [space.householdId, accountId],
    );
    expect(imported[0]!.n).toBe(3);
    expect(await balance(space, accountId)).toBe("-15");
  });
});
