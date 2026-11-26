import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsServices, createTransferCandidates } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";

/**
 * IMP-03@PoC b) (wave 2 row 48), through the real API on a real PostgreSQL: transfers between own accounts in «Пари · N»
 * scored 0–100 with a confidence (FR 3, AC1, AC3, AC14), one-to-one with «неоднозначно з…» (FR 7, FR 12, AC6, EC4),
 * «Не пара» never proposed again (FR 12, AC5) and in the audit log (FR 19), another space (AC13). Every name and amount
 * is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-03-10";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Transaction {
  id: string;
  type: string;
  hidden: boolean;
  transfer: {
    id: string;
    side: string;
    counterpartId: string;
    date: string;
    fee: { amount: string; currency: string } | null;
    rate: { rate: string; date: string; source: string } | null;
  } | null;
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

async function createAccount(space: Space, amount: string, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency} ${randomUUID().slice(0, 6)}`,
    balance: { amount, currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string, date: string, currency = "EUR") {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency },
    date,
    counterparty: "Синтетичний переказ",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Transaction;
}

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const proposals = async (space: Space, principal: Principal = {}) => {
  const res = await call(space, "GET", "/v1/transfer-proposals", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    more: boolean;
    items: {
      outflow: { transactionId: string };
      inflow: { transactionId: string };
      date: string;
      pairKind: string;
      kind: string;
      bankRate: string | null;
      rateBand: string | null;
      fee: { amount: string } | null;
      converted: { amount: string; currency: string } | null;
      difference: { amount: string } | null;
      rate: { rate: string; date: string } | null;
      score: number;
      confidence: string;
      evidence: { code: string; points: number; days: number | null }[];
      ambiguousWith: { transactionId: string; score: number }[];
    }[];
  };
};

const mark = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/transfer`, { counterpartId }, principal);

const dismiss = (space: Space, id: string, counterpartId: string, principal: Principal = {}) =>
  call(space, "POST", `/v1/transactions/${id}/not-transfer`, { counterpartId }, principal);

const pairsOf = async (space: Space) =>
  (await proposals(space)).items.map((p) => [p.outflow.transactionId, p.inflow.transactionId]);

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: createCategoryDirectory({
            db: db.databases.for("categories"),
            audit,
            newId: randomUUID,
          }),
          flags: { isEnabled },
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
        }),
        transferMatching: createTransferMatchingServices({
          candidates: createTransferCandidates(db.databases.for("transactions")),
          rates: (requests) => fx.rates(requests),
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

beforeEach(() => {
  off.clear();
  vi.restoreAllMocks();
});

/** A space with «Поточний» and «Ощадний» (EUR) and the pair of AC1: −500,00 EUR on 2 March, +500,00 EUR on 3 March. */
async function ac1() {
  const space = await newSpace();
  const current = await createAccount(space, "3000.00");
  const savings = await createAccount(space, "0.00");
  const out = await add(space, current, "-500.00", "2026-03-02");
  const into = await add(space, savings, "500.00", "2026-03-03");
  return { space, current, savings, out, into };
}

