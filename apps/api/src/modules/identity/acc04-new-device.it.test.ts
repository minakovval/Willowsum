import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityMaintenance, createIdentityServices } from "./index.ts";

/**
 * ACC-04@PoC part a2 (server) on a real PostgreSQL through the real API: the sign-in history, the new-device
 * letter and «Це був не я» (ACC-04@PoC FR 4, FR 5, AC6, AC7), with NFR-15@PoC FR 6, FR 7, FR 29 and NFR-01@PoC
 * FR 12. The clock is the test's own (`t`); a device is the browser and system of the request's user agent.
 */
const WEB = "http://localhost:5173";
const telemetry = testTelemetryForFile();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = "synthetic lower case words";
const NEW_PASSWORD = "another synthetic passphrase";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHROME_WINDOWS_NEXT = CHROME_WINDOWS.replace("Chrome/131", "Chrome/132");
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

/** Holds the next password check until `release()`, so a test can run another request while a sign-in is inside it. */
const verifyGate: { entered: (() => void) | null; wait: Promise<void> | null } = {
  entered: null,
  wait: null,
};
const inner = argon2Hasher();
const gatedHasher = {
  hash: inner.hash,
  verify: async (phc: string, password: string) => {
    const wait = verifyGate.wait;
    if (wait) {
      verifyGate.wait = null;
      verifyGate.entered?.();
      await wait;
    }
    return inner.verify(phc, password);
  },
};

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 14, 9, 12, 7, 0);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
const flush = () => Promise.all(pending.splice(0));

let ipCounter = 0;
const nextIp = () => `192.0.2.${(++ipCounter % 250) + 1}`;
let seq = 0;
const nextEmail = (label: string) => `acc04a2-${label}.${++seq}@example.test`;

type Res = Awaited<ReturnType<typeof request>>;

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

/** One browser on one device: its user agent and its cookie jar. */
class Browser {
  cookie: string | undefined;
  readonly userAgent: string;
  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }
  take(res: Res): Res {
    for (const c of setCookies(res)) {
      if (!c.startsWith("session=")) continue;
      this.cookie = /Max-Age=0\b/.test(c) ? undefined : c.split(";")[0]!;
    }
    return res;
  }
  async send(method: "GET" | "POST" | "DELETE", url: string, body?: unknown, ip?: string): Promise<Res> {
    return this.take(
      await request(method, url, {
        body,
        cookie: this.cookie,
        userAgent: this.userAgent,
        ...(ip ? { ip } : {}),
      }),
    );
  }
  signIn = (email: string, password = PASSWORD, ip?: string) =>
    this.send("POST", "/v1/sessions", { email, password }, ip);
  session = () => this.send("GET", "/v1/session");
}

