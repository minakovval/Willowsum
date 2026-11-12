import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender, type MailMessage } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import type { PasswordHasher } from "./application/index.ts";
import { argon2Hasher, createIdentityServices } from "./index.ts";

/**
 * ACC-01@PoC part b on a real PostgreSQL through the real API: password reset (FR 10, AC16, AC17), ending every
 * session of the account (NFR-15 FR 3), no account enumeration on the request (NFR-15 FR 1), and the owner's
 * decision of 2026-11-12 against pre-account squatting (a new sign-up of an unconfirmed address replaces its
 * password and revokes its earlier links). Work «after the answer» is queued and runs only at `flush()`, so a
 * test sees exactly what happened on the response path. Clock, mail and CAPTCHA are the test's own; all
 * addresses, names and passwords are synthetic.
 */
const telemetry = testTelemetryForFile();
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = ["synthetic", "first", "pass", "phrase"].join(" ");
const NEW_PASSWORD = ["synthetic", "second", "pass", "phrase"].join(" ");

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 10, 41, 17, 300); // not on the hour
const mail = syntheticMailSender();
const captcha = syntheticCaptchaVerifier();
const off = new Set<string>();
const flags = { ...fakeFlags(), isEnabledForAll: async (flag: string) => !off.has(flag) };
let hashes = 0;
const real = argon2Hasher();
const hasher: PasswordHasher = {
  hash: async (p) => {
    hashes += 1;
    return real.hash(p);
  },
  verify: async (h, p) => {
    const result = await real.verify(h, p);
    if (hold) {
      const { entered, release } = hold;
      hold = null;
      entered();
      await release;
    }
    return result;
  },
};
/** When set, the next password verification pauses (inside its sign-in transaction) until `release`. */
let hold: { entered: () => void; release: Promise<void> } | null = null;

/** Work after the answer: queued, never started by the request itself. */
const queue: (() => Promise<void>)[] = [];
/** Runs the queued work (each batch in parallel, as the event loop would) until nothing is left. */
async function flush(): Promise<void> {
  while (queue.length > 0) await Promise.all(queue.splice(0).map((task) => task()));
}

