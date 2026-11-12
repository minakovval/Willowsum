import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { argon2Hasher, createIdentityServices } from "../src/modules/identity/index.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../src/platform/adapters/captcha/index.ts";
import { syntheticMailSender } from "../src/platform/adapters/mail/index.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #99 (ACC-01@PoC part c1): the session → space binding of src/api.ts observed through the
 * API on a real PostgreSQL. A probe route of the household module reads the space record under `ctx.inHousehold`,
 * so the test sees which space the database bound for the session, not only that the request was allowed.
 */
const WEB = "http://localhost:5173";
const PASSWORD = ["synthetic", "lower", "case", "words"].join(" ");

const probe = defineRoute({
  module: "household",
  method: "GET",
  path: "/v1/sec99/space",
  operationId: "sec99Space",
  summary: "Security review probe: the space bound for the session",
  access: { permission: "household.data.read", feature: "household.core" },
  response: {
    status: 200,
    description: "The bound space",
    schema: z.object({ householdId: z.string(), role: z.string(), names: z.array(z.string()) }),
  },
  handler: async (_input, ctx) => ({
    householdId: ctx.principal.householdId,
    role: ctx.principal.role,
    names: await ctx.inHousehold(async (q) =>
      (await q.query<{ name: string }>(`SELECT name FROM households ORDER BY name`)).rows.map((r) => r.name),
    ),
  }),
});

let db: RealModulesDatabase;
let app: ReturnType<typeof buildServer>;
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
let ip = 0;
let seq = 0;

function request(
  method: "GET" | "POST",
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: `198.51.100.${++ip % 250}`,
    headers: {
      origin: WEB,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
}

async function confirmed(name: string): Promise<{ email: string; accountId: string }> {
  const email = `sec99.${++seq}.${randomUUID().slice(0, 8)}@example.test`;
  expect(
    (
      await request("POST", "/v1/registrations", {
        body: { name, email, password: PASSWORD, captchaToken: SYNTHETIC_CAPTCHA_PASS },
      })
    ).statusCode,
  ).toBe(200);
  await Promise.all(pending.splice(0));
  const letter = mail.sent.filter((m) => m.to === email).at(-1)!;
  const token = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(letter.text)![1]!;
  await request("POST", "/v1/email-confirmations", { body: { token } });
  const { rows } = await db.owner.query(`SELECT id FROM identity.accounts WHERE email_normalized = $1`, [
    email,
  ]);
  return { email, accountId: rows[0].id as string };
}

async function sessionCookie(email: string): Promise<string> {
  const res = await request("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? (raw as string[]) : [raw as string];
  return all.find((c) => c.startsWith("session="))!.split(";")[0]!;
}

async function spaceOf(accountId: string): Promise<string> {
  const { rows } = await db.owner.query(
    `SELECT space_id FROM household.account_spaces WHERE account_id = $1`,
    [accountId],
  );
  expect(rows).toHaveLength(1);
  return rows[0].space_id as string;
}

beforeAll(async () => {
  db = await setupRealModules(4);
  const spaces = householdSpaces(db);
  const identity = createIdentityServices({
    mail,
    captcha: syntheticCaptchaVerifier(),
    audit: createAuditLog(db.databases.for("audit")),
    webOrigin: WEB,
    spaces,
    hasher: argon2Hasher(),
    deliver: (task) => {
      pending.push(task());
    },
  });
  const flags = { ...fakeFlags(), isEnabledForAll: async () => true };
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => {
      const options = apiOptions({
        databases: db.databases,
        entitlements: "all-enabled",
        flags,
        identity,
        spaces,
        allowedOrigins: new Set([WEB]),
      });
      registerApi(a, { ...options, routes: [...options.routes, probe] });
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("sec99: the session is bound to its own space, in the database too", () => {
  it("each session reads only its own space record; a space id in the request changes nothing", async () => {
    const a = await confirmed("Аліна Секційна");
    const b = await confirmed("Богдан Секційний");
    const [ca, cb] = [await sessionCookie(a.email), await sessionCookie(b.email)];
    const [sa, sb] = [await spaceOf(a.accountId), await spaceOf(b.accountId)];
    expect(sa).not.toBe(sb);

    for (const headers of [{}, { "x-household-id": sb, "x-space-id": sb }]) {
      const res = await request("GET", `/v1/sec99/space?householdId=${sb}`, {
        headers: { cookie: ca, ...headers },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ householdId: sa, role: "owner", names: ["Родина Секційна"] });
    }
    const resB = await request("GET", "/v1/sec99/space", { headers: { cookie: cb } });
    expect(resB.json()).toEqual({ householdId: sb, role: "owner", names: ["Родина Секційний"] });
  });

  it("the role is the account's role in the directory, not an assumed Owner", async () => {
    const owner = await confirmed("Олег Власник");
    await sessionCookie(owner.email);
    const space = await spaceOf(owner.accountId);
    const viewer = await confirmed("Віктор Глядач");
    // A viewer of the owner's space (the directory as ACC-02 invitations will fill it).
    await db.owner.query(
      `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'viewer')`,
      [viewer.accountId, space],
    );
    const cookie = await sessionCookie(viewer.email);
    expect(await spaceOf(viewer.accountId)).toBe(space);
    const me = await request("GET", "/v1/me/permissions", { headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "viewer" });
    const seen = await request("GET", "/v1/sec99/space", { headers: { cookie } });
    expect(seen.json()).toEqual({ householdId: space, role: "viewer", names: ["Родина Власник"] });
  });

  it("a live session whose account lost its space gets 401, not a space and not a 500", async () => {
    const lost = await confirmed("Лука Безпритульний");
    const cookie = await sessionCookie(lost.email);
    await db.owner.query(`DELETE FROM household.account_spaces WHERE account_id = $1`, [lost.accountId]);
    const res = await request("GET", "/v1/sec99/space", { headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});
