import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { argon2Hasher, createIdentityServices } from "../src/modules/identity/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../src/platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../src/platform/adapters/mail/index.ts";
import { scheduleDaily, type DailySchedule } from "../src/platform/process/daily.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { schedulerDailyTasks } from "../src/wiring.ts";
import { fakeFlags } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * NFR-12@PoC: retention, on a real PostgreSQL through the real API and the scheduler's own task list
 * (`schedulerDailyTasks`, the one main.ts runs). The test owns the clock (`t`): the API and the tasks read it,
 * so «30 days later» is one step of `t`, never the wall clock. Mail and CAPTCHA are synthetic.
 *
 * Rows of the retention table built elsewhere and verified by their own tests (named NFR-12@PoC FR 4 there):
 * the reset link (60 min, single use) in src/modules/identity/password-reset.it.test.ts, the append-only audit
 * log in src/modules/audit/audit.it.test.ts.
 */
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
/** The period of the retention table, written here and not imported: the test states the requirement. */
const THIRTY_DAYS = 30 * DAY;
const PASSWORD = "synthetic lower case words";

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let daily: DailySchedule;
let t = Date.UTC(2026, 10, 12, 9, 27, 3, 450);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];

let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `nfr12-${label}.${++seq}@example.test`;

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

async function signUp(email: string): Promise<void> {
  const res = await request("POST", "/v1/registrations", {
    body: { name: "Ірина Синтетична", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await flush();
}

function linkOf(email: string): string {
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  return /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
}

async function confirm(email: string): Promise<void> {
  const res = await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } });
  expect(res.json()).toEqual({ result: "confirmed" });
}

async function signIn(email: string) {
  const res = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
  await flush();
  return res;
}

async function accountId(email: string): Promise<string | undefined> {
  const { rows } = await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [
    email,
  ]);
  return rows[0]?.id as string | undefined;
}

