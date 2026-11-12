import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender, type MailMessage } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { fakeFlags } from "../../../test/http.ts";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  argon2Hasher,
  createIdentityServices,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SIGN_IN_LOCK_MS,
} from "./index.ts";

/**
 * ACC-01@PoC part a on a real PostgreSQL through the real API (ADR-0009): sign-up, the «Перевірте пошту» screen,
 * email confirmation, sign-in with lockout and CAPTCHA, the session cookie. The clock is the test's own (`t`);
 * mail and CAPTCHA are the synthetic adapters (ARC-05). All addresses and names are synthetic.
 */
const telemetry = testTelemetryForFile();
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = "synthetic lower case words"; // ≥ 12 characters, lower case and spaces only (AC3)

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 9, 0, 0);
const mail = syntheticMailSender();
const captcha = syntheticCaptchaVerifier();
const pending: Promise<void>[] = [];
const off = new Set<string>();
const flags = {
  ...fakeFlags(),
  isEnabledForAll: async (flag: string) => !off.has(flag),
};

let ipCounter = 0;
/** A fresh client address per test: the API's own per-address limit never mixes tests. */
const nextIp = () => `198.51.${100 + Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `${label}.${++seq}@example.test`;

async function flush(): Promise<void> {
  await Promise.all(pending.splice(0));
}

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; ip?: string; origin?: string; cookie?: string } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: options.ip ?? nextIp(),
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : { origin: WEB }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}

const signUp = (body: Record<string, unknown>, ip = nextIp()) =>
  request("POST", "/v1/registrations", { body: { captchaToken: SYNTHETIC_CAPTCHA_PASS, ...body }, ip });
const signIn = (body: Record<string, unknown>, ip = nextIp()) =>
  request("POST", "/v1/sessions", { body, ip });

function lettersTo(address: string): MailMessage[] {
  return mail.sent.filter((m) => m.to === address);
}

function linkToken(message: MailMessage): string {
  const m = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(message.text);
  if (!m) throw new Error("no confirmation link in the letter");
  return m[1]!;
}

/** The body without its support id (the request's own trace id): what must be equal byte for byte. */
const withoutSupportId = (body: string) => body.replace(/"supportId":"[0-9a-f]{32}",?/, "");
const withoutToken = (body: string) =>
  body.replace(/"registrationToken":"[A-Za-z0-9_-]{43}"/, '"registrationToken":"…"');

/** Headers that may differ between two otherwise equal answers: date, length of a token-free body is equal. */
function comparableHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "date"));
}

async function registered(
  label: string,
  name = "Олена Синтетична",
): Promise<{ email: string; token: string }> {
  const email = nextEmail(label);
  const res = await signUp({ name, email, password: PASSWORD });
  expect(res.statusCode).toBe(200);
  await flush();
  return { email, token: res.json().registrationToken as string };
}

async function confirmed(label: string): Promise<string> {
  const { email } = await registered(label);
  const link = linkToken(lettersTo(email).at(-1)!);
  expect((await request("POST", "/v1/email-confirmations", { body: { token: link } })).json()).toEqual({
    result: "confirmed",
  });
  return email;
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
  return all.find((c) => c.startsWith("session=") || c.startsWith("__Secure-session="));
}

beforeAll(async () => {
  db = await setupRealModules();
  const services = createIdentityServices({
    mail,
    captcha,
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
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
        flags,
        identity: services,
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
  off.clear();
  t += 2 * HOUR; // every test starts outside the hourly windows of the one before
});

describe("ACC-01 AC1: sign-up creates an unconfirmed account and sends a confirmation link valid 24 h; no session", () => {
  it("unconfirmed account, «check your email», no cookie; the letter links to /verify with a token valid 24 h", async () => {
    const email = nextEmail("ac1");
    const res = await signUp({ name: "Олена Синтетична", email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "check-email",
      registrationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      resendAfterS: 60,
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
    await flush();
    const letters = lettersTo(email);
    expect(letters).toHaveLength(1);
    expect(letters[0]!.subject).toBe("Підтвердьте email для Willowsum");
    expect(letters[0]!.text).toContain(`${WEB}/verify?token=`);
    expect(letters[0]!.text).toContain("24 години");
    const { rows } = await db.owner.query(
      `SELECT a.email_confirmed_at, extract(epoch FROM c.expires_at - c.created_at)::int AS ttl, a.password_hash
       FROM identity.accounts a JOIN identity.email_confirmations c ON c.account_id = a.id
       WHERE a.email_normalized = $1`,
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email_confirmed_at).toBeNull();
    expect(rows[0].ttl).toBe(24 * 3600);
    // NFR-01: the password is stored only as an argon2id hash.
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM identity.sessions`)).rows[0].n).toBe(0);
  });

  it("the account is audited (platform log, no email in it)", async () => {
    const email = nextEmail("ac1-audit");
    await signUp({ name: "Синтетичний Автор", email, password: PASSWORD });
    await flush();
    const { rows } = await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: "identity.account",
      id: rows[0].id as string,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "create",
      actorKind: "system",
      changes: [{ field: "state", before: null, after: "unconfirmed", masked: false }],
    });
    expect(JSON.stringify(entries)).not.toContain(email);
  });
});

