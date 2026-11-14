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

/**
 * FIN-12@PoC a) and FIN-04@PoC AC5, AC7 (wave 2 row 13), through the real API on a real PostgreSQL: closing an account
 * with its balance moved or written off, reopening it, «Оновити залишок» with one adjustment per currency against
 * «Коригування», deleting the adjustment, and the recount of a temporary adjustment by a statement. Every name and
 * amount is synthetic; the session is the test's principal header.
 */
const WEB = "http://localhost:5173";
/** «Today» of these tests. */
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let statements: AccountStatements;
let app: ReturnType<typeof buildServer>;

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
  method: "GET" | "POST" | "DELETE",
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

interface Created {
  readonly id: string;
  readonly subaccountId: string;
  readonly ledgerAccountId: string;
}

async function createAccount(
  space: Space,
  body: { kind: string; name: string; amount: string; currency?: string; date?: string },
): Promise<Created> {
  const res = await call(space, "POST", "/v1/accounts", {
    kind: body.kind,
    name: body.name,
    balance: { amount: body.amount, currency: body.currency ?? "EUR" },
    balanceDate: body.date ?? "2024-10-01",
    ...(body.kind === "loan" ? { annualRate: "9.90", monthlyPayment: "310.00" } : {}),
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const { rows } = await db.owner.query(
    `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2`,
    [space.householdId, id],
  );
  const row = rows[0] as { id: string; ledger_account_id: string };
  return { id, subaccountId: row.id, ledgerAccountId: row.ledger_account_id };
}

/** An imported account: no import exists yet (IMP-*), so the source is set as the importer would. */
async function markImported(space: Space, accountId: string): Promise<void> {
  await db.owner.query(`UPDATE accounts.accounts SET source = 'import' WHERE household_id = $1 AND id = $2`, [
    space.householdId,
    accountId,
  ]);
}

const balance = async (space: Space, accountId: string) =>
  (await call(space, "GET", `/v1/accounts/${accountId}`)).json().currencies[0].balance;

async function entries(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT e.id, e.event_type, e.operation_date::text AS operation_date, e.reverses_entry_id
       FROM ledger.entries e WHERE e.household_id = $1 ORDER BY e.recorded_at, e.id`,
    [householdId],
  );
  return rows as {
    id: string;
    event_type: string;
    operation_date: string;
    reverses_entry_id: string | null;
  }[];
}

/** The service account on the other side of an entry's posting («Коригування», «Зовнішні кошти»). */
async function serviceSides(householdId: string, entryId: string): Promise<string[]> {
  const { rows } = await db.owner.query(
    `SELECT a.service_kind FROM ledger.postings p
       JOIN ledger.accounts a ON a.household_id = p.household_id
        AND a.id IN (p.debit_account_id, p.credit_account_id) AND a.service_kind IS NOT NULL
      WHERE p.household_id = $1 AND p.entry_id = $2`,
    [householdId, entryId],
  );
  return rows.map((r) => (r as { service_kind: string }).service_kind);
}

const auditActions = async (householdId: string, entity: { type: string; id: string }) =>
  (await audit.entriesFor(householdId, entity)).map((e) => e.action);

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const services = createAccountsServices({
    ledger,
    liabilities: createLiabilities(db.databases.for("liabilities"), audit),
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    audit,
    clock: { now: () => NOW },
    newId: randomUUID,
  });
  statements = createAccountStatements(db.databases.for("accounts"), services);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("FIN-12@PoC FR 7, FR 8, FIN-01@PoC FR 15: closing an account", () => {
  it("FIN-12@PoC AC3, FIN-01@PoC AC6: a zero balance with 120 transactions over 2 years closes on 2026-09-30; out of the active list and «Гроші разом», shown with «Показати закриті», its history kept", async () => {
    const space = await newSpace();
    const deposit = await createAccount(space, {
      kind: "savings",
      name: "Ощадний депозит",
      amount: "600.00",
    });
    await createAccount(space, { kind: "current", name: "Щоденний", amount: "100.00" });
    // 120 transactions over two years that leave the balance at 0: 60 withdrawals of 10,00 €.
    for (let i = 0; i < 120; i++) {
      const day = new Date(Date.UTC(2024, 9, 2 + i * 6)).toISOString().slice(0, 10);
      await ledger.post(space.householdId, {
        source: { module: "accounts", id: deposit.subaccountId },
        idempotencyKey: `test.tx:${deposit.subaccountId}:${i}`,
        operationDate: day,
        event: {
          type: "transaction",
          account: deposit.ledgerAccountId,
          amount: Money.of(i % 2 === 0 ? "-20" : "10", "EUR"),
        },
      });
    }
    expect(await balance(space, deposit.id)).toEqual({ amount: "0", currency: "EUR" });
    const before = await entries(space.householdId);

    const closing = await call(space, "GET", `/v1/accounts/${deposit.id}/closing?closedOn=2026-09-30`);
    expect(closing.statusCode).toBe(200);
    expect(closing.json()).toEqual({
      closedOn: "2026-09-30",
      zero: true,
      currencies: [{ currency: "EUR", balance: { amount: "0", currency: "EUR" } }],
    });

    const closed = await call(space, "POST", `/v1/accounts/${deposit.id}/close`, { closedOn: "2026-09-30" });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ id: deposit.id, status: "closed", closedOn: "2026-09-30" });

    const active = (await call(space, "GET", "/v1/accounts")).json().items.map((a: { id: string }) => a.id);
    expect(active).not.toContain(deposit.id);
    const all = (await call(space, "GET", "/v1/accounts?includeClosed=true")).json().items;
    expect(all.find((a: { id: string }) => a.id === deposit.id)).toMatchObject({
      status: "closed",
      closedOn: "2026-09-30",
    });
    const summary = (await call(space, "GET", "/v1/accounts/summary")).json();
    expect(summary.sources).toEqual({ import: 0, manual: 1 });
    expect(summary.moneyTogether.breakdown).toEqual([
      expect.objectContaining({ currency: "EUR", amount: { amount: "100", currency: "EUR" } }),
    ]);

    // Its history stays: nothing deleted, the balance on a past date as before.
    expect(await entries(space.householdId)).toEqual(before);
    const past = await ledger.balanceAt(space.householdId, deposit.ledgerAccountId, "2024-10-02");
    expect(past.toDecimalString()).toBe("580");
    expect(await auditActions(space.householdId, { type: "accounts.account", id: deposit.id })).toEqual([
      "create",
      "update",
    ]);
  });

  it("FIN-12@PoC AC4, FIN-01@PoC EC5: 430 EUR on the closing date — the dialog shows 430 EUR; «Перенести на інший рахунок» to «Ощадний» makes a 430 EUR transfer and closes at zero", async () => {
    const space = await newSpace();
    const current = await createAccount(space, { kind: "current", name: "Поточний", amount: "430.00" });
    const savings = await createAccount(space, { kind: "savings", name: "Ощадний", amount: "1000.00" });

    const closing = await call(space, "GET", `/v1/accounts/${current.id}/closing?closedOn=${TODAY}`);
    expect(closing.json()).toEqual({
      closedOn: TODAY,
      zero: false,
      currencies: [{ currency: "EUR", balance: { amount: "430", currency: "EUR" } }],
    });

    // Not zero and no choice made: refused, nothing written.
    const refused = await call(space, "POST", `/v1/accounts/${current.id}/close`, { closedOn: TODAY });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("ACCOUNT_BALANCE_NOT_ZERO");

    const res = await call(space, "POST", `/v1/accounts/${current.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: savings.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "closed",
      closedOn: TODAY,
      currencies: [{ currency: "EUR", balance: { amount: "0", currency: "EUR" } }],
    });
    expect(await balance(space, savings.id)).toEqual({ amount: "1430", currency: "EUR" });
    const transfers = (await entries(space.householdId)).filter((e) => e.event_type === "transfer");
    expect(transfers).toEqual([expect.objectContaining({ operation_date: TODAY })]);
    const [entry] = (
      await audit.entriesFor(space.householdId, { type: "accounts.account", id: current.id })
    ).slice(-1);
    expect(entry!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "status", before: "active", after: "closed" }),
        expect.objectContaining({ field: "settlement.kind", after: "transfer" }),
        expect.objectContaining({ field: "settlement.toAccountId", after: savings.id }),
        expect.objectContaining({ field: "settlement.EUR", after: "430" }),
      ]),
    );
  });

  it("FIN-12@PoC FR 7: «Списати коригуванням» writes the balance off against «Коригування» on the closing date; a loan's debt too", async () => {
    const space = await newSpace();
    const cash = await createAccount(space, { kind: "cash", name: "Готівка", amount: "75.00" });
    const res = await call(space, "POST", `/v1/accounts/${cash.id}/close`, {
      closedOn: "2026-10-01",
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currencies[0].balance).toEqual({ amount: "0", currency: "EUR" });
    const adjustment = (await entries(space.householdId)).find((e) => e.event_type === "balance-adjustment")!;
    expect(adjustment.operation_date).toBe("2026-10-01");
    expect(await serviceSides(space.householdId, adjustment.id)).toEqual(["adjustment"]);

    const loan = await createAccount(space, { kind: "loan", name: "Кредит", amount: "1200.00" });
    const closed = await call(space, "POST", `/v1/accounts/${loan.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "adjustment" },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().loan.debt).toEqual({ amount: "0", currency: "EUR" });
  });

  it("FIN-12@PoC FR 7: the transfer goes to another active account of the space in the same currency; the date is from the opening to today", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const eur = await createAccount(space, { kind: "current", name: "Поточний", amount: "50.00" });
    const uah = await createAccount(space, {
      kind: "current",
      name: "Гривня",
      amount: "10.00",
      currency: "UAH",
    });
    const closedTarget = await createAccount(space, { kind: "cash", name: "Стара готівка", amount: "0.00" });
    await call(space, "POST", `/v1/accounts/${closedTarget.id}/close`, { closedOn: TODAY });
    const foreign = await createAccount(other, { kind: "current", name: "Чужий", amount: "5.00" });

    const issue = async (body: unknown) => {
      const res = await call(space, "POST", `/v1/accounts/${eur.id}/close`, body);
      expect(res.statusCode).toBe(400);
      return res.json().errors;
    };
    const transfer = (toAccountId: string) => ({
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId },
    });
    expect(await issue(transfer(uah.id))).toEqual([
      expect.objectContaining({ path: "settlement.toAccountId", issue: "currency_missing" }),
    ]);
    expect(await issue(transfer(closedTarget.id))).toEqual([
      expect.objectContaining({ path: "settlement.toAccountId", issue: "closed" }),
    ]);
    expect(await issue(transfer(eur.id))).toEqual([
      expect.objectContaining({ path: "settlement.toAccountId", issue: "same_account" }),
    ]);
    expect(await issue(transfer(foreign.id))).toEqual([
      expect.objectContaining({ path: "settlement.toAccountId", issue: "not_found" }),
    ]);
    expect(await issue({ closedOn: "2026-10-18" })).toEqual([
      expect.objectContaining({ path: "closedOn", issue: "in_future" }),
    ]);
    expect(await issue({ closedOn: "2024-09-30" })).toEqual([
      expect.objectContaining({ path: "closedOn", issue: "before_opening" }),
    ]);
    // Nothing moved by any refusal.
    expect((await entries(space.householdId)).map((e) => e.event_type)).toEqual([
      "opening-balance",
      "opening-balance",
    ]);
  });

  it("FIN-01@PoC EC4: a closing date before the account's latest transaction is refused, even when the movements after it net to zero", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      amount: "20.00",
      date: "2026-10-10",
    });
    const res = await call(space, "POST", `/v1/accounts/${acc.id}/close`, {
      closedOn: "2026-10-05",
      settlement: { kind: "adjustment" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      expect.objectContaining({ path: "closedOn", issue: "before_opening" }),
    ]);

    // +20 and −20 after 2026-10-12: the balance on that date equals today's, yet there are transactions after it.
    for (const [day, amount] of [
      ["2026-10-14", "20"],
      ["2026-10-16", "-20"],
    ] as const)
      await ledger.post(space.householdId, {
        source: { module: "accounts", id: acc.subaccountId },
        idempotencyKey: `test.later:${acc.subaccountId}:${day}`,
        operationDate: day,
        event: { type: "transaction", account: acc.ledgerAccountId, amount: Money.of(amount, "EUR") },
      });
    const later = await call(space, "POST", `/v1/accounts/${acc.id}/close`, {
      closedOn: "2026-10-12",
      settlement: { kind: "adjustment" },
    });
    expect(later.statusCode).toBe(409);
    expect(later.json().code).toBe("ACCOUNT_ACTIVITY_AFTER_CLOSE");
  });

  it("FIN-12@PoC FR 8: a closed account is read-only — no second closing, no «Оновити залишок», no transfer to it", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "cash", name: "Готівка", amount: "0.00" });
    const source = await createAccount(space, { kind: "cash", name: "Гаманець", amount: "5.00" });
    expect((await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY })).statusCode).toBe(
      200,
    );

    const again = await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY });
    expect([again.statusCode, again.json().code]).toEqual([409, "ACCOUNT_CLOSED"]);
    const update = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "10.00", currency: "EUR" },
    });
    expect([update.statusCode, update.json().code]).toEqual([409, "ACCOUNT_CLOSED"]);
    const preview = await call(space, "GET", `/v1/accounts/${acc.id}/closing?closedOn=${TODAY}`);
    expect([preview.statusCode, preview.json().code]).toEqual([409, "ACCOUNT_CLOSED"]);
    const toClosed = await call(space, "POST", `/v1/accounts/${source.id}/close`, {
      closedOn: TODAY,
      settlement: { kind: "transfer", toAccountId: acc.id },
    });
    expect(toClosed.statusCode).toBe(400);
  });

  it("FIN-12@PoC FR 9: «Відкрити знову» makes a closed account active again, with its history and an audit entry", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "cash", name: "Готівка", amount: "0.00" });
    await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY });

    const reopened = await call(space, "POST", `/v1/accounts/${acc.id}/reopen`);
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: "active", closedOn: null });
    const active = (await call(space, "GET", "/v1/accounts")).json().items.map((a: { id: string }) => a.id);
    expect(active).toContain(acc.id);
    const twice = await call(space, "POST", `/v1/accounts/${acc.id}/reopen`);
    expect([twice.statusCode, twice.json().code]).toEqual([409, "ACCOUNT_NOT_CLOSED"]);
    const [, closing, reopening] = await audit.entriesFor(space.householdId, {
      type: "accounts.account",
      id: acc.id,
    });
    expect(closing!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "closedOn", before: null, after: TODAY })]),
    );
    expect(reopening!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "status", before: "closed", after: "active" }),
        expect.objectContaining({ field: "closedOn", before: TODAY, after: null }),
      ]),
    );
  });

  it("FIN-12@PoC AC7: an account without transactions for 90 days has no «Неактивний» mark and is listed as an ordinary active account (FR 10)", async () => {
    const space = await newSpace();
    const quiet = await createAccount(space, {
      kind: "current",
      name: "Тихий",
      amount: "10.00",
      date: "2026-07-01",
    });
    const [item] = (await call(space, "GET", "/v1/accounts")).json().items;
    expect(item).toMatchObject({ id: quiet.id, status: "active", closedOn: null, updatedOn: "2026-07-01" });
    expect(JSON.stringify(item)).not.toMatch(/inactive/i);
    expect((await call(space, "GET", `/v1/accounts/${quiet.id}`)).json().status).toBe("active");
  });

  it("FIN-12@PoC AC6: closing from a user outside the space is «not found» and tells nothing about the space", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", amount: "430.00" });
    const missing = randomUUID();
    for (const id of [acc.id, missing]) {
      const preview = await call(stranger, "GET", `/v1/accounts/${id}/closing?closedOn=${TODAY}`);
      const close = await call(stranger, "POST", `/v1/accounts/${id}/close`, {
        closedOn: TODAY,
        settlement: { kind: "adjustment" },
      });
      const reopen = await call(stranger, "POST", `/v1/accounts/${id}/reopen`);
      for (const res of [preview, close, reopen]) {
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
        expect(res.body).not.toContain("430");
      }
    }
    // A scoped member of the same space: refused by the permission before anything is read — no balance, no account.
    for (const scoped of [
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ]) {
      const preview = await call(
        space,
        "GET",
        `/v1/accounts/${acc.id}/closing?closedOn=${TODAY}`,
        undefined,
        scoped,
      );
      const close = await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY }, scoped);
      const update = await call(
        space,
        "POST",
        `/v1/accounts/${acc.id}/balance`,
        { balance: { amount: "1.00", currency: "EUR" } },
        scoped,
      );
      for (const res of [preview, close, update]) {
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain("430");
      }
    }
    expect((await call(space, "GET", `/v1/accounts/${acc.id}`)).json().status).toBe("active");
    expect((await entries(space.householdId)).map((e) => e.event_type)).toEqual(["opening-balance"]);
  });
});

describe("FIN-12@PoC FR 14, FIN-04@PoC FR 10, FR 11: «Оновити залишок»", () => {
  it("FIN-12@PoC AC13: an imported account at 5 200,00 €, 5 150,00 € entered — «Коригування залишку» −50,00 € against «Коригування», the balance 5 150,00 €, no income or spending", async () => {
    const space = await newSpace();
    const mono = await createAccount(space, { kind: "current", name: "monobank", amount: "5200.00" });
    await markImported(space, mono.id);

    const res = await call(space, "POST", `/v1/accounts/${mono.id}/balance`, {
      balance: { amount: "5150.00", currency: "EUR" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      changed: true,
      balance: { amount: "5150", currency: "EUR" },
      adjustment: { amount: { amount: "-50", currency: "EUR" }, date: TODAY, permanent: false },
    });
    // Against «Коригування», not «Зовнішні кошти» (income and spending): the budget's projections leave it out.
    expect(await serviceSides(space.householdId, body.adjustment.id)).toEqual(["adjustment"]);
    const view = (await call(space, "GET", `/v1/accounts/${mono.id}`)).json();
    expect(view.currencies[0].balance).toEqual({ amount: "5150", currency: "EUR" });
    expect(view.adjustments).toEqual([
      {
        id: body.adjustment.id,
        currency: "EUR",
        amount: { amount: "-50", currency: "EUR" },
        date: TODAY,
        permanent: false,
      },
    ]);
  });

  it("FIN-12@PoC AC14: «Готівка» at 300,00 € with an adjustment of −20,00 € — 250,00 € makes the same adjustment −70,00 €, no new one", async () => {
    const space = await newSpace();
    const cash = await createAccount(space, { kind: "cash", name: "Готівка", amount: "320.00" });
    const first = (
      await call(space, "POST", `/v1/accounts/${cash.id}/balance`, {
        balance: { amount: "300.00", currency: "EUR" },
      })
    ).json();
    expect(first.adjustment).toMatchObject({ amount: { amount: "-20", currency: "EUR" }, permanent: true });

    const second = await call(space, "POST", `/v1/accounts/${cash.id}/balance`, {
      balance: { amount: "250.00", currency: "EUR" },
    });
    expect(second.json()).toMatchObject({
      changed: true,
      balance: { amount: "250", currency: "EUR" },
      adjustment: { amount: { amount: "-70", currency: "EUR" }, permanent: true },
    });
    // One live adjustment: the first one reversed, its replacement posted (the journal is only appended to).
    // The reversal and its replacement are one transaction: one time of recording, so their order is not asserted.
    const kinds = (await entries(space.householdId)).map((e) => e.event_type);
    expect(kinds.slice(0, 2)).toEqual(["opening-balance", "balance-adjustment"]);
    expect(kinds.slice(2).sort()).toEqual(["balance-adjustment", "reversal"]);
    const live = await ledger.liveEntries(
      space.householdId,
      { module: "accounts", id: cash.subaccountId },
      "balance-adjustment",
    );
    expect(live.map((e) => e.id)).toEqual([second.json().adjustment.id]);
    expect(
      await auditActions(space.householdId, { type: "accounts.balance-adjustment", id: cash.subaccountId }),
    ).toEqual(["create", "update"]);
  });

  it("FIN-12@PoC AC16: 5 200,00 € entered on a balance of 5 200,00 € — no transaction", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", amount: "5200.00" });
    const res = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "5200.00", currency: "EUR" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      changed: false,
      adjustment: null,
      balance: { amount: "5200", currency: "EUR" },
    });
    expect((await entries(space.householdId)).map((e) => e.event_type)).toEqual(["opening-balance"]);
    expect(
      await auditActions(space.householdId, { type: "accounts.balance-adjustment", id: acc.subaccountId }),
    ).toEqual([]);
  });

  it("FIN-12@PoC FR 15: «Кредит» — the debt is updated the same way; an unknown currency or a bad amount is refused", async () => {
    const space = await newSpace();
    const loan = await createAccount(space, { kind: "loan", name: "Кредит", amount: "1200.00" });
    const res = await call(space, "POST", `/v1/accounts/${loan.id}/balance`, {
      balance: { amount: "1150.00", currency: "EUR" },
    });
    expect(res.json()).toMatchObject({
      balance: { amount: "-1150", currency: "EUR" },
      adjustment: { amount: { amount: "50", currency: "EUR" } },
    });
    for (const balance of [
      { amount: "1.00", currency: "USD" },
      { amount: "-1.00", currency: "EUR" },
      { amount: "1.001", currency: "EUR" },
    ]) {
      const bad = await call(space, "POST", `/v1/accounts/${loan.id}/balance`, { balance });
      expect(bad.statusCode).toBe(400);
    }
  });

  it("FIN-12@PoC AC17: «Оновити залишок» from a user outside the space is «not found» and tells nothing", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", amount: "5200.00" });
    const own = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "5100.00", currency: "EUR" },
    });
    const adjustmentId = own.json().adjustment.id as string;
    for (const id of [acc.id, randomUUID()]) {
      const res = await call(stranger, "POST", `/v1/accounts/${id}/balance`, {
        balance: { amount: "1.00", currency: "EUR" },
      });
      const del = await call(stranger, "DELETE", `/v1/accounts/${id}/balance-adjustments/${adjustmentId}`);
      for (const r of [res, del]) {
        expect(r.statusCode).toBe(404);
        expect(r.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
        expect(r.body).not.toMatch(/5100|5200/);
      }
    }
    expect(await balance(space, acc.id)).toEqual({ amount: "5100", currency: "EUR" });
  });
});

describe("FIN-04@PoC FR 10, FR 11: the adjustment of «Оновити залишок» on a manual account", () => {
  it("FIN-04@PoC AC5: a manual account at 3 150 EUR, 3 100 EUR entered — a −50 EUR «Коригування» transaction outside budget spending, the balance 3 100 EUR", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Ручний", amount: "3150.00" });
    const res = await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "3100.00", currency: "EUR" },
    });
    expect(res.json()).toMatchObject({
      balance: { amount: "3100", currency: "EUR" },
      adjustment: { amount: { amount: "-50", currency: "EUR" }, date: TODAY, permanent: true },
    });
    const entry = (await entries(space.householdId)).find((e) => e.event_type === "balance-adjustment")!;
    expect(await serviceSides(space.householdId, entry.id)).toEqual(["adjustment"]);
  });

  it("FIN-04@PoC AC7: deleting the −50 EUR adjustment reverses its posting, the balance is 3 150 EUR again, and the audit log has its creation and deletion", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Ручний", amount: "3150.00" });
    const made = (
      await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
        balance: { amount: "3100.00", currency: "EUR" },
      })
    ).json();

    const del = await call(
      space,
      "DELETE",
      `/v1/accounts/${acc.id}/balance-adjustments/${made.adjustment.id}`,
    );
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ balance: { amount: "3150", currency: "EUR" } });
    const journal = await entries(space.householdId);
    expect(journal.map((e) => [e.event_type, e.reverses_entry_id])).toEqual([
      ["opening-balance", null],
      ["balance-adjustment", null],
      ["reversal", made.adjustment.id],
    ]);
    expect(
      await auditActions(space.householdId, { type: "accounts.balance-adjustment", id: acc.subaccountId }),
    ).toEqual(["create", "delete"]);
    const [created, deleted] = await audit.entriesFor(space.householdId, {
      type: "accounts.balance-adjustment",
      id: acc.subaccountId,
    });
    expect(created!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "amount", before: null, after: "-50" })]),
    );
    expect(deleted!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "amount", before: "-50", after: null })]),
    );
    // Gone: a second deletion and the view say so.
    const again = await call(
      space,
      "DELETE",
      `/v1/accounts/${acc.id}/balance-adjustments/${made.adjustment.id}`,
    );
    expect(again.statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/accounts/${acc.id}`)).json().adjustments).toEqual([]);
  });
});