describe("IMP-03@PoC FR 3: each proposal has a score 0–100, a confidence and its evidence", () => {
  it("IMP-03@PoC AC1: −500,00 EUR from the current account on 2 March and +500,00 EUR on savings on 3 March — a transfer with high confidence", async () => {
    const { space, out, into } = await ac1();
    const { items, count } = await proposals(space);
    expect(count).toBe(1);
    expect(items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      inflow: { transactionId: into.id },
      pairKind: "transfer",
      score: 85,
      confidence: "high",
      evidence: [
        { code: "exact-amount", points: 50, days: null },
        { code: "days-apart", points: 35, days: 1 },
      ],
      ambiguousWith: [],
    });
  });

  it("IMP-03@PoC AC3: −100,00 EUR and +99,99 EUR — proposed as the exact amount (±0,01)", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    await add(space, current, "-100.00", "2026-03-02");
    await add(space, savings, "99.99", "2026-03-02");
    const { items } = await proposals(space);
    expect(items).toMatchObject([{ score: 90, confidence: "high", fee: { amount: "-0.01" } }]);
    expect(items[0]!.evidence[0]).toMatchObject({ code: "exact-amount" });
  });

  it("IMP-03@PoC AC14: two own accounts without an identifier or marker words whose evidence is below 55 — no proposal", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    // The exact amount four days apart, with no account identifier for the longer window: 50 — none.
    await add(space, current, "-500.00", "2026-03-02");
    await add(space, savings, "500.00", "2026-03-06");
    expect(await proposals(space)).toEqual({ items: [], count: 0, more: false });
  });

  it("FIN-03@PoC FR 6: the weakest pair the rule of FR 5 admits — a 2 % fee three days apart — is still a proposal (55, low)", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    const out = await add(space, current, "-500.00", "2026-03-02");
    const into = await add(space, savings, "490.00", "2026-03-05");
    expect((await proposals(space)).items).toMatchObject([
      {
        outflow: { transactionId: out.id },
        inflow: { transactionId: into.id },
        score: 55,
        confidence: "low",
      },
    ]);
  });

  it("IMP-03@PoC EC1: sides in different days are paired within 3 days; 4 days apart — none", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    const out = await add(space, current, "-70.00", "2026-03-02");
    const into = await add(space, savings, "70.00", "2026-03-05");
    await add(space, current, "-40.00", "2026-03-02");
    await add(space, savings, "40.00", "2026-03-06");
    expect(await pairsOf(space)).toEqual([[out.id, into.id]]);
  });

  it("IMP-03@PoC EC2: rounding by ±0,01 — the pair is proposed", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    const out = await add(space, current, "-33.34", "2026-03-02");
    const into = await add(space, savings, "33.33", "2026-03-03");
    expect(await pairsOf(space)).toEqual([[out.id, into.id]]);
  });
});

describe("IMP-03@PoC FR 12: open proposals are one-to-one; FR 7: «неоднозначно з…»", () => {
  it("IMP-03@PoC EC4: two credits with close scores for one debit — one proposal, «неоднозначно з…» the other; N counts it once", async () => {
    const space = await newSpace();
    const current = await createAccount(space, "1000.00");
    const savings = await createAccount(space, "0.00");
    const deposit = await createAccount(space, "0.00");
    const out = await add(space, current, "-250.00", "2026-03-02");
    const sameDay = await add(space, savings, "250.00", "2026-03-02");
    const nextDay = await add(space, deposit, "250.00", "2026-03-03");
    const { items, count } = await proposals(space);
    expect(count).toBe(1);
    expect(items).toMatchObject([
      {
        outflow: { transactionId: out.id },
        inflow: { transactionId: sameDay.id },
        score: 90,
        ambiguousWith: [{ transactionId: nextDay.id, score: 85 }],
      },
    ]);
  });

  it("IMP-03@PoC AC6: a transaction that is a side of a confirmed pair gets no new proposal with another", async () => {
    const { space, current, out, into } = await ac1();
    expect((await mark(space, out.id, into.id)).statusCode).toBe(200);
    // Another debit that would pair with the confirmed credit just as well.
    await add(space, current, "-500.00", "2026-03-03");
    expect(await proposals(space)).toEqual({ items: [], count: 0, more: false });
  });
});

