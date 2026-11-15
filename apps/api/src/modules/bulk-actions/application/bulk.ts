import type { AuditLog } from "../../audit/index.ts";
import {
  BULK_ITEMS_MAX,
  decideTurn,
  distinctIds,
  runsInBackground,
  skipExamples,
  summarize,
  undoRemainingMs,
  type BulkValues,
  type SkipReason,
} from "../domain/index.ts";
import type {
  BulkActionHandler,
  BulkCaller,
  BulkJobs,
  BulkRegistry,
  BulkStore,
  BulkTarget,
  StoredAction,
  StoredItem,
} from "./ports.ts";

/**
 * Bulk actions (DAT-03@PoC FR 1, FR 3–11; wave 2 row 17 — the server part). One mechanism for every entity: an
 * action's handler plans each record, the entity's target (the owning module's public interface) reads and writes it
 * with the rules of a single edit (FR 5). The order of a run (ARC-04, as the transactions hand-off, ADR-0015): the
 * action and its records are stored with the job of its first part in one bulk-actions transaction; then each part is
 * one transaction of this module with its action row locked — the records written through the target, their outcomes
 * stored, and the next part's job or, at the end, the group audit entry's job (FR 11) enqueued before the commit.
 */

export interface BulkDeps {
  readonly registry: BulkRegistry;
  readonly clock: { now(): number };
  readonly newId: () => string;
  /** Records per part of a background run (the progress «Оброблено X з N» moves once per part). */
  readonly partSize: number;
}

export type BulkSelection =
  | { readonly kind: "ids"; readonly ids: readonly string[] }
  | { readonly kind: "filter"; readonly filter: readonly string[]; readonly excluded: readonly string[] };

export interface BulkRequest {
  readonly action: string;
  readonly selection: BulkSelection;
  readonly params: unknown;
}

export type BulkErrorCode =
  | "UNKNOWN_ACTION"
  | "INVALID_PARAMS"
  | "INVALID_FILTER"
  | "LIMIT"
  | "NOT_FOUND"
  | "RUNNING"
  | "UNDO_UNAVAILABLE"
  | "NOT_RESUMABLE";

export class BulkError extends Error {
  readonly code: BulkErrorCode;
  constructor(code: BulkErrorCode) {
    super(`Bulk action: ${code}`);
    this.code = code;
    this.name = "BulkError";
  }
}

interface Resolved {
  readonly handler: BulkActionHandler;
  readonly target: BulkTarget;
  readonly params: unknown;
  readonly items: StoredItem[];
}

const pick = (values: BulkValues, fields: readonly string[]): BulkValues =>
  Object.fromEntries(fields.map((f) => [f, values[f] ?? null]));

/**
 * FR 1, FR 3, FR 4, FR 7: the selection resolved to records and each record planned, nothing written. More than 500
 * records — `LIMIT` before any record is read (AC10); none of them visible — `NOT_FOUND` (AC11: another space's records
 * are reported as nothing at all, the same as records that do not exist).
 */
async function resolve(deps: BulkDeps, caller: BulkCaller, request: BulkRequest): Promise<Resolved> {
  const handler = deps.registry.actions.get(request.action);
  if (!handler) throw new BulkError("UNKNOWN_ACTION");
  const target = deps.registry.targets.get(handler.entity);
  if (!target) throw new BulkError("UNKNOWN_ACTION");
  const parsed = handler.params.safeParse(request.params);
  if (!parsed.success) throw new BulkError("INVALID_PARAMS");
  let ids: readonly string[];
  if (request.selection.kind === "ids") {
    ids = distinctIds(request.selection.ids);
    if (ids.length > BULK_ITEMS_MAX) throw new BulkError("LIMIT");
  } else {
    const selected = await target.select(
      caller,
      request.selection.filter,
      distinctIds(request.selection.excluded),
      BULK_ITEMS_MAX,
    );
    if ("invalid" in selected) throw new BulkError("INVALID_FILTER");
    if (selected.count > BULK_ITEMS_MAX) throw new BulkError("LIMIT");
    ids = selected.ids;
  }
  const visible = ids.length > 0 ? await target.read(caller, ids) : new Map();
  if (visible.size === 0) throw new BulkError("NOT_FOUND");
  const plans = await handler.plan(caller, [...visible.values()], parsed.data);
  const items = ids.map((recordId, i): StoredItem => {
    const base = {
      position: i + 1,
      recordId,
      versionBefore: null,
      before: null,
      after: null,
      issue: null,
      versionAfter: null,
      run: null,
      undo: null,
    };
    const record = visible.get(recordId);
    if (!record) return { ...base, outcome: "unavailable" };
    const plan = plans.get(recordId) ?? { kind: "invalid", issue: "invalid" };
    if (plan.kind === "unchanged") return { ...base, outcome: "unchanged" };
    if (plan.kind === "invalid") return { ...base, outcome: "invalid", issue: plan.issue };
    return {
      ...base,
      outcome: "pending",
      versionBefore: record.version,
      before: pick(record.values, Object.keys(plan.after)),
      after: plan.after,
    };
  });
  return { handler, target, params: parsed.data, items };
}

