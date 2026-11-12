import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender, type MailMessage } from "../../platform/adapters/mail/index.ts";
import type { ModuleDatabase, ModuleQueryRunner } from "../../platform/db/module-db.ts";
import { buildServer } from "../../platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import type { PasswordHasher } from "./application/index.ts";
import { argon2Hasher, createIdentityServices } from "./index.ts";

/**
 * ACC-01@PoC FR 16, AC26, AC27 (#107) on a real PostgreSQL through the real API: sign-up is open only to the
 * family's addresses (`WS_SIGNUP_ALLOWLIST`). An address outside the list gets the same «Перевірте пошту» answer —
 * status, headers, body, the same work on the response path — as a new listed address and a taken one; no account
 * is created and no letter goes, also not from «Надіслати ще раз». Neither the list nor an address outside it
 * reaches telemetry or the logs. Work «after the answer» is queued and runs only at `flush()`, so a test sees
 * exactly what ran on the response path. Clock, mail and CAPTCHA are the test's own; all values are synthetic.
 */
const telemetry = testTelemetryForFile();
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = ["synthetic", "family", "pass", "phrase"].join(" ");

/** The family's addresses: what the owner would put in WS_SIGNUP_ALLOWLIST (synthetic). */
const FAMILY = Array.from({ length: 80 }, (_, i) => `family.${i + 1}@example.test`);
let familyNext = 0;
const nextListed = () => FAMILY[familyNext++]!;
let seq = 0;
const nextGuest = (label: string) => `guest.${label}.${++seq}@example.test`;

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 14, 23, 41, 700); // not on the hour
const mail = syntheticMailSender();
const captcha = syntheticCaptchaVerifier();
const flags = { ...fakeFlags(), isEnabledForAll: async () => true };
let hashes = 0;
const real = argon2Hasher();
const hasher: PasswordHasher = {
  hash: async (p) => {
    hashes += 1;
    return real.hash(p);
  },
  verify: (h, p) => real.verify(h, p),
};

/** Work after the answer: queued, never started by the request itself. */
const queue: (() => Promise<void>)[] = [];
async function flush(): Promise<void> {
  while (queue.length > 0) await Promise.all(queue.splice(0).map((task) => task()));
}

/** Every statement identity sends while `recording` is set, whitespace collapsed (its parameters are not kept). */
let recording: string[] | null = null;
function countingDatabase(inner: ModuleDatabase): ModuleDatabase {
  const wrapped = Object.create(inner) as ModuleDatabase;
  wrapped.transaction = <T>(work: (q: ModuleQueryRunner) => Promise<T>) =>
    inner.transaction((q) =>
      work({
        query: (text: string, values?: readonly unknown[]) => {
          recording?.push(text.replace(/\s+/g, " ").trim());
          return q.query(text, values);
        },
      } as ModuleQueryRunner),
    );
  return wrapped;
}

