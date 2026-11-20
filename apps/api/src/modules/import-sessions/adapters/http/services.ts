import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
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

/** What the API process wires for the import-sessions routes (src/api.ts → `ctx.services`). */
export interface ImportSessionsServices {
  readonly [BRAND]: true;
  readonly deps: BatchesDeps;
  readonly originals: BatchOriginals;
  readonly audit: BatchesAudit;
}

export function createImportSessionsServices(options: {
  readonly files: Pick<FileStorage, "store" | "remove" | "link" | "open">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): ImportSessionsServices {
  return {
    [BRAND]: true,
    deps: { newId: options.newId, now: () => new Date(options.clock.now()) },
    originals: fileOriginals(options.files),
    audit: batchesAudit(options.audit),
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
