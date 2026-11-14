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
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import {
  createAccountsServices,
  createAccountStatements,
  type AccountStatements,
} from "../src/modules/accounts/index.ts";

import type { Ledger as LedgerPort } from "../src/modules/ledger/index.ts";

/**
 * Security review of #224 (FIN-12@PoC a): the guards of closing, reopening, «Оновити залишок» and deleting its
 * adjustment — permission and scope on every new route, the feature flag, the closed-account guard on every write,
 * the direction of a debt's transfer, retries and concurrent requests, and the audit of a transfer when a later step
 * fails. Synthetic names and amounts only.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let statements: AccountStatements;
let app: ReturnType<typeof buildServer>;
let flagOff: ReturnType<typeof buildServer>;
let faulty: ReturnType<typeof buildServer>;
/** The faulty app's ledger fails the transfer with this ordinal (1-based) once; 0 — never. */
let failTransfer = 0;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Тест Синтетичний" });
  return { accountId, householdId };
}

function callOn(
  server: ReturnType<typeof buildServer>,
  space: Space,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean } = {},
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
const call = (...args: Parameters<typeof callOn> extends [unknown, ...infer R] ? R : never) =>
  callOn(app, ...args);

interface Created {
  readonly id: string;
  readonly subaccountIds: string[];
}

async function createAccount(space: Space, body: Record<string, unknown>): Promise<Created> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2024-10-01", ...body });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const { rows } = await db.owner.query(
    `SELECT id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2 ORDER BY position`,
    [space.householdId, id],
  );
  return { id, subaccountIds: rows.map((r) => (r as { id: string }).id) };
}
const eur = (amount: string) => ({ amount, currency: "EUR" });

const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();

async function eventTypes(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query(
    `SELECT event_type FROM ledger.entries WHERE household_id = $1 ORDER BY recorded_at, id`,
    [householdId],
  );
  return rows.map((r) => (r as { event_type: string }).event_type);
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const servicesWith = (l: LedgerPort) =>
    createAccountsServices({
      ledger: l,
      liabilities: createLiabilities(db.databases.for("liabilities"), audit),
      keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
      fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
      audit,
      clock: { now: () => NOW },
      newId: randomUUID,
    });
  const services = servicesWith(ledger);
  let transfers = 0;
  const failing: LedgerPort = {
    ...ledger,
    post: async (h, input) => {
      if (input.event.type === "transfer" && failTransfer > 0 && ++transfers === failTransfer) {
        failTransfer = 0;
        transfers = 0;
        throw new Error("synthetic failure after an earlier transfer committed");
      }
      return ledger.post(h, input);
    },
  };
  statements = createAccountStatements(db.databases.for("accounts"), services);
  const server = (flags: ReturnType<typeof fakeFlags>, s = services) =>
    buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags,
          authenticate: testAuthenticate,
          accounts: s,
          allowedOrigins: new Set([WEB]),
        }),
    });
  app = server(fakeFlags());
  flagOff = server(fakeFlags({ off: ["accounts.manual"] }));
  faulty = server(fakeFlags(), servicesWith(failing));
  await Promise.all([app.ready(), flagOff.ready(), faulty.ready()]);
});

afterAll(async () => {
  await Promise.all([app?.close(), flagOff?.close(), faulty?.close()]);
  await db?.close();
});

/** Every new route of #224 on one account (and one adjustment of it). */
function routes(accountId: string, adjustmentId: string) {
  return [
    ["GET", `/v1/accounts/${accountId}/closing?closedOn=${TODAY}`, undefined],
    ["POST", `/v1/accounts/${accountId}/close`, { closedOn: TODAY, settlement: { kind: "adjustment" } }],
    ["POST", `/v1/accounts/${accountId}/reopen`, undefined],
    ["POST", `/v1/accounts/${accountId}/balance`, { balance: eur("1.00") }],
    ["DELETE", `/v1/accounts/${accountId}/balance-adjustments/${adjustmentId}`, undefined],
  ] as const;
}

