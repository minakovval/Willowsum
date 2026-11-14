import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../../api.ts";
import { buildServer } from "../../platform/process/server.ts";
import { localKeyManagement } from "../../platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog, type AuditLog } from "../audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../household/index.ts";
import { createLedger } from "../ledger/index.ts";
import { createLiabilities } from "../liabilities/index.ts";
import { createAccountsServices } from "./index.ts";

/**
 * FIN-01@PoC, server side (wave 2 row 11), through the real API on a real PostgreSQL: «Новий рахунок» creates the
 * account with one ledger event «Початковий залишок» per currency, the Owner with 100 %, a loan's and a card's terms
 * in `liabilities`, the number sealed and shown by its last 4 characters, the duplicate rule, the audit entry, and only
 * the session's own space. The session is the test's principal header; every name, number and amount is synthetic.
 */
const WEB = "http://localhost:5173";
/** «Today» of these tests: FIN-01 AC3 is on 2026-10-17. */
const NOW = Date.parse("2026-10-17T10:00:00Z");
/** Synthetic IBANs with a valid check (ISO 13616); the first two end in 1234. */
const IBAN = "UA113223130000026007233561234";
const OTHER_IBAN_1234 = "UA593223130000026007233571234";
const IBAN_PL = "PL61109010140000071219812874";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(displayName = "Олена Синтетична"): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST",
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

const create = (space: Space, body: unknown, principal: { role?: string; scoped?: boolean } = {}) =>
  call(space, "POST", "/v1/accounts", body, principal);
const duplicateCheck = (space: Space, body: unknown) =>
  call(space, "POST", "/v1/accounts/duplicate-check", body);

const current = {
  kind: "current",
  name: "Щоденний",
  institution: { name: "ПриватБанк", country: "UA" },
  balance: { amount: "1000.00", currency: "EUR" },
  balanceDate: "2026-10-01",
};

async function count(table: string, householdId: string): Promise<number> {
  const { rows } = await db.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE household_id = $1`, [
    householdId,
  ]);
  return (rows[0] as { n: number }).n;
}

async function openingEntries(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT e.source_module, e.source_id, e.event_type, e.operation_date::text AS operation_date
       FROM ledger.entries e WHERE e.household_id = $1 ORDER BY e.operation_date, e.id`,
    [householdId],
  );
  return rows as { source_module: string; source_id: string; event_type: string; operation_date: string }[];
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          ledger: createLedger(db.databases.for("ledger")),
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          audit,
          clock: { now: () => NOW },
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

beforeEach(() => off.clear());
afterEach(() => vi.restoreAllMocks());