let ipCounter = 0;
const nextIp = () => `192.0.${100 + Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `${label}.${++seq}@example.test`;

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; origin?: string; cookie?: string } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      origin: options.origin ?? WEB,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}

const signUp = (body: Record<string, unknown>) =>
  request("POST", "/v1/registrations", { body: { captchaToken: SYNTHETIC_CAPTCHA_PASS, ...body } });
const signIn = (body: Record<string, unknown>) => request("POST", "/v1/sessions", { body });
const askReset = (email: string, origin?: string) =>
  request("POST", "/v1/password-resets", { body: { email }, ...(origin ? { origin } : {}) });
const checkReset = (token: string) => request("POST", "/v1/password-resets/check", { body: { token } });
const completeReset = (token: string, password = NEW_PASSWORD, cookie?: string) =>
  request("POST", "/v1/password-resets/complete", {
    body: { token, password },
    ...(cookie ? { cookie } : {}),
  });

const lettersTo = (address: string): MailMessage[] => mail.sent.filter((m) => m.to === address);
const resetLetters = (address: string) =>
  lettersTo(address).filter((m) => m.subject === "Відновлення пароля у Willowsum");

function tokenIn(message: MailMessage, pattern: RegExp): string {
  const m = pattern.exec(message.text);
  if (!m) throw new Error("no link in the letter");
  return m[1]!;
}
const resetToken = (m: MailMessage) => tokenIn(m, /\/#\/password\/reset\?token=([A-Za-z0-9_-]{43})/);
const confirmToken = (m: MailMessage) => tokenIn(m, /\/verify\?token=([A-Za-z0-9_-]{43})/);

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
}
/** `session=<value>` of a sign-in answer. */
const sessionOf = (res: { headers: Record<string, unknown> }) =>
  setCookies(res)
    .find((c) => c.startsWith("session="))!
    .split(";")[0]!;
const withoutSupportId = (body: string) => body.replace(/"supportId":"[0-9a-f]{32}",?/, "");
const comparableHeaders = (headers: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "date"));

async function registered(label: string, name = "Олена Синтетична"): Promise<string> {
  const email = nextEmail(label);
  expect((await signUp({ name, email, password: PASSWORD })).statusCode).toBe(200);
  await flush();
  return email;
}
async function confirmed(label: string): Promise<string> {
  const email = await registered(label);
  const res = await request("POST", "/v1/email-confirmations", {
    body: { token: confirmToken(lettersTo(email).at(-1)!) },
  });
  expect(res.json()).toEqual({ result: "confirmed" });
  return email;
}
/** Asks for a reset, runs the work after the answer and returns the token of the newest reset letter. */
async function resetLink(email: string): Promise<string> {
  expect((await askReset(email)).statusCode).toBe(200);
  await flush();
  return resetToken(resetLetters(email).at(-1)!);
}
const accountRow = async (email: string) =>
  (
    await db.owner.query(
      `SELECT id, display_name, password_hash, email_confirmed_at, updated_at FROM identity.accounts
       WHERE email_normalized = $1`,
      [email],
    )
  ).rows[0] as {
    id: string;
    display_name: string;
    password_hash: string;
    email_confirmed_at: Date | null;
    updated_at: Date;
  };
const auditOf = (id: string) =>
  createAuditLog(db.databases.for("audit")).platformEntriesFor({ type: "identity.account", id });

beforeAll(async () => {
  db = await setupRealModules(10);
  const services = createIdentityServices({
    mail,
    captcha,
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
    spaces: householdSpaces(db),
    now: () => t,
    hasher,
    deliver: (task) => {
      queue.push(task);
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

beforeEach(async () => {
  await flush();
  off.clear();
  t += 2 * HOUR + 11 * MINUTE + 7_000; // outside every window of the test before
});

describe("ACC-01 AC16, FR 10: a reset request mails a single-use link valid 60 min", () => {
  it("an account gets one letter with a link to /password/reset (token in the fragment); 60 min; no session", async () => {
    const email = await confirmed("ac16");
    const res = await askReset(email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "requested" });
    expect(setCookies(res)).toEqual([]);
    await flush();
    const letters = resetLetters(email);
    expect(letters).toHaveLength(1);
    expect(letters[0]!.text).toContain(`${WEB}/#/password/reset?token=`);
    // The token sits after `#` only, never in a query string a browser would send to a server.
    expect(letters[0]!.text).not.toMatch(/https?:\/\/[^#\s]*\?token=/);
    expect(letters[0]!.text).toContain("60 хвилин");
    const { rows } = await db.owner.query(
      `SELECT extract(epoch FROM r.expires_at - r.created_at)::int AS ttl, r.used_at, r.revoked_at
       FROM identity.password_resets r JOIN identity.accounts a ON a.id = r.account_id
       WHERE a.email_normalized = $1`,
      [email],
    );
    expect(rows).toEqual([{ ttl: 3600, used_at: null, revoked_at: null }]);
    expect((await checkReset(resetToken(letters[0]!))).json()).toEqual({ status: "valid" });
  });

  it("the token is stored only as its SHA-256 digest", async () => {
    const email = await confirmed("ac16-digest");
    const token = await resetLink(email);
    const dump = JSON.stringify(
      (await db.owner.query(`SELECT * FROM identity.password_resets`)).rows.map((r) => ({
        ...r,
        token_digest: (r.token_digest as Buffer).toString("hex"),
      })),
    );
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(Buffer.from(token).toString("hex"));
    expect(dump).toContain((await import("node:crypto")).createHash("sha256").update(token).digest("hex"));
  });

  it("a new request makes every earlier link invalid; only the newest changes the password", async () => {
    const email = await confirmed("ac16-newer");
    const first = await resetLink(email);
    t += MINUTE;
    const second = await resetLink(email);
    expect(second).not.toBe(first);
    for (const res of [await checkReset(first), await completeReset(first)]) {
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("RESET_LINK_INVALID");
    }
    // The old password still works: the revoked link changed nothing.
    expect((await signIn({ email, password: PASSWORD })).json()).toEqual({ status: "signed-in" });
    expect((await completeReset(second)).json()).toEqual({ status: "password-changed" });
  });

  it("the link expires at 60 min: valid at 59:59.999, refused at exactly 60:00 (check and complete)", async () => {
    const email = await confirmed("ac16-expiry");
    const token = await resetLink(email);
    t += HOUR - 1;
    expect((await checkReset(token)).statusCode).toBe(200);
    t += 1;
    expect((await checkReset(token)).statusCode).toBe(410);
    const late = await completeReset(token);
    expect(late.statusCode).toBe(410);
    expect(late.json().code).toBe("RESET_LINK_INVALID");
    expect((await signIn({ email, password: NEW_PASSWORD })).statusCode).toBe(401);
    expect((await signIn({ email, password: PASSWORD })).statusCode).toBe(200);
  });

  it("a link works once: a second use is refused and changes nothing", async () => {
    const email = await confirmed("ac16-once");
    const token = await resetLink(email);
    expect((await completeReset(token)).statusCode).toBe(200);
    const hash = (await accountRow(email)).password_hash;
    t += MINUTE;
    const again = await completeReset(token, "a third synthetic pass phrase");
    expect(again.statusCode).toBe(410);
    expect((await checkReset(token)).statusCode).toBe(410);
    expect((await accountRow(email)).password_hash).toBe(hash);
    // The link itself is marked used (not merely revoked with the others).
    const { createHash } = await import("node:crypto");
    const { rows } = await db.owner.query(
      `SELECT used_at, revoked_at FROM identity.password_resets WHERE token_digest = $1`,
      [createHash("sha256").update(token).digest()],
    );
    expect(rows[0].used_at).not.toBeNull();
    expect(rows[0].revoked_at).toBeNull();
  });

  it("an unknown or malformed token: 410 or 400, no hashing", async () => {
    const before = hashes;
    expect((await completeReset("C".repeat(43))).statusCode).toBe(410);
    expect((await checkReset("C".repeat(43))).statusCode).toBe(410);
    const malformed = await completeReset("not a token");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("VALIDATION_FAILED");
    expect(hashes).toBe(before);
  });

  it("a new password shorter than 12 characters is refused without using the link", async () => {
    const email = await confirmed("ac16-short");
    const token = await resetLink(email);
    const res = await completeReset(token, "elevenchars");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.body).not.toContain("elevenchars");
    expect((await checkReset(token)).statusCode).toBe(200);
    // 12 lower-case letters are enough (no composition rules).
    expect((await completeReset(token, "onlylowercas")).statusCode).toBe(200);
  });
});

