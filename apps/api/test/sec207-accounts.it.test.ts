import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { requestHash } from "../src/platform/http/idempotency.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * Security review of PR #207 (FIN-01 a): scope of reads, the sealed number in the idempotency store, the owners'
 * shares trigger against direct SQL, and card-number formatting. Synthetic data only.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");
/** The ISO 13616 textbook example IBAN (synthetic, public): bank code 37040044, account 0532013000. */
const IBAN_DE = "DE89370400440532013000";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Синтетичний" });
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

const current = {
  kind: "current",
  name: "Щоденний",
  institution: { name: "Synthetic Bank", country: "DE" },
  balance: { amount: "1000.00", currency: "EUR" },
  balanceDate: "2026-10-01",
};

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
        accounts: createAccountsServices({
          ledger: createLedger(db.databases.for("ledger")),
          liabilities: createLiabilities(db.databases.for("liabilities"), audit),
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
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

describe("sec207: a scoped member never reads accounts (00-general «Політика видимості»: «Рахунки» closed by default)", () => {
  // Defect on ae07568: answers 200 with the account. Fixed: a plain `it`.
  it("sec207: a scoped editor, viewer or advisor gets 404 for an account of its own space, the same as an unknown id", async () => {
    for (const role of ["editor", "viewer", "advisor"]) {
      const space = await newSpace();
      const { id } = (await call(space, "POST", "/v1/accounts", current)).json();
      const read = await call(space, "GET", `/v1/accounts/${id}`, undefined, { role, scoped: true });
      const unknown = await call(space, "GET", `/v1/accounts/${randomUUID()}`, undefined, {
        role,
        scoped: true,
      });
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toContain("Щоденний");
      expect(read.body).not.toContain("1000");
      const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
      expect(strip(read.body)).toEqual(strip(unknown.body));
    }
  });
});

describe("sec207: the full IBAN cannot be recovered from the clear-text columns (FIN-01 business rule, AC7)", () => {
  // Defect on ae07568: the IBAN is recovered from accounts.idempotency_keys.request_hash in < 1 s. Fixed: a plain `it`.
  it("sec207: the stored request hash of a create with Idempotency-Key does not reveal the sealed IBAN", async () => {
    const space = await newSpace();
    const body = { ...current, number: IBAN_DE };
    const res = await call(space, "POST", "/v1/accounts", body, {}, { "idempotency-key": randomUUID() });
    expect(res.statusCode).toBe(201);
    const { rows } = await db.owner.query(
      `SELECT request_hash FROM accounts.idempotency_keys WHERE household_id = $1`,
      [space.householdId],
    );
    const stored = (rows[0] as { request_hash: string }).request_hash;
    // Everything else of the body is in clear columns (accounts, subaccounts, ledger); the bank code follows from the
    // institution; last 4 are clear. Only 6 digits of the account number are unknown: 10^6 hashes.
    const last4 = res.json().number.last4 as string;
    let recovered: string | null = null;
    for (let i = 0; i < 1_000_000 && recovered === null; i += 1) {
      const bban = `37040044${String(i).padStart(6, "0")}${last4}`;
      const check =
        98n - (BigInt(`${bban.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))}131400`) % 97n);
      const iban = `DE${String(check).padStart(2, "0")}${bban}`;
      if (
        requestHash("createAccount", {
          params: undefined,
          query: undefined,
          body: { ...current, number: iban },
        }) === stored
      )
        recovered = iban;
    }
    expect(recovered).toBeNull();
  }, 120_000);
});

describe("sec207: idempotency still works for a create with a sealed number", () => {
  it("sec207: the same Idempotency-Key and body with an IBAN replays the first answer; one account", async () => {
    const space = await newSpace();
    const key = randomUUID();
    const body = { ...current, number: IBAN_DE };
    const first = await call(space, "POST", "/v1/accounts", body, {}, { "idempotency-key": key });
    const again = await call(space, "POST", "/v1/accounts", body, {}, { "idempotency-key": key });
    expect(first.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json().id).toBe(first.json().id);
  });
});

describe("sec207: the owners' shares stay at most 100 % on every date against direct SQL of the module role", () => {
  async function accountWithOwner(): Promise<{ space: Space; accountId: string }> {
    const space = await newSpace();
    const { id } = (await call(space, "POST", "/v1/accounts", current)).json();
    return { space, accountId: id as string };
  }

  it("sec207: a second owner overlapping the Owner's 100 % is refused at commit", async () => {
    const { space, accountId } = await accountWithOwner();
    await expect(
      db.databases.for("accounts").inHousehold(space.householdId, (q) =>
        q.query(
          `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
           VALUES ($1, $2, $3, 1, '2027-01-01')`,
          [space.householdId, accountId, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("sec207: SET CONSTRAINTS ALL IMMEDIATE does not skip the check, and an UPDATE that grows a period is refused", async () => {
    const { space, accountId } = await accountWithOwner();
    await expect(
      db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
        await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
        await q.query(
          `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
           VALUES ($1, $2, $3, 50, '2027-01-01')`,
          [space.householdId, accountId, randomUUID()],
        );
      }),
    ).rejects.toMatchObject({ code: "23514" });
    const other = randomUUID();
    // A share before the Owner's period is fine; stretching it over the Owner's period is not.
    await db.databases.for("accounts").inHousehold(space.householdId, (q) =>
      q.query(
        `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from, valid_to)
         VALUES ($1, $2, $3, 50, '2020-01-01', '2020-02-01')`,
        [space.householdId, accountId, other],
      ),
    );
    await expect(
      db.databases
        .for("accounts")
        .inHousehold(space.householdId, (q) =>
          q.query(`UPDATE account_owners SET valid_to = NULL WHERE owner_account_id = $1`, [other]),
        ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.databases
        .for("accounts")
        .inHousehold(space.householdId, (q) =>
          q.query(`ALTER TABLE account_owners DISABLE TRIGGER account_owner_shares`),
        ),
    ).rejects.toThrow();
  });

  it("sec207 follow-up: two concurrent transactions of 60 % each cannot both commit (checked at once, before either commits)", async () => {
    const { space, accountId } = await accountWithOwner();
    await db.owner.query(
      `UPDATE accounts.account_owners SET valid_to = '2026-12-31' WHERE household_id = $1 AND account_id = $2`,
      [space.householdId, accountId],
    );
    // The first transaction holds its check open for a moment: without a lock per account the second one runs its
    // check in that window, sees only its own row and passes; with the lock it waits for the first commit.
    const insert = () =>
      db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
        await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
        await q.query(
          `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
           VALUES ($1, $2, $3, 60, '2027-01-01')`,
          [space.householdId, accountId, randomUUID()],
        );
        await new Promise((r) => setTimeout(r, 400));
      });
    const results = await Promise.allSettled([insert(), insert()]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const { rows } = await db.owner.query(
      `SELECT coalesce(sum(share), 0)::text AS total FROM accounts.account_owners
        WHERE household_id = $1 AND account_id = $2 AND valid_from = '2027-01-01'`,
      [space.householdId, accountId],
    );
    expect(Number((rows[0] as { total: string }).total)).toBe(60);
  });

  it("sec207 follow-up: two transactions of 60 % that commit together (the check at commit) cannot both stay", async () => {
    const { space, accountId } = await accountWithOwner();
    await db.owner.query(
      `UPDATE accounts.account_owners SET valid_to = '2026-12-31' WHERE household_id = $1 AND account_id = $2`,
      [space.householdId, accountId],
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted = 0;
    const insert = () =>
      db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
        await q.query(
          `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
           VALUES ($1, $2, $3, 60, '2027-01-01')`,
          [space.householdId, accountId, randomUUID()],
        );
        inserted += 1;
        if (inserted === 2) release();
        await gate;
      });
    await Promise.allSettled([insert(), insert()]);
    const { rows } = await db.owner.query(
      `SELECT coalesce(sum(share), 0)::text AS total FROM accounts.account_owners
        WHERE household_id = $1 AND account_id = $2 AND valid_from = '2027-01-01'`,
      [space.householdId, accountId],
    );
    expect(Number((rows[0] as { total: string }).total)).toBeLessThanOrEqual(100);
  });

  it("sec207 follow-up: an UPDATE that raises a share and a concurrent INSERT cannot both commit (the lock covers UPDATE)", async () => {
    const { space, accountId } = await accountWithOwner();
    await db.owner.query(
      `UPDATE accounts.account_owners SET valid_to = '2026-12-31' WHERE household_id = $1 AND account_id = $2`,
      [space.householdId, accountId],
    );
    const second = randomUUID();
    await db.databases.for("accounts").inHousehold(space.householdId, (q) =>
      q.query(
        `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
         VALUES ($1, $2, $3, 40, '2027-01-01')`,
        [space.householdId, accountId, second],
      ),
    );
    const write = (sql: string, values: unknown[]) =>
      db.databases.for("accounts").inHousehold(space.householdId, async (q) => {
        await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
        await q.query(sql, values);
        await new Promise((r) => setTimeout(r, 400));
      });
    const results = await Promise.allSettled([
      write(
        `UPDATE account_owners SET share = 60 WHERE household_id = $1 AND account_id = $2 AND owner_account_id = $3`,
        [space.householdId, accountId, second],
      ),
      write(
        `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
         VALUES ($1, $2, $3, 60, '2027-01-01')`,
        [space.householdId, accountId, randomUUID()],
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const { rows } = await db.owner.query(
      `SELECT coalesce(sum(share), 0)::text AS total FROM accounts.account_owners
        WHERE household_id = $1 AND account_id = $2 AND valid_from = '2027-01-01'`,
      [space.householdId, accountId],
    );
    expect(Number((rows[0] as { total: string }).total)).toBeLessThanOrEqual(100);
  });
});

describe("sec207: a full card number is refused however it is formatted (FIN-12 FR 4)", () => {
  it.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "4111 1111 1111 1111",
    "4111\t1111\n1111 1111",
    " 4111 1111 1111 1111 ",
    "5500 0000 0000 0004",
    "3782 822463 10005",
  ])("sec207: %j is never stored", async (number) => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", { ...current, kind: "credit-card", number });
    expect(res.statusCode).toBe(400);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM accounts.accounts WHERE household_id = $1`,
      [space.householdId],
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it.each([
    "4111.1111.1111.1111",
    "4111​1111​1111​1111",
    "４１１１１１１１１１１１１１１１",
    "4111_1111_1111_1111",
  ])("sec207: other separators %j are refused as invalid, not kept as an account number", async (number) => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/accounts", { ...current, kind: "credit-card", number });
    expect(res.statusCode).toBe(400);
  });
});