describe("FIN-01@PoC FR 1, FR 7: an account is created with one ledger event «Початковий залишок»", () => {
  it("FIN-01@PoC AC1: type, institution, country, currency and balance on a date: one opening event, the balance as entered, the Owner at 100 %", async () => {
    const space = await newSpace();
    const res = await create(space, current);
    expect(res.statusCode).toBe(201);
    const account = res.json();
    expect(account).toMatchObject({
      kind: "current",
      group: "cash",
      name: "Щоденний",
      institution: { name: "ПриватБанк", country: "UA" },
      number: null,
      status: "active",
      source: "manual",
      openedOn: "2026-10-01",
      currencies: [
        { currency: "EUR", balance: { amount: "1000", currency: "EUR" }, balanceDate: "2026-10-01" },
      ],
      owners: [{ ownerAccountId: space.accountId, share: "100", validFrom: "2026-10-01", validTo: null }],
    });

    const entries = await openingEntries(space.householdId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_module: "accounts",
      event_type: "opening-balance",
      operation_date: "2026-10-01",
    });

    const read = await call(space, "GET", `/v1/accounts/${account.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(account);
  });

  it("FIN-01@PoC FR 7: a zero opening balance writes no ledger event; the balance is 0", async () => {
    const space = await newSpace();
    const res = await create(space, { ...current, balance: { amount: "0.00", currency: "EUR" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().currencies[0].balance).toEqual({ amount: "0", currency: "EUR" });
    expect(await openingEntries(space.householdId)).toEqual([]);
  });

  it("FIN-01@PoC FR 7: a repeated create with the same Idempotency-Key creates one account", async () => {
    const space = await newSpace();
    const key = randomUUID();
    const first = await call(space, "POST", "/v1/accounts", current, {}, { "idempotency-key": key });
    const again = await call(space, "POST", "/v1/accounts", current, {}, { "idempotency-key": key });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect(await count("accounts.accounts", space.householdId)).toBe(1);
    expect(await openingEntries(space.householdId)).toHaveLength(1);
  });
});

describe("FIN-01@PoC FR 5: «Додати рахунок» is refused until the required fields are filled", () => {
  it("FIN-01@PoC AC2: without a name or a currency no account is created (400; nothing written)", async () => {
    const space = await newSpace();
    for (const body of [
      { ...current, name: "" },
      { ...current, name: "   " },
      { ...current, balance: { amount: "10", currency: "" } },
      { kind: "current", balance: { amount: "10", currency: "EUR" }, balanceDate: "2026-10-01" },
    ]) {
      const res = await create(space, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(await count("accounts.accounts", space.householdId)).toBe(0);
    expect(await openingEntries(space.householdId)).toEqual([]);
  });

  it("FIN-01@PoC FR 5: a loan without its rate or monthly payment is refused; nothing in accounts, ledger or liabilities", async () => {
    const space = await newSpace();
    const res = await create(space, {
      kind: "loan",
      name: "Іпотека",
      balance: { amount: "120000.00", currency: "EUR" },
      balanceDate: "2026-10-01",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      { in: "body", path: "annualRate", issue: "required" },
      { in: "body", path: "monthlyPayment", issue: "required" },
    ]);
    expect(await count("accounts.accounts", space.householdId)).toBe(0);
    expect(await count("liabilities.liabilities", space.householdId)).toBe(0);
    expect(await openingEntries(space.householdId)).toEqual([]);
  });
});

describe("FIN-01@PoC FR 6: the Owner of the space owns every new account with 100 %", () => {
  it("FIN-01@PoC AC17: no «Власники» in the form; the account has one owner, the Owner, with 100 % from its opening date", async () => {
    const space = await newSpace();
    const withOwners = await create(space, {
      ...current,
      owners: [{ accountId: randomUUID(), share: "50" }],
    });
    expect(withOwners.statusCode).toBe(400);
    const res = await create(space, current);
    expect(res.json().owners).toEqual([
      { ownerAccountId: space.accountId, share: "100", validFrom: "2026-10-01", validTo: null },
    ]);
  });

  it("FIN-01@PoC FR 6: the database refuses owners' shares above 100 % on any date", async () => {
    const space = await newSpace();
    const { id } = (await create(space, current)).json();
    const extra = db.databases.for("accounts").inHousehold(space.householdId, (q) =>
      q.query(
        `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
         VALUES ($1, $2, $3, 1, '2026-12-01')`,
        [space.householdId, id, randomUUID()],
      ),
    );
    await expect(extra).rejects.toMatchObject({ code: "23514" });
  });
});

describe("FIN-01@PoC FR 2, FR 16: credit cards and loans are «Кредитні» liabilities", () => {
  it("FIN-01@PoC AC8: a card with a debt of 1 200 EUR and a limit of 5 000 EUR: debt −1 200, limit 5 000, available 3 800; the ledger holds a liability of 1 200", async () => {
    const space = await newSpace();
    const res = await create(space, {
      kind: "credit-card",
      name: "Кредитка",
      institution: { name: "Синтетичний банк", country: "UA" },
      balance: { amount: "1200.00", currency: "EUR" },
      balanceDate: "2026-10-01",
      creditLimit: "5000.00",
      gracePeriodDays: 55,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: "credit-card",
      group: "credit",
      currencies: [{ balance: { amount: "-1200", currency: "EUR" } }],
      creditCard: {
        creditLimit: { amount: "5000", currency: "EUR" },
        gracePeriodDays: 55,
        debt: { amount: "1200", currency: "EUR" },
        available: { amount: "3800", currency: "EUR" },
      },
      loan: null,
    });
    // The debt lowers net worth: a liability of 1 200 in the journal (net worth itself is row 12).
    const { rows } = await db.owner.query(
      `SELECT a.type, p.amount::text AS amount FROM ledger.postings p
         JOIN ledger.accounts a ON a.household_id = p.household_id AND a.id = p.credit_account_id
        WHERE p.household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([{ type: "liability", amount: "1200.000000000000000000" }]);
    expect(await count("liabilities.liabilities", space.householdId)).toBe(1);
  });

  it("FIN-01@PoC AC18: «Іпотека» with a debt of 120 000,00 €, 4,2 % and 650,00 € a month is a «Кредитні» loan with its terms", async () => {
    const space = await newSpace();
    const res = await create(space, {
      kind: "loan",
      name: "Іпотека",
      balance: { amount: "120000.00", currency: "EUR" },
      balanceDate: "2026-10-01",
      annualRate: "4.2",
      monthlyPayment: "650.00",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: "loan",
      group: "credit",
      name: "Іпотека",
      currencies: [{ balance: { amount: "-120000", currency: "EUR" } }],
      loan: {
        annualRate: "4.2",
        monthlyPayment: { amount: "650", currency: "EUR" },
        debt: { amount: "120000", currency: "EUR" },
      },
      creditCard: null,
    });
    const { rows } = await db.owner.query(
      `SELECT kind, account_id, annual_rate::text AS rate, monthly_payment::text AS payment FROM liabilities.liabilities
        WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows).toEqual([
      {
        kind: "loan",
        account_id: res.json().id,
        rate: "4.200000000000000000",
        payment: "650.000000000000000000",
      },
    ]);
  });
});

describe("FIN-01@PoC FR 8, FR 9: a deposit and its interest «розрахунково»", () => {
  it("FIN-01@PoC AC3: 10 000 EUR from 2026-01-01 at 3,5 % to 2027-01-01, today 2026-10-17: 277,12 EUR accrued and 76 days left", async () => {
    const space = await newSpace();
    const res = await create(space, {
      kind: "deposit",
      name: "Депозит",
      balance: { amount: "10000.00", currency: "EUR" },
      balanceDate: "2026-01-01",
      annualRate: "3.5",
      depositOpenedOn: "2026-01-01",
      depositMaturesOn: "2027-01-01",
    });
    expect(res.statusCode).toBe(201);
    const { deposit } = res.json();
    expect(deposit).toMatchObject({
      annualRate: "3.5",
      openedOn: "2026-01-01",
      maturesOn: "2027-01-01",
      accrual: { days: 289, daysToMaturity: 76, matured: false },
    });
    expect(deposit.accrual.accrued.amount.slice(0, 6)).toBe("277.12");
  });
});

describe("FIN-01@PoC FR 12: a multi-currency current account has a subaccount per currency", () => {
  it("FIN-01@PoC FR 12: 1 000 EUR and «+ додати ще валюту» 4 300 UAH: two subaccounts, each with its ledger account and opening event", async () => {
    const space = await newSpace();
    const res = await create(space, {
      ...current,
      extraCurrencies: [{ amount: "4300.00", currency: "UAH", date: "2026-10-02" }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().currencies).toEqual([
      { currency: "EUR", balance: { amount: "1000", currency: "EUR" }, balanceDate: "2026-10-01" },
      { currency: "UAH", balance: { amount: "4300", currency: "UAH" }, balanceDate: "2026-10-02" },
    ]);
    expect(await count("accounts.subaccounts", space.householdId)).toBe(2);
    expect((await openingEntries(space.householdId)).map((e) => e.operation_date)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

describe("FIN-01@PoC business rule: the IBAN is kept sealed and shown only by its last 4 characters", () => {
  it("FIN-01@PoC AC7: the card of the account and the audit log show only «••1234»; the full IBAN is in no answer, row or log", async () => {
    const space = await newSpace();
    const written: string[] = [];
    for (const stream of [process.stdout, process.stderr])
      vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    const res = await create(space, { ...current, balance: { amount: "10", currency: "UAH" }, number: IBAN });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(res.json().number).toEqual({ last4: "1234", masked: "••1234" });
    const read = await call(space, "GET", `/v1/accounts/${id}`);
    vi.restoreAllMocks();
    for (const body of [res.body, read.body]) expect(body).not.toContain("26007233561234");
    expect(written.join("")).not.toContain("26007233561234");

    const { rows } = await db.owner.query(
      `SELECT number_last4, number_sealed FROM accounts.accounts WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows[0]).toMatchObject({ number_last4: "1234" });
    expect((rows[0] as { number_sealed: string }).number_sealed).toMatch(/^ws1\./);
    const dump = await db.owner.query(
      `SELECT (SELECT string_agg(t::text, '|') FROM accounts.accounts t WHERE household_id = $1) AS a,
              (SELECT string_agg(t::text, '|') FROM accounts.idempotency_keys t WHERE household_id = $1) AS i`,
      [space.householdId],
    );
    expect(JSON.stringify(dump.rows)).not.toContain("26007233561234");

    const [entry] = await audit.entriesFor(space.householdId, { type: "accounts.account", id });
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: "number", before: null, after: "•••", masked: true },
        { field: "numberLast4", before: null, after: "••1234", masked: false },
      ]),
    );
    expect(JSON.stringify(entry)).not.toContain("26007233561234");
  });

  it("FIN-01@PoC AC7: a full payment card number is refused and stored nowhere", async () => {
    const space = await newSpace();
    const res = await create(space, { ...current, kind: "credit-card", number: "4111 1111 1111 1111" });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "number", issue: "card_number_not_allowed" }]);
    expect(res.body).not.toContain("4111");
    expect(await count("accounts.accounts", space.householdId)).toBe(0);
  });
});