async function confirmedAccount(label: string): Promise<string> {
  const email = nextEmail(label);
  const res = await request("POST", "/v1/registrations", {
    body: { name: "Олена Безпекова", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await flush();
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  const token = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
  expect((await request("POST", "/v1/email-confirmations", { body: { token } })).json()).toEqual({
    result: "confirmed",
  });
  return email;
}

/** The letters of an address since `from` (an index into the outbox). */
const lettersTo = (email: string, from = 0) => mail.sent.slice(from).filter((m) => m.to === email);
const newDeviceLetters = (email: string, from = 0) =>
  lettersTo(email, from).filter((m) => m.subject === "Новий вхід у ваш акаунт Willowsum");
const notMeToken = (text: string) => /\/#\/not-me\?token=([A-Za-z0-9_-]{43})$/m.exec(text)?.[1];
const resetToken = (text: string) => /\/#\/password\/reset\?token=([A-Za-z0-9_-]{43})$/m.exec(text)?.[1];

/** An account signed in once on Chrome/Windows (its history starts) and then on Firefox/Linux: the letter's token. */
async function suspiciousSignIn(label: string) {
  const email = await confirmedAccount(label);
  const owner = new Browser(CHROME_WINDOWS);
  expect((await owner.signIn(email)).json()).toEqual({ status: "signed-in" });
  const intruder = new Browser(FIREFOX_LINUX);
  const from = mail.sent.length;
  expect((await intruder.signIn(email, PASSWORD, "198.51.100.77")).json()).toEqual({ status: "signed-in" });
  await flush();
  const [letter] = newDeviceLetters(email, from);
  const token = notMeToken(letter!.text)!;
  expect(token).toBeDefined();
  return { email, owner, intruder, token, signedInAt: t };
}

const check = (token: string) => request("POST", "/v1/not-me-links/check", { body: { token } });
const confirm = (token: string, browser?: Browser) =>
  browser
    ? browser.send("POST", "/v1/not-me-links/confirm", { token })
    : request("POST", "/v1/not-me-links/confirm", { body: { token } });

async function accountId(email: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM identity.accounts WHERE email_normalized = $1`,
    [email],
  );
  return rows[0]!.id;
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
    hasher: gatedHasher,
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
  t += 2 * HOUR + 3 * MINUTE + 5 * SECOND;
});

describe("ACC-04@PoC AC6: a sign-in from a device or browser not in the account's history → the security letter with «Це був не я»", () => {
  it("the first sign-in of an account starts the history and sends no letter; the same device later sends none either", async () => {
    const email = await confirmedAccount("ac6-first");
    const from = mail.sent.length;
    const browser = new Browser(CHROME_WINDOWS);
    expect((await browser.signIn(email)).json()).toEqual({ status: "signed-in" });
    t += 3 * HOUR;
    expect((await new Browser(CHROME_WINDOWS).signIn(email)).json()).toEqual({ status: "signed-in" });
    await flush();
    expect(lettersTo(email, from)).toEqual([]);
  });

  it("a new browser gets the letter: to the account's email, naming the browser, system and time (UTC), with a one-time link", async () => {
    const email = await confirmedAccount("ac6-new");
    expect((await new Browser(CHROME_WINDOWS).signIn(email)).json()).toEqual({ status: "signed-in" });
    t += MINUTE;
    const from = mail.sent.length;
    expect((await new Browser(FIREFOX_LINUX).signIn(email)).json()).toEqual({ status: "signed-in" });
    await flush();
    const letters = lettersTo(email, from);
    expect(letters).toHaveLength(1);
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(letters[0]!.text).toContain(
      `Firefox на Linux, ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`,
    );
    expect(letters[0]!.text).toContain("Це був не я: http://localhost:5173/#/not-me?token=");
    expect(notMeToken(letters[0]!.text)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the SHA-256 of the token and of the device key are stored; no user agent text, no full address.
    const { rows } = await db.owner.query(`SELECT l.* FROM identity.not_me_links l WHERE l.account_id = $1`, [
      await accountId(email),
    ]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("Firefox/133");
    expect(rows[0].token_digest).toHaveLength(32);
  });

  it("a failed sign-in from a new device sends nothing and does not enter the history", async () => {
    const email = await confirmedAccount("ac6-failed");
    expect((await new Browser(CHROME_WINDOWS).signIn(email)).json()).toEqual({ status: "signed-in" });
    const from = mail.sent.length;
    expect((await new Browser(SAFARI_IPHONE).signIn(email, "a wrong synthetic password")).statusCode).toBe(
      401,
    );
    await flush();
    expect(lettersTo(email, from)).toEqual([]);
    // The device is still new for the next, successful sign-in.
    expect((await new Browser(SAFARI_IPHONE).signIn(email)).json()).toEqual({ status: "signed-in" });
    await flush();
    expect(newDeviceLetters(email, from)).toHaveLength(1);
  });
});

describe("ACC-04@PoC FR 4: a successful sign-in from a new device or browser sends the account's owner a letter with «Це був не я»", () => {
  it("two first sign-ins of one account at once from two devices: one starts the history, the other gets the letter", async () => {
    const email = await confirmedAccount("fr4-race");
    const from = mail.sent.length;
    const [a, b] = await Promise.all([
      new Browser(CHROME_WINDOWS).signIn(email),
      new Browser(FIREFOX_LINUX).signIn(email),
    ]);
    expect([a.json(), b.json()]).toEqual([{ status: "signed-in" }, { status: "signed-in" }]);
    await flush();
    expect(newDeviceLetters(email, from)).toHaveLength(1);
  });

  it("each new device sends its own letter once; after that it is known", async () => {
    const email = await confirmedAccount("fr4-each");
    await new Browser(CHROME_WINDOWS).signIn(email);
    const from = mail.sent.length;
    await new Browser(FIREFOX_LINUX).signIn(email);
    await new Browser(SAFARI_IPHONE).signIn(email);
    await new Browser(FIREFOX_LINUX).signIn(email);
    await flush();
    const letters = newDeviceLetters(email, from);
    expect(letters.map((m) => /: (\S+ на \S+), \d/.exec(m.text)![1])).toEqual([
      "Firefox на Linux",
      "Safari на iOS",
    ]);
  });
});

describe("NFR-15@PoC FR 6: a new device or browser at sign-in sends a warning letter to the account's owner", () => {
  it("the warning goes to the account's own address, not to anyone who typed it", async () => {
    const email = await confirmedAccount("nfr15-6");
    await new Browser(CHROME_WINDOWS).signIn(email.toUpperCase());
    const from = mail.sent.length;
    await new Browser(FIREFOX_LINUX).signIn(`  ${email.toUpperCase()} `);
    await flush();
    expect(mail.sent.slice(from).map((m) => m.to)).toEqual([email]);
  });
});

describe("NFR-15@PoC FR 29: a new device is its browser and system without versions, not the whole user agent", () => {
  it("another address or a browser update is the same device; another browser is new", async () => {
    const email = await confirmedAccount("nfr15-29");
    await new Browser(CHROME_WINDOWS).signIn(email, PASSWORD, "203.0.113.5");
    const from = mail.sent.length;
    await new Browser(CHROME_WINDOWS).signIn(email, PASSWORD, "198.51.100.9");
    await new Browser(CHROME_WINDOWS_NEXT).signIn(email);
    await flush();
    expect(lettersTo(email, from)).toEqual([]);
    await new Browser(FIREFOX_LINUX).signIn(email);
    await flush();
    expect(newDeviceLetters(email, from)).toHaveLength(1);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.sign_in_devices WHERE account_id = $1`,
      [await accountId(email)],
    );
    expect(rows[0]!.n).toBe(2);
  });
});

