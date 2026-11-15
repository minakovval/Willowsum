import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices, NUMBER_FIELD, type NumberSeal } from "../src/modules/accounts/index.ts";

/**
 * FIN-12@PoC b) «Реквізити» (wave 2 row 14): the details of an account through the real API on a real PostgreSQL — the
 * IBAN or account number sealed with the space's key and only ever shown masked (NFR-01@PoC FR 6), in answers, rows,
 * logs and the audit log; the fields of each kind; the duplicate rule on a change; a closed account read-only; who may
 * change them. Every name, number and amount is synthetic; the session is the test's principal header.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);

/** Synthetic IBANs with a valid ISO 13616 check; their tails are what may never appear in full. */
const IBAN = "UA113223130000026007233561234";
const IBAN_TAIL = "26007233561234";
const OTHER_IBAN = "UA223052990000026001234567890";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let keys: NumberSeal;
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
  method: "GET" | "POST" | "PATCH",
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

async function createAccount(space: Space, body: Record<string, unknown>): Promise<string> {
  const res = await call(space, "POST", "/v1/accounts", { balanceDate: "2024-10-01", ...body });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const eur = (amount: string) => ({ amount, currency: "EUR" });
const view = async (space: Space, id: string) => (await call(space, "GET", `/v1/accounts/${id}`)).json();
const details = (space: Space, id: string, body: unknown, principal?: { role?: string; scoped?: boolean }) =>
  call(space, "PATCH", `/v1/accounts/${id}/details`, body, principal);
const updates = async (householdId: string, id: string) =>
  (await audit.entriesFor(householdId, { type: "accounts.account", id })).filter(
    (e) => e.action === "update",
  );

async function storedNumber(space: Space, id: string) {
  const { rows } = await db.owner.query(
    `SELECT number_last4, number_sealed, card_expires FROM accounts.accounts WHERE household_id = $1 AND id = $2`,
    [space.householdId, id],
  );
  return rows[0] as {
    number_last4: string | null;
    number_sealed: string | null;
    card_expires: string | null;
  };
}

/** Every row of the space's accounts schema and audit log as text: no full number may be in any of them. */
async function dump(householdId: string): Promise<string> {
  const { rows } = await db.owner.query(
    `SELECT (SELECT string_agg(t::text, '|') FROM accounts.accounts t WHERE household_id = $1) AS a,
            (SELECT string_agg(t::text, '|') FROM audit.entries t WHERE household_id = $1) AS e`,
    [householdId],
  );
  return JSON.stringify(rows);
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  const ledger = createLedger(db.databases.for("ledger"));
  const liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  keys = createSpaceKeys(db.databases.for("household"), audit, localKeyManagement());
  const services = createAccountsServices({
    walletUsage: [],
    ledger,
    liabilities,
    keys,
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

describe("FIN-12@PoC FR 4, NFR-01@PoC FR 6: the number in «Реквізити» is sealed and shown masked", () => {
  it("FIN-12@PoC AC9, NFR-01@PoC FR 6: the Owner opens «Реквізити» — the IBAN entered there is sealed with the space's key and shown only as «••1234», in no answer, row, log or audit entry in full", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Щоденний",
      balance: { amount: "100.00", currency: "UAH" },
      institution: { name: "ПриватБанк", country: "UA" },
      number: "9876",
    });
    const written: string[] = [];
    for (const stream of [process.stdout, process.stderr])
      vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    const res = await details(space, id, { number: IBAN });
    const read = await call(space, "GET", `/v1/accounts/${id}`);
    const list = await call(space, "GET", "/v1/accounts");
    vi.restoreAllMocks();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        institution: { name: "ПриватБанк", country: "UA" },
        number: { last4: "1234", masked: "••1234" },
      }),
    );
    expect(read.json().number).toEqual({ last4: "1234", masked: "••1234" });
    for (const body of [res.body, read.body, list.body]) expect(body).not.toContain(IBAN_TAIL);
    expect(written.join("")).not.toContain(IBAN_TAIL);

    // Sealed with the space's key (ARC-06 FR 2): only the key opens it, and no row holds it in the clear.
    const stored = await storedNumber(space, id);
    expect(stored.number_last4).toBe("1234");
    expect(stored.number_sealed).toMatch(/^ws1\./);
    expect(await keys.open(space.householdId, NUMBER_FIELD, stored.number_sealed!)).toBe(IBAN);
    expect(await dump(space.householdId)).not.toContain(IBAN_TAIL);

    // The audit log: the number masked, only «••» and the last 4 characters in the clear (NFR-01 «Маскування»).
    const entries = await updates(space.householdId, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorKind: "user", actorId: space.accountId });
    expect(entries[0]!.changes).toEqual([
      { field: "number", before: null, after: "•••", masked: true },
      { field: "numberLast4", before: "••9876", after: "••1234", masked: false },
    ]);
  });

  it("NFR-01@PoC FR 6: another IBAN is sealed anew; the same IBAN again changes nothing; clearing the number leaves nothing sealed", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "savings",
      name: "Ощадний",
      balance: eur("10.00"),
      number: IBAN,
    });
    const first = (await storedNumber(space, id)).number_sealed!;

    const same = await details(space, id, { number: IBAN.replace(/(.{4})/g, "$1 ").toLowerCase() });
    expect(same.statusCode).toBe(200);
    expect((await storedNumber(space, id)).number_sealed).toBe(first);
    expect(await updates(space.householdId, id)).toEqual([]);

    const other = await details(space, id, { number: OTHER_IBAN });
    expect(other.json().number).toEqual({ last4: "7890", masked: "••7890" });
    const second = (await storedNumber(space, id)).number_sealed!;
    expect(second).not.toBe(first);
    expect(await keys.open(space.householdId, NUMBER_FIELD, second)).toBe(OTHER_IBAN);
    // Both full numbers are sealed: the entry says only that the sealed value changed.
    expect((await updates(space.householdId, id))[0]!.changes).toEqual([
      { field: "number", before: "•••", after: "•••", masked: true },
      { field: "numberLast4", before: "••1234", after: "••7890", masked: false },
    ]);

    const cleared = await details(space, id, { number: null });
    expect(cleared.json().number).toBeNull();
    expect(await storedNumber(space, id)).toMatchObject({ number_last4: null, number_sealed: null });
    expect(await dump(space.householdId)).not.toMatch(/26007233561234|26001234567890/);
  });

  it("FIN-12@PoC FR 4: a full payment card number is refused in «Реквізити» and stored nowhere", async () => {
    const space = await newSpace();
    const id = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("20.00") });
    const res = await details(space, id, { number: "4111 1111 1111 1111" });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "number", issue: "card_number_not_allowed" }]);
    expect(res.body).not.toContain("4111");
    expect(await storedNumber(space, id)).toMatchObject({ number_last4: null, number_sealed: null });
    expect(await dump(space.householdId)).not.toContain("4111111111111111");
  });
});

