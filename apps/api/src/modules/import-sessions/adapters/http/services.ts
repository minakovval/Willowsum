import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AccountDirectory } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { PARSE_ENGINE_VERSION } from "../../../file-parsers/index.ts";
import type { SpaceKeys } from "../../../household/index.ts";
import type { ImportRecipesReader } from "../../../import-recipes/index.ts";
import type {
  ImportBatchTransactions,
  ImportCandidates,
  ImportedTransactions,
} from "../../../transactions/index.ts";
import {
  cleanFileName,
  FILE_LIMITS,
  FileNotFoundError,
  FileRejectedError,
  uploadBudget,
  type Download,
  type FileStorage,
  type UploadBudget,
} from "../../../file-storage/index.ts";
import {
  applyHandOff,
  BATCH_ENTITY,
  RejectedFile,
  type BatchesAudit,
  type BatchesDeps,
  type BatchHandOff,
  type Originals,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-import-sessions-services");

/** The originals of batches in file-storage (kind «виписка», FR 7), and their signed links (≤ 15 min). */
export interface BatchOriginals extends Originals {
  link(householdId: string, fileId: string): Promise<{ readonly token: string; readonly expiresAt: Date }>;
  open(householdId: string, token: string): Promise<Download>;
}

export function fileOriginals(
  files: Pick<FileStorage, "store" | "remove" | "link" | "open">,
): BatchOriginals {
  return {
    async store(request) {
      try {
        const file = await files.store({
          ...request,
          kind: "statement",
          budget: request.budget as UploadBudget,
        });
        return {
          id: file.id,
          format: file.format,
          sizeBytes: file.sizeBytes,
          fileName: file.fileName,
          sha256: file.sha256,
        };
      } catch (error) {
        if (error instanceof FileRejectedError) throw new RejectedFile(error.rejection);
        throw error;
      }
    },
    // One budget per upload request (file-storage): 25 MiB a file, the batch's room (≤ 150 MiB) for the request.
    budget: (declared, bytes) => uploadBudget(declared, { ...FILE_LIMITS, requestBytes: bytes }),
    cleanName: cleanFileName,
    async remove(householdId, fileId, actorId) {
      try {
        await files.remove(householdId, fileId, actorId);
      } catch (error) {
        if (!(error instanceof FileNotFoundError)) throw error;
      }
    },
    link: (householdId, fileId) => files.link(householdId, fileId),
    open: (householdId, token) => files.open(householdId, token),
  };
}

/** The batches' entries in the space's own log (FR 21, П-10): states, counts, formats, codes — no names or content. */
export function batchesAudit(audit: Pick<AuditLog, "record">): BatchesAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        // The daily cleanup (FR 20) is the system's entry.
        actor:
          handOff.actorAccountId === null ? { kind: "system" } : { kind: "user", id: handOff.actorAccountId },
        channel: handOff.actorAccountId === null ? "system" : "web",
        entity: { type: BATCH_ENTITY, id: handOff.entityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

/**
 * The parse step's routes: the space's recipes and accounts a request may name, and the space's key that opens the
 * stored parsed rows for the read route. Omitted: those routes answer 500.
 */
export interface ParseServices {
  readonly recipes: Pick<ImportRecipesReader, "forParse">;
  readonly accounts: Pick<AccountDirectory, "postingAccount">;
  readonly keys: Pick<SpaceKeys, "openBytes">;
}

/**
 * «Застосувати» (IMP-01 FR 11): module transactions' write of the batch's rows; the parse services open the sealed
 * rows. Omitted: the route answers 500.
 */
export interface ApplyServices {
  readonly transactions: ImportedTransactions;
}

/**
 * IMP-04 before the apply (IMP-08 FR 6): module transactions' `ImportCandidates`, read as the apply's plan reads them.
 * Omitted: the duplicate preview answers 500.
 */
export interface PreviewServices {
  readonly candidates: ImportCandidates;
}

/**
 * The step «Результат» (IMP-08 FR 11, AC7): module transactions' `ImportBatchTransactions`, module categorization's
 * `TransactionCategories` and module transfer-matching's `ImportBatchProposals` (wired in main.ts). Omitted: the result
 * route answers 500.
 */
export interface ResultServices {
  readonly transactions: ImportBatchTransactions;
  readonly categories: {
    categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  };
  readonly proposals: {
    countFor(
      householdId: string,
      batchId: string,
    ): Promise<{ readonly count: number; readonly more: boolean }>;
  };
}

/** What the API process wires for the import-sessions routes (src/api.ts → `ctx.services`). */
export interface ImportSessionsServices {
  readonly [BRAND]: true;
  readonly deps: BatchesDeps & { readonly engineVersion: string };
  readonly originals: BatchOriginals;
  readonly audit: BatchesAudit;
  readonly parse?: ParseServices;
  readonly apply?: ApplyServices;
  readonly preview?: PreviewServices;
  readonly result?: ResultServices;
}

export function createImportSessionsServices(options: {
  readonly files: Pick<FileStorage, "store" | "remove" | "link" | "open">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
  readonly parse?: ParseServices;
  readonly apply?: ApplyServices;
  readonly preview?: PreviewServices;
  readonly result?: ResultServices;
}): ImportSessionsServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      now: () => new Date(options.clock.now()),
      engineVersion: PARSE_ENGINE_VERSION,
    },
    originals: fileOriginals(options.files),
    audit: batchesAudit(options.audit),
    ...(options.parse ? { parse: options.parse } : {}),
    ...(options.apply ? { apply: options.apply } : {}),
    ...(options.preview ? { preview: options.preview } : {}),
    ...(options.result ? { result: options.result } : {}),
  };
}

/** The services of an import-sessions route; without them (never in the API process) the route answers 500. */
export function importSessionsServices(ctx: ProtectedContext): ImportSessionsServices {
  const services = ctx.services as Partial<ImportSessionsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as ImportSessionsServices;
}

/**
 * ARC-04 FR 2: the audit entries of committed changes, right away. A failure is no failure of the request: the jobs are
 * in the queue, so the worker writes the entries (WARN `import_sessions.hand_off_deferred`, class only).
 */
export async function handOffNow(
  audit: BatchesAudit,
  householdId: string,
  handOffs: readonly BatchHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("import_sessions.hand_off_deferred", "warn", {
      "ws.module": "import-sessions",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
