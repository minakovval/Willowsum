import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import {
  createAccountDirectory,
  createAccountsServices,
  type AccountDirectory,
} from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createCategorizationServices } from "../src/modules/categorization/index.ts";
import {
  createDuplicateCandidates,
  createImportedTransactions,
  createTransactionLookup,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices } from "../src/modules/transfer-matching/index.ts";
import {
  createDuplicateCheck,
  createDuplicateMatchingServices,
} from "../src/modules/duplicate-matching/index.ts";

/**
 * A «Можливий дубль» of a transaction entered by hand and one imported from a statement (FIN-03@PoC business rules on
 * duplicates; wave 2 rows 15, 16 gaps), through the real API on a real PostgreSQL: neither side is hidden while the mark
 * is on — «Приховати» and the «Видалити» that hides the imported one answer 409 —, «Об'єднати» from either side keeps
 * the bank's posting and gives it the manual one's category, and the sign of an imported one is the bank's. The server
 * part of the scenario 100 − 30 − 30 = 40 → 70 of the view; the menu of the detail is the web's (follow-up). Every name
 * and amount is synthetic; the session is the test's principal header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let directory: AccountDirectory;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Transaction {
  id: string;
  amount: { amount: string; currency: string };
  counterparty: string | null;
  description: string | null;
  bankDescription: string | null;
  source: string;
  hidden: boolean;
  mergedInto: string | null;
  mergedDuplicates: string[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
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

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    for (let i = 0; i < 20; i++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
}

async function createAccount(space: Space, amount: string): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Синтетичний EUR ${randomUUID().slice(0, 6)}`,
    balance: { amount, currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

async function manual(space: Space, accountId: string, amount: string, date: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date,
    counterparty: "Синтетична кав'ярня",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** One statement row written by the import's apply step (module transactions' `createImportedTransactions`). */
async function imported(
  space: Space,
  accountId: string,
  amount: string,
  date: string,
  texts: { readonly counterparty: string; readonly description: string } = {
    counterparty: "SYNTH CAFE",
    description: "SYNTH CAFE *0001",
  },
): Promise<string> {
  const fileId = randomUUID();
  await createImportedTransactions(db.databases.for("transactions"), {
    accounts: directory,
    ledger,
    audit,
    newId: randomUUID,
    now: () => NOW,
  }).write(
    space.householdId,
    {
      batchId: randomUUID(),
      attemptId: randomUUID(),
      actorId: space.accountId,
      accountIds: [accountId],
      fileIds: [fileId],
    },
    async (context) => {
      await context.create([
        {
          fileId,
          row: 1,
          accountId,
          amount: Money.of(amount, "EUR"),
          date,
          description: texts.description,
          counterparty: texts.counterparty,
          balanceAfter: null,
        },
      ]);
      return { imported: 1 };
    },
  );
  await runWorker(space.householdId);
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM transactions.transactions WHERE household_id = $1 AND import_file_id = $2`,
    [space.householdId, fileId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance.amount as string;

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

async function categoryId(space: Space, name: string): Promise<string> {
  const res = await call(space, "GET", "/v1/categories");
  expect(res.statusCode, res.body).toBe(200);
  const found = (res.json().groups as { categories: { id: string; name: string }[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

async function categoryOf(space: Space, id: string) {
  const res = await call(space, "GET", `/v1/transactions/${id}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { categoryId: string | null; source: string };
}