describe("ACC-01 AC16, FR 10 / NFR-15 FR 1: the request never tells whether an address has an account", () => {
  it("confirmed, unconfirmed and unknown addresses: the same status, headers and body byte for byte", async () => {
    const known = await confirmed("enum-known");
    const unconfirmed = await registered("enum-unconfirmed");
    const unknown = nextEmail("enum-nobody");
    const answers = [await askReset(known), await askReset(unconfirmed), await askReset(unknown)];
    for (const res of answers) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(answers[0]!.body);
      expect(comparableHeaders(res.headers)).toEqual(comparableHeaders(answers[0]!.headers));
    }
    await flush();
    expect(resetLetters(known)).toHaveLength(1);
    expect(resetLetters(unconfirmed)).toHaveLength(1);
    expect(lettersTo(unknown)).toHaveLength(0);
  });

  it("nothing about the address runs before the answer: no lookup result, link, letter or hashing on the response path", async () => {
    const email = await confirmed("enum-offpath");
    const hashesBefore = hashes;
    const lettersBefore = mail.sent.length;
    const res = await askReset(email);
    expect(res.statusCode).toBe(200);
    // The answer is out, the work is still queued: no reset row and no letter yet.
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.password_resets r JOIN identity.accounts a ON a.id = r.account_id
       WHERE a.email_normalized = $1`,
      [email],
    );
    expect(rows[0].n).toBe(0);
    expect(mail.sent.length).toBe(lettersBefore);
    expect(queue.length).toBe(1);
    expect(hashes).toBe(hashesBefore);
    await flush();
    expect(resetLetters(email)).toHaveLength(1);
  });

  it("over the letter limit the answer is still the same: within 60 s, and after 5 letters in an hour", async () => {
    const email = await confirmed("enum-limit");
    const unknown = nextEmail("enum-limit-nobody");
    const first = await resetLink(email);
    t += 20_000;
    const [a, b] = [await askReset(email), await askReset(unknown)];
    expect(a.statusCode).toBe(200);
    expect(a.body).toBe(b.body);
    expect(comparableHeaders(a.headers)).toEqual(comparableHeaders(b.headers));
    await flush();
    // Within 60 s no letter goes, and the earlier link stays valid (nothing changed).
    expect(resetLetters(email)).toHaveLength(1);
    expect((await checkReset(first)).statusCode).toBe(200);
  });
});

describe("ACC-01 FR 15 limits for reset letters: one per 60 s and at most 5 per hour per account", () => {
  it("7 requests 2 min apart → 5 letters; the hour after the first, letters go again", async () => {
    const email = await confirmed("limit-hour");
    const start = t;
    for (let i = 0; i < 7; i++) {
      expect((await askReset(email)).statusCode).toBe(200);
      await flush();
      t += 2 * MINUTE;
    }
    expect(resetLetters(email)).toHaveLength(5);
    t = start + HOUR + 1;
    await resetLink(email);
    expect(resetLetters(email)).toHaveLength(6);
  });

  it("at 59 s after a letter nothing goes; at 60 s a new letter goes", async () => {
    const email = await confirmed("limit-60s");
    await resetLink(email);
    t += 59_000;
    await askReset(email);
    await flush();
    expect(resetLetters(email)).toHaveLength(1);
    t += 1_000;
    await askReset(email);
    await flush();
    expect(resetLetters(email)).toHaveLength(2);
  });

  it("parallel requests for one address (pg row lock): exactly one letter and one live link", async () => {
    const email = await confirmed("limit-parallel");
    const answers = await Promise.all(Array.from({ length: 8 }, () => askReset(email)));
    for (const res of answers) expect(res.statusCode).toBe(200);
    await flush(); // the 8 queued lookups run in parallel
    expect(resetLetters(email)).toHaveLength(1);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.password_resets r JOIN identity.accounts a ON a.id = r.account_id
       WHERE a.email_normalized = $1 AND r.revoked_at IS NULL AND r.used_at IS NULL`,
      [email],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("ACC-01 AC17 / NFR-15 FR 3: a reset changes the password and ends every session of the account", () => {
  it("sessions on other devices end; the old password stops working, the new one works; a security notice goes", async () => {
    const email = await confirmed("ac17");
    const phone = sessionOf(await signIn({ email, password: PASSWORD }));
    const laptop = sessionOf(await signIn({ email, password: PASSWORD }));
    for (const cookie of [phone, laptop])
      expect((await request("GET", "/v1/session", { cookie })).statusCode).toBe(200);
    const token = await resetLink(email);
    const res = await completeReset(token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "password-changed" });
    for (const cookie of [phone, laptop]) {
      const me = await request("GET", "/v1/session", { cookie });
      expect(me.statusCode).toBe(401);
      expect(me.json().code).toBe("UNAUTHENTICATED");
    }
    const { rows } = await db.owner.query(
      `SELECT count(*) FILTER (WHERE s.ended_at IS NULL)::int AS open, count(*)::int AS all
       FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id WHERE a.email_normalized = $1`,
      [email],
    );
    expect(rows[0]).toEqual({ open: 0, all: 2 });
    expect((await signIn({ email, password: PASSWORD })).json().code).toBe("INVALID_CREDENTIALS");
    expect((await signIn({ email, password: NEW_PASSWORD })).json()).toEqual({ status: "signed-in" });
    await flush();
    const notice = lettersTo(email).at(-1)!;
    expect(notice.subject).toBe("Пароль у Willowsum змінено");
    expect(notice.text).toContain(`${WEB}/#/password/reset`);
    expect(notice.text).not.toContain(token);
    expect(notice.text).not.toContain(NEW_PASSWORD);
  });

  it("the browser that completes the reset: its own session ends too, its cookie is removed, no new session", async () => {
    const email = await confirmed("ac17-self");
    const here = sessionOf(await signIn({ email, password: PASSWORD }));
    const token = await resetLink(email);
    const res = await completeReset(token, NEW_PASSWORD, here);
    expect(res.statusCode).toBe(200);
    expect(setCookies(res)).toEqual(["session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"]);
    expect((await request("GET", "/v1/session", { cookie: here })).statusCode).toBe(401);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id
       WHERE a.email_normalized = $1 AND s.ended_at IS NULL`,
      [email],
    );
    expect(rows[0].n).toBe(0);
  });

  it("FR 10: a completed reset confirms an unconfirmed address; its pending confirmation link stops working", async () => {
    const email = await registered("ac17-confirms");
    const pendingLink = confirmToken(lettersTo(email).at(-1)!);
    const token = await resetLink(email);
    expect((await completeReset(token)).statusCode).toBe(200);
    const account = await accountRow(email);
    expect(account.email_confirmed_at?.getTime()).toBe(t);
    expect((await signIn({ email, password: NEW_PASSWORD })).json()).toEqual({ status: "signed-in" });
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: pendingLink } })).json(),
    ).toEqual({ result: "invalid" });
    const entries = await auditOf(account.id);
    expect(entries.map((e) => e.changes)).toEqual([
      [{ field: "state", before: null, after: "unconfirmed", masked: false }],
      [{ field: "password", before: "•••", after: "•••", masked: true }],
      [{ field: "state", before: "unconfirmed", after: "confirmed", masked: false }],
    ]);
  });

  it("audit: the password change is logged with the value masked, no hash and no email", async () => {
    const email = await confirmed("ac17-audit");
    await completeReset(await resetLink(email));
    const account = await accountRow(email);
    const entries = await auditOf(account.id);
    const change = entries.at(-1)!;
    expect(change).toMatchObject({
      action: "update",
      actorKind: "system",
      changes: [{ field: "password", masked: true }],
    });
    const text = JSON.stringify(entries);
    expect(text).not.toContain(account.password_hash);
    expect(text).not.toContain(email);
  });

  it("the other reset links of the account stop working after the reset", async () => {
    const email = await confirmed("ac17-others");
    const token = await resetLink(email);
    expect((await completeReset(token)).statusCode).toBe(200);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.password_resets r JOIN identity.accounts a ON a.id = r.account_id
       WHERE a.email_normalized = $1 AND r.used_at IS NULL AND r.revoked_at IS NULL`,
      [email],
    );
    expect(rows[0].n).toBe(0);
  });

  it("defence in depth: any other live link of the account is revoked by the reset", async () => {
    const email = await confirmed("ac17-defence");
    const token = await resetLink(email);
    // A second live link cannot arise through the API (a newer request revokes the older); plant one.
    const spare = "D".repeat(43);
    const { createHash } = await import("node:crypto");
    await db.owner.query(
      `INSERT INTO identity.password_resets (account_id, token_digest, created_at, expires_at)
       SELECT id, $2, $3, $4 FROM identity.accounts WHERE email_normalized = $1`,
      [email, createHash("sha256").update(spare).digest(), new Date(t), new Date(t + HOUR)],
    );
    expect((await checkReset(spare)).statusCode).toBe(200);
    expect((await completeReset(token)).statusCode).toBe(200);
    expect((await checkReset(spare)).statusCode).toBe(410);
    expect((await completeReset(spare, "a third synthetic pass phrase")).statusCode).toBe(410);
  });

  it("a reset clears the failure counter of the address: 3 failures, reset, 2 failures → not locked", async () => {
    const email = await confirmed("ac17-counter");
    for (let i = 1; i <= 3; i++) await signIn({ email, password: `wrong synthetic ${i}` });
    expect((await completeReset(await resetLink(email))).statusCode).toBe(200);
    for (let i = 4; i <= 5; i++)
      expect((await signIn({ email, password: `wrong synthetic ${i}` })).statusCode).toBe(401);
    expect((await signIn({ email, password: NEW_PASSWORD })).json()).toEqual({ status: "signed-in" });
  });

  it("a reset proves control of the address: a locked email signs in with the new password at once, without CAPTCHA", async () => {
    const email = await confirmed("ac17-lock");
    for (let i = 1; i <= 5; i++) await signIn({ email, password: `wrong synthetic ${i}` });
    expect((await signIn({ email, password: PASSWORD })).json().code).toBe("SIGN_IN_LOCKED");
    expect((await completeReset(await resetLink(email))).statusCode).toBe(200);
    expect((await signIn({ email, password: NEW_PASSWORD })).json()).toEqual({ status: "signed-in" });
    // The failure counter is cleared too: 4 new failures do not lock.
    for (let i = 1; i <= 4; i++)
      expect((await signIn({ email, password: `wrong again ${i}` })).statusCode).toBe(401);
  });
});

describe("NFR-15 FR 3 under concurrency", () => {
  it("6 parallel completions of one link → exactly one changes the password; one audit entry", async () => {
    const email = await confirmed("race-once");
    const token = await resetLink(email);
    const passwords = Array.from({ length: 6 }, (_, i) => `synthetic racing pass ${i}`);
    const answers = await Promise.all(passwords.map((p) => completeReset(token, p)));
    const winners = answers.flatMap((res, i) => (res.statusCode === 200 ? [i] : []));
    expect(winners).toHaveLength(1);
    for (const res of answers) if (res.statusCode !== 200) expect(res.json().code).toBe("RESET_LINK_INVALID");
    const winner = passwords[winners[0]!]!;
    const hash = (await accountRow(email)).password_hash;
    for (const p of passwords) expect(await real.verify(hash, p), p).toBe(p === winner);
    expect((await signIn({ email, password: winner })).json()).toEqual({ status: "signed-in" });
    const entries = await auditOf((await accountRow(email)).id);
    expect(entries.filter((e) => e.changes[0]?.field === "password")).toHaveLength(1);
  });

  it("a sign-in that verified the old password before a reset commits: its session is ended by the reset", async () => {
    const email = await confirmed("race-ordered");
    const token = await resetLink(email);
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      hold = { entered: resolve, release: new Promise<void>((r) => (release = r)) };
    });
    const signingIn = signIn({ email, password: PASSWORD });
    await entered; // the old password is verified; the sign-in transaction is still open
    const resetting = completeReset(token);
    await new Promise((r) => setTimeout(r, 300)); // without the locks the reset would finish here
    release();
    const [signedIn, reset] = await Promise.all([signingIn, resetting]);
    expect(reset.statusCode).toBe(200);
    expect(signedIn.statusCode).toBe(200);
    expect((await request("GET", "/v1/session", { cookie: sessionOf(signedIn) })).statusCode).toBe(401);
  });

  it("a sign-in with the old password racing a reset never leaves a live session", async () => {
    const email = await confirmed("race-sign-in");
    let password = PASSWORD;
    for (let round = 0; round < 5; round++) {
      const token = await resetLink(email);
      const next = `synthetic round pass ${round}`;
      const [signedIn, reset] = await Promise.all([signIn({ email, password }), completeReset(token, next)]);
      expect(reset.statusCode).toBe(200);
      if (signedIn.statusCode === 200) {
        const cookie = sessionOf(signedIn);
        expect((await request("GET", "/v1/session", { cookie })).statusCode, `round ${round}`).toBe(401);
      } else {
        expect(signedIn.json().code).toBe("INVALID_CREDENTIALS");
      }
      password = next;
      t += 2 * MINUTE;
    }
  });
});

