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
 * Security review of PR #221 (ACC-04@PoC a3): a sign-in whose journal entry cannot be written must not leave its new
 * device in the history without the «Новий вхід» letter (NFR-15@PoC FR 6, FR 29). The audit log of this server fails
 * on demand (`failNext`).
 */
const WEB = "http://localhost:5173";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PASSWORD = "synthetic lower case words";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";

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
async function signedIn(label: string, ua = CHROME_WINDOWS, ip = nextIp()) {
  const email = await confirmedAccount(label);
  const browser = new Browser(ua, ip);
  expect((await browser.signIn(email)).json()).toEqual({ status: "signed-in" });
  await flush();
  const id = await accountId(email);
  const space = (await householdSpaces(db).membershipOf(id))!.householdId;
  return { email, browser, id, space };
}

const audit = () => createAuditLog(db.databases.for("audit"));
let failNext = false;
/** The services' audit log: `record` throws once when `failNext` is set (an audit outage). */
const flakyAudit = () => {
  const real = audit();
  return {
    ...real,
    record: async (...args: Parameters<typeof real.record>) => {
      if (failNext) {
        failNext = false;
        throw new Error("synthetic audit outage");
      }
      return real.record(...args);
    },
  };
};

beforeAll(async () => {
  db = await setupRealModules(4);
  const spaces = householdSpaces(db);
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: flakyAudit(),
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

describe("NFR-15@PoC FR 6, FR 29: a new device always gets «Новий вхід», also when the sign-in's journal entry fails", () => {
  it("the sign-in entry fails once: the next sign-in from that device still sends the letter (or the failed one did)", async () => {
    const { email } = await signedIn("sec221-flaky");
    const from = mail.sent.length;
    failNext = true;
    const first = await new Browser(FIREFOX_LINUX, "198.51.100.150").signIn(email);
    expect(first.statusCode).toBe(500);
    await flush();
    const second = await new Browser(FIREFOX_LINUX, "198.51.100.151").signIn(email);
    expect(second.json()).toEqual({ status: "signed-in" });
    await flush();
    expect(lettersTo(email, from).length).toBeGreaterThanOrEqual(1);
  });
});

const lettersTo = (email: string, from: number) => mail.sent.slice(from).filter((m) => m.to === email);