/** The live journal entries of the space from the transactions module, by the transaction they are of. */
async function liveEntriesOf(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ source_id: string }>(
    `SELECT e.source_id FROM ledger.entries e
      WHERE e.household_id = $1 AND e.source_module = 'transactions' AND e.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.household_id = e.household_id
                          AND r.reverses_entry_id = e.id)
      ORDER BY e.recorded_at`,
    [householdId],
  );
  return rows.map((r) => r.source_id);
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  directory = createAccountDirectory(db.databases.for("accounts"));
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  const categories = createCategoryDirectory({
    db: db.databases.for("categories"),
    audit,
    newId: randomUUID,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
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
          accounts: directory,
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          categories,
          flags: fakeFlags(),
          rates: (requests) => fx.rates(requests),
          duplicates: createDuplicateCheck(),
        }),
        duplicateMatching: createDuplicateMatchingServices({
          candidates: createDuplicateCandidates(db.databases.for("transactions")),
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
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories,
          audit,
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

/** 100,00 EUR, a manual −30,00 EUR with the category «Кафе і ресторани» and the bank's −30,00 EUR a day later: 40,00. */
async function pair() {
  const space = await newSpace();
  const a = await createAccount(space, "100.00");
  const hand = await manual(space, a, "-30.00", "2026-10-10");
  const cafe = await categoryId(space, "Кафе і ресторани");
  const set = await call(space, "PUT", `/v1/transactions/${hand}/category`, { categoryId: cafe });
  expect(set.statusCode, set.body).toBe(200);
  const bank = await imported(space, a, "-30.00", "2026-10-11");
  await runWorker(space.householdId);
  expect(await balance(space, a)).toBe("40");
  const proposals = (await call(space, "GET", "/v1/duplicate-proposals")).json();
  expect(
    proposals.items.map((p: { first: { transactionId: string }; second: { transactionId: string } }) =>
      [p.first.transactionId, p.second.transactionId].sort(),
    ),
  ).toEqual([[hand, bank].sort()]);
  return { space, a, hand, bank, cafe };
}

describe("a «Можливий дубль» of a manual and an imported transaction: merged or «Не дубль», never hidden", () => {
  it("neither side is hidden, nor is the imported one «Видалити» (which hides it): 409 and nothing changes", async () => {
    const { space, a, hand, bank } = await pair();
    for (const id of [hand, bank]) {
      const res = await call(space, "POST", `/v1/transactions/${id}/hide`);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe("TRANSACTION_NOT_HIDEABLE");
    }
    const deleted = await call(space, "DELETE", `/v1/transactions/${bank}`);
    expect(deleted.statusCode, deleted.body).toBe(409);
    expect(deleted.json().code).toBe("TRANSACTION_NOT_HIDEABLE");
    await runWorker(space.householdId);
    expect(await get(space, hand)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await get(space, bank)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await balance(space, a)).toBe("40");
  });

  it("«Видалити» of the manual one stays: it is a delete, not hiding — 70,00 and the bank's row alone", async () => {
    const { space, a, hand, bank } = await pair();
    const res = await call(space, "DELETE", `/v1/transactions/${hand}`);
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("70");
    expect(await liveEntriesOf(space.householdId)).toEqual([bank]);
  });

  it("after «Не дубль» the bank's row is no duplicate, so «Видалити» hides it as any imported one (its posting stays)", async () => {
    const { space, a, hand, bank } = await pair();
    const dismissed = await call(space, "POST", `/v1/transactions/${bank}/not-duplicate`, {
      counterpartId: hand,
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    const res = await call(space, "DELETE", `/v1/transactions/${bank}`);
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await get(space, bank)).toMatchObject({ hidden: true, mergedInto: null });
    expect(await balance(space, a)).toBe("40");
  });

  it("two manual copies are still hidden as before — the refusal is only for a manual and an imported one", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    await manual(space, a, "-30.00", "2026-10-10");
    const second = await manual(space, a, "-30.00", "2026-10-11");
    const res = await call(space, "POST", `/v1/transactions/${second}/hide`);
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("70");
  });

  for (const from of ["manual", "imported"] as const)
    it(`«Об'єднати» on the ${from} one: one record with the bank's posting and the manual one's category; 70,00`, async () => {
      const { space, a, hand, bank, cafe } = await pair();
      const [acted, other] = from === "manual" ? [hand, bank] : [bank, hand];
      const res = await call(space, "POST", `/v1/transactions/${acted}/merge`, { duplicateId: other });
      expect(res.statusCode, res.body).toBe(200);
      // The response is the one that stays: the bank's.
      expect(res.json()).toMatchObject({ id: bank, source: "imported", mergedDuplicates: [hand] });
      await runWorker(space.householdId);
      expect(await get(space, hand)).toMatchObject({ hidden: true, mergedInto: bank });
      expect(await get(space, bank)).toMatchObject({
        hidden: false,
        mergedInto: null,
        mergedDuplicates: [hand],
      });
      expect(await balance(space, a)).toBe("70");
      expect(await liveEntriesOf(space.householdId)).toEqual([bank]);
      expect(await categoryOf(space, bank)).toMatchObject({ categoryId: cafe, source: "manual" });
      // One record in the list.
      const list = (await call(space, "GET", "/v1/transactions")).json() as { items: { id: string }[] };
      expect(list.items.map((t) => t.id)).toEqual([bank]);
      // The audit entry of the merge is the manual one's, without its texts.
      const entries = await audit.entriesFor(space.householdId, {
        type: "transactions.transaction",
        id: hand,
      });
      expect(entries.map((e) => e.action)).toEqual(["create", "update"]);
      expect(Object.fromEntries(entries[1]!.changes.map((c) => [c.field, [c.before, c.after]]))).toEqual({
        hidden: [null, "true"],
        mergedInto: [null, bank],
      });
      expect(leakText(JSON.stringify(entries))).not.toContain("Синтетична кав'ярня");
    });

  it("«Роз'єднати» gives both back: the manual one's posting returns, 40,00", async () => {
    const { space, a, hand, bank } = await pair();
    expect(
      (await call(space, "POST", `/v1/transactions/${hand}/merge`, { duplicateId: bank })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    const res = await call(space, "DELETE", `/v1/transactions/${bank}/merge`);
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await get(space, hand)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await balance(space, a)).toBe("40");
  });

  it("a split manual one is not merged into the bank's (its parts would not go over): 400 on the field the user named", async () => {
    const { space, hand, bank, cafe } = await pair();
    const other = await categoryId(space, "Продукти");
    const split = await call(space, "POST", `/v1/transactions/${hand}/split`, {
      mode: "categories",
      parts: [
        { categoryId: cafe, amount: "-20.00" },
        { categoryId: other, amount: "-10.00" },
      ],
    });
    expect(split.statusCode, split.body).toBe(200);
    for (const [acted, target, field] of [
      [hand, bank, "transactionId"],
      [bank, hand, "duplicateId"],
    ] as const) {
      const res = await call(space, "POST", `/v1/transactions/${acted}/merge`, { duplicateId: target });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().errors).toContainEqual(expect.objectContaining({ path: field, issue: "split" }));
    }
    expect(await get(space, hand)).toMatchObject({ hidden: false, mergedInto: null });
  });

  it("«Об'єднати» from both sides at once: one merge, the bank's row stays, 70,00", async () => {
    const { space, a, hand, bank } = await pair();
    const results = await Promise.all([
      call(space, "POST", `/v1/transactions/${hand}/merge`, { duplicateId: bank }),
      call(space, "POST", `/v1/transactions/${bank}/merge`, { duplicateId: hand }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    // The second finds the manual one merged already.
    expect(codes, results.map((r) => r.body).join("\n")).toEqual([200, 400]);
    await runWorker(space.householdId);
    expect(await get(space, hand)).toMatchObject({ hidden: true, mergedInto: bank });
    expect(await get(space, bank)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await balance(space, a)).toBe("70");
    expect(await liveEntriesOf(space.householdId)).toEqual([bank]);
  });

  it("hiding and «Об'єднати» at once: never hidden, merged once — 70,00", async () => {
    const { space, a, hand, bank } = await pair();
    const [hidden, merged] = await Promise.all([
      call(space, "POST", `/v1/transactions/${bank}/hide`),
      call(space, "POST", `/v1/transactions/${hand}/merge`, { duplicateId: bank }),
    ]);
    expect(hidden.statusCode, hidden.body).toBe(409);
    expect(merged.statusCode, merged.body).toBe(200);
    await runWorker(space.householdId);
    expect(await get(space, bank)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await balance(space, a)).toBe("70");
  });

  it("another space's imported transaction is «not found» to the merge; nothing is merged", async () => {
    const { space, hand } = await pair();
    const other = await newSpace();
    const otherAccount = await createAccount(other, "100.00");
    const theirs = await imported(other, otherAccount, "-30.00", "2026-10-11");
    const res = await call(space, "POST", `/v1/transactions/${hand}/merge`, { duplicateId: theirs });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors).toContainEqual(
      expect.objectContaining({ path: "duplicateId", issue: "not_found" }),
    );
    expect(await get(other, theirs)).toMatchObject({ hidden: false, mergedInto: null });
    expect(await get(space, hand)).toMatchObject({ hidden: false, mergedInto: null });
  });
});

describe("the detail of an imported transaction: the bank sets its sign; the texts are the user's", () => {
  it("−9,99 € «PAYPAL»: another merchant and description change this one only; the bank's description stays; «Дохід» is refused", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const texts = { counterparty: "PAYPAL", description: "PAYPAL *SYNTHMUSIC" };
    const id = await imported(space, a, "-9.99", "2026-10-11", texts);
    const others = [
      await imported(space, a, "-4.99", "2026-10-12", texts),
      await imported(space, a, "-1.99", "2026-10-13", texts),
      await imported(space, a, "-2.99", "2026-10-14", texts),
    ];
    const res = await call(space, "PATCH", `/v1/transactions/${id}`, {
      counterparty: "SynthMusic",
      description: "Сімейна підписка",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await get(space, id)).toMatchObject({
      counterparty: "SynthMusic",
      description: "Сімейна підписка",
      bankDescription: "PAYPAL *SYNTHMUSIC",
      amount: { amount: "-9.99", currency: "EUR" },
    });
    for (const o of others)
      expect(await get(space, o)).toMatchObject({
        counterparty: "PAYPAL",
        bankDescription: "PAYPAL *SYNTHMUSIC",
      });
    // «Витрата» ↔ «Дохід» is the sign: the bank's for an imported one.
    const income = await call(space, "PATCH", `/v1/transactions/${id}`, {
      amount: { amount: "9.99", currency: "EUR" },
    });
    expect(income.statusCode, income.body).toBe(400);
    expect(income.json().errors).toContainEqual(expect.objectContaining({ path: "amount", issue: "sign" }));
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("80.04");
    // The audit log has the change of the texts, before and after (masked: free text).
    const entries = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    const update = entries.find((e) => e.action === "update");
    expect(update?.changes.map((c) => c.field).sort()).toEqual(["counterparty", "description"]);
    expect(leakText(JSON.stringify(entries))).not.toContain("Сімейна підписка");
  });

  it("a manual one changes from «Витрата» to «Дохід»: the sign is the user's", async () => {
    const space = await newSpace();
    const a = await createAccount(space, "100.00");
    const id = await manual(space, a, "-9.99", "2026-10-11");
    const res = await call(space, "PATCH", `/v1/transactions/${id}`, {
      amount: { amount: "9.99", currency: "EUR" },
    });
    expect(res.statusCode, res.body).toBe(200);
    await runWorker(space.householdId);
    expect(await balance(space, a)).toBe("109.99");
  });
});
