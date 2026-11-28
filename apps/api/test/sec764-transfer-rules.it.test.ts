// ===== FILE: apps/api/test/sec764-transfer-rules.it.test.ts =====
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { memoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
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

/** Security review of PR 764 (BUD-21 d): properties the PR's own tests leave unproven. */
async function ruleOf(space: Space, ruleId: string) {
  const rules = await call(space, "GET", "/v1/category-rules");
  expect(rules.statusCode, rules.body).toBe(200);
  return (rules.json().items as { id: string; categoryId: string; enabled: boolean }[]).find(
    (r) => r.id === ruleId,
  );
}

describe("sec764: the service category «Переказ» of a rule is never a new choice", () => {
  it("sec764: a PATCH never gives an ordinary rule «Переказ», and a rule «Переказ» takes no unchecked category (unknown, another space's)", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const transferRuleId = await ownCardRule(space);
    const transfer = await transferCategory(space.householdId);
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const plainId = await ruleFrom(space, {
      conditions: [{ field: "description", operator: "contains", value: "SKARBNYCHKA" }],
      categoryId: groceries,
    });

    // An ordinary rule is never given «Переказ» by a change.
    const toTransfer = await call(space, "PATCH", `/v1/category-rules/${plainId}`, { categoryId: transfer });
    expect(toTransfer.statusCode, toTransfer.body).toBe(400);
    expect((await ruleOf(space, plainId))?.categoryId).toBe(groceries);

    // A rule «Переказ» changed to another category: that category is checked like any other.
    const foreignTransfer = await transferCategory(other.householdId);
    const foreign = await categoryNamed(other.householdId, "Продукти");
    for (const categoryId of [randomUUID(), foreign, foreignTransfer]) {
      const res = await call(space, "PATCH", `/v1/category-rules/${transferRuleId}`, { categoryId });
      expect(res.statusCode, res.body).toBe(400);
      expect(leakText(res.body)).not.toContain(other.householdId);
    }
    expect((await ruleOf(space, transferRuleId))?.categoryId).toBe(transfer);

    // …and to a category of its own space: accepted, the rule is an ordinary one from then on.
    const toGroceries = await call(space, "PATCH", `/v1/category-rules/${transferRuleId}`, {
      categoryId: groceries,
    });
    expect(toGroceries.statusCode, toGroceries.body).toBe(200);
    // Once ordinary, «Переказ» is no longer its own category: sending it back is a new choice, refused.
    const back = await call(space, "PATCH", `/v1/category-rules/${transferRuleId}`, { categoryId: transfer });
    expect(back.statusCode, back.body).toBe(400);
  });

  it("sec764: the rule «Переказ» of another space is not found, and a viewer changes none", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const ruleId = await ownCardRule(space);
    const transfer = await transferCategory(space.householdId);
    for (const body of [
      { enabled: false },
      { categoryId: transfer },
      { categoryId: await transferCategory(other.householdId) },
    ]) {
      const res = await call(other, "PATCH", `/v1/category-rules/${ruleId}`, body);
      expect([400, 404], res.body).toContain(res.statusCode);
      expect(leakText(res.body)).not.toContain(space.householdId);
    }
    const apply = await call(other, "POST", `/v1/category-rules/${ruleId}/apply`, {});
    expect(apply.statusCode, apply.body).toBe(404);
    const viewer = await app.inject({
      method: "PATCH",
      url: `/v1/category-rules/${ruleId}`,
      headers: {
        origin: WEB,
        ...principalHeader({ userId: space.accountId, householdId: space.householdId, role: "viewer" }),
        "content-type": "application/json",
      },
      payload: JSON.stringify({ enabled: false }),
    });
    expect(viewer.statusCode, viewer.body).toBe(403);
    expect(await ruleOf(space, ruleId)).toMatchObject({ categoryId: transfer, enabled: true });
  });

  it("sec764: «Застосувати до наявних» of a rule «Переказ» writes no category «Переказ» and flags nothing", async () => {
    const space = await newSpace();
    const ruleId = await ownCardRule(space);
    const account = await createAccount(space);
    off.add("transactions.transfers");
    const id = await add(space, account, "-1000.00", OWN_CARD);
    await runWorker(space.householdId);
    off.clear();
    const apply = await call(space, "POST", `/v1/category-rules/${ruleId}/apply`, {});
    expect(apply.statusCode, apply.body).toBeLessThan(500);
    await runWorker(space.householdId);
    expect(await transferCategoryRows(space.householdId)).toBe(0);
    expect(await categoryOf(space, id)).toMatchObject({ categoryId: null, source: "none" });
    expect((await get(space, id)).transfer).toBeNull();
    expect((await get(space, id)).oneSidedTransfer).toBeNull();
  });
});

describe("sec764: only a rule «Переказ» skips the category check of a change", () => {
  it("sec764: an ordinary rule whose category was deleted is not saved with that category again", async () => {
    const space = await newSpace();
    await transferCategory(space.householdId); // the system tree is written on first use
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const { rows } = await db.owner.query<{ group_id: string }>(
      `SELECT group_id FROM categories.categories WHERE id = $1`,
      [groceries],
    );
    const made = await call(space, "POST", "/v1/categories", {
      groupId: rows[0]!.group_id,
      name: `Синтетична ${randomUUID().slice(0, 6)}`,
    });
    expect(made.statusCode, made.body).toBe(201);
    const custom = made.json().id as string;
    const ruleId = await ruleFrom(space, {
      conditions: [{ field: "description", operator: "contains", value: "SKARBNYCHKA" }],
      categoryId: custom,
    });
    const gone = await call(space, "DELETE", `/v1/categories/${custom}`);
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    const same = await call(space, "PATCH", `/v1/category-rules/${ruleId}`, { categoryId: custom });
    expect(same.statusCode, same.body).toBe(400);
  });
});