describe("ACC-04@PoC AC7: «Це був не я» → every session ends, a reset link by email, every sign-in refused until the password changes; reuse or 7 days → «Посилання недійсне»", () => {
  it("the confirmation page first shows the sign-in and changes nothing", async () => {
    const { email, owner, intruder, token, signedInAt } = await suspiciousSignIn("ac7-page");
    const res = await check(token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "valid",
      email,
      signedInAt: new Date(signedInAt).toISOString(),
      device: { browser: "firefox", os: "linux" },
      address: "198.51.•••.77",
    });
    // Opening the page twice changes nothing: both sessions live, the link still works.
    expect((await check(token)).statusCode).toBe(200);
    expect((await owner.session()).statusCode).toBe(200);
    expect((await intruder.session()).statusCode).toBe(200);
  });

  it("NFR-15@PoC AC1: the confirmation ends every session, sends a reset link and refuses every sign-in until the password changes", async () => {
    const { email, owner, intruder, token } = await suspiciousSignIn("ac7-confirm");
    const from = mail.sent.length;
    const res = await confirm(token, owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "secured" });
    expect(setCookies(res)).toEqual(["session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"]);
    // Every session of the account, on every device, has ended («з іншого пристрою»).
    const { rows } = await db.owner.query<{ ended_at: Date | null; end_reason: string | null }>(
      `SELECT ended_at, end_reason FROM identity.sessions WHERE account_id = $1`,
      [await accountId(email)],
    );
    expect(rows).toEqual([
      { ended_at: new Date(t), end_reason: "not-me" },
      { ended_at: new Date(t), end_reason: "not-me" },
    ]);
    const why = await intruder.session();
    expect(why.statusCode).toBe(401);
    expect(why.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: "ended-elsewhere" });
    // The reset link is on its way to the account's email.
    await flush();
    const reset = lettersTo(email, from);
    expect(reset.map((m) => m.subject)).toEqual(["Відновлення пароля у Willowsum"]);
    const link = resetToken(reset[0]!.text)!;
    // Any sign-in is refused, from any device, even with the right password; a wrong one stays a plain failure.
    for (const ua of [CHROME_WINDOWS, FIREFOX_LINUX]) {
      const refused = await new Browser(ua).signIn(email);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe("PASSWORD_RESET_REQUIRED");
      expect(setCookies(refused)).toEqual([]);
    }
    expect((await new Browser(CHROME_WINDOWS).signIn(email, "a wrong synthetic password")).json().code).toBe(
      "INVALID_CREDENTIALS",
    );
    // A new password lifts the refusal; the old password no longer works.
    expect(
      (
        await request("POST", "/v1/password-resets/complete", {
          body: { token: link, password: NEW_PASSWORD },
        })
      ).json(),
    ).toEqual({ status: "password-changed" });
    expect((await new Browser(CHROME_WINDOWS).signIn(email, PASSWORD)).json().code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect((await new Browser(CHROME_WINDOWS).signIn(email, NEW_PASSWORD)).json()).toEqual({
      status: "signed-in",
    });
  });

  it("opening the link again after the confirmation shows «Посилання недійсне»", async () => {
    const { token } = await suspiciousSignIn("ac7-reuse");
    expect((await confirm(token)).statusCode).toBe(200);
    for (const res of [await check(token), await confirm(token)]) {
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("NOT_ME_LINK_INVALID");
    }
  });

  it("the link is valid 7 days: a second before them it works, at 7 days it is «Посилання недійсне» and changes nothing", async () => {
    const early = await suspiciousSignIn("ac7-ttl-early");
    const late = await suspiciousSignIn("ac7-ttl-late");
    t += 7 * DAY - SECOND;
    expect((await check(early.token)).statusCode).toBe(200);
    t += SECOND;
    for (const res of [await check(late.token), await confirm(late.token)]) {
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("NOT_ME_LINK_INVALID");
    }
    expect((await new Browser(CHROME_WINDOWS).signIn(late.email)).json()).toEqual({ status: "signed-in" });
  });

  it("an unknown token gets the same «Посилання недійсне»", async () => {
    const res = await check("A".repeat(43));
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("NOT_ME_LINK_INVALID");
  });
});

