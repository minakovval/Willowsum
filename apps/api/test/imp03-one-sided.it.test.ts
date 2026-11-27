import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import {
  createCategoriesServices,
  createCategoryDirectory,
  FEE_CATEGORY_KEY,
  type CategoryDirectory,
} from "../src/modules/categories/index.ts";
import {
  createBudgetTransactions,
  createGoalTransactions,
  createOneSidedFlagging,
  createTransactionsServices,
  createTransferCandidates,
  createTransferMarking,
} from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import {
  createCardPaymentTransfers,
  createTransferMatchingServices,
  type OneSidedDeps,
} from "../src/modules/transfer-matching/index.ts";

/**
 * IMP-03@PoC d) (wave 2, row 139a) — the server part of «Пари» that #749 did not give, through the real API on a real
 * PostgreSQL: the one-sided transfer (the flag after 4 days, a card payment, «Це переказ», «Це не переказ»; FR 14,
 * FR 15, FR 22, AC9–AC11), the lists «Односторонні» and «Підтверджені» (FR 18), «Шукати пари знову» as a real search
 * (FR 23), the category of a pair's fee (FR 21, AC16), the candidates that leave a marked one out (AC20), the audit
 * entries (FR 19) and the rights of every role and another space (AC13). Every name and amount is synthetic; the clock
 * is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-20";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();
/** The credit cards of the spaces (`accountId`s): the accounts module's kind, as main.ts reads it. */
const cards = new Set<string>();

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
  transfer: { id: string; counterpartId: string; feeCategoryId: string | null } | null;
  oneSidedTransfer: { state: string; evidence: string[] } | null;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Тарас Синтетичний" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

