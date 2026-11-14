import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityServices } from "./index.ts";

/**
 * ACC-05@PoC part a (server) on a real PostgreSQL through the real API: the profile (name, read-only email, the
 * format and time zone taken from the browser at sign-up) and the password change with step-up by the current
 * password (NFR-01@PoC FR 12, FR 13; NFR-15@PoC FR 4, AC2, AC5; ACC-04@PoC FR 6). The clock is the test's own (`t`).
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
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 14, 10, 4, 11, 0);
let profileFlagOn = true;
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
const flush = () => Promise.all(pending.splice(0));

let ipCounter = 0;
const nextIp = () => `192.0.2.${(++ipCounter % 250) + 1}`;
let seq = 0;
const nextEmail = (label: string) => `acc05a-${label}.${++seq}@example.test`;

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Res = Awaited<ReturnType<typeof request>>;

function request(
  method: Method,
  url: string,
  options: { body?: unknown; cookie?: string | undefined; userAgent?: string } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: nextIp(),
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

/** One browser: its user agent and its cookie jar. */
class Browser {
  cookie: string | undefined;
  constructor(readonly userAgent = CHROME_WINDOWS) {}
  take(res: Res): Res {
    for (const c of setCookies(res)) {
      if (!c.startsWith("session=")) continue;
      this.cookie = /Max-Age=0\b/.test(c) ? undefined : c.split(";")[0]!;
    }
    return res;
  }
  async send(method: Method, url: string, body?: unknown): Promise<Res> {
    return this.take(await request(method, url, { body, cookie: this.cookie, userAgent: this.userAgent }));
  }
  signIn = (email: string, password = PASSWORD, captchaToken?: string) =>
    this.send("POST", "/v1/sessions", { email, password, ...(captchaToken ? { captchaToken } : {}) });
  session = () => this.send("GET", "/v1/session");
  profile = () => this.send("GET", "/v1/profile");
  stepUp = (password = PASSWORD, action = "password-change") =>
    this.send("POST", "/v1/session/step-up", { action, password });
  changePassword = (password: string, stepUpToken: string) =>
    this.send("POST", "/v1/profile/password", { password, stepUpToken });
}

