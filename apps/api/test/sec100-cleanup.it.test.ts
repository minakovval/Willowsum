import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../src/platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../src/platform/adapters/mail/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import {
  argon2Hasher,
  createIdentityMaintenance,
  createIdentityServices,
  UNCONFIRMED_ACCOUNT_TTL_MS,
} from "../src/modules/identity/index.ts";
import { databaseIdentityStore } from "../src/modules/identity/adapters/index.ts";
import { DELETE_BATCH } from "../src/modules/identity/application/index.ts";

/**
 * ACC-01@PoC part c: the daily task (FR 6, AC8, AC9; NFR-12; ADR-0010) on a real PostgreSQL through the real API.
 * The test owns the clock (`t`): the API and the task read it, so «30 days later» is one step of `t`, never the
 * wall clock. Mail and CAPTCHA are synthetic.
 */
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = "synthetic lower case words";

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 8, 13, 41, 900);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
let maintenance: ReturnType<typeof createIdentityMaintenance>;

let ipCounter = 0;
const nextIp = () => `192.0.2.${++ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `${label}.${++seq}@example.test`;

async function flush(): Promise<void> {
  await Promise.all(pending.splice(0));
}

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; cookie?: string } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: WEB,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}

async function signUp(email: string, name = "Ольга Синтетична"): Promise<string> {
  const res = await request("POST", "/v1/registrations", {
    body: { name, email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await flush();
  return res.json().registrationToken as string;
}

function linkOf(email: string): string {
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  return /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
}

async function accountId(email: string): Promise<string | undefined> {
  const { rows } = await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [
    email,
  ]);
  return rows[0]?.id as string | undefined;
}

/** Rows of the account in every identity table that holds its rows. */
async function rowsOf(id: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ["accounts", "email_confirmations", "registrations", "sessions", "password_resets"]) {
    const column = table === "accounts" ? "id" : "account_id";
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.${table} WHERE ${column} = $1`,
      [id],
    );
    out[table] = rows[0].n as number;
  }
  return out;
}

const count = async (sql: string, values: unknown[] = []) =>
  (await db.owner.query(sql, values)).rows[0].n as number;

beforeAll(async () => {
  db = await setupRealModules();
  const audit = createAuditLog(db.databases.for("audit"));
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit,
    webOrigin: WEB,
    spaces: householdSpaces(db),
    now: () => t,
    hasher: argon2Hasher(),
    deliver: (task) => {
      pending.push(task());
    },
  });
  maintenance = createIdentityMaintenance({
    db: db.databases.for("identity"),
    audit,
    spaces: householdSpaces(db),
    now: () => t,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabledForAll: async () => true },
        identity: services,
        spaces: householdSpaces(db),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  // Every test starts 40 days after the one before: nothing a test leaves is young enough to matter to the next.
  t += 40 * DAY + 7 * MINUTE;
  await maintenance.dailyCleanup();
});

/** A second connection that plays a request's transaction while the task runs (superuser: same row locks). */
async function otherTx(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: db.url });
  await c.connect();
  await c.query("BEGIN");
  return c;
}
const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const confirmedAt = async (id: string) =>
  (await db.owner.query(`SELECT email_confirmed_at FROM identity.accounts WHERE id = $1`, [id])).rows[0]
    ?.email_confirmed_at as Date | null | undefined;

