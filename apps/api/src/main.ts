/**
 * Entry point of the one backend image (ARC-02 FR 1): `node src/main.ts --role api|worker|scheduler`.
 * The role decides what runs; configuration comes only from the environment (FR 3).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { mountApi } from "./api.ts";
import { createFlagRuntimeFor } from "./modules/feature-flags/index.ts";
import { ConfigError, loadConfig, type Config } from "./platform/config/config.ts";
import { CONTEXT_ROLE } from "./platform/db/isolation.ts";
import { ModuleDatabases } from "./platform/db/module-db.ts";
import { PROBE_ROLE, pendingMigrations, readMigrations } from "./platform/db/migrate.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "./platform/modules/rules.ts";
import { createLifecycle } from "./platform/process/lifecycle.ts";
import { buildServer } from "./platform/process/server.ts";

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
  }),
  context: { ...connection, user: CONTEXT_ROLE, password: config.database.contextPassword },
});

// Flags and kill switches (CICD-06): read from the database by the readiness probe and by requests, reloaded
// when older than 15 s.
const flags = createFlagRuntimeFor(databases.for("feature-flags"));

const lifecycle = createLifecycle(config.shutdownTimeoutMs);
const server = buildServer({
  // Sessions arrive with identity (ACC-01); until then every protected route answers 401.
  ...(config.role === "api"
    ? { api: (app) => mountApi(app, { databases, entitlements: config.planEntitlements, flags }) }
    : {}),
  readiness: async () => {
    const client = await probe.connect();
    try {
      const pending = await pendingMigrations(client, expected);
      if (pending.length > 0) return { ready: false, reason: "schema-behind" };
      // The API serves only once it knows the flags and kill switches (before that every module answers 503).
      // State older than 60 s (reloads failing) makes it not ready too: the ≤ 1 min bound of a kill switch holds.
      if (config.role === "api" && !flags.fresh) {
        await flags.refresh();
        if (!flags.fresh) return { ready: false, reason: flags.loaded ? "flags-stale" : "flags-not-loaded" };
      }
      return { ready: true };
    } finally {
      client.release();
    }
  },
});

lifecycle.onStop(() => probe.end());
lifecycle.onStop(() => databases.end());
lifecycle.onStop(() => server.close());
// worker and scheduler register their job loops here once the queue exists (ARC-04).

await server.listen({ host: "0.0.0.0", port: config.port });
console.log(JSON.stringify({ event: "started", role: config.role, port: config.port }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void lifecycle.stop().then((outcome) => {
      console.log(JSON.stringify({ event: "stopped", role: config.role, outcome }));
      process.exit(outcome === "clean" ? 0 : 1);
    });
  });
}
