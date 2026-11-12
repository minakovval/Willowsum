import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import type { PasswordHasher } from "../src/modules/identity/application/index.ts";
import { argon2Hasher, createIdentityServices } from "../src/modules/identity/index.ts";
import { SYNTHETIC_CAPTCHA_PASS, syntheticCaptchaVerifier } from "../src/platform/adapters/captcha/index.ts";
import { syntheticMailSender, type MailMessage } from "../src/platform/adapters/mail/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { fakeFlags } from "./http.ts";
import { realModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #90 (ACC-01@PoC part a): enumeration, lockout races, CAPTCHA failing closed, single-use
 * links under concurrency, cookie prefix on HTTPS, Origin on every identity write, database isolation of the
 * identity schema. All addresses, names and passwords are synthetic.
 */
const telemetry = testTelemetryForFile();
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = ["synthetic", "lower", "case", "words"].join(" ");
const WRONG = ["another", "synthetic", "guess", "here"].join(" ");

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let httpsApp: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 9, 23, 41, 700); // not on the hour (review of PR #90)
const mail = syntheticMailSender();
const synthetic = syntheticCaptchaVerifier();
let captchaMode: "synthetic" | "throws" = "synthetic";
const captcha = {
  verify: async (token: string) => {
    if (captchaMode === "throws") throw new Error("captcha provider unavailable");
    return synthetic.verify(token);
  },
};
let hashes = 0;
const real = argon2Hasher();
const verified: string[] = [];
const hasher: PasswordHasher = {
  hash: async (p) => {
    hashes += 1;
    return real.hash(p);
  },
  verify: (h, p) => {
    verified.push(h);
    return real.verify(h, p);
  },
};
const pending: Promise<void>[] = [];
const flags = { ...fakeFlags(), isEnabledForAll: async () => true };