export interface BulkPreview {
  readonly action: string;
  readonly count: number;
  readonly changes: number;
  readonly skipped: Readonly<Record<SkipReason, number>>;
  readonly examples: ReturnType<typeof skipExamples>;
  readonly background: boolean;
  readonly undoable: true;
}

/** FR 3, AC1: «Зміниться N, пропущено M: …» with examples, whether it runs in the background; nothing is written. */
export async function previewAction(
  deps: BulkDeps,
  caller: BulkCaller,
  request: BulkRequest,
): Promise<BulkPreview> {
  const { items } = await resolve(deps, caller, request);
  const summary = summarize(items);
  return {
    action: request.action,
    count: summary.count,
    changes: summary.pending,
    skipped: summary.skipped,
    examples: skipExamples(items),
    background: runsInBackground(summary.count),
    undoable: true,
  };
}

/**
 * FR 6, FR 7, AC2, AC7, AC10: stores the action with its records and the job of its first part, in the caller's
 * bulk-actions transaction. A caller with an action still running is refused (`RUNNING`, «Інша масова дія ще
 * виконується»). Returns the action; a foreground one (50 records or fewer) is then run at once by the route
 * (`runPart` in a new transaction, after this one committed) — its job is the fallback if that fails.
 */
export async function startAction(
  deps: BulkDeps,
  store: BulkStore,
  jobs: BulkJobs,
  caller: BulkCaller,
  request: BulkRequest,
): Promise<StoredAction> {
  const resolved = await resolve(deps, caller, request);
  if (await store.hasRunning(caller.actorId)) throw new BulkError("RUNNING");
  const action: StoredAction = {
    id: deps.newId(),
    actorId: caller.actorId,
    action: resolved.handler.name,
    entity: resolved.handler.entity,
    params: resolved.params,
    background: runsInBackground(resolved.items.length),
    status: "running",
    run: 1,
    count: resolved.items.length,
    createdAt: deps.clock.now(),
    endedAt: null,
    undoneAt: null,
  };
  if (!(await store.insertAction(action, resolved.items))) throw new BulkError("RUNNING");
  await jobs.runPart(action.id, 1, 1);
  return action;
}

/** The caller's own action; anyone else's (another account, another space) is `NOT_FOUND`. */
async function own(store: BulkStore, caller: BulkCaller, actionId: string, lock: boolean) {
  const action = lock ? await store.lock(actionId) : await store.find(actionId);
  if (!action || action.actorId !== caller.actorId) throw new BulkError("NOT_FOUND");
  return action;
}

function targetOf(deps: BulkDeps, action: StoredAction): BulkTarget {
  const target = deps.registry.targets.get(action.entity);
  if (!target) throw new Error(`Bulk action ${action.id}: no target for ${action.entity}`);
  return target;
}

/**
 * FR 5, FR 6, FR 10, AC6, AC8: one part of a run, in a bulk-actions transaction with the action locked (the job's,
 * or the route's right after the start). A job taken again after a failure or a restart (`attempt` above 1) does
 * not go on: the action becomes «interrupted» with the part done kept, and «Продовжити» runs the rest (AC8). A stale
 * job (of an earlier run, or of an action no longer running) does nothing.
 */
