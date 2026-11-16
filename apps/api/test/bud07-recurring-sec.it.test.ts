import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "../src/modules/merchants/index.ts";
import { createRecurringServices } from "../src/modules/recurring/index.ts";
import {
  createTransactionHistory,
  createTransactionsServices,
  createTransactionTexts,
} from "../src/modules/transactions/index.ts";

/**
 * BUD-07@PoC a1) (wave 2 row 25): the proposals of regular payments through the real API on a real PostgreSQL — the
 * series of one merchant's charges in the last 430 days (FR 1, FR 2, AC1, AC6), variable and several-price series
 * (FR 3), what a proposal shows and which charges never make one (FR 4), a new read sees new transactions (FR 5),
 * another space, a scoped member and the release flag. Every description and amount is synthetic; the clock is fixed
 * (today — 16 November 2026 in Kyiv).
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const FLAG = "recurring.payments";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface ProposalBody {
  key: string;
  merchant: { id: string; name: string };
  type: "expense" | "income";
  frequency: string;
  variable: boolean;
  expectedAmount: { amount: string; currency: string };
  nextDate: string;
  lastDate: string;
  accountId: string;
  transactionIds: string[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
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

async function createAccount(space: Space, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: "Синтетичний рахунок",
    balance: { amount: "5000.00", currency: "EUR" },
    balanceDate: "2025-01-01",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** A transaction: `amount` signed (minus — an expense). */
async function tx(
  space: Space,
  accountId: string,
  date: string,
  amount: string,
  counterparty?: string,
  currency = "EUR",
): Promise<string> {
  const t = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    ...(counterparty !== undefined ? { counterparty } : {}),
  });
  expect(t.statusCode, t.body).toBe(201);
  return t.json().id as string;
}

