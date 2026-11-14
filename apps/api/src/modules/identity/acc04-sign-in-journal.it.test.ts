import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { withTestErasureDatabases } from "../../../test/erasure-helpers.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditErasure, createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityMaintenance, createIdentityServices } from "./index.ts";

/**
 * ACC-04@PoC part a3 (server) on a real PostgreSQL through the real API: the sign-in journal in the space's audit log
 * (ACC-04 business rules; NFR-15@PoC FR 29; owner decisions 2026-11-14), the device as browser and system without
 * versions, and the migration of the device history kept before that decision. The clock is the test's own (`t`).
 */
const WEB = "http://localhost:5173";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PASSWORD = "synthetic lower case words";
const NEW_PASSWORD = "another synthetic passphrase";
const WRONG = "a wrong synthetic password";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHROME_WINDOWS_NEXT = CHROME_WINDOWS.replace("Chrome/131", "Chrome/132");
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 14, 13, 41, 9, 0);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
const flush = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

let seq = 0;
const nextEmail = (label: string) => `acc04a3-${label}.${++seq}@example.test`;
let ipCounter = 0;
const nextIp = () => `192.0.2.${(++ipCounter % 250) + 1}`;

type Res = Awaited<ReturnType<typeof app.inject>>;

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; cookie?: string | undefined; userAgent?: string; ip?: string } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: options.ip ?? nextIp(),
    headers: {
      origin: WEB,
      "user-agent": options.userAgent ?? CHROME_WINDOWS,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}

function setCookies(res: Res): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

