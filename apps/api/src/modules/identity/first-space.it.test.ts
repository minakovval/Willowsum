import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityServices, SESSION_IDLE_MS } from "./index.ts";

/** The household module's spaces, as the wiring hands them over (identity never imports household). */
type HouseholdSpaces = ReturnType<typeof householdSpaces>;

/**
 * ACC-01@PoC part c through the real API on a real PostgreSQL (ADR-0010): the first sign-in of a confirmed account
 * creates «Родина <Прізвище>» with the account as Owner; protected routes then know the caller from the session
 * cookie — its account, space and role. The clock is the test's own; mail and CAPTCHA are synthetic.
 */
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const PASSWORD = "synthetic lower case words";

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let spaces: HouseholdSpaces;
let t = Date.UTC(2026, 10, 12, 10, 41, 7, 250);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
const off = new Set<string>();
const killed = new Set<string>();
/** Makes the household side fail while set (a space that cannot be created). */
let spacesDown = false;

let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter % 250}`;
let seq = 0;
const nextEmail = (label: string) => `${label}.${++seq}@example.test`;

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options: { body?: unknown; cookie?: string } = {},
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

async function confirmedAccount(label: string, name: string): Promise<string> {
  const email = nextEmail(label);
  const res = await request("POST", "/v1/registrations", {
    body: { name, email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
  });
  expect(res.statusCode).toBe(200);
  await Promise.all(pending.splice(0));
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  const token = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
  const confirmed = await request("POST", "/v1/email-confirmations", { body: { token } });
  expect(confirmed.json()).toEqual({ result: "confirmed" });
  return email;
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
  const found = all.find((c) => c.startsWith("session="));
  if (!found) throw new Error("no session cookie");
  return found.split(";")[0]!;
}

const signIn = (email: string) => request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });

async function spacesOf(email: string): Promise<{ household_id: string; name: string; role: string }[]> {
  const { rows } = await db.owner.query(
    `SELECT h.household_id, h.name, m.role FROM identity.accounts a
       JOIN household.account_spaces m ON m.account_id = a.id
       JOIN household.households h ON h.household_id = m.space_id
      WHERE a.email_normalized = $1`,
    [email],
  );
  return rows as { household_id: string; name: string; role: string }[];
}

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  const flaky: HouseholdSpaces = {
    ensureFirstSpace: async (owner) => {
      if (spacesDown) throw new Error("household unavailable");
      return spaces.ensureFirstSpace(owner);
    },
    membershipOf: (accountId) => spaces.membershipOf(accountId),
    spaceIds: () => spaces.spaceIds(),
  };
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
    spaces: flaky,
    now: () => t,
    hasher: argon2Hasher(),
    deliver: (task) => {
      pending.push(task());
    },
  });
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: {
          ...base,
          isModuleAvailable: async (module) => !killed.has(module),
          moduleState: async (module) => (killed.has(module) ? "killed" : "on"),
          isEnabledForAll: async (flag) => !off.has(flag),
        },
        identity: services,
        spaces: flaky,
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
  killed.clear();
  spacesDown = false;
  t += 3 * 60 * MINUTE + 11_000;
});

describe("ACC-01 AC5 / FR 7: the first sign-in creates «Родина <Прізвище>» with the user as Owner", () => {
  it("no space before the first sign-in; after it one space, owned by the account; protected routes know the caller", async () => {
    const email = await confirmedAccount("ac5", "Олена Синтетична");
    expect(await spacesOf(email)).toEqual([]);
    const res = await signIn(email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "signed-in" });
    const owned = await spacesOf(email);
    expect(owned).toEqual([{ household_id: expect.any(String), name: "Родина Синтетична", role: "owner" }]);
    const me = await request("GET", "/v1/me/permissions", { cookie: cookieOf(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "owner", scoped: false });
  });

  it("a later sign-in finds the space and creates no other", async () => {
    const email = await confirmedAccount("ac5-again", "Ігор Повторний");
    await signIn(email);
    t += 20 * MINUTE;
    const again = await signIn(email);
    expect(again.statusCode).toBe(200);
    expect(await spacesOf(email)).toHaveLength(1);
  });

  it("concurrent first sign-ins (two tabs) make exactly one space, and every session works in it", async () => {
    const email = await confirmedAccount("ac5-race", "Марта Паралельна");
    const results = await Promise.all([signIn(email), signIn(email), signIn(email)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const owned = await spacesOf(email);
    expect(owned).toHaveLength(1);
    for (const res of results)
      expect((await request("GET", "/v1/me/permissions", { cookie: cookieOf(res) })).statusCode).toBe(200);
  });

  it("an unconfirmed account gets no session and no space (FR 5)", async () => {
    const email = nextEmail("ac5-unconfirmed");
    await request("POST", "/v1/registrations", {
      body: { name: "Ніна Непідтверджена", email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
    });
    await Promise.all(pending.splice(0));
    const res = await signIn(email);
    expect(res.json()).toMatchObject({ status: "email-not-confirmed" });
    expect(await spacesOf(email)).toEqual([]);
  });

  it("when the space cannot be created, the sign-in fails and leaves no live session", async () => {
    const email = await confirmedAccount("ac5-down", "Денис Недоступний");
    spacesDown = true;
    const res = await signIn(email);
    expect(res.statusCode).toBe(500);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id
        WHERE a.email_normalized = $1 AND s.ended_at IS NULL`,
      [email],
    );
    expect(rows[0].n).toBe(0);
    spacesDown = false;
    expect((await signIn(email)).statusCode).toBe(200);
    expect(await spacesOf(email)).toHaveLength(1);
  });
});