describe("sec224: access to the new routes", () => {
  it("FIN-12@PoC AC6, AC17: a viewer, an advisor and every scoped member are refused on all five routes; nothing is read or written", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("431.00") });
    const made = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, { balance: eur("430.00") });
    const adjustmentId = made.json().adjustment.id as string;
    // A second, closed account: reopen must be refused before the handler too.
    const closed = await createAccount(space, { kind: "cash", name: "Закритий", balance: eur("0.00") });
    expect(
      (await call(space, "POST", `/v1/accounts/${closed.id}/close`, { closedOn: TODAY })).statusCode,
    ).toBe(200);
    const before = await eventTypes(space.householdId);

    const principals = [
      { role: "viewer", scoped: false },
      { role: "advisor", scoped: false },
      { role: "owner", scoped: true },
      { role: "admin", scoped: true },
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ];
    for (const principal of principals)
      for (const id of [acc.id, closed.id])
        for (const [method, url, body] of routes(id, adjustmentId)) {
          const res = await call(space, method, url, body, principal);
          expect([principal, method, url, res.statusCode]).toEqual([principal, method, url, 403]);
          expect(res.body).not.toMatch(/430|431/);
        }
    expect(await eventTypes(space.householdId)).toEqual(before);
    expect((await view(space, acc.id)).status).toBe("active");
    expect((await view(space, closed.id)).status).toBe("closed");
    expect((await view(space, acc.id)).adjustments).toHaveLength(1);
  });

  it("FIN-12@PoC FR 7, FR 9, FR 14: with `accounts.manual` off every new route is refused and nothing is written", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("431.00") });
    const made = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, { balance: eur("430.00") });
    const before = await eventTypes(space.householdId);
    for (const [method, url, body] of routes(acc.id, made.json().adjustment.id)) {
      const res = await callOn(flagOff, space, method, url, body);
      expect([url, res.statusCode < 400]).toEqual([url, false]);
      expect(res.body).not.toMatch(/430|431/);
    }
    expect(await eventTypes(space.householdId)).toEqual(before);
  });

  it("FIN-04@PoC AC7, FIN-12@PoC AC17: DELETE of an adjustment id that is another account's adjustment, a transfer or an opening entry is «not found»", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { kind: "current", name: "А", balance: eur("100.00") });
    const b = await createAccount(space, { kind: "current", name: "Б", balance: eur("100.00") });
    const adjB = (await call(space, "POST", `/v1/accounts/${b.id}/balance`, { balance: eur("90.00") })).json()
      .adjustment.id as string;
    const { rows } = await db.owner.query(
      `SELECT id FROM ledger.entries WHERE household_id = $1 AND event_type = 'opening-balance'`,
      [space.householdId],
    );
    for (const id of [adjB, ...rows.map((r) => (r as { id: string }).id)]) {
      const res = await call(space, "DELETE", `/v1/accounts/${a.id}/balance-adjustments/${id}`);
      expect(res.statusCode).toBe(404);
    }
    expect((await view(space, b.id)).adjustments).toHaveLength(1);
    expect((await view(space, a.id)).currencies[0].balance).toEqual(eur("100"));
  });
});

describe("sec224: DELETE reverses only the adjustment it names", () => {
  it("FIN-04@PoC AC7: a stale id (the adjustment before its change) or another account's adjustment does not delete the live one", async () => {
    const space = await newSpace();
    const a = await createAccount(space, { kind: "current", name: "А", balance: eur("100.00") });
    const b = await createAccount(space, { kind: "current", name: "Б", balance: eur("100.00") });
    const stale = (
      await call(space, "POST", `/v1/accounts/${a.id}/balance`, { balance: eur("90.00") })
    ).json().adjustment.id as string;
    await call(space, "POST", `/v1/accounts/${a.id}/balance`, { balance: eur("80.00") });
    const adjB = (await call(space, "POST", `/v1/accounts/${b.id}/balance`, { balance: eur("70.00") })).json()
      .adjustment.id as string;
    for (const id of [stale, adjB]) {
      const res = await call(space, "DELETE", `/v1/accounts/${a.id}/balance-adjustments/${id}`);
      expect(res.statusCode).toBe(404);
    }
    expect((await view(space, a.id)).currencies[0].balance).toEqual(eur("80"));
    expect((await view(space, b.id)).currencies[0].balance).toEqual(eur("70"));
  });
});

describe("sec224: a closed account is read-only on every write path", () => {
  it("FIN-12@PoC FR 8, FIN-04@PoC AC7: DELETE of its adjustment and a statement's recount are refused; nothing is written", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Імпорт", balance: eur("100.00") });
    await db.owner.query(
      `UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`,
      [space.householdId, acc.id],
    );
    const adjustmentId = (
      await call(space, "POST", `/v1/accounts/${acc.id}/balance`, { balance: eur("0.00") })
    ).json().adjustment.id as string;
    expect((await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY })).statusCode).toBe(
      200,
    );
    const before = await eventTypes(space.householdId);

    const del = await call(space, "DELETE", `/v1/accounts/${acc.id}/balance-adjustments/${adjustmentId}`);
    expect([del.statusCode, del.json().code]).toEqual([409, "ACCOUNT_CLOSED"]);
    expect(
      await statements.reconcile(space.householdId, {
        accountId: acc.id,
        statementEnd: TODAY,
        closingBalance: Money.of("50.00", "EUR"),
      }),
    ).toEqual({ kind: "closed" });
    expect(await eventTypes(space.householdId)).toEqual(before);
  });
});

