import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createHouseholdSpaces } from "../src/modules/household/index.ts";
import { argon2Hasher, createIdentityServices } from "../src/modules/identity/index.ts";
import { syntheticCaptchaVerifier, SYNTHETIC_CAPTCHA_PASS } from "../src/platform/adapters/captcha/index.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { syntheticMailSender } from "../src/platform/adapters/mail/index.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { createWorker, enqueueJob, type Worker } from "../src/platform/queue/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { fakeFlags } from "./http.ts";
import {
  behaviour,
  CONSUMER,
  drain,
  importFile,
  PRODUCER,
  queueSetup,
  type Behaviour,
} from "./queue-fixture.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

/**
 * ACC-04@PoC AC4 and the edge case of a long background operation, on a real PostgreSQL: an operation the user
 * started runs on the server's queue (ARC-04), tied to the space and not to the session, so the session's end through
 * inactivity does not stop it, and its result is there after the next sign-in. Imports and exports are not built yet
 * (IMP-*, ACC-07 later in wave 2): the queue's heavy fixture job `queue-consumer.import-file` stands in for them.
 */
const WEB = "http://localhost:5173";
const MINUTE = 60_000;
const PASSWORD = "synthetic lower case words";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let app: ReturnType<typeof buildServer>;
let b: Behaviour;
let worker: Worker;
let t = Date.UTC(2026, 10, 14, 16, 22, 41);
const mail = syntheticMailSender();
const pending: Promise<void>[] = [];
const flush = () => Promise.all(pending.splice(0));

type Res = Awaited<ReturnType<typeof app.inject>>;
let cookie: string | undefined;

async function send(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    remoteAddress: "203.0.113.90",
    headers: {
      origin: WEB,
      "user-agent": UA,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  const raw = res.headers["set-cookie"];
  for (const c of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    if (c.startsWith("session=")) cookie = /Max-Age=0\b/.test(c) ? undefined : c.split(";")[0]!;
  return res;
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: [PRODUCER, CONSUMER], modulesDir: fixtures });
  for (const module of [...realModules, PRODUCER, CONSUMER]) await enableModuleLogin(owner, module, password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
    poolSize: 4,
  });
  const audit = createAuditLog(databases.for("audit"));
  const spaces = createHouseholdSpaces(databases.for("household"), audit, localKeyManagement());
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases,
        entitlements: "all-enabled",
        flags: { ...fakeFlags(), isEnabledForAll: async () => true },
        identity: createIdentityServices({
          mail,
          captcha: syntheticCaptchaVerifier(),
          audit,
          webOrigin: WEB,
          spaces,
          now: () => t,
          hasher: argon2Hasher(),
          deliver: (task) => {
            pending.push(task());
          },
        }),
        spaces,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
  b = behaviour();
  worker = createWorker({
    ...queueSetup(databases, b),
    households: () => spaces.spaceIds(),
    retryDelayMs: () => 0,
    pollMs: 20,
  });
});

afterAll(async () => {
  await worker?.stop();
  await app?.close();
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

describe("ACC-04@PoC AC4: an import or export the user started goes on when the session ends through inactivity", () => {
  it("ACC-04@PoC EC1: the long operation runs on the server, the session ends, the result is there after the next sign-in", async () => {
    const email = `acc04-bg.${randomUUID().slice(0, 8)}@example.test`;
    expect(
      (
        await send("POST", "/v1/registrations", {
          name: "Олена Фонова",
          email,
          password: PASSWORD,
          captchaToken: SYNTHETIC_CAPTCHA_PASS,
        })
      ).statusCode,
    ).toBe(200);
    await flush();
    const token = /\/verify\?token=([A-Za-z0-9_-]{43})/.exec(mail.sent.at(-1)!.text)![1]!;
    await send("POST", "/v1/email-confirmations", { token });
    expect((await send("POST", "/v1/sessions", { email, password: PASSWORD })).json()).toEqual({
      status: "signed-in",
    });
    expect((await send("GET", "/v1/space")).statusCode).toBe(200);
    const { rows: member } = await owner.query<{ space_id: string }>(
      `SELECT m.space_id FROM household.account_spaces m JOIN identity.accounts a ON a.id = m.account_id
        WHERE a.email_normalized = $1`,
      [email],
    );
    const householdId = member[0]!.space_id;

    // The user starts the operation: a heavy job of the space, held «running» on the worker.
    let release!: () => void;
    b.hold = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    b.onRun = () => started();
    await databases
      .for(CONSUMER)
      .inHousehold(householdId, (q) =>
        enqueueJob(q, importFile, "acc04-import-1", { note: "synthetic import" }),
      );
    const pass = worker.tick();
    await running;

    // 15 min without a user action: the server ends the session; the next request sees the sign-in screen.
    t += 15 * MINUTE;
    const ended = await send("GET", "/v1/session");
    expect(ended.statusCode).toBe(401);
    expect(ended.json()).toMatchObject({ code: "SESSION_ENDED", sessionEndReason: "idle" });

    // The operation was not interrupted: it finishes and its result is stored for the space.
    release();
    await pass;
    await worker.idle();
    await drain(worker);
    const { rows: jobs } = await owner.query<{ state: string }>(
      `SELECT state FROM queue_consumer.jobs WHERE dedupe_key = 'acc04-import-1'`,
    );
    expect(jobs.map((j) => j.state)).toEqual(["done"]);

    // After the next sign-in the result is in the user's space.
    t += MINUTE;
    expect((await send("POST", "/v1/sessions", { email, password: PASSWORD })).json()).toEqual({
      status: "signed-in",
    });
    expect((await send("GET", "/v1/space")).statusCode).toBe(200);
    const effects = await databases
      .for(CONSUMER)
      .inHousehold(householdId, (q) =>
        q.query<{ note: string }>("SELECT note FROM effects WHERE job_key = 'acc04-import-1'"),
      );
    expect(effects.rows).toEqual([{ note: "synthetic import" }]);
  });
});