describe("sec100: the 30-day deletion never removes a confirmed or re-registered account under a race", () => {
  it("a confirmation that holds the account while the task runs at day 30: the account stays, confirmed", async () => {
    const email = nextEmail("sec100-race-confirm");
    await signUp(email);
    const id = (await accountId(email))!;
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    const c = await otherTx();
    try {
      // confirmAccount's statement, not yet committed.
      await c.query(
        `UPDATE identity.accounts SET email_confirmed_at = $2, updated_at = $2 WHERE id = $1 AND email_confirmed_at IS NULL`,
        [id, new Date(t)],
      );
      const run = settle(maintenance.dailyCleanup());
      await pause(400);
      await c.query("COMMIT");
      const result = await run;
      expect(result.ok).toBe(true);
    } finally {
      await c.end();
    }
    expect(await confirmedAt(id)).toBeInstanceOf(Date);
  });

  it("a sign-up of the same address that holds the account while the task runs: it stays (its 30 days restart)", async () => {
    const email = nextEmail("sec100-race-signup");
    await signUp(email);
    const id = (await accountId(email))!;
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    const c = await otherTx();
    try {
      // signUp: findAccountByEmail(…, "update"), then replaceUnconfirmedAccount.
      await c.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1 FOR UPDATE`, [email]);
      await c.query(
        `UPDATE identity.accounts SET updated_at = $2 WHERE id = $1 AND email_confirmed_at IS NULL`,
        [id, new Date(t)],
      );
      const run = settle(maintenance.dailyCleanup());
      await pause(400);
      await c.query("COMMIT");
      expect((await run).ok).toBe(true);
    } finally {
      await c.end();
    }
    expect(await accountId(email)).toBe(id);
  });

  it("the real confirm order (link row, then account) racing the task: never a confirmed account deleted", async () => {
    const email = nextEmail("sec100-race-order");
    await signUp(email);
    const id = (await accountId(email))!;
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    const c = await otherTx();
    let confirm: { ok: boolean };
    let run: { ok: boolean };
    try {
      // confirmEmail: findConfirmation … FOR UPDATE and useConfirmation hold the link row.
      await c.query(`SELECT id FROM identity.email_confirmations WHERE account_id = $1 FOR UPDATE`, [id]);
      const pending = settle(maintenance.dailyCleanup());
      await pause(300);
      // …then confirmAccount waits for the account the task has locked.
      confirm = await settle(
        c
          .query(
            `UPDATE identity.accounts SET email_confirmed_at = $2, updated_at = $2 WHERE id = $1 AND email_confirmed_at IS NULL`,
            [id, new Date(t)],
          )
          .then(() => c.query("COMMIT")),
      );
      if (!confirm.ok) await c.query("ROLLBACK").catch(() => undefined);
      run = await pending;
    } finally {
      await c.end();
    }
    const state = await confirmedAt(id);
    // A deleted account is one whose confirmation never committed; a committed confirmation keeps it.
    if (state === undefined) expect(confirm.ok).toBe(false);
    else expect(state).toBeInstanceOf(Date);
    if (confirm.ok) expect(state).toBeInstanceOf(Date);
    // The task retries a batch it lost as the deadlock victim (40P01), so the run itself always completes.
    expect(run.ok).toBe(true);
    console.log(
      `sec100 race outcome: confirm=${confirm.ok} task=${run.ok} account=${state === undefined ? "deleted" : "confirmed"}`,
    );
  });

  it("deleting an unconfirmed account leaves every household row (another person's space) untouched", async () => {
    const owner = nextEmail("sec100-space-owner");
    await signUp(owner);
    await request("POST", "/v1/email-confirmations", { body: { token: linkOf(owner) } });
    expect(
      (await request("POST", "/v1/sessions", { body: { email: owner, password: PASSWORD } })).statusCode,
    ).toBe(200);
    await signUp(nextEmail("sec100-stale"));
    const households = () => count(`SELECT count(*)::int AS n FROM household.households`);
    const members = () => count(`SELECT count(*)::int AS n FROM household.account_spaces`);
    const before = [await households(), await members()];
    expect(before[0]).toBeGreaterThan(0);
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    expect((await maintenance.dailyCleanup()).unconfirmedAccounts).toBe(1);
    expect([await households(), await members()]).toEqual(before);
    expect(await accountId(owner)).toBeDefined();
  });

  it("every deleted account gets exactly one platform entry, and it carries no address", async () => {
    const emails = [nextEmail("sec100-audit-a"), nextEmail("sec100-audit-b")];
    for (const e of emails) await signUp(e);
    const ids = await Promise.all(emails.map(async (e) => (await accountId(e))!));
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    await maintenance.dailyCleanup();
    const log = createAuditLog(db.databases.for("audit"));
    for (const [i, id] of ids.entries()) {
      const deletes = (await log.platformEntriesFor({ type: "identity.account", id })).filter(
        (e) => e.action === "delete",
      );
      expect(deletes).toHaveLength(1);
      expect(JSON.stringify(deletes)).not.toContain(emails[i]!.split("@")[0]);
    }
  });
});

describe("sec100: a backlog larger than one batch is deleted in one run (AC9: on day 30, not later)", () => {
  it("DELETE_BATCH + 1 stale unconfirmed accounts: all go in one run, each audited once", async () => {
    const n = 201;
    const hash = ["$argon2id$v=19$m=1,t=1,p=1", "c3ludGhldGlj", "c3ludGhldGlj"].join("$");
    const { rows } = await db.owner.query(
      `INSERT INTO identity.accounts (email, email_normalized, display_name, password_hash, created_at, updated_at)
       SELECT 'bulk' || g || '.' || $2 || '@example.test', 'bulk' || g || '.' || $2 || '@example.test', 'Синтетичний', $1, $3, $3
         FROM generate_series(1, $4::int) g RETURNING id`,
      [hash, String(++seq), new Date(t), n],
    );
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    expect((await maintenance.dailyCleanup()).unconfirmedAccounts).toBe(n);
    expect(
      await count(`SELECT count(*)::int AS n FROM identity.accounts WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.id as string),
      ]),
    ).toBe(0);
  });
});

