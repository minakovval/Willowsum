import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { isolatedStatementParser } from "../src/modules/file-parsers/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createFxRates, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import { createImportRecipesReader } from "../src/modules/import-recipes/index.ts";
import {
  createImportSessionsServices,
  createImportSessionsWorkerQueue,
} from "../src/modules/import-sessions/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createImportedTransactions, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-02@PoC FR 4 (S-047 data) on a real PostgreSQL through the real API, the real parse worker and module
 * transactions: an applied statement row keeps the bank's description (every description column and the notes
 * column, masked), the balance after it, the batch, file and row it came from, the original amount and currency, the
 * bank's rate, the value date and the reference — and «Транзакції» and the transaction show them, only in their own
 * space. A BBVA-like and a monobank-like file; the accounts module is the test's port. Synthetic data only; the clock is
 * the test's.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-11-20T10:00:00Z");
const clock = { now: () => now };
// A synthetic card number built so no real-looking literal sits in the source.
const CARD = ["4111", "1111", "1111", "1234"].join(" ");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let files: FileStorage;
let keys: SpaceKeys;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};

interface Space {
  readonly accountId: string;
  readonly householdId: string;
  readonly account: string;
}

async function newSpace(currency: string): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  const account = randomUUID();
  const sub = { subaccountId: randomUUID(), currency, ledgerAccountId: randomUUID() };
  accountsOf.set(`${householdId}/${account}`, {
    accountId: account,
    kind: "current",
    status: "active",
    subaccounts: [sub],
  });
  await ledger.openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency, id: sub.ledgerAccountId },
  );
  return { accountId, householdId, account };
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

const csv = (lines: readonly string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

/** A BBVA-like export of an EUR account: «Concepto», «Movimiento», «Observaciones» (synthetic). */
const BBVA = csv([
  "F.Valor;Fecha;Concepto;Movimiento;Importe;Divisa;Disponible;Divisa;Observaciones",
  `02/03/2026;01/03/2026;Pago con tarjeta en SUPERMERCADO SINTETICO;Pago con tarjeta;-25,40;EUR;974,60;EUR;Tarjeta ${CARD}`,
  "15/03/2026;14/03/2026;Transferencia recibida;Transferencia;500,00;EUR;1474,60;EUR;",
]);

/** A monobank-like export of a UAH card: a purchase in EUR at the bank's rate (synthetic). */
const MONO = csv([
  "Дата i час операції;Деталі операції;MCC;Сума в валюті картки (UAH);Сума в валюті операції;Валюта операції;Курс;Сума комісій (UAH);Сума кешбеку (UAH);Залишок після операції;Референс",
  "01.03.2026 10:15:00;Сільпо;5411;-412,50;-412,50;UAH;;;;9587,50;",
  "13.03.2026 18:02:11;GOOGLE *Синтетика;5818;-450,00;-10,00;EUR;45,0000;;;9137,50;R-0001",
]);

async function applied(
  space: Space,
  name: string,
  bytes: Buffer,
): Promise<{ batchId: string; fileId: string }> {
  const created = await call(space, "POST", "/v1/import/batches", {});
  expect(created.statusCode, created.body).toBe(201);
  const batchId = created.json().id as string;
  const boundary = `ws-${randomUUID()}`;
  const uploaded = await app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const fileId = (uploaded.json().files as { id: string }[])[0]!.id;
  const started = await call(space, "POST", `/v1/import/batches/${batchId}/parse`, {
    files: [{ fileId, accountId: space.account }],
  });
  expect(started.statusCode, started.body).toBe(200);
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
    households: async () => [space.householdId],
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
  const res = await call(space, "POST", `/v1/import/batches/${batchId}/apply`);
  expect(res.statusCode, res.body).toBe(200);
  return { batchId, fileId };
}

/** The space's listed transactions, oldest first. */
async function listed(space: Space) {
  const res = await call(space, "GET", "/v1/transactions?sort=date");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as Record<string, unknown>[];
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  ledger = createLedger(db.databases.for("ledger"));
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
        transactions: createTransactionsServices({
          accounts: accounts as AccountDirectory,
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: clock.now })),
            now: clock.now,
          }),
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

