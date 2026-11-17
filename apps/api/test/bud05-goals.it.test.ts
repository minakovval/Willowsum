import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { createAccountDirectory, createAccountsServices } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createGoalsErasure, createGoalsServices } from "../src/modules/goals/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * BUD-05@PoC a) (wave 2 row 27), the server part of the module `goals`, through the real API on a real PostgreSQL: a
 * goal with its one part, «Внести», the envelopes of an account against its balance, the required monthly
 * contribution, progress and pace, deletion, the space's boundary and the audit hand-off with its daily recovery
 * (ARC-04, #249). Every name and amount is synthetic; the clock is the test's own (October 2026, Kyiv).
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const at = (date: string) => Date.parse(`${date}T10:00:00Z`);
let now = at(TODAY);
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
/** Runs once before the next balance read of the goals' ledger — a change by another request between a read and its write. */
let beforeBalance: (() => Promise<unknown>) | undefined;
const telemetry = testTelemetryForFile();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
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

const eur = (amount: string) => ({ amount, currency: "EUR" });

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

/** A cash account of the space with its opening balance (FIN-01). */
async function account(space: Space, amount: string, kind = "savings"): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind,
    name: `Синтетичний ${kind}`,
    balance: eur(amount),
    balanceDate: "2026-10-01",
    ...(kind === "loan" ? { annualRate: "10", monthlyPayment: "100.00" } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  await runWorker(space.householdId);
  return res.json().id as string;
}

const travel = (extra: Record<string, unknown> = {}) => ({
  template: "travel",
  name: "Відпустка в Італії",
  target: eur("4000.00"),
  targetDate: "2027-07-01",
  ...extra,
});

interface GoalJson {
  readonly id: string;
  readonly name: string;
  readonly canContribute: boolean;
  readonly part: { readonly accountId: string | null; readonly freeBalance: unknown };
  readonly [field: string]: unknown;
}

async function goal(space: Space, body: unknown): Promise<GoalJson> {
  const res = await call(space, "POST", "/v1/goals", body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const goalAudit = (householdId: string, entity: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = $2 AND action = $3",
    householdId,
    entity,
    action,
  );

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
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
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: clock.now }),
          audit,
          clock,
          newId: randomUUID,
        }),
        goals: createGoalsServices({
          accounts: createAccountDirectory(db.databases.for("accounts")),
          ledger: {
            ...ledger,
            balanceAt: async (...args: Parameters<typeof ledger.balanceAt>) => {
              const hook = beforeBalance;
              beforeBalance = undefined;
              await hook?.();
              return ledger.balanceAt(...args);
            },
          },
          audit,
          clock,
          newId: randomUUID,
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

afterEach(() => {
  vi.restoreAllMocks();
  now = at(TODAY);
});

describe("BUD-05@PoC: a goal, its part and what it shows", () => {
  it("BUD-05@PoC AC1 (server part): «Відпустка в Італії» 4 000 € to 1 July, envelope on savings of 5 000 € with 1 000 € — 25 %, 334 € / month, 4 000 € free", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "1000.00" } }),
    );
    expect(g).toMatchObject({
      template: "travel",
      name: "Відпустка в Італії",
      target: eur("4000"),
      targetDate: "2027-07-01",
      part: { kind: "envelope", accountId: savings, startAmount: eur("1000"), freeBalance: eur("4000") },
      collected: eur("1000"),
      progressPercent: "25.0",
      achieved: false,
      requiredMonthly: eur("334"),
      overdue: false,
      canContribute: true,
      contributions: [],
    });
    // «Можна витратити» takes the required contribution later (its own requirement); the card shows it already.
    const list = await call(space, "GET", "/v1/goals");
    expect(list.json().goals).toHaveLength(1);
    expect(await goalAudit(space.householdId, "goals.goal", "create")).toBe(1);
  });

  it("BUD-05@PoC AC4: envelopes of 4 500 € on 5 000 € — a new envelope of 800 € is refused «перевищує залишок рахунку на 300 €»; nothing written", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const first = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "4500.00" } }),
    );
    const res = await call(
      space,
      "POST",
      "/v1/goals",
      travel({ name: "Диван", part: { kind: "envelope", accountId: savings, startAmount: "800.00" } }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("300") });
    expect(await n("goals.goals WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await n("goals.jobs WHERE household_id = $1 AND name = 'goals.hand-off'", space.householdId)).toBe(
      1,
    );
    // FR 3: a mark on an envelope reserves more of the account — the same rule.
    const over = await call(space, "POST", `/v1/goals/${first.id}/contributions`, { amount: eur("500.01") });
    expect(over.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("0.01") });
    const fits = await call(space, "POST", `/v1/goals/${first.id}/contributions`, { amount: eur("500.00") });
    expect(fits.statusCode, fits.body).toBe(201);
    expect(fits.json().part.freeBalance).toEqual(eur("0"));
    // An envelope moved to the full account by «Змінити ціль» is refused the same way.
    const other = await goal(space, travel({ name: "Ноутбук" }));
    const moved = await call(space, "PATCH", `/v1/goals/${other.id}`, {
      part: { kind: "envelope", accountId: savings, startAmount: "1.00" },
    });
    expect(moved.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("1") });
  });

  it("BUD-05@PoC FR 2 (server part): «Окремий рахунок цілі» — collected is the account's balance; one such goal per account and no envelope beside it", async () => {
    const space = await newSpace();
    const reserve = await account(space, "2500.00");
    const g = await goal(space, {
      template: "emergency",
      name: "Подушка безпеки",
      target: eur("12600.00"),
      part: { kind: "account", accountId: reserve },
    });
    expect(g).toMatchObject({
      collected: eur("2500"),
      progressPercent: "19.8",
      emergencyMonths: 3,
      requiredMonthly: null,
    });
    const again = await call(
      space,
      "POST",
      "/v1/goals",
      travel({ part: { kind: "account", accountId: reserve } }),
    );
    expect(again.json().code).toBe("GOAL_ACCOUNT_TAKEN");
    const envelope = await call(
      space,
      "POST",
      "/v1/goals",
      travel({ part: { kind: "envelope", accountId: reserve } }),
    );
    expect(envelope.json().code).toBe("GOAL_ACCOUNT_TAKEN");
    // A credit account, an unknown one and a currency the account has no wallet in are refused as fields.
    const loan = await account(space, "1000.00", "loan");
    for (const [part, issue] of [
      [{ kind: "envelope", accountId: loan }, "not_found"],
      [{ kind: "envelope", accountId: randomUUID() }, "not_found"],
    ] as const) {
      const res = await call(space, "POST", "/v1/goals", travel({ part }));
      expect(res.statusCode).toBe(400);
      expect(res.json().errors).toEqual([{ in: "body", path: "part.accountId", issue }]);
    }
    const uah = await call(
      space,
      "POST",
      "/v1/goals",
      travel({ target: { amount: "1000", currency: "UAH" }, part: { kind: "envelope", accountId: reserve } }),
    );
    expect(uah.json().errors).toEqual([{ in: "body", path: "part.accountId", issue: "currency" }]);
  });

  it("BUD-05@PoC AC15 (server part): a goal on its own account has no «Внести» — the request is refused and nothing is written", async () => {
    const space = await newSpace();
    const reserve = await account(space, "800.00");
    const g = await goal(space, travel({ name: "Резерв", part: { kind: "account", accountId: reserve } }));
    expect(g.canContribute).toBe(false);
    expect(g.part.accountId).toBe(reserve);
    const res = await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("50.00") });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GOAL_OWN_ACCOUNT");
    expect(await n("goals.contributions WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("BUD-05@PoC AC7 (server part): a reached goal is «Досягнуто»; «Внести» 50 € over the target is counted", async () => {
    const space = await newSpace();
    const g = await goal(space, travel({ part: { kind: "marks", startAmount: "3900.00" } }));
    const reached = await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("100.00") });
    expect(reached.json()).toMatchObject({ achieved: true, progressPercent: "100.0", overTarget: null });
    const over = await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("50.00") });
    expect(over.statusCode).toBe(201);
    expect(over.json()).toMatchObject({
      collected: eur("4050"),
      achieved: true,
      overTarget: eur("50"),
      requiredMonthly: eur("0"),
      contributedThisMonth: eur("150"),
    });
    expect(over.json().contributions.map((c: { amount: unknown }) => c.amount)).toEqual([
      eur("50"),
      eur("100"),
    ]);
    expect(await goalAudit(space.householdId, "goals.contribution", "create")).toBe(2);
  });

  it("BUD-05@PoC AC9: a goal has exactly one part — a request with a second part (or a list of parts) is refused", async () => {
    const space = await newSpace();
    const g = await goal(space, travel());
    const second = await call(space, "POST", "/v1/goals", {
      ...travel(),
      parts: [{ kind: "marks" }, { kind: "marks" }],
    });
    expect(second.statusCode).toBe(400);
    const patch = await call(space, "PATCH", `/v1/goals/${g.id}`, { parts: [{ kind: "marks" }] });
    expect(patch.statusCode).toBe(400);
    const add = await call(space, "POST", `/v1/goals/${g.id}/parts`, { kind: "marks" });
    expect(add.statusCode).toBe(404);
    expect(await n("goals.goals WHERE household_id = $1", space.householdId)).toBe(1);
  });

  it("BUD-05@PoC FR 14: a goal has no pause — there is no «Поставити на паузу» or «Відновити» to call", async () => {
    const space = await newSpace();
    const g = await goal(space, travel());
    for (const action of ["pause", "resume"])
      expect((await call(space, "POST", `/v1/goals/${g.id}/${action}`, {})).statusCode).toBe(404);
    expect(g).not.toHaveProperty("paused");
  });

  it("BUD-05@PoC AC10 (server part), FR 11: «Новий диван» 1 500,00 € from step 1 alone — one part «Без рахунку — лише позначки», start 0, the space's", async () => {
    const space = await newSpace();
    const g = await goal(space, { template: "purchase", name: "Новий диван", target: eur("1500.00") });
    expect(g).toMatchObject({
      part: { kind: "marks", accountId: null, startAmount: eur("0"), freeBalance: null },
      collected: eur("0"),
      progressPercent: "0.0",
      targetDate: null,
      requiredMonthly: null,
    });
    expect(g).not.toHaveProperty("ownerId");
    const missing = await call(space, "POST", "/v1/goals", { template: "purchase", name: "Новий диван" });
    expect(missing.statusCode).toBe(400);
  });

  it("BUD-05@PoC FR 7: the pace over the last 3 months gives the forecast date; this month's contributions are counted apart", async () => {
    const space = await newSpace();
    now = at("2026-06-01");
    const g = await goal(space, travel({ part: { kind: "marks", startAmount: "1000.00" } }));
    for (const [date, amount] of [
      ["2026-06-15", "900.00"],
      ["2026-08-10", "300.00"],
      ["2026-09-10", "300.00"],
      ["2026-10-05", "300.00"],
    ] as const) {
      now = at(date);
      const res = await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur(amount) });
      expect(res.statusCode, res.body).toBe(201);
    }
    now = at(TODAY);
    const card = (await call(space, "GET", `/v1/goals/${g.id}`)).json();
    // 900 € since 18 July (92 days ≈ 3.02 months); June's 900 € is older than the window.
    expect(Money.of(card.pace.amount, "EUR").toDisplayDecimal().toFixed(2)).toBe("297.76");
    expect(card.contributedThisMonth).toEqual(eur("300"));
    expect(card.collected).toEqual(eur("2800"));
    // 1 200 € left at ≈ 297.76 € a month: 123 days.
    expect(card.forecastDate).toBe("2027-02-17");
    // FR 5: 1 200 € over the 9 months to July.
    expect(card.requiredMonthly).toEqual(eur("134"));
  });

  it("BUD-05@PoC EC4: deleting a goal frees its envelope; the history stays in the audit log", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const a = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "3000.00" } }),
    );
    const b = await goal(
      space,
      travel({ name: "Диван", part: { kind: "envelope", accountId: savings, startAmount: "1000.00" } }),
    );
    expect(b.part.freeBalance).toEqual(eur("1000"));
    await call(space, "POST", `/v1/goals/${a.id}/contributions`, { amount: eur("200.00") });
    const res = await call(space, "DELETE", `/v1/goals/${a.id}`);
    expect(res.statusCode).toBe(200);
    expect((await call(space, "GET", `/v1/goals/${b.id}`)).json().part.freeBalance).toEqual(eur("4000"));
    expect((await call(space, "GET", `/v1/goals/${a.id}`)).statusCode).toBe(404);
    expect(await n("goals.contributions WHERE household_id = $1", space.householdId)).toBe(0);
    const { rows } = await db.owner.query<{ changes: { field: string; before: string | null }[] }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'goals.goal' AND action = 'delete'`,
      [space.householdId],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.changes)).toContain("3000");
    expect(await goalAudit(space.householdId, "goals.contribution", "create")).toBe(1);
  });

  it("BUD-05@PoC FR 2 (server part): «Змінити ціль» — the fields sent change, audited as before and after; the currency stays; a past date may stay", async () => {
    const space = await newSpace();
    now = at("2026-09-01");
    const g = await goal(space, travel({ targetDate: "2026-10-01" }));
    now = at(TODAY);
    expect((await call(space, "GET", `/v1/goals/${g.id}`)).json()).toMatchObject({
      overdue: true,
      requiredMonthly: null,
    });
    const renamed = await call(space, "PATCH", `/v1/goals/${g.id}`, { name: "Італія" });
    expect(renamed.json()).toMatchObject({ name: "Італія", version: 2, targetDate: "2026-10-01" });
    const { rows } = await db.owner.query<{ changes: { field: string }[] }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'goals.goal' AND action = 'update'`,
      [space.householdId],
    );
    expect(rows.map((r) => r.changes.map((c) => c.field))).toEqual([["name"]]);
    const currency = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      target: { amount: "100", currency: "UAH" },
    });
    expect(currency.json().errors).toEqual([{ in: "body", path: "target.currency", issue: "fixed" }]);
    const extended = await call(space, "PATCH", `/v1/goals/${g.id}`, { targetDate: "2027-01-01" });
    expect(extended.json()).toMatchObject({ overdue: false, requiredMonthly: eur("1334") });
  });
});

