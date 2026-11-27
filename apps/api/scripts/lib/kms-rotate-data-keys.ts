import { accountsResealPart } from "../../src/modules/accounts/index.ts";
import { createAuditLog } from "../../src/modules/audit/index.ts";
import { fileStorageResealPart } from "../../src/modules/file-storage/index.ts";
import {
  createSpaceKeys,
  type DataKeyAbortResult,
  type DataKeyRotationResult,
} from "../../src/modules/household/index.ts";
import { importRecipesResealPart } from "../../src/modules/import-recipes/index.ts";
import { importSessionsResealPart } from "../../src/modules/import-sessions/index.ts";
import {
  fixedLabelSource,
  isFixedLabelVersion,
  type KeyManagement,
} from "../../src/platform/adapters/kms/index.ts";
import type { ObjectStorage } from "../../src/platform/adapters/object-storage/index.ts";
import type { ModuleDatabases } from "../../src/platform/db/module-db.ts";
import { RESEAL_BATCH_SIZE, type ResealPart } from "../../src/platform/modules/reseal.ts";
import { KeyFileMismatchError } from "./kms-rewrap.ts";

/**
 * The one-time replacement of data keys made under the fixed-label test key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; the
 * security review of #726): every space whose data key may have been wrapped by that key gets a new data key wrapped
 * by the installation's key file, and every sealed value of the space (account numbers, the account binding of import
 * templates and their versions, parsed statements, stored files) is sealed again with it, in batches; then the old key
 * is retired. Resumable and idempotent; a dry run only counts. The report holds counts only — never a key, a wrap, a
 * value or a space id. Run with the app stopped (`pnpm local:dev --rotate-data-keys` does: it holds the cluster lock
 * and starts no process).
 */
export const KMS_ROTATE_USAGE =
  "usage: node scripts/kms-rotate-data-keys.ts [--dry-run | --abort] [--batch-size <1-1000>]";

/** After a replacement only copies made from now on are safe: the owner is told every time keys were replaced. */
export const ROTATED_COPIES_WARNING =
  "Copies of the database made BEFORE this run (every earlier `pnpm local:backup` file and any other copy) still " +
  "hold the old data keys, which the fixed-label test key in the repository opens: delete those copies everywhere " +
  "they are kept, then make a new one (`pnpm local:backup`)";

export interface KmsRotateCommand {
  readonly dryRun: boolean;
  /** Undo every unfinished replacement instead (the values back under the old key, the new key discarded). */
  readonly abort?: true;
  readonly batchSize: number;
}

export function parseKmsRotateArgs(argv: readonly string[]): KmsRotateCommand {
  const rest = argv.filter((a) => a !== "--");
  let dryRun = false;
  let abort = false;
  let batchSize = RESEAL_BATCH_SIZE;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--abort") abort = true;
    else if (arg === "--batch-size") {
      const value = rest[++i] ?? "";
      if (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > 1000)
        throw new Error("--batch-size takes a number 1–1000");
      batchSize = Number(value);
    } else throw new Error(`unknown argument ${arg.slice(0, 40)}`);
  }
  if (abort && dryRun) throw new Error("--abort and --dry-run do not go together");
  return abort ? { dryRun, abort: true, batchSize } : { dryRun, batchSize };
}

/** Every module that keeps sealed values of a space, each through its own database role. */
export function resealParts(databases: ModuleDatabases, objects: ObjectStorage | undefined): ResealPart[] {
  return [
    accountsResealPart(databases.for("accounts")),
    importRecipesResealPart(databases.for("import-recipes")),
    importSessionsResealPart(databases.for("import-sessions")),
    fileStorageResealPart(databases.for("file-storage"), objects),
  ];
}

/**
 * Runs the replacement through the household module (the keys, the space's log) and the modules' parts. Stops first,
 * changing nothing, when the key file does not open this database's keys (`KeyFileMismatchError`, as the re-wrap).
 */
export async function runKmsRotateDataKeys(
  databases: ModuleDatabases,
  installationKms: KeyManagement,
  parts: readonly ResealPart[],
  command: KmsRotateCommand,
): Promise<DataKeyRotationResult | DataKeyAbortResult> {
  const keys = createSpaceKeys(
    databases.for("household"),
    createAuditLog(databases.for("audit")),
    installationKms,
  );
  const source = { kms: fixedLabelSource(), owns: isFixedLabelVersion };
  const unopenable = await keys.unopenable(source);
  if (unopenable > 0) throw new KeyFileMismatchError(unopenable);
  if (command.abort) return keys.abortDataKeyRotations({ source, parts, batchSize: command.batchSize });
  return keys.rotateDataKeys({ source, parts, dryRun: command.dryRun, batchSize: command.batchSize });
}

/** Module names and counts of the values that open with neither key — never which values or spaces. */
function unopenableNote(result: DataKeyRotationResult): string {
  const byPart = Object.entries(result.unopenable ?? {});
  if (byPart.length === 0) return "";
  const total = byPart.reduce((sum, [, n]) => sum + n, 0);
  return (
    `; ${total} sealed value(s) open with neither key (${byPart.map(([part, n]) => `${part}: ${n}`).join(", ")}): ` +
    "the spaces that hold them were not started — they keep their old key and work as before; tell the lead the " +
    "module(s) and count(s)"
  );
}

/** One line of counts. */
export function kmsRotateReport(
  command: KmsRotateCommand,
  result: DataKeyRotationResult | DataKeyAbortResult,
): string {
  if ("aborted" in result)
    return (
      `Undid the unfinished replacement of ${result.aborted} of ${result.found} space(s): ${result.values} sealed ` +
      "value(s) sealed back with the old keys, the new keys discarded; the old keys stay (run without --abort to " +
      "replace them again)" +
      (result.unopenable > 0
        ? `; ${result.unopenable} sealed value(s) open with neither key and were left as they are`
        : "") +
      (result.failed > 0 ? `; ${result.failed} space(s) not undone: run this again` : "")
    );
  if (command.dryRun)
    return (
      `Dry run: ${result.found} space(s) to get a new data key, ${result.values} sealed value(s) to seal again; ` +
      "nothing changed" +
      (result.failed > 0 ? `; ${result.failed} space(s) could not be read` : "") +
      unopenableNote(result)
    );
  return (
    `Replaced the data keys of ${result.rotated} of ${result.found} space(s); ${result.values} sealed value(s) ` +
    "sealed again with the new keys" +
    (result.failed > 0
      ? `; ${result.failed} space(s) not finished` +
        (result.unopenable
          ? ""
          : ": their values cannot be opened until you run this again (or undo it with --abort)")
      : "") +
    unopenableNote(result) +
    (result.rotated > 0 ? `. ${ROTATED_COPIES_WARNING}` : "")
  );
}
