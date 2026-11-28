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
  createCategorizationErasure,
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

/**
 * Security review of PR #767 (BUD-21 e): the properties of the acceptance, «Застосувати до наявних» and its «Відмінити»
 * that the PR's own tests leave open. The harness above is the one of bud21-acceptance.it.test.ts. Synthetic data only.
 */
const SILPO = times(5, { description: "SILPO", category: "Продукти" });

async function categoryRows(householdId: string) {
  const { rows } = await db.owner.query<{ transaction_id: string }>(
    `SELECT transaction_id FROM categorization.transaction_categories
      WHERE household_id = $1 AND category_id IS NOT NULL`,
    [householdId],
  );
  return rows.map((r) => r.transaction_id);
}

async function categoryAudits(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ entity_id: string }>(
    `SELECT entity_id FROM audit.entries WHERE household_id = $1 AND entity_type = 'categorization.transaction-category'`,
    [householdId],
  );
  return rows.map((r) => r.entity_id);
}

const tagsOf = async (space: Space, id: string) =>
  ((await call(space, "GET", `/v1/transactions/${id}`)).json().tags as { name: string }[]).map((t) => t.name);

describe("sec767: the space and the roles on the routes of the acceptance", () => {
  it("sec767: a scoped member gets not found on every route of the suggestions — whatever the role — and nothing is written", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(space, history(SILPO));
    const ordinal = (await derivation(space, derivationId)).suggestions[0]!.ordinal;
    const body = { suggestions: [{ ordinal }] };
    const base = `/v1/category-rule-derivations`;
    for (const role of ["owner", "admin", "editor", "viewer"])
      for (const [method, url, payload] of [
        ["GET", base, undefined],
        ["GET", `${base}/${derivationId}`, undefined],
        ["POST", `${base}/${derivationId}/matches`, body],
        ["POST", `${base}/${derivationId}/accept`, { ...body, apply: true }],
        ["POST", `${base}/${derivationId}/suggestions/${ordinal}/reject`, {}],
      ] as const) {
        const res = await call(space, method, url, payload, { role, scoped: true });
        expect([403, 404], `${role} ${method} ${url}`).toContain(res.statusCode);
        // A scoped Owner or Admin is an impossible member: the platform refuses it (403) before the route.
        if (method === "GET" && role !== "owner" && role !== "admin")
          expect(res.statusCode, `${role} ${method} ${url}`).toBe(404);
        expect(leakText(res.body)).not.toContain("SILPO");
        expect(res.body).not.toContain(derivationId);
      }
    expect(await listRules(space)).toHaveLength(0);
    const { rows } = await db.owner.query(
      `SELECT 1 FROM categorization.history_rejections WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(0);
    expect((await derivation(space, derivationId)).suggestions).toHaveLength(1);
  });

  it("sec767: a member who may only read cannot accept or reject", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(space, history(SILPO));
    const ordinal = (await derivation(space, derivationId)).suggestions[0]!.ordinal;
    const viewer = { role: "viewer" };
    const accepted = await call(
      space,
      "POST",
      `/v1/category-rule-derivations/${derivationId}/accept`,
      { suggestions: [{ ordinal }], apply: true },
      viewer,
    );
    expect(accepted.statusCode).toBe(403);
    const rejected = await call(
      space,
      "POST",
      `/v1/category-rule-derivations/${derivationId}/suggestions/${ordinal}/reject`,
      {},
      viewer,
    );
    expect(rejected.statusCode).toBe(403);
    expect(await listRules(space)).toHaveLength(0);
    expect((await derivation(space, derivationId)).suggestions).toHaveLength(1);
  });

  it("sec767: the pencil's rule with an account or a category of another space is refused as an unknown one, and nothing is written", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const foreignAccount = await createAccount(other);
    await confirmed(other, history(SILPO));
    const foreignCategory = await categoryNamed(other.householdId, "Продукти");
    const { derivationId } = await confirmed(space, history(SILPO));
    const s = (await derivation(space, derivationId)).suggestions[0]!;
    const rule = (over: object) => ({
      suggestions: [
        { ordinal: s.ordinal, rule: { conditions: s.conditions, categoryId: s.categoryId, ...over } },
      ],
      apply: true,
    });
    const answers: string[] = [];
    for (const [foreign, unknown] of [
      [rule({ accountIds: [foreignAccount] }), rule({ accountIds: [randomUUID()] })],
      [rule({ categoryId: foreignCategory }), rule({ categoryId: randomUUID() })],
      [
        rule({ conditions: [{ field: "account", operator: "equals", value: foreignAccount }] }),
        rule({ conditions: [{ field: "account", operator: "equals", value: randomUUID() }] }),
      ],
    ] as const)
      for (const route of ["matches", "accept"]) {
        const a = await call(space, "POST", `/v1/category-rule-derivations/${derivationId}/${route}`, {
          ...foreign,
          ...(route === "matches" ? { apply: undefined } : {}),
        });
        const b = await call(space, "POST", `/v1/category-rule-derivations/${derivationId}/${route}`, {
          ...unknown,
          ...(route === "matches" ? { apply: undefined } : {}),
        });
        expect(a.statusCode, a.body).toBe(400);
        // The same answer as for an id that exists nowhere: no sign that the other space has it.
        expect({ ...a.json(), traceId: null, instance: null }).toEqual({
          ...b.json(),
          traceId: null,
          instance: null,
        });
        answers.push(a.body);
      }
    expect(answers.join()).not.toContain(other.householdId);
    expect(await listRules(space)).toHaveLength(0);
  });
});

describe("sec767: «Застосувати до наявних» never leaves the space or the shown transactions", () => {
  it("sec767: the same merchant in two spaces, one of its transactions hidden: the dialog counts and the run changes only the caller's shown ones, each with its audit entry", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const account = await createAccount(space);
    const mine = await addMany(space, account, "SILPO", 3);
    // A side of a transfer, a split one and one merged into another: no rule sets their category either.
    const closed = await addMany(space, account, "SILPO", 3);
    const theirs = await addMany(other, await createAccount(other), "SILPO", 4);
    await runWorker(space.householdId);
    await runWorker(other.householdId);
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [mine[0]]);
    await db.owner.query(
      `UPDATE transactions.transactions SET transfer_id = gen_random_uuid() WHERE id = $1`,
      [closed[0]],
    );
    await db.owner.query(`UPDATE transactions.transactions SET split_mode = 'categories' WHERE id = $1`, [
      closed[1],
    ]);
    await db.owner.query(`UPDATE transactions.transactions SET merged_into = $2 WHERE id = $1`, [
      closed[2],
      mine[1],
    ]);
    await confirmed(other, history(SILPO));
    const { derivationId } = await confirmed(space, history(SILPO));
    const got = await derivation(space, derivationId);
    expect(got.suggestions[0]!.existing).toBe(2);
    const body = { suggestions: selectedOf(got) };
    const matches = await call(space, "POST", `/v1/category-rule-derivations/${derivationId}/matches`, body);
    expect(matches.json()).toEqual({ count: 2, transfers: 0, truncated: false });

    const res = await accept(space, derivationId, { ...body, apply: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().run).toMatchObject({ count: 2, changed: 2 });
    expect((await categoryRows(space.householdId)).sort()).toEqual([mine[1], mine[2]].sort());
    expect(await categoryRows(other.householdId)).toEqual([]);
    const { rows } = await db.owner.query<{ transaction_id: string; household_id: string }>(
      `SELECT transaction_id, household_id FROM categorization.rule_run_items WHERE run_id = $1`,
      [res.json().run.id],
    );
    expect(rows.map((r) => r.transaction_id).sort()).toEqual([mine[1], mine[2]].sort());
    expect(new Set(rows.map((r) => r.household_id))).toEqual(new Set([space.householdId]));
    // AGENTS.md «Audit»: one entry per changed transaction, none for the other space.
    await runWorker(space.householdId);
    expect((await categoryAudits(space.householdId)).sort()).toEqual([mine[1], mine[2]].sort());
    expect(await categoryAudits(other.householdId)).toEqual([]);
    expect(theirs).toHaveLength(4);
  });

  it("sec767: a record of the run that is another space's transaction, or hidden since the dialog, is left as it is («unavailable»)", async () => {
    const space = await newSpace();
    const other = await newSpace();
    await confirmed(space, history(SILPO));
    const account = await createAccount(space);
    const [shown, hiddenLater] = await addMany(space, account, "SILPO", 2);
    const foreign = await add(other, await createAccount(other), "SILPO");
    await runWorker(space.householdId);
    await runWorker(other.householdId);
    const groceries = await categoryNamed(space.householdId, "Продукти");
    const ruleId = randomUUID();
    const runId = randomUUID();
    const names = await rulePorts.merchants.knownNames(space.householdId, ["SILPO"]);
    const record = { ruleId, categoryId: groceries, tagRuleId: ruleId, tags: ["сек767"] };
    const accepted = await db.databases.for("categorization").inHousehold(space.householdId, (q) =>
      acceptSuggestions(rulesTx(q), runsTx(q), {
        householdId: space.householdId,
        actorAccountId: space.accountId,
        derivationId: randomUUID(),
        rules: [
          {
            id: ruleId,
            ordinal: 1,
            conditions: [{ field: "merchant", operator: "equals", value: names.get("SILPO")! }],
            accountIds: [],
            categoryId: groceries,
            tags: ["сек767"],
            matched: 5,
            rows: [1],
            transfer: false,
          },
        ],
        plan: {
          transactionIds: [shown!, hiddenLater!, foreign],
          rules: [record, record, record],
          transfers: 0,
          truncated: false,
        },
        runId,
        now: NOW,
      }),
    );
    expect(accepted.kind).toBe("ok");
    await db.owner.query(`UPDATE transactions.transactions SET hidden = true WHERE id = $1`, [hiddenLater]);
    await runWorker(space.householdId);
    const report = await call(space, "GET", `/v1/category-rule-runs/${runId}`);
    expect(report.json()).toMatchObject({
      status: "completed",
      changed: 1,
      skipped: { unavailable: 2 },
    });
    expect(await categoryRows(space.householdId)).toEqual([shown]);
    expect(await categoryRows(other.householdId)).toEqual([]);
    const { rows } = await db.owner.query<{ id: string }>(
      `SELECT id FROM transactions.transactions WHERE id = ANY($1::uuid[]) AND cardinality(tag_ids) > 0`,
      [[hiddenLater, foreign]],
    );
    expect(rows).toEqual([]);
    expect(await categoryAudits(other.householdId)).toEqual([]);
  });
});

describe("sec767: an accepted rule deleted before its part of the run", () => {
  it("sec767: the records of a rule deleted since the acceptance change nothing — no category, no tag; the other rule's records do", async () => {
    const space = await newSpace();
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
    const names = await rulePorts.merchants.knownNames(space.householdId, ["SILPO", "ATB"]);
    const rule = (id: string, ordinal: number, merchant: string, categoryId: string) => ({
      id,
      ordinal,
      conditions: [{ field: "merchant", operator: "equals", value: names.get(merchant)! }] as RuleCondition[],
      accountIds: [],
      categoryId,
      tags: ["сек767"],
      matched: 3,
      rows: [1],
      transfer: false,
    });
    const accepted = await db.databases.for("categorization").inHousehold(space.householdId, (q) =>
      acceptSuggestions(rulesTx(q), runsTx(q), {
        householdId: space.householdId,
        actorAccountId: space.accountId,
        derivationId: randomUUID(),
        rules: [rule(ruleA, 1, "SILPO", groceries), rule(ruleB, 2, "ATB", pharmacy)],
        plan: {
          transactionIds: [silpo, atb],
          rules: [
            { ruleId: ruleA, categoryId: groceries, tagRuleId: ruleA, tags: ["сек767"] },
            { ruleId: ruleB, categoryId: pharmacy, tagRuleId: ruleB, tags: ["сек767"] },
          ],
          transfers: 0,
          truncated: false,
        },
        runId,
        now: NOW,
      }),
    );
    expect(accepted.kind).toBe("ok");
    const gone = await call(space, "DELETE", `/v1/category-rules/${ruleA}`);
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    await runWorker(space.householdId);
    const report = await call(space, "GET", `/v1/category-rule-runs/${runId}`);
    expect(report.json()).toMatchObject({ status: "completed", changed: 1, skipped: { unavailable: 1 } });
    expect(await categoryOf(space, silpo)).toMatchObject({ categoryId: null, source: "none" });
    expect(await tagsOf(space, silpo)).toEqual([]);
    expect(await categoryOf(space, atb)).toMatchObject({ categoryId: pharmacy, source: "rule" });
    expect(await tagsOf(space, atb)).toEqual(["сек767"]);
  });
});

describe("sec767: «Відмінити» of an acceptance's run", () => {
  it("sec767: gives back exactly what was there — an earlier rule's category, no category, the tags — except what changed since; each change has its audit entry; a second «Відмінити» does nothing", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(9, { description: "NETFLIX", category: "Підписки", tags: "родина" }),
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(5, { description: "SPOTIFY", category: "Розваги" }),
      ]),
    );
    const first = await derivation(space, derivationId);
    const home = await categoryNamed(space.householdId, "Дім");
    // An earlier rule of the space sets «SPOTIFY → Дім»; the suggestion «SPOTIFY → Розваги» conflicts with it.
    const earlier = await handRule(space, String(named(first, "spotify")!.conditions[0]!.value), home);
    const account = await createAccount(space);
    const spotify = await add(space, account, "SPOTIFY");
    const netflix = await add(space, account, "NETFLIX");
    const silpo = await addMany(space, account, "SILPO", 2);
    await runWorker(space.householdId);
    expect(await categoryOf(space, spotify)).toMatchObject({ categoryId: home, source: "rule" });
    const before = {
      spotify: await categoryOf(space, spotify),
      netflix: await categoryOf(space, netflix),
      silpo: await categoryOf(space, silpo[0]!),
    };
    const auditsBefore = (await categoryAudits(space.householdId)).length;

    const got = await derivation(space, derivationId);
    const res = await accept(space, derivationId, {
      suggestions: got.suggestions.map((s) => ({ ordinal: s.ordinal })),
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const run = res.json().run;
    expect(run).toMatchObject({ count: 4, changed: 4 });
    expect((await categoryOf(space, spotify)).rule?.id).not.toBe(earlier);
    expect(await tagsOf(space, netflix)).toEqual(["родина"]);
    await runWorker(space.householdId);
    expect((await categoryAudits(space.householdId)).length - auditsBefore).toBe(4);

    // Changed by hand since the run: «Відмінити» leaves it.
    const set = await call(space, "PUT", `/v1/transactions/${silpo[1]}/category`, { categoryId: home });
    expect(set.statusCode, set.body).toBe(200);
    await runWorker(space.householdId);
    const auditsApplied = (await categoryAudits(space.householdId)).length;

    const url = `/v1/category-rule-runs/${run.id}/undo`;
    const [a, b] = await Promise.all([call(space, "POST", url, {}), call(space, "POST", url, {})]);
    expect([a.statusCode, b.statusCode].sort(), a.body + b.body).toEqual([200, 409]);
    await runWorker(space.householdId);
    const report = (await call(space, "GET", `/v1/category-rule-runs/${run.id}`)).json();
    expect(report).toMatchObject({
      status: "undone",
      undo: { available: false, restored: 3, notRestored: 1 },
    });
    expect(await categoryOf(space, spotify)).toEqual(before.spotify);
    expect(await categoryOf(space, netflix)).toEqual(before.netflix);
    expect(await categoryOf(space, silpo[0]!)).toEqual(before.silpo);
    expect(await categoryOf(space, silpo[1]!)).toMatchObject({ categoryId: home, source: "manual" });
    expect(await tagsOf(space, netflix)).toEqual([]);
    expect((await categoryAudits(space.householdId)).length - auditsApplied).toBe(3);
    const again = await call(space, "POST", url, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("RULE_RUN_UNDONE");
    expect(await categoryOf(space, spotify)).toEqual(before.spotify);
  });

  it("sec767: another space's run is not found for its report and its «Відмінити», and stays as it is", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const { derivationId } = await confirmed(space, history(SILPO));
    const tx = await add(space, await createAccount(space), "SILPO");
    await runWorker(space.householdId);
    const res = await accept(space, derivationId, {
      suggestions: selectedOf(await derivation(space, derivationId)),
      apply: true,
    });
    const runId = res.json().run.id as string;
    expect((await call(other, "GET", `/v1/category-rule-runs/${runId}`)).statusCode).toBe(404);
    expect((await call(other, "POST", `/v1/category-rule-runs/${runId}/undo`, {})).statusCode).toBe(404);
    expect((await call(other, "GET", "/v1/category-rule-runs")).json().items).toEqual([]);
    expect(await categoryOf(space, tx)).toMatchObject({ source: "rule" });
  });
});

describe("sec767: two acceptances at once, the flags and the limits", () => {
  it("sec767: two acceptances of different suggestions with «Застосувати до наявних» at once: one run, and the refused one writes no rule", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(5, { description: "EPICENTR", category: "Дім" }),
      ]),
    );
    const account = await createAccount(space);
    await addMany(space, account, "SILPO", 3);
    await addMany(space, account, "EPICENTR", 3);
    await runWorker(space.householdId);
    const got = await derivation(space, derivationId);
    const one = { suggestions: [{ ordinal: named(got, "silpo")!.ordinal }], apply: true };
    const two = { suggestions: [{ ordinal: named(got, "epicentr")!.ordinal }], apply: true };
    const [a, b] = await Promise.all([accept(space, derivationId, one), accept(space, derivationId, two)]);
    const codes = [a.statusCode, b.statusCode].sort();
    // Either the first run ended before the second began (both written), or the second was refused whole.
    expect([[201, 201].join(), [201, 409].join()], a.body + b.body).toContain(codes.join());
    const rules = await listRules(space);
    const runs = (await call(space, "GET", "/v1/category-rule-runs")).json().items as { changed: number }[];
    expect(rules).toHaveLength(codes[1] === 409 ? 1 : 2);
    expect(runs).toHaveLength(rules.length);
    expect(await categoryRows(space.householdId)).toHaveLength(3 * rules.length);
    if (codes[1] === 409)
      expect([a, b].find((r) => r.statusCode === 409)!.json().code).toBe("RULE_RUN_RUNNING");
  });

  it("sec767: with `categorization.rules` off the dialog's count is not found; with `categorization.history-rules` off every route is", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(space, history(SILPO));
    const ordinal = (await derivation(space, derivationId)).suggestions[0]!.ordinal;
    const body = { suggestions: [{ ordinal }] };
    const base = `/v1/category-rule-derivations`;
    off.add("categorization.rules");
    expect((await call(space, "POST", `${base}/${derivationId}/matches`, body)).statusCode).toBe(404);
    expect((await accept(space, derivationId, { ...body, apply: true })).statusCode).toBe(404);
    off.clear();
    off.add("categorization.history-rules");
    for (const [method, url, payload] of [
      ["GET", base, undefined],
      ["GET", `${base}/${derivationId}`, undefined],
      ["POST", `${base}/${derivationId}/matches`, body],
      ["POST", `${base}/${derivationId}/accept`, body],
      ["POST", `${base}/${derivationId}/suggestions/${ordinal}/reject`, {}],
    ] as const)
      expect((await call(space, method, url, payload)).statusCode, `${method} ${url}`).toBe(404);
    off.clear();
    expect(await listRules(space)).toHaveLength(0);
    expect((await derivation(space, derivationId)).suggestions).toHaveLength(1);
  });

  it("sec767: an acceptance that would pass the space's 500 rules writes nothing; more than 500 suggestions in one request are refused", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(5, { description: "EPICENTR", category: "Дім" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    const groceries = await categoryNamed(space.householdId, "Продукти");
    await db.owner.query(
      `INSERT INTO categorization.rules (household_id, id, position, conditions, account_ids, category_id, enabled,
                                         version, tags, condition_key)
       SELECT $1, gen_random_uuid(), n,
              jsonb_build_array(jsonb_build_object('field', 'description', 'operator', 'contains',
                                                   'value', 'синтетика ' || n)),
              '{}', $2, true, 1, '{}', 'sec767-' || n
         FROM generate_series(1, 499) n`,
      [space.householdId, groceries],
    );
    const tx = await add(space, await createAccount(space), "SILPO");
    await runWorker(space.householdId);
    const res = await accept(space, derivationId, {
      suggestions: got.suggestions.map((s) => ({ ordinal: s.ordinal })),
      apply: true,
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe("LIMIT_REACHED");
    expect(await listRules(space)).toHaveLength(499);
    expect((await call(space, "GET", "/v1/category-rule-runs")).json().items).toEqual([]);
    expect(await categoryOf(space, tx)).toMatchObject({ categoryId: null });
    const many = await accept(space, derivationId, {
      suggestions: Array.from({ length: 501 }, (_, i) => ({ ordinal: i + 1 })),
    });
    expect(many.statusCode).toBe(400);
  });
});

describe("sec767: the tags created at the acceptance (BUD-21 FR 22, FR 26)", () => {
  it("sec767: more than 20 different tags across the accepted rules are all created at the acceptance, each with its audit entry", async () => {
    const space = await newSpace();
    const { derivationId } = await confirmed(
      space,
      history([
        ...times(5, { description: "SILPO", category: "Продукти" }),
        ...times(5, { description: "EPICENTR", category: "Дім" }),
      ]),
    );
    const got = await derivation(space, derivationId);
    const tagged = (s: Suggestion, from: number) => ({
      ordinal: s.ordinal,
      rule: {
        conditions: s.conditions,
        categoryId: s.categoryId,
        tags: Array.from({ length: 11 }, (_, i) => `мітка ${from + i}`),
      },
    });
    const res = await accept(space, derivationId, {
      suggestions: [tagged(named(got, "silpo")!, 1), tagged(named(got, "epicentr")!, 12)],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().tagsCreated).toBe(22);
    await runWorker(space.householdId);
    expect((await call(space, "GET", "/v1/transaction-tags")).json().items).toHaveLength(22);
    const created = await auditRows(space.householdId, "transactions.tag");
    expect(created.filter((e) => e.action === "create")).toHaveLength(22);
  });
});

describe("sec767: the space's erasure (NFR-12 FR 3)", () => {
  it("sec767: the erasure takes the rejected suggestions, the acceptance's run with its records and the rules — and nothing of another space", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const file = history([
      ...times(5, { description: "SILPO", category: "Продукти" }),
      ...times(5, { description: "EPICENTR", category: "Дім" }),
    ]);
    const tables = ["history_rejections", "rule_runs", "rule_run_items", "rules", "history_suggestions"];
    const left = async (householdId: string) => {
      const out: Record<string, number> = {};
      for (const table of tables) {
        const { rows } = await db.owner.query<{ n: string }>(
          `SELECT count(*) AS n FROM categorization.${table} WHERE household_id = $1`,
          [householdId],
        );
        out[table] = Number(rows[0]!.n);
      }
      return out;
    };
    for (const s of [space, other]) {
      const { derivationId } = await confirmed(s, file);
      await add(s, await createAccount(s), "SILPO");
      await runWorker(s.householdId);
      const got = await derivation(s, derivationId);
      const res = await accept(s, derivationId, {
        suggestions: [{ ordinal: named(got, "silpo")!.ordinal }],
        apply: true,
      });
      expect(res.statusCode, res.body).toBe(201);
      const reject = await call(
        s,
        "POST",
        `/v1/category-rule-derivations/${derivationId}/suggestions/${named(got, "epicentr")!.ordinal}/reject`,
        {},
      );
      expect(reject.json()).toEqual({ rejected: true });
    }
    const full = { history_rejections: 1, rule_runs: 1, rule_run_items: 1, rules: 1, history_suggestions: 2 };
    expect(await left(space.householdId)).toEqual(full);
    await createCategorizationErasure(db.databases.for("categorization")).eraseHousehold(space.householdId);
    expect(await left(space.householdId)).toEqual({
      history_rejections: 0,
      rule_runs: 0,
      rule_run_items: 0,
      rules: 0,
      history_suggestions: 0,
    });
    expect(await left(other.householdId)).toEqual(full);
  });
});