let ipCounter = 0;
const nextIp = () => `203.0.${100 + Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `${label}.${++seq}@example.test`;
const flush = async () => {
  await Promise.all(pending.splice(0));
};

type Target = ReturnType<typeof buildServer>;
function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; ip?: string; origin?: string; cookie?: string; target?: Target } = {},
) {
  return (options.target ?? app).inject({
    method,
    url,
    remoteAddress: options.ip ?? nextIp(),
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      origin: options.origin ?? WEB,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}
const signUp = (body: Record<string, unknown>, target?: Target) =>
  request("POST", "/v1/registrations", {
    body: { captchaToken: SYNTHETIC_CAPTCHA_PASS, ...body },
    ...(target ? { target } : {}),
  });
const signIn = (body: Record<string, unknown>, target?: Target) =>
  request("POST", "/v1/sessions", { body, ...(target ? { target } : {}) });
const lettersTo = (address: string): MailMessage[] => mail.sent.filter((m) => m.to === address);
function linkToken(message: MailMessage): string {
  const m = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(message.text);
  if (!m) throw new Error("no confirmation link in the letter");
  return m[1]!;
}
function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
}
async function confirmed(label: string, target?: Target): Promise<string> {
  const email = nextEmail(label);
  expect((await signUp({ name: "Синтетик Тестовий", email, password: PASSWORD }, target)).statusCode).toBe(
    200,
  );
  await flush();
  const res = await request("POST", "/v1/email-confirmations", {
    body: { token: linkToken(lettersTo(email).at(-1)!) },
    ...(target ? { target } : {}),
  });
  expect(res.json()).toEqual({ result: "confirmed" });
  return email;
}

function build(deployed: boolean): Target {
  const services = createIdentityServices({
    mail,
    captcha,
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
    now: () => t,
    hasher,
    deliver: (task) => {
      pending.push(task());
    },
  });
  return buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags,
        identity: services,
        allowedOrigins: new Set([WEB]),
        deployed,
      }),
  });
}

beforeAll(async () => {
  db = await setupRealModules(8);
  app = build(false);
  httpsApp = build(true);
  await app.ready();
  await httpsApp.ready();
});
afterAll(async () => {
  await app?.close();
  await httpsApp?.close();
  await db?.close();
});
beforeEach(() => {
  captchaMode = "synthetic";
  t += 3 * HOUR;
});

describe("sec90 enumeration: «Надіслати ще раз» must not tell a taken address from a new one (NFR-15 FR 1, ACC-01 AC23)", () => {
  /**
   * Two sign-ups for one address, then «Надіслати ще раз» on each after 61 s. For a new address the first sign-up
   * is `new` (confirmation-mail limit) and the second `existing` (attempt-mail limit): two separate limits, so both
   * resends pass. For an address that already had an account both sign-ups are `existing` and share one limit, so
   * the second resend is refused. The status (200 vs 429) tells whether the address had an account.
   */
  async function probe(email: string): Promise<number[]> {
    const first = (await signUp({ name: "Синтетик", email, password: PASSWORD })).json().registrationToken;
    t += 1000;
    const second = (await signUp({ name: "Синтетик", email, password: PASSWORD })).json().registrationToken;
    await flush();
    t += 61_000;
    const a = await request("POST", "/v1/registrations/resend", { body: { registrationToken: first } });
    const b = await request("POST", "/v1/registrations/resend", { body: { registrationToken: second } });
    await flush();
    return [a.statusCode, b.statusCode];
  }

  it("the same sequence answers the same for a taken and a new address", async () => {
    const taken = await confirmed("enum-taken");
    t += 2 * HOUR;
    const forTaken = await probe(taken);
    const forNew = await probe(nextEmail("enum-new"));
    expect(forTaken).toEqual(forNew);
  });
});

describe("sec90 mail limit holds under concurrency (ACC-01 FR 15, AC4)", () => {
  it("parallel «Надіслати ще раз» on several tokens of one address keep the address limit", async () => {
    const email = nextEmail("mail-race");
    const tokens: string[] = [];
    for (let i = 0; i < 8; i++)
      tokens.push((await signUp({ name: "Синтетик", email, password: PASSWORD })).json().registrationToken);
    await flush();
    const before = lettersTo(email).length;
    t += 61_000;
    const answers = await Promise.all(
      tokens.map((registrationToken) =>
        request("POST", "/v1/registrations/resend", { body: { registrationToken } }),
      ),
    );
    await flush();
    // Each token may resend (its own limit), but the address gets at most one letter of each kind per 60 s:
    // one new confirmation link and one attempt letter. Unlocked, every parallel request passed the check.
    expect(answers.every((r) => r.statusCode === 200)).toBe(true);
    expect(lettersTo(email).length - before).toBeLessThanOrEqual(2);
  });
});

describe("sec90 timing: an unknown address costs one argon2id verification like a known one (NFR-15 FR 2)", () => {
  it("the decoy is a real argon2id hash with the account parameters", async () => {
    const email = await confirmed("decoy-known");
    verified.length = 0;
    await signIn({ email: nextEmail("decoy-unknown"), password: WRONG });
    await signIn({ email, password: WRONG });
    expect(verified).toHaveLength(2);
    for (const h of verified) expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});

describe("sec90 lockout: parallel failures are counted one after another (NFR-01 FR 9, ACC-01 AC14)", () => {
  it("10 parallel wrong passwords → exactly 4 «wrong» and 6 «locked»; the right password is then refused", async () => {
    const email = await confirmed("race");
    const answers = await Promise.all(Array.from({ length: 10 }, () => signIn({ email, password: WRONG })));
    const codes = answers.map((r) => r.json().code as string).sort();
    expect(codes.filter((c) => c === "INVALID_CREDENTIALS")).toHaveLength(4);
    expect(codes.filter((c) => c === "SIGN_IN_LOCKED")).toHaveLength(6);
    const right = await signIn({ email, password: PASSWORD });
    expect(right.statusCode).toBe(429);
    expect(setCookies(right)).toEqual([]);
  });

  it("case and whitespace variants of the address share one counter: no lockout bypass", async () => {
    const email = await confirmed("variants");
    const variants = [
      email.toUpperCase(),
      `  ${email}`,
      `${email}\t`,
      email.replace(/^./, (c) => c.toUpperCase()),
      email,
    ];
    for (const v of variants.slice(0, 4))
      expect((await signIn({ email: v, password: WRONG })).json().code).toBe("INVALID_CREDENTIALS");
    expect((await signIn({ email: variants[4]!, password: WRONG })).json().code).toBe("SIGN_IN_LOCKED");
    for (const v of variants)
      expect((await signIn({ email: v, password: PASSWORD })).json().code).toBe("SIGN_IN_LOCKED");
  });
});

describe("sec90 CAPTCHA fails closed (ACC-01 FR 12)", () => {
  it("after a lockout, a CAPTCHA outage or a wrong token never lets the right password in; nothing personal reaches telemetry", async () => {
    const email = await confirmed("captcha");
    for (let i = 0; i < 5; i++) await signIn({ email, password: WRONG });
    t += 16 * MINUTE;
    telemetry.memory.reset();
    expect((await signIn({ email, password: PASSWORD })).json().code).toBe("CAPTCHA_REQUIRED");
    expect((await signIn({ email, password: PASSWORD, captchaToken: "replayed-or-wrong" })).json().code).toBe(
      "CAPTCHA_REQUIRED",
    );
    captchaMode = "throws";
    const outage = await signIn({ email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS });
    expect(outage.statusCode).toBeGreaterThanOrEqual(400);
    expect(setCookies(outage)).toEqual([]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id
       WHERE a.email_normalized = $1 AND s.created_at > to_timestamp($2 / 1000.0) - interval '1 hour'`,
      [email, t],
    );
    expect(rows[0].n).toBe(0);
    const text = await exportedText(telemetry);
    for (const value of [email, email.split("@")[0]!, PASSWORD]) expect(text).not.toContain(value);
  });

  it("a CAPTCHA outage at sign-up creates no account", async () => {
    captchaMode = "throws";
    const email = nextEmail("captcha-signup");
    const res = await signUp({ name: "Синтетик", email, password: PASSWORD });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const { rows } = await db.owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("sec90 credentials: limits are checked before hashing", () => {
  it("a sign-up password over 256 code points is refused without hashing; a 1024-unit NFKC-expanding sign-in password is just wrong", async () => {
    const before = hashes;
    const res = await signUp({ name: "Синтетик", email: nextEmail("long"), password: "a".repeat(257) });
    expect(res.statusCode).toBe(400);
    expect(hashes).toBe(before);
    const email = await confirmed("expand");
    // U+FDFA expands to 18 code points under NFKC.
    const started = Date.now();
    const wide = await signIn({ email, password: "ﷺ".repeat(1024) });
    expect(wide.json().code).toBe("INVALID_CREDENTIALS");
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await signIn({ email, password: "a".repeat(1025) })).statusCode).toBe(400);
  });
});