describe("ACC-01 AC2, AC3 (server side): password of at least 12 characters, no composition rules, nothing external", () => {
  it("an empty field or a password shorter than 12 characters is refused with the field, no account", async () => {
    const email = nextEmail("ac2");
    for (const body of [
      { name: "", email, password: PASSWORD },
      { name: "Синтетик", email: "", password: PASSWORD },
      { name: "Синтетик", email, password: "elevenchars" },
    ]) {
      const res = await signUp(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(res.json().errors)).not.toContain(PASSWORD);
    }
    const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("12 lower-case letters only are accepted; the only outgoing calls are the CAPTCHA check and the letter", async () => {
    const before = captcha.checked;
    const email = nextEmail("ac3");
    const res = await signUp({ name: "Синтетик", email, password: "onlylowercas" });
    expect(res.statusCode).toBe(200);
    await flush();
    // The no-network guard of the test run fails any other outgoing call (ARC-05); the letter carries no password.
    expect(captcha.checked).toBe(before + 1);
    expect(lettersTo(email)[0]!.text).not.toContain("onlylowercas");
  });
});

describe("ACC-01 FR 12: CAPTCHA at sign-up", () => {
  it("without a CAPTCHA, or with one that did not pass → CAPTCHA_REQUIRED and no account", async () => {
    const email = nextEmail("captcha");
    for (const captchaToken of [undefined, "not-the-synthetic-pass"]) {
      const res = await request("POST", "/v1/registrations", {
        body: { name: "Синтетик", email, password: PASSWORD, ...(captchaToken ? { captchaToken } : {}) },
        ip: nextIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("CAPTCHA_REQUIRED");
    }
    const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("ACC-01 AC4 / FR 15: «Надіслати ще раз» at most once per 60 s and 5 letters per hour per address", () => {
  it("within 60 s → 429 with the seconds left; after 60 s a new letter; after 5 in the hour → 429 until the hour ends", async () => {
    const { email, token } = await registered("ac4");
    const early = await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } });
    expect(early.statusCode).toBe(429);
    expect(early.json().code).toBe("RATE_LIMITED");
    expect(early.headers["retry-after"]).toBe("60");
    t += 20_000;
    expect(
      (await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } })).headers[
        "retry-after"
      ],
    ).toBe("40");
    for (let i = 2; i <= 5; i++) {
      t += MINUTE;
      const res = await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } });
      expect(res.statusCode, `letter ${i}`).toBe(200);
      expect(res.json()).toEqual({ status: "sent", resendAfterS: 60 });
    }
    await flush();
    expect(lettersTo(email)).toHaveLength(5);
    t += MINUTE;
    const sixth = await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } });
    expect(sixth.statusCode).toBe(429);
    // The first letter went 20 s + 5 minutes ago: the hour ends 54 min 40 s from now.
    expect(Number(sixth.headers["retry-after"])).toBe(HOUR / 1000 - 20 - 5 * 60);
    t += HOUR;
    expect(
      (await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } })).statusCode,
    ).toBe(200);
  });

  it("a resend makes the earlier links invalid", async () => {
    const { email, token } = await registered("ac4-revoke");
    const first = linkToken(lettersTo(email)[0]!);
    t += MINUTE;
    await request("POST", "/v1/registrations/resend", { body: { registrationToken: token } });
    await flush();
    const second = linkToken(lettersTo(email)[1]!);
    expect((await request("POST", "/v1/email-confirmations", { body: { token: first } })).json()).toEqual({
      result: "invalid",
    });
    expect((await request("POST", "/v1/email-confirmations", { body: { token: second } })).json()).toEqual({
      result: "confirmed",
    });
  });
});