async function proposals(space: Space): Promise<ProposalBody[]> {
  const res = await call(space, "GET", "/v1/recurring/proposals");
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().more).toBe(false);
  return res.json().items as ProposalBody[];
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
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
          walletUsage: [],
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
        }),
        merchants: createMerchantsServices({
          transactions: createTransactionTexts(db.databases.for("transactions")),
          audit,
        }),
        recurring: createRecurringServices({
          history: createTransactionHistory(db.databases.for("transactions")),
          merchants: createMerchantDirectory(db.databases.for("merchants")),
          accounts: createAccountDirectory(db.databases.for("accounts")),
          clock: { now: () => NOW },
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

beforeEach(() => {
  off.clear();
});

// ===== security review PR #309: probes and added tests =====
async function bulk(
  space: Space,
  accounts: readonly string[],
  n: number,
  row: (i: number) => { date: string; amount: string; counterparty: string },
): Promise<void> {
  const ids: string[] = [],
    accs: string[] = [],
    dates: string[] = [],
    amounts: string[] = [],
    cps: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const r = row(i);
    ids.push(randomUUID());
    accs.push(accounts[i % accounts.length]!);
    dates.push(r.date);
    amounts.push(r.amount);
    cps.push(r.counterparty);
  }
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on, counterparty)
     SELECT $1, i, a, gen_random_uuid(), m::numeric, 'EUR', d::date, c
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[]) AS t (i, a, d, m, c)`,
    [space.householdId, ids, accs, dates, amounts, cps],
  );
}
const letters = (n: number) => {
  let s = "";
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return s;
};
const dayBefore = (k: number) =>
  new Date(Date.parse("2026-11-16T00:00:00Z") - k * 86_400_000).toISOString().slice(0, 10);

async function timed(space: Space): Promise<{ ms: number; status: number; items: number; more: boolean }> {
  const t0 = performance.now();
  const res = await call(space, "GET", "/v1/recurring/proposals");
  const ms = Math.round(performance.now() - t0);
  const body = res.json();
  return { ms, status: res.statusCode, items: body.items?.length ?? -1, more: body.more };
}

describe("sec309: no leak on 404", () => {
  it("sec309: a scoped member and flag off get the same 404 as an unknown route — no counts, ids or names", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      await tx(space, account, date, "-15.49", "NETFLIX.COM 8812");
    const strip = (b: string) => {
      const j = JSON.parse(b) as Record<string, unknown>;
      for (const k of ["supportId", "requestId", "instance", "traceId"]) delete j[k];
      return j;
    };
    const unknown = await call(space, "GET", "/v1/recurring/nothing-here");
    const scoped = await call(space, "GET", "/v1/recurring/proposals", undefined, {
      role: "editor",
      scoped: true,
    });
    const viewerScoped = await call(space, "GET", "/v1/recurring/proposals", undefined, {
      role: "viewer",
      scoped: true,
    });
    expect(scoped.statusCode).toBe(404);
    expect(viewerScoped.statusCode).toBe(404);
    expect(strip(scoped.body)).toEqual(strip(unknown.body));
    expect(scoped.body).not.toContain(account);
    expect(scoped.body).not.toMatch(/netflix/i);
    off.add(FLAG);
    const flagOff = await call(space, "GET", "/v1/recurring/proposals");
    expect(flagOff.statusCode).toBe(404);
    expect(strip(flagOff.body)).toEqual(strip(unknown.body));
  });

  it("sec309: a non-scoped viewer reads the proposals (household.data.read)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    for (const date of ["2026-08-14", "2026-09-14", "2026-10-14"])
      await tx(space, account, date, "-15.49", "NETFLIX.COM 8812");
    const res = await call(space, "GET", "/v1/recurring/proposals", undefined, { role: "viewer" });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe("sec309: what the history port reads", () => {
  it("sec309: a transaction merged into another (merged_into set) is never analysed, even if not hidden", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const keep = await tx(space, account, "2026-11-01", "-1.00", "SYNTH KEPT");
    const merged = [
      await tx(space, account, "2026-08-03", "-21.00", "SYNTH MERGED"),
      await tx(space, account, "2026-09-03", "-21.00", "SYNTH MERGED"),
      await tx(space, account, "2026-10-03", "-21.00", "SYNTH MERGED"),
    ];
    await db.owner.query(
      `UPDATE transactions.transactions SET merged_into = $3 WHERE household_id = $1 AND id = ANY($2::uuid[])`,
      [space.householdId, merged, keep],
    );
    expect(await proposals(space)).toEqual([]);
  });

  it(
    "sec309: over 20 000 transactions the newest are read — a current series is not lost behind old ones",
    { timeout: 120_000 },
    async () => {
      const space = await newSpace();
      const account = await createAccount(space);
      await bulk(space, [account], 20_000, (i) => ({
        date: dayBefore(100 + (i % 300)),
        amount: "-1.00",
        counterparty: `SYNTH OLD ${letters(i)}`,
      }));
      for (const date of ["2026-09-10", "2026-10-10", "2026-11-10"])
        await tx(space, account, date, "-4.99", "SYNTH CURRENT");
      const res = await call(space, "GET", "/v1/recurring/proposals");
      expect(res.statusCode).toBe(200);
      expect(res.json().more).toBe(true);
      expect(res.json().items.map((p: ProposalBody) => p.merchant.name)).toContain("Synth Current");
    },
  );
});

describe.runIf(process.env.SEC309_PROBE === "1")("sec309: load probes", () => {
  it(
    "probe A: 20 001 transactions, 20 001 distinct counterparties, 40 accounts",
    { timeout: 600_000 },
    async () => {
      const space = await newSpace();
      const accounts: string[] = [];
      for (let i = 0; i < Number(process.env.SEC309_ACCOUNTS ?? 40); i += 1)
        accounts.push(await createAccount(space, { name: `Синт ${i}` }));
      await bulk(space, accounts, 20_001, (i) => ({
        date: dayBefore(i % 430),
        amount: "-1.00",
        counterparty: `SYNTH SHOP ${letters(i)}`,
      }));
      const first = await timed(space);
      const second = await timed(space);
      const born = await db.owner.query(
        `SELECT count(*)::int AS n FROM merchants.merchants WHERE household_id = $1`,
        [space.householdId],
      );
      (await import("node:fs")).appendFileSync(
        process.env.SEC309_OUT!,
        ["PROBE A", JSON.stringify({ first, second, merchantsBorn: born.rows[0] })].join(" ") + "\n",
      );
    },
  );

  it("probe B: 20 000 charges of one merchant, one amount, ~46 a day", { timeout: 600_000 }, async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await bulk(space, [account], 20_000, (i) => ({
      date: dayBefore(i % 430),
      amount: "-9.99",
      counterparty: "SYNTH SAME",
    }));
    (await import("node:fs")).appendFileSync(
      process.env.SEC309_OUT!,
      ["PROBE B", JSON.stringify(await timed(space))].join(" ") + "\n",
    );
  });

  it(
    "probe C: one merchant, monthly-spaced dates, every amount different (geometric)",
    { timeout: 600_000 },
    async () => {
      const space = await newSpace();
      const account = await createAccount(space);
      await bulk(space, [account], 20_000, (i) => ({
        date: dayBefore((i % 14) * 30),
        amount: `-${(1 + (i % 5000) * 0.37).toFixed(2)}`,
        counterparty: "SYNTH VARY",
      }));
      (await import("node:fs")).appendFileSync(
        process.env.SEC309_OUT!,
        ["PROBE C", JSON.stringify(await timed(space))].join(" ") + "\n",
      );
    },
  );

  it(
    "probe D: 2 000 merchants × 10 weekly charges, amounts alternating far apart",
    { timeout: 600_000 },
    async () => {
      const space = await newSpace();
      const account = await createAccount(space);
      await bulk(space, [account], 20_000, (i) => ({
        date: dayBefore((i % 10) * 7),
        amount: i % 2 ? "-1.00" : "-100.00",
        counterparty: `SYNTH M${letters(Math.floor(i / 10))}`,
      }));
      (await import("node:fs")).appendFileSync(
        process.env.SEC309_OUT!,
        ["PROBE D", JSON.stringify(await timed(space))].join(" ") + "\n",
      );
    },
  );

  it(
    "probe E: one merchant, weekly fit chain of 62 charges with amounts growing ×1.03 (worst bestRun trimming)",
    { timeout: 600_000 },
    async () => {
      const space = await newSpace();
      const account = await createAccount(space);
      await bulk(space, [account], 20_000, (i) => ({
        date: dayBefore((i % 62) * 7),
        amount: `-${(1.03 ** (i % 62) * (1 + Math.floor(i / 62) * 0.0001)).toFixed(4)}`,
        counterparty: "SYNTH GROW",
      }));
      (await import("node:fs")).appendFileSync(
        process.env.SEC309_OUT!,
        ["PROBE E", JSON.stringify(await timed(space))].join(" ") + "\n",
      );
    },
  );
});