describe("FIN-12@PoC FR 4: the fields of «Реквізити» by kind", () => {
  it("FIN-12@PoC FR 4: a credit card — institution, the card's last 4 digits and «Строк дії», note; the change is audited with the note masked", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "credit-card",
      name: "Кредитка",
      balance: eur("300.00"),
      creditLimit: "2000.00",
    });
    const res = await details(space, id, {
      institution: { name: "monobank", country: "UA" },
      number: "4421",
      cardExpiry: "2028-04",
      note: "Синтетична нотатка",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        institution: { name: "monobank", country: "UA" },
        number: { last4: "4421", masked: "••4421" },
        note: "Синтетична нотатка",
        creditCard: expect.objectContaining({ cardExpiry: "2028-04", creditLimit: eur("2000") }),
      }),
    );
    expect((await storedNumber(space, id)).number_sealed).toBeNull();
    expect((await updates(space.householdId, id))[0]!.changes).toEqual([
      { field: "institutionName", before: null, after: "monobank", masked: false },
      { field: "institutionCountry", before: null, after: "UA", masked: false },
      { field: "numberLast4", before: null, after: "••4421", masked: false },
      { field: "cardExpiry", before: null, after: "2028-04", masked: false },
      { field: "note", before: null, after: "•••", masked: true },
    ]);
  });

  it("FIN-12@PoC FR 4: «Ощадний» changes its rate; a field of another kind is refused and nothing changes", async () => {
    const space = await newSpace();
    const id = await createAccount(space, {
      kind: "savings",
      name: "Ощадний",
      balance: eur("1000.00"),
      annualRate: "2.5",
    });
    const res = await details(space, id, { annualRate: "3.75" });
    expect(res.statusCode).toBe(200);
    expect(res.json().savings).toEqual({ annualRate: "3.75" });

    const current = await createAccount(space, { kind: "current", name: "Поточний", balance: eur("1.00") });
    const loan = await createAccount(space, {
      kind: "loan",
      name: "Кредит",
      balance: eur("5000.00"),
      annualRate: "9.9",
      monthlyPayment: "310.00",
    });
    for (const [account, body, field] of [
      [current, { cardExpiry: "2028-04", note: "Не запишеться" }, "cardExpiry"],
      [current, { annualRate: "1" }, "annualRate"],
      // A loan's and a card's terms are the liability's (fin12-terms.it.test.ts): not for another kind.
      [current, { monthlyPayment: "1.00" }, "monthlyPayment"],
      [loan, { creditLimit: "100.00" }, "creditLimit"],
    ] as const) {
      const refused = await details(space, account, body);
      expect([field, refused.statusCode]).toEqual([field, 400]);
      expect(refused.json().errors).toEqual([{ in: "body", path: field, issue: "not_allowed" }]);
    }
    expect((await view(space, current)).note).toBeNull();
    expect((await view(space, loan)).loan.annualRate).toBe("9.9");
    expect(await updates(space.householdId, current)).toEqual([]);
    // Unknown fields (owners) are not part of this request: 400, not ignored.
    expect((await details(space, current, { owners: [] })).statusCode).toBe(400);
  });

  it("FIN-12@PoC FR 4: the same values change nothing and write no audit entry; an invalid institution is refused", async () => {
    const space = await newSpace();
    const institution = { name: "ПриватБанк", country: "UA" };
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: eur("5.00"),
      institution,
      note: "Нотатка",
    });
    const same = await details(space, id, {
      institution: { name: " ПриватБанк ", country: "UA" },
      note: "Нотатка",
    });
    expect(same.statusCode).toBe(200);
    expect(await updates(space.householdId, id)).toEqual([]);
    const bad = await details(space, id, { institution: { name: "", country: "UA" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "body", path: "institution", issue: "invalid" }]);
    expect((await view(space, id)).institution).toEqual(institution);
  });

  it("FIN-12@PoC FR 5: «Кредитна картка» → «Кредит» drops «Строк дії», kept before and after in the audit log", async () => {
    const space = await newSpace();
    const id = await createAccount(space, { kind: "credit-card", name: "Картка", balance: eur("10.00") });
    expect((await details(space, id, { cardExpiry: "2027-11" })).statusCode).toBe(200);
    const res = await call(space, "PATCH", `/v1/accounts/${id}`, { kind: "loan" });
    expect(res.statusCode).toBe(200);
    expect((await storedNumber(space, id)).card_expires).toBeNull();
    const [, kindChange] = await updates(space.householdId, id);
    expect(kindChange!.changes).toEqual(
      expect.arrayContaining([{ field: "cardExpiry", before: "2027-11", after: null, masked: false }]),
    );
  });
});