describe("BUD-05@PoC FR 2, FR 12: «Змінити ціль» when the account fell below its envelopes (edge case 1)", () => {
  it("BUD-05@PoC FR 2 (server part): a change that reserves no more is saved; one that reserves more is refused", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "4000.00" } }),
    );
    const fell = await call(space, "POST", `/v1/accounts/${savings}/balance`, { balance: eur("3000.00") });
    expect(fell.statusCode, fell.body).toBe(200);
    await runWorker(space.householdId);
    expect((await call(space, "GET", `/v1/goals/${g.id}`)).json().part.freeBalance).toEqual(eur("-1000"));
    const renamed = await call(space, "PATCH", `/v1/goals/${g.id}`, { name: "Італія" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const extended = await call(space, "PATCH", `/v1/goals/${g.id}`, { targetDate: "2027-09-01" });
    expect(extended.statusCode, extended.body).toBe(200);
    const reduced = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: savings, startAmount: "3500.00" },
    });
    expect(reduced.statusCode, reduced.body).toBe(200);
    expect(reduced.json().part.freeBalance).toEqual(eur("-500"));
    const more = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: savings, startAmount: "3600.00" },
    });
    expect(more.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("600") });
    const mark = await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("1.00") });
    expect(mark.json().code).toBe("GOAL_ENVELOPES_OVER_BALANCE");
  });
});

