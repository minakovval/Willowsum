import {
  categoryAllowed,
  RUN_FOREGROUND_MAX,
  RUN_UNDO_MS,
  UNCATEGORIZED,
  undoState,
  type CategorySource,
  type RunStatus,
} from "../domain/index.ts";
import { categoryAudit, type AuditHandOff, type RuleDeps, type RulesTx } from "./rules.ts";
import { writeCategory, type CategorizationTx, type NextCategory } from "./transaction-categories.ts";

/**
 * «Застосувати до N наявних транзакцій, що підходять» (BUD-14@PoC FR 7, AC2, AC4–AC6, AC15, EC1, EC5; wave 2 row 23
 * b2): one operation — a run of the rule over the existing transactions it matches, the first 500 at once, the rest in
 * the background with progress (job `categorization.rule-run-part`), and its «Відмінити» for 7 days, which gives back
 * only what the run changed and nobody changed since.
 *
 * A run keeps the rule as it was when it began (category and tags). Each part is one categorization transaction with
 * the run's row locked, so the route and the worker may both take parts of one run: each takes the next pending
 * records. Per record: the rule's tags first (module transactions, its own transaction: a retry finds them there and
 * adds nothing), then the category «за правилом» — unless it was set by hand («Пропущено: ручні зміни», FR 9) — with
 * the user's audit entry per transaction. The run's own entry (`categorization.rule-run`) is written when it ends and
 * when it is undone.
 */

/** How many records one part takes (the route takes parts until `RUN_FOREGROUND_MAX` are processed). */
export const RUN_PART_SIZE = 100;

export interface RunRow {
  readonly id: string;
  readonly ruleId: string;
  readonly actorAccountId: string;
  readonly undoActorAccountId: string | null;
  readonly categoryId: string;
  readonly tags: readonly string[];
  readonly status: RunStatus;
  readonly truncated: boolean;
  readonly count: number;
  readonly createdAt: number;
  readonly endedAt: number | null;
  /**
   * BUD-21 FR 22 (row 237): the derivation whose accepted suggestions this run applies — a run of several rules, each
   * record with its own (`RunItem.rule`); null or absent — a run of the one rule `ruleId` (BUD-14 FR 7).
   */
  readonly derivationId?: string | null;
}

/**
 * BUD-21 FR 22: the rules of one record of an acceptance's run — the first accepted rule by priority that matches the
 * transaction sets its category, the first such rule with tags its tags (BUD-14 FR 8).
 */
export interface ItemRule {
  readonly ruleId: string;
  readonly categoryId: string;
  readonly tagRuleId: string | null;
  readonly tags: readonly string[];
}

export type ItemResult = "pending" | "changed" | "unchanged" | "manual" | "unavailable";

export interface RunItem {
  readonly ordinal: number;
  readonly transactionId: string;
  readonly result: ItemResult;
  readonly categoryChanged: boolean;
  readonly before: {
    readonly categoryId: string | null;
    readonly source: CategorySource;
    readonly ruleId: string | null;
  } | null;
  readonly afterVersion: number | null;
  readonly tagsChanged: boolean;
  readonly tagsBefore: readonly string[] | null;
  readonly tagsAfter: readonly string[] | null;
  readonly beforeTagRuleId: string | null;
  /** BUD-21 FR 22: the record's own rules in a run of an acceptance; null or absent — the run's rule. */
  readonly rule?: ItemRule | null;
}

export interface RunCounts {
  readonly processed: number;
  readonly changed: number;
  readonly manual: number;
  readonly unchanged: number;
  readonly unavailable: number;
  readonly undoPending: number;
  readonly restored: number;
  readonly notRestored: number;
}