describe("FIN-12@PoC FR 11: a change of «Реквізити» does not make a duplicate", () => {
  it("FIN-12@PoC FR 11: the institution and IBAN of another account in the same currency are refused — «Такий рахунок уже є»; the account's own IBAN is no duplicate of itself", async () => {
    const space = await newSpace();
    const institution = { name: "ПриватБанк", country: "UA" };
    const uah = (amount: string) => ({ amount, currency: "UAH" });
    const first = await createAccount(space, {
      kind: "current",
      name: "Перший",
      balance: uah("1.00"),
      institution,
      number: IBAN,
    });
    const second = await createAccount(space, {
      kind: "current",
      name: "Другий",
      balance: uah("2.00"),
      institution,
    });
    const euro = await createAccount(space, {
      kind: "current",
      name: "Євро",
      balance: eur("3.00"),
      institution,
    });

    const res = await details(space, second, { number: IBAN });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_DUPLICATE" }));
    expect(res.body).not.toContain(IBAN_TAIL);
    expect(await storedNumber(space, second)).toMatchObject({ number_last4: null, number_sealed: null });
    expect(await updates(space.householdId, second)).toEqual([]);

    // Another currency is not the same account (FIN-01 FR 25); the account itself keeps its own IBAN.
    expect((await details(space, euro, { number: IBAN })).statusCode).toBe(200);
    expect((await details(space, first, { number: IBAN, note: "Мій" })).statusCode).toBe(200);
    // Moving the institution onto a matching account is a duplicate too.
    const elsewhere = await createAccount(space, {
      kind: "current",
      name: "Інший банк",
      balance: uah("4.00"),
      institution: { name: "Ощадбанк", country: "UA" },
      number: IBAN,
    });
    const moved = await details(space, elsewhere, { institution });
    expect(moved.statusCode).toBe(409);
    expect((await view(space, elsewhere)).institution).toEqual({ name: "Ощадбанк", country: "UA" });
  });
});