describe("sec90 tokens: a confirmation link is single use under concurrency (ACC-01 FR 14)", () => {
  it("6 parallel opens of one link → exactly one «confirmed» and one audit entry", async () => {
    const email = nextEmail("single-use");
    await signUp({ name: "Синтетик", email, password: PASSWORD });
    await flush();
    const token = linkToken(lettersTo(email)[0]!);
    const answers = await Promise.all(
      Array.from({ length: 6 }, () => request("POST", "/v1/email-confirmations", { body: { token } })),
    );
    const results = answers.map((r) => r.json().result as string);
    expect(results.filter((r) => r === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r === "already-used")).toHaveLength(5);
    const { rows } = await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [
      email,
    ]);
    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: "identity.account",
      id: rows[0].id as string,
    });
    expect(entries.filter((e) => e.action === "update")).toHaveLength(1);
  });
});

describe("sec90 sessions (NFR-15 FR 5, NFR-01 FR 10)", () => {
  it("on HTTPS the cookie is __Secure-session; a plain «session» cookie (cookie tossing) is never accepted", async () => {
    const email = await confirmed("https", httpsApp);
    const res = await signIn({ email, password: PASSWORD }, httpsApp);
    const cookie = setCookies(res).find((c) => c.startsWith("__Secure-session="))!;
    expect(cookie).toMatch(
      /^__Secure-session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax$/,
    );
    const value = cookie.split(";")[0]!.split("=")[1]!;
    expect(
      (await request("GET", "/v1/session", { cookie: `__Secure-session=${value}`, target: httpsApp }))
        .statusCode,
    ).toBe(200);
    expect(
      (await request("GET", "/v1/session", { cookie: `session=${value}`, target: httpsApp })).statusCode,
    ).toBe(401);
  });

  it("sign-in mints its own token (no fixation): a planted cookie value never becomes a session", async () => {
    const email = await confirmed("fixation");
    const planted = "A".repeat(43);
    const res = await request("POST", "/v1/sessions", {
      body: { email, password: PASSWORD },
      cookie: `session=${planted}`,
    });
    const value = setCookies(res)[0]!.split(";")[0]!.split("=")[1]!;
    expect(value).not.toBe(planted);
    expect((await request("GET", "/v1/session", { cookie: `session=${planted}` })).statusCode).toBe(401);
  });

  it("a session ends at 12 h even when used every 14 min (absolute end is server-side)", async () => {
    const email = await confirmed("absolute");
    const value = setCookies(await signIn({ email, password: PASSWORD }))[0]!.split(";")[0]!;
    const start = t;
    while (t + 14 * MINUTE < start + 12 * HOUR) {
      t += 14 * MINUTE;
      expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(200);
    }
    t = start + 12 * HOUR;
    expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(401);
  });

  it("idle: 14 min 59 s keeps the session, exactly 15 min ends it", async () => {
    const email = await confirmed("idle");
    const value = setCookies(await signIn({ email, password: PASSWORD }))[0]!.split(";")[0]!;
    t += 15 * MINUTE - 1000;
    expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(200);
    t += 15 * MINUTE;
    expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(401);
  });
});