describe("FIN-01@PoC FR 17: creating an account is written to the audit log", () => {
  it("FIN-01@PoC FR 17: the entry has the Owner as actor and every field's new value", async () => {
    const space = await newSpace();
    const { id } = (await create(space, { ...current, note: "Синтетична нотатка" })).json();
    const entries = await audit.entriesFor(space.householdId, { type: "accounts.account", id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorKind: "user", actorId: space.accountId, action: "create" });
    expect(entries[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "kind", before: null, after: "current", masked: false },
        { field: "name", before: null, after: "Щоденний", masked: false },
        { field: "institutionName", before: null, after: "ПриватБанк", masked: false },
        { field: "currencies.0.openingBalance", before: null, after: "1000", masked: false },
        { field: "owners.0.share", before: null, after: "100", masked: false },
        // The note is free text: masked.
        { field: "note", before: null, after: "•••", masked: true },
      ]),
    );
  });
});

describe("FIN-01@PoC FR 25: an account that duplicates one in the space cannot be created", () => {
  const privat = (body: object = {}) => ({
    ...current,
    name: "Гривневий",
    balance: { amount: "100.00", currency: "UAH" },
    number: IBAN,
    ...body,
  });

  it("FIN-01@PoC AC15: «ПриватБанк» with an IBAN ending in 1234 in UAH: the check names «ПриватБанк ••1234», creating it again is refused", async () => {
    const space = await newSpace();
    const existing = (await create(space, privat())).json();
    const check = await duplicateCheck(space, {
      institution: { name: "ПриватБанк", country: "UA" },
      number: IBAN,
      currencies: ["UAH"],
    });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual({
      duplicate: { accountId: existing.id, institution: "ПриватБанк", maskedNumber: "••1234" },
    });

    const again = await create(space, privat({ name: "Інша назва" }));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "ACCOUNT_DUPLICATE" });
    expect(await count("accounts.accounts", space.householdId)).toBe(1);
    expect(await openingEntries(space.householdId)).toHaveLength(1);
  });

  it("FIN-01@PoC FR 25: another currency, another IBAN with the same last 4 or another institution is not a duplicate; the last 4 alone match a kept IBAN", async () => {
    const space = await newSpace();
    await create(space, privat());
    const probe = (body: object) =>
      duplicateCheck(space, {
        institution: { name: "ПриватБанк", country: "UA" },
        number: IBAN,
        currencies: ["UAH"],
        ...body,
      });
    expect((await probe({ currencies: ["EUR"] })).json()).toEqual({ duplicate: null });
    expect((await probe({ number: OTHER_IBAN_1234 })).json()).toEqual({ duplicate: null });
    expect((await probe({ institution: { name: "Синтетичний банк", country: "UA" } })).json()).toEqual({
      duplicate: null,
    });
    expect((await probe({ number: IBAN_PL })).json()).toEqual({ duplicate: null });
    expect((await probe({ number: "1234" })).json().duplicate).toMatchObject({ maskedNumber: "••1234" });
    expect(
      (await probe({ institution: { name: "приватбанк", country: "UA" } })).json().duplicate,
    ).not.toBeNull();
    expect((await create(space, privat({ number: OTHER_IBAN_1234 }))).statusCode).toBe(201);
  });

  it("FIN-01@PoC FR 25: two simultaneous creates of the same account give one account and one refusal", async () => {
    const space = await newSpace();
    const results = await Promise.all([create(space, privat()), create(space, privat())]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await count("accounts.accounts", space.householdId)).toBe(1);
  });
});