let ipCounter = 0;
const nextIp = () => `203.0.${100 + Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

function makeApp(list: readonly string[]) {
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
    signUpAllowlist: list,
  });
  const identityDb = countingDatabase(db.databases.for("identity"));
  return buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: {
          for: (module: string) => (module === "identity" ? identityDb : db.databases.for(module)),
        },
        entitlements: "all-enabled",
        flags,
        identity: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
}

function request(
  method: "POST",
  url: string,
  options: { body?: unknown; ip?: string; server?: ReturnType<typeof buildServer> } = {},
) {
  return (options.server ?? app).inject({
    method,
    url,
    remoteAddress: options.ip ?? nextIp(),
    headers: { "content-type": "application/json", origin: WEB },
    payload: JSON.stringify(options.body ?? {}),
  });
}

const signUp = (
  email: string,
  options: { ip?: string; captchaToken?: string | null; server?: ReturnType<typeof buildServer> } = {},
) =>
  request("POST", "/v1/registrations", {
    body: {
      name: "Олена Синтетична",
      email,
      password: PASSWORD,
      ...(options.captchaToken === null
        ? {}
        : { captchaToken: options.captchaToken ?? SYNTHETIC_CAPTCHA_PASS }),
    },
    ...(options.ip ? { ip: options.ip } : {}),
    ...(options.server ? { server: options.server } : {}),
  });
const resend = (registrationToken: string, server?: ReturnType<typeof buildServer>) =>
  request("POST", "/v1/registrations/resend", { body: { registrationToken }, ...(server ? { server } : {}) });
const changeEmail = (registrationToken: string) =>
  request("POST", "/v1/registrations/change-email", { body: { registrationToken } });

const lettersTo = (address: string): MailMessage[] =>
  mail.sent.filter((m) => m.to.toLowerCase() === address.trim().toLowerCase());
const confirmToken = (m: MailMessage) => {
  const found = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(m.text);
  if (!found) throw new Error("no confirmation link in the letter");
  return found[1]!;
};
const withoutToken = (body: string) =>
  body.replace(/"registrationToken":"[A-Za-z0-9_-]{43}"/, '"registrationToken":"…"');
const withoutSupportId = (body: string) => body.replace(/"supportId":"[0-9a-f]{32}",?/, "");
const comparableHeaders = (headers: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "date"));

const accountsWith = async (email: string) =>
  (
    await db.owner.query(`SELECT * FROM identity.accounts WHERE email_normalized = $1`, [
      email.trim().toLowerCase(),
    ])
  ).rows;

async function confirmedListed(): Promise<string> {
  const email = nextListed();
  expect((await signUp(email)).statusCode).toBe(200);
  await flush();
  const res = await request("POST", "/v1/email-confirmations", {
    body: { token: confirmToken(lettersTo(email).at(-1)!) },
  });
  expect(res.json()).toEqual({ result: "confirmed" });
  return email;
}

/** One request with the statements and password hashes it ran before its answer; queued work stays queued. */
async function onResponsePath(send: () => ReturnType<typeof signUp>) {
  await flush();
  recording = [];
  const hashesBefore = hashes;
  const lettersBefore = mail.sent.length;
  const res = await send();
  const statements = recording;
  recording = null;
  expect(mail.sent.length, "no letter is sent before the answer").toBe(lettersBefore);
  return { res, statements, hashes: hashes - hashesBefore };
}

beforeAll(async () => {
  db = await setupRealModules();
  app = makeApp(FAMILY);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  await flush();
  recording = null;
  t += 2 * HOUR + 7 * MINUTE + 3_000; // outside every window of the test before
});

describe("ACC-01 AC27, FR 16: a listed address signs up; it is matched trimmed and case-insensitively", () => {
  it("«Olena@Example.com » listed as «olena@example.com»: an unconfirmed account and a confirmation letter", async () => {
    const listed = nextListed();
    const typed = ` ${listed.charAt(0).toUpperCase()}${listed.slice(1).replace("example", "Example")} `;
    const res = await signUp(typed);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "check-email", resendAfterS: 60 });
    await flush();
    const [account] = await accountsWith(listed);
    expect(account).toBeDefined();
    expect(account.email_confirmed_at).toBeNull();
    const letters = lettersTo(listed);
    expect(letters).toHaveLength(1);
    expect(letters[0]!.subject).toBe("Підтвердьте email для Willowsum");
    expect(
      (
        await request("POST", "/v1/email-confirmations", { body: { token: confirmToken(letters[0]!) } })
      ).json(),
    ).toEqual({ result: "confirmed" });
  });
});

describe("ACC-01 AC26, FR 16: an address outside the list gets the same answer, and nothing else", () => {
  it("the same status, headers and body byte for byte (but the random token) as a new listed and a taken address", async () => {
    const taken = await confirmedListed();
    t += 5 * MINUTE;
    const answers = [await signUp(nextListed()), await signUp(taken), await signUp(nextGuest("same"))];
    for (const res of answers) {
      expect(res.statusCode).toBe(200);
      expect(withoutToken(res.body)).toBe(withoutToken(answers[0]!.body));
      expect(comparableHeaders(res.headers)).toEqual(comparableHeaders(answers[0]!.headers));
    }
    expect(answers[2]!.json().registrationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("no account and no letter: not at the answer, not after it", async () => {
    const guest = nextGuest("nothing");
    const lettersBefore = mail.sent.length;
    const auditBefore = (await db.owner.query(`SELECT count(*)::int AS n FROM audit.platform_entries`))
      .rows[0].n;
    expect((await signUp(guest)).statusCode).toBe(200);
    await flush();
    expect(await accountsWith(guest)).toEqual([]);
    expect(mail.sent.length).toBe(lettersBefore);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM audit.platform_entries`)).rows[0].n).toBe(
      auditBefore,
    );
    // The «Перевірте пошту» token exists (its buttons must answer like any other), tied to no account.
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.registrations WHERE account_id IS NULL AND kind = 'outside'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("the timing class: one password hash, no letter, and no statement a listed sign-up would not also run", async () => {
    const taken = await confirmedListed();
    t += 5 * MINUTE;
    const fresh = await onResponsePath(() => signUp(nextListed()));
    const existing = await onResponsePath(() => signUp(taken));
    const guest = await onResponsePath(() => signUp(nextGuest("timing")));
    for (const run of [fresh, existing, guest]) {
      expect(run.res.statusCode).toBe(200);
      // The password is hashed for every address, on the response path (the dominant cost, argon2id).
      expect(run.hashes).toBe(1);
    }
    const listedStatements = new Set([...fresh.statements, ...existing.statements]);
    expect(guest.statements.length).toBeGreaterThan(0);
    for (const statement of guest.statements) expect(listedStatements, statement).toContain(statement);
    // The same transactions as a listed sign-up: the limit of the client address, then the sign-up token.
    expect(guest.statements.some((s) => s.startsWith("INSERT INTO registrations"))).toBe(true);
  });

  it("«Надіслати ще раз» and «Змінити email» answer as for a listed address and send nothing", async () => {
    const guest = nextGuest("buttons");
    const forGuest = (await signUp(guest)).json().registrationToken as string;
    const forListed = (await signUp(nextListed())).json().registrationToken as string;
    await flush();
    const lettersBefore = mail.sent.length;
    // Within 60 s: the same 429 with the same Retry-After.
    const early = [await resend(forGuest), await resend(forListed)];
    expect(early[0]!.statusCode).toBe(429);
    expect(withoutSupportId(early[0]!.body)).toBe(withoutSupportId(early[1]!.body));
    expect(early[0]!.headers["retry-after"]).toBe(early[1]!.headers["retry-after"]);
    t += MINUTE;
    const sent = [await resend(forGuest), await resend(forListed)];
    expect(sent[0]!.statusCode).toBe(200);
    expect(sent[0]!.body).toBe(sent[1]!.body);
    expect(comparableHeaders(sent[0]!.headers)).toEqual(comparableHeaders(sent[1]!.headers));
    expect(sent[0]!.json()).toEqual({ status: "sent", resendAfterS: 60 });
    await flush();
    // Only the listed address got its new letter.
    expect(mail.sent.length).toBe(lettersBefore + 1);
    expect(lettersTo(guest)).toHaveLength(0);
    const changed = [await changeEmail(forGuest), await changeEmail(forListed)];
    expect(changed[0]!.statusCode).toBe(200);
    expect(changed[0]!.body).toBe(changed[1]!.body);
    expect(changed[0]!.json()).toEqual({ status: "closed" });
    // Closed, both: the same 404.
    const after = [await resend(forGuest), await resend(forListed)];
    expect(after[0]!.statusCode).toBe(404);
    expect(withoutSupportId(after[0]!.body)).toBe(withoutSupportId(after[1]!.body));
    expect(await accountsWith(guest)).toEqual([]);
  });

  it("five «Надіслати ще раз» an hour for an outside address too, then the same wait as for a listed one", async () => {
    const forGuest = (await signUp(nextGuest("hour"))).json().registrationToken as string;
    const forListed = (await signUp(nextListed())).json().registrationToken as string;
    for (let i = 0; i < 6; i += 1) {
      t += 61_000;
      const [a, b] = [await resend(forGuest), await resend(forListed)];
      expect(a.statusCode, `resend ${i + 1}`).toBe(b.statusCode);
      expect(a.headers["retry-after"]).toBe(b.headers["retry-after"]);
      expect(withoutSupportId(a.body)).toBe(withoutSupportId(b.body));
    }
  });

  it("the CAPTCHA and the limit of 5 sign-ups an hour per client address hold for every address alike", async () => {
    const [guest, listed] = [
      await signUp(nextGuest("captcha"), { captchaToken: null }),
      await signUp(nextListed(), { captchaToken: null }),
    ];
    expect(guest.statusCode).toBe(400);
    expect(guest.json().code).toBe("CAPTCHA_REQUIRED");
    expect(withoutSupportId(guest.body)).toBe(withoutSupportId(listed.body));
    const ip = nextIp();
    for (let i = 0; i < 5; i += 1) expect((await signUp(nextGuest("ip"), { ip })).statusCode).toBe(200);
    const sixth = await signUp(nextListed(), { ip });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe("RATE_LIMITED");
  });

  it("an address taken off the list later: a sign-up or a resend sends nothing and changes nothing", async () => {
    const email = await confirmedListed();
    const unconfirmed = nextListed();
    const pending = (await signUp(unconfirmed)).json().registrationToken as string;
    await flush();
    const narrowed = makeApp(FAMILY.filter((a) => a !== email && a !== unconfirmed));
    await narrowed.ready();
    try {
      const before = await accountsWith(email);
      const lettersBefore = mail.sent.length;
      t += 5 * MINUTE;
      expect((await signUp(email, { server: narrowed })).statusCode).toBe(200);
      expect((await resend(pending, narrowed)).json()).toEqual({ status: "sent", resendAfterS: 60 });
      await flush();
      expect(mail.sent.length).toBe(lettersBefore);
      expect(await accountsWith(email)).toEqual(before);
    } finally {
      await narrowed.close();
    }
  });
});

describe("ACC-01 FR 16 / ARC-09 / NFR-10: neither the list nor an address outside it reaches telemetry or the logs", () => {
  it("sign-up, resend and «Змінити email» for an outside and a listed address leave no address in exported telemetry or on the console", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );
    try {
      telemetry.memory.reset();
      const guest = nextGuest("telemetry");
      const listed = nextListed();
      const tokens = [
        (await signUp(guest)).json().registrationToken as string,
        (await signUp(listed)).json().registrationToken as string,
      ];
      t += MINUTE;
      for (const token of tokens) await resend(token);
      for (const token of tokens) await changeEmail(token);
      await flush();
      const text = (await exportedText(telemetry)) + lines.join("\n");
      expect(text.length).toBeGreaterThan(100);
      for (const value of [guest, guest.split("@")[0]!, listed, ...FAMILY.slice(0, 3), PASSWORD])
        expect(text, value).not.toContain(value);
      expect(text).not.toContain("family.");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
