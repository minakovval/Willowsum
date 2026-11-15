import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import { createLiabilities, type Liabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { workerQueues } from "../src/wiring.ts";

/**
 * Security review of PR #233 (FIN-12@PoC b): «Основне» — isolation between spaces and roles, no existence oracle,
 * row-level security of the tables the change writes, no loan created without its terms after liabilities/0002, the
 * audit entry as a condition of the change. Synthetic data only.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let liabilities: Liabilities;
let app: ReturnType<typeof buildServer>;
let auditDown: ReturnType<typeof buildServer>;
/** When set, the audit log refuses entries of this entity type (an outage of the audit write). */
let refuseAuditOf: string | null = null;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}
type Who = { role?: string; scoped?: boolean };

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function callOn(
  server: ReturnType<typeof buildServer>,
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  principal: Who = {},
) {
  return server.inject({
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
const call = (
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  who?: Who,
) => callOn(app, space, method, url, body, who);
const eur = (amount: string) => ({ amount, currency: "EUR" });
const patch = (space: Space, id: string, body: unknown, who?: Who) =>
  call(space, "PATCH", `/v1/accounts/${id}`, body, who);
const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();

async function createAccount(space: Space, body: Record<string, unknown>) {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2024-10-01", ...body });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const { rows } = await db.owner.query(
    `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
    [space.householdId, id],
  );
  const row = rows[0] as { id: string; ledger_account_id: string };
  return { id, subaccountId: row.id, ledgerAccountId: row.ledger_account_id };
}

/** The answer without the per-request parts (trace and instance). */
function shape(res: { statusCode: number; body: string }) {
  const rest = JSON.parse(res.body) as Record<string, unknown>;
  for (const key of ["traceId", "instance", "requestId"]) delete rest[key];
  return { status: res.statusCode, ...rest };
}

/** One pass of the worker as main.ts wires it (the real audit log), until the jobs it took have ended. */
async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

const stored = async (householdId: string) => ({
  accounts: (
    await db.owner.query(
      `SELECT id, name, kind, annual_rate::text, deposit_opened_on::text, deposit_matures_on::text, status
         FROM accounts.accounts WHERE household_id = $1 ORDER BY id`,
      [householdId],
    )
  ).rows,
  liabilities: (
    await db.owner.query(
      `SELECT id, account_id, kind, annual_rate::text, monthly_payment::text, credit_limit::text, grace_period_days
         FROM liabilities.liabilities WHERE household_id = $1 ORDER BY id`,
      [householdId],
    )
  ).rows,
  audit: (
    await db.owner.query(`SELECT count(*)::int AS n FROM audit.entries WHERE household_id = $1`, [
      householdId,
    ])
  ).rows[0],
});

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  const flaky: Pick<AuditLog, "record"> = {
    record: async (householdId, entry) => {
      if (refuseAuditOf !== null && entry.entity.type === refuseAuditOf) throw new Error("audit log is down");
      return audit.record(householdId, entry);
    },
  };
  const services = (log: Pick<AuditLog, "record">) =>
    createAccountsServices({
      ledger,
      liabilities,
      keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
      fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
      audit: log as AuditLog,
      clock: { now: () => NOW },
      newId: randomUUID,
    });
  const server = (log: Pick<AuditLog, "record">) =>
    buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags: fakeFlags(),
          authenticate: testAuthenticate,
          accounts: services(log),
          allowedOrigins: new Set([WEB]),
        }),
    });
  app = server(audit);
  auditDown = server(flaky);
  await Promise.all([app.ready(), auditDown.ready()]);
});

afterAll(async () => {
  await Promise.all([app?.close(), auditDown?.close()]);
  await db?.close();
});

describe("sec233 FIN-12@PoC «Основне»: isolation", () => {
  it("sec233: another space gets the same «not found» for a card with transactions, a closed account, a loan and an id that does not exist — and nothing of the space changes", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка 7731",
      balance: eur("431.00"),
    });
    await ledger.post(space.householdId, {
      source: { module: "accounts", id: card.subaccountId },
      idempotencyKey: `sec233:${card.subaccountId}`,
      operationDate: "2026-10-01",
      event: { type: "transaction", account: card.ledgerAccountId, amount: Money.of("-5", "EUR") },
    });
    const empty = await createAccount(space, {
      kind: "credit-card",
      name: "Порожня 7731",
      balance: eur("1.00"),
    });
    const closed = await createAccount(space, { kind: "cash", name: "Закрита 7731", balance: eur("0.00") });
    expect(
      (await call(space, "POST", `/v1/accounts/${closed.id}/close`, { closedOn: "2026-10-17" })).statusCode,
    ).toBe(200);
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит 7731",
      balance: eur("5000.00"),
      annualRate: "9.90",
      monthlyPayment: "310.00",
    });
    const before = await stored(space.householdId);
    const missing = shape(await patch(stranger, randomUUID(), { name: "Чужа", kind: "loan" }));
    expect(missing.status).toBe(404);
    for (const id of [card.id, empty.id, closed.id, loan.id])
      for (const body of [
        { name: "Чужа" },
        { kind: "loan" },
        { kind: "credit-card" },
        { kind: "savings" },
        {},
      ]) {
        const res = await patch(stranger, id, body);
        expect([id, body, shape(res)]).toEqual([id, body, missing]);
        expect(res.body).not.toMatch(/7731|431|5000|310/);
      }
    expect(await stored(space.householdId)).toEqual(before);
  });

  it("sec233: a viewer, an advisor and a scoped member learn nothing from «Основне» — an account of the space, an id that does not exist and a refused change answer alike", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка 7731",
      balance: eur("431.00"),
    });
    const current = await createAccount(space, {
      kind: "current",
      name: "Поточний 7731",
      balance: eur("12.00"),
    });
    const before = await stored(space.householdId);
    for (const who of [
      { role: "viewer", scoped: false },
      { role: "advisor", scoped: false },
      { role: "viewer", scoped: true },
      { role: "editor", scoped: true },
      { role: "admin", scoped: true },
      { role: "owner", scoped: true },
    ]) {
      const missing = shape(await patch(space, randomUUID(), { name: "Чужа" }, who));
      expect(missing.status).toBeGreaterThanOrEqual(403);
      for (const [id, body] of [
        [card.id, { name: "Чужа" }],
        [card.id, { kind: "loan" }],
        [current.id, { kind: "credit-card" }], // would be 409 «other group» for a writer
        [current.id, { name: "" }], // would be 400
        [current.id, { owners: [] }],
      ] as const) {
        const res = await patch(space, id, body, who);
        expect([who, id, body, shape(res)]).toEqual([who, id, body, missing]);
        expect(res.body).not.toMatch(/7731|431/);
      }
    }
    expect(await stored(space.householdId)).toEqual(before);
  });

  it("sec233: row-level security — a session bound to another space cannot read, lock or change the liability or the account «Основне» writes", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const card = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("10.00") });
    const before = await stored(space.householdId);
    const asStranger = <T>(module: "liabilities" | "accounts", sql: string, params: unknown[]) =>
      db.databases.for(module).inHousehold(stranger.householdId, (q) => q.query(sql, params) as Promise<T>);
    const l = await asStranger<{ rowCount: number }>(
      "liabilities",
      `UPDATE liabilities SET kind = 'loan', grace_period_days = NULL WHERE account_id = $1`,
      [card.id],
    );
    expect(l.rowCount).toBe(0);
    const s = await asStranger<{ rowCount: number }>(
      "liabilities",
      `SELECT 1 FROM liabilities WHERE account_id = $1 FOR UPDATE`,
      [card.id],
    );
    expect(s.rowCount).toBe(0);
    const a = await asStranger<{ rowCount: number }>(
      "accounts",
      `UPDATE accounts SET name = 'Чужа', kind = 'loan' WHERE id = $1`,
      [card.id],
    );
    expect(a.rowCount).toBe(0);
    // A row cannot be moved into the caller's space either.
    await expect(
      db.databases
        .for("liabilities")
        .inHousehold(space.householdId, (q) =>
          q.query(`UPDATE liabilities SET household_id = $2 WHERE account_id = $1`, [
            card.id,
            stranger.householdId,
          ]),
        ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await stored(space.householdId)).toEqual(before);
    // The public interface of liabilities bound to another space finds nothing and writes nothing.
    expect(
      await liabilities.changeKind(stranger.householdId, {
        actorAccountId: stranger.accountId,
        accountId: card.id,
        kind: "loan",
      }),
    ).toEqual({ kind: "not-found" });
    expect(await stored(space.householdId)).toEqual(before);
  });
});

describe("sec233 liabilities/0002: the stored rule widens only for a loan marked after a kind change, the application's stays", () => {
  it("sec233: no request creates «Кредит» without its rate or payment, and nothing is stored for a refused one", async () => {
    const space = await newSpace();
    const base = { kind: "loan", name: "Кредит", balance: eur("5000.00"), balanceDate: "2024-10-01" };
    for (const terms of [
      {},
      { annualRate: "9.90" },
      { monthlyPayment: "310.00" },
      { annualRate: null, monthlyPayment: null },
      { annualRate: "9.90", monthlyPayment: "0" },
    ]) {
      const res = await call(space, "POST", "/v1/accounts", { ...base, ...terms });
      expect([terms, res.statusCode]).toEqual([terms, 400]);
    }
    for (const input of [
      { kind: "loan" as const, annualRate: null, monthlyPayment: "310.00" },
      { kind: "loan" as const, annualRate: "9.90", monthlyPayment: null },
    ]) {
      const res = await liabilities.register(space.householdId, {
        actorAccountId: space.accountId,
        accountId: randomUUID(),
        currency: "EUR",
        terms: { creditLimit: null, gracePeriodDays: null, ...input },
      } as never);
      expect(res.kind).toBe("invalid");
    }
    const after = await stored(space.householdId);
    expect(after.accounts).toEqual([]);
    expect(after.liabilities).toEqual([]);
  });

  it("sec233: the rules 0002 leaves in the database still hold — a card never has a monthly payment, a rate and a payment stay in range", async () => {
    const { rows } = await db.owner.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'liabilities.liabilities'::regclass AND contype = 'c' ORDER BY conname`,
    );
    const defs = rows.map((r) => (r as { def: string }).def).join("\n");
    expect(defs).toMatch(/kind <> 'credit-card'.*monthly_payment IS NULL/s);
    expect(defs).toMatch(/monthly_payment > /);
    expect(defs).toMatch(/annual_rate >= .*annual_rate <= /s);
    // Round 2 (ARC-03 FR 4): 0002 keeps the loan rule, widened only for `terms_pending` (FIN-12@PoC AC12).
    expect(defs).toMatch(
      /kind <> 'loan'.*grace_period_days IS NULL.*terms_pending OR.*annual_rate IS NOT NULL.*monthly_payment IS NOT NULL/s,
    );
    expect(defs).toMatch(/NOT terms_pending\)? OR \(?kind = 'loan'/);
    const rls = await db.owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'liabilities.liabilities'::regclass`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("sec233: «Кредит» → «Кредитна картка» → «Кредит» loses no amount silently — every dropped term is in the audit log, the debt and the rate are the same decimals", async () => {
    const space = await newSpace();
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит",
      balance: eur("5000.10"),
      annualRate: "9.90",
      monthlyPayment: "310.07",
    });
    expect((await patch(space, loan.id, { kind: "credit-card" })).statusCode).toBe(200);
    const back = await patch(space, loan.id, { kind: "loan" });
    expect(back.statusCode).toBe(200);
    expect(back.json().loan).toEqual({
      annualRate: "9.9",
      monthlyPayment: null,
      debt: eur("5000.1"),
      termsMissing: true,
    });
    const liability = await liabilities.forAccount(space.householdId, loan.id);
    const log = (
      await audit.entriesFor(space.householdId, { type: "liabilities.liability", id: liability!.id })
    )
      .filter((e) => e.action === "update")
      .map((e) => e.changes);
    expect(log).toHaveLength(2);
    expect(log.flat()).toContainEqual({
      field: "monthlyPayment",
      before: "310.07",
      after: null,
      masked: false,
    });
    expect(
      (await audit.entriesFor(space.householdId, { type: "accounts.account", id: loan.id })).filter(
        (e) => e.action === "update",
      ),
    ).toHaveLength(2);
  });
});

describe("sec233 audit and concurrency", () => {
  // ARC-04 (#252 item 3): the audit entry of «Основне» is a hand-off job of the accounts transaction, written after it
  // commits. An audit outage then no longer undoes the change: the worker writes the entry once the log is back.
  it("sec233: an audit outage after a rename and a cash kind change keeps the change; the worker writes its audit entry once", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, {
      kind: "deposit",
      name: "Депозит",
      balance: eur("100.00"),
      annualRate: "3.50",
      depositOpenedOn: "2024-10-01",
      depositMaturesOn: "2027-10-01",
    });
    const before = await stored(space.householdId);
    refuseAuditOf = "accounts.account";
    try {
      const res = await callOn(auditDown, space, "PATCH", `/v1/accounts/${acc.id}`, {
        name: "Нова",
        kind: "current",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toMatch(/audit log is down/);
    } finally {
      refuseAuditOf = null;
    }
    const mid = await stored(space.householdId);
    expect(mid.accounts[0]).toEqual(expect.objectContaining({ name: "Нова", kind: "current" }));
    expect(mid.audit).toEqual(before.audit);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    const updates = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: acc.id })
    ).filter((e) => e.action === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(["name", "kind", "depositOpenedOn", "depositMaturesOn"]),
    );
  });

  // ARC-04 (#238 item 1, #252 item 3): the liability and the account's audit entry follow the account only after the
  // accounts transaction commits, so an audit outage leaves the account and its liability changed together, and the
  // audit entry comes with the worker.
  it("sec233: an audit outage in the middle of «Кредитна картка» → «Кредит» changes the account and its liability together; the worker writes the account's audit entry", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка",
      balance: eur("10.00"),
      creditLimit: "500.00",
      gracePeriodDays: 30,
    });
    refuseAuditOf = "accounts.account";
    try {
      expect(
        (await callOn(auditDown, space, "PATCH", `/v1/accounts/${card.id}`, { kind: "loan" })).statusCode,
      ).toBe(200);
    } finally {
      refuseAuditOf = null;
    }
    const mid = await stored(space.householdId);
    expect(mid.accounts[0]).toEqual(expect.objectContaining({ kind: "loan" }));
    expect(mid.liabilities[0]).toEqual(expect.objectContaining({ kind: "loan", grace_period_days: null }));
    // The account still answers (no 500) in between.
    expect((await call(space, "GET", `/v1/accounts/${card.id}`)).statusCode).toBe(200);
    expect((await call(space, "GET", "/v1/accounts")).statusCode).toBe(200);
    await runWorker(space.householdId);
    const kindChanges = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: card.id })
    ).filter((e) => e.action === "update" && e.changes.some((c) => c.field === "kind"));
    expect(kindChanges).toHaveLength(1);
    expect(await stored(space.householdId)).toEqual(
      expect.objectContaining({ accounts: mid.accounts, liabilities: mid.liabilities }),
    );
  });

  it("sec233: twelve concurrent kind changes and adjustments of one card leave the account and its liability with the same kind, every change audited, and no kind change after a transaction", async () => {
    const space = await newSpace();
    const card = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("10.00") });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        i === 7
          ? call(space, "POST", `/v1/accounts/${card.id}/balance`, { balance: eur("11.00") })
          : patch(space, card.id, { kind: i % 2 === 0 ? "loan" : "credit-card" }),
      ),
    );
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    const end = await stored(space.householdId);
    expect(end.liabilities[0]).toEqual(
      expect.objectContaining({ kind: (end.accounts[0] as { kind: string }).kind }),
    );
    const liability = await liabilities.forAccount(space.householdId, card.id);
    const changedL = (
      await audit.entriesFor(space.householdId, { type: "liabilities.liability", id: liability!.id })
    ).filter((e) => e.action === "update");
    const changedA = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: card.id })
    ).filter((e) => e.action === "update" && e.changes.some((c) => c.field === "kind"));
    // ARC-04: each kind change's hand-off gives the liability the account's kind as it is then, with the account's row
    // locked, so a change overtaken by a later one before its hand-off ran moves the liability no more (no entry).
    expect(changedL.length).toBeLessThanOrEqual(changedA.length);
    // The `<=` also holds with no entry at all, so the chain is checked too: when the card ended as a loan, at least one
    // liability update entry exists and one of them moved its kind to the final kind (review 5908367712, follow-up 1).
    const finalKind = (end.accounts[0] as { kind: string }).kind;
    if (finalKind !== "credit-card") {
      expect(changedL.length).toBeGreaterThanOrEqual(1);
      expect(changedL.some((e) => e.changes.some((c) => c.field === "kind" && c.after === finalKind))).toBe(
        true,
      );
    }
    expect(results.filter((r, i) => i !== 7 && r.statusCode === 200).length).toBeGreaterThanOrEqual(
      changedA.length,
    );
    // Once the adjustment is in, the kind is fixed.
    expect(
      (await patch(space, card.id, { kind: end.accounts[0]!.kind === "loan" ? "credit-card" : "loan" }))
        .statusCode,
    ).toBe(409);
    expect((await view(space, card.id)).kind).toBe((end.accounts[0] as { kind: string }).kind);
  });
});
