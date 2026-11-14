import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityMaintenance, createIdentityServices } from "./index.ts";

/**
 * Security review of PR #221 (ACC-04@PoC a3): the properties the review found without a test that fails when
 * their guard is removed: no journal for an unconfirmed account even with a space, the scheme-1 history recognises
 * only its own user agent, «Це був не я» forgets the converted key, the daily task ends only lapsed sessions.
 */
const WEB = "http://localhost:5173";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PASSWORD = "synthetic lower case words";
const WRONG = "a wrong synthetic password";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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

const sha = async (text: string) =>
  (await import("node:crypto")).createHash("sha256").update(text, "utf8").digest();

async function devices(id: string) {
  const { rows } = await db.owner.query<{ key_scheme: number; digest: string }>(
    `SELECT key_scheme, encode(device_digest, 'hex') AS digest FROM identity.sign_in_devices
      WHERE account_id = $1 ORDER BY key_scheme, digest`,
    [id],
  );
  return rows;
}

/** The account's history as the previous release kept it: only the given whole user agents (scheme 1). */
async function legacyHistory(id: string, ...userAgents: string[]) {
  await db.owner.query(`DELETE FROM identity.sign_in_devices WHERE account_id = $1`, [id]);
  for (const ua of userAgents)
    await db.owner.query(
      `INSERT INTO identity.sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at, key_scheme)
       VALUES ($1, $2, '2026-01-01Z', '2026-01-01Z', 1)`,
      [id, await sha(`device:${ua}`)],
    );
}

const lettersTo = (email: string, from: number) => mail.sent.slice(from).filter((m) => m.to === email);

describe("ACC-04@PoC (owner decision 2026-11-14): an unconfirmed account's failed sign-in is written nowhere, also when a space exists for it", () => {
  it("an unconfirmed account that has a space: a wrong password writes no entry", async () => {
    const { email } = await registered("sec221-unconfirmed-space");
    const id = await accountId(email);
    // The guard of the use case, not the missing space, must keep it out of the log.
    const { householdId } = await householdSpaces(db).ensureFirstSpace({
      accountId: id,
      displayName: "Олена Непідтверджена",
    });
    const before = await allAuditRows();
    expect((await new Browser(FIREFOX_LINUX, "198.51.100.131").signIn(email, WRONG)).statusCode).toBe(401);
    await flush();
    expect(await allAuditRows()).toBe(before);
    expect(await journal(householdId, id)).toEqual([]);
  });
});

describe("NFR-15@PoC FR 29: the scheme-1 history recognises only its own user agent; a new device still gets «Новий вхід»", () => {
  it("history of one whole user agent (Safari on iPhone): Firefox on Linux is a new device and gets the letter", async () => {
    const { email, id } = await signedIn("sec221-legacy-other", SAFARI_IPHONE);
    await legacyHistory(id, SAFARI_IPHONE);
    const from = mail.sent.length;
    await new Browser(FIREFOX_LINUX, "198.51.100.132").signIn(email);
    await flush();
    expect(lettersTo(email, from)).toHaveLength(1);
  });

  it("history of one whole user agent: the same browser and system with another version is not recognised by the old row (the migration's one limit), so the letter goes", async () => {
    const { email, id } = await signedIn("sec221-legacy-version", SAFARI_IPHONE);
    await legacyHistory(id, SAFARI_IPHONE);
    const from = mail.sent.length;
    await new Browser(SAFARI_IPHONE.replace("Version/18.1", "Version/18.2"), "198.51.100.133").signIn(email);
    await flush();
    expect(lettersTo(email, from)).toHaveLength(1);
    // The old row stays: it still names only its own user agent.
    expect((await devices(id)).map((r) => r.key_scheme).sort()).toEqual([1, 2]);
  });
});

describe("ACC-04@PoC FR 5: «Це був не я» for a link of the previous release forgets the browser-and-system key the migration added", () => {
  it("a scheme-1 link (whole user agent) with its 0007 key: confirming it removes both, so that device is reported again", async () => {
    const { id } = await signedIn("sec221-notme-legacy");
    // As 0007 leaves it: the suspicious device's scheme-1 row, the link naming it, and its scheme-2 key.
    await legacyHistory(id, CHROME_WINDOWS, FIREFOX_LINUX);
    await db.owner.query(
      `INSERT INTO identity.sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at, key_scheme)
       VALUES ($1, $2, '2026-01-01Z', '2026-01-01Z', 2)`,
      [id, await sha("device:firefox/linux")],
    );
    const token = (await import("node:crypto")).randomBytes(32).toString("base64url");
    await db.owner.query(
      `INSERT INTO identity.not_me_links (account_id, token_digest, device_digest, signed_in_at, device_browser,
                                          device_os, address_masked, created_at, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), 'firefox', 'linux', '198.51.•••.77',
               to_timestamp($4 / 1000.0), to_timestamp($4 / 1000.0) + interval '7 days')`,
      [id, await sha(token), await sha(`device:${FIREFOX_LINUX}`), t],
    );
    expect((await request("POST", "/v1/not-me-links/confirm", { body: { token } })).statusCode).toBe(200);
    const left = (await devices(id)).map((r) => r.digest);
    expect(left).not.toContain((await sha("device:firefox/linux")).toString("hex"));
    expect(left).not.toContain((await sha(`device:${FIREFOX_LINUX}`)).toString("hex"));
    expect(left).toContain((await sha(`device:${CHROME_WINDOWS}`)).toString("hex"));
  });
});

describe("ACC-04@PoC: the daily task ends only sessions that have lapsed", () => {
  it("a session with a user action 14 min ago stays open and is not written; at 15 min it ends as idle", async () => {
    const { browser, id, space } = await signedIn("sec221-alive");
    t += 14 * MINUTE;
    await maintenance().dailyCleanup();
    expect((await browser.send("GET", "/v1/session")).statusCode).toBe(200);
    expect((await journal(space, id)).map((r) => r["event"])).toEqual(["signed-in"]);
    t += 15 * MINUTE;
    await maintenance().dailyCleanup();
    expect((await journal(space, id)).filter((r) => r["event"] === "session-ended")).toEqual([
      expect.objectContaining({ reason: "idle", ip: null, actor: "system", channel: "system" }),
    ]);
  });
});

describe("NFR-15@PoC FR 1: a wrong password and an address without an account give the same answer", () => {
  it("same status, body and headers but the request id; timing measured (informational)", async () => {
    const { email } = await signedIn("sec221-timing");
    const strip = (res: Res) => {
      const h = { ...res.headers } as Record<string, unknown>;
      for (const k of ["date", "x-request-id", "content-length", "connection", "keep-alive"]) delete h[k];
      return { status: res.statusCode, body: res.json(), headers: h };
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 20; i++) {
      t += 16 * MINUTE; // below the lock: at most one failure per address per window
      const s1 = performance.now();
      const a = await new Browser(FIREFOX_LINUX, "198.51.100.140").signIn(email, WRONG);
      known.push(performance.now() - s1);
      const s2 = performance.now();
      const b = await new Browser(FIREFOX_LINUX, "198.51.100.141").signIn(nextEmail("sec221-nobody"), WRONG);
      unknown.push(performance.now() - s2);
      expect(strip(a)).toEqual(strip(b));
      await flush();
    }
    const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
    const out = process.env["SEC221_TIMING"];
    if (out)
      (await import("node:fs")).appendFileSync(
        out,
        `known=${median(known).toFixed(1)} unknown=${median(unknown).toFixed(1)}\n`,
      );
  });
});
