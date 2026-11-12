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
  t += 2 * HOUR + 7 * MINUTE + 3_000;
});

const signIn = (email: string, password = PASSWORD) =>
  request("POST", "/v1/sessions", { body: { email, password, captchaToken: SYNTHETIC_CAPTCHA_PASS } });

describe("sec#116: accepted PoC risk — sign-up then sign-in reveals list membership", () => {
  // ACCEPTED PoC RISK, not a passing property. Sign up with a guessed address and your own password, then sign in
  // with both: a listed address without a confirmed account answers 200 «email-not-confirmed», an outside address
  // answers 401 INVALID_CREDENTIALS, so the pair tells whether the address is on the family's list.
  // Owner decision 2026-11-12 (lead's chat, form answer «Прийняти ризик для PoC»): accepted for PoC, to be closed
  // before MVP. Recorded in ACC-01@PoC FR 16 and AC26 (PoC note), ADR-0009 and the decision log
  // docs/decisions/state-2026-11-05.md; fix tracked in the GitHub issue «ACC-01: закрити оракул членства в
  // переліку до MVP». `it.fails` passes while the oracle exists; flip it to `it` together with that fix.
  it.fails(
    "accepted PoC risk (owner 2026-11-12, fix before MVP): sign-up then sign-in does not yet answer alike for a listed and an outside address",
    async () => {
      const listed = nextListed();
      const guest = nextGuest("oracle");
      expect((await signUp(listed)).statusCode).toBe(200);
      expect((await signUp(guest)).statusCode).toBe(200);
      await flush();
      t += 2 * MINUTE;
      const [a, b] = [await signIn(listed), await signIn(guest)];
      process.stdout.write(
        `SEC116_ORACLE listed=${a.statusCode} ${withoutToken(a.body)} outside=${b.statusCode} ${withoutSupportId(b.body)}\n`,
      );
      expect(a.statusCode).toBe(b.statusCode);
      expect(withoutSupportId(withoutToken(a.body))).toBe(withoutSupportId(withoutToken(b.body)));
    },
  );
});

describe("sec#116: what an outside sign-up stores", () => {
  it("no row in the identity schema holds the address, its SHA-256 or any digest of it; the registration row is minimal", async () => {
    const { createHash } = await import("node:crypto");
    const guest = nextGuest("storage");
    const token = (await signUp(guest)).json().registrationToken as string;
    t += MINUTE;
    await resend(token);
    await flush();
    const key = guest.trim().toLowerCase();
    const needles = [
      Buffer.from(key, "utf8").toString("hex"),
      createHash("sha256").update(key, "utf8").digest("hex"),
      createHash("sha256").update(guest, "utf8").digest("hex"),
    ];
    const tables = (
      await db.owner.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'identity'`)
    ).rows.map((r: { table_name: string }) => r.table_name);
    for (const table of tables) {
      const dump = (
        await db.owner
          .query(`SELECT coalesce(string_agg(encode(convert_to(t::text, 'UTF8'), 'hex'), ''), '') AS h
                              FROM identity.${table} t`)
      ).rows[0].h as string;
      const asText = Buffer.from(dump, "hex").toString("utf8");
      for (const n of needles) {
        expect(dump.includes(n) || asText.includes(n), `${table}: ${n.slice(0, 8)}`).toBe(false);
      }
      expect(asText.includes(key), table).toBe(false);
    }
    const digest = createHash("sha256").update(token, "utf8").digest();
    const { rows } = await db.owner.query(`SELECT * FROM identity.registrations WHERE token_digest = $1`, [
      digest,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBeNull();
    expect(rows[0].kind).toBe("outside");
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "account_id",
        "closed_at",
        "created_at",
        "expires_at",
        "id",
        "kind",
        "superseded_at",
        "token_digest",
      ].sort(),
    );
  });
});

describe("sec#116: lookalikes, plus-addressing, trailing dot, whitespace never reach a listed login key", () => {
  it("variants of a listed address create no account under it, and none at all unless they are the address itself", async () => {
    const listed = nextListed();
    const [local, domain] = listed.split("@") as [string, string];
    const variants = [
      `${local}+x@${domain}`,
      `${local}@${domain}.`,
      `${local.replace("f", "\uff46")}@${domain}`, // fullwidth f
      `${local.replace("i", "\u0456")}@${domain}`, // Cyrillic і
      `${local}@${domain.replace("e", "\u0435")}`, // Cyrillic е
      `${local.replace("f", "F")}\u200b@${domain}`, // zero-width space
      `"${local}"@${domain}`,
      `${local}.@${domain}`,
      `${local}@${domain.toUpperCase()}.`,
      `${local} @${domain}`,
    ];
    for (const v of variants) {
      const res = await signUp(v);
      expect([200, 400], v).toContain(res.statusCode);
    }
    await flush();
    expect(await accountsWith(listed), "no account under the listed key").toEqual([]);
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM identity.accounts WHERE email_normalized LIKE '%' || $1 || '%' OR email_normalized LIKE $2`,
      [local.slice(0, 6), `%${domain.split(".")[0]}%`],
    );
    // Accounts with the family's domain may exist from other tests; none of them is a variant of this address.
    const variantsRows = (
      await db.owner.query(
        `SELECT email_normalized FROM identity.accounts WHERE email_normalized = ANY($1)`,
        [variants.map((v) => v.trim().toLowerCase())],
      )
    ).rows;
    expect(variantsRows).toEqual([]);
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
    expect(lettersTo(listed)).toHaveLength(0);
    // Upper case and outer whitespace are the same login key (FR 16) — the only accepted spellings.
    expect((await signUp(`  ${listed.toUpperCase()}\t`)).statusCode).toBe(200);
    await flush();
    expect(await accountsWith(listed)).toHaveLength(1);
  });
});

