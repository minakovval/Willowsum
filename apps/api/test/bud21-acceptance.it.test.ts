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
  type CategorizationRulePorts,
} from "../src/modules/categorization/index.ts";
import { rulesTx } from "../src/modules/categorization/adapters/db/rules.ts";
import { runsTx } from "../src/modules/categorization/adapters/db/runs.ts";
import { acceptSuggestions } from "../src/modules/categorization/application/acceptance.ts";
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
  createTransactionRuleTags,
  createTransactionsServices,
  createTransferCandidates,
} from "../src/modules/transactions/index.ts";
import { createTransferMatchingServices, type OneSidedDeps } from "../src/modules/transfer-matching/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» e) (wave 2 row 237) on a real PostgreSQL, through the real API and the worker
 * as src/wiring.ts wires it: the check on the history (FR 18), the suggestions against the space's transactions (FR 19)
 * and rules (FR 20), the acceptance into ordinary rules «з історії» below the existing ones in the order of FR 20 with
 * their tags created and «Застосувати до наявних» as one run with «Відмінити» for 7 days (FR 22), the rejection for
 * good (FR 23), a category deleted or merged before the acceptance (EC8), the count of suggestions on «Правила
 * категорій» (BUD-14 FR 16), the audit (BUD-21 FR 26), another space, a scoped member, the flags, two acceptances at once, and
 * a dead job of the run with its daily recovery. Every file, name and amount is synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-28";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const DAY = 24 * 60 * 60 * 1000;
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
let rulePorts: CategorizationRulePorts;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Suggestion {
  ordinal: number;
  kind: string;
  action: string;
  conditions: { field: string; operator: string; value: unknown }[];
  categoryId: string;
  matched: number;
  tags: string[];
  existing: number;
  conflict: { ruleId: string; position: number } | null;
  selected: boolean;
  categoryDeleted: boolean;
}

interface Derivation {
  derivation: { id: string; batchId: string; status: string };
  check: {
    status: string;
    rows: number;
    covered: number | null;
    agreeing: number | null;
    minimum: number;
  } | null;
  existing: { imported: number; matched: number; descriptionsDiffer: boolean; truncated: boolean } | null;
  suggestions: Suggestion[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Марта Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

/** Passes of the worker as src/wiring.ts wires it, until the space's events are dispatched and its jobs ended. */
async function runWorker(householdId: string): Promise<void> {
  for (let pass = 0; pass < 30; pass++) {
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
  readonly tags?: string;
}

/**
 * A history file: one row a day from 1 January 2024 (dates as «дд.мм.рррр»), in the order given; the columns «Тип» and
 * «Теги» only when a row has them (as the files of bud21-transfer-rules and bud21-derivation).
 */
function history(lines: readonly Line[]): Buffer {
  const typed = lines.some((l) => l.type !== undefined);
  const tagged = lines.some((l) => l.tags !== undefined);
  const out = [
    ["Дата;Сума;Опис;Категорія", ...(typed ? ["Тип"] : []), ...(tagged ? ["Теги"] : [])].join(";"),
  ];
  lines.forEach((l, i) => {
    const day = new Date(Date.UTC(2024, 0, 1) + i * DAY);
    const date = `${String(day.getUTCDate()).padStart(2, "0")}.${String(day.getUTCMonth() + 1).padStart(2, "0")}.${day.getUTCFullYear()}`;
    const cells = [date, "-120,00", l.description, l.category ?? ""];
    if (typed) cells.push(l.type ?? "витрата");
    if (tagged) cells.push(l.tags ?? "");
    out.push(cells.join(";"));
  });
  return Buffer.from(out.join("\r\n") + "\r\n", "utf8");
}

const times = (n: number, line: Line): Line[] => Array.from({ length: n }, () => line);

/** Distinct made-up merchant words (letters only, no digits): «BAKO», «BARI», … */
function merchantWords(n: number): string[] {
  const syllables = ["BA", "KO", "RI", "SU", "TE", "MA", "LO", "VI", "NE", "DU"];
  const out: string[] = [];
  for (const a of syllables) for (const b of syllables) if (a !== b && out.length < n) out.push(`${a}${b}`);
  return out;
}

/** Uploaded, read by the worker and confirmed with the engine's answers: the derivation's id and batch. */
async function confirmed(space: Space, bytes: Buffer): Promise<{ derivationId: string; batchId: string }> {
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
  return { derivationId: done.json().derivation.id as string, batchId };
}

async function derivation(space: Space, id: string): Promise<Derivation> {
  const res = await call(space, "GET", `/v1/category-rule-derivations/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Derivation;
}

const valueOf = (s: Suggestion) => String(s.conditions[0]!.value);
const named = (d: Derivation, text: string) =>
  d.suggestions.find((s) => valueOf(s).toLowerCase().includes(text.toLowerCase()));

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM categories.categories WHERE household_id = $1 AND name = $2`,
    [householdId, name],
  );
  expect(rows, name).toHaveLength(1);
  return rows[0]!.id;
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

async function add(
  space: Space,
  accountId: string,
  counterparty: string,
  amount = "-12.00",
): Promise<string> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: "EUR" },
    date: "2026-11-27",
    counterparty,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function addMany(space: Space, accountId: string, counterparty: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let at = 0; at < n; at += 20)
    ids.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(20, n - at) }, () => add(space, accountId, counterparty)),
      )),
    );
  return ids;
}