/** The runs part of the categorization schema, in one transaction of the module (adapters/db/runs.ts). */
export interface RunsTx {
  /**
   * A new run with its records in order; false — another run of the space is running (one at a time). `rules` (BUD-21
   * FR 22): each record's own rules, by the index of `transactionIds`.
   */
  insertRun(
    householdId: string,
    run: RunRow,
    transactionIds: readonly string[],
    rules?: readonly ItemRule[],
  ): Promise<boolean>;
  run(householdId: string, id: string): Promise<RunRow | null>;
  /** The run's row, locked until the transaction ends. */
  lockRun(householdId: string, id: string): Promise<RunRow | null>;
  /** The space's runs, newest first. */
  runs(householdId: string, limit: number): Promise<RunRow[]>;
  counts(householdId: string, id: string): Promise<RunCounts>;
  pending(householdId: string, id: string, limit: number): Promise<RunItem[]>;
  undoPending(householdId: string, id: string, limit: number): Promise<RunItem[]>;
  saveItem(householdId: string, id: string, item: RunItem): Promise<void>;
  /** Every pending record of the run becomes «unavailable» (the rule or its category is gone meanwhile). */
  dropPending(householdId: string, id: string): Promise<void>;
  saveUndo(householdId: string, id: string, ordinal: number, restored: boolean): Promise<void>;
  /**
   * «Відмінити» begins: the run is `undoing` and every record it changed waits for its undo; false — another run of the
   * space is running.
   */
  startUndo(householdId: string, id: string, actorAccountId: string): Promise<boolean>;
  finish(householdId: string, id: string, status: "completed" | "undone", at: number): Promise<void>;
  /** The next part's job (key: the run, its state and how far it got). */
  enqueuePart(householdId: string, id: string, status: RunStatus, step: number): Promise<void>;
}

export type RunDeps = Pick<RuleDeps, "inputs" | "tags" | "categories">;

export interface RunReport {
  readonly run: RunRow;
  readonly counts: RunCounts;
  readonly undo: { readonly available: boolean; readonly until: number | null };
}

export function reportOf(run: RunRow, counts: RunCounts, now: number): RunReport {
  return {
    run,
    counts,
    undo: {
      available: undoState(run, now) === "available",
      until: run.endedAt === null || run.status !== "completed" ? null : run.endedAt + RUN_UNDO_MS,
    },
  };
}

export type StartResult =
  | { readonly kind: "ok"; readonly run: RunRow }
  | { readonly kind: "not-found" }
  | { readonly kind: "running" };

/** Starts a run of the rule over `transactionIds` (the matches, newest first); `checks` ran before (attention). */
export async function startRun(
  rulesTx: RulesTx,
  runsTx: RunsTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly id: string;
    readonly ruleId: string;
    readonly transactionIds: readonly string[];
    readonly truncated: boolean;
    readonly now: number;
  },
): Promise<StartResult> {
  await rulesTx.lockRules(input.householdId);
  const rule = (await rulesTx.rules(input.householdId)).find((r) => r.id === input.ruleId);
  if (!rule) return { kind: "not-found" };
  const run: RunRow = {
    id: input.id,
    ruleId: rule.id,
    actorAccountId: input.actorAccountId,
    undoActorAccountId: null,
    categoryId: rule.categoryId,
    tags: rule.tags,
    status: "running",
    truncated: input.truncated,
    count: input.transactionIds.length,
    createdAt: input.now,
    endedAt: null,
  };
  if (!(await runsTx.insertRun(input.householdId, run, input.transactionIds))) return { kind: "running" };
  // The worker's part is there from the start: if the request stops, the run still ends (ARC-04).
  await runsTx.enqueuePart(input.householdId, run.id, "running", 0);
  return { kind: "ok", run };
}

function runAudit(run: RunRow, counts: RunCounts, undo: boolean): AuditHandOff {
  return undo
    ? {
        key: `categorization.rule-run.undo:${run.id}`,
        actorAccountId: run.undoActorAccountId ?? run.actorAccountId,
        entity: "categorization.rule-run",
        entityId: run.id,
        action: "update",
        changes: [
          { field: "status", before: "completed", after: "undone", sensitive: false },
          { field: "restored", before: null, after: String(counts.restored), sensitive: false },
          { field: "notRestored", before: null, after: String(counts.notRestored), sensitive: false },
        ],
      }
    : {
        key: `categorization.rule-run:${run.id}`,
        actorAccountId: run.actorAccountId,
        entity: "categorization.rule-run",
        entityId: run.id,
        action: "create",
        changes: [
          { field: "ruleId", before: null, after: run.ruleId, sensitive: false },
          { field: "categoryId", before: null, after: run.categoryId, sensitive: false },
          { field: "count", before: null, after: String(run.count), sensitive: false },
          { field: "changed", before: null, after: String(counts.changed), sensitive: false },
          { field: "skippedManual", before: null, after: String(counts.manual), sensitive: false },
          // BUD-21 FR 22, FR 26: the run of an acceptance names its derivation (its rules are the accepted ones).
          ...(run.derivationId
            ? [{ field: "derivationId", before: null, after: run.derivationId, sensitive: false }]
            : []),
        ],
      };
}

