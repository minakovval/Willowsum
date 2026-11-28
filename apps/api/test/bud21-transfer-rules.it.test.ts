import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createCategoriesServices,
  createCategoryDirectory,
  createHistoryLabels,
  type CategoryDirectory,
} from "../src/modules/categories/index.ts";
import {
  categorizationRulePorts,
  createCategorizationServices,
  createHistoryDerivations,
} from "../src/modules/categorization/index.ts";
import { rulesTx } from "../src/modules/categorization/adapters/db/rules.ts";
import { createRule } from "../src/modules/categorization/application/rules.ts";
import type { RuleCondition } from "../src/modules/categorization/domain/rule.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  createHistoryDerivationRows,
  createImportSessionsServices,
} from "../src/modules/import-sessions/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createMerchantDirectory } from "../src/modules/merchants/index.ts";
import {
  createOneSidedFlagging,
  createTransactionLookup,
  createTransactionRuleInputs,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices, type OneSidedDeps } from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» d) (wave 2 row 236) on a real PostgreSQL, through the real API and the worker
 * as src/wiring.ts wires it: the suggestions «Переказ» derived from the file's transfer rows (FR 16, EC11) and what a
 * rule «категорія „Переказ“» does on a new transaction by the owner's answer of 2026-11-27 (option б) — the
 * transaction goes to «Пари» as a one-sided transfer awaiting «Це переказ» / «Це не переказ», never becomes a transfer
 * nor gets «Переказ» by itself, and a confirmed pair takes precedence (AC18). Also: a lower rule gives no category,
 * the release flags off, another space, the audit entry without the transaction's text, a dead job and its daily
 * recovery. Every file, name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-28";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const clock = { now: () => NOW };
const OWN_CARD = "На свою картку";
const off = new Set<string>();
const isEnabled = async (_householdId: string, flag: string) => !off.has(flag);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let keys: SpaceKeys;
let files: FileStorage;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Transaction {
  id: string;
  transfer: { id: string; counterpartId: string } | null;
  oneSidedTransfer: { state: string; evidence: string[] } | null;
}

interface Suggestion {
  kind: string;
  action: string;
  conditions: { field: string; operator: string; value: unknown }[];
  categoryId: string;
  matched: number;
  agreeing: number;
  exceptions: { items: { row: number; categoryId: string }[]; count: number };
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Оксана Синтетична" });
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

/** Passes of the worker as src/wiring.ts wires it, until the space's events are dispatched and its jobs ended. */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 20; pass++) {
    const { rows } = await db.owner.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM categorization.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM import_sessions.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.jobs WHERE household_id = $1 AND state IN ('queued', 'running'))
            + (SELECT count(*) FROM transactions.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL)
            + (SELECT count(*) FROM categories.outbox_events WHERE household_id = $1 AND dispatched_at IS NULL) AS n`,
      [householdId],
    );
    if (Number(rows[0]!.n) === 0) return;
    const worker = createWorker({
      ...workerQueues(db.databases, { isEnabled }, { files, keys }),
      households: async () => [householdId],
      retryDelayMs: () => 0,
    });
    try {
      await worker.tick();
      await worker.idle();
    } finally {
      await worker.stop();
    }
  }
}

function upload(space: Space, bytes: Buffer) {
  const boundary = `ws-${randomUUID()}`;
  return app.inject({
    method: "POST",
    url: "/v1/import/history-files",
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="istoriya.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

interface Line {
  readonly description: string;
  /** The user's category; empty — none (a transfer row by its «Тип»). */
  readonly category?: string;
  /** The column «Тип»: «переказ» marks a transfer (FR 5). */
  readonly type?: string;
}

/** A history file with the column «Тип»: one row a day from 1 January 2025, in the order given. */
function history(lines: readonly Line[]): Buffer {
  const out = ["Дата;Сума;Опис;Категорія;Тип"];
  lines.forEach((l, i) => {
    const day = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
    const date = `${String(day.getUTCDate()).padStart(2, "0")}.${String(day.getUTCMonth() + 1).padStart(2, "0")}.${day.getUTCFullYear()}`;
    out.push(`${date};-1 000,00;${l.description};${l.category ?? ""};${l.type ?? "витрата"}`);
  });
  return Buffer.from(out.join("\r\n") + "\r\n", "utf8");
}

const times = (n: number, line: Line): Line[] => Array.from({ length: n }, () => line);
const transferLine: Line = { description: OWN_CARD, type: "переказ" };
const silpo: Line = { description: "SILPO", category: "Продукти" };

/** Uploaded, read by the worker and confirmed with the engine's answers; the derivation's suggestions. */
async function derived(space: Space, bytes: Buffer): Promise<{ suggestions: Suggestion[]; view: unknown }> {
  const res = await upload(space, bytes);
  expect(res.statusCode, res.body).toBe(201);
  const batchId = res.json().batch.id as string;
  await runWorker(space.householdId);
  const view = await call(space, "GET", `/v1/import/history-files/${batchId}`);
  expect(view.statusCode, view.body).toBe(200);
  const done = await call(space, "POST", `/v1/import/history-files/${batchId}/confirm`, {
    parseId: view.json().parseId,
  });
  expect(done.statusCode, done.body).toBe(200);
  const derivationId = done.json().derivation.id as string;
  const got = await call(space, "GET", `/v1/category-rule-derivations/${derivationId}`);
  expect(got.statusCode, got.body).toBe(200);
  expect(got.json().derivation.status).toBe("completed");
  return { suggestions: got.json().suggestions as Suggestion[], view: view.json() };
}

const transferCategory = async (householdId: string): Promise<string> =>
  (await directory.serviceCategory(householdId, "transfer"))!.id;

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM categories.categories WHERE household_id = $1 AND name = $2`,
    [householdId, name],
  );
  expect(rows, name).toHaveLength(1);
  return rows[0]!.id;
}

