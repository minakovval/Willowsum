/**
 * Entry point of the one backend image (ARC-02 FR 1): `node src/main.ts --role api|worker|scheduler`.
 * The role decides what runs; configuration comes only from the environment (FR 3).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { ConfigError, loadConfig, type Config } from "./platform/config/config.ts";
import { PROBE_ROLE, pendingMigrations, readMigrations } from "./platform/db/migrate.ts";
import { topologicalOrder, type ModuleRules } from "./platform/modules/rules.ts";
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

const lifecycle = createLifecycle(config.shutdownTimeoutMs);
const server = buildServer({
  readiness: async () => {
    const client = await probe.connect();
    try {
      const pending = await pendingMigrations(client, expected);
      return pending.length === 0 ? { ready: true } : { ready: false, reason: "schema-behind" };
    } finally {
      client.release();
    }
  },
});

lifecycle.onStop(() => probe.end());
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