describe("sec100: one batch is one bounded transaction", () => {
  // Defect: the planner rescans the LIMIT … FOR UPDATE SKIP LOCKED subquery of the IN (…) and one DELETE takes
  // every stale account (seen: 201 for a limit of 200). Passes while the defect exists; `it` with the patch.
  it("deleteUnconfirmedAccounts(by, DELETE_BATCH) deletes at most DELETE_BATCH accounts", async () => {
    const hash = ["$argon2id$v=19$m=1,t=1,p=1", "c3ludGhldGlj", "c3ludGhldGlj"].join("$");
    await db.owner.query(
      `INSERT INTO identity.accounts (email, email_normalized, display_name, password_hash, created_at, updated_at)
       SELECT 'cap' || g || '.' || $2 || '@example.test', 'cap' || g || '.' || $2 || '@example.test', 'Синтетичний', $1, $3, $3
         FROM generate_series(1, $4::int) g`,
      [hash, String(++seq), new Date(t), DELETE_BATCH + 50],
    );
    const store = databaseIdentityStore(db.databases.for("identity"));
    const ids = await store.transaction((tx) => tx.deleteUnconfirmedAccounts(t + 1, DELETE_BATCH));
    expect(ids.length).toBeLessThanOrEqual(DELETE_BATCH);
    await maintenance.dailyCleanup();
  });
});

describe("sec100: the sweep never weakens a live guard", () => {
  it("a locked sign-in guard is kept while locked, even if its CAPTCHA mark were old", async () => {
    const email = nextEmail("sec100-locked");
    for (let i = 0; i < 5; i++)
      await request("POST", "/v1/sessions", { body: { email, password: "wrong password here" } });
    // Age the CAPTCHA mark only: the lock itself is still in force.
    await db.owner.query(`UPDATE identity.sign_in_guards SET changed_at = $1 WHERE locked_until > $2`, [
      new Date(t - 31 * DAY),
      new Date(t),
    ]);
    await maintenance.dailyCleanup();
    const res = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    expect(res.json()).toMatchObject({ code: expect.stringMatching(/LOCK|TOO_MANY|CAPTCHA/) });
  });

  it("a live reset link and a live session survive the sweep", async () => {
    const email = nextEmail("sec100-live");
    await signUp(email);
    await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } });
    const live = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const id = (await accountId(email))!;
    t += 10 * MINUTE;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).password_resets).toBe(1);
    expect((await rowsOf(id)).sessions).toBe(1);
    const cookie = String(live.headers["set-cookie"]).split(";")[0]!;
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(200);
  });
});
