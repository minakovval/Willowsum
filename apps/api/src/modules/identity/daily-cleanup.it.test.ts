import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  argon2Hasher,
  createIdentityMaintenance,
  createIdentityServices,
  SESSION_ABSOLUTE_MS,
  SIGN_IN_LOCK_MS,
  UNCONFIRMED_ACCOUNT_TTL_MS,
} from "./index.ts";
import { databaseIdentityStore } from "./adapters/index.ts";

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

describe("ACC-01 AC8: an unconfirmed account 7 or 29 days old stays, and no reminder is sent", () => {
  it("7 days and 29 days 23 h after the sign-up: kept, no letter", async () => {
    const week = nextEmail("ac8-7");
    const almost = nextEmail("ac8-29");
    await signUp(almost);
    t += 22 * DAY + 23 * HOUR;
    await signUp(week);
    t += 7 * DAY;
    const lettersBefore = mail.sent.length;
    const report = await maintenance.dailyCleanup();
    await flush();
    expect(report.unconfirmedAccounts).toBe(0);
    expect(await accountId(week)).toBeDefined();
    expect(await accountId(almost)).toBeDefined();
    expect(mail.sent.length).toBe(lettersBefore);
  });
});

describe("ACC-01 AC9 / FR 6: 30 days after the sign-up the account and all its data are deleted", () => {
  it("exactly 30 days: the account, its links, sign-up tokens and reset links are gone; audited without the address", async () => {
    const email = nextEmail("ac9");
    await signUp(email);
    // A reset request for the unconfirmed address too (a reset link row of the account).
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const id = (await accountId(email))!;
    expect((await rowsOf(id)).email_confirmations).toBe(1);
    expect((await rowsOf(id)).password_resets).toBe(1);
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    const lettersBefore = mail.sent.length;
    const report = await maintenance.dailyCleanup();
    await flush();
    expect(report.unconfirmedAccounts).toBe(1);
    expect(await rowsOf(id)).toEqual({
      accounts: 0,
      email_confirmations: 0,
      registrations: 0,
      sessions: 0,
      password_resets: 0,
    });
    expect(mail.sent.length).toBe(lettersBefore);
    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: "identity.account",
      id,
    });
    expect(entries.at(-1)).toMatchObject({
      actorKind: "system",
      channel: "system",
      action: "delete",
      changes: [{ field: "state", before: "unconfirmed", after: null, masked: false }],
    });
    expect(JSON.stringify(entries)).not.toContain(email);
  });

  it("the deleted account's link no longer confirms, and the address can sign up anew", async () => {
    const email = nextEmail("ac9-anew");
    await signUp(email);
    const oldLink = linkOf(email);
    t += UNCONFIRMED_ACCOUNT_TTL_MS + HOUR;
    await maintenance.dailyCleanup();
    expect((await request("POST", "/v1/email-confirmations", { body: { token: oldLink } })).json()).toEqual({
      result: "invalid",
    });
    await signUp(email);
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } })).json(),
    ).toEqual({
      result: "confirmed",
    });
  });

  it("a later sign-up with the address (it replaced the password) starts the 30 days again", async () => {
    const email = nextEmail("ac9-latest");
    await signUp(email);
    t += 20 * DAY;
    await signUp(email, "Ольга Пізніша");
    t += 15 * DAY;
    expect((await maintenance.dailyCleanup()).unconfirmedAccounts).toBe(0);
    expect(await accountId(email)).toBeDefined();
    t += 15 * DAY;
    expect((await maintenance.dailyCleanup()).unconfirmedAccounts).toBe(1);
    expect(await accountId(email)).toBeUndefined();
  });

  it("a confirmed account is never deleted, however old; its space and session stay", async () => {
    const email = nextEmail("ac9-confirmed");
    await signUp(email);
    await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } });
    t += 90 * DAY;
    const signedIn = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    expect(signedIn.statusCode).toBe(200);
    await maintenance.dailyCleanup();
    expect(await accountId(email)).toBeDefined();
    const cookie = String(signedIn.headers["set-cookie"]).split(";")[0]!;
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(200);
  });

  it("the task is idempotent: a second run deletes nothing more", async () => {
    await signUp(nextEmail("ac9-twice"));
    t += UNCONFIRMED_ACCOUNT_TTL_MS;
    expect((await maintenance.dailyCleanup()).unconfirmedAccounts).toBe(1);
    expect(await maintenance.dailyCleanup()).toEqual({
      unconfirmedAccounts: 0,
      lapsedSessions: 0,
      throttleEvents: 0,
      signInGuards: 0,
      registrations: 0,
      emailConfirmations: 0,
      passwordResets: 0,
      sessions: 0,
      notMeLinks: 0,
    });
  });
});