/** The rules a record takes: its own in a run of an acceptance (BUD-21 FR 22), else the run's. */
const rulesOf = (run: RunRow, item: RunItem): ItemRule =>
  item.rule ?? { ruleId: run.ruleId, categoryId: run.categoryId, tagRuleId: run.ruleId, tags: run.tags };

async function applyItem(
  tx: CategorizationTx,
  rulesTx: RulesTx,
  deps: RunDeps,
  householdId: string,
  run: RunRow,
  item: RunItem,
  rule: ItemRule,
): Promise<RunItem> {
  let tags: Pick<RunItem, "tagsChanged" | "tagsBefore" | "tagsAfter" | "beforeTagRuleId"> = {
    tagsChanged: false,
    tagsBefore: null,
    tagsAfter: null,
    beforeTagRuleId: null,
  };
  if (rule.tagRuleId !== null && rule.tags.length > 0 && deps.tags) {
    const tagged = await deps.tags.addTags(householdId, item.transactionId, rule.tags, run.actorAccountId);
    if (tagged.kind === "changed") {
      const current = await tx.lock(householdId, item.transactionId);
      tags = {
        tagsChanged: true,
        tagsBefore: tagged.before,
        tagsAfter: tagged.after,
        beforeTagRuleId: current?.tagRuleId ?? null,
      };
      await tx.setTagRule(householdId, item.transactionId, rule.tagRuleId);
    }
  }
  const next: NextCategory = { categoryId: rule.categoryId, source: "rule", ruleId: rule.ruleId };
  // A row inserted by another writer between the lock and the insert: once more, now locked.
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await tx.lock(householdId, item.transactionId);
    const seen = current ?? { ...UNCATEGORIZED, ruleId: null, version: 0 };
    if (seen.source === "manual") return { ...item, ...tags, result: "manual" };
    if (seen.categoryId === next.categoryId && seen.source === "rule" && seen.ruleId === next.ruleId)
      return { ...item, ...tags, result: "unchanged" };
    const outcome = await writeCategory(tx, householdId, item.transactionId, next);
    if (outcome.kind === "conflict") continue;
    if (outcome.kind === "unchanged") return { ...item, ...tags, result: "unchanged" };
    await rulesTx.enqueueAudit(
      householdId,
      categoryAudit(run.actorAccountId, item.transactionId, { ...outcome, before: seen }, next),
    );
    return {
      ...item,
      ...tags,
      result: "changed",
      categoryChanged: true,
      before: { categoryId: seen.categoryId, source: seen.source, ruleId: seen.ruleId },
      afterVersion: outcome.row.version,
    };
  }
  throw new Error("categorization.rule-run: version conflict");
}

async function undoItem(
  tx: CategorizationTx,
  rulesTx: RulesTx,
  deps: RunDeps,
  householdId: string,
  run: RunRow,
  item: RunItem,
): Promise<boolean> {
  const actor = run.undoActorAccountId ?? run.actorAccountId;
  let restored = true;
  if (item.categoryChanged && item.before !== null) {
    const current = await tx.lock(householdId, item.transactionId);
    if (current === null || current.version !== item.afterVersion) restored = false;
    // BUD-01 FR 9, FR 12: a category deleted or merged away since the run takes no transaction back.
    else if (
      item.before.categoryId !== null &&
      !categoryAllowed(await deps.categories.category(householdId, item.before.categoryId))
    )
      restored = false;
    else {
      const back: NextCategory = {
        categoryId: item.before.categoryId,
        source: item.before.source,
        ruleId: item.before.ruleId,
      };
      const outcome = await writeCategory(tx, householdId, item.transactionId, back, current.version);
      if (outcome.kind === "changed")
        await rulesTx.enqueueAudit(
          householdId,
          categoryAudit(actor, item.transactionId, { ...outcome, before: current }, back),
        );
      else if (outcome.kind === "conflict") restored = false;
    }
  }
  if (item.tagsChanged && item.tagsAfter !== null && item.tagsBefore !== null) {
    const back = deps.tags
      ? await deps.tags.restoreTags(householdId, item.transactionId, item.tagsAfter, item.tagsBefore, actor)
      : "changed";
    if (back === "restored") await tx.setTagRule(householdId, item.transactionId, item.beforeTagRuleId);
    else restored = false;
  }
  return restored;
}