describe("BUD-05@PoC FR 3: an envelope moved to another account is checked in full", () => {
  it("BUD-05@PoC FR 3: moving a large envelope to a full account with a smaller amount is refused", async () => {
    const space = await newSpace();
    const big = await account(space, "5000.00");
    const full = await account(space, "1000.00");
    await goal(
      space,
      travel({ name: "Диван", part: { kind: "envelope", accountId: full, startAmount: "1000.00" } }),
    );
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: big, startAmount: "4000.00" } }),
    );
    const moved = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: full, startAmount: "1.00" },
    });
    expect(moved.json()).toMatchObject({ code: "GOAL_ENVELOPES_OVER_BALANCE", excess: eur("1") });
  });
});

describe("BUD-05@PoC FR 2 (PR 295 follow-ups): a closed account, a concurrent change, a part patched without its start amount", () => {
  it("BUD-05@PoC FR 2: an account closed in «Рахунки» is refused as a goal's part, on create and on «Змінити ціль»", async () => {
    const space = await newSpace();
    const closed = await account(space, "100.00");
    expect(
      (await call(space, "POST", `/v1/accounts/${closed}/balance`, { balance: eur("0.00") })).statusCode,
    ).toBe(200);
    await runWorker(space.householdId);
    const shut = await call(space, "POST", `/v1/accounts/${closed}/close`, { closedOn: TODAY });
    expect(shut.statusCode, shut.body).toBe(200);
    const created = await call(
      space,
      "POST",
      "/v1/goals",
      travel({ part: { kind: "envelope", accountId: closed, startAmount: "0" } }),
    );
    expect(created.statusCode).toBe(400);
    expect(created.json().errors).toEqual([{ in: "body", path: "part.accountId", issue: "closed" }]);
    const g = await goal(space, travel());
    const moved = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: closed, startAmount: "0" },
    });
    expect(moved.statusCode).toBe(400);
    expect(moved.json().errors).toEqual([{ in: "body", path: "part.accountId", issue: "closed" }]);
    expect(await n("goals.goals WHERE household_id = $1", space.householdId)).toBe(1);
  });

  it("BUD-05@PoC FR 2: a change made by another request while «Змінити ціль» reads the balance is not overwritten — the change is merged again on the fresh goal", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "100.00" } }),
    );
    beforeBalance = async () => {
      await db.owner.query(
        `UPDATE goals.goals SET name = 'Конкурентна назва', version = version + 1 WHERE household_id = $1 AND id = $2`,
        [space.householdId, g.id],
      );
    };
    const res = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: savings, startAmount: "200.00" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: "Конкурентна назва", version: 3 });
    expect(res.json().part).toMatchObject({ startAmount: eur("200") });
  });

  it("BUD-05@PoC FR 2: a goal that keeps changing under «Змінити ціль» ends with 409 VERSION_CONFLICT after three tries, nothing written", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "100.00" } }),
    );
    const bump = async () => {
      await db.owner.query(
        `UPDATE goals.goals SET version = version + 1 WHERE household_id = $1 AND id = $2`,
        [space.householdId, g.id],
      );
      beforeBalance = bump;
    };
    beforeBalance = bump;
    const res = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: savings, startAmount: "200.00" },
    });
    beforeBalance = undefined;
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    const { rows } = await db.owner.query<{ start_amount: string }>(
      `SELECT start_amount::text FROM goals.goals WHERE household_id = $1 AND id = $2`,
      [space.householdId, g.id],
    );
    expect(Number(rows[0]!.start_amount)).toBe(100);
  });

  it("BUD-05@PoC FR 2: «Змінити ціль» with a part and no start amount keeps the stored start amount while the part stays; a changed part starts from 0", async () => {
    const space = await newSpace();
    const savings = await account(space, "5000.00");
    const other = await account(space, "5000.00");
    const g = await goal(
      space,
      travel({ part: { kind: "envelope", accountId: savings, startAmount: "1500.00" } }),
    );
    const same = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: savings },
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json().part).toMatchObject({ startAmount: eur("1500") });
    const marks = await goal(
      space,
      travel({ name: "Ноутбук", part: { kind: "marks", startAmount: "700.00" } }),
    );
    const kept = await call(space, "PATCH", `/v1/goals/${marks.id}`, { part: { kind: "marks" } });
    expect(kept.json().part).toMatchObject({ startAmount: eur("700") });
    const moved = await call(space, "PATCH", `/v1/goals/${g.id}`, {
      part: { kind: "envelope", accountId: other },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().part).toMatchObject({ startAmount: eur("0") });
  });
});