describe("П-5: the caller's space comes from the session, never from the request", () => {
  it("two users each work in their own space", async () => {
    const a = await confirmedAccount("p5-a", "Анна Перша");
    const b = await confirmedAccount("p5-b", "Борис Другий");
    const [sa, sb] = [await signIn(a), await signIn(b)];
    const [spaceA] = await spacesOf(a);
    const [spaceB] = await spacesOf(b);
    expect(spaceA!.household_id).not.toBe(spaceB!.household_id);
    const membership = await spaces.membershipOf(
      (await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [a])).rows[0].id,
    );
    expect(membership?.householdId).toBe(spaceA!.household_id);
    expect((await request("GET", "/v1/me/permissions", { cookie: cookieOf(sa) })).statusCode).toBe(200);
    expect((await request("GET", "/v1/me/permissions", { cookie: cookieOf(sb) })).statusCode).toBe(200);
  });

  it("no cookie, a forged cookie, a signed-out or idle session → 401", async () => {
    const email = await confirmedAccount("p5-401", "Віра Вийшла");
    const cookie = cookieOf(await signIn(email));
    expect((await request("GET", "/v1/me/permissions")).statusCode).toBe(401);
    expect(
      (await request("GET", "/v1/me/permissions", { cookie: `session=${"A".repeat(43)}` })).statusCode,
    ).toBe(401);
    t += SESSION_IDLE_MS;
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(401);
    const fresh = cookieOf(await signIn(email));
    expect((await request("DELETE", "/v1/session", { cookie: fresh })).statusCode).toBe(200);
    expect((await request("GET", "/v1/me/permissions", { cookie: fresh })).statusCode).toBe(401);
  });

  it("the flag identity.sign-in off, or identity's kill switch on, serves no session (401)", async () => {
    const email = await confirmedAccount("p5-flag", "Галина Прапорець");
    const cookie = cookieOf(await signIn(email));
    off.add("identity.sign-in");
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(401);
    off.clear();
    killed.add("identity");
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(401);
    killed.clear();
    expect((await request("GET", "/v1/me/permissions", { cookie })).statusCode).toBe(200);
  });
});
