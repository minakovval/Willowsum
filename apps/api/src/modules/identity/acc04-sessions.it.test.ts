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
  SESSION_IDLE_MS,
} from "./index.ts";

/**
 * ACC-04@PoC part a (server) on a real PostgreSQL through the real API: the fixed 15 min idle timeout and the 12 h
 * absolute end checked on the server, activity only through `POST /v1/session/refresh` (user actions), the shared
 * session of a browser's tabs, why a session ended (SESSION_ENDED), and refresh token rotation (NFR-01@PoC FR 10–12).
 * The clock is the test's own (`t`); a «browser» is its cookie jar (`Browser`), shared by its tabs.
 */
const WEB = "http://localhost:5173";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PASSWORD = "synthetic lower case words";
/** A token a refresh replaced still authenticates this long (other tabs' requests on their way). */
const ROTATION_GRACE = 30 * SECOND;

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 13, 8, 23, 41, 300);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];

let ipCounter = 0;
const nextIp = () => `192.0.2.${(++ipCounter % 250) + 1}`;
let seq = 0;
const nextEmail = (label: string) => `acc04-${label}.${++seq}@example.test`;

type Res = Awaited<ReturnType<typeof request>>;

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; cookie?: string | undefined } = {},
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

function setCookies(res: Res): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