describe("NFR-15 FR 5: the reset writes check Origin before anything runs", () => {
  it("request, check and complete from another site → 403; no letter, the link stays valid, the password unchanged", async () => {
    const email = await confirmed("origin");
    const token = await resetLink(email);
    const hash = (await accountRow(email)).password_hash;
    t += 2 * MINUTE;
    const evil = "https://evil.example";
    const answers = [
      await askReset(email, evil),
      await request("POST", "/v1/password-resets/check", { body: { token }, origin: evil }),
      await request("POST", "/v1/password-resets/complete", {
        body: { token, password: NEW_PASSWORD },
        origin: evil,
      }),
    ];
    for (const res of answers) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("ORIGIN_NOT_ALLOWED");
    }
    expect(queue).toHaveLength(0);
    await flush();
    expect(resetLetters(email)).toHaveLength(1);
    expect((await checkReset(token)).statusCode).toBe(200);
    expect((await accountRow(email)).password_hash).toBe(hash);
  });
});

describe("CICD-06: the reset routes are behind identity.sign-in", () => {
  it("flag off → 404 like an unknown path; nothing queued", async () => {
    off.add("identity.sign-in");
    const unknown = await request("POST", "/v1/no-such-route", { body: {} });
    const res = await askReset(nextEmail("flag"));
    expect(res.statusCode).toBe(404);
    expect(withoutSupportId(res.body)).toBe(withoutSupportId(unknown.body));
    expect(queue).toHaveLength(0);
  });
});

