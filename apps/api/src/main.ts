/**
 * Entry point of the one backend image (ARC-02 FR 1): `node src/main.ts --role api|worker|scheduler`.
 * The role decides what runs; configuration comes only from the environment (FR 3).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { mountApi } from "./api.ts";
import { createAuditLog } from "./modules/audit/index.ts";
import { createFlagRuntimeFor } from "./modules/feature-flags/index.ts";
import { startFxRatesRefresh } from "./modules/fx-rates/index.ts";
import { createHouseholdSpaces, createSpaceKeys } from "./modules/household/index.ts";
import { createIdentityServices } from "./modules/identity/index.ts";
import { captchaVerifier } from "./platform/adapters/captcha/index.ts";
import { keyManagement } from "./platform/adapters/kms/index.ts";
import { mailSender } from "./platform/adapters/mail/index.ts";
import { ConfigError, loadConfig, type Config } from "./platform/config/config.ts";
import { CONTEXT_ROLE } from "./platform/db/isolation.ts";
import { ModuleDatabases } from "./platform/db/module-db.ts";
import { PROBE_ROLE, pendingMigrations, readMigrations } from "./platform/db/migrate.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "./platform/modules/rules.ts";
import { scheduleDaily } from "./platform/process/daily.ts";
import { createLifecycle } from "./platform/process/lifecycle.ts";
import { createApiRateLimits } from "./platform/http/rate-limit.ts";
import { buildServer } from "./platform/process/server.ts";
import { logEvent } from "./platform/telemetry/signals.ts";
import { startTelemetry } from "./platform/telemetry/telemetry.ts";
import {
  contextPoolOptions,
  flagReloadHealthLog,
  modulePoolOptions,
  readinessCheck,
  schedulerDailyTasks,
} from "./wiring.ts";

const rules = JSON.parse(
  readFileSync(new URL("../module-rules.json", import.meta.url), "utf8"),
) as ModuleRules;
const modules = topologicalOrder(rules);
const { values } = parseArgs({ options: { role: { type: "string", default: "" } } });

let config: Config;
try {
  config = loadConfig(process.env, values.role, modules);
} catch (error) {
  // The message names variables only (ConfigError); nothing else is printed.
  console.error(error instanceof ConfigError ? error.message : "Configuration error");
  process.exit(1);
}

// Telemetry first, so everything after it is traced (ARC-09; every role). Its exporter is configuration only.
const telemetry = startTelemetry({
  mode: config.telemetry.mode,
  role: config.role,
  environment: config.telemetry.environment,
  ...(config.telemetry.otlp ? { otlp: config.telemetry.otlp } : {}),
});

const expected = readMigrations({
  modules,
  modulesDir: fileURLToPath(new URL("./modules", import.meta.url)),
});
const probe = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: PROBE_ROLE,
  password: config.database.probePassword,
  ssl: config.database.ssl,
  max: 1,
  connectionTimeoutMillis: 2_000,
});
// An idle client that loses its connection (database restart, failover) must not crash the process: the
// next readiness check simply reports «не готовий». Nothing about the error is logged (it holds connection details).
probe.on("error", () => undefined);

const connection = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  ssl: config.database.ssl,
};
// Each module's own pool and role (ARC-01); the API serves module routes through them (ARC-07).
const databases = new ModuleDatabases({
  connectionFor: (module) => ({
    ...connection,
    user: moduleRoleName(module),
    password: config.database.modulePasswords.get(module) ?? "",
    // The flag check must never hang on the database (CICD-06 FR 3).
    ...modulePoolOptions(module),
  }),
  context: {
    ...connection,
    user: CONTEXT_ROLE,
    password: config.database.contextPassword,
    ...contextPoolOptions(),
  },
});

// Flags and kill switches (CICD-06): read from the database by the readiness probe and by requests, reloaded
// when older than 15 s.
const flags = createFlagRuntimeFor(databases.for("feature-flags"), {
  // Once when reloads start failing (by error class) and once when they recover — never on every attempt.
  onReloadHealth: flagReloadHealthLog,
});

const audit = createAuditLog(databases.for("audit"));
// Spaces (ACC-01 part c): the first space on the first sign-in, and the space of a session.
// Keys of spaces (ARC-06 FR 1; ADR-0012): the master key only through the KMS port, chosen by WS_PROVIDER_MODE. The live
// adapter (OCI Vault) is not built yet and fails closed: a deployed process makes no space without a key.
const kms = keyManagement(config.providerMode, () => ({}));
const spaces = createHouseholdSpaces(databases.for("household"), audit, kms);

// Sign-up and sign-in (ACC-01): the provider ports chosen by WS_PROVIDER_MODE (ARC-05). In staging and production
// the configuration allows only the live adapters (ACC-01 FR 12: no server without CAPTCHA there).
const identity =
  config.role === "api"
    ? createIdentityServices({
        mail: mailSender(config.providerMode, () => ({
          apiKey: config.identity.mail!.apiKey,
          from: config.identity.mail!.from,
        })),
        captcha: captchaVerifier(config.providerMode, () => ({ secret: config.identity.captchaSecret! })),
        audit,
        webOrigin: config.identity.webOrigin,
        spaces,
        // ACC-01 FR 16: sign-up only for the family's addresses (required in staging and production).
        ...(config.identity.signUpAllowlist ? { signUpAllowlist: config.identity.signUpAllowlist } : {}),
      })
    : undefined;

// The password hashing binding loads now, not at the first sign-up: without it the api role does not start.
if (identity) {
  try {
    await identity.hasher.hash(identity.secrets.token());
  } catch (error) {
    logEvent("identity.hasher_unavailable", "error", {
      "ws.module": "identity",
      "error.type": error instanceof Error ? error.constructor.name : "Error",
    });
    process.exit(1);
  }
}

const lifecycle = createLifecycle(config.shutdownTimeoutMs);
// Stop hooks run in reverse order: telemetry is flushed last, after the server and the pools.
lifecycle.onStop(() => telemetry.shutdown());
// NFR-14 FR 9: rate limits are off only by the explicit load-test setting (never in production, config.ts).
if (config.http.rateLimits !== "on") logEvent("rate_limits.disabled", "warn", { "ws.role": config.role });
const server = buildServer({
  // A protected route's caller is the session's account in its space (ACC-01 part c, ADR-0010).
  ...(config.role === "api"
    ? {
        api: (app) =>
          mountApi(app, {
            databases,
            entitlements: config.planEntitlements,
            flags,
            // Counters in this process: the configuration allows one API instance with them (NFR-14 FR 10).
            rateLimits: config.http.rateLimits === "on" ? createApiRateLimits() : "off",
            allowedOrigins: config.http.allowedOrigins,
            ...(identity ? { identity, spaces } : {}),
            deployed: config.deployed,
          }),
      }
    : {}),
  hsts: config.deployed,
  trustedProxyHops: config.http.trustedProxyHops,
  // Schema at least this version; for the api role fresh flags too (before that every module answers 503).
  readiness: readinessCheck({
    role: config.role,
    pendingMigrations: async () => {
      const client = await probe.connect();
      try {
        return (await pendingMigrations(client, expected)).length;
      } finally {
        client.release();
      }
    },
    flags,
  }),
});

lifecycle.onStop(() => probe.end());
lifecycle.onStop(() => databases.end());
lifecycle.onStop(() => server.close());
// The scheduler's daily tasks (ADR-0010); the worker registers its job loops here once the queue exists (ARC-04).
if (config.role === "scheduler") {
  // The owner's alert letters (VAL-05 FR 4, FIN-04 FR 10; owner decision 2026-11-12: PoC alerts are app emails).
  const alertMail = config.alerts.email
    ? {
        to: config.alerts.email,
        mail: mailSender(config.providerMode, () => ({
          apiKey: config.identity.mail!.apiKey,
          from: config.identity.mail!.from,
        })),
      }
    : undefined;
  // Identity's cleanup (NFR-12@PoC: unconfirmed accounts after 30 days) and the ledger's integrity check with the
  // owner's letter (FIN-04 FR 9, FR 10; without a recipient, an «error» event instead).
  const daily = scheduleDaily(
    schedulerDailyTasks({
      databases,
      audit,
      spaces,
      // ARC-06 FR 3: the keys of spaces follow a master key rotation in the background.
      spaceKeys: createSpaceKeys(databases.for("household"), audit, kms),
      ...(alertMail ? { alertMail } : {}),
    }),
  );
  lifecycle.onStop(() => daily.stop());
  // VAL-05 FR 4: without the owner's address no alert letter can go out; say so loudly (the address is never logged).
  if (config.deployed && !config.alerts.email)
    logEvent("alerts.recipient_missing", "error", { "ws.module": "fx-rates", "ws.role": config.role });
  // Exchange rates once a day with retries (VAL-05): the NBU in deployed environments, synthetic locally and in CI.
  // Not wrapped in runScheduled: it logs every failed run at error level, and VAL-05 FR 4 keeps the error level for
  // 24 h without a successful update; a failed attempt is a warning.
  const fx = startFxRatesRefresh({
    db: databases.for("fx-rates"),
    mode: config.providerMode,
    // VAL-05 FR 4 (owner decision 2026-11-12): one letter to the product owner per stale period, via the mail adapter.
    ...(alertMail ? { alertMail } : {}),
    report: (event) => {
      const attributes = { "ws.module": "fx-rates", "ws.job.name": "fx-rates.refresh" };
      // FR 4, AC2: 24 h without a successful update is an error-level event in the server log.
      if (event.kind === "stale")
        logEvent("fx_rates.stale", "error", {
          ...attributes,
          "ws.provider.attempts": Math.min(event.failures, 100),
        });
      else if (event.kind === "updated")
        logEvent("fx_rates.updated", "info", { ...attributes, "ws.outcome": "success" });
      else if (event.kind === "failed")
        logEvent("fx_rates.attempt_failed", "warn", { ...attributes, "error.type": event.errorClass });
      else if (event.kind === "alert-sent") logEvent("fx_rates.alert_sent", "info", attributes);
      else logEvent("fx_rates.alert_failed", "error", { ...attributes, "error.type": event.errorClass });
    },
  });
  lifecycle.onStop(() => fx.stop());
}

await server.listen({ host: "0.0.0.0", port: config.port });
logEvent("process.started", "info", { "ws.role": config.role });
/**
 * Lifecycle lines written directly to stdout, outside telemetry: «stopped» comes after telemetry has stopped.
 * Same base fields as the server log lines of `WS_TELEMETRY=off` (time, severity, event), no personal data.
 */
const lifecycleLine = (event: string, severity: "INFO" | "WARN", fields: Record<string, string | number>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), severity, event, ...fields }));
lifecycleLine("started", "INFO", { role: config.role, port: config.port });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void lifecycle.stop().then((outcome) => {
      lifecycleLine("stopped", outcome === "clean" ? "INFO" : "WARN", { role: config.role, outcome });
      process.exit(outcome === "clean" ? 0 : 1);
    });
  });
}
