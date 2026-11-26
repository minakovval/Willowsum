import { createAuditLog } from "../../src/modules/audit/index.ts";
import { createSpaceKeys, type RewrapFromResult } from "../../src/modules/household/index.ts";
import {
  fixedLabelSource,
  isFixedLabelVersion,
  type KeyManagement,
} from "../../src/platform/adapters/kms/index.ts";
import type { ModuleDatabases } from "../../src/platform/db/module-db.ts";

/**
 * The one-time re-wrap off the fixed-label test key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; security review of #722):
 * every space key still wrapped by a `local-N` version (made before the installation had its own key file) is
 * unwrapped with the fixed-label key and wrapped by the installation's key (`WS_KMS_KEY_FILE`). Idempotent; a dry run
 * only counts. The report holds counts only — never a key, a wrap or a space id.
 */
export const KMS_REWRAP_USAGE = "usage: node scripts/kms-rewrap.ts [--dry-run]";

/**
 * The move changes the wrap, not the data key: a copy of the database made before it still holds the old wrap, which
 * the fixed-label key opens, and that data key keeps opening the space's values. The owner is told every time keys moved.
 */
export const OLD_COPIES_WARNING =
  "Copies of the database made BEFORE this move (earlier `pnpm local:backup` files and any other copy) are still " +
  "protected only by the fixed-label test key, and so are the values sealed later with the same space keys: delete " +
  "those copies everywhere they are kept, then make a new one (`pnpm local:backup`)";

/**
 * The key file does not open this database's keys (NFR-01@PoC FR 3): lost and made again, or another installation's.
 * Nothing is moved; the command stops so `pnpm local:dev` does not start on a key that opens nothing.
 */
export class KeyFileMismatchError extends Error {
  readonly unopenable: number;
  constructor(unopenable: number) {
    super(
      `${unopenable} space key(s) in this database do not open with the installation's key file: it is not the file ` +
        "this data was encrypted with (lost and made again, or another computer's). Nothing was changed. Put your " +
        "saved copy of the key file in its place (infra/local/README.md, «Master key»)",
    );
    this.name = "KeyFileMismatchError";
    this.unopenable = unopenable;
  }
}

export interface KmsRewrapCommand {
  readonly dryRun: boolean;
}

export function parseKmsRewrapArgs(argv: readonly string[]): KmsRewrapCommand {
  const rest = argv.filter((a) => a !== "--");
  const unknown = rest.find((a) => a !== "--dry-run");
  if (unknown !== undefined) throw new Error(`unknown argument ${unknown.slice(0, 40)}`);
  return { dryRun: rest.includes("--dry-run") };
}

/** Runs the re-wrap through the household module's own role and the audit log (each move is in the space's log). */
export async function runKmsRewrap(
  databases: ModuleDatabases,
  installationKms: KeyManagement,
  command: KmsRewrapCommand,
): Promise<RewrapFromResult> {
  const keys = createSpaceKeys(
    databases.for("household"),
    createAuditLog(databases.for("audit")),
    installationKms,
  );
  const source = { kms: fixedLabelSource(), owns: isFixedLabelVersion };
  const unopenable = await keys.unopenable(source);
  if (unopenable > 0) throw new KeyFileMismatchError(unopenable);
  return keys.rewrapFrom(source, { dryRun: command.dryRun });
}

/** One line of counts. */
export function kmsRewrapReport(command: KmsRewrapCommand, result: RewrapFromResult): string {
  return command.dryRun
    ? `Dry run: ${result.found} space key(s) still wrapped by the fixed-label test key; nothing changed` +
        (result.failed > 0 ? `; ${result.failed} space(s) could not be read` : "")
    : `Re-wrapped ${result.rewrapped} of ${result.found} space key(s) from the fixed-label test key to this ` +
        `installation's key` +
        (result.failed > 0 ? `; ${result.failed} failed (run again)` : "") +
        (result.rewrapped > 0 ? `. ${OLD_COPIES_WARNING}` : "");
}
