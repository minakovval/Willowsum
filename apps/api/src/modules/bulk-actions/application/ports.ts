import type { z } from "zod";
import type { ActionStatus, BulkValues, ItemOutcome, PlannedChange, UndoOutcome } from "../domain/index.ts";

/** Who runs the action: the session's space, account and whether it is a scoped member (П-5). */
export interface BulkCaller {
  readonly householdId: string;
  readonly actorId: string;
  readonly scoped: boolean;
}

/** A record of the target as the caller may see it: its version (one more for each change) and the action's fields. */
export interface BulkRecord {
  readonly id: string;
  readonly version: number;
  readonly values: BulkValues;
}

export type BulkWrite =
  | { readonly kind: "changed"; readonly version: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "invalid"; readonly issue: string };

/**
 * The records of one entity («transactions»), implemented by the module that owns them through its public interface
 * (DAT-03 FR 5; this module never reads another module's tables). Every method takes the caller's space and scope and
 * answers only for what the caller may see: a record of another space, outside the scope or missing is simply absent
 * (FR 4 «недоступний», AC5, AC11) — never told apart, never counted.
 */
export interface BulkTarget {
  readonly entity: string;
  /**
   * FR 1 «Вибрати всі M за фільтром»: the records matching the list's filter (the list's own syntax and whitelist),
   * without `excluded`, in the list's order — at most `limit` ids, and `count`, how many match. An unknown or
   * malformed filter is `invalid` (nothing about records).
   */
  select(
    caller: BulkCaller,
    filter: readonly string[],
    excluded: readonly string[],
    limit: number,
  ): Promise<{ readonly ids: readonly string[]; readonly count: number } | { readonly invalid: true }>;
  /** The visible records among `ids`; the others are absent from the map. */
  read(caller: BulkCaller, ids: readonly string[]): Promise<ReadonlyMap<string, BulkRecord>>;
  /**
   * FR 5: writes `values` with the same rules as a single edit, if the record still has `expectedVersion` (checked
   * under the record's lock): otherwise `conflict`; gone — `unavailable`; refused by the edit's validation — `invalid`.
   * FR 11: writes no audit entry of its own — the action's group entry holds the change.
   */
  write(caller: BulkCaller, id: string, expectedVersion: number, values: BulkValues): Promise<BulkWrite>;
}

/**
 * One action of the selection panel's «Дії з вибраними» (FR 2), implemented by the module whose fields it changes:
 * the parameters it takes and, for each record, the planned values (or why it is skipped).
 */
export interface BulkActionHandler {
  /** `<entity>.<action>`, e.g. `transactions.add-tags`. */
  readonly name: string;
  readonly entity: string;
  readonly params: z.ZodType;
  /** Fields whose values are free text: masked in the audit entry (П-10). */
  readonly sensitiveFields?: readonly string[];
  /**
   * The action's own release flag and feature key (e.g. `transactions.attributes` of «Додати теги»), checked before
   * the summary and the run: off — the action is unknown, as before it shipped.
   */
  enabled?(caller: BulkCaller): Promise<boolean>;
  plan(
    caller: BulkCaller,
    records: readonly BulkRecord[],
    params: unknown,
  ): Promise<ReadonlyMap<string, PlannedChange>>;
}

export interface BulkRegistry {
  readonly targets: ReadonlyMap<string, BulkTarget>;
  readonly actions: ReadonlyMap<string, BulkActionHandler>;
}

export function bulkRegistry(
  targets: readonly BulkTarget[],
  actions: readonly BulkActionHandler[],
): BulkRegistry {
  const t = new Map(targets.map((x) => [x.entity, x]));
  for (const a of actions)
    if (!t.has(a.entity)) throw new Error(`Bulk action ${a.name}: no target for entity ${a.entity}`);
  return { targets: t, actions: new Map(actions.map((x) => [x.name, x])) };
}

/** A stored action (table `actions`). Times are epoch milliseconds. */
export interface StoredAction {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly entity: string;
  readonly params: unknown;
  readonly background: boolean;
  readonly status: ActionStatus;
  readonly run: number;
  readonly count: number;
  readonly createdAt: number;
  readonly endedAt: number | null;
  readonly undoneAt: number | null;
}

/** A stored record of an action (table `items`), in the selection's order (`position` from 1). */
export interface StoredItem {
  readonly position: number;
  readonly recordId: string;
  readonly versionBefore: number | null;
  readonly before: BulkValues | null;
  readonly after: BulkValues | null;
  readonly outcome: ItemOutcome;
  readonly issue: string | null;
  readonly versionAfter: number | null;
  readonly run: number | null;
  readonly undo: UndoOutcome | null;
}

/** The module's own tables, in one bulk-actions transaction of the caller's space. */
export interface BulkStore {
  /** False when the caller already has a running background action (the partial unique index). */
  insertAction(action: StoredAction, items: readonly StoredItem[]): Promise<boolean>;
  find(actionId: string): Promise<StoredAction | null>;
  /** The action's row locked for this transaction. */
  lock(actionId: string): Promise<StoredAction | null>;
  items(actionId: string): Promise<StoredItem[]>;
  pending(actionId: string, limit: number): Promise<StoredItem[]>;
  setOutcome(
    actionId: string,
    position: number,
    outcome: ItemOutcome,
    fields: { readonly issue?: string | null; readonly versionAfter?: number | null; readonly run?: number },
  ): Promise<void>;
  setUndo(actionId: string, position: number, undo: UndoOutcome): Promise<void>;
  /** False when the caller already has another running background action. */
  setStatus(
    actionId: string,
    status: ActionStatus,
    fields: { readonly endedAt?: number | null; readonly undoneAt?: number; readonly run?: number },
  ): Promise<boolean>;
  hasRunning(actorId: string): Promise<boolean>;
}

/**
 * The jobs of an action (ARC-04), enqueued in the caller's bulk-actions transaction: a part of a run, the undo, and the
 * group audit entry of a run or an undo.
 */
export interface BulkJobs {
  runPart(actionId: string, run: number, part: number): Promise<void>;
  undo(actionId: string): Promise<void>;
  audit(actionId: string, kind: "run" | "undo", run: number): Promise<void>;
}
