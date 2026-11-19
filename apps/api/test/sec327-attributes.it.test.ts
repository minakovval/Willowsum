// ===== FILE: apps/api/test/sec327-attributes.it.test.ts =====
// Apply with patch-bulk-add-tags-flag.diff (4th argument of bulkActionsServicesFor), then drop the one `.fails`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { bulkActionsServicesFor, workerQueues } from "../src/wiring.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxRates, createFxReporting, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "../src/modules/categories/index.ts";
import { createTransactionsErasure, createTransactionsServices } from "../src/modules/transactions/index.ts";
import { createDuplicateCheck } from "../src/modules/duplicate-matching/index.ts";
import { leakText } from "./leak-text.ts";

/**
 * Security review of PR 327 (BUD-13@PoC a): roles, isolation, bounds, gating, masking, RLS and erasure.
 * space's tags (renamed, merged, deleted with their count), the filter «Теги», the bulk action «Додати теги» (DAT-03
 * FR 2) and «Вибрано N · Сума ±X €» (FR 9). Every name and amount is synthetic; the session is the test's principal
 * header; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Tx {
  id: string;
  note: string | null;
  tags: { id: string; name: string }[];
  split: unknown;
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

async function createAccount(space: Space, currency = "EUR"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "current",
    name: `Рахунок ${currency}`,
    balance: { amount: "1000.00", currency },
    balanceDate: "2026-01-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function add(
  space: Space,
  accountId: string,
  amount: string,
  extra: { currency?: string; date?: string; counterparty?: string } = {},
): Promise<Tx> {
  const res = await call(space, "POST", "/v1/transactions", {
    accountId,
    amount: { amount, currency: extra.currency ?? "EUR" },
    date: extra.date ?? "2026-10-15",
    counterparty: extra.counterparty ?? "Синтетичний магазин",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Tx;
}

const attributes = (space: Space, id: string, body: unknown) =>
  call(space, "PATCH", `/v1/transactions/${id}/attributes`, body);

const get = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/transactions/${id}`)).json() as Tx;

const list = async (space: Space, query: string) => {
  const res = await call(space, "GET", `/v1/transactions${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { count: number; items: Tx[] };
};

const tagsOf = async (space: Space) =>
  (await call(space, "GET", "/v1/transaction-tags")).json().items as {
    id: string;
    name: string;
    count: number;
  }[];

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    for (let pass = 0; pass < 10; pass++) {
      const handled = await worker.tick();
      await worker.idle();
      if (handled === 0) break;
    }
  } finally {
    await worker.stop();
  }
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
          duplicates: createDuplicateCheck(),
          rates: (requests) =>
            createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW }).rates(requests),
        }),
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
        }),
        bulkActions: bulkActionsServicesFor(audit, db.databases, { now: () => NOW }, { isEnabled }),
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

const bulk = (space: Space, body: unknown, preview: boolean, principal: { role?: string } = {}) =>
  app.inject({
    method: "POST",
    url: preview ? "/v1/bulk-actions/preview" : "/v1/bulk-actions",
    headers: {
      origin: WEB,
      "content-type": "application/json",
      ...(preview ? {} : { "idempotency-key": randomUUID() }),
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
    },
    payload: JSON.stringify(body),
  });

describe("sec327: roles", () => {
  it("BUD-13@PoC FR 2: a viewer and an advisor read tags but change no note, tag or bulk tag", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    await attributes(space, t.id, { note: "n", tags: ["a"] });
    const [tag] = await tagsOf(space);
    for (const role of ["viewer", "advisor"]) {
      expect((await call(space, "GET", "/v1/transaction-tags", undefined, { role })).statusCode).toBe(200);
      expect(
        (await call(space, "PATCH", `/v1/transactions/${t.id}/attributes`, { note: "x" }, { role }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call(space, "PATCH", `/v1/transaction-tags/${tag!.id}`, { name: "b" }, { role })).statusCode,
      ).toBe(403);
      expect(
        (await call(space, "DELETE", `/v1/transaction-tags/${tag!.id}`, undefined, { role })).statusCode,
      ).toBe(403);
      const body = {
        action: "transactions.add-tags",
        selection: { kind: "ids", ids: [t.id] },
        params: { tags: ["c"] },
      };
      expect((await bulk(space, body, false, { role })).statusCode).toBe(403);
    }
    expect(await get(space, t.id)).toMatchObject({ note: "n", tags: [{ name: "a" }] });
  });

  it("BUD-13@PoC: a scoped member changes no tag (403) and gets no selection sum (404)", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    await attributes(space, t.id, { tags: ["a"] });
    const [tag] = await tagsOf(space);
    const scoped = { role: "editor", scoped: true };
    expect(
      (await call(space, "PATCH", `/v1/transaction-tags/${tag!.id}`, { name: "b" }, scoped)).statusCode,
    ).toBe(403);
    expect(
      (await call(space, "DELETE", `/v1/transaction-tags/${tag!.id}`, undefined, scoped)).statusCode,
    ).toBe(403);
    expect(
      (await call(space, "POST", "/v1/transactions/selection-summary", { ids: [t.id] }, scoped)).statusCode,
    ).toBe(404);
    expect((await tagsOf(space))[0]).toMatchObject({ name: "a", count: 1 });
  });
});

describe("sec327: another space", () => {
  it("BUD-13@PoC AC7: renaming one's own tag onto another space's tag name merges nothing across spaces; bulk on its ids changes nothing", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const t = await add(owner, await createAccount(owner), "-1.00");
    await attributes(owner, t.id, { tags: ["спільна"] });
    const [ownerTag] = await tagsOf(owner);
    const s = await add(stranger, await createAccount(stranger), "-1.00");
    await attributes(stranger, s.id, { tags: ["своя"] });
    const [strangerTag] = await tagsOf(stranger);
    const res = await call(stranger, "PATCH", `/v1/transaction-tags/${strangerTag!.id}`, { name: "СПІЛЬНА" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().id).toBe(strangerTag!.id);
    expect(await tagsOf(owner)).toEqual([{ id: ownerTag!.id, name: "спільна", count: 1 }]);
    // Another space's tag id given as a name: a new tag of one's own space, never the other's.
    expect((await attributes(stranger, s.id, { tags: [ownerTag!.id] })).json().tags[0].id).not.toBe(
      ownerTag!.id,
    );
    const body = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [t.id] },
      params: { tags: ["чуже"] },
    };
    const started = await bulk(stranger, body, false);
    expect(started.json()).not.toMatchObject({ changed: 1 });
    expect((await get(owner, t.id)).tags.map((x) => x.name)).toEqual(["спільна"]);
    expect((await tagsOf(owner)).map((x) => x.name)).toEqual(["спільна"]);
    expect(
      (await list(stranger, `?filter=tag.in:${ownerTag!.id},${strangerTag!.id}`)).items.every(
        (i) => i.id !== t.id,
      ),
    ).toBe(true);
  });
});

describe("sec327: input bounds and the array filter", () => {
  it("BUD-13@PoC FR 1, FR 2: the note over 2 000, a tag over 60, 21 tags, 501 selected ids and 51 filter values are refused", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    expect((await attributes(space, t.id, { note: "н".repeat(2001) })).statusCode).toBe(400);
    expect((await attributes(space, t.id, { note: "н".repeat(2000) })).statusCode).toBe(200);
    expect((await attributes(space, t.id, { tags: ["т".repeat(61)] })).statusCode).toBe(400);
    expect(
      (await attributes(space, t.id, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).statusCode,
    ).toBe(400);
    expect((await attributes(space, t.id, { tags: Array.from({ length: 81 }, () => "x") })).statusCode).toBe(
      400,
    );
    const ids = Array.from({ length: 501 }, () => randomUUID());
    expect((await call(space, "POST", "/v1/transactions/selection-summary", { ids })).statusCode).toBe(400);
    expect((await call(space, "POST", "/v1/transactions/selection-summary", { ids: [] })).statusCode).toBe(
      400,
    );
    const many = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect(
      (await call(space, "GET", `/v1/transactions?filter=tag.in:${many}`)).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await call(space, "GET", `/v1/transactions?filter=tag.in:${many}`)).statusCode).toBeLessThan(500);
    const bulkBody = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [t.id] },
      params: { tags: Array.from({ length: 21 }, (_, i) => `b${i}`) },
    };
    expect((await bulk(space, bulkBody, true)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await tagsOf(space)).length).toBe(0);
  });

  it("platform list-query: SQL in a tag filter value is a 400, never SQL", async () => {
    const space = await newSpace();
    await add(space, await createAccount(space), "-1.00");
    for (const v of [
      "x'); DROP TABLE transactions; --",
      "{}",
      "ARRAY[1]",
      "00000000-0000-0000-0000-000000000000) OR (1=1",
      "",
    ]) {
      const res = await call(space, "GET", `/v1/transactions?filter=${encodeURIComponent(`tag.eq:${v}`)}`);
      expect(res.statusCode, v).toBe(400);
    }
    for (const op of ["has", "gt", "lt", "ne", "empty"]) {
      const res = await call(
        space,
        "GET",
        `/v1/transactions?filter=${encodeURIComponent(`tag.${op}:${randomUUID()}`)}`,
      );
      expect(res.statusCode, op).toBe(400);
    }
    expect((await list(space, "")).count).toBe(1);
  });
});

describe("sec327: feature key gating", () => {
  it("BUD-13@PoC: rename and delete are behind `transactions.attributes`; the selection sum behind `transactions.manual`", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    await attributes(space, t.id, { tags: ["a"] });
    const [tag] = await tagsOf(space);
    off.add("transactions.attributes");
    expect((await call(space, "PATCH", `/v1/transaction-tags/${tag!.id}`, { name: "b" })).statusCode).toBe(
      404,
    );
    expect((await call(space, "DELETE", `/v1/transaction-tags/${tag!.id}`)).statusCode).toBe(404);
    off.clear();
    off.add("transactions.manual");
    expect(
      (await call(space, "POST", "/v1/transactions/selection-summary", { ids: [t.id] })).statusCode,
    ).toBe(404);
  });

  // Blocking: the bulk action is gated by `data.bulk_actions` only, so «Додати теги» writes tags (and creates tags of the space) while `transactions.attributes` is off.
  it("BUD-13@PoC: «Додати теги» is refused while `transactions.attributes` is off", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    off.add("transactions.attributes");
    const body = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [t.id] },
      params: { tags: ["обхід"] },
    };
    const preview = await bulk(space, body, true);
    const started = await bulk(space, body, false);
    off.clear();
    expect(await tagsOf(space)).toEqual([]);
    expect((await get(space, t.id)).tags).toEqual([]);
    // An action behind an off flag is unknown, as before it shipped.
    expect(preview.statusCode).toBe(400);
    expect(started.statusCode).toBe(400);
    expect(started.json().errors).toEqual([{ in: "body", path: "action", issue: "unknown" }]);
  });
});

describe("sec327: no note or tag name in the audit log, the queue or an error body", () => {
  it("П-10: the transaction's entry masks the note and names tags by id; tag rename, merge and delete entries carry no name; the queue neither", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const a = await add(space, account, "-1.00");
    const b = await add(space, account, "-2.00");
    const NOTE = "НОТАТКА-СЕКРЕТ-7731";
    await attributes(space, a.id, { note: NOTE, tags: ["ТЕГ-СЕКРЕТ-1", "ТЕГ-СЕКРЕТ-2"] });
    await attributes(space, b.id, { tags: ["ТЕГ-СЕКРЕТ-3"] });
    await attributes(space, a.id, { note: `${NOTE}-2` });
    await attributes(space, a.id, { note: null });
    const tags = await tagsOf(space);
    const one = tags.find((x) => x.name === "ТЕГ-СЕКРЕТ-1")!;
    const two = tags.find((x) => x.name === "ТЕГ-СЕКРЕТ-2")!;
    const three = tags.find((x) => x.name === "ТЕГ-СЕКРЕТ-3")!;
    expect(
      (await call(space, "PATCH", `/v1/transaction-tags/${one.id}`, { name: "ТЕГ-СЕКРЕТ-RENAMED" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(space, "PATCH", `/v1/transaction-tags/${two.id}`, { name: "тег-секрет-3" })).statusCode,
    ).toBe(200);
    expect((await call(space, "DELETE", `/v1/transaction-tags/${three.id}`)).statusCode).toBe(200);
    const bad = await attributes(space, a.id, { note: `${NOTE}‮` });
    expect(bad.statusCode).toBe(400);
    expect(leakText(bad.body)).not.toContain("НОТАТКА");
    await runWorker(space.householdId);
    const auditRows = await db.owner.query(
      `SELECT to_jsonb(e)::text AS r FROM audit.entries e WHERE e.household_id = $1`,
      [space.householdId],
    );
    expect(auditRows.rows.length).toBeGreaterThan(3);
    const tagLog = [
      ...(await audit.entriesFor(space.householdId, { type: "transactions.tag", id: one.id })),
      ...(await audit.entriesFor(space.householdId, { type: "transactions.tag", id: two.id })),
      ...(await audit.entriesFor(space.householdId, { type: "transactions.tag", id: three.id })),
    ];
    expect(tagLog.length).toBe(3);
    const all = JSON.stringify([auditRows.rows, tagLog]).toLowerCase();
    expect(all).not.toContain("нотатка-секрет");
    expect(all).not.toContain("тег-секрет");
    // The transaction's entries name its tags by id.
    expect(all).toContain(one.id);
    const jobRows = await db.owner.query(
      `SELECT payload::text AS p FROM transactions.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    const payloads = jobRows.rows
      .map((r) => String(r.p))
      .join("\n")
      .toLowerCase();
    expect(payloads).not.toContain("нотатка-секрет");
    expect(payloads).not.toContain("тег-секрет");
  });

  it("DAT-03@PoC FR 11, П-10: the group entry of «Додати теги» exists once the worker ran and masks the tag names", async () => {
    const space = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    await attributes(space, t.id, { tags: ["ГРУПА-СЕКРЕТ-0"] });
    const body = {
      action: "transactions.add-tags",
      selection: { kind: "ids", ids: [t.id] },
      params: { tags: ["ГРУПА-СЕКРЕТ-1"] },
    };
    const started = await bulk(space, body, false);
    expect(started.statusCode, started.body).toBe(201);
    await runWorker(space.householdId);
    const group = await audit.entriesFor(space.householdId, {
      type: "bulk-actions.action",
      id: started.json().id,
    });
    expect(group.length).toBeGreaterThan(0);
    expect(JSON.stringify(group)).toContain(t.id);
    expect(JSON.stringify(group).toLowerCase()).not.toContain("група-секрет");
  });

  it("the 500 of a create racing a rename onto the same name leaks no tag name or SQL detail", async () => {
    const space = await newSpace();
    const account = await createAccount(space);
    const txs = await Promise.all(Array.from({ length: 3 }, () => add(space, account, "-1.00")));
    const bodies: string[] = [];
    for (let round = 0; round < 20; round++) {
      const NAME = `ГОНКА-${round}`;
      await attributes(space, txs[0]!.id, { tags: [`джерело-${round}`] });
      const src = (await tagsOf(space)).find((x) => x.name === `джерело-${round}`)!;
      const results = await Promise.all([
        call(space, "PATCH", `/v1/transaction-tags/${src.id}`, { name: NAME }),
        attributes(space, txs[1]!.id, { tags: [NAME] }),
        attributes(space, txs[2]!.id, { tags: [NAME] }),
      ]);
      for (const r of results) if (r.statusCode >= 500) bodies.push(r.body);
    }
    for (const b of bodies) {
      expect(b).not.toMatch(/ГОНКА|гонка|duplicate|constraint|name_key|tags_|household/i);
      expect(JSON.parse(b)).toMatchObject({ status: 500 });
    }
  });
});

describe("sec327: schema", () => {
  it("migration 0007: `transactions.tags` has forced row security with one household policy; no other module role reads it", async () => {
    const { rows } = await db.owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'transactions' AND c.relname = 'tags'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
    const grants = await db.owner.query(
      `SELECT r.rolname FROM pg_roles r
        WHERE r.rolname LIKE 'ws_%' AND r.rolname NOT LIKE '%transactions%' AND NOT r.rolsuper
          AND has_table_privilege(r.oid, 'transactions.tags', 'SELECT')`,
    );
    expect(grants.rows).toEqual([]);
  });

  it("NFR-12@PoC FR 3: the erasure takes the space's tags with its transactions; the neighbour keeps its own", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const t = await add(space, await createAccount(space), "-1.00");
    const o = await add(other, await createAccount(other), "-1.00");
    await attributes(space, t.id, { note: "n", tags: ["a"] });
    await attributes(other, o.id, { note: "n", tags: ["a"] });
    await createTransactionsErasure(db.databases.for("transactions")).eraseHousehold(space.householdId);
    const count = async (table: string, h: string) =>
      (
        await db.owner.query(`SELECT count(*)::int AS n FROM transactions.${table} WHERE household_id = $1`, [
          h,
        ])
      ).rows[0]!.n;
    expect(await count("tags", space.householdId)).toBe(0);
    expect(await count("transactions", space.householdId)).toBe(0);
    expect(await count("tags", other.householdId)).toBe(1);
  });
});