/**
 * A rule made from a suggestion as its acceptance writes it (the acceptance of row 237: an ordinary category rule with
 * the suggestion's conditions and category) — at the lowest priority, like «Нове правило».
 */
async function ruleFrom(space: Space, s: { conditions: Suggestion["conditions"]; categoryId: string }) {
  const result = await db.databases.for("categorization").inHousehold(space.householdId, (q) =>
    createRule(rulesTx(q), {
      householdId: space.householdId,
      actorAccountId: space.accountId,
      id: randomUUID(),
      fields: {
        conditions: s.conditions as unknown as RuleCondition[],
        accountIds: [],
        categoryId: s.categoryId,
        enabled: true,
        tags: [],
      },
    }),
  );
  expect(result.kind).toBe("ok");
  return (result as { rule: { id: string } }).rule.id;
}

/** The rule of AC18 straight away: «Мерчант дорівнює <merchant of «На свою картку»>» → «Переказ». */
async function ownCardRule(space: Space): Promise<string> {
  const { suggestions } = await derived(space, history([...times(6, transferLine), ...times(3, silpo)]));
  const transfer = suggestions.find((s) => s.action === "transfer");
  expect(transfer, JSON.stringify(suggestions)).toBeDefined();
  return ruleFrom(space, transfer!);
}

async function createAccount(space: Space): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${randomUUID().slice(0, 6)}`,
    balance: { amount: "50000.00", currency: "EUR" },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(space: Space, accountId: string, amount: string, counterparty: string): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: "2026-11-27",
    counterparty,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Transaction;

async function categoryOf(space: Space, id: string) {
  const res = await call(space, "GET", `/v1/transactions/${id}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { categoryId: string | null; source: string };
}

async function oneSidedList(space: Space) {
  const res = await call(space, "GET", "/v1/one-sided-transfers");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    count: number;
    items: { transactionId: string; state: string; evidence: string[] }[];
  };
}