/** Rows of an account in every identity table that holds its rows. */
async function identityRowsOf(id: string): Promise<Record<string, number>> {
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

/**
 * Every row of a space, as the superuser sees it (no row policy): each table with a household_id column in any
 * module schema — found from the catalogue, so a table a later module adds is covered without editing this
 * test — plus the space's login directory rows. Rows are hashed whole, so a changed row counts as a change too.
 * The audit log is the one exception: it only grows (see `auditRows`).
 */
async function spaceRows(householdId: string): Promise<Record<string, string>> {
  const { rows: tables } = await db.owner.query<{ schema: string; table: string }>(
    `SELECT c.table_schema AS schema, c.table_name AS table
       FROM information_schema.columns c
       JOIN information_schema.tables x USING (table_schema, table_name)
      WHERE c.column_name = 'household_id' AND x.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND c.table_schema NOT LIKE 'platform%'
      ORDER BY 1, 2`,
  );
  const out: Record<string, string> = {};
  const digest = async (name: string, from: string) => {
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(md5(r::text), ',' ORDER BY md5(r::text))), '') AS h
         FROM ${from} r`,
      [householdId],
    );
    out[name] = `${rows[0].n as number}:${rows[0].h as string}`;
  };
  for (const { schema, table } of tables) {
    if (schema === "audit" && table === "entries") continue;
    await digest(`${schema}.${table}`, `(SELECT * FROM "${schema}"."${table}" WHERE household_id = $1)`);
  }
  await digest("household.account_spaces", `(SELECT * FROM household.account_spaces WHERE space_id = $1)`);
  return out;
}

/** The space's audit entries by id: the whole row hashed, and its entity type. */
async function auditRows(householdId: string): Promise<Map<string, { hash: string; entityType: string }>> {
  const { rows } = await db.owner.query<{ id: string; hash: string; entity_type: string }>(
    `SELECT id, md5(r::text) AS hash, entity_type FROM audit.entries r WHERE household_id = $1`,
    [householdId],
  );
  return new Map(rows.map((r) => [r.id, { hash: r.hash, entityType: r.entity_type }]));
}

/**
 * Retention never changes or removes an audit entry; a session left open may add the entry of its end (ACC-04,
 * the space's sign-in journal), and nothing else may be added.
 */
async function expectAuditOnlyGrew(
  householdId: string,
  before: Map<string, { hash: string; entityType: string }>,
) {
  const after = await auditRows(householdId);
  for (const [id, row] of before) expect(after.get(id), `audit entry ${id}`).toEqual(row);
  for (const [id, row] of after)
    if (!before.has(id)) expect(row.entityType, `new audit entry ${id}`).toBe("identity.sign-in");
}

/** A confirmed, signed-in account with its first space, audit entries of it and ledger rows in it. */
async function confirmedAccountWithData(label: string) {
  const email = nextEmail(label);
  await signUp(email);
  await confirm(email);
  expect((await signIn(email)).statusCode).toBe(200);
  // The session stays open: it lapses, and the daily task appends its end to the space's sign-in journal (ACC-04,
  // audit log) — the only change retention may make to the space (`expectAuditOnlyGrew`).
  const id = (await accountId(email))!;
  const membership = (await householdSpaces(db).membershipOf(id))!;
  const ledger = createLedger(db.databases.for("ledger"));
  const cash = await ledger.openAccount(
    membership.householdId,
    { module: "accounts", id: randomUUID() },
    { type: "asset", currency: "EUR" },
  );
  for (const [amount, date] of [
    ["-42.17", "2026-10-03"],
    ["1250.00", "2026-10-31"],
  ] as const)
    await ledger.post(membership.householdId, {
      source: { module: "transactions", id: randomUUID() },
      idempotencyKey: randomUUID(),
      operationDate: date,
      event: { type: "transaction", account: cash.id, amount: Money.of(amount, "EUR") },
    });
  return { email, id, householdId: membership.householdId };
}

beforeAll(async () => {
  db = await setupRealModules();
  const audit = createAuditLog(db.databases.for("audit"));
  const spaces = householdSpaces(db);
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit,
    webOrigin: WEB,
    spaces,
    now: () => t,
    hasher: argon2Hasher(),
    deliver: (task) => {
      pending.push(task());
    },
  });
  // The scheduler's own task list, run on demand: the timer (the longest delay a timer takes, ~24.8 days of
  // wall time) never fires within a test.
  daily = scheduleDaily(schedulerDailyTasks({ databases: db.databases, audit, spaces, now: () => t }), {
    firstDelayMs: 2 ** 31 - 1,
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabledForAll: async () => true },
        identity: services,
        spaces,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await daily?.stop();
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  // Every test starts 40 days after the one before: nothing a test leaves is young enough to matter to the next.
  t += 40 * DAY + 11 * MINUTE;
  await daily.runNow();
});

describe("NFR-12@PoC AC1: an unconfirmed account registered 30 days ago is deleted by the daily task, without reminders", () => {
  it("kept until 30 days after the sign-up, then the account and all its data are gone; no letter in between", async () => {
    const email = nextEmail("ac1");
    const signedUp = t;
    await signUp(email);
    // A reset request for the unconfirmed address too: its link is a row of the account.
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const id = (await accountId(email))!;
    expect((await identityRowsOf(id)).password_resets).toBe(1);
    const letters = mail.sent.filter((m) => m.to === email).length;

    // Daily runs on day 1, 7 and 29 and 1 ms before day 30: the account stays.
    for (const offset of [DAY, 7 * DAY, 29 * DAY, THIRTY_DAYS - 1]) {
      t = signedUp + offset;
      await daily.runNow();
      await flush();
      expect(await accountId(email), `day ${offset / DAY}`).toBe(id);
    }
    t = signedUp + THIRTY_DAYS;
    await daily.runNow();
    await flush();
    expect(await identityRowsOf(id)).toEqual({
      accounts: 0,
      email_confirmations: 0,
      registrations: 0,
      sessions: 0,
      password_resets: 0,
    });
    // No reminder at any run: the only letters of the address are those of its sign-up and its reset request.
    expect(mail.sent.filter((m) => m.to === email)).toHaveLength(letters);
  });

  it("NFR-12@PoC FR 4 (row «Непідтверджений акаунт»): it cannot be signed in to during the 30 days", async () => {
    const email = nextEmail("no-sign-in");
    await signUp(email);
    t += 29 * DAY;
    const res = await signIn(email);
    expect(res.json()).toMatchObject({ status: "email-not-confirmed" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await householdSpaces(db).membershipOf((await accountId(email))!)).toBeNull();
  });
});

describe("NFR-12@PoC FR 1, FR 2: the data of a confirmed account and its space stay as long as the account exists", () => {
  it("years of daily runs that do delete unconfirmed accounts never change a row of the confirmed account or its space", async () => {
    const owner = await confirmedAccountWithData("kept");
    const before = await spaceRows(owner.householdId);
    const auditBefore = await auditRows(owner.householdId);
    // The space really holds data in every module that has some: audit entries and ledger rows.
    expect(auditBefore.size).toBeGreaterThan(0);
    expect(before["ledger.entries"]).toMatch(/^2:/);
    expect(before["ledger.postings"]).toMatch(/^2:/);
    expect(before["household.households"]).toMatch(/^1:/);
    expect(before["household.account_spaces"]).toMatch(/^1:/);

    for (const step of [31 * DAY, YEAR, 10 * YEAR]) {
      // An unconfirmed account in each period proves that the run deleted what it should.
      const stale = nextEmail("stale");
      await signUp(stale);
      t += step;
      await daily.runNow();
      expect(await accountId(stale)).toBeUndefined();
      expect(await accountId(owner.email)).toBe(owner.id);
      expect(await spaceRows(owner.householdId)).toEqual(before);
      await expectAuditOnlyGrew(owner.householdId, auditBefore);
    }
    // Still the same login, with the same space.
    const again = await signIn(owner.email);
    expect(again.statusCode).toBe(200);
    expect((await householdSpaces(db).membershipOf(owner.id))?.householdId).toBe(owner.householdId);
  });

  it("an account confirmed a moment before its 30 days end is kept by the run at day 30", async () => {
    const email = nextEmail("late-confirm");
    await signUp(email);
    t += THIRTY_DAYS - MINUTE;
    // The 24 h link has long expired: «Надіслати ще раз» sends a new one (it does not restart the 30 days).
    const resend = await request("POST", "/v1/email-confirmations/resend", {
      body: { token: linkOf(email) },
    });
    expect(resend.statusCode).toBe(200);
    await flush();
    await confirm(email);
    t += MINUTE;
    await daily.runNow();
    expect(await accountId(email)).toBeDefined();
    t += 5 * YEAR;
    await daily.runNow();
    expect(await accountId(email)).toBeDefined();
  });

  it("deleting an unconfirmed account touches no row of any space", async () => {
    const owner = await confirmedAccountWithData("neighbour");
    const before = await spaceRows(owner.householdId);
    const auditBefore = await auditRows(owner.householdId);
    const stale = nextEmail("stale-neighbour");
    await signUp(stale);
    t += THIRTY_DAYS;
    await daily.runNow();
    expect(await accountId(stale)).toBeUndefined();
    expect(await spaceRows(owner.householdId)).toEqual(before);
    await expectAuditOnlyGrew(owner.householdId, auditBefore);
  });
});

describe("FIN-04@PoC FR 10 through the scheduler's task list: main.ts's alert mail reaches the integrity check", () => {
  it("schedulerDailyTasks({ alertMail }) sends the owner's letter about a discrepancy through the given mail adapter", async () => {
    // A space of its own with an entry without postings, written past the triggers as only a restore could.
    const householdId = randomUUID();
    const entryId = randomUUID();
    await db.owner.query("BEGIN");
    await db.owner.query("SET LOCAL session_replication_role = replica");
    await db.owner.query(
      `INSERT INTO ledger.entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
       VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'transfer', '2026-06-01', 1, $2::uuid::text)`,
      [householdId, entryId],
    );
    await db.owner.query("COMMIT");
    const outbox = syntheticMailSender();
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit: createAuditLog(db.databases.for("audit")),
      spaces: { spaceIds: async () => [householdId], membershipOf: async () => null },
      now: () => t,
      alertMail: { mail: outbox, to: "owner@example.test" },
    });
    const check = tasks.find((task) => task.name === "ledger.integrity-check")!;
    await check.run();
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.to).toBe("owner@example.test");
    expect(outbox.sent[0]!.text).toContain("Запис без проводок: 1.");
    for (const secret of [householdId, entryId]) expect(outbox.sent[0]!.text).not.toContain(secret);
  });
});