describe("ARC-09 / NFR-10: no email, name, password or token in telemetry", () => {
  it("a whole reset (request, check, complete, notice) leaves no personal value in exported telemetry", async () => {
    const email = await confirmed("telemetry");
    telemetry.memory.reset();
    await askReset(nextEmail("telemetry-nobody"));
    const token = await resetLink(email);
    await checkReset(token);
    await completeReset(token);
    await completeReset(token); // the refused second use too
    await flush();
    const text = await exportedText(telemetry);
    expect(text.length).toBeGreaterThan(100);
    for (const value of [email, email.split("@")[0]!, "Олена Синтетична", NEW_PASSWORD, PASSWORD, token])
      expect(text, value).not.toContain(value);
  });
});

describe("Owner decision 2026-11-12: a new sign-up of an unconfirmed address replaces its password (pre-account squatting)", () => {
  it("the victim re-registers: the attacker's password and link stop working; the newest link confirms the victim's password", async () => {
    const email = nextEmail("squat");
    const attacker = ["attacker", "chosen", "synthetic", "words"].join(" ");
    const attackerSignUp = await signUp({ name: "Чужий Синтетик", email, password: attacker });
    await flush();
    const attackerLink = confirmToken(lettersTo(email).at(-1)!);
    const attackerToken = attackerSignUp.json().registrationToken as string;
    t += 5 * MINUTE;
    const victim = await signUp({ name: "Олена Синтетична", email, password: PASSWORD });
    expect(victim.statusCode).toBe(200);
    await flush();
    const letters = lettersTo(email);
    expect(letters.map((l) => l.subject)).toEqual([
      "Підтвердьте email для Willowsum",
      "Підтвердьте email для Willowsum",
    ]);
    expect(letters[1]!.text.toLowerCase()).toContain("якщо ви не реєструвалися — нічого не робіть");
    // The attacker's earlier link confirms nothing; the attacker's token still answers (no oracle) but sends nothing.
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: attackerLink } })).json(),
    ).toEqual({ result: "invalid" });
    t += 2 * MINUTE;
    expect(
      (await request("POST", "/v1/registrations/resend", { body: { registrationToken: attackerToken } }))
        .statusCode,
    ).toBe(200);
    await flush();
    expect(lettersTo(email)).toHaveLength(2);
    const victimLink = confirmToken(letters[1]!);
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: victimLink } })).json(),
    ).toEqual({ result: "confirmed" });
    const wrong = await signIn({ email, password: attacker });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe("INVALID_CREDENTIALS");
    expect((await signIn({ email, password: PASSWORD })).json()).toEqual({ status: "signed-in" });
    const account = await accountRow(email);
    expect(account.display_name).toBe("Олена Синтетична");
    const entries = await auditOf(account.id);
    expect(entries.map((e) => e.changes[0]!.field)).toEqual(["state", "password", "state"]);
  });

  it("a re-registration within the letter limit (no new letter) still revokes the attacker's link", async () => {
    const email = nextEmail("squat-limited");
    await signUp({ name: "Чужий Синтетик", email, password: NEW_PASSWORD });
    await flush();
    const attackerLink = confirmToken(lettersTo(email).at(-1)!);
    t += 20_000; // within 60 s of the last letter: no new confirmation letter goes
    await signUp({ name: "Олена Синтетична", email, password: PASSWORD });
    await flush();
    expect(lettersTo(email)).toHaveLength(1);
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: attackerLink } })).json(),
    ).toEqual({ result: "invalid" });
    expect((await signIn({ email, password: NEW_PASSWORD })).statusCode).toBe(401);
  });

  it("the answer is identical byte for byte (but for the random token) for a new and an unconfirmed address", async () => {
    const unconfirmed = await registered("squat-same");
    t += 5 * MINUTE;
    const fresh = await signUp({ name: "Синтетик", email: nextEmail("squat-fresh"), password: PASSWORD });
    const again = await signUp({ name: "Синтетик", email: unconfirmed, password: NEW_PASSWORD });
    const withoutToken = (body: string) =>
      body.replace(/"registrationToken":"[A-Za-z0-9_-]{43}"/, '"registrationToken":"…"');
    expect(again.statusCode).toBe(fresh.statusCode);
    expect(withoutToken(again.body)).toBe(withoutToken(fresh.body));
    expect(comparableHeaders(again.headers)).toEqual(comparableHeaders(fresh.headers));
    // Both hashed the password once on the response path: the same work class.
    await flush();
  });

  it("a confirmed account is never changed by a sign-up with its address", async () => {
    const email = await confirmed("squat-confirmed");
    const before = await accountRow(email);
    t += 5 * MINUTE;
    await signUp({ name: "Чужий Синтетик", email, password: NEW_PASSWORD });
    await flush();
    expect(await accountRow(email)).toEqual(before);
    expect(lettersTo(email).at(-1)!.subject).toBe("Спроба реєстрації з вашою адресою у Willowsum");
    expect((await signIn({ email, password: NEW_PASSWORD })).statusCode).toBe(401);
  });

  it("the attacker's earlier token answers as before (no oracle) but cannot send letters or revoke the victim's link", async () => {
    const email = nextEmail("squat-change");
    const attackerToken = (await signUp({ name: "Чужий Синтетик", email, password: NEW_PASSWORD })).json()
      .registrationToken as string;
    t += 5 * MINUTE;
    await signUp({ name: "Олена Синтетична", email, password: PASSWORD });
    await flush();
    const victimLink = confirmToken(lettersTo(email).at(-1)!);
    const lettersBefore = lettersTo(email).length;
    t += 2 * MINUTE;
    const resend = await request("POST", "/v1/registrations/resend", {
      body: { registrationToken: attackerToken },
    });
    expect(resend.json()).toEqual({ status: "sent", resendAfterS: 60 });
    await flush();
    expect(lettersTo(email)).toHaveLength(lettersBefore);
    const change = await request("POST", "/v1/registrations/change-email", {
      body: { registrationToken: attackerToken },
    });
    expect(change.json()).toEqual({ status: "closed" });
    expect(
      (await request("POST", "/v1/email-confirmations", { body: { token: victimLink } })).json(),
    ).toEqual({ result: "confirmed" });
  });
});
