import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import {
  createGoalsErasure,
  createGoalsServices,
  createGoalsWorkerQueue,
} from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #295 (BUD-05@PoC a, module goals): FR 3 under concurrency (the account's lock), the schema's
 * row policies and grants, idempotency keys across spaces and goals, the flag, and erasure of the keys. Synthetic data.
 */
const WEB = "http://localhost:5173";
const now = Date.parse("2026-10-17T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
let flagOff: ReturnType<typeof buildServer>;
let goalsSvc: ReturnType<typeof createGoalsServices>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Синтетичний Власник" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
  server = app,
) {
  return server.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function account(space: Space, amount: string): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: "savings",
    name: "Синтетичний ощадний",
    balance: eur(amount),
    balanceDate: "2026-10-01",
  });
  expect(res.statusCode, res.body).toBe(201);
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [space.householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
  return res.json().id as string;
}

const goalBody = (name: string, part: Record<string, unknown>) => ({
  template: "custom",
  name,
  target: eur("10000.00"),
  part,
});

async function reservedOn(householdId: string, accountId: string): Promise<string> {
  const { rows } = await db.owner.query<{ s: string }>(
    `SELECT (coalesce((SELECT sum(start_amount) FROM goals.goals WHERE household_id = $1 AND account_id = $2 AND part_kind = 'envelope'), 0)
           + coalesce((SELECT sum(c.amount) FROM goals.contributions c JOIN goals.goals g
                         ON g.household_id = c.household_id AND g.id = c.goal_id
                        WHERE g.household_id = $1 AND g.account_id = $2 AND g.part_kind = 'envelope'), 0))::text AS s`,
    [householdId, accountId],
  );
  return rows[0]!.s;
}

function services() {
  const ledger = createLedger(db.databases.for("ledger"));
  return {
    accounts: createAccountsServices({
      walletUsage: [],
      ledger,
      liabilities: createLiabilities(db.databases.for("liabilities"), audit),
      keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
      fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
      audit,
      clock,
      newId: randomUUID,
    }),
    goals: createGoalsServices({
      accounts: createAccountDirectory(db.databases.for("accounts")),
      ledger,
      audit,
      clock,
      newId: randomUUID,
    }),
  };
}

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const build = (off: readonly string[]) => {
    const svc = services();
    if (off.length === 0) goalsSvc = svc.goals;
    return buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags: fakeFlags({ off }),
          authenticate: testAuthenticate,
          ...svc,
          allowedOrigins: new Set([WEB]),
        }),
    });
  };
  app = build([]);
  flagOff = build(["goals.savings"]);
  await app.ready();
  await flagOff.ready();
});

afterAll(async () => {
  await app?.close();
  await flagOff?.close();
  await db?.close();
});

