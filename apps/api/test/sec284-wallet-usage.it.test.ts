import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import {
  createTransactionsServices,
  createTransactionWalletUsage,
} from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";

/**
 * PR 284 security review (file apps/api/test/sec284-wallet-usage.it.test.ts) (IMP-02@PoC FR 15, AC14): a currency «з транзакціями» stays — also when the journal does not
 * hold its transaction yet («Очікує», or a posted one whose hand-off has not run). Wiring as fin03-states-splits.
 * Every name and amount is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
let transactionsLedgerDown = false;
/** When set, the ledger refuses the accounts module's journal moves of managing (adjustments, transfers). */
let movesLedgerDown = false;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  principal: Principal = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function add(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/transactions", body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; status: string };
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const real = createLedger(db.databases.for("ledger"));
  // When set, the ledger refuses the transactions module's posts: its hand-off stays in the queue (retried later).
  const ledger = {
    ...real,
    post: (h: string, input: Parameters<typeof real.post>[1]) =>
      (transactionsLedgerDown && input.source.module === "transactions") ||
      (movesLedgerDown &&
        input.source.module === "accounts" &&
        !input.idempotencyKey.startsWith("accounts.opening:"))
        ? Promise.reject(new Error("the ledger is down"))
        : real.post(h, input),
  };
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          walletUsage: [createTransactionWalletUsage(db.databases.for("transactions"))],
          pendingPostings: [],
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({
            rates: officialDatedRates(createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW })),
            now: () => NOW,
          }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          // FR 18: only a duplicate is hidden — the tests that hide enter the transaction twice (FIN-03 b, row 16c).
          duplicates: createDuplicateCheck(),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
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

async function multi(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Мультивалютний",
    balance: { amount: "100.00", currency: "EUR" },
    balanceDate: "2026-01-01",
    extraCurrencies: [{ amount: "0", currency: "PLN", date: "2026-01-01" }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}
const plnTx = (accountId: string, status?: string) => ({
  accountId,
  amount: { amount: "-40.00", currency: "PLN" },
  date: "2026-10-15",
  counterparty: "Синтетичний магазин",
  ...(status ? { status } : {}),
});
const plnWallets = async (householdId: string, accountId: string) =>
  (
    await db.owner.query(
      `SELECT count(*)::int AS n FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2 AND currency = 'PLN'`,
      [householdId, accountId],
    )
  ).rows[0]!.n as number;

describe("PR 284 security: a wallet with transactions the journal does not hold yet stays (IMP-02 FR 15, AC14)", () => {
  it("IMP-02@PoC FR 15: a PLN wallet with an «Очікує» transaction cannot be removed — the transaction row would be left without its wallet", async () => {
    const space = await newSpace();
    const id = await multi(space);
    const t = await add(space, plnTx(id, "pending"));
    expect(t.status).toBe("pending");
    const res = await call(space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_CURRENCY_HAS_TRANSACTIONS");
    expect(await plnWallets(space.householdId, id)).toBe(1);
  });

  it("IMP-02@PoC FR 15: a PLN wallet whose posted transaction is not handed to the journal yet cannot be removed", async () => {
    const space = await newSpace();
    const id = await multi(space);
    transactionsLedgerDown = true;
    try {
      const res = await call(space, "POST", "/v1/transactions", plnTx(id));
      expect(res.statusCode, res.body).toBe(201);
    } finally {
      transactionsLedgerDown = false;
    }
    const res = await call(space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect(res.statusCode, res.body).toBe(409);
    expect(await plnWallets(space.householdId, id)).toBe(1);
  });

  it("IMP-02@PoC FR 15: a PLN wallet whose transaction was deleted can be removed again", async () => {
    const space = await newSpace();
    const id = await multi(space);
    const t = await add(space, plnTx(id, "pending"));
    expect((await call(space, "DELETE", `/v1/transactions/${t.id}`)).statusCode).toBeLessThan(300);
    const res = await call(space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await plnWallets(space.householdId, id)).toBe(0);
  });

  it("IMP-02@PoC FR 15: a PLN wallet whose «Оновити залишок» is not in the journal yet is finished first, so it cannot be removed", async () => {
    const space = await newSpace();
    const id = await multi(space);
    movesLedgerDown = true;
    try {
      const res = await call(space, "POST", `/v1/accounts/${id}/balance`, {
        balance: { amount: "25.00", currency: "PLN" },
      });
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      movesLedgerDown = false;
    }
    const res = await call(space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_CURRENCY_HAS_TRANSACTIONS");
    expect(await plnWallets(space.householdId, id)).toBe(1);
  });

  it("IMP-02@PoC FR 15: a PLN wallet whose only transaction is hidden and «Очікує» cannot be removed (hidden rows count too)", async () => {
    const space = await newSpace();
    const id = await multi(space);
    const t = await add(space, plnTx(id, "pending"));
    // A merged «Очікує» duplicate is hidden (FIN-03 FR 18); set directly, so this row is the wallet's only one.
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [space.householdId, t.id],
    );
    const res = await call(space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_CURRENCY_HAS_TRANSACTIONS");
    expect(await plnWallets(space.householdId, id)).toBe(1);
  });
});