/** One browser: its tabs share this cookie jar (the session cookie), as a real browser's tabs do. */
class Browser {
  cookie: string | undefined;
  /** Applies the answer's Set-Cookie to the jar, as the browser does. */
  take(res: Res): Res {
    for (const c of setCookies(res)) {
      if (!c.startsWith("session=")) continue;
      this.cookie = /Max-Age=0\b/.test(c) ? undefined : c.split(";")[0]!;
    }
    return res;
  }
  async send(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<Res> {
    return this.take(await request(method, url, { body, cookie: this.cookie }));
  }
  /** A user action in a tab: the web app sends a refresh (ACC-04 business rules). */
  act = () => this.send("POST", "/v1/session/refresh");
  /** A background request: data reload, polling of an import (never a refresh). */
  background = () => this.send("GET", "/v1/me/permissions");
  session = () => this.send("GET", "/v1/session");
}

async function confirmedAccount(label: string): Promise<string> {
  const email = nextEmail(label);
  const res = await request("POST", "/v1/registrations", {
    body: { name: "Ірина Сесійна", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await Promise.all(pending.splice(0));
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  const token = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
  expect((await request("POST", "/v1/email-confirmations", { body: { token } })).json()).toEqual({
    result: "confirmed",
  });
  return email;
}

async function signedIn(label: string): Promise<{ browser: Browser; email: string }> {
  const email = await confirmedAccount(label);
  const browser = new Browser();
  const res = await browser.send("POST", "/v1/sessions", { email, password: PASSWORD });
  expect(res.json()).toEqual({ status: "signed-in" });
  expect(browser.cookie).toMatch(/^session=[A-Za-z0-9_-]{43}$/);
  return { browser, email };
}

function expectEnded(res: Res, reason: "idle" | "expired" | "signed-out" | "ended-elsewhere"): void {
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: reason });
}

async function sessionRows(email: string) {
  const { rows } = await db.owner.query<{
    ended_at: Date | null;
    end_reason: string | null;
    last_seen_at: Date;
    token_digest: Buffer;
  }>(
    `SELECT s.ended_at, s.end_reason, s.last_seen_at, s.token_digest FROM identity.sessions s
       JOIN identity.accounts a ON a.id = s.account_id WHERE a.email_normalized = $1 ORDER BY s.created_at`,
    [email],
  );
  return rows;
}

beforeAll(async () => {
  db = await setupRealModules(4);
  const spaces = householdSpaces(db);
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: createAuditLog(db.databases.for("audit")),
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
  t += 13 * HOUR + 7 * MINUTE + 11 * SECOND;
});

describe("ACC-04@PoC AC1: 15 min without a user action → the server ends the session; the next request gets the sign-in screen", () => {
  it("14 min 59 s keeps it; at 15 min every request is refused and the session reads «ended: idle»; no countdown", async () => {
    const { browser, email } = await signedIn("ac1");
    t += SESSION_IDLE_MS - SECOND;
    expect((await browser.background()).statusCode).toBe(200);
    t += SECOND;
    // The protected route: plain 401 (the API shows nothing more to a route); the session is ended on the server.
    const next = await browser.background();
    expect(next.statusCode).toBe(401);
    expect(next.json().code).toBe("UNAUTHENTICATED");
    const [row] = await sessionRows(email);
    expect(row!.ended_at?.getTime()).toBe(t);
    expect(row!.end_reason).toBe("idle");
    // The web app asks why: «Сесію завершено через бездіяльність»; the cookie is removed.
    const why = await browser.session();
    expectEnded(why, "idle");
    expect(setCookies(why)).toEqual(["session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"]);
    expect(browser.cookie).toBeUndefined();
  });

  it("the timeout is fixed and refresh answers carry no countdown or warning, only the fixed 15 min", async () => {
    const { browser } = await signedIn("ac1-fixed");
    const res = await browser.act();
    expect(res.json()).toEqual({ status: "active", idleTimeoutS: 900, expiresInS: expect.any(Number) });
  });
});

describe("ACC-04@PoC FR 1: timeout and absolute end are checked on the server; only user actions extend the session", () => {
  it("background requests every 5 min do not extend it; a refresh every 10 min does", async () => {
    const bg = await signedIn("fr1-bg");
    for (let i = 0; i < 2; i++) {
      t += 5 * MINUTE;
      expect((await bg.browser.background()).statusCode).toBe(200);
      expect((await bg.browser.session()).statusCode).toBe(200);
    }
    t += 5 * MINUTE; // 15 min after sign-in, the last user action
    expect((await bg.browser.background()).statusCode).toBe(401);
    expectEnded(await bg.browser.session(), "idle");

    const active = await signedIn("fr1-active");
    for (let i = 0; i < 6; i++) {
      t += 10 * MINUTE;
      expect((await active.browser.act()).statusCode).toBe(200);
    }
    expect((await active.browser.background()).statusCode).toBe(200);
    t += SESSION_IDLE_MS;
    expect((await active.browser.background()).statusCode).toBe(401);
  });

  it("a refresh cannot revive an ended session, and an unknown cookie is just «not signed in»", async () => {
    const { browser } = await signedIn("fr1-revive");
    t += SESSION_IDLE_MS;
    const stale = browser.cookie;
    expectEnded(await browser.act(), "idle");
    expectEnded(await request("POST", "/v1/session/refresh", { cookie: stale }), "idle");
    expect((await request("GET", "/v1/me/permissions", { cookie: stale })).statusCode).toBe(401);
    const unknown = await request("POST", "/v1/session/refresh", { cookie: `session=${"B".repeat(43)}` });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().code).toBe("UNAUTHENTICATED");
    expect((await request("POST", "/v1/session/refresh")).json().code).toBe("UNAUTHENTICATED");
  });

  it("a refresh from another site is refused before anything runs (NFR-15 FR 5)", async () => {
    const { browser, email } = await signedIn("fr1-origin");
    const before = (await sessionRows(email))[0]!;
    const res = await app.inject({
      method: "POST",
      url: "/v1/session/refresh",
      remoteAddress: nextIp(),
      headers: { origin: "https://evil.example", cookie: browser.cookie! },
    });
    expect(res.statusCode).toBe(403);
    expect(setCookies(res)).toEqual([]);
    const after = (await sessionRows(email))[0]!;
    expect(after.last_seen_at.getTime()).toBe(before.last_seen_at.getTime());
    expect(after.token_digest.equals(before.token_digest)).toBe(true);
  });
});

describe("ACC-04@PoC AC3, FR 3: the tabs of one browser share the timer; sign-out in one signs out all", () => {
  it("work in tab 1 keeps tab 2 signed in past the timeout; sign-out in tab 2 ends tab 1 too", async () => {
    const { browser } = await signedIn("ac3");
    // Both tabs use the browser's one cookie jar; only tab 1 has user actions.
    const tab1 = browser;
    const tab2 = browser;
    for (let i = 0; i < 4; i++) {
      t += 8 * MINUTE;
      expect((await tab1.act()).statusCode).toBe(200);
    }
    // Tab 2 has been inactive for 32 min, longer than the timeout: its next request still works.
    expect((await tab2.background()).statusCode).toBe(200);
    const signedOutCookie = tab2.cookie;
    expect((await tab2.send("DELETE", "/v1/session")).json()).toEqual({ status: "signed-out" });
    expect(tab1.cookie).toBeUndefined();
    // A request of tab 1 that still carried the cookie: signed out as well.
    expectEnded(await request("GET", "/v1/session", { cookie: signedOutCookie }), "signed-out");
    expect((await request("GET", "/v1/me/permissions", { cookie: signedOutCookie })).statusCode).toBe(401);
  });

  it("a request of the other tab sent with the cookie just replaced still works (30 s grace)", async () => {
    const { browser } = await signedIn("ac3-grace");
    const inFlight = browser.cookie;
    t += 2 * MINUTE;
    await browser.act(); // tab 1: the cookie rotates
    t += 20 * SECOND;
    expect((await request("GET", "/v1/me/permissions", { cookie: inFlight })).statusCode).toBe(200);
    // Tab 2's own user action with the replaced cookie: the session is extended, no new token is handed out.
    const late = await request("POST", "/v1/session/refresh", { cookie: inFlight });
    expect(late.statusCode).toBe(200);
    expect(setCookies(late)).toEqual([]);
    expect((await browser.background()).statusCode).toBe(200);
  });
});

describe("ACC-04@PoC AC5: a session ends 12 h after sign-in even when the user is always active", () => {
  it("refreshes every 10 min keep it until 12 h; the cookie never outlives the end; then «ended: expired»", async () => {
    const { browser, email } = await signedIn("ac5");
    const start = t;
    while (t + 10 * MINUTE < start + SESSION_ABSOLUTE_MS) {
      t += 10 * MINUTE;
      const res = await browser.act();
      expect(res.statusCode).toBe(200);
      const left = Math.floor((start + SESSION_ABSOLUTE_MS - t) / 1000);
      expect(res.json().expiresInS).toBe(left);
      expect(setCookies(res)[0]).toContain(`Max-Age=${left};`);
    }
    t = start + SESSION_ABSOLUTE_MS;
    expect((await browser.background()).statusCode).toBe(401);
    expectEnded(await browser.session(), "expired");
    expect((await sessionRows(email))[0]!.end_reason).toBe("expired");
  });
});

describe("ACC-04@PoC EC2: the browser slept longer than the timeout → the sign-in screen after waking", () => {
  it("the first requests after waking (a reload, then a user action) both meet «ended: idle»", async () => {
    const { browser } = await signedIn("ec2");
    t += 3 * MINUTE;
    await browser.act();
    const asleep = browser.cookie;
    t += 47 * MINUTE; // lid closed
    expect((await request("GET", "/v1/me/permissions", { cookie: asleep })).statusCode).toBe(401);
    expectEnded(await request("POST", "/v1/session/refresh", { cookie: asleep }), "idle");
    expectEnded(await request("GET", "/v1/session", { cookie: asleep }), "idle");
  });
});

describe("NFR-01@PoC FR 12: refresh tokens rotate at every use; a reused token ends the session", () => {
  it("every refresh hands out a new token; only digests are stored; the old token fails after 30 s and takes the session with it", async () => {
    const { browser, email } = await signedIn("rotation");
    const first = browser.cookie!;
    t += MINUTE;
    const res = await browser.act();
    const second = browser.cookie!;
    expect(second).not.toBe(first);
    expect(setCookies(res)[0]).toMatch(
      /^session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
    );
    const dump = JSON.stringify(
      (await db.owner.query(`SELECT * FROM identity.sessions`)).rows.concat(
        (await db.owner.query(`SELECT * FROM identity.retired_session_tokens`)).rows,
      ),
    );
    for (const value of [first, second]) expect(dump).not.toContain(value.split("=")[1]);
    t += MINUTE;
    await browser.act();
    expect(browser.cookie).not.toBe(second);

    // The first token comes back (it was copied): the whole session ends, the current token with it.
    t += 31 * SECOND;
    expectEnded(await request("GET", "/v1/session", { cookie: first }), "ended-elsewhere");
    expect((await browser.background()).statusCode).toBe(401);
    expectEnded(await browser.session(), "ended-elsewhere");
    expect((await sessionRows(email))[0]!.end_reason).toBe("token-reuse");
  });

  it("a protected route with a reused token is refused too, and ends the session", async () => {
    const { browser } = await signedIn("rotation-route");
    const first = browser.cookie!;
    await browser.act();
    t += ROTATION_GRACE;
    expect((await request("GET", "/v1/me/permissions", { cookie: first })).statusCode).toBe(401);
    expectEnded(await browser.session(), "ended-elsewhere");
  });

  it("two refreshes with one token at the same time: one rotation; the session stays usable", async () => {
    const { browser, email } = await signedIn("rotation-race");
    const cookie = browser.cookie;
    t += MINUTE;
    const both = await Promise.all([
      request("POST", "/v1/session/refresh", { cookie }),
      request("POST", "/v1/session/refresh", { cookie }),
    ]);
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    const handed = both.flatMap(setCookies);
    expect(handed).toHaveLength(1);
    browser.take(both.find((r) => setCookies(r).length > 0)!);
    t += ROTATION_GRACE;
    expect((await browser.act()).statusCode).toBe(200);
    expect((await sessionRows(email))[0]!.ended_at).toBeNull();
  });
});

describe("sec190 mutation killers: refresh rotation under real concurrency (NFR-01@PoC FR 12)", () => {
  it("two refreshes that both wait on the session row: exactly one rotation, the other rides the 30 s grace", async () => {
    const { browser, email } = await signedIn("rotation-held");
    const cookie = browser.cookie;
    t += MINUTE;
    // Hold the session row so both refreshes are in flight together (inject alone runs them one after another).
    await db.owner.query("BEGIN");
    await db.owner.query(
      `SELECT s.id FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id
        WHERE a.email_normalized = $1 FOR UPDATE OF s`,
      [email],
    );
    const both = Promise.all([
      request("POST", "/v1/session/refresh", { cookie }),
      request("POST", "/v1/session/refresh", { cookie }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await db.owner.query("COMMIT");
    const answers = await both;
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(answers.flatMap(setCookies)).toHaveLength(1);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.retired_session_tokens r JOIN identity.sessions s ON s.id = r.session_id
         JOIN identity.accounts a ON a.id = s.account_id WHERE a.email_normalized = $1`,
      [email],
    );
    expect(rows[0]!.n).toBe(1);
    browser.take(answers.find((r) => setCookies(r).length > 0)!);
    t += ROTATION_GRACE;
    expect((await browser.act()).statusCode).toBe(200);
    expect((await sessionRows(email))[0]!.ended_at).toBeNull();
  });
});

describe("NFR-01@PoC AC5: revoked sessions cannot make a request (a password reset; «з іншого пристрою»)", () => {
  it("a reset in another browser ends this one at once; its next request reads «ended elsewhere»", async () => {
    const { browser, email } = await signedIn("reset");
    await request("POST", "/v1/password-resets", { body: { email } });
    await Promise.all(pending.splice(0));
    const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
    const token = /\/password\/reset\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
    const done = await request("POST", "/v1/password-resets/complete", {
      body: { token, password: "another synthetic phrase" },
    });
    expect(done.json()).toEqual({ status: "password-changed" });
    expect((await browser.background()).statusCode).toBe(401);
    expectEnded(await browser.act(), "ended-elsewhere");
    expect((await sessionRows(email))[0]!.end_reason).toBe("password-reset");
  });
});

describe("ADR-0010: the daily task sweeps sessions past their absolute end with their replaced tokens", () => {
  it("an ended session and its retired tokens are gone after the sweep", async () => {
    const { browser, email } = await signedIn("sweep");
    await browser.act();
    await browser.act();
    await browser.send("DELETE", "/v1/session");
    t += SESSION_ABSOLUTE_MS;
    await createIdentityMaintenance({
      db: db.databases.for("identity"),
      audit: createAuditLog(db.databases.for("audit")),
      now: () => t,
    }).dailyCleanup();
    expect(await sessionRows(email)).toEqual([]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.retired_session_tokens r
        LEFT JOIN identity.sessions s ON s.id = r.session_id WHERE s.id IS NULL`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("ACC-04@PoC AC1, EC2: the reason survives the daily task until the browser drops the cookie (12 h)", () => {
  const sweep = () =>
    createIdentityMaintenance({
      db: db.databases.for("identity"),
      audit: createAuditLog(db.databases.for("audit")),
      now: () => t,
    }).dailyCleanup();

  it("idle overnight with the daily task in between: the next request still reads «ended: idle»", async () => {
    const { browser } = await signedIn("sweep-idle");
    t += SESSION_IDLE_MS + HOUR; // the lid is closed; the daily task runs at night
    await sweep();
    expectEnded(await browser.session(), "idle");
  });

  it("a reset elsewhere, then the daily task: the next request still reads «ended elsewhere»", async () => {
    const { browser, email } = await signedIn("sweep-reset");
    await request("POST", "/v1/password-resets", { body: { email } });
    await Promise.all(pending.splice(0));
    const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
    const token = /\/password\/reset\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
    await request("POST", "/v1/password-resets/complete", {
      body: { token, password: "another synthetic phrase" },
    });
    await sweep();
    expectEnded(await browser.session(), "ended-elsewhere");
  });

  it("at the absolute end the browser drops the cookie (Max-Age), so the row goes with it", async () => {
    const { email } = await signedIn("sweep-expired");
    t += SESSION_ABSOLUTE_MS;
    await sweep();
    expect(await sessionRows(email)).toEqual([]);
  });
});
