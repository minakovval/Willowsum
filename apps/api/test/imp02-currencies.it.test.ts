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
import { createAccountsServices, type AccountsServices } from "../src/modules/accounts/index.ts";
import { applyHandOff, type HandOff } from "../src/modules/accounts/application/index.ts";

/**
 * IMP-02@PoC a) (wave 2 row 18): the multi-currency account as a container with a wallet (subaccount) per currency,
 * through the real API on a real PostgreSQL — «+ додати ще валюту» on an existing account with its opening balance in
 * the journal, removing a currency without transactions (its opening balance reversed), the main currency and one with
 * transactions kept, the audit entry, the wallets in the list, an existing account as a container with one wallet, and
 * who may do it. Every name and amount is synthetic; the session is the test's principal header.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-11-15";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let services: AccountsServices;
let app: ReturnType<typeof buildServer>;
let flagOff: ReturnType<typeof buildServer>;
/** When set, the ledger refuses to open accounts: the hand-off right away fails and the job stays in the queue. */
let ledgerDown = false;

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

interface Wallet {
  readonly id: string;
  readonly currency: string;
  readonly position: number;
  readonly ledgerAccountId: string;
}

async function wallets(space: Space, accountId: string): Promise<Wallet[]> {
  const { rows } = await db.owner.query(
    `SELECT id, currency, position, ledger_account_id FROM accounts.subaccounts
      WHERE household_id = $1 AND account_id = $2 ORDER BY position`,
    [space.householdId, accountId],
  );
  return rows.map((r: { id: string; currency: string; position: number; ledger_account_id: string }) => ({
    id: r.id,
    currency: r.currency,
    position: r.position,
    ledgerAccountId: r.ledger_account_id,
  }));
}