/** No row of the categorization schema gives a transaction «Переказ» (BUD-01 FR 7: only a confirmed transfer). */
async function transferCategoryRows(householdId: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: string }>(
    `SELECT count(*) AS n FROM categorization.transaction_categories WHERE household_id = $1 AND category_id = $2`,
    [householdId, await transferCategory(householdId)],
  );
  return Number(rows[0]!.n);
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
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const accounts = createAccountDirectory(db.databases.for("accounts"));
  const ledger = createLedger(db.databases.for("ledger"));
  const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
  const rates = (requests: Parameters<typeof fx.rates>[0]) => fx.rates(requests);
  const candidates = createTransferCandidates(db.databases.for("transactions"));
  const rulePorts = () =>
    categorizationRulePorts({
      accounts,
      merchants: createMerchantDirectory(db.databases.for("merchants")),
      inputs: createTransactionRuleInputs(db.databases.for("transactions")),
    });
  const historyRows = createHistoryDerivationRows({
    db: db.databases.for("import-sessions"),
    keys,
    accounts,
  });
  const oneSided: OneSidedDeps = {
    singles: (h, limit) => candidates.singles(h, limit),
    oneSided: (h, limit) => candidates.oneSided(h, limit),
    confirmed: (h, limit) => candidates.confirmed(h, limit),
    cards: async () => new Set<string>(),
    flag: (h, actor, items) =>
      createOneSidedFlagging(db.databases.for("transactions"), { accounts, ledger, audit }).flag(
        h,
        actor,
        items,
      ),
    today: () => TODAY,
  };
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabled },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          pendingPostings: [],
          ledger,
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys,
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock,
          newId: randomUUID,
        }),
        transactions: createTransactionsServices({
          accounts,
          ledger,
          totals: createListTotals({ rates: officialDatedRates(fx), now: () => NOW }),
          audit,
          clock,
          newId: randomUUID,
          categories: directory,
          flags: { isEnabled },
          rates,
        }),
        transferMatching: createTransferMatchingServices({ candidates, rates, oneSided }),
        categories: createCategoriesServices({ audit, clock, newId: randomUUID, usage: [] }),
        importSessions: createImportSessionsServices({
          files,
          audit,
          clock,
          newId: randomUUID,
          history: {
            keys,
            accounts,
            labels: createHistoryLabels({
              db: db.databases.for("categories"),
              audit,
              newId: randomUUID,
              clock,
            }),
            derivation: createHistoryDerivations({
              db: db.databases.for("categorization"),
              source: historyRows,
              merchants: rulePorts().merchants,
              transfers: directory,
              audit,
              newId: randomUUID,
              clock,
            }),
          },
        }),
        categorization: createCategorizationServices({
          transactions: createTransactionLookup(db.databases.for("transactions")),
          categories: directory,
          audit,
          rules: rulePorts(),
          clock,
          history: { source: historyRows, newId: randomUUID, transfers: directory },
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

describe("BUD-21@PoC FR 16: the suggestions «Переказ» from the file's transfer rows", () => {
  it("BUD-21@PoC FR 16: the transfer rows give a suggestion with the action «категорія „Переказ“» in the same way and with the same thresholds; the other rows keep their categories", async () => {
    const space = await newSpace();
    // «Кешбек» rows: 4 transfers and 1 «Подарунки» — 80 %, under 90 %: «суперечлива», as for any category (FR 13).
    const lines = [
      ...times(6, transferLine),
      ...times(5, silpo),
      ...times(4, { description: "KESHBEK", type: "переказ" }),
      { description: "KESHBEK", category: "Подарунки" },
      // Two transfer rows only: too few for any suggestion (FR 13).
      ...times(2, { description: "SKARBNYCHKA", type: "переказ" }),
    ];
    const { suggestions } = await derived(space, history(lines));
    const transfer = await transferCategory(space.householdId);
    const byText = (text: string) =>
      suggestions.find((s) => JSON.stringify(s.conditions).toLowerCase().includes(text.toLowerCase()));
    expect(byText(OWN_CARD)).toMatchObject({
      kind: "confident",
      action: "transfer",
      categoryId: transfer,
      matched: 6,
      agreeing: 6,
    });
    expect(byText("KESHBEK")).toMatchObject({
      kind: "conflicting",
      action: "transfer",
      categoryId: transfer,
      matched: 5,
      agreeing: 4,
      exceptions: { count: 1 },
    });
    expect(byText("SILPO")).toMatchObject({
      kind: "confident",
      action: "category",
      categoryId: await categoryNamed(space.householdId, "Продукти"),
    });
    expect(byText("SKARBNYCHKA")).toBeUndefined();
    expect(suggestions.filter((s) => s.action === "transfer")).toHaveLength(2);
  });

  it("BUD-21@PoC EC11: every row of the file a transfer — no category is created, the suggestions are only in the group «Переказ»", async () => {
    const space = await newSpace();
    const before = (await directory.categories(space.householdId)).length;
    const { suggestions } = await derived(
      space,
      history([...times(5, transferLine), ...times(3, { description: "KOPILKA", type: "переказ" })]),
    );
    expect((await directory.categories(space.householdId)).length).toBe(before);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.every((s) => s.action === "transfer")).toBe(true);
    expect(new Set(suggestions.map((s) => s.categoryId))).toEqual(
      new Set([await transferCategory(space.householdId)]),
    );
  });
});

describe("BUD-21@PoC FR 16, AC18: a rule «Переказ» on a new transaction (owner 2026-11-27, option б)", () => {
  it("BUD-21@PoC AC18: the new «На свою картку» transaction is on «Пари» as a one-sided transfer awaiting confirmation, without «Переказ» and the transfer type until «Це переказ»", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);

    const flagged = await get(space, id);
    expect(flagged.transfer).toBeNull();
    expect(flagged.oneSidedTransfer).toEqual({ state: "flagged", evidence: ["category-rule"] });
    expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
    expect((await oneSidedList(space)).items).toEqual([
      expect.objectContaining({ transactionId: id, state: "flagged", evidence: ["category-rule"] }),
    ]);
    expect(await transferCategoryRows(space.householdId)).toBe(0);

    // «Це переказ»: only now it is a one-sided transfer (IMP-03 FR 22: the type «Переказ»).
    const decided = await call(space, "PUT", `/v1/transactions/${id}/one-sided-transfer`, {
      isTransfer: true,
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await get(space, id)).oneSidedTransfer).toEqual({ state: "marked", evidence: ["category-rule"] });
    await runWorker(space.householdId);
    expect(await transferCategoryRows(space.householdId)).toBe(0);
  });

  it("BUD-21@PoC FR 16: «Це не переказ» — the flag is gone and the rule never sets it again; the transaction counts as usual", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    const decided = await call(space, "PUT", `/v1/transactions/${id}/one-sided-transfer`, {
      isTransfer: false,
    });
    expect(decided.statusCode, decided.body).toBe(200);
    // The rules of the transaction run again (a retry of its job): nothing is flagged again.
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'queued', attempts = 0, run_after = now()
        WHERE household_id = $1 AND name = 'categorization.transaction-created'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect((await get(space, id)).oneSidedTransfer).toBeNull();
    expect((await oneSidedList(space)).count).toBe(0);
  });

  it("BUD-21@PoC FR 16: a confirmed pair takes precedence — a pair confirmed after the flag clears it, and a side of a pair confirmed before the rules ran is never flagged", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const current = await createAccount(space);
    const savings = await createAccount(space);
    // Flagged first, then paired by the user: the pair wins.
    const out = await add(space, current, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    expect((await get(space, out)).oneSidedTransfer?.state).toBe("flagged");
    const into = await add(space, savings, "1000.00", "Поповнення");
    const paired = await call(space, "POST", `/v1/transactions/${out}/transfer`, { counterpartId: into });
    expect(paired.statusCode, paired.body).toBe(200);
    await runWorker(space.householdId);
    const after = await get(space, out);
    expect(after.oneSidedTransfer).toBeNull();
    expect(after.transfer?.counterpartId).toBe(into);

    // Paired before its rules ran: the job finds a side of a transfer and does nothing.
    const out2 = await add(space, current, "-700.00", OWN_CARD);
    const into2 = await add(space, savings, "700.00", "Поповнення");
    expect(
      (await call(space, "POST", `/v1/transactions/${out2}/transfer`, { counterpartId: into2 })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    expect((await get(space, out2)).oneSidedTransfer).toBeNull();
    expect((await get(space, out2)).transfer?.counterpartId).toBe(into2);
    expect((await oneSidedList(space)).count).toBe(0);
    expect(await transferCategoryRows(space.householdId)).toBe(0);
  });

  it("BUD-21@PoC FR 16: the rule «Переказ» decides the category attribute — a lower rule with the same conditions gives no category", async () => {
    const space = await newSpace();
    const ruleId = await ownCardRule(space);
    const rules = await call(space, "GET", "/v1/category-rules");
    const transferRule = (rules.json().items as { id: string; conditions: Suggestion["conditions"] }[]).find(
      (r) => r.id === ruleId,
    )!;
    expect(transferRule).toMatchObject({ needsAttention: null });
    await ruleFrom(space, {
      conditions: transferRule.conditions,
      categoryId: await categoryNamed(space.householdId, "Продукти"),
    });
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
    expect((await get(space, id)).oneSidedTransfer?.state).toBe("flagged");
  });

  it("BUD-21@PoC FR 16: the rule «Переказ» is changed and switched off like any rule; the editor itself never offers «Переказ» as a category", async () => {
    const space = await newSpace();
    const ruleId = await ownCardRule(space);
    const transfer = await transferCategory(space.householdId);
    const patched = await call(space, "PATCH", `/v1/category-rules/${ruleId}`, {
      categoryId: transfer,
      enabled: false,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ categoryId: transfer, enabled: false, needsAttention: null });
    const created = await call(space, "POST", "/v1/category-rules", {
      conditions: [{ field: "description", operator: "contains", value: "SKARBNYCHKA" }],
      categoryId: transfer,
    });
    expect(created.statusCode, created.body).toBe(400);
    // Switched off: a new transaction it matches is not flagged.
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    expect((await get(space, id)).oneSidedTransfer).toBeNull();
  });

  it("BUD-21@PoC FR 26: the flag's audit entry is the system's, with the evidence and without the transaction's text", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    const entries = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    const flag = entries.find((e) => e.changes.some((c) => c.field === "oneSidedTransfer"));
    expect(flag, JSON.stringify(entries)).toBeDefined();
    expect(flag).toMatchObject({ actorKind: "system", actorId: null });
    expect(flag!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "oneSidedTransfer", after: "flagged" }),
        expect.objectContaining({ field: "oneSidedTransfer.evidence", after: "category-rule" }),
      ]),
    );
    expect(leakText(JSON.stringify(flag))).not.toContain(OWN_CARD);
  });
});