async function categoryOf(space: Space, id: string) {
  const res = await call(space, "GET", `/v1/transactions/${id}/category`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { categoryId: string | null; source: string; rule?: { id: string } };
}

async function listRules(space: Space) {
  const res = await call(space, "GET", "/v1/category-rules");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as {
    id: string;
    position: number;
    conditions: { field: string; value: unknown }[];
    categoryId: string;
    tags: string[];
    origin: string | null;
  }[];
}

async function handRule(space: Space, merchant: string, categoryId: string): Promise<string> {
  const res = await call(space, "POST", "/v1/category-rules", {
    conditions: [{ field: "merchant", operator: "equals", value: merchant }],
    accountIds: [],
    categoryId,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const accept = (space: Space, derivationId: string, body: unknown) =>
  call(space, "POST", `/v1/category-rule-derivations/${derivationId}/accept`, body);

const selectedOf = (d: Derivation) =>
  d.suggestions.filter((s) => s.selected).map((s) => ({ ordinal: s.ordinal }));

async function auditRows(householdId: string, type: string) {
  const { rows } = await db.owner.query<{
    entity_id: string;
    action: string;
    changes: { field: string; after: string | null }[];
  }>(
    `SELECT entity_id, action, changes FROM audit.entries WHERE household_id = $1 AND entity_type = $2
      ORDER BY occurred_at, id`,
    [householdId, type],
  );
  return rows.map((r) => ({
    entityId: r.entity_id,
    action: r.action,
    changes: Object.fromEntries(r.changes.map((c) => [c.field, c.after])),
  }));
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
  const flagging = createOneSidedFlagging(db.databases.for("transactions"), { accounts, ledger, audit });
  rulePorts = categorizationRulePorts({
    accounts,
    merchants: createMerchantDirectory(db.databases.for("merchants")),
    inputs: createTransactionRuleInputs(db.databases.for("transactions")),
    tags: createTransactionRuleTags({
      db: db.databases.for("transactions"),
      accounts,
      newId: randomUUID,
      flags: { isEnabled },
    }),
    transfers: {
      flagging,
      enabled: async (h) =>
        (await isEnabled(h, "categorization.history-rules")) &&
        (await isEnabled(h, "transactions.transfers")),
    },
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
    flag: (h, actor, items) => flagging.flag(h, actor, items),
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
              merchants: rulePorts.merchants,
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
          rules: rulePorts,
          clock,
          history: { source: historyRows, newId: randomUUID, transfers: directory },
          flags: { isEnabled },
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  off.clear();
});

/** 40 merchants of 3 rows each, all «Продукти» (one of them «SILPO»), and 6 of 4 «Кафе» and 1 «Дім» (80 %). */
function fortyAndSix(): Line[] {
  const words = merchantWords(46);
  const lines: Line[] = [];
  for (const w of [...words.slice(0, 39), "SILPO"])
    lines.push(...times(3, { description: w, category: "Продукти" }));
  for (const w of words.slice(40, 46))
    lines.push(
      { description: w, category: "Дім" },
      ...times(4, { description: w, category: "Кафе і ресторани" }),
    );
  return lines;
}

describe("BUD-21@PoC FR 18: the check on the history", () => {
  it("BUD-21@PoC AC20: over 1 000 rows the coverage and the agreement are counted on the latest 200 by date; for 40 rows the history is too short", async () => {
    const space = await newSpace();
    // 800 rows of four habits, then 200: the same three, «GLOVO» filed elsewhere, and a merchant the 800 never had.
    const early: Line[] = [];
    const habits: Line[] = [
      { description: "SILPO", category: "Продукти" },
      { description: "ATB", category: "Продукти" },
      { description: "OKKO", category: "Пальне" },
      { description: "GLOVO", category: "Кафе і ресторани" },
    ];
    for (let i = 0; i < 800; i++) early.push(habits[i % 4]!);
    const late: Line[] = [];
    for (let i = 0; i < 200; i++)
      late.push(
        i % 5 < 3
          ? habits[i % 5]!
          : i % 5 === 3
            ? { description: "GLOVO", category: "Доставка їжі" }
            : { description: "ROZETKA", category: "Дім" },
      );
    const big = await confirmed(space, history([...early, ...late]));
    const got = await derivation(space, big.derivationId);
    expect(got.check).toEqual({ status: "ready", rows: 200, covered: 160, agreeing: 120, minimum: 50 });
    // The suggestions are from the whole array: «ROZETKA» has one though the first 800 rows never had it.
    expect(named(got, "rozetka")).toBeDefined();

    const small = await confirmed(space, history(times(40, { description: "APTEKA", category: "Здоров'я" })));
    expect((await derivation(space, small.derivationId)).check).toEqual({
      status: "too_short",
      rows: 40,
      covered: null,
      agreeing: null,
      minimum: 50,
    });
  });
});

describe("BUD-21@PoC FR 19: the suggestions against the space's transactions", () => {
  it("BUD-21@PoC AC21: 60 transactions imported from statements, which no suggestion matches — the warning about the descriptions, and each suggestion its own count of existing transactions", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const imported = await addMany(space, account, "POS TERMINAL 4410", 60);
    await addMany(space, account, "SILPO", 3);
    // Rows of a statement file (synthetic): module transactions' source «imported».
    await db.owner.query(
      `UPDATE transactions.transactions SET source = 'imported', import_batch_id = $2
        WHERE household_id = $1 AND id = ANY($3::uuid[])`,
      [space.householdId, randomUUID(), imported],
    );
    await runWorker(space.householdId);
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(4, { description: "OSBB", category: "Комунальні" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    expect(got.existing).toEqual({ imported: 60, matched: 0, descriptionsDiffer: true, truncated: false });
    expect(named(got, "silpo")!.existing).toBe(3);
    expect(named(got, "osbb")!.existing).toBe(0);
  });
});

describe("BUD-21@PoC FR 20: the suggestions against the space's rules", () => {
  it("BUD-21@PoC AC22: a rule «Мерчант дорівнює Netflix → Підписки» — no suggestion for Netflix", async () => {
    const space = await newSpace();
    const first = await confirmed(space, history(times(5, { description: "NETFLIX", category: "Підписки" })));
    const before = await derivation(space, first.derivationId);
    const netflix = named(before, "netflix")!;
    await handRule(space, String(netflix.conditions[0]!.value), netflix.categoryId);
    expect(named(await derivation(space, first.derivationId), "netflix")).toBeUndefined();
  });

  it("BUD-21@PoC AC23: a rule «Мерчант дорівнює Spotify → Підписки» and a suggestion «Spotify → Розваги» — marked as conflicting with that rule's number and not selected", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SPOTIFY", category: "Розваги" }),
        ...times(5, { description: "SILPO", category: "Продукти" }),
      ]),
    );
    const spotify = named(await derivation(space, derivationId), "spotify")!;
    expect(spotify.selected).toBe(true);
    await handRule(space, "АЗС", await categoryNamed(space.householdId, "Продукти"));
    const ruleId = await handRule(
      space,
      String(spotify.conditions[0]!.value),
      await categoryNamed(space.householdId, "Підписки"),
    );
    const got = named(await derivation(space, derivationId), "spotify")!;
    expect(got.conflict).toEqual({ ruleId, position: 2 });
    expect(got.selected).toBe(false);
    expect(named(await derivation(space, derivationId), "silpo")!.selected).toBe(true);
  });
});

describe("BUD-21@PoC FR 22: the acceptance", () => {
  it("BUD-21@PoC AC24: 40 confident and 6 conflicting accepted as selected without «Застосувати до наявних» — 40 rules «з історії» below the existing ones, 6 left, no existing transaction changed, an audit entry, and a new «Сільпо» takes its category by the rule", async () => {
    const space = await newSpace();
    // The file's categories are made at its confirmation; the rule by hand and the transaction come before the acceptance.
    const { derivationId } = await confirmed(space, history(fortyAndSix()));
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const existingRule = await handRule(space, "АЗС ОККО", groceries);
    const account = await createAccount(space);
    const before = await add(space, account, "SILPO");
    await runWorker(space.householdId);
    const got = await derivation(space, derivationId);
    expect(got.suggestions.filter((s) => s.kind === "confident")).toHaveLength(40);
    expect(got.suggestions.filter((s) => s.kind === "conflicting")).toHaveLength(6);
    expect(selectedOf(got)).toHaveLength(40);

    const res = await accept(space, derivationId, { suggestions: selectedOf(got) });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ run: null, transfers: 0 });
    expect(res.json().rules).toHaveLength(40);

    const rules = await listRules(space);
    expect(rules).toHaveLength(41);
    expect(rules[0]).toMatchObject({ id: existingRule, position: 1, origin: null });
    expect(rules.slice(1).every((r) => r.origin === "history")).toBe(true);
    expect(rules.slice(1).map((r) => r.position)).toEqual(Array.from({ length: 40 }, (_, i) => i + 2));

    const left = await derivation(space, derivationId);
    expect(left.suggestions).toHaveLength(6);
    expect(left.suggestions.every((s) => s.kind === "conflicting" && !s.selected)).toBe(true);

    expect(await categoryOf(space, before)).toMatchObject({ categoryId: null, source: "none" });
    const entries = await auditRows(space.householdId, "categorization.history-derivation");
    expect(entries.filter((e) => e.entityId === derivationId && e.changes.accepted === "40")).toHaveLength(1);
    const created = await auditRows(space.householdId, "categorization.rule");
    expect(created.filter((e) => e.action === "create" && e.changes.origin === "history")).toHaveLength(40);

    const after = await add(space, account, "SILPO");
    await runWorker(space.householdId);
    expect(await categoryOf(space, after)).toMatchObject({ categoryId: groceries, source: "rule" });
  });

  it(
    "BUD-21@PoC AC25: accepted with «Застосувати до наявних» over 180 matching transactions, 5 of them set by hand — 175 categorized in one run, 5 skipped as manual, «Відмінити» for 7 days",
    { timeout: 180_000 },
    async () => {
      const space = await newSpace();
      const { derivationId } = await confirmed(
        space,
        history([
          ...times(5, { description: "SILPO", category: "Продукти" }),
          ...times(4, { description: "ATB", category: "Супермаркети" }),
          ...times(3, { description: "EPICENTR", category: "Дім" }),
        ]),
      );
      const account = await createAccount(space);
      const silpo = await addMany(space, account, "SILPO", 100);
      const atb = await addMany(space, account, "ATB", 80);
      await runWorker(space.householdId);
      const home = await categoryNamed(space.householdId, "Дім");
      for (const id of [...silpo.slice(0, 3), ...atb.slice(0, 2)]) {
        const set = await call(space, "PUT", `/v1/transactions/${id}/category`, { categoryId: home });
        expect(set.statusCode, set.body).toBe(200);
      }
      const got = await derivation(space, derivationId);
      const matches = await call(space, "POST", `/v1/category-rule-derivations/${derivationId}/matches`, {
        suggestions: selectedOf(got),
      });
      expect(matches.statusCode, matches.body).toBe(200);
      expect(matches.json()).toEqual({ count: 180, transfers: 0, truncated: false });

      const res = await accept(space, derivationId, { suggestions: selectedOf(got), apply: true });
      expect(res.statusCode, res.body).toBe(201);
      const run = res.json().run;
      expect(run).toMatchObject({
        derivationId,
        status: "completed",
        count: 180,
        changed: 175,
        skipped: { manual: 5, unchanged: 0, unavailable: 0 },
        undo: { available: true, until: new Date(Date.parse(run.endedAt) + 7 * DAY).toISOString() },
      });
      const rules = await listRules(space);
      const groceries = await categoryNamed(space.householdId, "Продукти");
      const markets = await categoryNamed(space.householdId, "Супермаркети");
      expect(await categoryOf(space, silpo[50]!)).toMatchObject({ categoryId: groceries, source: "rule" });
      expect(await categoryOf(space, atb[50]!)).toMatchObject({ categoryId: markets, source: "rule" });
      expect((await categoryOf(space, silpo[0]!)).rule?.id ?? null).toBeNull();
      expect(await categoryOf(space, silpo[0]!)).toMatchObject({ categoryId: home, source: "manual" });
      expect(new Set(rules.map((r) => r.origin))).toEqual(new Set(["history"]));
      // One operation: a single run of the space for both rules.
      const runs = await call(space, "GET", "/v1/category-rule-runs");
      expect(runs.json().items).toHaveLength(1);

      const undo = await call(space, "POST", `/v1/category-rule-runs/${run.id}/undo`, {});
      expect(undo.statusCode, undo.body).toBe(200);
      expect(undo.json()).toMatchObject({ status: "undone", undo: { restored: 175, notRestored: 0 } });
      expect(await categoryOf(space, silpo[50]!)).toMatchObject({ categoryId: null, source: "none" });
      expect(await categoryOf(space, silpo[0]!)).toMatchObject({ categoryId: home, source: "manual" });
      // The rules stay (also «EPICENTR → Дім», no transaction of it): «Відмінити» gives back the categories, not the acceptance.
      expect(await listRules(space)).toHaveLength(3);
    },
  );

  it("BUD-21@PoC AC26: the accepted rules stand below the existing ones in the order of FR 20 — more conditions, then the larger N, then the name", async () => {
    const space = await newSpace();
    // «SILPO» 15 rows, «ATB» 40, «AMAZON» 15 (a tie on N with «SILPO» goes by the name).
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(15, { description: "SILPO", category: "Продукти" }),
        ...times(40, { description: "ATB", category: "Продукти" }),
        ...times(15, { description: "AMAZON", category: "Дім" }),
      ]),
    );
    await handRule(space, "АЗС ОККО", await categoryNamed(space.householdId, "Продукти"));
    const got = await derivation(space, derivationId);
    // Sent in another order than the page's: the server orders them.
    const res = await accept(space, derivationId, {
      suggestions: [named(got, "silpo")!, named(got, "amazon")!, named(got, "atb")!].map((s) => ({
        ordinal: s.ordinal,
      })),
    });
    expect(res.statusCode, res.body).toBe(201);
    const rules = await listRules(space);
    expect(rules.map((r) => String(r.conditions[0]!.value).toLowerCase())).toEqual([
      "азс окко",
      "atb",
      "amazon",
      "silpo",
    ]);
    expect(rules.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it("BUD-21@PoC FR 20: a suggestion with two conditions stands above those with one; the pencil's change is written as changed", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(40, { description: "ATB", category: "Продукти" }),
        ...times(5, { description: "SHELL", category: "Пальне" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    const shell = named(got, "shell")!;
    const res = await accept(space, derivationId, {
      suggestions: [
        { ordinal: named(got, "atb")!.ordinal },
        {
          ordinal: shell.ordinal,
          rule: {
            conditions: [
              shell.conditions[0],
              { field: "amount", operator: "greater", value: { amount: "40", currency: "EUR" } },
            ],
            categoryId: shell.categoryId,
            tags: ["авто"],
          },
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const rules = await listRules(space);
    expect(rules[0]).toMatchObject({
      conditions: [{ field: "merchant" }, { field: "amount" }],
      tags: ["авто"],
    });
    expect(String(rules[1]!.conditions[0]!.value).toLowerCase()).toBe("atb");
  });

  it("BUD-21@PoC AC19: the tag of an accepted suggestion missing in the space is created at the acceptance, with its audit entry, and the run adds it", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const existing = await add(space, account, "NETFLIX");
    await runWorker(space.householdId);
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(9, { description: "NETFLIX", category: "Підписки", tags: "родина" }),
        { description: "NETFLIX", category: "Підписки" },
      ]),
    );
    const netflix = named(await derivation(space, derivationId), "netflix")!;
    expect(netflix.tags).toEqual(["родина"]);
    const res = await accept(space, derivationId, {
      suggestions: [{ ordinal: netflix.ordinal }],
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ tagsCreated: 1, run: { changed: 1 } });
    const tags = await call(space, "GET", "/v1/transaction-tags");
    expect(tags.json().items.map((t: { name: string }) => t.name)).toEqual(["родина"]);
    // The entry's job of module transactions (ARC-04): written by the worker.
    await runWorker(space.householdId);
    const created = await auditRows(space.householdId, "transactions.tag");
    expect(created.filter((e) => e.action === "create")).toHaveLength(1);
    expect(JSON.stringify(created)).not.toContain("родина");
    const detail = await call(space, "GET", `/v1/transactions/${existing}`);
    expect(detail.json().tags).toMatchObject([{ name: "родина" }]);
  });

  it("BUD-21@PoC AC18: a suggestion «Переказ» accepted through the acceptance — the new «На свою картку» is a one-sided transfer awaiting confirmation; an existing one is left as it is (lead decision, owner question)", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const old = await add(space, account, OWN_CARD, "-1000.00");
    await runWorker(space.householdId);
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(6, { description: OWN_CARD, type: "переказ" }),
        ...times(3, { description: "SILPO", category: "Продукти" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    const transfer = got.suggestions.find((s) => s.action === "transfer")!;
    expect(transfer.selected).toBe(true);
    const res = await accept(space, derivationId, {
      suggestions: [{ ordinal: transfer.ordinal }],
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ transfers: 1, run: { count: 0, changed: 0 } });
    expect((await call(space, "GET", `/v1/transactions/${old}`)).json().oneSidedTransfer).toBeNull();
    expect(await categoryOf(space, old)).toMatchObject({ categoryId: null, source: "none" });

    const fresh = await add(space, account, OWN_CARD, "-1000.00");
    await runWorker(space.householdId);
    const detail = (await call(space, "GET", `/v1/transactions/${fresh}`)).json();
    expect(detail.transfer).toBeNull();
    expect(detail.oneSidedTransfer).toEqual({ state: "flagged", evidence: ["category-rule"] });
    expect(await categoryOf(space, fresh)).toMatchObject({ categoryId: null, source: "none" });
  });

  it("BUD-14@PoC FR 16: «Правила категорій» shows the rules «з історії» and the count of the suggestions not accepted yet", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(5, { description: "ATB", category: "Продукти" }),
      ]),
    );
    const list = async () => (await call(space, "GET", "/v1/category-rule-derivations")).json();
    expect(await list()).toMatchObject({
      pending: 2,
      items: [{ derivation: { id: derivationId }, pending: 2 }],
    });
    const got = await derivation(space, derivationId);
    await accept(space, derivationId, { suggestions: [{ ordinal: named(got, "silpo")!.ordinal }] });
    expect(await list()).toMatchObject({ pending: 1 });
    expect((await listRules(space)).map((r) => r.origin)).toEqual(["history"]);
  });

  it("BUD-21@PoC FR 22: two acceptances of the same suggestions at once write their rules once; the other is told to reload", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history(times(5, { description: "SILPO", category: "Продукти" })),
    );
    const body = { suggestions: selectedOf(await derivation(space, derivationId)) };
    const [a, b] = await Promise.all([accept(space, derivationId, body), accept(space, derivationId, body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.json().code).toBe("HISTORY_SUGGESTIONS_CHANGED");
    expect(await listRules(space)).toHaveLength(1);
  });

  it("BUD-21@PoC FR 22: with another run of the space still running the acceptance with «Застосувати до наявних» writes nothing", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history(times(5, { description: "SILPO", category: "Продукти" })),
    );
    await db.owner.query(
      `INSERT INTO categorization.rule_runs (household_id, id, rule_id, actor_account_id, category_id, status, item_count,
                                             created_at)
       VALUES ($1, $2, $3, $4, $3, 'running', 0, now())`,
      [space.householdId, randomUUID(), randomUUID(), space.accountId],
    );
    const res = await accept(space, derivationId, {
      suggestions: selectedOf(await derivation(space, derivationId)),
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe("RULE_RUN_RUNNING");
    expect(await listRules(space)).toHaveLength(0);
  });
});