async function createAccount(space: Space, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency} ${randomUUID().slice(0, 6)}`,
    balance: { amount: "5000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  description: string | null,
) {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    counterparty: "Синтетичний контрагент",
    ...(description ? { description } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Transaction;
}

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

const decide = (space: Space, id: string, isTransfer: boolean, principal: Principal = {}) =>
  call(space, "PUT", `/v1/transactions/${id}/one-sided-transfer`, { isTransfer }, principal);

const search = (space: Space, principal: Principal = {}) =>
  call(space, "POST", "/v1/transfer-proposals/search", undefined, principal);

async function oneSidedList(space: Space) {
  const res = await call(space, "GET", "/v1/one-sided-transfers");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    items: { transactionId: string; state: string; evidence: string[]; description: string | null }[];
  };
}

async function confirmedList(space: Space) {
  const res = await call(space, "GET", "/v1/transfer-pairs");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    items: {
      id: string;
      outflow: { transactionId: string };
      inflow: { transactionId: string };
      kind: string;
      fee: { amount: string; currency: string } | null;
      feeCategoryId: string | null;
    }[];
  };
}

const feeCategory = async (householdId: string) =>
  (await directory.categories(householdId)).find((c) => c.systemKey === FEE_CATEGORY_KEY)?.id ?? null;

/** An expense category of the space other than «Комісії банку» — the one «Змінити категорію» picks. */
async function otherExpense(householdId: string): Promise<string> {
  const all = await directory.categories(householdId);
  const c = all.find((x) => x.kind === "expense" && x.systemKey !== FEE_CATEGORY_KEY && x.state === "active");
  if (!c) throw new Error("the system tree has expense categories");
  return c.id;
}

/** The budget's read as main.ts wires it: the counted rows of `accountIds` in `from`–`to`. */
const budgetRead = (householdId: string, accountIds: string[], from = "2026-10-01", to = "2026-11-30") =>
  createBudgetTransactions(db.databases.for("transactions"), { feeCategory }).inPeriod(
    householdId,
    accountIds,
    from,
    to,
  );

const auditOf = (householdId: string, id: string) =>
  audit.entriesFor(householdId, { type: "transactions.transaction", id });

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const base = fakeFlags();
  const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const candidates = createTransferCandidates(db.databases.for("transactions"));
  const rates = (requests: Parameters<typeof fx.rates>[0]) => fx.rates(requests);
  const oneSided: OneSidedDeps = {
    singles: (h, limit) => candidates.singles(h, limit),
    oneSided: (h, limit) => candidates.oneSided(h, limit),
    confirmed: (h, limit) => candidates.confirmed(h, limit),
    cards: async (_h, ids) => new Set(ids.filter((id) => cards.has(id))),
    flag: (h, actor, items) =>
      createOneSidedFlagging(db.databases.for("transactions"), { accounts, ledger, audit }).flag(
        h,
        actor,
        items,
      ),
    today: () => TODAY,
  };
  const cardPayments = createCardPaymentTransfers({
    candidates,
    rates,
    cards: oneSided.cards,
    enabled: (h) => isEnabled(h, "transactions.transfers"),
    mark: (h, actor, outflowId, inflowId) =>
      createTransferMarking(db.databases.for("transactions"), {
        accounts,
        ledger,
        audit,
        newId: randomUUID,
        rates,
      }).mark(h, actor, outflowId, inflowId),
    oneSided,
  });
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
          accounts,
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories: directory,
          flags: { isEnabled },
          rates,
          duplicates: createDuplicateCheck(),
          cardPayments,
        }),
        transferMatching: createTransferMatchingServices({ candidates, rates, oneSided }),
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
});

/** A space with «Поточний» and «Ощадний» (EUR). */
async function twoAccounts() {
  const space = await newSpace();
  const current = await createAccount(space);
  const savings = await createAccount(space);
  return { space, current, savings };
}

describe("IMP-03@PoC FR 14: the flag «односторонній переказ»", () => {
  it("IMP-03@PoC AC9: «переказ на власний рахунок» with no other side for 4 days — flagged and on «Пари → Односторонні»", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-300.00", "2026-11-16", "Переказ на власний рахунок");
    // Entered by hand: the check runs right away (FR 1), and the flag comes once 4 days have passed.
    expect((await get(space, t.id)).oneSidedTransfer).toEqual({
      state: "flagged",
      evidence: ["transfer-words", "own-account-words"],
    });
    const list = await oneSidedList(space);
    expect(list.count).toBe(1);
    expect(list.items).toMatchObject([
      { transactionId: t.id, state: "flagged", evidence: ["transfer-words", "own-account-words"] },
    ]);
    // FR 14: the flag does not change the amount — it still counts as an expense.
    expect((await budgetRead(space.householdId, [current])).map((r) => r.id)).toEqual([t.id]);
  });

  it("IMP-03@PoC FR 14: three days old — no flag yet; a side of an open proposal is never flagged", async () => {
    const { space, current, savings } = await twoAccounts();
    const young = await add(space, current, "-120.00", "2026-11-17", "Переказ на власний рахунок");
    // The credit first, so the debit has its pair the moment it arrives.
    await add(space, savings, "300.00", "2026-11-02", null);
    const paired = await add(space, current, "-300.00", "2026-11-01", "Переказ на власний рахунок");
    expect((await search(space)).json()).toMatchObject({ count: 1, flagged: 0 });
    expect((await get(space, young.id)).oneSidedTransfer).toBeNull();
    expect((await get(space, paired.id)).oneSidedTransfer).toBeNull();
    expect((await oneSidedList(space)).count).toBe(0);
  });

  it("IMP-03@PoC FR 19: the flag is written in the audit log — the transaction's entry with the state and why", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-300.00", "2026-11-10", "Переказ на власний рахунок");
    const entries = await auditOf(space.householdId, t.id);
    const flag = entries.find((e) => JSON.stringify(e).includes("oneSidedTransfer"));
    expect(JSON.stringify(flag)).toContain("flagged");
    expect(JSON.stringify(flag)).toContain("transfer-words");
  });
});

describe("IMP-03@PoC FR 22: «Це переказ» and «Це не переказ»", () => {
  it("IMP-03@PoC FR 22: «Це переказ» — the one-sided transfer is neither income nor expense; the journal keeps its event", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-300.00", "2026-11-10", "Переказ на власний рахунок");
    const events = (
      await ledger.liveEntries(space.householdId, { module: "transactions", id: t.id }, "transaction")
    ).length;
    const res = await decide(space, t.id, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().oneSidedTransfer).toEqual({
      state: "marked",
      evidence: ["transfer-words", "own-account-words"],
    });
    expect(await budgetRead(space.householdId, [current])).toEqual([]);
    const goals = await createGoalTransactions(db.databases.for("transactions")).countedInWindow(
      space.householdId,
      "2026-10-01",
      "2026-11-30",
    );
    expect(goals.map((g) => g.id)).not.toContain(t.id);
    expect((await oneSidedList(space)).items).toMatchObject([{ transactionId: t.id, state: "marked" }]);
    expect(
      (await ledger.liveEntries(space.householdId, { module: "transactions", id: t.id }, "transaction"))
        .length,
    ).toBe(events);
    // FR 19: «позначка і зняття позначки» — the entry has the state before and after.
    const entries = JSON.stringify(await auditOf(space.householdId, t.id));
    expect(entries).toContain("marked");
    // The same decision again changes nothing.
    expect((await decide(space, t.id, true)).json().version).toBe(res.json().version);
  });

  it("IMP-03@PoC FR 14: «Це не переказ» — the flag is gone and never set again; it counts as usual", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-300.00", "2026-11-10", "Переказ на власний рахунок");
    const res = await decide(space, t.id, false);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().oneSidedTransfer).toBeNull();
    expect((await oneSidedList(space)).count).toBe(0);
    expect((await search(space)).json().flagged).toBe(0);
    expect((await get(space, t.id)).oneSidedTransfer).toBeNull();
    expect((await budgetRead(space.householdId, [current])).map((r) => r.id)).toEqual([t.id]);
  });

  it("IMP-03@PoC AC21: with no candidates the transaction is marked a one-sided transfer — no flag needed", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-75.00", "2026-10-10", null);
    expect((await call(space, "GET", `/v1/transactions/${t.id}/transfer-candidates`)).json().items).toEqual(
      [],
    );
    const res = await decide(space, t.id, true);
    expect(res.statusCode, res.body).toBe(200);
    // FR 24: the detail shows the type «Переказ» from this mark.
    expect((await get(space, t.id)).oneSidedTransfer).toEqual({ state: "marked", evidence: [] });
  });

  it("IMP-03@PoC FR 22: a side of a pair, an unknown transaction, another space's — 400 `in_transfer`, 404, 404", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10", null);
    const into = await add(space, savings, "500.00", "2026-10-10", null);
    expect(
      (await call(space, "POST", `/v1/transactions/${out.id}/transfer`, { counterpartId: into.id }))
        .statusCode,
    ).toBe(200);
    const inPair = await decide(space, out.id, true);
    expect(inPair.statusCode).toBe(400);
    expect(inPair.body).toContain("in_transfer");
    expect((await decide(space, randomUUID(), true)).statusCode).toBe(404);
    const other = await newSpace();
    const theirs = await decide(other, into.id, true);
    expect(theirs.statusCode).toBe(404);
    expect(leakText(theirs.body)).not.toContain("500");
  });
});

describe("IMP-03@PoC FR 15: a payment to a credit card", () => {
  it("IMP-03@PoC AC10: «Payment received — thank you» +600,00 EUR on the card with no matching debit — «односторонній переказ» with «платіж на картку», an income until «Це переказ»", async () => {
    const { space } = await twoAccounts();
    const card = await createAccount(space);
    cards.add(card);
    const t = await add(space, card, "600.00", TODAY, "Payment received — thank you");
    expect((await get(space, t.id)).oneSidedTransfer).toEqual({
      state: "flagged",
      evidence: ["card-payment"],
    });
    const counted = await budgetRead(space.householdId, [card]);
    expect(counted.map((r) => r.id)).toEqual([t.id]);
    expect(counted[0]!.amount.toDecimalString()).toBe("600");
    expect((await decide(space, t.id, true)).statusCode).toBe(200);
    expect(await budgetRead(space.householdId, [card])).toEqual([]);
  });

  it("IMP-03@PoC AC11: such a card payment paired with −600,00 EUR from the current account — the flags are gone, the two make a transfer", async () => {
    const { space, current } = await twoAccounts();
    const card = await createAccount(space);
    cards.add(card);
    const payment = await add(space, card, "600.00", "2026-11-12", "Zahlungseingang");
    expect((await get(space, payment.id)).oneSidedTransfer?.state).toBe("flagged");
    // A later debit: the user pairs it in the detail («Позначити як переказ», FR 24).
    const debit = await add(space, current, "-600.00", "2026-11-19", null);
    const res = await call(space, "POST", `/v1/transactions/${debit.id}/transfer`, {
      counterpartId: payment.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    const [a, b] = [await get(space, payment.id), await get(space, debit.id)];
    expect(a.oneSidedTransfer).toBeNull();
    expect(b.oneSidedTransfer).toBeNull();
    expect(a.transfer?.counterpartId).toBe(debit.id);
    expect((await oneSidedList(space)).count).toBe(0);
    expect(await budgetRead(space.householdId, [card, current])).toEqual([]);
  });

  it("IMP-03@PoC FR 15: a refund on the card is no card payment — no flag", async () => {
    const { space } = await twoAccounts();
    const card = await createAccount(space);
    cards.add(card);
    const t = await add(space, card, "40.00", TODAY, "Refund — payment received");
    expect((await get(space, t.id)).oneSidedTransfer).toBeNull();
  });
});

describe("IMP-03@PoC FR 24: what is never a candidate of «Позначити як переказ»", () => {
  it("IMP-03@PoC AC20: a credit of a confirmed pair and a one-sided +500,00 EUR marked «Це переказ» are no candidates of a free −500,00 EUR", async () => {
    const { space, current, savings } = await twoAccounts();
    const third = await createAccount(space);
    const out = await add(space, current, "-500.00", "2026-10-10", null);
    const into = await add(space, savings, "500.00", "2026-10-11", null);
    expect(
      (await call(space, "POST", `/v1/transactions/${out.id}/transfer`, { counterpartId: into.id }))
        .statusCode,
    ).toBe(200);
    const marked = await add(space, savings, "500.00", "2026-10-12", null);
    expect((await decide(space, marked.id, true)).statusCode).toBe(200);
    const free = await add(space, third, "-500.00", "2026-10-11", null);
    const res = await call(space, "GET", `/v1/transactions/${free.id}/transfer-candidates`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toEqual([]);
    // Nor are they proposed.
    expect((await call(space, "GET", "/v1/transfer-proposals")).json().count).toBe(0);
  });
});

describe("IMP-03@PoC FR 21: «Змінити категорію» of a pair's fee", () => {
  it("IMP-03@PoC AC16: −500,00 / +498,00 EUR confirmed with another category — the 2,00 € fee is an expense of the chosen category; «Підтверджені» shows it", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-500.00", "2026-10-10", null);
    const into = await add(space, savings, "498.00", "2026-10-11", null);
    const chosen = await otherExpense(space.householdId);
    const res = await call(space, "POST", `/v1/transactions/${out.id}/transfer`, {
      counterpartId: into.id,
      feeCategoryId: chosen,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().transfer.feeCategoryId).toBe(chosen);
    const rows = await budgetRead(space.householdId, [current, savings]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount.toDecimalString()).toBe("-2");
    expect(rows[0]!.parts?.[0]?.categoryId).toBe(chosen);
    const list = await confirmedList(space);
    expect(list.count).toBe(1);
    expect(list.items[0]).toMatchObject({
      outflow: { transactionId: out.id },
      inflow: { transactionId: into.id },
      kind: "same-currency",
      fee: { amount: "-2", currency: "EUR" },
      feeCategoryId: chosen,
    });
  });

  it("IMP-03@PoC FR 21: after «Підтвердити» the category changes and goes back to «Комісії банку»; the change is audited", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-200.00", "2026-10-10", null);
    const into = await add(space, savings, "199.00", "2026-10-12", null);
    expect(
      (await call(space, "POST", `/v1/transactions/${out.id}/transfer`, { counterpartId: into.id }))
        .statusCode,
    ).toBe(200);
    const bankFees = await feeCategory(space.householdId);
    expect((await budgetRead(space.householdId, [current]))[0]!.parts?.[0]?.categoryId).toBe(bankFees);
    const chosen = await otherExpense(space.householdId);
    const set = await call(space, "PUT", `/v1/transactions/${into.id}/transfer/fee-category`, {
      categoryId: chosen,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().transfer.feeCategoryId).toBe(chosen);
    expect((await budgetRead(space.householdId, [current]))[0]!.parts?.[0]?.categoryId).toBe(chosen);
    expect(JSON.stringify(await auditOf(space.householdId, out.id))).toContain("transfer.feeCategory");
    const back = await call(space, "PUT", `/v1/transactions/${out.id}/transfer/fee-category`, {
      categoryId: null,
    });
    expect(back.statusCode, back.body).toBe(200);
    expect((await budgetRead(space.householdId, [current]))[0]!.parts?.[0]?.categoryId).toBe(bankFees);
  });

  it("IMP-03@PoC FR 21: a service category, another space's or an unknown one is refused — 400; a transaction in no pair — 400 `not_transfer`", async () => {
    const { space, current, savings } = await twoAccounts();
    const out = await add(space, current, "-200.00", "2026-10-10", null);
    const into = await add(space, savings, "199.00", "2026-10-12", null);
    const service = (await directory.categories(space.householdId)).find((c) => c.kind === "service")!.id;
    const other = await newSpace();
    const theirs = await otherExpense(other.householdId);
    for (const feeCategoryId of [service, theirs, randomUUID()]) {
      const res = await call(space, "POST", `/v1/transactions/${out.id}/transfer`, {
        counterpartId: into.id,
        feeCategoryId,
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.body).toContain("feeCategoryId");
    }
    expect((await get(space, out.id)).transfer).toBeNull();
    const notPaired = await call(space, "PUT", `/v1/transactions/${out.id}/transfer/fee-category`, {
      categoryId: null,
    });
    expect(notPaired.statusCode).toBe(400);
    expect(notPaired.body).toContain("not_transfer");
  });
});

describe("IMP-03@PoC FR 18, FR 23: the lists of «Пари» and «Шукати пари знову»", () => {
  it("IMP-03@PoC FR 23: «Шукати пари знову» — a real search: a one-sided transfer that became one since is flagged now, and the proposals are counted", async () => {
    const { space, current, savings } = await twoAccounts();
    await add(space, current, "-80.00", "2026-11-01", null);
    await add(space, savings, "80.00", "2026-11-01", null);
    const t = await add(space, current, "-300.00", "2026-11-10", null);
    // A description that says it only now (an edit), so no check ran on it yet.
    const edited = await call(space, "PATCH", `/v1/transactions/${t.id}`, {
      description: "Переказ на власний рахунок",
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await get(space, t.id)).oneSidedTransfer).toBeNull();
    const res = await search(space);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ count: 1, more: false, flagged: 1 });
    expect((await get(space, t.id)).oneSidedTransfer?.state).toBe("flagged");
    // FR 8: the search confirms nothing.
    expect((await confirmedList(space)).count).toBe(0);
  });

  it("IMP-03@PoC FR 18: «Підтверджені · N» — the confirmed pairs, newest first; «Роз'єднати» takes a pair off", async () => {
    const { space, current, savings } = await twoAccounts();
    const a = await add(space, current, "-100.00", "2026-10-01", null);
    const b = await add(space, savings, "100.00", "2026-10-01", null);
    const c = await add(space, current, "-50.00", "2026-10-20", null);
    const d = await add(space, savings, "50.00", "2026-10-21", null);
    for (const [x, y] of [
      [a, b],
      [c, d],
    ] as const)
      expect(
        (await call(space, "POST", `/v1/transactions/${x.id}/transfer`, { counterpartId: y.id })).statusCode,
      ).toBe(200);
    const list = await confirmedList(space);
    expect(list.count).toBe(2);
    expect(list.items.map((p) => p.outflow.transactionId)).toEqual([c.id, a.id]);
    expect(list.items[0]).toMatchObject({ fee: null, feeCategoryId: null });
    expect((await call(space, "DELETE", `/v1/transactions/${c.id}/transfer`)).statusCode).toBe(200);
    expect((await confirmedList(space)).items.map((p) => p.outflow.transactionId)).toEqual([a.id]);
  });

  it("IMP-03@PoC FR 18: behind the flag `transactions.transfers` — off, the lists, the search and the switch are not there", async () => {
    const { space, current } = await twoAccounts();
    const t = await add(space, current, "-10.00", "2026-10-10", null);
    off.add("transactions.transfers");
    for (const res of [
      await call(space, "GET", "/v1/one-sided-transfers"),
      await call(space, "GET", "/v1/transfer-pairs"),
      await search(space),
      await decide(space, t.id, true),
    ])
      expect(res.statusCode).toBe(404);
  });
});

describe("IMP-03@PoC AC13: rights — every role, a scoped member and another space", () => {
  it("IMP-03@PoC AC13: owner, admin, editor read and act; a viewer and an advisor read only; a scoped member — 404 / 403; another space sees nothing", async () => {
    const { space, current, savings } = await twoAccounts();
    const t = await add(space, current, "-345.67", "2026-11-10", "Переказ на власний рахунок");
    const out = await add(space, current, "-222.22", "2026-10-10", null);
    const into = await add(space, savings, "222.22", "2026-10-10", null);
    expect(
      (await call(space, "POST", `/v1/transactions/${out.id}/transfer`, { counterpartId: into.id }))
        .statusCode,
    ).toBe(200);
    for (const role of ["owner", "admin", "editor", "viewer", "advisor"]) {
      for (const url of ["/v1/one-sided-transfers", "/v1/transfer-pairs"])
        expect((await call(space, "GET", url, undefined, { role })).statusCode, `${role} ${url}`).toBe(200);
    }
    for (const role of ["admin", "editor"])
      expect((await search(space, { role })).statusCode, role).toBe(200);
    for (const principal of [{ role: "viewer" }, { role: "advisor" }, { role: "editor", scoped: true }]) {
      const label = JSON.stringify(principal);
      expect((await search(space, principal)).statusCode, label).toBe(403);
      expect((await decide(space, t.id, true, principal)).statusCode, label).toBe(403);
      expect(
        (
          await call(
            space,
            "PUT",
            `/v1/transactions/${out.id}/transfer/fee-category`,
            { categoryId: null },
            principal,
          )
        ).statusCode,
        label,
      ).toBe(403);
    }
    for (const url of ["/v1/one-sided-transfers", "/v1/transfer-pairs"]) {
      const res = await call(space, "GET", url, undefined, { role: "editor", scoped: true });
      expect(res.statusCode, url).toBe(404);
      expect(leakText(res.body)).not.toContain("345");
    }
    const other = await newSpace();
    for (const url of ["/v1/one-sided-transfers", "/v1/transfer-pairs"]) {
      const res = await call(other, "GET", url);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], count: 0 });
      for (const leak of [t.id, out.id, into.id, "345", "222"])
        expect(leakText(res.body)).not.toContain(leak);
    }
    const theirs = await call(other, "PUT", `/v1/transactions/${out.id}/transfer/fee-category`, {
      categoryId: null,
    });
    expect(theirs.statusCode).toBe(404);
    expect((await search(other)).json()).toEqual({ count: 0, more: false, flagged: 0 });
    expect((await get(space, t.id)).oneSidedTransfer?.state).toBe("flagged");
  });
});