describe("ACC-04@PoC FR 5: «Це був не я» ends every session and requires a password reset; a one-time token valid 7 days", () => {
  it("two confirmations of one link at once: one acts, the other is «Посилання недійсне»; one reset letter", async () => {
    const { email, token } = await suspiciousSignIn("fr5-race");
    const from = mail.sent.length;
    const results = await Promise.all([confirm(token), confirm(token)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 410]);
    await flush();
    expect(lettersTo(email, from)).toHaveLength(1);
  });

  it("the suspicious device leaves the history: after the new password its next sign-in is reported again", async () => {
    const { email, token } = await suspiciousSignIn("fr5-forget");
    const from = mail.sent.length;
    await confirm(token);
    await flush();
    const link = resetToken(lettersTo(email, from)[0]!.text)!;
    await request("POST", "/v1/password-resets/complete", { body: { token: link, password: NEW_PASSWORD } });
    const after = mail.sent.length;
    expect((await new Browser(CHROME_WINDOWS).signIn(email, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await new Browser(FIREFOX_LINUX).signIn(email, NEW_PASSWORD)).statusCode).toBe(200);
    await flush();
    expect(newDeviceLetters(email, after)).toHaveLength(1);
  });

  it("audit: the refusal of sign-ins and its end are written to the platform log, without an email", async () => {
    const { email, token } = await suspiciousSignIn("fr5-audit");
    const from = mail.sent.length;
    await confirm(token);
    await flush();
    const link = resetToken(lettersTo(email, from)[0]!.text)!;
    await request("POST", "/v1/password-resets/complete", { body: { token: link, password: NEW_PASSWORD } });
    const id = await accountId(email);
    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: "identity.account",
      id,
    });
    const signIn = entries.filter((e) => e.changes.some((c) => c.field === "sign_in"));
    expect(signIn.map((e) => e.changes)).toEqual([
      [{ field: "sign_in", before: "allowed", after: "password-reset-required", masked: false }],
      [{ field: "sign_in", before: "password-reset-required", after: "allowed", masked: false }],
    ]);
    expect(JSON.stringify(entries)).not.toContain(email);
  });
});

describe("NFR-15@PoC FR 7: «Це був не я» ends every session and requires a reset; the suspicious sign-in's time is kept for the parts without data", () => {
  it("the link keeps the time of the sign-in it is about; the daily task removes it once used", async () => {
    const { email, token, signedInAt } = await suspiciousSignIn("nfr15-7");
    const id = await accountId(email);
    const before = await db.owner.query<{ signed_in_at: Date }>(
      `SELECT signed_in_at FROM identity.not_me_links WHERE account_id = $1`,
      [id],
    );
    expect(before.rows).toEqual([{ signed_in_at: new Date(signedInAt) }]);
    await confirm(token);
    const report = await createIdentityMaintenance({
      db: db.databases.for("identity"),
      audit: createAuditLog(db.databases.for("audit")),
      spaces: householdSpaces(db),
      now: () => t,
    }).dailyCleanup();
    expect(report.notMeLinks).toBeGreaterThanOrEqual(1);
    const after = await db.owner.query(`SELECT 1 FROM identity.not_me_links WHERE account_id = $1`, [id]);
    expect(after.rows).toEqual([]);
    // Answers like any unknown link.
    expect((await check(token)).statusCode).toBe(410);
  });
});