describe("BUD-05@PoC AC6: the space's boundary", () => {
  it("BUD-05@PoC AC6: a user of another space gets «not found» for the goals of this one — no records, counts or sums", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const g = await goal(owner, travel({ part: { kind: "marks", startAmount: "1000.00" } }));
    expect((await call(stranger, "GET", "/v1/goals")).json()).toEqual({ goals: [] });
    for (const [method, url, body] of [
      ["GET", `/v1/goals/${g.id}`, undefined],
      ["PATCH", `/v1/goals/${g.id}`, { name: "Чужа" }],
      ["DELETE", `/v1/goals/${g.id}`, undefined],
      ["POST", `/v1/goals/${g.id}/contributions`, { amount: eur("10.00") }],
    ] as const) {
      const res = await call(stranger, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.body).not.toContain("1000");
    }
    // An account of another space is unknown as a part's account.
    const theirs = await account(owner, "5000.00");
    const res = await call(
      stranger,
      "POST",
      "/v1/goals",
      travel({ part: { kind: "envelope", accountId: theirs } }),
    );
    expect(res.json().errors).toEqual([{ in: "body", path: "part.accountId", issue: "not_found" }]);
    // A scoped member: «бюджет і цілі» are closed by default — not found on reads, refused on changes.
    expect(
      (await call(owner, "GET", "/v1/goals", undefined, { role: "viewer", scoped: true })).statusCode,
    ).toBe(404);
    expect(
      (await call(owner, "POST", "/v1/goals", travel(), { role: "viewer", scoped: true })).statusCode,
    ).toBe(403);
    expect(await n("goals.goals WHERE household_id = $1", stranger.householdId)).toBe(0);
  });
});