async function confirmedAccount(
  label: string,
  extra: { locale?: string; timeZone?: string; name?: string } = {},
): Promise<string> {
  const email = nextEmail(label);
  const res = await request("POST", "/v1/registrations", {
    body: {
      name: extra.name ?? "Олена Профільна",
      email,
      password: PASSWORD,
      captchaToken: SYNTHETIC_CAPTCHA_PASS,
      ...(extra.locale !== undefined ? { locale: extra.locale } : {}),
      ...(extra.timeZone !== undefined ? { timeZone: extra.timeZone } : {}),
    },
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

async function signedIn(label: string, extra: Parameters<typeof confirmedAccount>[1] = {}) {
  const email = await confirmedAccount(label, extra);
  const browser = new Browser();
  expect((await browser.signIn(email)).json()).toEqual({ status: "signed-in" });
  return { email, browser };
}

/** A step-up token of the browser's session for the password change. */
async function stepUpToken(browser: Browser, password = PASSWORD): Promise<string> {
  const res = await browser.stepUp(password);
  expect(res.statusCode).toBe(200);
  const body = res.json() as { stepUpToken: string; expiresInS: number };
  expect(body.expiresInS).toBe(300);
  expect(body.stepUpToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return body.stepUpToken;
}

const lettersTo = (email: string, from = 0) => mail.sent.slice(from).filter((m) => m.to === email);

async function accountId(email: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM identity.accounts WHERE email_normalized = $1`,
    [email],
  );
  return rows[0]!.id;
}

async function auditEntries(email: string) {
  return createAuditLog(db.databases.for("audit")).platformEntriesFor({
    type: "identity.account",
    id: await accountId(email),
  });
}

const code = (res: Res) => (res.json() as { code?: string }).code;

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
        flags: {
          ...fakeFlags(),
          isEnabledForAll: async (flag: string) => flag !== "identity.profile" || profileFlagOn,
        },
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
  profileFlagOn = true;
});

describe("ACC-05@PoC FR 1: the profile shows the name and the email (read only); no avatar and no phone", () => {
  it("GET /v1/profile answers the session's account: name, email, format and time zone — nothing else", async () => {
    const { email, browser } = await signedIn("fr1", { locale: "uk-UA", timeZone: "Europe/Kyiv" });
    const res = await browser.profile();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: "Олена Профільна",
      email,
      locale: "uk-UA",
      timeZone: "Europe/Kyiv",
    });
  });

  it("without a session → 401 UNAUTHENTICATED; after sign-out → 401 SESSION_ENDED", async () => {
    expect(code(await request("GET", "/v1/profile"))).toBe("UNAUTHENTICATED");
    const { browser } = await signedIn("fr1-out");
    const cookie = browser.cookie;
    await browser.send("DELETE", "/v1/session");
    const res = await request("GET", "/v1/profile", { cookie });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: "signed-out" });
  });

  it("the profile routes are behind the release flag identity.profile: off → 404 as an unknown path", async () => {
    const { browser } = await signedIn("fr1-flag");
    profileFlagOn = false;
    expect((await browser.profile()).statusCode).toBe(404);
    expect((await browser.send("PATCH", "/v1/profile", { name: "Інше Ім'я" })).statusCode).toBe(404);
    expect((await browser.stepUp()).statusCode).toBe(404);
    profileFlagOn = true;
    expect((await browser.profile()).json()).toMatchObject({ name: "Олена Профільна" });
  });
});

describe("ACC-05@PoC AC1: the name is saved, and another tab or device shows it when it loads again", () => {
  it("a new name is saved; the other device's next load (GET /v1/session, GET /v1/profile) shows it; audit without the name", async () => {
    const { email, browser } = await signedIn("ac1");
    const other = new Browser(FIREFOX_LINUX);
    expect((await other.signIn(email)).json()).toEqual({ status: "signed-in" });
    const saved = await browser.send("PATCH", "/v1/profile", { name: "  Олена Нова  " });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ name: "Олена Нова", email });
    expect((await other.session()).json()).toEqual({ name: "Олена Нова", email });
    expect((await other.profile()).json()).toMatchObject({ name: "Олена Нова" });
    const entries = await auditEntries(email);
    const named = entries.filter((e) => e.changes.some((c) => c.field === "display_name"));
    expect(named.map((e) => [e.action, e.changes])).toEqual([
      ["update", [{ field: "display_name", before: "•••", after: "•••", masked: true }]],
    ]);
    expect(JSON.stringify(entries)).not.toContain("Олена");
    expect(JSON.stringify(entries)).not.toContain(email);
  });

  it("an empty, too long or multi-line name is refused (400) and nothing changes; only the caller's own profile changes", async () => {
    const { email, browser } = await signedIn("ac1-invalid");
    const { email: otherEmail, browser: otherBrowser } = await signedIn("ac1-someone");
    for (const name of ["   ", "x".repeat(101), "Олена\nНова"]) {
      const res = await browser.send("PATCH", "/v1/profile", { name });
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("VALIDATION_FAILED");
    }
    expect((await browser.profile()).json()).toMatchObject({ name: "Олена Профільна", email });
    // No route takes an account id: a change reaches only the session's own account.
    await browser.send("PATCH", "/v1/profile", { name: "Тільки Своє" });
    expect((await otherBrowser.profile()).json()).toMatchObject({
      name: "Олена Профільна",
      email: otherEmail,
    });
  });
});

describe("ACC-05@PoC FR 2: another tab or device shows a profile change when it loads or regains focus", () => {
  it("every read answers the stored profile (no cache): a reload after the change shows it", async () => {
    const { email, browser } = await signedIn("fr2");
    const other = new Browser(FIREFOX_LINUX);
    await other.signIn(email);
    expect((await other.profile()).json()).toMatchObject({ name: "Олена Профільна" });
    await browser.send("PATCH", "/v1/profile", { name: "Олена Після" });
    const reread = await other.profile();
    expect(reread.json()).toMatchObject({ name: "Олена Після" });
    expect(String(reread.headers["cache-control"])).toContain("no-store");
  });
});

describe("ACC-05@PoC AC3: the format of dates and numbers and the time zone come from the browser at sign-up", () => {
  it("the locale and time zone the browser sends are stored with the new account (locale in its canonical form)", async () => {
    const { browser } = await signedIn("ac3", { locale: "en-gb", timeZone: "America/New_York" });
    expect((await browser.profile()).json()).toMatchObject({ locale: "en-GB", timeZone: "America/New_York" });
  });

  it("an invalid locale or time zone is refused (400) and creates nothing", async () => {
    for (const extra of [{ locale: "not a locale" }, { timeZone: "Mars/Olympus_Mons" }]) {
      const email = nextEmail("ac3-invalid");
      const res = await request("POST", "/v1/registrations", {
        body: { name: "Олена", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS, ...extra },
      });
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("VALIDATION_FAILED");
      const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
        email,
      ]);
      expect(rows).toEqual([]);
    }
  });
});

describe("ACC-05@PoC FR 3: at sign-up the format and the time zone are taken from the browser's locale; one interface language", () => {
  it("a client that sends none leaves them empty (the web falls back to the browser's own)", async () => {
    const { browser } = await signedIn("fr3-none");
    expect((await browser.profile()).json()).toMatchObject({ locale: null, timeZone: null });
  });

  it("a new sign-up with the address of a confirmed account changes nothing of it; one of an unconfirmed account replaces them", async () => {
    const email = await confirmedAccount("fr3-taken", { locale: "uk-UA", timeZone: "Europe/Kyiv" });
    await request("POST", "/v1/registrations", {
      body: {
        name: "Хтось Інший",
        email,
        password: NEW_PASSWORD,
        captchaToken: SYNTHETIC_CAPTCHA_PASS,
        locale: "de-DE",
        timeZone: "Europe/Berlin",
      },
    });
    await flush();
    const browser = new Browser();
    await browser.signIn(email);
    expect((await browser.profile()).json()).toMatchObject({
      name: "Олена Профільна",
      locale: "uk-UA",
      timeZone: "Europe/Kyiv",
    });

    const unconfirmed = nextEmail("fr3-unconfirmed");
    for (const [locale, timeZone] of [
      ["uk-UA", "Europe/Kyiv"],
      ["pl-PL", "Europe/Warsaw"],
    ])
      await request("POST", "/v1/registrations", {
        body: {
          name: "Олена",
          email: unconfirmed,
          password: PASSWORD,
          captchaToken: SYNTHETIC_CAPTCHA_PASS,
          locale,
          timeZone,
        },
      });
    const { rows } = await db.owner.query(
      `SELECT locale, time_zone FROM identity.accounts WHERE email_normalized = $1`,
      [unconfirmed],
    );
    expect(rows).toEqual([{ locale: "pl-PL", time_zone: "Europe/Warsaw" }]);
  });
});

describe("ACC-05@PoC FR 4: no email change in this release; the server refuses a request to change it", () => {
  it("there is no route that changes the email: POST /v1/profile/email → 404", async () => {
    const { browser } = await signedIn("fr4");
    expect(
      (await browser.send("POST", "/v1/profile/email", { email: nextEmail("fr4-new") })).statusCode,
    ).toBe(404);
  });
});

describe("ACC-05@PoC AC6: the email is read only and a direct request to change it is refused without changing the address", () => {
  it("PATCH /v1/profile with an email (alone or with a name) → 400; the address and the name stay", async () => {
    const { email, browser } = await signedIn("ac6");
    const target = nextEmail("ac6-new");
    for (const body of [{ email: target }, { name: "Олена Нова", email: target }]) {
      const res = await browser.send("PATCH", "/v1/profile", body);
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("VALIDATION_FAILED");
    }
    expect((await browser.profile()).json()).toMatchObject({ name: "Олена Профільна", email });
    // The old address still signs in; the new one does not.
    expect((await new Browser().signIn(email)).json()).toEqual({ status: "signed-in" });
    expect((await new Browser().signIn(target)).statusCode).toBe(401);
  });
});

describe("ACC-05@PoC AC5: a password under 12 characters is refused; a valid one is saved only after step-up; the other sessions end, the current one stays; a security letter", () => {
  it("under 12 characters → 400 with the reason (too_small); the password is not changed", async () => {
    const { email, browser } = await signedIn("ac5-short");
    const token = await stepUpToken(browser);
    const res = await browser.changePassword("short pass1", token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ in: "body", path: "password", issue: "too_small" }],
    });
    expect((await new Browser().signIn(email)).json()).toEqual({ status: "signed-in" });
    // The refused request did not use the confirmation.
    expect((await browser.changePassword(NEW_PASSWORD, token)).statusCode).toBe(200);
  });

  it("without a step-up confirmation → 403 STEP_UP_REQUIRED and nothing changes", async () => {
    const { email, browser } = await signedIn("ac5-no-step-up");
    const res = await browser.changePassword(NEW_PASSWORD, "A".repeat(43));
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("STEP_UP_REQUIRED");
    expect((await new Browser().signIn(email)).json()).toEqual({ status: "signed-in" });
  });

  it("after step-up: the new password is saved, every other session ends at once, this one stays, a security letter goes", async () => {
    const { email, browser } = await signedIn("ac5-change");
    const second = new Browser(FIREFOX_LINUX);
    const third = new Browser(FIREFOX_LINUX);
    await second.signIn(email);
    await third.signIn(email);
    const token = await stepUpToken(browser);
    const from = mail.sent.length;
    const res = await browser.changePassword(NEW_PASSWORD, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "password-changed" });
    await flush();
    // This browser goes on.
    expect((await browser.session()).statusCode).toBe(200);
    expect(browser.cookie).toBeDefined();
    for (const other of [second, third]) {
      const gone = await other.session();
      expect(gone.statusCode).toBe(401);
      expect(gone.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: "ended-elsewhere" });
    }
    expect((await new Browser().signIn(email)).statusCode).toBe(401);
    expect((await new Browser().signIn(email, NEW_PASSWORD)).json()).toEqual({ status: "signed-in" });
    const letters = lettersTo(email, from);
    expect(letters.map((m) => m.subject)).toEqual(["Пароль у Willowsum змінено"]);
    expect(letters[0]!.text).toContain("змінено в профілі");
    expect(letters[0]!.text).toContain("http://localhost:5173/#/password/reset");
    expect(letters[0]!.text).not.toMatch(/token=/);
    // Audit: the password entry, masked; no email in the platform log.
    const entries = await auditEntries(email);
    expect(
      entries.filter((e) => e.changes.some((c) => c.field === "password")).map((e) => e.changes),
    ).toEqual([[{ field: "password", before: "•••", after: "•••", masked: true }]]);
    expect(JSON.stringify(entries)).not.toContain(email);
  });

  it("a reset link sent before the change no longer works after it", async () => {
    const { email, browser } = await signedIn("ac5-reset-link");
    await request("POST", "/v1/password-resets", { body: { email } });
    await flush();
    const resetLetter = lettersTo(email).find((m) => m.subject === "Відновлення пароля у Willowsum")!;
    const link = /\/#\/password\/reset\?token=([A-Za-z0-9_-]{43})$/m.exec(resetLetter.text)![1]!;
    await browser.changePassword(NEW_PASSWORD, await stepUpToken(browser));
    const res = await request("POST", "/v1/password-resets/check", { body: { token: link } });
    expect(res.statusCode).toBe(410);
  });
});

describe("ACC-05@PoC FR 5: the password change needs the new password (≥ 12) and step-up by the current one; the other sessions end; a security letter", () => {
  it("the step-up asks only the current password; a wrong one is refused with a general message and changes nothing", async () => {
    const { email, browser } = await signedIn("fr5");
    const wrong = await browser.stepUp(WRONG);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({
      type: "urn:willowsum:problem:step-up-password-invalid",
      title: "The password is wrong",
      status: 403,
      code: "STEP_UP_PASSWORD_INVALID",
      supportId: expect.any(String),
    });
    expect((await browser.session()).statusCode).toBe(200);
    expect((await new Browser().signIn(email)).json()).toEqual({ status: "signed-in" });
  });
});

describe("ACC-04@PoC FR 6: after a password change in the profile every other session of the account ends", () => {
  it("the other sessions cannot make a single request after the change, also on protected routes; the current one can", async () => {
    const { email, browser } = await signedIn("acc04-fr6");
    const other = new Browser(FIREFOX_LINUX);
    await other.signIn(email);
    expect((await other.send("GET", "/v1/space")).statusCode).toBe(200);
    await browser.changePassword(NEW_PASSWORD, await stepUpToken(browser));
    expect((await other.send("GET", "/v1/space")).statusCode).toBe(401);
    expect((await other.send("POST", "/v1/session/refresh")).statusCode).toBe(401);
    expect((await browser.send("GET", "/v1/space")).statusCode).toBe(200);
    expect((await browser.send("POST", "/v1/session/refresh")).statusCode).toBe(200);
    const { rows } = await db.owner.query<{ end_reason: string | null }>(
      `SELECT end_reason FROM identity.sessions WHERE account_id = $1 ORDER BY created_at`,
      [await accountId(email)],
    );
    expect(rows.map((r) => r.end_reason)).toEqual([null, "password-change"]);
  });
});

describe("NFR-01@PoC FR 12: a password change in the profile revokes every other session within 60 s", () => {
  it("a session revoked by the change is refused at its very next request (no waiting)", async () => {
    const { email, browser } = await signedIn("nfr01-12");
    const other = new Browser(FIREFOX_LINUX);
    await other.signIn(email);
    await browser.changePassword(NEW_PASSWORD, await stepUpToken(browser));
    expect((await other.profile()).statusCode).toBe(401);
  });
});

describe("NFR-01@PoC AC5: once every session is revoked (reset or change of the password), after 60 s none of them can make a request", () => {
  it("60 s after the change in the profile the other sessions are refused; the current one works", async () => {
    const { email, browser } = await signedIn("nfr01-ac5");
    const other = new Browser(FIREFOX_LINUX);
    await other.signIn(email);
    await browser.changePassword(NEW_PASSWORD, await stepUpToken(browser));
    t += 60 * SECOND;
    expect((await other.send("GET", "/v1/space")).statusCode).toBe(401);
    expect((await browser.send("GET", "/v1/space")).statusCode).toBe(200);
  });
});

describe("NFR-01@PoC AC7: the step-up dialog asks only the current password; no code by email; with the right one the new password is saved", () => {
  it("step-up takes the current password alone and sends no letter; then the change is saved", async () => {
    const { email, browser } = await signedIn("nfr01-ac7");
    await flush();
    const from = mail.sent.length;
    const token = await stepUpToken(browser);
    await flush();
    expect(lettersTo(email, from)).toEqual([]);
    expect((await browser.changePassword(NEW_PASSWORD, token)).statusCode).toBe(200);
  });
});

describe("NFR-15@PoC AC5: a step-up confirmation is refused a second time, for another session or after 6 minutes", () => {
  it("used once → a second change with it is refused (403 STEP_UP_REQUIRED)", async () => {
    const { browser } = await signedIn("nfr15-ac5-twice");
    const token = await stepUpToken(browser);
    expect((await browser.changePassword(NEW_PASSWORD, token)).statusCode).toBe(200);
    const again = await browser.changePassword("a third synthetic passphrase", token);
    expect(again.statusCode).toBe(403);
    expect(code(again)).toBe("STEP_UP_REQUIRED");
  });

  it("from another session of the same account → refused; the confirmation stays usable by its own session", async () => {
    const { email, browser } = await signedIn("nfr15-ac5-session");
    const other = new Browser(FIREFOX_LINUX);
    await other.signIn(email);
    const token = await stepUpToken(browser);
    const res = await other.changePassword(NEW_PASSWORD, token);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("STEP_UP_REQUIRED");
    expect((await browser.changePassword(NEW_PASSWORD, token)).statusCode).toBe(200);
  });

  it("valid for 5 minutes: at 4 min 59 s it works, after 6 min it is refused", async () => {
    const { browser } = await signedIn("nfr15-ac5-time");
    const late = await stepUpToken(browser);
    t += 6 * MINUTE;
    const res = await browser.changePassword(NEW_PASSWORD, late);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("STEP_UP_REQUIRED");
    const inTime = await stepUpToken(browser);
    t += 5 * MINUTE - SECOND;
    expect((await browser.changePassword(NEW_PASSWORD, inTime)).statusCode).toBe(200);
  });

  it("the token survives the rotation of the session's cookie (the same session); a newer confirmation replaces an older one", async () => {
    const { browser } = await signedIn("nfr15-ac5-rotation");
    const older = await stepUpToken(browser);
    const newer = await stepUpToken(browser);
    expect((await browser.send("POST", "/v1/session/refresh")).statusCode).toBe(200);
    expect((await browser.changePassword(NEW_PASSWORD, older)).statusCode).toBe(403);
    expect((await browser.changePassword(NEW_PASSWORD, newer)).statusCode).toBe(200);
  });

  it("an action the step-up does not know is refused (400): a confirmation is always for one named action", async () => {
    const { browser } = await signedIn("nfr15-ac5-action");
    const res = await browser.stepUp(PASSWORD, "email-change");
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("VALIDATION_FAILED");
  });
});

/** NFR-15@PoC AC2 and NFR-01@PoC AC6 share this scenario: 3 failed sign-ins, then 2 wrong step-up passwords. */
async function lockedDuringStepUp(label: string) {
  const { email, browser } = await signedIn(label);
  const elsewhere = new Browser(FIREFOX_LINUX);
  for (let i = 0; i < 3; i++) expect((await elsewhere.signIn(email, WRONG)).statusCode).toBe(401);
  await flush();
  const from = mail.sent.length;
  const first = await browser.stepUp(WRONG);
  const cookie = browser.cookie;
  const second = await browser.stepUp(WRONG);
  await flush();
  return { email, browser, first, second, cookie, from };
}

describe("NFR-15@PoC AC2: with 3 failed sign-ins in 15 min, two wrong step-up passwords end the session, lock sign-in, require a CAPTCHA and send a security letter", () => {
  it("the first wrong password: a general message; the second (5th in the counter): the session ends, no change, locked with the time, a letter", async () => {
    const { email, browser, first, second, cookie, from } = await lockedDuringStepUp("nfr15-ac2");
    expect(first.statusCode).toBe(403);
    expect(code(first)).toBe("STEP_UP_PASSWORD_INVALID");
    expect(second.statusCode).toBe(429);
    expect(code(second)).toBe("SIGN_IN_LOCKED");
    expect(second.headers["retry-after"]).toBe("900");
    expect(browser.cookie).toBeUndefined();
    expect((await request("GET", "/v1/session", { cookie })).statusCode).toBe(401);
    // Locked with the time until unlocked, then a CAPTCHA at every attempt.
    const locked = await new Browser().signIn(email);
    expect(code(locked)).toBe("SIGN_IN_LOCKED");
    expect(locked.headers["retry-after"]).toBe("900");
    t += 15 * MINUTE;
    expect(code(await new Browser().signIn(email))).toBe("CAPTCHA_REQUIRED");
    // The password did not change.
    expect((await new Browser().signIn(email, PASSWORD, SYNTHETIC_CAPTCHA_PASS)).json()).toEqual({
      status: "signed-in",
    });
    const letters = lettersTo(email, from);
    expect(letters.map((m) => m.subject)).toEqual(["Вхід у Willowsum тимчасово заблоковано"]);
    expect(letters[0]!.text).toContain("http://localhost:5173/#/password/reset");
  });
});

describe("NFR-01@PoC AC6: 3 failed sign-ins, then two wrong step-up passwords → the general message, then the session ends and sign-in locks", () => {
  it("the first answer has no hint (no attempts left); the second ends this session for every tab of the browser", async () => {
    const { first, second, cookie } = await lockedDuringStepUp("nfr01-ac6");
    expect(JSON.stringify(first.json())).not.toMatch(/attempt|remaining|left/i);
    expect(second.json()).toMatchObject({ code: "SIGN_IN_LOCKED" });
    const ended = await request("POST", "/v1/session/refresh", { cookie });
    expect(ended.statusCode).toBe(401);
    expect(code(ended)).toBe("SESSION_ENDED");
  });
});

describe("NFR-01@PoC FR 13: a wrong step-up password counts with the failed sign-ins (5 in 15 min per account)", () => {
  it("4 wrong step-ups and 1 failed sign-in lock it as well; a right step-up password clears the counter", async () => {
    const { email, browser } = await signedIn("nfr01-13");
    for (let i = 0; i < 4; i++) expect((await browser.stepUp(WRONG)).statusCode).toBe(403);
    // The right password clears the count, as a sign-in with it does.
    await stepUpToken(browser);
    for (let i = 0; i < 4; i++) expect((await browser.stepUp(WRONG)).statusCode).toBe(403);
    expect(code(await new Browser().signIn(email, WRONG))).toBe("SIGN_IN_LOCKED");
    // A step-up while sign-in is locked is refused with the time to wait; its password is not even checked.
    const res = await browser.stepUp(PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(code(res)).toBe("SIGN_IN_LOCKED");
  });
});

describe("NFR-15@PoC FR 4: step-up is the current password right before the action, one-time, bound to the session and the action, 5 min", () => {
  it("the confirmation is stored as a digest bound to the session and the action, and goes with the session", async () => {
    const { email, browser } = await signedIn("nfr15-4");
    const token = await stepUpToken(browser);
    const { rows } = await db.owner.query<{
      action: string;
      token_digest: Buffer;
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT c.action, c.token_digest, c.expires_at, c.created_at
         FROM identity.step_up_confirmations c JOIN identity.sessions s ON s.id = c.session_id
        WHERE s.account_id = $1`,
      [await accountId(email)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("password-change");
    expect(rows[0]!.token_digest).toHaveLength(32);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.expires_at.getTime() - rows[0]!.created_at.getTime()).toBe(5 * MINUTE);
  });
});