describe("FIN-12@PoC FR 15: the statement recounts a temporary adjustment", () => {
  it("FIN-12@PoC AC15: 1 000,00 € without the adjustment, +40,00 €, a statement ending at 1 040,00 € with no new transactions — +40,00 € dated the statement's end", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Імпорт", amount: "1000.00" });
    await markImported(space, acc.id);
    await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "1040.00", currency: "EUR" },
    });

    const result = await statements.reconcile(space.householdId, {
      accountId: acc.id,
      statementEnd: "2026-10-16",
      closingBalance: Money.of("1040.00", "EUR"),
    });
    expect(result).toEqual({ kind: "changed" });
    const view = (await call(space, "GET", `/v1/accounts/${acc.id}`)).json();
    expect(view.currencies[0].balance).toEqual({ amount: "1040", currency: "EUR" });
    expect(view.adjustments).toEqual([
      expect.objectContaining({
        amount: { amount: "40", currency: "EUR" },
        date: "2026-10-16",
        permanent: false,
      }),
    ]);
    const [, recount] = await audit.entriesFor(space.householdId, {
      type: "accounts.balance-adjustment",
      id: acc.subaccountId,
    });
    expect(recount).toMatchObject({ action: "update", channel: "import", actorKind: "system" });
  });

  it("FIN-12@PoC FR 15: a zero difference removes it; a manual account's adjustment is permanent", async () => {
    const space = await newSpace();
    const imported = await createAccount(space, { kind: "current", name: "Імпорт", amount: "1000.00" });
    await markImported(space, imported.id);
    await call(space, "POST", `/v1/accounts/${imported.id}/balance`, {
      balance: { amount: "1040.00", currency: "EUR" },
    });
    expect(
      await statements.reconcile(space.householdId, {
        accountId: imported.id,
        statementEnd: "2026-10-16",
        closingBalance: Money.of("1000.00", "EUR"),
      }),
    ).toEqual({ kind: "deleted" });
    expect(await balance(space, imported.id)).toEqual({ amount: "1000", currency: "EUR" });

    const manual = await createAccount(space, { kind: "cash", name: "Готівка", amount: "300.00" });
    await call(space, "POST", `/v1/accounts/${manual.id}/balance`, {
      balance: { amount: "280.00", currency: "EUR" },
    });
    expect(
      await statements.reconcile(space.householdId, {
        accountId: manual.id,
        statementEnd: "2026-10-16",
        closingBalance: Money.of("300.00", "EUR"),
      }),
    ).toEqual({ kind: "permanent" });
    expect(await balance(space, manual.id)).toEqual({ amount: "280", currency: "EUR" });
  });
});