describe("ACC-01 AC5, AC24, FR 14: the confirmation link confirms once and never creates a session", () => {
  it("a valid link confirms the address without a session; opened again it confirms nothing and creates no session", async () => {
    const { email } = await registered("ac5");
    const token = linkToken(lettersTo(email)[0]!);
    const first = await request("POST", "/v1/email-confirmations", { body: { token } });
    expect(first.json()).toEqual({ result: "confirmed" });
    expect(sessionCookieOf(first)).toBeUndefined();
    const { rows } = await db.owner.query(
      `SELECT email_confirmed_at FROM identity.accounts WHERE email_normalized = $1`,
      [email],
    );
    const at = rows[0].email_confirmed_at as Date;
    expect(at.getTime()).toBe(t);
    t += MINUTE;
    const again = await request("POST", "/v1/email-confirmations", { body: { token } });
    expect(again.json()).toEqual({ result: "already-used" });
    expect(sessionCookieOf(again)).toBeUndefined();
    const after = await db.owner.query(
      `SELECT email_confirmed_at FROM identity.accounts WHERE email_normalized = $1`,
      [email],
    );
    expect((after.rows[0].email_confirmed_at as Date).getTime()).toBe(at.getTime());
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM identity.sessions`)).rows[0].n).toBe(0);
  });

  it("the token is stored only as its SHA-256 digest", async () => {
    const { email, token: registrationToken } = await registered("digest");
    const link = linkToken(lettersTo(email)[0]!);
    const dump = JSON.stringify(
      (
        await db.owner.query(
          `SELECT (SELECT json_agg(c) FROM identity.email_confirmations c) AS c,
                  (SELECT json_agg(r) FROM identity.registrations r) AS r`,
        )
      ).rows,
    );
    expect(dump).not.toContain(link);
    expect(dump).not.toContain(registrationToken);
    expect(dump).not.toContain(Buffer.from(link).toString("hex"));
  });
});

describe("ACC-01 AC6: a link older than 24 h opens «Посилання недійсне» with «Надіслати ще раз»", () => {
  it("expired → a new link on request; the expired one stays invalid", async () => {
    const { email } = await registered("ac6");
    const old = linkToken(lettersTo(email)[0]!);
    t += 24 * HOUR + 1;
    expect((await request("POST", "/v1/email-confirmations", { body: { token: old } })).json()).toEqual({
      result: "expired",
    });
    const resend = await request("POST", "/v1/email-confirmations/resend", { body: { token: old } });
    expect(resend.json()).toEqual({ status: "sent", resendAfterS: 60 });
    await flush();
    const fresh = linkToken(lettersTo(email).at(-1)!);
    expect(fresh).not.toBe(old);
    expect((await request("POST", "/v1/email-confirmations", { body: { token: old } })).json()).toEqual({
      result: "invalid",
    });
    expect((await request("POST", "/v1/email-confirmations", { body: { token: fresh } })).json()).toEqual({
      result: "confirmed",
    });
  });
});

describe("ACC-01 AC7, FR 5: an unconfirmed account cannot sign in", () => {
  it("right email and password → no session, «email-not-confirmed»; «Надіслати лист ще раз» sends a new link and the old stop working", async () => {
    const { email } = await registered("ac7");
    const old = linkToken(lettersTo(email)[0]!);
    t += MINUTE;
    const res = await signIn({ email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "email-not-confirmed",
      registrationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      resendAfterS: 0,
    });
    expect(sessionCookieOf(res)).toBeUndefined();
    const resend = await request("POST", "/v1/registrations/resend", {
      body: { registrationToken: res.json().registrationToken },
    });
    expect(resend.statusCode).toBe(200);
    await flush();
    const fresh = linkToken(lettersTo(email).at(-1)!);
    expect((await request("POST", "/v1/email-confirmations", { body: { token: old } })).json().result).toBe(
      "invalid",
    );
    expect((await request("POST", "/v1/email-confirmations", { body: { token: fresh } })).json().result).toBe(
      "confirmed",
    );
  });

  it("an unconfirmed account with a wrong password gets the one wrong-credentials answer", async () => {
    const { email } = await registered("ac7-wrong");
    const res = await signIn({ email, password: "a wrong password here" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
  });
});

describe("ACC-01 AC11, FR 8 / NFR-15 FR 1: a taken address gets the same answer; its owner gets a letter with the reset link only", () => {
  it("the answer is byte for byte the same (but for the random token); the account is not changed", async () => {
    const taken = await confirmed("ac11");
    const before = await db.owner.query(
      `SELECT display_name, password_hash, email_confirmed_at, updated_at FROM identity.accounts WHERE email_normalized = $1`,
      [taken],
    );
    const fresh = await signUp({ name: "Новий Синтетик", email: nextEmail("ac11-new"), password: PASSWORD });
    const again = await signUp({
      name: "Чужий Синтетик",
      email: taken,
      password: "another synthetic password",
    });
    expect(again.statusCode).toBe(fresh.statusCode);
    expect(withoutToken(again.body)).toBe(withoutToken(fresh.body));
    expect(comparableHeaders(again.headers)).toEqual(comparableHeaders(fresh.headers));
    await flush();
    const letters = lettersTo(taken);
    const attempt = letters.at(-1)!;
    expect(attempt.subject).toBe("Спроба реєстрації з вашою адресою у Willowsum");
    expect(attempt.text).toContain(`${WEB}/password/reset`);
    expect(attempt.text).not.toContain("/verify");
    const after = await db.owner.query(
      `SELECT display_name, password_hash, email_confirmed_at, updated_at FROM identity.accounts WHERE email_normalized = $1`,
      [taken],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("an unconfirmed taken address too: same answer, attempt letter, no new confirmation link", async () => {
    const { email } = await registered("ac11-unconfirmed");
    t += MINUTE;
    const res = await signUp({ name: "Синтетик", email: email.toUpperCase(), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    await flush();
    const letters = lettersTo(email);
    expect(letters.map((l) => l.subject)).toEqual([
      "Підтвердьте email для Willowsum",
      "Спроба реєстрації з вашою адресою у Willowsum",
    ]);
  });

  it("attempt letters to one address: at most 5 per hour; the answer stays the same", async () => {
    const taken = await confirmed("ac11-limit");
    const count = () => lettersTo(taken).filter((l) => l.subject.startsWith("Спроба")).length;
    for (let i = 0; i < 7; i++) {
      t += 2 * MINUTE;
      const res = await signUp({ name: "Синтетик", email: taken, password: PASSWORD });
      expect(res.statusCode).toBe(200);
    }
    await flush();
    expect(count()).toBe(5);
  });
});

describe("ACC-01 AC12 / NFR-14 FR 7: at most 5 sign-up attempts per hour from one address", () => {
  it("the 6th is refused with «too many» and creates no account; the next hour works again", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++)
      expect(
        (await signUp({ name: "Синтетик", email: nextEmail("ac12"), password: PASSWORD }, ip)).statusCode,
      ).toBe(200);
    const email = nextEmail("ac12-sixth");
    const sixth = await signUp({ name: "Синтетик", email, password: PASSWORD }, ip);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe("RATE_LIMITED");
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
    // Another address is not affected.
    expect(
      (await signUp({ name: "Синтетик", email: nextEmail("ac12-other"), password: PASSWORD })).statusCode,
    ).toBe(200);
    t += HOUR;
    expect((await signUp({ name: "Синтетик", email, password: PASSWORD }, ip)).statusCode).toBe(200);
  });

  it("the counter survives a restart: it lives in the identity schema, keyed by a digest of the address", async () => {
    const { rows } = await db.owner.query(`SELECT key FROM identity.rate_limit_windows`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.key).toMatch(/^sign-up:[0-9a-f]{64}$/);
      expect(r.key).not.toContain("198.51.");
    }
  });
});

describe("ACC-01 AC13, FR 9 / NFR-15 FR 2: one answer for a wrong email and a wrong password", () => {
  it("unknown address and wrong password: the same status, headers and body byte for byte (but for the support id)", async () => {
    const email = await confirmed("ac13");
    const wrongPassword = await signIn({ email, password: "not the synthetic password" });
    const unknownEmail = await signIn({ email: nextEmail("ac13-nobody"), password: PASSWORD });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().code).toBe("INVALID_CREDENTIALS");
    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(withoutSupportId(unknownEmail.body)).toBe(withoutSupportId(wrongPassword.body));
    expect(Object.keys(unknownEmail.headers).sort()).toEqual(Object.keys(wrongPassword.headers).sort());
    expect(wrongPassword.body).not.toContain(email);
  });

  it("a confirmed account with the right password signs in", async () => {
    const email = await confirmed("ac13-ok");
    const res = await signIn({ email: `  ${email.toUpperCase()} `, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "signed-in" });
    expect(sessionCookieOf(res)).toBeDefined();
  });
});

describe("ACC-01 AC14 / NFR-14 FR 7 / NFR-01 FR 9: 5 failures in 15 min lock the email for 15 min; then a CAPTCHA every time", () => {
  for (const exists of [true, false]) {
    it(`${exists ? "an existing" : "an unknown"} email: locked on the 5th failure, even for the right password; then CAPTCHA`, async () => {
      const email = exists ? await confirmed("ac14") : nextEmail("ac14-nobody");
      for (let i = 1; i <= 4; i++) {
        t += MINUTE;
        const res = await signIn({ email, password: `wrong synthetic ${i}` });
        expect(res.statusCode, `failure ${i}`).toBe(401);
      }
      t += MINUTE;
      const fifth = await signIn({ email, password: "wrong synthetic 5" });
      expect(fifth.statusCode).toBe(429);
      expect(fifth.json().code).toBe("SIGN_IN_LOCKED");
      expect(fifth.headers["retry-after"]).toBe(String(SIGN_IN_LOCK_MS / 1000));
      t += 5 * MINUTE;
      const during = await signIn({ email, password: PASSWORD });
      expect(during.json().code).toBe("SIGN_IN_LOCKED");
      expect(during.headers["retry-after"]).toBe(String(10 * 60));
      expect(sessionCookieOf(during)).toBeUndefined();
      t += 10 * MINUTE;
      const noCaptcha = await signIn({ email, password: PASSWORD });
      expect(noCaptcha.statusCode).toBe(400);
      expect(noCaptcha.json().code).toBe("CAPTCHA_REQUIRED");
      const badCaptcha = await signIn({ email, password: PASSWORD, captchaToken: "not-the-synthetic-pass" });
      expect(badCaptcha.json().code).toBe("CAPTCHA_REQUIRED");
      const wrong = await signIn({
        email,
        password: "wrong synthetic 6",
        captchaToken: SYNTHETIC_CAPTCHA_PASS,
      });
      expect(wrong.json().code).toBe("INVALID_CREDENTIALS");
      // Still a CAPTCHA at the next attempt.
      expect((await signIn({ email, password: PASSWORD })).json().code).toBe("CAPTCHA_REQUIRED");
      if (exists) {
        const ok = await signIn({ email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS });
        expect(ok.json()).toEqual({ status: "signed-in" });
        // A sign-in with the right password clears the mark.
        expect((await signIn({ email, password: PASSWORD })).json()).toEqual({ status: "signed-in" });
      }
    });
  }

  it("the answers for an existing and an unknown email are the same at every step", async () => {
    const known = await confirmed("ac14-same");
    const unknown = nextEmail("ac14-same-nobody");
    const steps: string[][] = [[], []];
    for (const [i, email] of [known, unknown].entries()) {
      for (let k = 1; k <= 6; k++) {
        const res = await signIn({ email, password: `wrong synthetic ${k}` });
        steps[i]!.push(
          `${res.statusCode} ${withoutSupportId(res.body)} ${String(res.headers["retry-after"])}`,
        );
      }
    }
    expect(steps[0]).toEqual(steps[1]);
  });

  it("failures older than 15 min do not count", async () => {
    const email = await confirmed("ac14-window");
    for (let i = 1; i <= 4; i++) await signIn({ email, password: `wrong synthetic ${i}` });
    t += 15 * MINUTE + 1;
    expect((await signIn({ email, password: "wrong synthetic 5" })).statusCode).toBe(401);
  });

  it("the guard is keyed by a digest of the address, never the address", async () => {
    const dump = JSON.stringify(
      (await db.owner.query(`SELECT encode(email_key, 'hex') AS k FROM identity.sign_in_guards`)).rows,
    );
    expect(dump).not.toContain("@example.test");
  });
});

describe("ACC-01 AC23, FR 13: «Надіслати ще раз» and «Змінити email» behave the same for a new and a taken address", () => {
  it("same status and body for both; the taken account is never changed", async () => {
    const taken = await confirmed("ac23-taken");
    t += 2 * MINUTE;
    const before = await db.owner.query(`SELECT * FROM identity.accounts WHERE email_normalized = $1`, [
      taken,
    ]);
    const forTaken = (await signUp({ name: "Синтетик", email: taken, password: PASSWORD })).json()
      .registrationToken as string;
    const forNew = (
      await signUp({ name: "Синтетик", email: nextEmail("ac23-new"), password: PASSWORD })
    ).json().registrationToken as string;
    await flush();
    const early = await Promise.all(
      [forTaken, forNew].map((token) =>
        request("POST", "/v1/registrations/resend", { body: { registrationToken: token } }),
      ),
    );
    expect(early[0]!.statusCode).toBe(429);
    expect(withoutSupportId(early[0]!.body)).toBe(withoutSupportId(early[1]!.body));
    expect(early[0]!.headers["retry-after"]).toBe(early[1]!.headers["retry-after"]);
    t += MINUTE;
    const resent = await Promise.all(
      [forTaken, forNew].map((token) =>
        request("POST", "/v1/registrations/resend", { body: { registrationToken: token } }),
      ),
    );
    expect(resent[0]!.body).toBe(resent[1]!.body);
    const changed = await Promise.all(
      [forTaken, forNew].map((token) =>
        request("POST", "/v1/registrations/change-email", { body: { registrationToken: token } }),
      ),
    );
    expect(changed[0]!.statusCode).toBe(200);
    expect(changed[0]!.body).toBe(changed[1]!.body);
    expect(changed[0]!.json()).toEqual({ status: "closed" });
    await flush();
    const after = await db.owner.query(`SELECT * FROM identity.accounts WHERE email_normalized = $1`, [
      taken,
    ]);
    expect(after.rows).toEqual(before.rows);
    // The closed token no longer acts.
    expect(
      (await request("POST", "/v1/registrations/resend", { body: { registrationToken: forNew } })).statusCode,
    ).toBe(404);
  });

  it("edge case: after «Змінити email» the earlier link of that sign-up no longer works; a new sign-up mails the new address", async () => {
    const { email, token } = await registered("edge-change");
    const link = linkToken(lettersTo(email)[0]!);
    await request("POST", "/v1/registrations/change-email", { body: { registrationToken: token } });
    expect((await request("POST", "/v1/email-confirmations", { body: { token: link } })).json()).toEqual({
      result: "invalid",
    });
    const corrected = nextEmail("edge-change-corrected");
    await signUp({ name: "Олена Синтетична", email: corrected, password: PASSWORD });
    await flush();
    expect(lettersTo(corrected)).toHaveLength(1);
  });
});

describe("Edge case: a link opened on another device confirms the address and creates no session", () => {
  it("no cookie from the link; sign-in works from any device with email and password", async () => {
    const { email } = await registered("edge-device");
    const res = await request("POST", "/v1/email-confirmations", {
      body: { token: linkToken(lettersTo(email)[0]!) },
      ip: nextIp(),
    });
    expect(res.json()).toEqual({ result: "confirmed" });
    expect(sessionCookieOf(res)).toBeUndefined();
    expect((await signIn({ email, password: PASSWORD }, nextIp())).json()).toEqual({ status: "signed-in" });
  });
});

describe("NFR-15 FR 5 / NFR-01 FR 10: the session cookie and its lifetime", () => {
  it("HttpOnly, Secure, SameSite=Lax, Path=/, 12 h; the value is an opaque token stored only as its digest", async () => {
    const email = await confirmed("cookie");
    const res = await signIn({ email, password: PASSWORD });
    const cookie = sessionCookieOf(res)!;
    expect(cookie).toMatch(
      /^session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(cookie).not.toContain("Domain");
    const value = cookie.split(";")[0]!.split("=")[1]!;
    const dump = JSON.stringify((await db.owner.query(`SELECT * FROM identity.sessions`)).rows);
    expect(dump).not.toContain(value);
  });

  it("GET /v1/session answers for a live session; 15 min idle or 12 h in all end it; sign-out ends it at once", async () => {
    const email = await confirmed("session");
    const value = sessionCookieOf(await signIn({ email, password: PASSWORD }))!.split(";")[0]!;
    const me = await request("GET", "/v1/session", { cookie: value });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ name: "Олена Синтетична", email });
    // Use keeps it alive up to the absolute end.
    for (let used = 0; used < SESSION_ABSOLUTE_MS - SESSION_IDLE_MS; used += 10 * MINUTE) {
      t += 10 * MINUTE;
      expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(200);
    }
    t += 10 * MINUTE;
    expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(401);

    const second = sessionCookieOf(await signIn({ email, password: PASSWORD }))!.split(";")[0]!;
    t += SESSION_IDLE_MS;
    const idle = await request("GET", "/v1/session", { cookie: second });
    expect(idle.statusCode).toBe(401);
    expect(idle.json().code).toBe("UNAUTHENTICATED");

    const third = sessionCookieOf(await signIn({ email, password: PASSWORD }))!.split(";")[0]!;
    const out = await request("DELETE", "/v1/session", { cookie: third });
    expect(out.json()).toEqual({ status: "signed-out" });
    expect(sessionCookieOf(out)).toBe("session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    expect((await request("GET", "/v1/session", { cookie: third })).statusCode).toBe(401);
  });
});

describe("NFR-15 FR 5: writes of identity from another site's page are refused before anything runs", () => {
  it("sign-up, confirmation and sign-in with a foreign Origin → 403 ORIGIN_NOT_ALLOWED; nothing created", async () => {
    const email = nextEmail("origin");
    const evil = "https://evil.example";
    const responses = [
      await request("POST", "/v1/registrations", {
        body: { name: "Синтетик", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
        origin: evil,
      }),
      await request("POST", "/v1/sessions", { body: { email, password: PASSWORD }, origin: evil }),
      await request("POST", "/v1/email-confirmations", { body: { token: "A".repeat(43) }, origin: evil }),
      await request("DELETE", "/v1/session", { origin: evil }),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("ORIGIN_NOT_ALLOWED");
    }
    const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("CICD-06 / DAT-05 FR 7: identity is behind its flag and its module's kill switch", () => {
  it("flag identity.sign-in not at «all» → every identity route answers 404 like an unknown path", async () => {
    off.add("identity.sign-in");
    const unknown = await request("POST", "/v1/no-such-route", { body: {} });
    const res = await signUp({ name: "Синтетик", email: nextEmail("flag"), password: PASSWORD });
    expect(res.statusCode).toBe(404);
    expect(withoutSupportId(res.body)).toBe(withoutSupportId(unknown.body));
  });
});

describe("ARC-09 / NFR-10 / NFR-17: emails, names, passwords and tokens never reach logs or telemetry", () => {
  it("a whole sign-up, confirmation, failed and successful sign-in leave no personal value in exported telemetry", async () => {
    telemetry.memory.reset();
    const email = nextEmail("telemetry");
    const name = "Телеметрія Синтетична";
    await signUp({ name, email, password: PASSWORD });
    await flush();
    const link = linkToken(lettersTo(email)[0]!);
    await request("POST", "/v1/email-confirmations", { body: { token: link } });
    await signIn({ email, password: "wrong synthetic password" });
    const ok = await signIn({ email, password: PASSWORD });
    const session = sessionCookieOf(ok)!.split(";")[0]!.split("=")[1]!;
    const text = await exportedText(telemetry);
    expect(text.length).toBeGreaterThan(100);
    for (const value of [email, email.split("@")[0]!, name, PASSWORD, link, session])
      expect(text, value).not.toContain(value);
  });

  it("a letter that fails to send is logged by its error class only", async () => {
    telemetry.memory.reset();
    const failing = createIdentityServices({
      mail: {
        send: async (message) => {
          throw new Error(`could not send to ${message.to}`);
        },
      },
      captcha,
      audit: createAuditLog(db.databases.for("audit")),
      webOrigin: WEB,
      now: () => t,
      deliver: (task) => {
        pending.push(task());
      },
    });
    const failingApp = buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) =>
        mountApi(a, {
          databases: db.databases,
          entitlements: "all-enabled",
          flags,
          identity: failing,
          allowedOrigins: new Set([WEB]),
        }),
    });
    await failingApp.ready();
    const email = nextEmail("mail-failure");
    const res = await failingApp.inject({
      method: "POST",
      url: "/v1/registrations",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", origin: WEB },
      payload: JSON.stringify({
        name: "Синтетик",
        email,
        password: PASSWORD,
        captchaToken: SYNTHETIC_CAPTCHA_PASS,
      }),
    });
    expect(res.statusCode).toBe(200);
    await flush();
    const record = telemetry.memory.logRecords().find((r) => r.body === "identity.mail_failed");
    expect(record?.attributes).toMatchObject({ "ws.module": "identity", "error.type": "Error" });
    expect(await exportedText(telemetry)).not.toContain(email);
    await failingApp.close();
  });
});

describe("ARC-03 / ADR-0009: account data is reachable only by the identity module's role", () => {
  it("another module's role cannot read the identity schema", async () => {
    await expect(
      db.databases.for("audit").transaction((q) => q.query("SELECT email FROM identity.accounts")),
    ).rejects.toThrow(/permission denied/);
  });
});
