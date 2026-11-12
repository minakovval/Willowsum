import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../../api.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../../platform/adapters/captcha/index.ts";
import { syntheticMailSender, type MailMessage } from "../../platform/adapters/mail/index.ts";
import { buildServer } from "../../platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { fakeFlags } from "../../../test/http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog } from "../audit/index.ts";
import { argon2Hasher, createIdentityServices } from "./index.ts";

/**
 * Security review of PR #94 (ACC-01@PoC part b): properties of the password reset the PR's own suite does not
 * pin, each one killing a mutant that survived it. Real PostgreSQL, real API, the production `deliver`
 * (setImmediate) unless a test says otherwise. Synthetic addresses, names and passwords only.
 */
const telemetry = testTelemetryForFile();
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = ["synthetic", "sec94", "first", "phrase"].join(" ");

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
let t = Date.UTC(2026, 10, 12, 13, 17, 41, 900);
const mail = syntheticMailSender();
const order: string[] = [];
let armed = false;
/** When set, the clock of the work after the answer throws an error whose message holds this value. */
let failWith: string | null = null;

let ip = 0;
let seq = 0;
const nextEmail = (label: string) => `sec94.${label}.${++seq}@example.test`;
const request = (url: string, body: unknown, cookie?: string) =>
  app.inject({
    method: "POST",
    url,
    remoteAddress: `198.51.100.${(++ip % 250) + 1}`,
    headers: { "content-type": "application/json", origin: WEB, ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(body),
  });
const lettersTo = (to: string): MailMessage[] => mail.sent.filter((m) => m.to === to);
const tokenIn = (m: MailMessage, re: RegExp) => re.exec(m.text)![1]!;
const resetToken = (m: MailMessage) => tokenIn(m, /\/#\/password\/reset\?token=([A-Za-z0-9_-]{43})/);
const confirmToken = (m: MailMessage) => tokenIn(m, /\/verify\?token=([A-Za-z0-9_-]{43})/);
/** The production deliver runs on setImmediate: wait until the mail adapter has what we expect. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

beforeAll(async () => {
  db = await setupRealModules(6);
  const services = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
    spaces: householdSpaces(db),
    now: () => {
      if (armed) order.push("work");
      if (failWith !== null) {
        const value = failWith;
        failWith = null;
        throw new Error(`synthetic failure for ${value}`);
      }
      return t;
    },
    hasher: argon2Hasher(),
    // no `deliver`: the production setImmediate scheduling is under test
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabledForAll: async () => true },
        identity: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
  app.addHook("onResponse", async (req) => {
    if (armed && req.url === "/v1/password-resets") order.push("responded");
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

async function confirmedAccount(label: string): Promise<string> {
  const email = nextEmail(label);
  t += 2 * HOUR;
  const res = await request("/v1/registrations", {
    name: "Синтетик",
    email,
    password: PASSWORD,
    captchaToken: SYNTHETIC_CAPTCHA_PASS,
  });
  expect(res.statusCode).toBe(200);
  await until(() => lettersTo(email).length === 1);
  const confirmed = await request("/v1/email-confirmations", { token: confirmToken(lettersTo(email)[0]!) });
  expect(confirmed.json()).toEqual({ result: "confirmed" });
  return email;
}

describe("NFR-15 FR 1 with the production deliver: the lookup of a reset request runs after the answer is sent", () => {
  it("no identity work (not even reading the clock) happens before the response has finished", async () => {
    const email = await confirmedAccount("after-flush");
    t += 2 * HOUR;
    order.length = 0;
    armed = true;
    try {
      const res = await request("/v1/password-resets", { email });
      expect(res.statusCode).toBe(200);
      await until(() => lettersTo(email).length === 2);
    } finally {
      armed = false;
    }
    expect(order[0]).toBe("responded");
    expect(order).toContain("work");
  });
});

describe("ACC-01 business rules (NFKC): the new password of a reset is normalised like every other password", () => {
  it("a reset to a full-width password signs in with its NFKC form, and the other way round", async () => {
    const email = await confirmedAccount("nfkc");
    t += 2 * HOUR;
    await request("/v1/password-resets", { email });
    await until(() => lettersTo(email).length === 2);
    const token = resetToken(lettersTo(email).at(-1)!);
    const wide = "ｓｙｎｔｈｅｔｉｃ ｗｉｄｅ ｐｈｒａｓｅ"; // U+FF53 …: NFKC folds it to ASCII
    const ascii = wide.normalize("NFKC");
    expect(ascii).not.toBe(wide);
    expect((await request("/v1/password-resets/complete", { token, password: wide })).statusCode).toBe(200);
    const signedIn = await request("/v1/sessions", { email, password: ascii });
    expect(signedIn.json()).toEqual({ status: "signed-in" });
  });
});

describe("ARC-09 / NFR-10: a failure of the work after the answer reaches telemetry by its class only", () => {
  it("an error whose message holds the address is logged as identity.task_failed without the message", async () => {
    const email = nextEmail("task-failure");
    telemetry.memory.reset();
    failWith = email;
    const res = await request("/v1/password-resets", { email });
    expect(res.statusCode).toBe(200);
    await until(() => failWith === null);
    await new Promise((r) => setTimeout(r, 50));
    const text = await exportedText(telemetry);
    expect(text).toContain("identity.task_failed");
    expect(text).not.toContain(email);
    expect(text).not.toContain(email.split("@")[0]!);
  });
});