describe("sec764: a rule never marks a transaction of another space", () => {
  it("sec764: the rules' flag port never flags a side of a confirmed pair (the job read it before the pair was made)", async () => {
    const space = await newSpace();
    const current = await createAccount(space);
    const savings = await createAccount(space);
    const out = await add(space, current, "-900.00", OWN_CARD);
    const into = await add(space, savings, "900.00", "Поповнення");
    await runWorker(space.householdId);
    const paired = await call(space, "POST", `/v1/transactions/${out}/transfer`, { counterpartId: into });
    expect(paired.statusCode, paired.body).toBe(200);
    await runWorker(space.householdId);
    const ports = categorizationRulePorts({
      accounts: createAccountDirectory(db.databases.for("accounts")),
      merchants: createMerchantDirectory(db.databases.for("merchants")),
      inputs: createTransactionRuleInputs(db.databases.for("transactions")),
      transfers: {
        flagging: createOneSidedFlagging(db.databases.for("transactions"), {
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger: createLedger(db.databases.for("ledger")),
          audit,
        }),
        enabled: async () => true,
      },
    });
    for (const id of [out, into]) {
      expect(await ports.transfers!.flag(space.householdId, id)).toBe(false);
      expect((await get(space, id)).oneSidedTransfer).toBeNull();
      expect((await get(space, id)).transfer).not.toBeNull();
    }
    expect((await oneSidedList(space)).count).toBe(0);
  });

  it("sec764: the rules job of one space naming another space's transaction flags nothing and writes no audit entry", async () => {
    const space = await newSpace();
    const other = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(other);
    const id = await add(other, account, "-1000.00", OWN_CARD);
    await runWorker(other.householdId);
    // The job of `space` with the id of the other space's transaction (a forged or mixed-up payload).
    await db.owner.query(
      `INSERT INTO categorization.jobs (household_id, name, dedupe_key, payload, state, attempts)
       VALUES ($1, 'categorization.transaction-created', $2, jsonb_build_object('transactionId', $2::text), 'queued', 0)`,
      [space.householdId, id],
    );
    await runWorker(space.householdId);
    expect((await get(other, id)).oneSidedTransfer).toBeNull();
    expect((await oneSidedList(other)).count).toBe(0);
    expect((await oneSidedList(space)).count).toBe(0);
    for (const h of [space.householdId, other.householdId]) {
      const entries = await audit.entriesFor(h, { type: "transactions.transaction", id });
      expect(entries.filter((e) => e.changes.some((c) => c.field === "oneSidedTransfer"))).toHaveLength(0);
    }
  });

  it("sec764: the rules' flag port with another space's transaction id flags nothing", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(other);
    const id = await add(other, account, "-1000.00", OWN_CARD);
    await runWorker(other.householdId);
    const ports = categorizationRulePorts({
      accounts: createAccountDirectory(db.databases.for("accounts")),
      merchants: createMerchantDirectory(db.databases.for("merchants")),
      inputs: createTransactionRuleInputs(db.databases.for("transactions")),
      transfers: {
        flagging: createOneSidedFlagging(db.databases.for("transactions"), {
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger: createLedger(db.databases.for("ledger")),
          audit,
        }),
        enabled: async () => true,
      },
    });
    expect(await ports.transfers!.flag(space.householdId, id)).toBe(false);
    expect((await get(other, id)).oneSidedTransfer).toBeNull();
    // The same port in the transaction's own space does flag it: the refusal above is the space, nothing else.
    expect(await ports.transfers!.flag(other.householdId, id)).toBe(true);
  });
});

describe("sec764: a confirmation concurrent with the rule's flag", () => {
  it("sec764: «Позначити як переказ» racing the rules job — the pair always wins: a transfer, no one-sided flag, no «Переказ» category", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const current = await createAccount(space);
    const savings = await createAccount(space);
    for (let round = 0; round < 6; round++) {
      const out = await add(space, current, `-${100 + round}.00`, OWN_CARD);
      const into = await add(space, savings, `${100 + round}.00`, "Поповнення");
      const [paired] = await Promise.all([
        call(space, "POST", `/v1/transactions/${out}/transfer`, { counterpartId: into }),
        runWorker(space.householdId),
      ]);
      expect(paired.statusCode, paired.body).toBe(200);
      await runWorker(space.householdId);
      const after = await get(space, out);
      expect(after.transfer?.counterpartId, `round ${round}`).toBe(into);
      expect(after.oneSidedTransfer, `round ${round}`).toBeNull();
    }
    expect((await oneSidedList(space)).count).toBe(0);
    expect(await transferCategoryRows(space.householdId)).toBe(0);
  });

  it("sec764: «Це не переказ» racing the rules job — a dismissed transaction is never left flagged", async () => {
    const space = await newSpace();
    await ownCardRule(space);
    const account = await createAccount(space);
    for (let round = 0; round < 6; round++) {
      const id = await add(space, account, `-${200 + round}.00`, OWN_CARD);
      const [decided] = await Promise.all([
        call(space, "PUT", `/v1/transactions/${id}/one-sided-transfer`, { isTransfer: false }),
        runWorker(space.householdId),
      ]);
      expect(decided.statusCode, decided.body).toBe(200);
      await runWorker(space.householdId);
      expect((await get(space, id)).oneSidedTransfer, `round ${round}`).toBeNull();
    }
    expect((await oneSidedList(space)).count).toBe(0);
  });
});