export async function runPart(
  deps: BulkDeps,
  store: BulkStore,
  jobs: BulkJobs,
  householdId: string,
  job: { readonly actionId: string; readonly run: number; readonly part: number; readonly attempt: number },
  limit: number = deps.partSize,
): Promise<void> {
  const action = await store.lock(job.actionId);
  if (!action || action.status !== "running" || action.run !== job.run) return;
  if (job.attempt > 1) {
    // EC2, FR 11, FR 9: a record the failed try already wrote (its outcome rolled back with the part) is «changed» now,
    // so the run's group entry lists it and «Відмінити» restores it, even when nobody presses «Продовжити».
    const pending = await store.pending(action.id, Number.POSITIVE_INFINITY);
    if (pending.length > 0) {
      const caller: BulkCaller = { householdId, actorId: action.actorId, scoped: false };
      const current = await targetOf(deps, action).read(
        caller,
        pending.map((i) => i.recordId),
      );
      for (const item of pending) {
        const turn = decideTurn(
          { versionBefore: item.versionBefore ?? 0, after: item.after ?? {} },
          current.get(item.recordId),
        );
        if (turn.kind === "already")
          await store.setOutcome(action.id, item.position, "changed", {
            versionAfter: turn.version,
            run: action.run,
          });
      }
    }
    await store.setStatus(action.id, "interrupted", { endedAt: deps.clock.now() });
    await jobs.audit(action.id, "run", action.run);
    return;
  }
  const caller: BulkCaller = { householdId, actorId: action.actorId, scoped: false };
  const target = targetOf(deps, action);
  const pending = await store.pending(action.id, limit);
  if (pending.length > 0) {
    const current = await target.read(
      caller,
      pending.map((i) => i.recordId),
    );
    for (const item of pending) {
      const turn = decideTurn(
        { versionBefore: item.versionBefore ?? 0, after: item.after ?? {} },
        current.get(item.recordId),
      );
      if (turn.kind === "skip") {
        await store.setOutcome(action.id, item.position, turn.reason, {});
        continue;
      }
      if (turn.kind === "already") {
        await store.setOutcome(action.id, item.position, "changed", {
          versionAfter: turn.version,
          run: action.run,
        });
        continue;
      }
      const written = await target.write(caller, item.recordId, item.versionBefore ?? 0, item.after ?? {});
      if (written.kind === "changed")
        await store.setOutcome(action.id, item.position, "changed", {
          versionAfter: written.version,
          run: action.run,
        });
      else
        await store.setOutcome(action.id, item.position, written.kind, {
          issue: written.kind === "invalid" ? written.issue : null,
        });
    }
  }
  if (pending.length === limit) {
    await jobs.runPart(action.id, action.run, job.part + 1);
    return;
  }
  await store.setStatus(action.id, "completed", { endedAt: deps.clock.now() });
  await jobs.audit(action.id, "run", action.run);
}

/**
 * FR 8, FR 9, AC3, AC4: «Відмінити» — within 24 hours of the end, once. Marks the action «undone» and enqueues the
 * undo's job in the caller's transaction; the route then runs it at once (`runUndo`), the job is the fallback.
 */
export async function requestUndo(
  deps: BulkDeps,
  store: BulkStore,
  jobs: BulkJobs,
  caller: BulkCaller,
  actionId: string,
): Promise<StoredAction> {
  const action = await own(store, caller, actionId, true);
  const now = deps.clock.now();
  if (undoRemainingMs(action, now) === 0) throw new BulkError("UNDO_UNAVAILABLE");
  await store.setStatus(action.id, "undone", { undoneAt: now, endedAt: action.endedAt });
  await jobs.undo(action.id);
  return { ...action, status: "undone", undoneAt: now };
}

/**
 * FR 9, AC3: the previous values back on every changed record that nobody changed after the action (its version is
 * still the action's); the others stay as they are and count as «не відновлено». Idempotent: a record restored by an
 * earlier try that stopped before its outcome was stored is recognised by its values and counted restored.
 */
