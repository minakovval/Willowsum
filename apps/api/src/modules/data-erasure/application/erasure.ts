import { erasureDueAt, requestStates, type ErasureRecord, type RequestState } from "../domain/index.ts";

/**
 * Erasure on the person's request (NFR-12@PoC FR 3, NFR-16@PoC FR 9; ADR-0013 option A). The product owner accepts a
 * request (`request`), which is recorded in the erasure log outside the main database with its 30-day deadline, then
 * runs it (`run`). A run ends the account first (its sessions go with it, so nothing new is written), then erases each
 * of its spaces — journal, the space's log, and last the space's key with its record — and records the completion in
 * the log. `reapply` runs every completed request again after a restore from a copy. Every step is idempotent.
 */

/** The ports a run uses; each is a module's public erasure interface (adapters wired in ../index.ts). */
export interface ErasureDeps {
  readonly log: {
    append(record: ErasureRecord): Promise<void>;
    records(): Promise<readonly ErasureRecord[]>;
  };
  readonly identity: {
    accountIdByEmail(email: string): Promise<string | null>;
    eraseAccount(accountId: string): Promise<boolean>;
  };
  readonly spaces: {
    spacesOf(accountId: string): Promise<readonly { householdId: string; members: number }[]>;
    eraseSpace(householdId: string): Promise<{ keyDestroyed: boolean }>;
  };
  readonly ledger: { eraseHousehold(householdId: string): Promise<unknown> };
  readonly audit: { eraseHousehold(householdId: string): Promise<unknown> };
  /** The platform log: the request and its completion (ids only). */
  readonly platformAudit: {
    requestRecorded(requestId: string, dueAt: string): Promise<void>;
    requestCompleted(requestId: string, kind: "run" | "reapply"): Promise<void>;
    /** A step that deletes rows of a space, recorded before it runs (ids only). */
    spaceStep(
      householdId: string,
      step: "ledger.journal" | "audit.log",
      reason?: "erasure-request" | "erasure-sweep",
    ): Promise<void>;
  };
  readonly newId: () => string;
  readonly now: () => number;
}

export class ErasureError extends Error {
  readonly code: "ACCOUNT_NOT_FOUND" | "SPACE_SHARED" | "REQUEST_NOT_FOUND";
  constructor(code: ErasureError["code"]) {
    super(`Erasure: ${code}`);
    this.name = "ErasureError";
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Records a request for the account (by id or address). A space shared with another member is not erased with one
 * person's account (never the case in PoC: one person per space) — refused, nothing recorded. A pending request for
 * the same account is returned instead of a second one.
 */
export async function requestErasure(
  deps: ErasureDeps,
  subject: { readonly accountId: string } | { readonly email: string },
): Promise<RequestState> {
  const accountId =
    "accountId" in subject
      ? UUID_RE.test(subject.accountId)
        ? subject.accountId
        : null
      : await deps.identity.accountIdByEmail(subject.email);
  if (!accountId) throw new ErasureError("ACCOUNT_NOT_FOUND");
  const now = deps.now();
  const open = requestStates(await deps.log.records(), now).find(
    (r) => r.accountId === accountId && r.state === "pending",
  );
  if (open) return open;
  const spaces = await deps.spaces.spacesOf(accountId);
  if (spaces.some((s) => s.members > 1)) throw new ErasureError("SPACE_SHARED");
  const record: ErasureRecord = {
    kind: "requested",
    requestId: deps.newId(),
    accountId,
    householdIds: spaces.map((s) => s.householdId),
    at: new Date(now).toISOString(),
    dueAt: new Date(erasureDueAt(now)).toISOString(),
  };
  await deps.log.append(record);
  await deps.platformAudit.requestRecorded(record.requestId, record.dueAt);
  return requestStates([record], now)[0]!;
}

async function eraseTargets(deps: ErasureDeps, request: RequestState): Promise<void> {
  // The account first: its sessions end with it, so the person writes nothing into a space being erased.
  await deps.identity.eraseAccount(request.accountId);
  for (const householdId of request.householdIds) {
    // Each deletion is recorded in the platform log first: a run that stops part-way still shows what went.
    await deps.platformAudit.spaceStep(householdId, "ledger.journal");
    await deps.ledger.eraseHousehold(householdId);
    await deps.platformAudit.spaceStep(householdId, "audit.log");
    await deps.audit.eraseHousehold(householdId);
    // Last: the key, with the space's record, in one locked transaction.
    await deps.spaces.eraseSpace(householdId);
    // The daily key task may have written into the space's log between the two steps above (a rewrap or a
    // provisioning records itself there). With the record gone nothing new arrives; sweep what did.
    await deps.platformAudit.spaceStep(householdId, "audit.log", "erasure-sweep");
    await deps.audit.eraseHousehold(householdId);
  }
}

/** Runs a recorded request; the completion goes to the log only once everything is erased. */
export async function runErasure(deps: ErasureDeps, requestId: string): Promise<RequestState> {
  const request = requestStates(await deps.log.records(), deps.now()).find((r) => r.requestId === requestId);
  if (!request) throw new ErasureError("REQUEST_NOT_FOUND");
  // A space the account got after the request (a first sign-in within the 30 days) is erased too, and recorded so
  // that a re-application after a restore erases it as well.
  const current = await deps.spaces.spacesOf(request.accountId);
  if (current.some((s) => s.members > 1)) throw new ErasureError("SPACE_SHARED");
  const householdIds = [...new Set([...request.householdIds, ...current.map((s) => s.householdId)])];
  await eraseTargets(deps, { ...request, householdIds });
  const record: ErasureRecord = {
    kind: "completed",
    requestId,
    accountId: request.accountId,
    householdIds,
    at: new Date(deps.now()).toISOString(),
  };
  await deps.log.append(record);
  await deps.platformAudit.requestCompleted(requestId, "run");
  return requestStates([...(await deps.log.records())], deps.now()).find((r) => r.requestId === requestId)!;
}

/**
 * NFR-16 FR 9: after a restore from a copy, every completed erasure is applied again (the copy may predate it).
 * Pending requests stay pending: they still need the owner's run. Returns the number of requests applied again.
 */
export async function reapplyErasures(deps: ErasureDeps): Promise<number> {
  let applied = 0;
  for (const request of requestStates(await deps.log.records(), deps.now())) {
    if (request.state !== "completed") continue;
    await eraseTargets(deps, request);
    await deps.platformAudit.requestCompleted(request.requestId, "reapply");
    applied += 1;
  }
  return applied;
}

/** Every request with its state and deadline (the 30-day tracking of NFR-12 FR 3). */
export async function erasureStatus(deps: Pick<ErasureDeps, "log" | "now">): Promise<RequestState[]> {
  return requestStates(await deps.log.records(), deps.now());
}