describe("FIN-12@PoC FR 8: a closed account is read-only", () => {
  it("FIN-12@PoC FR 8: «Реквізити» of a closed account do not change", async () => {
    const space = await newSpace();
    const id = await createAccount(space, { kind: "cash", name: "Готівка", balance: eur("0.00") });
    expect((await call(space, "POST", `/v1/accounts/${id}/close`, { closedOn: TODAY })).statusCode).toBe(200);
    const res = await details(space, id, { note: "Нова", number: IBAN });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: "ACCOUNT_CLOSED" }));
    expect((await view(space, id)).note).toBeNull();
    expect(await storedNumber(space, id)).toMatchObject({ number_last4: null, number_sealed: null });
  });
});

describe("FIN-12@PoC: who may change «Реквізити»", () => {
  it("FIN-12@PoC permissions of «Реквізити»: the Owner, an admin and an editor change them; a viewer, an advisor and every scoped member are refused; another space's account is «not found» and tells nothing", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const id = await createAccount(space, {
      kind: "current",
      name: "Поточний",
      balance: eur("431.00"),
      number: IBAN,
    });
    for (const role of ["owner", "admin", "editor"]) {
      const res = await details(space, id, { note: `Нотатка ${role}` }, { role, scoped: false });
      expect([role, res.statusCode]).toEqual([role, 200]);
    }
    for (const principal of [
      { role: "viewer", scoped: false },
      { role: "advisor", scoped: false },
      { role: "owner", scoped: true },
      { role: "editor", scoped: true },
      { role: "viewer", scoped: true },
    ]) {
      const res = await details(space, id, { note: "Чужа", number: OTHER_IBAN }, principal);
      expect([principal, res.statusCode]).toEqual([principal, 403]);
      expect(res.body).not.toMatch(/431|1234|Нотатка/);
    }
    for (const account of [id, randomUUID()]) {
      const res = await details(stranger, account, { note: "Чужа", number: OTHER_IBAN });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(res.body).not.toMatch(/431|1234|Нотатка/);
    }
    const off = await callOn(flagOff, space, "PATCH", `/v1/accounts/${id}/details`, { note: "Вимкнено" });
    // The route's flag is off for the space: 404 as for a route that does not exist, and nothing changes (#244 item 3).
    expect([off.statusCode, off.json().code]).toEqual([404, "NOT_FOUND"]);
    expect(await view(space, id)).toEqual(
      expect.objectContaining({ note: "Нотатка editor", number: { last4: "1234", masked: "••1234" } }),
    );
    expect(await updates(space.householdId, id)).toHaveLength(3);
  });
});