describe("BUD-21@PoC FR 23: the rejection", () => {
  it("BUD-21@PoC AC28: a rejected «Rozetka → Дім» is not shown when the same file is derived again or uploaded again after it was deleted; the rest and their order are the same", async () => {
    const space = await newSpace();
    const bytes = history([
      ...times(5, { description: "ROZETKA", category: "Дім" }),
      ...times(6, { description: "SILPO", category: "Продукти" }),
      ...times(4, { description: "ATB", category: "Продукти" }),
    ]);
    const first = await confirmed(space, bytes);
    const before = await derivation(space, first.derivationId);
    const rozetka = named(before, "rozetka")!;
    const rest = before.suggestions.filter((s) => s !== rozetka).map((s) => [valueOf(s), s.categoryId]);
    const res = await call(
      space,
      "POST",
      `/v1/category-rule-derivations/${first.derivationId}/suggestions/${rozetka.ordinal}/reject`,
      {},
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ rejected: true });
    const shownNow = (d: Derivation) => d.suggestions.map((s) => [valueOf(s), s.categoryId]);
    expect(shownNow(await derivation(space, first.derivationId))).toEqual(rest);

    const again = await call(space, "POST", "/v1/category-rule-derivations", { batchId: first.batchId });
    expect(again.statusCode, again.body).toBe(201);
    expect(shownNow(await derivation(space, again.json().derivation.id))).toEqual(rest);

    const gone = await call(space, "DELETE", `/v1/import/history-files/${first.batchId}`);
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    const second = await confirmed(space, bytes);
    expect(second.batchId).not.toBe(first.batchId);
    expect(shownNow(await derivation(space, second.derivationId))).toEqual(rest);

    const entries = await auditRows(space.householdId, "categorization.history-derivation");
    expect(entries.filter((e) => e.changes.rejected === "1")).toHaveLength(1);
  });
});