/** One browser on one device at one address: its user agent and its cookie jar. */
class Browser {
  cookie: string | undefined;
  readonly userAgent: string;
  readonly ip: string;
  constructor(userAgent: string, ip: string) {
    this.userAgent = userAgent;
    this.ip = ip;
  }
  take(res: Res): Res {
    for (const c of setCookies(res)) {
      if (!c.startsWith("session=")) continue;
      this.cookie = /Max-Age=0\b/.test(c) ? undefined : c.split(";")[0]!;
    }
    return res;
  }
  async send(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<Res> {
    return this.take(
      await request(method, url, { body, cookie: this.cookie, userAgent: this.userAgent, ip: this.ip }),
    );
  }
  signIn = (email: string, password = PASSWORD) => this.send("POST", "/v1/sessions", { email, password });
}

async function registered(label: string): Promise<{ email: string; confirmToken: string }> {
  const email = nextEmail(label);
  const res = await request("POST", "/v1/registrations", {
    body: { name: "Олена Журнальна", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await flush();
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  return { email, confirmToken: /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]! };
}

async function confirmedAccount(label: string): Promise<string> {
  const { email, confirmToken } = await registered(label);
  const res = await request("POST", "/v1/email-confirmations", { body: { token: confirmToken } });
  expect(res.json()).toEqual({ result: "confirmed" });
  return email;
}

async function accountId(email: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM identity.accounts WHERE email_normalized = $1`,
    [email],
  );
  return rows[0]!.id;
}

/** A confirmed account signed in once (its space exists): the browser, the account and its space. */
async function signedIn(label: string, ua = CHROME_WINDOWS, ip = "203.0.113.10") {
  const email = await confirmedAccount(label);
  const browser = new Browser(ua, ip);
  expect((await browser.signIn(email)).json()).toEqual({ status: "signed-in" });
  await flush();
  const id = await accountId(email);
  const space = (await householdSpaces(db).membershipOf(id))!.householdId;
  return { email, browser, id, space };
}

const audit = () => createAuditLog(db.databases.for("audit"));

/** The account's sign-in journal in a space, as {event, reason, ip, device, session} per entry. */
async function journal(space: string, id: string) {
  const entries = await audit().entriesFor(space, { type: "identity.sign-in", id });
  return entries.map((e): Record<string, string | null> => ({
    ...Object.fromEntries(e.changes.map((c) => [c.field, c.after])),
    actor: e.actorKind,
    channel: e.channel,
  }));
}

/** Every audit row of both logs (the superuser's view): to see that nothing at all was written. */
async function allAuditRows(): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM audit.entries) + (SELECT count(*) FROM audit.platform_entries) AS n`,
  );
  return Number(rows[0]!.n);
}

const maintenance = () =>
  createIdentityMaintenance({
    db: db.databases.for("identity"),
    audit: audit(),
    spaces: householdSpaces(db),
    now: () => t,
  });

beforeAll(async () => {
  db = await setupRealModules(4);
  const spaces = householdSpaces(db);
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: audit(),
    webOrigin: WEB,
    spaces,
    now: () => t,
    hasher: argon2Hasher(),
    deliver: (task) => {
      pending.push(task());
    },
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
  await app?.close();
  await db?.close();
});

beforeEach(() => {
  t += 2 * HOUR + 7 * MINUTE + 3 * SECOND;
});

describe("NFR-15@PoC FR 29: every sign-in, failed sign-in and session end is written to the space's audit log with the IP address and the device", () => {
  it("a sign-in: the space's log has it with the address and the browser and system, by the user, without an email or user agent", async () => {
    const { email, browser, id, space } = await signedIn("signed-in", FIREFOX_LINUX, "198.51.100.77");
    const rows = await journal(space, id);
    expect(rows).toEqual([
      {
        event: "signed-in",
        session: expect.stringMatching(/^[0-9a-f-]{36}$/),
        ip: "198.51.100.77",
        device: "firefox/linux",
        actor: "user",
        channel: "web",
      },
    ]);
    const raw = JSON.stringify(await audit().entriesFor(space, { type: "identity.sign-in", id }));
    expect(raw).not.toContain(email);
    expect(raw).not.toContain("Firefox/133");
    // The session of the entry is the browser's live session.
    const { rows: sessions } = await db.owner.query<{ id: string }>(
      `SELECT id FROM identity.sessions WHERE account_id = $1 AND ended_at IS NULL`,
      [id],
    );
    expect(sessions.map((s) => s.id)).toEqual([rows[0]!["session"]]);
    expect((await browser.send("GET", "/v1/session")).statusCode).toBe(200);
  });

  it("a wrong password for a confirmed account with a space: written with the reason, the address and the device; the 5th also locks", async () => {
    const { email, id, space } = await signedIn("failed");
    const intruder = new Browser(SAFARI_IPHONE, "198.51.100.200");
    for (let i = 0; i < 5; i++) await intruder.signIn(email, WRONG);
    await flush();
    const rows = (await journal(space, id)).slice(1);
    expect(rows).toEqual([
      ...Array.from({ length: 5 }, () => ({
        event: "sign-in-failed",
        reason: "invalid-password",
        ip: "198.51.100.200",
        device: "safari/ios",
        actor: "system",
        channel: "web",
      })),
      {
        event: "sign-in-locked",
        reason: "sign-in",
        ip: "198.51.100.200",
        device: "safari/ios",
        actor: "system",
        channel: "web",
      },
    ]);
    // Attempts refused by the lock check no password: they are not written (the 5 a quarter-hour bound the log).
    expect((await intruder.signIn(email, WRONG)).statusCode).toBe(429);
    await flush();
    expect(await journal(space, id)).toHaveLength(7);
  });

  it("the right password refused after «Це був не я» is a failed sign-in with its reason", async () => {
    const { email, id, space } = await signedIn("reset-required");
    await new Browser(FIREFOX_LINUX, "198.51.100.5").signIn(email);
    await flush();
    const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
    const token = /\/#\/not-me\?token=([A-Za-z0-9_-]{43})$/m.exec(letter.text)![1]!;
    expect((await request("POST", "/v1/not-me-links/confirm", { body: { token } })).statusCode).toBe(200);
    expect((await new Browser(CHROME_WINDOWS, "203.0.113.10").signIn(email)).statusCode).toBe(403);
    await flush();
    expect((await journal(space, id)).at(-1)).toEqual({
      event: "sign-in-failed",
      reason: "password-reset-required",
      ip: "203.0.113.10",
      device: "chrome/windows",
      actor: "system",
      channel: "web",
    });
  });

  it("a sign-in's entries go only to the account's own space: another space's log has none of them", async () => {
    const mine = await signedIn("mine");
    const other = await signedIn("other");
    await new Browser(FIREFOX_LINUX, "198.51.100.9").signIn(mine.email, WRONG);
    await flush();
    expect(await journal(other.space, mine.id)).toEqual([]);
    expect(await journal(mine.space, other.id)).toEqual([]);
    expect(await journal(other.space, other.id)).toHaveLength(1);
  });
});

describe("ACC-04@PoC: a failed sign-in for an address without an account or space, or of an unconfirmed account, is written to no log (owner decision 2026-11-14)", () => {
  it("an address without an account: no entry in any log", async () => {
    await signedIn("baseline");
    const before = await allAuditRows();
    const res = await new Browser(FIREFOX_LINUX, "198.51.100.31").signIn(nextEmail("nobody"), WRONG);
    expect(res.statusCode).toBe(401);
    await flush();
    expect(await allAuditRows()).toBe(before);
  });

  it("an unconfirmed account: neither a wrong password nor the right one writes anything", async () => {
    const { email } = await registered("unconfirmed");
    const before = await allAuditRows();
    expect((await new Browser(FIREFOX_LINUX, "198.51.100.32").signIn(email, WRONG)).statusCode).toBe(401);
    expect((await new Browser(FIREFOX_LINUX, "198.51.100.32").signIn(email)).json()).toMatchObject({
      status: "email-not-confirmed",
    });
    await flush();
    expect(await allAuditRows()).toBe(before);
  });

  it("a confirmed account without a space yet: a wrong password writes nothing", async () => {
    const email = await confirmedAccount("no-space");
    const before = await allAuditRows();
    expect((await new Browser(FIREFOX_LINUX, "198.51.100.33").signIn(email, WRONG)).statusCode).toBe(401);
    await flush();
    expect(await allAuditRows()).toBe(before);
    expect(await householdSpaces(db).membershipOf(await accountId(email))).toBeNull();
  });

  it("the answer and its work on the response path are the same: the entry is written after the answer", async () => {
    const { email, id, space } = await signedIn("after-answer");
    const held: Promise<void>[] = [];
    const before = pending.length;
    const res = await new Browser(FIREFOX_LINUX, "198.51.100.34").signIn(email, WRONG);
    expect(res.statusCode).toBe(401);
    // The entry is work handed to `deliver`, not done before the answer.
    held.push(...pending.splice(before));
    expect(held.length).toBeGreaterThanOrEqual(1);
    await Promise.all(held);
    expect((await journal(space, id)).at(-1)).toMatchObject({ event: "sign-in-failed" });
  });
});

describe("ACC-04@PoC: every session end is written with the IP address and the device of the request that ended it", () => {
  it("sign-out", async () => {
    const { browser, id, space } = await signedIn("sign-out", CHROME_WINDOWS, "203.0.113.20");
    expect((await browser.send("DELETE", "/v1/session")).statusCode).toBe(204);
    const [signIn, end] = await journal(space, id);
    expect(end).toEqual({
      event: "session-ended",
      session: signIn!["session"],
      reason: "signed-out",
      ip: "203.0.113.20",
      device: "chrome/windows",
      actor: "user",
      channel: "web",
    });
  });

  it("inactivity found by the next request (also a protected route of another module); found once", async () => {
    const { browser, id, space } = await signedIn("idle", CHROME_WINDOWS, "203.0.113.21");
    t += 15 * MINUTE;
    expect((await browser.send("GET", "/v1/space")).statusCode).toBe(401);
    expect((await browser.send("GET", "/v1/session")).statusCode).toBe(401);
    const rows = await journal(space, id);
    expect(rows.map((r) => [r["event"], r["reason"] ?? null])).toEqual([
      ["signed-in", null],
      ["session-ended", "idle"],
    ]);
    expect(rows[1]).toMatchObject({ ip: "203.0.113.21", device: "chrome/windows", actor: "system" });
  });

  it("the 12 h end and a reused (copied) token", async () => {
    const a = await signedIn("expired");
    // A user active all along: a refresh every 14 min until the 12 h end refuses one.
    let last = 200;
    for (let i = 0; i < 60 && last === 200; i++) {
      t += 14 * MINUTE;
      last = (await a.browser.send("POST", "/v1/session/refresh")).statusCode;
    }
    expect(last).toBe(401);
    expect((await journal(a.space, a.id)).at(-1)).toMatchObject({
      event: "session-ended",
      reason: "expired",
    });

    const b = await signedIn("reuse");
    const copied = b.browser.cookie;
    await b.browser.send("POST", "/v1/session/refresh");
    t += 31 * SECOND;
    await request("GET", "/v1/session", { cookie: copied, userAgent: FIREFOX_LINUX, ip: "198.51.100.66" });
    expect((await journal(b.space, b.id)).at(-1)).toMatchObject({
      event: "session-ended",
      reason: "token-reuse",
      ip: "198.51.100.66",
      device: "firefox/linux",
    });
  });

  it("a password reset ends every session: one entry per session, with the address of the reset", async () => {
    const { email, id, space } = await signedIn("reset");
    await new Browser(FIREFOX_LINUX, "198.51.100.40").signIn(email);
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const link = /\/#\/password\/reset\?token=([A-Za-z0-9_-]{43})$/m.exec(
      mail.sent.filter((m) => m.to === email).at(-1)!.text,
    )![1]!;
    await request("POST", "/v1/password-resets/complete", {
      body: { token: link, password: NEW_PASSWORD },
      ip: "203.0.113.41",
      userAgent: SAFARI_IPHONE,
    });
    const ends = (await journal(space, id)).filter((r) => r["event"] === "session-ended");
    expect(ends).toHaveLength(2);
    for (const end of ends)
      expect(end).toMatchObject({ reason: "password-reset", ip: "203.0.113.41", device: "safari/ios" });
    expect(new Set(ends.map((e) => e["session"])).size).toBe(2);
  });

  it("a password change in the profile ends the other sessions (#209); a step-up lockout locks sign-in and ends the session", async () => {
    const { email, browser, id, space } = await signedIn("change");
    const other = new Browser(FIREFOX_LINUX, "198.51.100.50");
    await other.signIn(email);
    const stepUp = await browser.send("POST", "/v1/session/step-up", {
      action: "password-change",
      password: PASSWORD,
    });
    expect(stepUp.statusCode).toBe(200);
    expect(
      (
        await browser.send("POST", "/v1/profile/password", {
          password: NEW_PASSWORD,
          stepUpToken: stepUp.json().stepUpToken,
        })
      ).statusCode,
    ).toBe(200);
    const changed = (await journal(space, id)).filter((r) => r["event"] === "session-ended");
    expect(changed).toEqual([
      expect.objectContaining({ reason: "password-change", ip: "203.0.113.10", actor: "user" }),
    ]);
    for (let i = 0; i < 5; i++)
      await browser.send("POST", "/v1/session/step-up", { action: "password-change", password: WRONG });
    await flush();
    const tail = (await journal(space, id)).slice(-2);
    // The session's end is written as its transaction commits, the lock right after it.
    expect(tail).toEqual([
      expect.objectContaining({ event: "session-ended", reason: "step-up-locked", ip: "203.0.113.10" }),
      expect.objectContaining({ event: "sign-in-locked", reason: "step-up", ip: "203.0.113.10" }),
    ]);
  });

  it("a session nobody came back to is ended by the daily task: written once, by the system, without an address", async () => {
    const { id, space } = await signedIn("swept");
    t += 13 * HOUR;
    await maintenance().dailyCleanup();
    await maintenance().dailyCleanup();
    const ends = (await journal(space, id)).filter((r) => r["event"] === "session-ended");
    expect(ends).toEqual([
      expect.objectContaining({
        reason: "expired",
        ip: null,
        device: null,
        actor: "system",
        channel: "system",
      }),
    ]);
  });
});

describe("NFR-15@PoC FR 29: the sign-in records are deleted together with the space", () => {
  it("erasing the space's audit log deletes its sign-in journal; the neighbour's stays", async () => {
    const mine = await signedIn("erase-mine");
    const other = await signedIn("erase-other");
    await mine.browser.send("DELETE", "/v1/session");
    const erased = await withTestErasureDatabases(db, (era) =>
      createAuditErasure(era.for("audit")).eraseHousehold(mine.space),
    );
    expect(erased.entries).toBeGreaterThanOrEqual(2);
    expect(await journal(mine.space, mine.id)).toEqual([]);
    expect(await journal(other.space, other.id)).toHaveLength(1);
  });
});

describe("ACC-04@PoC FR 4: a device is the browser and the system without versions (owner decision 2026-11-14)", () => {
  it("a browser update is the same device: no letter; another browser or system is new", async () => {
    const { email } = await signedIn("update");
    const from = mail.sent.length;
    await new Browser(CHROME_WINDOWS_NEXT, "198.51.100.70").signIn(email);
    await flush();
    expect(mail.sent.slice(from).filter((m) => m.to === email)).toEqual([]);
    await new Browser(FIREFOX_LINUX, "198.51.100.71").signIn(email);
    await flush();
    expect(mail.sent.slice(from).filter((m) => m.to === email)).toHaveLength(1);
  });

  it("the history kept before the decision (whole user agents) gives no extra letter: a known user agent is converted", async () => {
    const { email, id } = await signedIn("legacy");
    // The history as the previous release kept it: the SHA-256 of `device:<user agent>`, scheme 1.
    await db.owner.query(`DELETE FROM identity.sign_in_devices WHERE account_id = $1`, [id]);
    await db.owner.query(
      `INSERT INTO identity.sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at, key_scheme)
       VALUES ($1, sha256(convert_to('device:' || $2::text, 'UTF8')), '2026-01-01Z', '2026-01-01Z', 1)`,
      [id, SAFARI_IPHONE],
    );
    const from = mail.sent.length;
    await new Browser(SAFARI_IPHONE, "198.51.100.72").signIn(email);
    await flush();
    expect(mail.sent.slice(from).filter((m) => m.to === email)).toEqual([]);
    const { rows } = await db.owner.query<{ key_scheme: number; digest: string }>(
      `SELECT key_scheme, encode(device_digest, 'hex') AS digest FROM identity.sign_in_devices WHERE account_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ key_scheme: 2, digest: await sha256Hex("device:safari/ios") }]);
    // Now a browser update of that device gives no letter either.
    await new Browser(SAFARI_IPHONE.replace("Version/18.1", "Version/18.2"), "198.51.100.73").signIn(email);
    await flush();
    expect(mail.sent.slice(from).filter((m) => m.to === email)).toEqual([]);
  });

  it("new rows are scheme 2; the column's default (1) is what code of the previous release writes", async () => {
    const { rows } = await db.owner.query<{ d: string }>(
      `SELECT column_default AS d FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'sign_in_devices' AND column_name = 'key_scheme'`,
    );
    expect(rows[0]!.d).toBe("1");
    const { rows: schemes } = await db.owner.query<{ key_scheme: number }>(
      `SELECT DISTINCT key_scheme FROM identity.sign_in_devices WHERE first_seen_at >= to_timestamp($1 / 1000.0)`,
      [t - 30 * 24 * HOUR],
    );
    expect(schemes.map((r) => r.key_scheme)).toEqual([2]);
  });
});

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}