describe("IMP-02@PoC FR 4: an imported transaction keeps and shows its statement row's data", () => {
  it("IMP-02@PoC FR 4: a BBVA-like row keeps «Concepto · Movimiento · Observaciones» masked, its balance and where it came from — in the list and the transaction", async () => {
    const space = await newSpace("EUR");
    const { batchId, fileId } = await applied(space, "bbva-marzo.csv", BBVA);
    const items = await listed(space);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      amount: { amount: "-25.4", currency: "EUR" },
      source: "imported",
      bankDescription: "Pago con tarjeta en SUPERMERCADO SINTETICO · Pago con tarjeta · Tarjeta …1234",
      balanceAfter: { amount: "974.6", currency: "EUR" },
      importedFrom: { batchId, fileId, row: 2 },
      valueDate: "2026-03-02",
      originalAmount: null,
      exchangeRate: null,
      bankReference: null,
    });
    expect(items[1]).toMatchObject({
      bankDescription: "Transferencia recibida · Transferencia",
      importedFrom: { batchId, fileId, row: 3 },
    });
    // The transaction reads the same, and an edit of «Опис» leaves the bank's text as it is (FR 4: never changed).
    const id = String(items[0]!["id"]);
    const one = await call(space, "GET", `/v1/transactions/${id}`);
    expect(one.statusCode, one.body).toBe(200);
    const withoutTime = (t: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(t).filter(([key]) => key !== "recordedAt"));
    expect(withoutTime(one.json())).toEqual(withoutTime(items[0]!));
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${id}`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
        "content-type": "application/json",
      },
      payload: JSON.stringify({ description: "Мій опис" }),
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      description: "Мій опис",
      bankDescription: "Pago con tarjeta en SUPERMERCADO SINTETICO · Pago con tarjeta · Tarjeta …1234",
      importedFrom: { batchId, fileId, row: 2 },
    });
    // No full card number anywhere in the books.
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions.transactions
        WHERE household_id = $1 AND (bank_description LIKE '%1111%' OR description LIKE '%1111%')`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("IMP-02@PoC FR 4: a monobank-like row keeps «початкова сума, курс, сума розрахунку, дата валютування» and the reference", async () => {
    const space = await newSpace("UAH");
    const { batchId, fileId } = await applied(space, "mono-berezen.csv", MONO);
    const items = await listed(space);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      amount: { amount: "-450", currency: "UAH" },
      bankDescription: "GOOGLE *Синтетика",
      balanceAfter: { amount: "9137.5", currency: "UAH" },
      importedFrom: { batchId, fileId, row: 3 },
      originalAmount: { amount: "-10", currency: "EUR" },
      exchangeRate: "45",
      bankReference: "R-0001",
    });
    expect(items[0]).toMatchObject({
      bankDescription: "Сільпо",
      originalAmount: { amount: "-412.5", currency: "UAH" },
      exchangeRate: null,
      bankReference: null,
    });
    // Stored exactly (numeric), never a float.
    const { rows } = await db.owner.query<{ original: string; rate: string | null }>(
      `SELECT trim_scale(original_amount)::text AS original, trim_scale(exchange_rate)::text AS rate
         FROM transactions.transactions WHERE household_id = $1 ORDER BY import_row`,
      [space.householdId],
    );
    expect(rows).toEqual([
      { original: "-412.5", rate: null },
      { original: "-10", rate: "45" },
    ]);
    const one = await call(space, "GET", `/v1/transactions/${String(items[1]!["id"])}`);
    expect(one.json()).toMatchObject({
      originalAmount: { amount: "-10", currency: "EUR" },
      exchangeRate: "45",
    });
  });

  it("IMP-02@PoC FR 4: another space never sees the bank's data — the transaction is «not found», its list is empty; a scoped member is refused", async () => {
    const owner = await newSpace("EUR");
    await applied(owner, "bbva-marzo.csv", BBVA);
    const id = String((await listed(owner))[0]!["id"]);
    const other = await newSpace("EUR");
    const res = await call(other, "GET", `/v1/transactions/${id}`);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain("SINTETICO");
    expect(await listed(other)).toEqual([]);
    const scoped = await call(owner, "GET", `/v1/transactions/${id}`, undefined, true);
    expect(scoped.statusCode).not.toBe(200);
    expect(leakText(scoped.body)).not.toContain("SINTETICO");
  });
});