export async function runUndo(
  deps: BulkDeps,
  store: BulkStore,
  jobs: BulkJobs,
  householdId: string,
  actionId: string,
): Promise<void> {
  const action = await store.lock(actionId);
  if (!action || action.status !== "undone") return;
  const items = (await store.items(action.id)).filter((i) => i.outcome === "changed" && i.undo === null);
  if (items.length > 0) {
    const caller: BulkCaller = { householdId, actorId: action.actorId, scoped: false };
    const target = targetOf(deps, action);
    const current = await target.read(
      caller,
      items.map((i) => i.recordId),
    );
    for (const item of items) {
      const turn = decideTurn(
        { versionBefore: item.versionAfter ?? 0, after: item.before ?? {} },
        current.get(item.recordId),
      );
      let restored = turn.kind === "already";
      if (turn.kind === "write") {
        const written = await target.write(caller, item.recordId, item.versionAfter ?? 0, item.before ?? {});
        restored = written.kind === "changed";
      }
      await store.setUndo(action.id, item.position, restored ? "restored" : "not_restored");
    }
  }
  await jobs.audit(action.id, "undo", action.run);
}

/** FR 10, AC8: «Продовжити» an interrupted action — a new run over the records still pending. */
export async function resumeAction(
  store: BulkStore,
  jobs: BulkJobs,
  caller: BulkCaller,
  actionId: string,
): Promise<StoredAction> {
  const action = await own(store, caller, actionId, true);
  if (action.status !== "interrupted") throw new BulkError("NOT_RESUMABLE");
  if (await store.hasRunning(caller.actorId)) throw new BulkError("RUNNING");
  const run = action.run + 1;
  if (!(await store.setStatus(action.id, "running", { endedAt: null, run }))) throw new BulkError("RUNNING");
  await jobs.runPart(action.id, run, 1);
  return { ...action, status: "running", run, endedAt: null };
}

/** The report of the caller's own action (FR 6 progress, FR 8 counts and the time left for «Відмінити»). */
export async function actionReport(deps: BulkDeps, store: BulkStore, caller: BulkCaller, actionId: string) {
  const action = await own(store, caller, actionId, false);
  return reportOf(action, await store.items(action.id), deps.clock.now());
}

export function reportOf(action: StoredAction, items: readonly StoredItem[], now: number) {
  const summary = summarize(items);
  const remaining = undoRemainingMs(action, now);
  return {
    action,
    processed: summary.count - summary.pending,
    summary,
    skippedRecords: items
      .filter((i) => i.outcome !== "changed" && i.outcome !== "pending")
      .map((i) => ({ recordId: i.recordId, reason: i.outcome as SkipReason, issue: i.issue })),
    undo: {
      available: remaining > 0,
      until: remaining > 0 ? now + remaining : null,
      restored: items.filter((i) => i.undo === "restored").length,
      notRestored: items.filter((i) => i.undo === "not_restored").length,
    },
  };
}

/**
 * FR 11, AC9: one group entry of the space's audit log for a run (the records it changed, values before and after)
 * or an undo (the records restored, back to their previous values) — never one entry per record. Its key makes a
 * retried job append nothing more (ARC-04 FR 3).
 */
export async function writeGroupAudit(
  deps: BulkDeps,
  store: BulkStore,
  audit: Pick<AuditLog, "record">,
  householdId: string,
  job: { readonly actionId: string; readonly kind: "run" | "undo"; readonly run: number },
): Promise<void> {
  const action = await store.find(job.actionId);
  if (!action) return;
  const sensitive = new Set(deps.registry.actions.get(action.action)?.sensitiveFields ?? []);
  const items = await store.items(action.id);
  const records =
    job.kind === "run"
      ? items.filter((i) => i.outcome === "changed" && i.run === job.run)
      : items.filter((i) => i.undo === "restored");
  const changes = records.flatMap((item) =>
    Object.keys(item.after ?? {}).map((field) => {
      const before = item.before?.[field] ?? null;
      const after = item.after?.[field] ?? null;
      return {
        record: item.recordId,
        field,
        before: job.kind === "run" ? before : after,
        after: job.kind === "run" ? after : before,
        sensitive: sensitive.has(field),
      };
    }),
  );
  // A run that changed nothing (every record skipped) or an undo that restored nothing changed no data.
  if (changes.length === 0) return;
  await audit.record(householdId, {
    actor: { kind: "user", id: action.actorId },
    channel: "web",
    entity: { type: "bulk-actions.action", id: action.id },
    action: "update",
    changes: [
      { field: job.kind === "run" ? "action" : "undo", before: null, after: action.action, sensitive: false },
      ...changes,
    ],
    key: `bulk-actions.${job.kind}:${action.id}:${job.run}`,
  });
}