describe("PR #295 security: FR 3 under concurrency", () => {
  it("BUD-05@PoC FR 3: ten envelopes of 600 € created at once on 5 000 € — exactly eight, never over the balance", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call(
          space,
          "POST",
          "/v1/goals",
          goalBody(`Конверт ${i}`, { kind: "envelope", accountId: savings, startAmount: "600.00" }),
        ),
      ),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(8);
    expect(
      results
        .filter((r) => r.statusCode === 409)
        .every((r) => r.json().code === "GOAL_ENVELOPES_OVER_BALANCE"),
    ).toBe(true);
    expect(Number(await reservedOn(space.householdId, savings))).toBeLessThanOrEqual(5000);
  });

  it("BUD-05@PoC FR 3: ten «Внести» of 200 € at once on an envelope with 1 000 € free — exactly five", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const res = await call(
      space,
      "POST",
      "/v1/goals",
      goalBody("Конверт", { kind: "envelope", accountId: savings, startAmount: "4000.00" }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().id as string;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call(space, "POST", `/v1/goals/${id}/contributions`, { amount: eur("200.00") }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(5);
    expect(await reservedOn(space.householdId, savings)).toMatch(/^5000(\.0+)?$/);
  });

  it("BUD-05@PoC FR 3: «Змінити ціль» and a new envelope at once on a full account — the envelopes never exceed it", async () => {
    const space = await newSpace();
    const savings = await account(space, "1000.00");
    const a = await call(
      space,
      "POST",
      "/v1/goals",
      goalBody("A", { kind: "envelope", accountId: savings, startAmount: "100.00" }),
    );
    const b = await call(space, "POST", "/v1/goals", goalBody("B", { kind: "marks" }));
    const [patchA, patchB, create] = await Promise.all([
      call(space, "PATCH", `/v1/goals/${a.json().id}`, {
        part: { kind: "envelope", accountId: savings, startAmount: "700.00" },
      }),
      call(space, "PATCH", `/v1/goals/${b.json().id}`, {
        part: { kind: "envelope", accountId: savings, startAmount: "300.00" },
      }),
      call(
        space,
        "POST",
        "/v1/goals",
        goalBody("C", { kind: "envelope", accountId: savings, startAmount: "300.00" }),
      ),
    ]);
    expect([patchA, patchB, create].some((r) => r.statusCode === 409)).toBe(true);
    expect(Number(await reservedOn(space.householdId, savings))).toBeLessThanOrEqual(1000);
  });

  it("BUD-05@PoC FR 2: an own-account goal and an envelope created at once on one account — only one of them", async () => {
    const space = await newSpace();
    const reserve = await account(space, "1000.00");
    const results = await Promise.all([
      call(space, "POST", "/v1/goals", goalBody("Власний", { kind: "account", accountId: reserve })),
      ...Array.from({ length: 4 }, (_, i) =>
        call(
          space,
          "POST",
          "/v1/goals",
          goalBody(`Конверт ${i}`, { kind: "envelope", accountId: reserve, startAmount: "10.00" }),
        ),
      ),
    ]);
    const own = results[0]!.statusCode === 201;
    const envelopes = results.slice(1).filter((r) => r.statusCode === 201).length;
    expect(own ? envelopes === 0 : envelopes >= 1).toBe(true);
  });
  it("BUD-05@PoC FR 2: an account with an envelope cannot become a goal's own account", async () => {
    const space = await newSpace();
    const reserve = await account(space, "1000.00");
    const env = await call(
      space,
      "POST",
      "/v1/goals",
      goalBody("Конверт", { kind: "envelope", accountId: reserve, startAmount: "10.00" }),
    );
    expect(env.statusCode, env.body).toBe(201);
    const own = await call(
      space,
      "POST",
      "/v1/goals",
      goalBody("Власний", { kind: "account", accountId: reserve }),
    );
    expect(own.statusCode).toBe(409);
    expect(own.json().code).toBe("GOAL_ACCOUNT_TAKEN");
  });
});

describe("PR #295 security: the goals schema", () => {
  it("BUD-05@PoC AC6: every goals table is under an enabled and forced household row policy", async () => {
    const { rows } = await db.owner.query<{ table: string; rls: boolean; forced: boolean; policies: number }>(
      `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'goals' AND c.relkind IN ('r', 'p') ORDER BY 1`,
    );
    expect(rows.map((r) => r.table)).toEqual([
      "contributions",
      "goals",
      "idempotency_keys",
      "jobs",
      "outbox_events",
    ]);
    for (const r of rows) expect(r, r.table).toMatchObject({ rls: true, forced: true, policies: 1 });
    // No other module's role has any privilege on the goals tables.
    const { rows: grants } = await db.owner.query<{ grantee: string }>(
      `SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema = 'goals'`,
    );
    const foreign = grants.map((g) => g.grantee).filter((g) => !/goals/.test(g) && g !== "postgres");
    expect(foreign).toEqual([]);
  });

  it("BUD-05@PoC AC6: the goals role bound to another space reads none of this space's goals, contributions or keys", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const g = await call(
      owner,
      "POST",
      "/v1/goals",
      goalBody("Чужа", { kind: "marks", startAmount: "1000.00" }),
      {
        "idempotency-key": "k-sec295-rls",
      },
    );
    await call(owner, "POST", `/v1/goals/${g.json().id}/contributions`, { amount: eur("5.00") });
    const seen = await db.databases.for("goals").inHousehold(stranger.householdId, async (q) => {
      const counts: number[] = [];
      for (const t of ["goals", "contributions", "idempotency_keys", "jobs"]) {
        const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
        counts.push(rows[0]!.n);
      }
      return counts;
    });
    expect(seen).toEqual([0, 0, 0, 0]);
  });
});