describe("sec90 CSRF: every identity write checks Origin (NFR-15 FR 5)", () => {
  it("resend, change-email, link resend and sign-out from another site → 403; the session stays alive", async () => {
    const email = await confirmed("csrf");
    const value = setCookies(await signIn({ email, password: PASSWORD }))[0]!.split(";")[0]!;
    const evil = "https://evil.example";
    const token = "A".repeat(43);
    for (const [method, url, body] of [
      ["POST", "/v1/registrations/resend", { registrationToken: token }],
      ["POST", "/v1/registrations/change-email", { registrationToken: token }],
      ["POST", "/v1/email-confirmations/resend", { token }],
      ["DELETE", "/v1/session", undefined],
    ] as const) {
      const res = await request(method, url, {
        ...(body ? { body } : {}),
        origin: evil,
        cookie: value,
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe("ORIGIN_NOT_ALLOWED");
    }
    expect((await request("GET", "/v1/session", { cookie: value })).statusCode).toBe(200);
  });
});

describe("sec90 DB isolation (ARC-03, ADR-0009)", () => {
  it("every other module role gets 42501 on every identity table, for reads and writes", async () => {
    const { rows } = await db.owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'identity' ORDER BY 1`,
    );
    const tables = rows.map((r) => r.tablename as string);
    expect(tables).toEqual([
      "accounts",
      "email_confirmations",
      "registrations",
      "sessions",
      "sign_in_guards",
      "throttle_events",
    ]);
    const others = realModules.filter((m) => m !== "identity");
    expect(others.length).toBeGreaterThan(0);
    for (const module of others)
      for (const table of tables)
        for (const sql of [`SELECT 1 FROM identity.${table} LIMIT 1`, `DELETE FROM identity.${table}`]) {
          const error = (await db.databases
            .for(module)
            .transaction((q) => q.query(sql))
            .then(
              () => null,
              (e: unknown) => e,
            )) as { code?: string } | null;
          expect(error?.code, `${module}: ${sql}`).toBe("42501");
        }
  });
});

describe("sec90 mutation killers", () => {
  it("a session row of an unconfirmed account never authenticates (defence in depth, ACC-01 FR 5)", async () => {
    const email = nextEmail("unconfirmed-session");
    await signUp({ name: "Синтетик", email, password: PASSWORD });
    await flush();
    const value = ["unconfirmed", "row", "synthetic", "value", "x"].join("-").padEnd(43, "z");
    const { createHash } = await import("node:crypto");
    await db.owner.query(
      `INSERT INTO identity.sessions (account_id, token_digest, created_at, last_seen_at, expires_at)
       SELECT id, $2, to_timestamp($3 / 1000.0), to_timestamp($3 / 1000.0), to_timestamp($3 / 1000.0) + interval '12 hours'
       FROM identity.accounts WHERE email_normalized = $1`,
      [email, createHash("sha256").update(value).digest(), t],
    );
    expect((await request("GET", "/v1/session", { cookie: `session=${value}` })).statusCode).toBe(401);
  });

  it("a right password clears the failure counter: 4 failures, success, 1 failure → not locked", async () => {
    const email = await confirmed("counter-reset");
    for (let i = 0; i < 4; i++) await signIn({ email, password: WRONG });
    expect((await signIn({ email, password: PASSWORD })).json()).toEqual({ status: "signed-in" });
    expect((await signIn({ email, password: WRONG })).json().code).toBe("INVALID_CREDENTIALS");
  });

  it("NFKC: a password typed with compatibility characters signs in with its normalised form and back", async () => {
    const email = nextEmail("nfkc");
    // Fullwidth letters and the «ﬁ» ligature normalise to plain ASCII under NFKC.
    const typed = "ｓｙｎｔｈｅｔｉｃ ﬁxture words";
    const plain = typed.normalize("NFKC");
    expect(plain).not.toBe(typed);
    await signUp({ name: "Синтетик", email, password: typed });
    await flush();
    await request("POST", "/v1/email-confirmations", {
      body: { token: linkToken(lettersTo(email).at(-1)!) },
    });
    expect((await signIn({ email, password: plain })).json()).toEqual({ status: "signed-in" });
    expect((await signIn({ email, password: typed })).json()).toEqual({ status: "signed-in" });
  });
});