describe("BUD-21@PoC «Права доступу», «Ліміти плану»: the space, the flags and the queue", () => {
  it("BUD-21@PoC FR 16: another space's transaction with the same text is not flagged; its derivation is not found from the first", async () => {
    const space = await newSpace();
    const other = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(other);
    const id = await add(other, account, "-1000.00", OWN_CARD);
    await runWorker(other.householdId);
    expect((await get(other, id)).oneSidedTransfer).toBeNull();
    expect((await oneSidedList(other)).count).toBe(0);
    const list = await call(other, "GET", "/v1/one-sided-transfers");
    expect(leakText(list.body)).not.toContain(space.householdId);
  });

  it("BUD-21@PoC FR 16: with the release flag `categorization.history-rules` or `transactions.transfers` off the rule «Переказ» does nothing — no flag, no category", async () => {
    for (const flag of ["categorization.history-rules", "transactions.transfers"]) {
      const space = await newSpace();
      await ownCardRule(space);
      const account = await createAccount(space);
      off.add(flag);
      const id = await add(space, account, "-1000.00", OWN_CARD);
      await runWorker(space.householdId);
      off.clear();
      expect((await get(space, id)).oneSidedTransfer, flag).toBeNull();
      expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
      expect(await transferCategoryRows(space.householdId)).toBe(0);
    }
  });

  it("ARC-04@PoC FR 4: the rules job of a new transaction is dead — no flag until the daily recovery puts it back, then the transaction is flagged once", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(space);
    const id = await add(space, account, "-1000.00", OWN_CARD);
    // The event is handed to the categorization queue as a job the worker gave up on.
    await db.owner.query(
      `UPDATE transactions.outbox_events SET dispatched_at = now() WHERE household_id = $1`,
      [space.householdId],
    );
    await db.owner.query(
      `INSERT INTO categorization.jobs (household_id, name, dedupe_key, payload, state, attempts)
       VALUES ($1, 'categorization.transaction-created', $2, jsonb_build_object('transactionId', $2::text), 'dead', 8)`,
      [space.householdId, id],
    );
    await runWorker(space.householdId);
    expect((await get(space, id)).oneSidedTransfer).toBeNull();

    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    await runWorker(space.householdId);
    expect((await get(space, id)).oneSidedTransfer).toEqual({
      state: "flagged",
      evidence: ["category-rule"],
    });
    const entries = await audit.entriesFor(space.householdId, { type: "transactions.transaction", id });
    expect(entries.filter((e) => e.changes.some((c) => c.field === "oneSidedTransfer"))).toHaveLength(1);
  });
});