describe("PR #295 security: idempotency keys", () => {
  it("ARC-07@PoC FR 4: «Внести» replayed with its key writes one contribution; the key in another space or on another goal never replays this one", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const g = (await call(owner, "POST", "/v1/goals", goalBody("Ціль", { kind: "marks" }))).json()
      .id as string;
    const g2 = (await call(owner, "POST", "/v1/goals", goalBody("Друга", { kind: "marks" }))).json()
      .id as string;
    const key = { "idempotency-key": `k-${randomUUID()}` };
    const first = await call(owner, "POST", `/v1/goals/${g}/contributions`, { amount: eur("123.45") }, key);
    const again = await call(owner, "POST", `/v1/goals/${g}/contributions`, { amount: eur("123.45") }, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM goals.contributions WHERE household_id = $1`,
      [owner.householdId],
    );
    expect(rows[0]!.n).toBe(1);
    // Another goal with the same key: refused, not replayed.
    const other = await call(owner, "POST", `/v1/goals/${g2}/contributions`, { amount: eur("123.45") }, key);
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    // A stranger with the same key on the owner's goal: not found, never the stored response.
    const leak = await call(stranger, "POST", `/v1/goals/${g}/contributions`, { amount: eur("123.45") }, key);
    expect(leak.statusCode).toBe(404);
    expect(leak.body).not.toContain("123.45");
    expect(leak.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("NFR-12@PoC FR 3: the space's erasure takes the goals idempotency keys with their stored responses", async () => {
    const space = await newSpace();
    await call(space, "POST", "/v1/goals", goalBody("Ключ", { kind: "marks" }), {
      "idempotency-key": `k-${randomUUID()}`,
    });
    await createGoalsErasure(db.databases.for("goals")).eraseHousehold(space.householdId);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM goals.idempotency_keys WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe("PR #295 security: the flag", () => {
  it("CICD-06@PoC: with `goals.savings` off every goals route is «not found» and writes nothing", async () => {
    const space = await newSpace();
    const id = randomUUID();
    for (const [method, url, body] of [
      ["GET", "/v1/goals", undefined],
      ["POST", "/v1/goals", goalBody("Вимкнено", { kind: "marks" })],
      ["GET", `/v1/goals/${id}`, undefined],
      ["PATCH", `/v1/goals/${id}`, { name: "x" }],
      ["DELETE", `/v1/goals/${id}`, undefined],
      ["POST", `/v1/goals/${id}/contributions`, { amount: eur("1.00") }],
    ] as const) {
      const res = await call(space, method, url, body, {}, flagOff);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM goals.goals WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe("PR #295 security: races the version check closes", () => {
  it("BUD-05@PoC FR 3: «Внести» whose goal moved to a full account after its balance was read is checked against the new account", async () => {
    const space = await newSpace();
    const roomy = await account(space, "5000.00");
    const full = await account(space, "100.00");
    const g = (
      await call(space, "POST", "/v1/goals", goalBody("Рухома", { kind: "envelope", accountId: roomy }))
    ).json().id as string;
    expect(
      (
        await call(
          space,
          "POST",
          "/v1/goals",
          goalBody("Повна", { kind: "envelope", accountId: full, startAmount: "100.00" }),
        )
      ).statusCode,
    ).toBe(201);
    const balances = goalsSvc.deps.balances as { balance: typeof goalsSvc.deps.balances.balance };
    const original = balances.balance;
    let moved = false;
    balances.balance = async (...args) => {
      const b = await original(...args);
      if (!moved && args[1] === roomy) {
        moved = true;
        const patch = await call(space, "PATCH", `/v1/goals/${g}`, {
          part: { kind: "envelope", accountId: full, startAmount: "0" },
        });
        expect(patch.statusCode, patch.body).toBe(200);
      }
      return b;
    };
    try {
      const res = await call(space, "POST", `/v1/goals/${g}/contributions`, { amount: eur("1000.00") });
      expect(moved).toBe(true);
      expect(res.statusCode).toBe(409);
    } finally {
      balances.balance = original;
    }
    expect(Number(await reservedOn(space.householdId, full))).toBeLessThanOrEqual(100);
  });
});

describe("PR #295 security: the goals hand-off and the space's erasure", () => {
  it("ARC-04@PoC FR 2: a goals hand-off job whose row the erasure has already taken writes no audit entry", async () => {
    const space = await newSpace();
    const failing = { record: async () => Promise.reject(new Error("injected")) };
    const original = audit.record.bind(audit);
    (audit as { record: unknown }).record = failing.record;
    try {
      expect((await call(space, "POST", "/v1/goals", goalBody("Стерта", { kind: "marks" }))).statusCode).toBe(
        201,
      );
    } finally {
      (audit as { record: unknown }).record = original;
    }
    let writes = 0;
    const counting = {
      record: async (...args: Parameters<AuditLog["record"]>) => {
        writes += 1;
        return audit.record(...args);
      },
    };
    const handler = createGoalsWorkerQueue(db.databases.for("goals"), counting).handlers[0]!;
    const { rows } = await db.owner.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM goals.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    await createGoalsErasure(db.databases.for("goals")).eraseHousehold(space.householdId);
    await db.databases.for("goals").inHousehold(space.householdId, (q) =>
      handler.run(
        {
          id: rows[0]!.id,
          householdId: space.householdId,
          key: "k",
          payload: handler.job.schema.parse(rows[0]!.payload),
          attempt: 1,
          signal: new AbortController().signal,
        },
        q,
      ),
    );
    expect(writes).toBe(0);
  });
});
