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

/**
 * FIN-12@PoC b) (wave 2 row 13 b): «Налаштування» → «Основне» through the real API on a real PostgreSQL — renaming an
 * account and changing its kind within its group, «Кредит» ↔ «Кредитна картка» only without transactions, the journal
 * untouched, the audit entry with every value before and after, and no way to change the owner or the share. Every
 * name and amount is synthetic; the session is the test's principal header.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let liabilities: Liabilities;
let app: ReturnType<typeof buildServer>;
let flagOff: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

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
  readonly subaccountId: string;
  readonly ledgerAccountId: string;
}

async function createAccount(space: Space, body: Record<string, unknown>): Promise<Created> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2024-10-01", ...body });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const { rows } = await db.owner.query(
    `SELECT id, ledger_account_id FROM accounts.subaccounts WHERE household_id = $1 AND account_id = $2
      ORDER BY position`,
    [space.householdId, id],
  );
  const row = rows[0] as { id: string; ledger_account_id: string };
  return { id, subaccountId: row.id, ledgerAccountId: row.ledger_account_id };
}

const eur = (amount: string) => ({ amount, currency: "EUR" });
const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();
const patch = (space: Space, id: string, body: unknown, principal?: { role?: string; scoped?: boolean }) =>
  call(space, "PATCH", `/v1/accounts/${id}`, body, principal);

/** Every entry and posting of the space, as stored. */
async function journal(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT e.id, e.event_type, e.operation_date::text AS day, e.reverses_entry_id,
            p.debit_account_id, p.credit_account_id, p.amount::text AS amount, p.currency
       FROM ledger.entries e JOIN ledger.postings p ON p.household_id = e.household_id AND p.entry_id = e.id
      WHERE e.household_id = $1 ORDER BY e.recorded_at, e.id, p.debit_account_id`,
    [householdId],
  );
  return rows;
}

const updates = async (householdId: string, type: string, id: string) =>
  (await audit.entriesFor(householdId, { type, id })).filter((e) => e.action === "update");

async function postTransaction(space: Space, acc: Created, amount: string, day: string, n: number) {
  await ledger.post(space.householdId, {
    source: { module: "accounts", id: acc.subaccountId },
    idempotencyKey: `test.tx:${acc.subaccountId}:${n}`,
    operationDate: day,
    event: { type: "transaction", account: acc.ledgerAccountId, amount: Money.of(amount, "EUR") },
  });
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  const services = createAccountsServices({
    ledger,
    liabilities,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
    audit,
    clock: { now: () => NOW },
    newId: randomUUID,
  });
  const server = (flags: ReturnType<typeof fakeFlags>) =>
    buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags,
          authenticate: testAuthenticate,
          accounts: services,
          allowedOrigins: new Set([WEB]),
        }),
    });
  app = server(fakeFlags());
  flagOff = server(fakeFlags({ off: ["accounts.manual"] }));
  await Promise.all([app.ready(), flagOff.ready()]);
});

afterAll(async () => {
  await Promise.all([app?.close(), flagOff?.close()]);
  await db?.close();
});

describe("FIN-12@PoC FR 4–6: «Основне» — the name and the kind", () => {
  it("FIN-12@PoC AC1, FR 6: «monobank Чорна ··4421», 340 transactions, 2 150 EUR — renamed «Сімейний поточний» and made «Ощадний»; the transactions and their postings are unchanged, the audit log has the old and new values", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, {
      kind: "current",
      name: "monobank Чорна ··4421",
      balance: eur("450.00"),
      institution: { name: "monobank", country: "UA" },
      number: "4421",
    });
    // 340 transactions: 170 of +20,00 and 170 of −10,00 — the balance comes to 2 150,00 €.
    for (let i = 0; i < 340; i++) {
      const day = new Date(Date.UTC(2024, 9, 2 + Math.floor(i / 2))).toISOString().slice(0, 10);
      await postTransaction(space, acc, i % 2 === 0 ? "20" : "-10", day, i);
    }
    expect((await view(space, acc.id)).currencies[0].balance).toEqual(eur("2150"));
    const before = await journal(space.householdId);
    expect(before.filter((p) => p.event_type === "transaction")).toHaveLength(340);

    const res = await patch(space, acc.id, { name: "Сімейний поточний", kind: "savings" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        name: "Сімейний поточний",
        kind: "savings",
        group: "cash",
        currencies: [expect.objectContaining({ balance: eur("2150") })],
        savings: { annualRate: null },
      }),
    );
    expect(await journal(space.householdId)).toEqual(before);
    const entries = await updates(space.householdId, "accounts.account", acc.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBe(space.accountId);
    expect(entries[0]!.changes).toEqual([
      { field: "name", before: "monobank Чорна ··4421", after: "Сімейний поточний", masked: false },
      { field: "kind", before: "current", after: "savings", masked: false },
    ]);
    // The list shows the new name and kind.
    const list = (await call(space, "GET", "/v1/accounts")).json();
    expect(list.items).toEqual([expect.objectContaining({ name: "Сімейний поточний", kind: "savings" })]);
  });

  it("FIN-12@PoC AC2: «Поточний» → «Кредитна картка» is refused — «Тип можна змінити лише в межах групи»; nothing changes", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("120.00") });
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит",
      balance: eur("5000.00"),
      annualRate: "9.90",
      monthlyPayment: "310.00",
    });
    for (const [id, kind] of [
      [acc.id, "credit-card"],
      [acc.id, "loan"],
      [loan.id, "savings"],
      [loan.id, "cash"],
    ] as const) {
      const res = await patch(space, id, { name: "Інша назва", kind });
      expect([id, kind, res.statusCode]).toEqual([id, kind, 409]);
      expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_KIND_OTHER_GROUP" }));
    }
    expect(await view(space, acc.id)).toEqual(expect.objectContaining({ name: "Поточний", kind: "current" }));
    expect(await view(space, loan.id)).toEqual(expect.objectContaining({ name: "Кредит", kind: "loan" }));
    expect(await updates(space.householdId, "accounts.account", acc.id)).toEqual([]);
  });

  it("FIN-12@PoC AC11: a credit card with transactions keeps its kind — «Кредит» is refused; an adjustment of «Оновити залишок» is a transaction too", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка",
      balance: eur("300.00"),
      creditLimit: "2000.00",
    });
    await postTransaction(space, card, "-42.17", "2026-10-01", 1);
    const res = await patch(space, card.id, { kind: "loan" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_HAS_TRANSACTIONS" }));
    expect((await view(space, card.id)).kind).toBe("credit-card");
    expect((await liabilities.forAccount(space.householdId, card.id))?.kind).toBe("credit-card");

    const other = await createAccount(space, { kind: "credit-card", name: "Друга", balance: eur("50.00") });
    const adjusted = await call(space, "POST", `/v1/accounts/${other.id}/balance`, { balance: eur("60.00") });
    expect(adjusted.statusCode).toBe(200);
    expect((await patch(space, other.id, { kind: "loan" })).statusCode).toBe(409);
    expect(await updates(space.householdId, "accounts.account", card.id)).toEqual([]);
  });

  it("FIN-12@PoC AC12: a credit card without transactions becomes «Кредит», marked «Додайте ставку і платіж» until they are entered", async () => {
    const space = await newSpace();
    const card = await createAccount(space, {
      kind: "credit-card",
      name: "Картка",
      balance: eur("800.00"),
      annualRate: "36",
      creditLimit: "2000.00",
      gracePeriodDays: 55,
    });
    const before = await journal(space.householdId);
    const res = await patch(space, card.id, { kind: "loan" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        kind: "loan",
        group: "credit",
        creditCard: null,
        loan: { annualRate: "36", monthlyPayment: null, debt: eur("800"), termsMissing: true },
      }),
    );
    const list = (await call(space, "GET", "/v1/accounts")).json();
    expect(list.items[0].loan).toEqual(expect.objectContaining({ termsMissing: true }));
    // The opening balance is not a transaction, and it stays as it was.
    expect(await journal(space.householdId)).toEqual(before);
    const liability = await liabilities.forAccount(space.householdId, card.id);
    expect(liability).toEqual(
      expect.objectContaining({ kind: "loan", annualRate: "36", gracePeriodDays: null }),
    );
    const changed = await updates(space.householdId, "liabilities.liability", liability!.id);
    expect(changed.map((e) => e.changes)).toEqual([
      [
        { field: "kind", before: "credit-card", after: "loan", masked: false },
        { field: "gracePeriodDays", before: "55", after: null, masked: false },
      ],
    ]);
    expect((await updates(space.householdId, "accounts.account", card.id))[0]!.changes).toEqual([
      { field: "kind", before: "credit-card", after: "loan", masked: false },
    ]);
    // A loan with its rate and payment has no such mark.
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит",
      balance: eur("5000.00"),
      annualRate: "9.90",
      monthlyPayment: "310.00",
    });
    expect((await view(space, loan.id)).loan.termsMissing).toBe(false);
  });

  it("FIN-12@PoC FR 5: «Кредит» → «Кредитна картка» without transactions drops the monthly payment; a deleted adjustment no longer counts", async () => {
    const space = await newSpace();
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит",
      balance: eur("5000.00"),
      annualRate: "9.90",
      monthlyPayment: "310.00",
    });
    const made = await call(space, "POST", `/v1/accounts/${loan.id}/balance`, { balance: eur("4990.00") });
    expect((await patch(space, loan.id, { kind: "credit-card" })).statusCode).toBe(409);
    const adjustmentId = made.json().adjustment.id as string;
    expect(
      (await call(space, "DELETE", `/v1/accounts/${loan.id}/balance-adjustments/${adjustmentId}`)).statusCode,
    ).toBe(200);
    const res = await patch(space, loan.id, { kind: "credit-card" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        kind: "credit-card",
        loan: null,
        creditCard: expect.objectContaining({ annualRate: "9.9", creditLimit: null, debt: eur("5000") }),
      }),
    );
    expect(await liabilities.forAccount(space.householdId, loan.id)).toEqual(
      expect.objectContaining({ kind: "credit-card", monthlyPayment: null }),
    );
  });

  it("FIN-12@PoC FR 6: «Депозит» → «Ощадний» keeps the rate and drops the deposit's dates, recorded before and after; a multi-currency account stays «Поточний»", async () => {
    const space = await newSpace();
    const deposit = await createAccount(space, {
      kind: "deposit",
      name: "Депозит",
      balance: eur("1000.00"),
      annualRate: "3.50",
      depositOpenedOn: "2024-10-01",
      depositMaturesOn: "2027-10-01",
    });
    const res = await patch(space, deposit.id, { kind: "savings" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({ kind: "savings", savings: { annualRate: "3.5" }, deposit: null }),
    );
    expect((await updates(space.householdId, "accounts.account", deposit.id))[0]!.changes).toEqual([
      { field: "kind", before: "deposit", after: "savings", masked: false },
      { field: "depositOpenedOn", before: "2024-10-01", after: null, masked: false },
      { field: "depositMaturesOn", before: "2027-10-01", after: null, masked: false },
    ]);
    expect((await patch(space, deposit.id, { kind: "cash" })).json().savings).toBeNull();

    const multi = await createAccount(space, {
      kind: "current",
      name: "Мультивалютний",
      balance: eur("10.00"),
      extraCurrencies: [{ amount: "20.00", currency: "USD", date: "2024-10-01" }],
    });
    const refused = await patch(space, multi.id, { kind: "savings" });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errors).toEqual([
      expect.objectContaining({ path: "kind", issue: "multi_currency" }),
    ]);
    expect((await view(space, multi.id)).kind).toBe("current");
  });

  it("FIN-12@PoC FR 6: an invalid name is refused; the same values change nothing and write no audit entry", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "cash", name: "Готівка", balance: eur("30.00") });
    for (const name of ["", "   ", "a\nb", "я".repeat(81)]) {
      const res = await patch(space, acc.id, { name });
      expect([name, res.statusCode]).toEqual([name, 400]);
    }
    const same = await patch(space, acc.id, { name: " Готівка ", kind: "cash" });
    expect(same.statusCode).toBe(200);
    expect(same.json().name).toBe("Готівка");
    expect(await updates(space.householdId, "accounts.account", acc.id)).toEqual([]);
  });

  it("FIN-12@PoC FR 8: a closed account is read-only — no rename, no kind change", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "cash", name: "Готівка", balance: eur("0.00") });
    expect((await call(space, "POST", `/v1/accounts/${acc.id}/close`, { closedOn: TODAY })).statusCode).toBe(
      200,
    );
    const res = await patch(space, acc.id, { name: "Нова" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_CLOSED" }));
    expect((await view(space, acc.id)).name).toBe("Готівка");
  });

  it("FIN-12@PoC FR 13: the API has no way to change the owner or the share — such fields are refused and the Owner keeps 100 %", async () => {
    const space = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("10.00") });
    const owners = (await view(space, acc.id)).owners;
    expect(owners).toEqual([expect.objectContaining({ ownerAccountId: space.accountId, share: "100" })]);
    for (const body of [
      { owners: [{ ownerAccountId: randomUUID(), share: "50" }] },
      { share: "50" },
      { name: "Інша", ownerAccountId: randomUUID() },
    ]) {
      const res = await patch(space, acc.id, body);
      expect([body, res.statusCode]).toEqual([body, 400]);
    }
    expect(await view(space, acc.id)).toEqual(expect.objectContaining({ name: "Поточний", owners }));
  });
});

describe("FIN-12@PoC: who may change «Основне»", () => {
  it("FIN-12@PoC permissions of «Основне»: the Owner, an admin and an editor change it; a viewer, an advisor and every scoped member are refused; another space's account is «not found» and tells nothing", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const acc = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("431.00") });
    for (const role of ["owner", "admin", "editor"]) {
      const res = await patch(space, acc.id, { name: `Назва ${role}` }, { role, scoped: false });
      expect([role, res.statusCode]).toEqual([role, 200]);
    }
    const principals = [
      { role: "viewer", scoped: false },
      { role: "advisor", scoped: false },
      { role: "owner", scoped: true },
      { role: "admin", scoped: true },
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ];
    for (const principal of principals) {
      const res = await patch(space, acc.id, { name: "Чужа", kind: "savings" }, principal);
      expect([principal, res.statusCode]).toEqual([principal, 403]);
      expect(res.body).not.toMatch(/431|Назва/);
    }
    for (const id of [acc.id, randomUUID()]) {
      const res = await patch(stranger, id, { name: "Чужа", kind: "savings" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(res.body).not.toMatch(/431|Назва/);
    }
    const off = await callOn(flagOff, space, "PATCH", `/v1/accounts/${acc.id}`, { name: "Вимкнено" });
    expect(off.statusCode).toBeGreaterThanOrEqual(400);
    expect(await view(space, acc.id)).toEqual(
      expect.objectContaining({ name: "Назва editor", kind: "current" }),
    );
    expect(await updates(space.householdId, "accounts.account", acc.id)).toHaveLength(3);
  });

  it("FIN-12@PoC FR 5: the ledger's check of transactions sees only the space's own account", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const card = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("10.00") });
    expect(await ledger.hasLiveEntries(space.householdId, card.ledgerAccountId, ["opening-balance"])).toBe(
      false,
    );
    expect(await ledger.hasLiveEntries(space.householdId, card.ledgerAccountId, [])).toBe(true);
    await expect(
      ledger.hasLiveEntries(stranger.householdId, card.ledgerAccountId, ["opening-balance"]),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACCOUNT" });
  });
});