describe("BUD-05@PoC «Кожна зміна, внесок … пишуться в журнал аудиту»: the goals queue (ARC-04, ADR-0015)", () => {
  it("ARC-04@PoC FR 4: a goals audit job in state dead goes back to the goals queue with the daily recovery", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "goals.goal") throw new Error("injected");
      return original(householdId, entry);
    });
    const g = await goal(space, travel());
    expect(g.name).toBe("Відпустка в Італії");
    expect(await goalAudit(space.householdId, "goals.goal", "create")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "goals.hand_off_deferred")).toBe(true);
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE goals.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`, [
      space.householdId,
    ]);
    // The worker does not take a dead job.
    await runWorker(space.householdId);
    expect(await goalAudit(space.householdId, "goals.goal", "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("goals.hand-off-recovery")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("goals.hand-off-recovery")).toBeLessThan(names.indexOf("queue.retention-cleanup"));
    await tasks.find((t) => t.name === "goals.hand-off-recovery")!.run();
    expect(telemetry.memory.logRecords().some((r) => r.body === "goals.hand_off_requeued")).toBe(true);
    await runWorker(space.householdId);
    expect(await n("goals.jobs WHERE household_id = $1 AND state = 'done'", space.householdId)).toBe(1);
    expect(await goalAudit(space.householdId, "goals.goal", "create")).toBe(1);
    // Again: the entry is keyed, nothing is written twice.
    await tasks.find((t) => t.name === "goals.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await goalAudit(space.householdId, "goals.goal", "create")).toBe(1);
  });

  it("NFR-12@PoC FR 3: the space's erasure takes its goals, contributions and queue rows", async () => {
    const space = await newSpace();
    const g = await goal(space, travel());
    await call(space, "POST", `/v1/goals/${g.id}/contributions`, { amount: eur("10.00") });
    const erased = await createGoalsErasure(db.databases.for("goals")).eraseHousehold(space.householdId);
    expect(erased).toEqual({ goals: 1, contributions: 1, spends: 0, jobs: 2 });
    expect(await n("goals.jobs WHERE household_id = $1", space.householdId)).toBe(0);
  });
});