describe("BUD-21@PoC EC8: the category of a suggestion deleted or merged before the acceptance", () => {
  it("BUD-21@PoC EC8: a deleted category — the acceptance is refused with that reason and nothing is written; a merged one — the suggestion takes the target category", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "KAVARNIA", category: "Кавові зерна" }),
        ...times(5, { description: "LAVKA", category: "Ринок" }),
      ]),
    );
    const beans = await categoryNamed(space.householdId, "Кавові зерна");
    const market = await categoryNamed(space.householdId, "Ринок");
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const deleted = await call(space, "DELETE", `/v1/categories/${beans}`);
    expect(deleted.statusCode, deleted.body).toBeLessThan(300);
    const merged = await call(space, "POST", `/v1/categories/${market}/merge`, { targetId: groceries });
    expect(merged.statusCode, merged.body).toBe(200);

    const got = await derivation(space, derivationId);
    const kavarnia = named(got, "kavarnia")!;
    const lavka = named(got, "lavka")!;
    expect(kavarnia).toMatchObject({ categoryDeleted: true, selected: false });
    expect(lavka).toMatchObject({ categoryId: groceries, categoryDeleted: false });

    const refused = await accept(space, derivationId, {
      suggestions: [{ ordinal: lavka.ordinal }, { ordinal: kavarnia.ordinal }],
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "HISTORY_SUGGESTION_CATEGORY_DELETED",
      errors: [{ path: "suggestions.1.ordinal", issue: "category_deleted" }],
    });
    expect(await listRules(space)).toHaveLength(0);

    const ok = await accept(space, derivationId, { suggestions: [{ ordinal: lavka.ordinal }] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await listRules(space))[0]).toMatchObject({ categoryId: groceries });
  });
});