describe("IMP-03@PoC FR 12: «Не пара» — the pair is never proposed again", () => {
  it("IMP-03@PoC AC5: after «Не пара» the next search does not propose the pair, even after another pair of one side is confirmed and removed", async () => {
    const { space, savings, out, into } = await ac1();
    const res = await dismiss(space, out.id, into.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: out.id, type: "expense", transfer: null });
    expect(await proposals(space)).toEqual({ items: [], count: 0, more: false });
    // Nothing else changed: both are an expense and an income as before.
    expect([await get(space, out.id), await get(space, into.id)]).toMatchObject([
      { type: "expense", transfer: null },
      { type: "income", transfer: null },
    ]);
    // Another credit for the same debit is still proposed; confirmed and removed, the dismissed pair stays away.
    const other = await add(space, savings, "500.00", "2026-03-02");
    expect(await pairsOf(space)).toEqual([[out.id, other.id]]);
    expect((await mark(space, out.id, other.id)).statusCode).toBe(200);
    expect((await call(space, "DELETE", `/v1/transactions/${out.id}/transfer`)).statusCode).toBe(200);
    expect(await pairsOf(space)).toEqual([[out.id, other.id]]);
    // From the other side, the answer is the same.
    expect((await dismiss(space, into.id, out.id)).statusCode).toBe(200);
    expect(await pairsOf(space)).toEqual([[out.id, other.id]]);
  });

  it("IMP-03@PoC FR 12: «Не пара» of a pair that could be no proposal is refused, and nothing is stored", async () => {
    const { space, current, out, into } = await ac1();
    const sameDirection = await add(space, current, "-20.00", "2026-03-02");
    const refused = await dismiss(space, out.id, sameDirection.id);
    expect(refused.statusCode).toBe(400);
    expect(await dismiss(space, out.id, out.id).then((r) => r.statusCode)).toBe(400);
    const unknown = await dismiss(space, out.id, "99999999-9999-4999-8999-999999999999");
    expect(unknown.statusCode).toBe(400);
    expect((await dismiss(space, "99999999-9999-4999-8999-999999999999", into.id)).statusCode).toBe(404);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transfer_dismissals WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(0);
    expect((await proposals(space)).count).toBe(1);
  });

  it("IMP-03@PoC FR 19: «Не пара» is in the audit log of the transaction it was on — once, even when sent twice", async () => {
    const { space, out, into } = await ac1();
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(200);
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(200);
    const log = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: out.id });
    const dismissals = log.filter((e) => e.changes.some((ch) => ch.field === "notTransferOf"));
    expect(dismissals).toHaveLength(1);
    expect(dismissals[0]!.changes).toEqual([
      expect.objectContaining({ field: "notTransferOf", before: null, after: into.id }),
    ]);
  });

  it("IMP-03@PoC FR 12: two simultaneous «Не пара» of one pair store it once and write one audit entry", async () => {
    const { space, out, into } = await ac1();
    const answers = await Promise.all([dismiss(space, out.id, into.id), dismiss(space, into.id, out.id)]);
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transfer_dismissals WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(1);
    const entries = [
      ...(await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: out.id })),
      ...(await audit.entriesFor(space.householdId, { type: "transactions.transaction", id: into.id })),
    ].filter((e) => e.changes.some((ch) => ch.field === "notTransferOf"));
    expect(entries).toHaveLength(1);
  });

  it("IMP-03@PoC FR 12: «Не пара» and «Підтвердити» of one pair at once — never both: a transfer or a dismissal", async () => {
    const { space, out, into } = await ac1();
    const [dismissed, marked] = await Promise.all([
      dismiss(space, out.id, into.id),
      mark(space, into.id, out.id),
    ]);
    expect(marked.statusCode).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transfer_dismissals WHERE household_id = $1`,
      [space.householdId],
    );
    // Dismissed first: stored, then confirmed by hand (FR 24 allows it); confirmed first: «Не пара» is refused.
    expect(dismissed.statusCode === 200 ? rows[0].n : 1 - rows[0].n).toBe(1);
    if (dismissed.statusCode !== 200) expect(dismissed.statusCode).toBe(400);
    expect((await get(space, out.id)).transfer).not.toBeNull();
  });

  it("IMP-03@PoC FR 12: «Не пара» is behind the flag `transactions.transfers` — off, the route is not there", async () => {
    const { space, out, into } = await ac1();
    off.add("transactions.transfers");
    expect((await dismiss(space, out.id, into.id)).statusCode).toBe(404);
    off.clear();
    expect((await proposals(space)).count).toBe(1);
  });
});

describe("IMP-03@PoC AC13: another space sees and dismisses nothing", () => {
  it("IMP-03@PoC AC13: a user of another space gets no proposals, and «Не пара» of the space's pair answers not found without its records or amounts", async () => {
    const { space, out, into } = await ac1();
    const other = await newSpace();
    expect(await proposals(other)).toEqual({ items: [], count: 0, more: false });
    const res = await dismiss(other, out.id, into.id);
    expect(res.statusCode).toBe(404);
    expect(leakText(res.body)).not.toContain(into.id);
    expect(leakText(res.body)).not.toContain("500");
    // The space's existing rights (as «Підтвердити»): a viewer, an advisor and a scoped editor may not (403).
    for (const principal of [{ role: "viewer" }, { role: "advisor" }, { role: "editor", scoped: true }]) {
      const refused = await dismiss(space, out.id, into.id, principal);
      expect(refused.statusCode).toBe(403);
      expect(leakText(refused.body)).not.toContain(into.id);
    }
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM transactions.transfer_dismissals WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0].n).toBe(0);
    expect((await proposals(space)).count).toBe(1);
  });
});