describe("sec224: money moves the right way, once", () => {
  it("FIN-12@PoC FR 7: closing a credit card with a debt by transfer pays the debt from the other account (no doubled debt)", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка",
      institution: { name: "Синтетичний банк", country: "UA" },
      balance: eur("200.00"),
      creditLimit: "1000.00",
      gracePeriodDays: 55,
    });
    const current = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: eur("1000.00"),
    });
    const res = await call(space, "POST", `/v1/accounts/${card.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: current.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currencies[0].balance).toEqual(eur("0"));
    expect((await view(space, current.id)).currencies[0].balance).toEqual(eur("800"));
  });

  it("FIN-12@PoC FR 7, FIN-04@PoC FR 10: «Списати коригуванням» with a live adjustment brings that same adjustment to zero balance on the closing date", async () => {
    const space = await newSpace();
    const cash = await createAccount(space, { kind: "cash", name: "Готівка", balance: eur("100.00") });
    await call(space, "POST", `/v1/accounts/${cash.id}/balance`, { balance: eur("80.00") });
    const res = await call(space, "POST", `/v1/accounts/${cash.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currencies[0].balance).toEqual(eur("0"));
    const live = await ledger.liveEntries(
      space.householdId,
      { module: "accounts", id: cash.subaccountIds[0]! },
      "balance-adjustment",
    );
    expect(live).toHaveLength(1);
    expect(res.json().adjustments).toEqual([expect.objectContaining({ amount: eur("-100") })]);
  });

  it("FIN-12@PoC FR 7: a multi-currency account closes by transfer only when the target has every currency; then each currency moves", async () => {
    const space = await newSpace();
    const src = await createAccount(space, {
      kind: "current",
      name: "Мульти",
      balance: eur("10.00"),
      extraCurrencies: [{ amount: "300.00", currency: "UAH", date: "2024-10-01" }],
    });
    const eurOnly = await createAccount(space, { kind: "current", name: "Євро", balance: eur("0.00") });
    const both = await createAccount(space, {
      kind: "current",
      name: "Обидві",
      balance: eur("0.00"),
      extraCurrencies: [{ amount: "0.00", currency: "UAH", date: "2024-10-01" }],
    });
    const bad = await call(space, "POST", `/v1/accounts/${src.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: eurOnly.id },
    });
    expect(bad.statusCode).toBe(400);
    expect(await eventTypes(space.householdId)).not.toContain("transfer");
    const ok = await call(space, "POST", `/v1/accounts/${src.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: both.id },
    });
    expect(ok.statusCode).toBe(200);
    expect((await view(space, both.id)).currencies.map((c: { balance: unknown }) => c.balance)).toEqual([
      eur("10"),
      { amount: "300", currency: "UAH" },
    ]);
  });

  it("FIN-12@PoC FR 14, FIN-04@PoC FR 10: the same «Оновити залишок» sent twice at once makes one adjustment; the balance is the one entered", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("500.00") });
    const results = await Promise.all(
      [1, 2, 3].map(() => call(space, "POST", `/v1/accounts/${acc.id}/balance`, { balance: eur("450.00") })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.json().changed)).toHaveLength(1);
    expect((await eventTypes(space.householdId)).filter((t) => t === "balance-adjustment")).toHaveLength(1);
    expect((await view(space, acc.id)).currencies[0].balance).toEqual(eur("450"));
  });

  it("FIN-12@PoC FR 7: two closings by transfer sent at once move the balance once", async () => {
    const space = await newSpace();
    const src = await createAccount(space, { kind: "current", name: "Джерело", balance: eur("70.00") });
    const dst = await createAccount(space, { kind: "current", name: "Ціль", balance: eur("0.00") });
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: dst.id } };
    const results = await Promise.all(
      [1, 2].map(() => call(space, "POST", `/v1/accounts/${src.id}/close`, body)),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await eventTypes(space.householdId)).filter((t) => t === "transfer")).toHaveLength(1);
    expect((await view(space, dst.id)).currencies[0].balance).toEqual(eur("70"));
  });
});

describe("sec224: the non-atomic hand-over (#210) on a closing by transfer", () => {
  it("FIN-12@PoC FR 7, FR 15: a failure after the first of two transfers committed: after the retry every transfer that moved money is in the audit log", async () => {
    const space = await newSpace();
    const src = await createAccount(space, {
      kind: "current",
      name: "Мульти",
      balance: eur("10.00"),
      extraCurrencies: [{ amount: "300.00", currency: "UAH", date: "2024-10-01" }],
    });
    const both = await createAccount(space, {
      kind: "current",
      name: "Обидві",
      balance: eur("0.00"),
      extraCurrencies: [{ amount: "0.00", currency: "UAH", date: "2024-10-01" }],
    });
    const body = { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: both.id } };
    failTransfer = 2;
    const first = await callOn(faulty, space, "POST", `/v1/accounts/${src.id}/close`, body);
    expect(first.statusCode).toBe(500);
    // The EUR transfer committed in the ledger's own transaction.
    expect((await eventTypes(space.householdId)).filter((t) => t === "transfer")).toHaveLength(1);
    const retry = await call(space, "POST", `/v1/accounts/${src.id}/close`, body);
    expect(retry.statusCode).toBe(200);
    expect((await eventTypes(space.householdId)).filter((t) => t === "transfer")).toHaveLength(2);

    const changes = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: src.id })
    ).flatMap((e) => e.changes.map((c) => [c.field, c.after]));
    expect(changes).toEqual(
      expect.arrayContaining([
        ["settlement.EUR", "10"],
        ["settlement.UAH", "300"],
      ]),
    );
  });
});