describe("BUD-21@PoC «Права доступу», FR 26: the space, the flags, the audit", () => {
  it("BUD-21@PoC FR 22: another space's derivation is not found for the page, the dialog, the acceptance and the rejection; a scoped member gets not found for the page and forbidden for the acceptance", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history(times(5, { description: "SILPO", category: "Продукти" })),
    );
    const ordinal = (await derivation(space, derivationId)).suggestions[0]!.ordinal;
    const body = { suggestions: [{ ordinal }] };
    for (const [method, url, payload] of [
      ["GET", `/v1/category-rule-derivations/${derivationId}`, undefined],
      ["POST", `/v1/category-rule-derivations/${derivationId}/matches`, body],
      ["POST", `/v1/category-rule-derivations/${derivationId}/accept`, body],
      ["POST", `/v1/category-rule-derivations/${derivationId}/suggestions/${ordinal}/reject`, {}],
    ] as const) {
      const res = await call(other, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(leakText(res.body)).not.toContain("SILPO");
    }
    expect((await call(other, "GET", "/v1/category-rule-derivations")).json()).toEqual({
      items: [],
      pending: 0,
    });
    // A member scoped to some accounts: the page is not found, a write is forbidden (as BUD-01's routes).
    const scoped = { role: "editor", scoped: true };
    const page = await call(space, "GET", `/v1/category-rule-derivations/${derivationId}`, undefined, scoped);
    expect(page.statusCode).toBe(404);
    const write = await call(
      space,
      "POST",
      `/v1/category-rule-derivations/${derivationId}/accept`,
      body,
      scoped,
    );
    expect(write.statusCode).toBe(403);
    expect(await listRules(space)).toHaveLength(0);
  });

  it("BUD-21@PoC FR 22: with the flag `categorization.rules` or `categorization.history-rules` off the acceptance is not found", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history(times(5, { description: "SILPO", category: "Продукти" })),
    );
    const body = { suggestions: selectedOf(await derivation(space, derivationId)) };
    off.add("categorization.rules");
    expect((await accept(space, derivationId, body)).statusCode).toBe(404);
    off.clear();
    off.add("categorization.history-rules");
    expect((await accept(space, derivationId, body)).statusCode).toBe(404);
    off.clear();
    expect(await listRules(space)).toHaveLength(0);
  });

  it("BUD-21@PoC FR 26: the acceptance, the rules, the run and the rejection are in the audit log — ids and counts, nothing of the file", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    await add(space, account, "SILPO ZHYTOMYRSKA");
    await runWorker(space.householdId);
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO ZHYTOMYRSKA", category: "Продукти" }),
        ...times(5, { description: "BIBLIOTEKA OLEKSY", category: "Освіта" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    const res = await accept(space, derivationId, {
      suggestions: [{ ordinal: named(got, "silpo")!.ordinal }],
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const reject = await call(
      space,
      "POST",
      `/v1/category-rule-derivations/${derivationId}/suggestions/${named(got, "biblioteka")!.ordinal}/reject`,
      {},
    );
    expect(reject.statusCode).toBe(200);
    const entries = await auditRows(space.householdId, "categorization.history-derivation");
    expect(entries.find((e) => e.changes.accepted === "1")!.changes).toEqual({
      accepted: "1",
      runId: res.json().run.id,
    });
    // The rejected conditions are the file's words: written as sensitive (masked in the log), never in the clear.
    expect(entries.find((e) => e.changes.rejected === "1")!.changes).toMatchObject({
      rejected: "1",
      conditions: "•••",
    });
    expect((await auditRows(space.householdId, "categorization.rule-run"))[0]!.changes).toMatchObject({
      derivationId,
      changed: "1",
    });
    const { rows } = await db.owner.query<{ text: string }>(
      `SELECT changes::text AS text FROM audit.entries WHERE household_id = $1 AND entity_type LIKE 'categorization.%'`,
      [space.householdId],
    );
    expect(rows.some((r) => /SILPO|ZHYTOMYRSKA|BIBLIOTEKA|OLEKSY/iu.test(r.text))).toBe(false);
  });
});

describe("BUD-21@PoC FR 22: the run of an acceptance in the background", () => {
  it("ARC-04@PoC FR 4: the part job of an acceptance's run is dead — nothing changes until the daily recovery puts it back, then each transaction takes its own rule's category", async () => {
    const space = await newSpace();
    // The categories of a confirmed file (made at its confirmation).
    await confirmed(
      space,
      history([
        ...times(3, { description: "SILPO", category: "Продукти" }),
        ...times(3, { description: "ATB", category: "Здоров'я" }),
      ]),
    );
    const account = await createAccount(space);
    const silpo = await add(space, account, "SILPO");
    const atb = await add(space, account, "ATB");
    await runWorker(space.householdId);
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const pharmacy = await categoryNamed(space.householdId, "Здоров'я");
    const ruleA = randomUUID();
    const ruleB = randomUUID();
    const runId = randomUUID();
    const merchant = (value: string): RuleCondition[] => [{ field: "merchant", operator: "equals", value }];
    const names = await rulePorts.merchants.knownNames(space.householdId, ["SILPO", "ATB"]);
    // The acceptance's transaction without the request's own parts: the run waits for its job.
    const accepted = await db.databases.for("categorization").inHousehold(space.householdId, (q) =>
      acceptSuggestions(rulesTx(q), runsTx(q), {
        householdId: space.householdId,
        actorAccountId: space.accountId,
        derivationId: randomUUID(),
        rules: [
          {
            id: ruleA,
            ordinal: 1,
            conditions: merchant(names.get("SILPO")!),
            accountIds: [],
            categoryId: groceries,
            tags: [],
            matched: 5,
            rows: [1],
            transfer: false,
          },
          {
            id: ruleB,
            ordinal: 2,
            conditions: merchant(names.get("ATB")!),
            accountIds: [],
            categoryId: pharmacy,
            tags: [],
            matched: 4,
            rows: [6],
            transfer: false,
          },
        ],
        plan: {
          transactionIds: [silpo, atb],
          rules: [
            { ruleId: ruleA, categoryId: groceries, tagRuleId: null, tags: [] },
            { ruleId: ruleB, categoryId: pharmacy, tagRuleId: null, tags: [] },
          ],
          transfers: 0,
          truncated: false,
        },
        runId,
        now: NOW,
      }),
    );
    expect(accepted.kind).toBe("ok");
    await db.owner.query(
      `UPDATE categorization.jobs SET state = 'dead', attempts = 8
        WHERE household_id = $1 AND name = 'categorization.rule-run-part'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await categoryOf(space, silpo)).toMatchObject({ categoryId: null });

    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => NOW,
    });
    await tasks.find((task) => task.name === "categorization.recovery")!.run();
    await runWorker(space.householdId);
    expect(await categoryOf(space, silpo)).toMatchObject({
      categoryId: groceries,
      source: "rule",
      rule: { id: ruleA },
    });
    expect(await categoryOf(space, atb)).toMatchObject({
      categoryId: pharmacy,
      source: "rule",
      rule: { id: ruleB },
    });
    const report = await call(space, "GET", `/v1/category-rule-runs/${runId}`);
    expect(report.json()).toMatchObject({ status: "completed", changed: 2 });
  });
});