describe("FIN-12@PoC FR 14: the ledger's reads for managing an account stay in the space", () => {
  it("FIN-12@PoC FR 14: liveEntries and latestOperationDate see only the space's own entries; an unknown event type is refused", async () => {
    const space = await newSpace();
    const other = await newSpace();
    const acc = await createAccount(space, { kind: "cash", name: "Готівка", amount: "300.00" });
    await call(space, "POST", `/v1/accounts/${acc.id}/balance`, {
      balance: { amount: "280.00", currency: "EUR" },
    });
    const source = { module: "accounts", id: acc.subaccountId };

    expect(await ledger.liveEntries(space.householdId, source, "balance-adjustment")).toHaveLength(1);
    expect(await ledger.liveEntries(other.householdId, source, "balance-adjustment")).toEqual([]);
    await expect(
      ledger.liveEntries(space.householdId, source, "no-such-event" as "transaction"),
    ).rejects.toMatchObject({ code: "UNKNOWN_EVENT_TYPE" });

    expect(await ledger.latestOperationDate(space.householdId, acc.ledgerAccountId)).toBe(TODAY);
    await expect(ledger.latestOperationDate(other.householdId, acc.ledgerAccountId)).rejects.toMatchObject({
      code: "UNKNOWN_ACCOUNT",
    });
    const fresh = await createAccount(space, { kind: "cash", name: "Порожня", amount: "0.00" });
    expect(await ledger.latestOperationDate(space.householdId, fresh.ledgerAccountId)).toBeNull();
  });
});
