/**
 * The rebuild command of the ledger's daily balance cache (ARC-11 «Баланси і продуктивність»; issue #126): rebuilds
 * the cache of a space, or of one ledger account, from the postings, through the ledger module's own role (bound to
 * the space; the row policy keeps it there). The journal is not changed. Uses the same configuration as the processes
 * (WS_DB_*, the module passwords); prints counts only, never amounts.
 *   node scripts/ledger-balances.ts rebuild <space uuid> [<ledger account uuid>]
 */
import { readFileSync } from "node:fs";
import { createLedger, LedgerError } from "../src/modules/ledger/index.ts";
import { ConfigError, loadConfig } from "../src/platform/config/config.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import {
  LEDGER_BALANCES_USAGE,
  parseLedgerBalancesCommand,
  type RebuildCommand,
} from "./lib/ledger-balances-cli.ts";

const modules = topologicalOrder(
  JSON.parse(readFileSync(new URL("../module-rules.json", import.meta.url), "utf8")) as ModuleRules,
);

let command: RebuildCommand;
try {
  command = parseLedgerBalancesCommand(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${LEDGER_BALANCES_USAGE}`);
  process.exit(2);
}

let databases: ModuleDatabases;
try {
  const { database } = loadConfig(process.env, "worker", modules);
  const connection = { host: database.host, port: database.port, database: database.name, ssl: database.ssl };
  databases = new ModuleDatabases({
    connectionFor: (module) => ({
      ...connection,
      user: moduleRoleName(module),
      password: database.modulePasswords.get(module) ?? "",
    }),
    context: { ...connection, user: CONTEXT_ROLE, password: database.contextPassword },
    poolSize: 1,
  });
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Configuration error");
  process.exit(1);
}

try {
  const rebuilt = await createLedger(databases.for("ledger")).rebuildBalances(
    command.householdId,
    command.accountId,
  );
  console.log(JSON.stringify(rebuilt));
} catch (error) {
  // Only the ledger's own codes: database errors may hold connection details.
  console.error(error instanceof LedgerError ? error.code : "The rebuild failed");
  process.exitCode = 1;
} finally {
  await databases.end();
}