/**
 * One part of a run (or of its «Відмінити»): the next `limit` records, under the run's lock. When none is left the
 * run ends (`completed` / `undone`) with its audit entry; otherwise, with `chain`, the next part's job is enqueued.
 * Returns whether the run is done with its current step.
 */
export async function runPart(
  tx: CategorizationTx,
  rulesTx: RulesTx,
  runsTx: RunsTx,
  deps: RunDeps,
  input: {
    readonly householdId: string;
    readonly runId: string;
    readonly limit: number;
    readonly now: number;
    readonly chain: boolean;
  },
): Promise<{ readonly done: boolean; readonly audit: AuditHandOff | null }> {
  const { householdId, runId } = input;
  const run = await runsTx.lockRun(householdId, runId);
  if (!run || (run.status !== "running" && run.status !== "undoing")) return { done: true, audit: null };
  if (run.status === "running") {
    // Under the rules lock: a rule deleted meanwhile changes no more transactions (FR 15), nor does a category deleted
    // or merged away since the run began (BUD-01 FR 9, FR 12).
    await rulesTx.lockRules(householdId);
    const items = await runsTx.pending(householdId, runId, input.limit);
    const ruleIds = new Set((await rulesTx.rules(householdId)).map((r) => r.id));
    const categories = new Map<string, boolean>();
    const allowed = async (categoryId: string) => {
      if (!categories.has(categoryId))
        categories.set(categoryId, categoryAllowed(await deps.categories.category(householdId, categoryId)));
      return categories.get(categoryId)!;
    };
    const several = (run.derivationId ?? null) !== null;
    if (!several && (!ruleIds.has(run.ruleId) || !(await allowed(run.categoryId))))
      await runsTx.dropPending(householdId, runId);
    else if (items.length > 0) {
      const inputs = await deps.inputs.inputs(
        householdId,
        items.map((i) => i.transactionId),
      );
      for (const item of items) {
        const seen = inputs.get(item.transactionId);
        const own = rulesOf(run, item);
        // BUD-21 FR 22: in a run of several rules, a record whose rule was deleted or whose category is gone since the
        // acceptance changes nothing; a tag rule deleted meanwhile adds no tags.
        const rule: ItemRule =
          several && own.tagRuleId !== null && !ruleIds.has(own.tagRuleId)
            ? { ...own, tagRuleId: null }
            : own;
        const usable = !several || (ruleIds.has(rule.ruleId) && (await allowed(rule.categoryId)));
        const done =
          seen && seen.eligible && usable
            ? await applyItem(tx, rulesTx, deps, householdId, run, item, rule)
            : { ...item, result: "unavailable" as const };
        await runsTx.saveItem(householdId, runId, done);
      }
    }
  } else
    for (const item of await runsTx.undoPending(householdId, runId, input.limit))
      await runsTx.saveUndo(
        householdId,
        runId,
        item.ordinal,
        await undoItem(tx, rulesTx, deps, householdId, run, item),
      );
  const counts = await runsTx.counts(householdId, runId);
  const left = run.status === "running" ? run.count - counts.processed : counts.undoPending;
  if (left > 0) {
    if (input.chain)
      await runsTx.enqueuePart(
        householdId,
        runId,
        run.status,
        run.status === "running" ? counts.processed : counts.restored + counts.notRestored,
      );
    return { done: false, audit: null };
  }
  const undo = run.status === "undoing";
  await runsTx.finish(householdId, runId, undo ? "undone" : "completed", input.now);
  const audit = runAudit(run, counts, undo);
  await rulesTx.enqueueAudit(householdId, audit);
  return { done: true, audit };
}

export type UndoResult =
  | { readonly kind: "ok" }
  | { readonly kind: "not-found" }
  | { readonly kind: "expired" | "undone" | "running" };

/** «Відмінити» (FR 7, AC6): up to 7 days after the run ended, once; then the parts give the values back. */
export async function startUndo(
  runsTx: RunsTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly runId: string;
    readonly now: number;
  },
): Promise<UndoResult> {
  const run = await runsTx.lockRun(input.householdId, input.runId);
  if (!run) return { kind: "not-found" };
  const state = undoState(run, input.now);
  if (state !== "available") return { kind: state };
  if (!(await runsTx.startUndo(input.householdId, input.runId, input.actorAccountId)))
    return { kind: "running" };
  await runsTx.enqueuePart(input.householdId, input.runId, "undoing", 0);
  return { kind: "ok" };
}

export { RUN_FOREGROUND_MAX };