describe("ADR-0010: the daily task bounds the growing identity tables without changing any answer", () => {
  it("limit events go after their hour; reset links after 60 min and the hour of the letter limit", async () => {
    const email = nextEmail("sweep-limits");
    await signUp(email);
    await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } });
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const id = (await accountId(email))!;
    t += 59 * MINUTE;
    await maintenance.dailyCleanup();
    expect(await count(`SELECT count(*)::int AS n FROM identity.throttle_events`)).toBeGreaterThan(0);
    expect((await rowsOf(id)).password_resets).toBe(1);
    t += MINUTE;
    const report = await maintenance.dailyCleanup();
    expect(report.throttleEvents).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::int AS n FROM identity.throttle_events`)).toBe(0);
    expect((await rowsOf(id)).password_resets).toBe(0);
  });

  it("an open superseded «Перевірте пошту» token answers as before until it expires; closed and expired ones go", async () => {
    const email = nextEmail("sweep-registrations");
    const first = await signUp(email);
    t += 2 * MINUTE;
    await signUp(email, "Ольга Друга");
    t += 2 * HOUR;
    await maintenance.dailyCleanup();
    // The superseded token keeps answering «sent», exactly as a live one does (no oracle, ADR-0009 part b).
    const resend = await request("POST", "/v1/registrations/resend", { body: { registrationToken: first } });
    expect(resend.json()).toEqual({ status: "sent", resendAfterS: 60 });
    const id = (await accountId(email))!;
    expect((await rowsOf(id)).registrations).toBe(2);
    await request("POST", "/v1/registrations/change-email", { body: { registrationToken: first } });
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).registrations).toBe(1);
    t += 24 * HOUR;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).registrations).toBe(0);
  });

  it("sessions go at their absolute end (12 h): until then an ended or idle one still tells its reason (ACC-04@PoC AC1)", async () => {
    const email = nextEmail("sweep-sessions");
    await signUp(email);
    await request("POST", "/v1/email-confirmations", { body: { token: linkOf(email) } });
    const ended = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    await request("DELETE", "/v1/session", { cookie: String(ended.headers["set-cookie"]).split(";")[0]! });
    const live = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    const id = (await accountId(email))!;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).sessions).toBe(2);
    const cookie = String(live.headers["set-cookie"]).split(";")[0]!;
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(200);
    t += 15 * MINUTE;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).sessions).toBe(2);
    expect((await request("GET", "/v1/session", { cookie })).json()).toMatchObject({
      code: "SESSION_ENDED",
      sessionEndReason: "idle",
    });
    t += SESSION_ABSOLUTE_MS;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).sessions).toBe(0);
  });

  it("confirmation links: revoked ones go at once; used and expired ones keep their answer (AC24, AC6)", async () => {
    const email = nextEmail("sweep-links");
    await signUp(email);
    const revoked = linkOf(email);
    t += 2 * MINUTE;
    await signUp(email); // the latest sign-up revokes the earlier link and sends a new one
    const used = linkOf(email);
    expect(used).not.toBe(revoked);
    await request("POST", "/v1/email-confirmations", { body: { token: used } });
    const id = (await accountId(email))!;
    // An unconfirmed account whose only link has expired: its account stays until day 30, so only the sweep
    // is run at +31 days to see that the sweep itself never removes an expired link.
    const waiting = nextEmail("sweep-links-expired");
    await signUp(waiting);
    const expired = linkOf(waiting);
    const waitingId = (await accountId(waiting))!;
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).email_confirmations).toBe(1);
    t += 31 * DAY;
    await databaseIdentityStore(db.databases.for("identity")).transaction((tx) => tx.sweep(t));
    expect((await request("POST", "/v1/email-confirmations", { body: { token: expired } })).json()).toEqual({
      result: "expired",
    });
    expect((await rowsOf(waitingId)).email_confirmations).toBe(1);
    await maintenance.dailyCleanup();
    expect((await rowsOf(id)).email_confirmations).toBe(1);
    expect((await request("POST", "/v1/email-confirmations", { body: { token: used } })).json()).toEqual({
      result: "already-used",
    });
    // The expired link went with its unconfirmed account at day 30 (cascade), not with the sweep.
    expect(await accountId(waiting)).toBeUndefined();
  });

  it("sign-in guards: an unlocked one without the CAPTCHA mark goes; a CAPTCHA mark stays", async () => {
    const email = nextEmail("sweep-guards");
    for (let i = 0; i < 5; i++)
      await request("POST", "/v1/sessions", { body: { email, password: "wrong password here" } });
    const guards = () =>
      count(`SELECT count(*)::int AS n FROM identity.sign_in_guards WHERE captcha_required`);
    expect(await guards()).toBeGreaterThan(0);
    await maintenance.dailyCleanup();
    expect(await guards()).toBeGreaterThan(0); // locked
    t += SIGN_IN_LOCK_MS;
    await maintenance.dailyCleanup();
    // Unlocked, but every attempt still needs a CAPTCHA (AC14).
    const attempt = await request("POST", "/v1/sessions", {
      body: { email, password: "wrong password here" },
    });
    expect(attempt.json()).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    t += 31 * DAY;
    await maintenance.dailyCleanup();
    // The CAPTCHA mark is never swept: only a successful sign-in or a reset clears it (AC14).
    expect(await guards()).toBeGreaterThan(0);
    const later = await request("POST", "/v1/sessions", { body: { email, password: "wrong password here" } });
    expect(later.json()).toMatchObject({ code: "CAPTCHA_REQUIRED" });
  });
});
