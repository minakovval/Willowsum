// Public interface of the data-erasure module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ErasureLog } from "../../platform/adapters/erasure-log/index.ts";
import type { ModuleDatabases } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { createAuditErasure, createAuditLog } from "../audit/index.ts";
import { createSpaceErasure } from "../household/index.ts";
import { createIdentityErasure } from "../identity/index.ts";
import { createLedgerErasure } from "../ledger/index.ts";
import {
  erasureStatus,
  reapplyErasures,
  requestErasure,
  runErasure,
  type ErasureDeps,
} from "./application/index.ts";
import type { RequestState } from "./domain/index.ts";

export const dataErasureModule = defineModule({
  name: "data-erasure",
  publishes: [],
  consumes: [],
});

export { ErasureError } from "./application/index.ts";
export { ERASURE_DEADLINE_DAYS } from "./domain/index.ts";
export type { RequestState } from "./domain/index.ts";

/** Erasure on the person's request (NFR-12@PoC FR 3, NFR-16@PoC FR 9; ADR-0013): the owner's erasure script only. */
export interface DataErasure {
  /** Records a request for an account (by id or address) with its 30-day deadline. */
  request(subject: { readonly accountId: string } | { readonly email: string }): Promise<RequestState>;
  /** Erases everything of a recorded request; idempotent. */
  run(requestId: string): Promise<RequestState>;
  /** After a restore: applies every completed erasure again; returns how many. */
  reapply(): Promise<number>;
  /** Every request with its state, deadline and days left. */
  status(): Promise<RequestState[]>;
}

export interface DataErasureOptions {
  /** The module pools (identity, household, audit — the platform log). */
  readonly databases: Pick<ModuleDatabases, "for">;
  /** The erasure pools of audit and ledger (`withErasureDatabases`, platform/db/erasure-db.ts). */
  readonly erasureDatabases: Pick<ModuleDatabases, "for">;
  /** The erasure log outside the main database (`erasureLog`, platform/adapters/erasure-log). */
  readonly log: ErasureLog;
  readonly now?: () => number;
}

export function createDataErasure(options: DataErasureOptions): DataErasure {
  const audit = createAuditLog(options.databases.for("audit"));
  const platformEntry = (requestId: string, field: string, after: string) =>
    audit.recordPlatform({
      actor: { kind: "system" },
      channel: "system",
      entity: { type: "data-erasure.request", id: requestId },
      action: field === "dueAt" ? "create" : "update",
      changes: [{ field, before: null, after, sensitive: false }],
    });
  const deps: ErasureDeps = {
    log: options.log,
    identity: createIdentityErasure({ db: options.databases.for("identity"), audit }),
    spaces: createSpaceErasure(options.databases.for("household"), audit),
    ledger: createLedgerErasure(options.erasureDatabases.for("ledger")),
    audit: createAuditErasure(options.erasureDatabases.for("audit")),
    platformAudit: {
      requestRecorded: async (requestId, dueAt) => void (await platformEntry(requestId, "dueAt", dueAt)),
      requestCompleted: async (requestId, kind) =>
        void (await platformEntry(requestId, "state", kind === "run" ? "completed" : "reapplied")),
    },
    newId: randomUUID,
    now: options.now ?? Date.now,
  };
  return {
    request: (subject) => requestErasure(deps, subject),
    run: (requestId) => runErasure(deps, requestId),
    reapply: () => reapplyErasures(deps),
    status: () => erasureStatus(deps),
  };
}