async function createAccount(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2026-10-01", ...body });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const money = (amount: string, currency: string) => ({ amount, currency });
const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();
const balances = async (space: Space, id: string) =>
  (await view(space, id)).currencies.map((c: { balance: unknown }) => c.balance);
const addCurrency = (
  space: Space,
  id: string,
  balance: { amount: string; currency: string },
  balanceDate = "2026-11-01",
  principal?: { role?: string; scoped?: boolean },
) => call(space, "POST", `/v1/accounts/${id}/wallets`, { balance, balanceDate }, principal);
const removeCurrency = (
  space: Space,
  id: string,
  currency: string,
  principal?: { role?: string; scoped?: boolean },
) => call(space, "DELETE", `/v1/accounts/${id}/wallets/${currency}`, undefined, principal);

async function postTransaction(space: Space, wallet: Wallet, amount: string, day: string) {
  await ledger.post(space.householdId, {
    source: { module: "transactions", id: randomUUID() },
    idempotencyKey: `test.tx:${randomUUID()}`,
    operationDate: day,
    event: {
      type: "transaction",
      account: wallet.ledgerAccountId,
      amount: Money.of(amount, wallet.currency),
    },
  });
}

/** Every entry and posting of the space, as stored. */
async function journal(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT e.id, e.event_type, e.operation_date::text AS day, e.reverses_entry_id, e.source_id,
            p.debit_account_id, p.credit_account_id, p.amount::text AS amount, p.currency
       FROM ledger.entries e JOIN ledger.postings p ON p.household_id = e.household_id AND p.entry_id = e.id
      WHERE e.household_id = $1 ORDER BY e.recorded_at, e.id, p.seq`,
    [householdId],
  );
  return rows;
}

const updates = async (householdId: string, id: string) =>
  (await audit.entriesFor(householdId, { type: "accounts.account", id })).filter(
    (e) => e.action === "update",
  );

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  const flaky: Ledger = {
    ...ledger,
    openAccount: (...args) => {
      if (ledgerDown) return Promise.reject(new Error("the ledger is down"));
      return ledger.openAccount(...args);
    },
  };
  services = createAccountsServices({
    walletUsage: [],
    ledger: flaky,
    liabilities: createLiabilities(db.databases.for("liabilities"), audit),
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

describe("IMP-02@PoC FR 15: «+ додати ще валюту» and removing a currency in «Основне»", () => {
  it("IMP-02@PoC AC14: an account with wallets EUR (with transactions) and PLN (without) — a currency is added with «+ додати ще валюту», PLN is removed, EUR is not; a wallet with transactions cannot be removed", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Wise Мультивалютний",
      balance: money("500.00", "EUR"),
      extraCurrencies: [{ amount: "0", currency: "PLN", date: "2026-10-01" }],
    });
    const [eurWallet] = await wallets(space, id);
    await postTransaction(space, eurWallet!, "-35.20", "2026-10-05");
    expect((await view(space, id)).currencies.map((c: { currency: string }) => c.currency)).toEqual([
      "EUR",
      "PLN",
    ]);

    const added = await addCurrency(space, id, money("4300.00", "UAH"));
    expect(added.statusCode).toBe(200);
    expect(added.json().currencies).toEqual([
      { currency: "EUR", balance: money("464.8", "EUR"), balanceDate: "2026-10-01" },
      { currency: "PLN", balance: money("0", "PLN"), balanceDate: "2026-10-01" },
      { currency: "UAH", balance: money("4300", "UAH"), balanceDate: "2026-11-01" },
    ]);

    const removed = await removeCurrency(space, id, "PLN");
    expect(removed.statusCode).toBe(200);
    expect(removed.json().currencies.map((c: { currency: string }) => c.currency)).toEqual(["EUR", "UAH"]);

    const main = await removeCurrency(space, id, "EUR");
    expect(main.statusCode).toBe(409);
    expect(main.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_MAIN_CURRENCY" }));

    // A wallet with a transaction stays, though it is not the main one.
    const uah = (await wallets(space, id)).find((w) => w.currency === "UAH")!;
    await postTransaction(space, uah, "-120.00", "2026-11-03");
    const busy = await removeCurrency(space, id, "UAH");
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_CURRENCY_HAS_TRANSACTIONS" }));
    expect(await balances(space, id)).toEqual([money("464.8", "EUR"), money("4180", "UAH")]);
  });

  it("IMP-02@PoC FR 15: an added currency is a wallet with its ledger account and «Початковий залишок» on its date; the audit entry has the currency, the balance and the date", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: money("100.00", "EUR"),
    });
    const res = await addCurrency(space, id, money("250.40", "PLN"), "2026-10-20");
    expect(res.statusCode).toBe(200);
    const pln = (await wallets(space, id))[1]!;
    expect(pln).toEqual(expect.objectContaining({ currency: "PLN", position: 1 }));
    const opening = (await journal(space.householdId)).filter((p) => p.source_id === pln.id);
    expect(opening).toEqual([
      expect.objectContaining({
        event_type: "opening-balance",
        day: "2026-10-20",
        debit_account_id: pln.ledgerAccountId,
        amount: "250.400000000000000000",
        currency: "PLN",
      }),
    ]);
    expect(await ledger.balanceAt(space.householdId, pln.ledgerAccountId, TODAY)).toEqual(
      Money.of("250.4", "PLN"),
    );
    const [entry] = await updates(space.householdId, id);
    expect(entry!.actorId).toBe(space.accountId);
    expect(entry!.changes).toEqual([
      { field: "currencies.PLN.currency", before: null, after: "PLN", masked: false },
      { field: "currencies.PLN.openingBalance", before: null, after: "250.4", masked: false },
      { field: "currencies.PLN.balanceDate", before: null, after: "2026-10-20", masked: false },
    ]);
  });

  it("IMP-02@PoC FR 15: removing a currency without transactions reverses its opening balance in the journal (nothing is deleted there) and is audited; the currency can be added again", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: money("100.00", "EUR"),
      extraCurrencies: [{ amount: "75.00", currency: "USD", date: "2026-10-02" }],
    });
    const usd = (await wallets(space, id))[1]!;
    const before = await journal(space.householdId);
    expect((await removeCurrency(space, id, "USD")).statusCode).toBe(200);
    expect(await wallets(space, id)).toHaveLength(1);
    const after = await journal(space.householdId);
    // The journal only grew: the opening balance and its reversal, dated as it was.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual([
      expect.objectContaining({
        event_type: "reversal",
        day: "2026-10-02",
        credit_account_id: usd.ledgerAccountId,
        amount: "75.000000000000000000",
      }),
    ]);
    expect((await ledger.balanceAt(space.householdId, usd.ledgerAccountId, TODAY)).isZero()).toBe(true);
    const [entry] = await updates(space.householdId, id);
    expect(entry!.changes).toEqual([
      { field: "currencies.USD.currency", before: "USD", after: null, masked: false },
      { field: "currencies.USD.openingBalance", before: "75", after: null, masked: false },
      { field: "currencies.USD.balanceDate", before: "2026-10-02", after: null, masked: false },
    ]);
    // A removed currency is unknown on the account; it can be added again as a new wallet.
    expect((await removeCurrency(space, id, "USD")).statusCode).toBe(404);
    expect((await addCurrency(space, id, money("10.00", "USD"))).statusCode).toBe(200);
    expect(await balances(space, id)).toEqual([money("100", "EUR"), money("10", "USD")]);
  });

  it("IMP-02@PoC FR 15: a removal right after an add whose hand-off has not run yet opens the wallet's ledger account and opening balance first, then reverses it; the worker's later run moves nothing", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: money("100.00", "EUR"),
    });
    ledgerDown = true;
    try {
      const res = await addCurrency(space, id, money("40.00", "GBP"));
      expect(res.statusCode).toBe(200);
      // The change is made; the wallet answers at 0 until its hand-off has opened it in the journal.
      expect(res.json().currencies.at(-1)).toEqual(expect.objectContaining({ balance: money("0", "GBP") }));
    } finally {
      ledgerDown = false;
    }
    const gbp = (await wallets(space, id))[1]!;
    expect(await journal(space.householdId).then((j) => j.filter((p) => p.source_id === gbp.id))).toEqual([]);
    const { rows: pending } = await db.owner.query(
      `SELECT payload FROM accounts.jobs WHERE household_id = $1 AND state <> 'done' AND payload->>'kind' = 'currency-changed'`,
      [space.householdId],
    );
    expect(pending).toHaveLength(1);

    expect((await removeCurrency(space, id, "GBP")).statusCode).toBe(200);
    const mine = async () => (await journal(space.householdId)).filter((p) => p.source_id === gbp.id);
    expect((await mine()).map((p) => p.event_type)).toEqual(["opening-balance", "reversal"]);

    // The worker runs the add's hand-off later: every step by its key, so nothing is posted twice.
    const handOff = pending[0]!.payload as HandOff;
    await applyHandOff(
      services.deps,
      { whileLocked: (_h, _a, work) => work("current") },
      space.householdId,
      handOff,
    );
    expect((await mine()).map((p) => p.event_type)).toEqual(["opening-balance", "reversal"]);
    expect((await ledger.balanceAt(space.householdId, gbp.ledgerAccountId, TODAY)).isZero()).toBe(true);
  });

  it("IMP-02@PoC FR 15: refusals write nothing — not a current account, a currency it has, a bad balance or date, a closed account, a duplicate of another account", async () => {
    const space = await newSpace();
    const savings = await createAccount(space, {
      kind: "savings",
      name: "Ощадний",
      balance: money("10.00", "EUR"),
    });
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: money("100.00", "EUR"),
      institution: { name: "Синтетичний банк", country: "UA" },
      number: "4421",
    });
    await createAccount(space, {
      kind: "current",
      name: "Гривневий",
      balance: money("900.00", "UAH"),
      institution: { name: "Синтетичний банк", country: "UA" },
      number: "4421",
    });
    const cases: [string, Promise<{ statusCode: number; json(): unknown }>, number, string, string?][] = [
      ["savings", addCurrency(space, savings, money("1.00", "PLN")), 400, "VALIDATION_FAILED", "currency"],
      [
        "duplicate currency",
        addCurrency(space, id, money("1.00", "EUR")),
        400,
        "VALIDATION_FAILED",
        "currency",
      ],
      ["too precise", addCurrency(space, id, money("1.001", "PLN")), 400, "VALIDATION_FAILED", "balance"],
      [
        "future",
        addCurrency(space, id, money("1.00", "PLN"), "2026-11-16"),
        400,
        "VALIDATION_FAILED",
        "date",
      ],
      ["early", addCurrency(space, id, money("1.00", "PLN"), "2026-09-30"), 400, "VALIDATION_FAILED", "date"],
      // The same institution and number in UAH exists already (FIN-01 FR 25).
      ["duplicate account", addCurrency(space, id, money("1.00", "UAH")), 409, "ACCOUNT_DUPLICATE"],
    ];
    for (const [name, pending, status, code, path] of cases) {
      const res = await pending;
      expect([name, res.statusCode]).toEqual([name, status]);
      expect(res.json()).toEqual(expect.objectContaining({ code }));
      if (path)
        expect((res.json() as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual([path]);
    }
    expect(await wallets(space, id)).toHaveLength(1);

    const closed = await createAccount(space, {
      kind: "current",
      name: "Старий",
      balance: money("0", "EUR"),
    });
    expect(
      (await call(space, "POST", `/v1/accounts/${closed}/close`, { closedOn: "2026-11-02" })).statusCode,
    ).toBe(200);
    for (const res of [
      await addCurrency(space, closed, money("1.00", "PLN")),
      await removeCurrency(space, closed, "EUR"),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_CLOSED" }));
    }
    expect(await updates(space.householdId, id)).toEqual([]);
  });

  it("IMP-02@PoC permissions of the currencies: the Owner, an admin and an editor change them; a viewer, an advisor and every scoped member are refused; another space's account is «not found»; the flag off refuses", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: money("431.00", "EUR"),
    });
    for (const [role, currency] of [
      ["owner", "PLN"],
      ["admin", "UAH"],
      ["editor", "USD"],
    ] as const)
      expect([
        role,
        (await addCurrency(space, id, money("1.00", currency), undefined, { role })).statusCode,
      ]).toEqual([role, 200]);
    expect([(await removeCurrency(space, id, "USD", { role: "editor" })).statusCode]).toEqual([200]);
    const principals = [
      { role: "viewer", scoped: false },
      { role: "advisor", scoped: false },
      { role: "owner", scoped: true },
      { role: "admin", scoped: true },
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ];
    for (const principal of principals) {
      const add = await addCurrency(space, id, money("2.00", "GBP"), undefined, principal);
      const remove = await removeCurrency(space, id, "PLN", principal);
      expect([principal, add.statusCode, remove.statusCode]).toEqual([principal, 403, 403]);
      expect(add.body + remove.body).not.toMatch(/431|PLN/);
    }
    for (const target of [id, randomUUID()]) {
      const add = await addCurrency(stranger, target, money("2.00", "GBP"));
      const remove = await removeCurrency(stranger, target, "PLN");
      expect([add.statusCode, remove.statusCode]).toEqual([404, 404]);
      expect(add.body + remove.body).not.toMatch(/431|PLN|Поточний/);
    }
    const off = await callOn(flagOff, space, "POST", `/v1/accounts/${id}/wallets`, {
      balance: money("2.00", "GBP"),
      balanceDate: "2026-11-01",
    });
    expect(off.statusCode).toBeGreaterThanOrEqual(400);
    const offRemove = await callOn(flagOff, space, "DELETE", `/v1/accounts/${id}/wallets/PLN`);
    expect([offRemove.statusCode, offRemove.json().code]).toEqual([off.statusCode, off.json().code]);
    expect((await view(space, id)).currencies.map((c: { currency: string }) => c.currency)).toEqual([
      "EUR",
      "PLN",
      "UAH",
    ]);
  });
});

describe("IMP-02@PoC FR 1, FR 13, FR 14: the account as a container with a wallet per currency", () => {
  it("IMP-02@PoC AC13: an existing manual account in UAH with history is a container with one UAH wallet; its balance and every transaction stay as they were, adding and removing another currency included", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Гривневий",
      balance: money("12000.00", "UAH"),
    });
    const [uah] = await wallets(space, id);
    for (let i = 0; i < 12; i++)
      await postTransaction(space, uah!, i % 3 === 0 ? "1500" : "-410.25", `2026-10-${10 + i}`);
    const adjusted = await call(space, "POST", `/v1/accounts/${id}/balance`, {
      balance: money("13000.00", "UAH"),
    });
    expect(adjusted.statusCode).toBe(200);
    const before = { view: await view(space, id), journal: await journal(space.householdId) };

    expect(await wallets(space, id)).toEqual([
      { id: uah!.id, currency: "UAH", position: 0, ledgerAccountId: uah!.ledgerAccountId },
    ]);
    expect(before.view.currencies).toEqual([
      { currency: "UAH", balance: money("13000", "UAH"), balanceDate: "2026-10-01" },
    ]);
    // Every account of the database keeps a main wallet (position 0) and at most one wallet per currency.
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS without_main FROM accounts.accounts a
        WHERE NOT EXISTS (SELECT 1 FROM accounts.subaccounts s
                           WHERE s.household_id = a.household_id AND s.account_id = a.id AND s.position = 0)`,
    );
    expect(rows).toEqual([{ without_main: 0 }]);

    expect((await addCurrency(space, id, money("0", "EUR"))).statusCode).toBe(200);
    expect((await removeCurrency(space, id, "EUR")).statusCode).toBe(200);
    expect(await view(space, id)).toEqual(before.view);
    expect(await journal(space.householdId)).toEqual(before.journal);
  });

  it("IMP-02@PoC FR 14: «Рахунки» shows every currency of each account with its balance", async () => {
    const space = await newSpace();
    const multi = await createAccount(space, {
      kind: "current",
      name: "Мультивалютний",
      balance: money("1000.00", "EUR"),
      extraCurrencies: [{ amount: "4300.00", currency: "UAH", date: "2026-10-01" }],
    });
    expect((await addCurrency(space, multi, money("250.00", "PLN"))).statusCode).toBe(200);
    const single = await createAccount(space, {
      kind: "cash",
      name: "Готівка",
      balance: money("80.00", "EUR"),
    });
    const list = (await call(space, "GET", "/v1/accounts")).json();
    const currencies = (accountId: string) =>
      list.items
        .find((i: { id: string }) => i.id === accountId)
        .currencies.map((c: { amount: unknown }) => c.amount);
    expect(currencies(multi)).toEqual([money("1000", "EUR"), money("4300", "UAH"), money("250", "PLN")]);
    expect(currencies(single)).toEqual([money("80", "EUR")]);
  });
});