describe("FIN-01@PoC «Права доступу»: the Owner works with accounts; nobody else learns about them", () => {
  it("FIN-01@PoC AC9: the Owner creates and reads accounts", async () => {
    const space = await newSpace();
    const res = await create(space, current, { role: "owner" });
    expect(res.statusCode).toBe(201);
    expect(
      (await call(space, "GET", `/v1/accounts/${res.json().id}`, undefined, { role: "owner" })).statusCode,
    ).toBe(200);
  });

  it.each(["viewer", "advisor"])(
    "FIN-01@PoC AC9: a %s may not create an account (403); nothing written",
    async (role) => {
      const space = await newSpace();
      expect((await create(space, current, { role })).statusCode).toBe(403);
      expect(await count("accounts.accounts", space.householdId)).toBe(0);
    },
  );

  it("FIN-01@PoC AC9: a scoped member may neither create nor probe for duplicates (403)", async () => {
    const space = await newSpace();
    expect((await create(space, current, { role: "editor", scoped: true })).statusCode).toBe(403);
    const probe = await call(
      space,
      "POST",
      "/v1/accounts/duplicate-check",
      { number: IBAN, currencies: ["UAH"] },
      { role: "editor", scoped: true },
    );
    expect(probe.statusCode).toBe(403);
  });

  it("FIN-01@PoC AC10: an account of another space is «not found», like an id that does not exist", async () => {
    const a = await newSpace();
    const b = await newSpace("Петро Інший");
    const { id } = (await create(a, current)).json();
    const foreign = await call(b, "GET", `/v1/accounts/${id}`);
    const unknown = await call(b, "GET", `/v1/accounts/${randomUUID()}`);
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    expect(strip(foreign.body)).toEqual(strip(unknown.body));
    expect(foreign.body).not.toContain("Щоденний");
  });

  it("FIN-01@PoC AC11: creating from another space writes only into that space and its duplicate check never sees this one's accounts", async () => {
    const a = await newSpace();
    const b = await newSpace("Петро Інший");
    const created = (
      await create(a, { ...current, balance: { amount: "1", currency: "UAH" }, number: IBAN })
    ).json();
    const check = await duplicateCheck(b, {
      institution: { name: "ПриватБанк", country: "UA" },
      number: IBAN,
      currencies: ["UAH"],
    });
    expect(check.json()).toEqual({ duplicate: null });
    const theirs = await create(b, { ...current, balance: { amount: "1", currency: "UAH" }, number: IBAN });
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().id).not.toBe(created.id);
    expect(await count("accounts.accounts", a.householdId)).toBe(1);
    expect(await count("accounts.accounts", b.householdId)).toBe(1);
  });

  it("FIN-01@PoC «Ліміти плану»: the flag accounts.manual off: every route answers 404 as if absent; nothing written", async () => {
    const space = await newSpace();
    off.add("accounts.manual");
    expect((await create(space, current)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/accounts/${randomUUID()}`)).statusCode).toBe(404);
    expect((await duplicateCheck(space, { number: IBAN, currencies: ["UAH"] })).statusCode).toBe(404);
    expect(await count("accounts.accounts", space.householdId)).toBe(0);
  });
});
