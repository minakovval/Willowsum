/**
 * The one-time re-wrap of space keys off the fixed-label test key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; security review
 * of #722): every space key still wrapped by a `local-N` version is rewrapped by the installation's own key, the file
 * of `WS_KMS_KEY_FILE` (made with a random key if it is not there yet). Uses the same configuration as the processes
 * (WS_DB_*, the module passwords, WS_KMS_KEY_FILE); `pnpm local:dev` runs it by itself before it starts the processes.
 * Idempotent; `--dry-run` only counts. Prints counts only, never a key, a wrap or a space id.
 *   node scripts/kms-rewrap.ts [--dry-run]
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  fileKeyManagement,
  KmsKeyFileError,
  type KeyManagement,
} from "../src/platform/adapters/kms/index.ts";
import { ConfigError, loadConfig } from "../src/platform/config/config.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import {
  KeyFileMismatchError,
  KMS_REWRAP_USAGE,
  kmsRewrapReport,
  parseKmsRewrapArgs,
  runKmsRewrap,
  type KmsRewrapCommand,
} from "./lib/kms-rewrap.ts";

const modules = topologicalOrder(
  JSON.parse(readFileSync(new URL("../module-rules.json", import.meta.url), "utf8")) as ModuleRules,
);

let command: KmsRewrapCommand;
try {
  command = parseKmsRewrapArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${KMS_REWRAP_USAGE}`);
  process.exit(2);
}

let databases: ModuleDatabases;
let kms: KeyManagement;
let madeKeyFile: string | undefined;
try {
  const config = loadConfig(process.env, "worker", modules);
  if (config.kms.keyFile === undefined) {
    console.error("WS_KMS_KEY_FILE (the installation's key file) is not set: there is no key to re-wrap to");
    process.exit(2);
  }
  if (!existsSync(config.kms.keyFile)) madeKeyFile = config.kms.keyFile;
  kms = fileKeyManagement({ file: config.kms.keyFile });
  const { database } = config;
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
  console.error(
    error instanceof ConfigError || error instanceof KmsKeyFileError ? error.message : "Configuration error",
  );
  process.exit(1);
}

try {
  const result = await runKmsRewrap(databases, kms, command);
  console.log(kmsRewrapReport(command, result));
  console.log(JSON.stringify({ dryRun: command.dryRun, ...result }));
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  if (error instanceof KeyFileMismatchError) {
    // A key file this run just made opens nothing here: removed, so the next start does not take it for the real one.
    if (madeKeyFile !== undefined) rmSync(madeKeyFile, { force: true });
    console.error(error.message);
  } else {
    // Nothing from the error: database errors may hold connection details.
    console.error("The re-wrap failed; nothing after the last moved key changed. Run it again.");
  }
  process.exitCode = 1;
} finally {
  await databases.end();
}
