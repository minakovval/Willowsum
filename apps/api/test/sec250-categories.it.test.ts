import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import type { HouseholdSpaces } from "../src/modules/household/index.ts";
import { createCategoriesErasure, createCategoriesServices } from "../src/modules/categories/index.ts";

/**
 * Security review of PR #250 (BUD-01 a): household isolation of the categories schema in the database (row policies
 * on all five tables, the module role sees only its own schema), the merge event carries only the space's ids, a
 * scoped member never reaches a write, erasure removes every category row of a space. Synthetic data only.
 */
const WEB = "http://localhost:5173";
const TABLES = ["categories", "category_groups", "idempotency_keys", "outbox_events", "jobs"];

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Синтетичний Тест" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function byName(space: Space, name: string): Promise<{ id: string; groupId: string }> {
  const res = await call(space, "GET", "/v1/categories");
  const all = (
    res.json().groups as { categories: { id: string; groupId: string; name: string }[] }[]
  ).flatMap((g) => g.categories);
  return all.find((c) => c.name === name)!;
}

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  const audit = createAuditLog(db.databases.for("audit"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        categories: createCategoriesServices({ audit, clock: { now: () => Date.now() }, newId: randomUUID }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("SEC-250: the categories schema is isolated by household in the database", () => {
  it("SEC-250: row policies are on and forced on all five tables of the categories schema", async () => {
    const { rows } = await db.owner.query(
      `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'categories' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(rows.map((r) => r.t).sort()).toEqual([...TABLES].sort());
    for (const r of rows) expect([r.t, r.rls, r.forced, r.policies > 0]).toEqual([r.t, true, true, true]);
  });

  it("SEC-250: the module role bound to space A sees none of space B's rows without any WHERE, and cannot write a row of B", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const coffee = await call(
      b,
      "POST",
      "/v1/categories",
      {
        groupId: (await byName(b, "Продукти")).groupId,
        name: "Синтетична кава",
      },
      {},
      { "idempotency-key": randomUUID() },
    );
    expect(coffee.statusCode, coffee.body).toBe(201);
    const merged = await call(b, "POST", `/v1/categories/${coffee.json().id}/merge`, {
      targetId: (await byName(b, "Продукти")).id,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    await call(a, "GET", "/v1/categories");
    const seen = await db.databases.for("categories").inHousehold(a.householdId, async (q) => {
      const out: Record<string, number> = {};
      for (const t of TABLES)
        out[t] = Number(
          (await q.query(`SELECT count(*) AS n FROM ${t} WHERE household_id <> $1`, [a.householdId])).rows[0]!
            .n,
        );
      return out;
    });
    expect(seen).toEqual(Object.fromEntries(TABLES.map((t) => [t, 0])));
    const write = db.databases
      .for("categories")
      .inHousehold(a.householdId, (q) =>
        q.query(
          `INSERT INTO category_groups (household_id, id, kind, name, tone, position) VALUES ($1, $2, 'expense', 'X', '#000000', 1)`,
          [b.householdId, randomUUID()],
        ),
      );
    await expect(write).rejects.toMatchObject({ code: "42501" });
    const update = await db.databases
      .for("categories")
      .inHousehold(a.householdId, (q) =>
        q.query(`UPDATE categories SET name = name || '!' WHERE household_id = $1`, [b.householdId]),
      );
    expect(update.rowCount).toBe(0);
  });

  it("SEC-250: the categories role reads no other module's schema (ADR-0002)", async () => {
    const a = await newSpace();
    for (const sql of [
      "SELECT 1 FROM transactions.transactions LIMIT 1",
      "SELECT 1 FROM accounts.accounts LIMIT 1",
      "SELECT 1 FROM ledger.outbox_events LIMIT 1",
      "SELECT 1 FROM audit.entries LIMIT 1",
      "SELECT 1 FROM transactions.idempotency_keys LIMIT 1",
    ]) {
      const attempt = db.databases.for("categories").inHousehold(a.householdId, (q) => q.query(sql));
      await expect(attempt, sql).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("SEC-250: merge, scope and erasure", () => {
  it("SEC-250: the merge event is in the space's outbox and names only the space's own categories", async () => {
    const a = await newSpace();
    await newSpace();
    const custom = await call(a, "POST", "/v1/categories", {
      groupId: (await byName(a, "Продукти")).groupId,
      name: "Синтетичний чай",
    });
    const target = await byName(a, "Продукти");
    expect(
      (await call(a, "POST", `/v1/categories/${custom.json().id}/merge`, { targetId: target.id })).statusCode,
    ).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT e.household_id,
              (SELECT household_id FROM categories.categories WHERE id = (e.payload->>'sourceId')::uuid) AS source_space,
              (SELECT household_id FROM categories.categories WHERE id = (e.payload->>'targetId')::uuid) AS target_space
         FROM categories.outbox_events e WHERE e.payload->>'sourceId' = $1`,
      [custom.json().id],
    );
    expect(rows).toEqual([
      { household_id: a.householdId, source_space: a.householdId, target_space: a.householdId },
    ]);
  });

  it("SEC-250: a scoped member is refused every write, group routes included, and learns nothing of foreign ids", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const travel = await byName(space, "Подорожі");
    const foreign = await byName(other, "Подорожі");
    const scoped = { role: "editor", scoped: true };
    const writes = [
      await call(space, "POST", "/v1/category-groups", { name: "Г", kind: "expense" }, scoped),
      await call(space, "PATCH", `/v1/category-groups/${travel.groupId}`, { name: "Г" }, scoped),
      await call(space, "POST", "/v1/categories", { groupId: travel.groupId, name: "К" }, scoped),
    ];
    expect(writes.map((r) => r.statusCode)).toEqual([403, 403, 403]);
    const own = await call(space, "GET", `/v1/categories/${travel.id}`, undefined, scoped);
    const alien = await call(space, "GET", `/v1/categories/${foreign.id}`, undefined, scoped);
    expect([own.statusCode, alien.statusCode]).toEqual([404, 404]);
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    expect(strip(own.body)).toEqual(strip(alien.body));
  });

  it("SEC-250: erasure removes every row of the space in all five tables, the stored create responses included", async () => {
    const a = await newSpace();
    const b = await newSpace();
    for (const space of [a, b]) {
      const created = await call(
        space,
        "POST",
        "/v1/category-groups",
        { name: "Синтетична група", kind: "income" },
        {},
        {
          "idempotency-key": randomUUID(),
        },
      );
      expect(created.statusCode, created.body).toBe(201);
    }
    await db.owner.query(
      `INSERT INTO categories.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'sec250.probe', 'k', '{}'::jsonb)`,
      [a.householdId],
    );
    const count = async (householdId: string) => {
      const out: Record<string, number> = {};
      for (const t of TABLES)
        out[t] = Number(
          (
            await db.owner.query(`SELECT count(*) AS n FROM categories.${t} WHERE household_id = $1`, [
              householdId,
            ])
          ).rows[0].n,
        );
      return out;
    };
    expect(await count(a.householdId)).toMatchObject({ idempotency_keys: 1, jobs: 1 });
    const bBefore = await count(b.householdId);
    await createCategoriesErasure(db.databases.for("categories")).eraseHousehold(a.householdId);
    expect(await count(a.householdId)).toEqual(Object.fromEntries(TABLES.map((t) => [t, 0])));
    expect(await count(b.householdId)).toEqual(bBefore);
  });
});
