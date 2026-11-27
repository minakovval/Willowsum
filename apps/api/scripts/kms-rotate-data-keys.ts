/**
 * The one-time replacement of the data keys of spaces made under the fixed-label test key (NFR-01@PoC FR 3,
 * NFR-15@PoC FR 26; the security review of #726): see lib/kms-rotate-data-keys.ts. Uses the same configuration as the
 * processes (WS_DB_*, the module passwords, the file storage, WS_REAL_DATA=true and WS_KMS_KEY_FILE) and refuses to
 * run without the real-data mark or the key file. Run it with the app stopped: `pnpm local:dev --rotate-data-keys
 * [--dry-run | --abort]` prepares the database, runs it and starts no process. Resumable and idempotent; prints counts
 * only. `--abort` undoes an unfinished replacement (the values back under the old key; the old key stays).
 *   node scripts/kms-rotate-data-keys.ts [--dry-run | --abort] [--batch-size <1-1000>]
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  fileKeyManagement,
  KmsKeyFileError,
  type KeyManagement,
} from "../src/platform/adapters/kms/index.ts";
import {
  directoryObjectStorage,
  s3ObjectStorage,
  type ObjectStorage,
} from "../src/platform/adapters/object-storage/index.ts";
import { ConfigError, loadConfig } from "../src/platform/config/config.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { KeyFileMismatchError } from "./lib/kms-rewrap.ts";
import {
  KMS_ROTATE_BUSY,
  KMS_ROTATE_LOCK,
  KMS_ROTATE_USAGE,
  kmsRotateReport,
  parseKmsRotateArgs,
  resealParts,
  runKmsRotateDataKeys,
  type KmsRotateCommand,
} from "./lib/kms-rotate-data-keys.ts";

const modules = topologicalOrder(
  JSON.parse(readFileSync(new URL("../module-rules.json", import.meta.url), "utf8")) as ModuleRules,
);

let command: KmsRotateCommand;
try {
  command = parseKmsRotateArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${KMS_ROTATE_USAGE}`);
  process.exit(2);
}

let databases: ModuleDatabases;
let kms: KeyManagement;
let objects: ObjectStorage | undefined;
let lock: pg.Client;
try {
  const config = loadConfig(process.env, "worker", modules);
  if (!config.kms.realData || config.kms.keyFile === undefined) {
    console.error(
      "The data-key rotation runs only on an instance with real data and its key file (WS_REAL_DATA=true, " +
        "WS_KMS_KEY_FILE): run `pnpm local:dev --rotate-data-keys`",
    );
    process.exit(2);
  }
  // Never makes a key file: a missing one is lost, not new (the re-wrap before it makes the first one).
  kms = fileKeyManagement({ file: config.kms.keyFile, create: false });
  const s3 = config.files.s3;
  objects = s3
    ? s3ObjectStorage(s3)
    : config.files.dir
      ? directoryObjectStorage(config.files.dir)
      : undefined;
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
  lock = new pg.Client({
    ...connection,
    user: moduleRoleName("household"),
    password: database.modulePasswords.get("household") ?? "",
  });
} catch (error) {
  console.error(
    error instanceof ConfigError || error instanceof KmsKeyFileError ? error.message : "Configuration error",
  );
  process.exit(1);
}

try {
  await lock.connect();
  const { rows } = await lock.query<{ held: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS held", [
    KMS_ROTATE_LOCK,
  ]);
  if (rows[0]?.held !== true) {
    console.error(KMS_ROTATE_BUSY);
    process.exitCode = 2;
  } else {
    const result = await runKmsRotateDataKeys(databases, kms, resealParts(databases, objects), command);
    console.log(kmsRotateReport(command, result));
    console.log(
      JSON.stringify({ dryRun: command.dryRun, ...(command.abort ? { abort: true } : {}), ...result }),
    );
    if (result.failed > 0) process.exitCode = 1;
  }
} catch (error) {
  // Nothing from any other error: database errors may hold connection details or values.
  console.error(
    error instanceof KeyFileMismatchError
      ? error.message
      : "The data-key rotation stopped; what is done is kept. Run it again to carry on.",
  );
  process.exitCode = 1;
} finally {
  await databases.end();
  await lock.end().catch(() => undefined);
}
