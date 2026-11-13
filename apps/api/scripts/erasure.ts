/**
 * The product owner's erasure on a person's request (NFR-12@PoC FR 3, NFR-16@PoC FR 9; ADR-0013 option A), through the
 * data-erasure module. An allowlisted production action: run by the owner, with the owner's approval of the action.
 * The erasure roles of audit and ledger log in for this run only (one-time password set through DATABASE_URL, the
 * migration role) and lose their login when it ends. The erasure log lives outside the main database
 * (WS_ERASURE_LOG_DIR locally; in deployed environments the live log, which is not built yet and fails closed).
 *   node scripts/erasure.ts request --email (address on stdin) | --account <uuid> | run <request uuid> | status | reapply
 */
import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import pg from "pg";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { erasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { ConfigError, loadConfig } from "../src/platform/config/config.ts";
import { withErasureDatabases } from "../src/platform/db/erasure-db.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { ERASURE_USAGE, parseErasureCommand, type ErasureCommand } from "./lib/erasure-cli.ts";

const modules = topologicalOrder(
  JSON.parse(readFileSync(new URL("../module-rules.json", import.meta.url), "utf8")) as ModuleRules,
);

let command: ErasureCommand;
try {
  command = parseErasureCommand(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${ERASURE_USAGE}`);
  process.exit(2);
}

const adminUrl = process.env["DATABASE_URL"];
if (!adminUrl) {
  console.error("DATABASE_URL (the migration role) is not set");
  process.exit(2);
}

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env, "worker", modules);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Configuration error");
  process.exit(1);
}
const { database } = config;
const connection = { host: database.host, port: database.port, database: database.name, ssl: database.ssl };
const context = { ...connection, user: CONTEXT_ROLE, password: database.contextPassword };
const databases = new ModuleDatabases({
  connectionFor: (module) => ({
    ...connection,
    user: moduleRoleName(module),
    password: database.modulePasswords.get(module) ?? "",
  }),
  context,
  poolSize: 1,
});
const logDir = process.env["WS_ERASURE_LOG_DIR"];
if (!config.deployed && config.providerMode === "test" && !logDir) {
  console.error(new ConfigError(["WS_ERASURE_LOG_DIR"]).message);
  process.exit(1);
}
const log = erasureLog(config.providerMode, { deployed: config.deployed }, () => ({ dir: logDir ?? "" }));

// The address comes on stdin, never in argv (`ps`, shell history); trimmed.
const fromStdin = command.kind === "request" && "emailFromStdin" in command.subject;
const email = fromStdin ? (await text(process.stdin)).trim() : "";
if (fromStdin && !email) {
  console.error("request --email: give the address on stdin");
  process.exit(2);
}

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
let exitCode = 0;
try {
  const result = await withErasureDatabases(
    { admin, connectionAs: (user, password) => ({ ...connection, user, password }), context },
    async (erasureDatabases) => {
      const erasure = createDataErasure({ databases, erasureDatabases, log });
      switch (command.kind) {
        case "request":
          return erasure.request("emailFromStdin" in command.subject ? { email } : command.subject);
        case "run":
          return erasure.run(command.requestId);
        case "status":
          return erasure.status();
        case "reapply":
          return { reapplied: await erasure.reapply() };
      }
    },
  );
  // Ids, times and states only: never the address.
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Erasure failed");
  exitCode = 1;
} finally {
  await databases.end();
  await admin.end();
}
process.exit(exitCode);