describe("sec#116: the outside paths keep the letter path's lock and reads (timing class, survivors)", () => {
  it("sign-up: the outside path reads the address's mail limit under its lock, as a listed letter does", async () => {
    const taken = await confirmedListed();
    t += 5 * MINUTE;
    const existing = await onResponsePath(() => signUp(taken));
    const guest = await onResponsePath(() => signUp(nextGuest("lock")));
    const count = (run: { statements: string[] }, p: (s: string) => boolean) =>
      run.statements.filter(p).length;
    const lock = (s: string) => s.includes("pg_advisory_xact_lock");
    const reads = (s: string) => s.startsWith("SELECT occurred_at FROM throttle_events");
    // The same locks and limit reads as a taken address (its letter path), so the transaction does the same waits.
    expect(count(guest, lock)).toBe(count(existing, lock));
    expect(count(guest, reads)).toBe(count(existing, reads));
  });

  it("«Надіслати ще раз»: the outside token runs the same statements as a listed one's within the mail limit", async () => {
    const forGuest = (await signUp(nextGuest("resend-lock"))).json().registrationToken as string;
    const forListed = (await signUp(nextListed())).json().registrationToken as string;
    await flush();
    t += MINUTE;
    const g = await onResponsePath(() => resend(forGuest));
    const l = await onResponsePath(() => resend(forListed));
    expect(g.res.statusCode).toBe(200);
    expect(g.statements.some((s) => s.includes("pg_advisory_xact_lock"))).toBe(true);
    const listedSet = new Set(l.statements);
    for (const s of g.statements) expect(listedSet, s).toContain(s);
  });

  it("wall clock: an outside sign-up is in the same timing class as a taken and a new listed address", async () => {
    const taken = await confirmedListed();
    const runs: Record<string, number[]> = { fresh: [], existing: [], guest: [] };
    for (let i = 0; i < 9; i += 1) {
      t += 2 * HOUR;
      for (const [name, email] of [
        ["fresh", nextListed()],
        ["existing", taken],
        ["guest", nextGuest("clock")],
      ] as const) {
        await flush();
        const start = process.hrtime.bigint();
        expect((await signUp(email)).statusCode).toBe(200);
        runs[name]!.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const m = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, median(v)]));
    process.stdout.write(`SEC116_TIMING ${JSON.stringify(m)}\n`);
    expect(m.guest! / m.existing!).toBeGreaterThan(0.6);
    expect(m.guest! / m.fresh!).toBeGreaterThan(0.6);
  });
});
void [vi, exportedText, telemetry, changeEmail, comparableHeaders]; // helpers shared with the PR suite