describe("NFR-01@PoC FR 12: «Це був не я» revokes every session of the account at once (≤ 60 s)", () => {
  it("the next request of every browser after the confirmation is refused, with no time passing", async () => {
    const { owner, intruder, token } = await suspiciousSignIn("nfr01-12");
    expect((await owner.send("POST", "/v1/session/refresh")).statusCode).toBe(200);
    await confirm(token);
    for (const b of [owner, intruder]) {
      const res = await b.send("POST", "/v1/session/refresh");
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: "ended-elsewhere" });
    }
  });
});

describe("ACC-04@PoC FR 5, NFR-01@PoC FR 12: «Це був не я» against a sign-in in flight, earlier reset links, isolation and telemetry", () => {
  it("a sign-in whose password check is under way when «Це був не я» is confirmed leaves no live session behind", async () => {
    const { email, token } = await suspiciousSignIn("sec198-race");
    const id = await accountId(email);
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    verifyGate.entered = entered;
    verifyGate.wait = new Promise<void>((r) => (release = r));
    const browser = new Browser(CHROME_WINDOWS);
    const signingIn = browser.signIn(email);
    await inside;
    // The sign-in has read the account (no refusal yet) and checks the password. The confirmation starts now: it
    // must wait for that sign-in (the account row is read FOR SHARE) and end the session it creates.
    const confirming = confirm(token);
    await new Promise((r) => setTimeout(r, 400));
    release();
    const [signed, secured] = await Promise.all([signingIn, confirming]);
    expect(secured.statusCode).toBe(200);
    expect([200, 403]).toContain(signed.statusCode);
    const live = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.sessions WHERE account_id = $1 AND ended_at IS NULL`,
      [id],
    );
    expect(live.rows[0]!.n).toBe(0);
    expect((await browser.session()).statusCode).toBe(401);
  });

  it("reset links issued before the confirmation stop working; only the fresh one from the confirmation does", async () => {
    const { email, token } = await suspiciousSignIn("sec198-revoke");
    const askedFrom = mail.sent.length;
    expect((await request("POST", "/v1/password-resets", { body: { email } })).statusCode).toBe(200);
    await flush();
    const earlier = resetToken(lettersTo(email, askedFrom).at(-1)!.text)!;
    expect(earlier).toBeDefined();
    const from = mail.sent.length;
    expect((await confirm(token)).statusCode).toBe(200);
    await flush();
    const fresh = resetToken(lettersTo(email, from)[0]!.text)!;
    expect(fresh).not.toBe(earlier);
    const old = await request("POST", "/v1/password-resets/complete", {
      body: { token: earlier, password: NEW_PASSWORD },
    });
    expect(old.statusCode).toBe(410);
    expect(old.json().code).toBe("RESET_LINK_INVALID");
    // The account is still refused until the fresh link changes the password.
    expect((await new Browser(CHROME_WINDOWS).signIn(email)).statusCode).toBe(403);
    expect(
      (
        await request("POST", "/v1/password-resets/complete", {
          body: { token: fresh, password: NEW_PASSWORD },
        })
      ).json(),
    ).toEqual({ status: "password-changed" });
  });

  it("one account's link never ends another account's sessions or refuses its sign-in", async () => {
    const mine = await suspiciousSignIn("sec198-iso-a");
    const other = await suspiciousSignIn("sec198-iso-b");
    expect((await confirm(mine.token)).statusCode).toBe(200);
    expect((await other.owner.session()).statusCode).toBe(200);
    expect((await other.intruder.session()).statusCode).toBe(200);
    expect((await new Browser(CHROME_WINDOWS).signIn(other.email)).json()).toEqual({ status: "signed-in" });
    expect((await new Browser(CHROME_WINDOWS).signIn(mine.email)).statusCode).toBe(403);
    // The other account's link still works.
    expect((await check(other.token)).statusCode).toBe(200);
  });

  it("neither the user agent, the address, the token nor the email reaches the exported telemetry", async () => {
    telemetry.memory.reset();
    const { email, token } = await suspiciousSignIn("sec198-telemetry");
    await check(token);
    expect((await confirm(token)).statusCode).toBe(200);
    await flush();
    const text = await exportedText(telemetry);
    expect(text.length).toBeGreaterThan(100);
    for (const value of [email, email.split("@")[0]!, token, "Firefox/133", "198.51.100.77", "198.51.100"])
      expect(text, value).not.toContain(value);
  });
});
