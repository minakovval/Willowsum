import {
  categoryColor,
  categoryIcon,
  categoryName,
  customGroupTone,
  deleteProblem,
  hasEssential,
  mergeProblem,
  stateAfterMerge,
  SYSTEM_TREE,
  type CategoryKind,
  type CategoryState,
  type MergeProblem,
} from "../domain/index.ts";

/**
 * The category tree of a space (BUD-01@PoC FR 1–3, FR 8, FR 10, FR 11; wave 2 row 19): the system tree written into
 * the space on first use, custom groups and categories, rename, hide, «обов'язкова», icon and colour, merge.
 *
 * Order of one change, in this module's transaction with the rows locked: checks → the rows (a unique index backs
 * «Така назва вже існує» against a concurrent writer) → for a merge the event `categories.merged` in the module's
 * outbox (ARC-04, same transaction) → the audit entry (П-10; the audit module's own transaction, committed first) →
 * commit. A failure after the audit entry leaves an entry of a change the tree does not show — the residual risk of
 * every module until the audit hand-off moves to events (ARC-04).
 */

export interface StoredGroup {
  readonly id: string;
  readonly systemKey: string | null;
  readonly kind: CategoryKind;
  readonly name: string;
  readonly renamed: boolean;
  readonly tone: string;
  readonly position: number;
  readonly version: number;
}

export interface StoredCategory {
  readonly id: string;
  readonly groupId: string;
  readonly kind: CategoryKind;
  readonly systemKey: string | null;
  readonly name: string;
  readonly renamed: boolean;
  readonly icon: string;
  readonly color: string;
  readonly essential: boolean | null;
  readonly state: CategoryState;
  readonly mergedInto: string | null;
  readonly position: number;
  readonly version: number;
}

export interface MergedEvent {
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: "expense" | "income";
  readonly mergedAt: string;
}

export interface CategoriesTx {
  systemGroupCount(householdId: string): Promise<number>;
  /** Inserts what is missing of the system tree; a row already there is kept. Returns the categories added. */
  seed(
    householdId: string,
    groups: readonly StoredGroup[],
    categories: readonly StoredCategory[],
  ): Promise<number>;
  /** System groups by key (after a seed, with this space's ids). */
  groups(householdId: string): Promise<StoredGroup[]>;
  /** Every category but those out of use; `withRetired` — those merged away too (the budget follows `mergedInto`). */
  categories(householdId: string, options?: { readonly withRetired?: boolean }): Promise<StoredCategory[]>;
  group(householdId: string, id: string, lock?: boolean): Promise<StoredGroup | null>;
  category(householdId: string, id: string, lock?: boolean): Promise<StoredCategory | null>;
  bySystemKey(householdId: string, key: string): Promise<StoredCategory | null>;
  /** Is the name used by a category in use (or by a group, `groups`), other than `exceptId`? Without case. */
  nameTaken(
    householdId: string,
    name: string,
    table: "categories" | "groups",
    exceptId?: string,
  ): Promise<boolean>;
  customGroupCount(householdId: string, kind: CategoryKind): Promise<number>;
  nextPosition(householdId: string, table: "categories" | "groups", groupId?: string): Promise<number>;
  insertGroup(householdId: string, group: StoredGroup): Promise<StoredGroup>;
  updateGroup(householdId: string, group: StoredGroup): Promise<StoredGroup>;
  insertCategory(householdId: string, category: StoredCategory): Promise<StoredCategory>;
  updateCategory(householdId: string, category: StoredCategory): Promise<StoredCategory>;
  /** Categories merged before into `from` now point to `to` (FR 8: one hop to the category in use). */
  /** Each category re-pointed, before and after (its version bumped), for the audit log. */
  repointMerged(
    householdId: string,
    from: string,
    to: string,
  ): Promise<{ readonly before: StoredCategory; readonly after: StoredCategory }[]>;
  publishMerged(event: MergedEvent): Promise<void>;
  /** FR 12: of `ids`, those another category was merged into (its records went there, FR 8). */
  mergeTargets(householdId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** FR 12: how many categories were merged into `id`. */
  mergedCount(householdId: string, id: string): Promise<number>;
  /** FR 12: the row of a custom category is removed; its name is free again. */
  deleteCategory(householdId: string, id: string): Promise<void>;
}

/**
 * FR 12: what holds a category is a question to every module that keeps category ids — `transactions` (split parts),
 * `categorization` (the transaction's category, category rules), `recurring` (regular payments; lead decision, #260)
 * — and, without holding it, `budget` (limits, «План» cells: owner decision 2026-11-26, deleted with the category). A
 * module that starts to keep category ids adds its own to the API's wiring (src/main.ts) in the same PR.
 */
export interface CategoryUsage {
  /** The answering module, for the reader of the wiring. */
  readonly module: string;
  /** Which of `ids` this module's records of the space hold (they block the deletion); left out — none. */
  used?(householdId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * BUD-02@PoC FR 23, AC 19; BUD-01@PoC FR 13: how many transactions of the space this module's records put in the
   * category — only the modules that keep transactions' categories (the transaction's own category, split parts)
   * answer; one transaction is counted by one module only.
   */
  transactions?(householdId: string, categoryId: string): Promise<number>;
  /** FR 12: how many of this module's other records hold the category, by kind (rules, regular payments). */
  holds?(householdId: string, categoryId: string): Promise<Partial<Record<HoldKind, number>>>;
  /** FR 12 (owner decision 2026-11-26): the budget's entries of the category — they do not hold it. */
  readonly limits?: CategoryLimits;
}

/** FR 12: the kinds of other records that hold a category besides its transactions. */
type HoldKind = "rules" | "recurringPayments";

/** An amount as decimal text with its currency (never a float). */
export interface MoneyText {
  readonly amount: string;
  readonly currency: string;
}

/**
 * FR 12 (owner decision 2026-11-26): a category's entries in the budget — its limit (an income category: its plan)
 * and its months' own values in «План». `limit` is the one of the current period (null — none then); `stored` — the
 * budget keeps a limit or plan of the category at all. Finished periods' snapshots are not entries: they stay.
 */
export interface CategoryBudgetEntries {
  readonly limit: MoneyText | null;
  readonly stored: boolean;
  readonly planCells: number;
}

/** FR 12: module budget's port — reads and, with a confirmed delete, removes the category's entries (its own tables). */
export interface CategoryLimits {
  /** Which of `ids` have any entry. */
  held(householdId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  entries(householdId: string, categoryId: string): Promise<CategoryBudgetEntries>;
  /** Removes them (module budget's transaction and audit entries) and returns what it removed. */
  release(caller: Caller, categoryId: string): Promise<CategoryBudgetEntries>;
}

export const NO_BUDGET_ENTRIES: CategoryBudgetEntries = { limit: null, stored: false, planCells: 0 };

/** FR 12: what holds a category, each kind with its count; `budget` does not hold it. */
export interface CategoryUsageReport {
  readonly transactions: number;
  readonly rules: number;
  readonly recurringPayments: number;
  /** FR 8: categories merged into it (their records went there). */
  readonly mergedCategories: number;
  readonly budget: CategoryBudgetEntries;
}

const hasBudgetEntries = (b: CategoryBudgetEntries): boolean => b.stored || b.planCells > 0;

export type AuditedEntity = "categories.tree" | "categories.group" | "categories.category";
export type AuditValues = Readonly<Record<string, string | null>>;

/** The space's audit log (П-10, BUD-01 «Права доступу»): who, when, the fields before and after. */
export interface CategoriesAudit {
  changed(
    householdId: string,
    actor: { readonly accountId: string } | "system",
    entity: { readonly type: AuditedEntity; readonly id: string },
    action: "create" | "update" | "delete",
    before: AuditValues | null,
    after: AuditValues | null,
  ): Promise<void>;
}

export interface CategoriesDeps {
  readonly audit: CategoriesAudit;
  readonly newId: () => string;
  readonly now: () => number;
}

export interface Caller {
  readonly householdId: string;
  /** The member's account (identity); in this release always the space's Owner. */
  readonly accountId: string;
}

export type FieldIssue = {
  readonly field: string;
  readonly issue: "invalid" | "not_found" | "service" | "not_expense" | "same" | "hidden";
};

export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  /** «Така назва вже існує» (FR 2). */
  | { readonly kind: "name-taken" }
  /** «Категорії різних типів не можна об'єднати» (FR 8). */
  | { readonly kind: "kinds-differ" }
  /** «Переказ» and «Коригування» are never hidden or merged (FR 3). */
  | { readonly kind: "service-fixed" }
  /** FR 12, FR 3: a system category is never deleted, only hidden. */
  | { readonly kind: "system-fixed" }
  /**
   * FR 12: data holds the category — transactions, category rules, regular payments (or another category merged into
   * it); the refusal names each kind with its count.
   */
  | { readonly kind: "not-empty"; readonly usage?: CategoryUsageReport }
  /**
   * FR 12 (owner decision 2026-11-26): only its limit and «План» cells hold it — deleted with them once the request
   * confirms it (`confirmLimit`); unconfirmed, nothing changes and the answer names the limit.
   */
  | { readonly kind: "confirm-limit"; readonly usage: CategoryUsageReport }
  | { readonly kind: "not-found" };

const ok = <T>(value: T): Result<T> => ({ kind: "ok", value });
const invalid = (field: string, issue: FieldIssue["issue"]): Result<never> => ({
  kind: "invalid",
  issues: [{ field, issue }],
});

const CUSTOM_ICON = "shapes";
/** Custom groups come after the system groups of income and expenses, the service group last. */
const SERVICE_POSITION = 10_000;
const FIRST_CUSTOM_POSITION = 100;

const groupValues = (g: StoredGroup): AuditValues => ({ name: g.name, kind: g.kind, tone: g.tone });
const categoryValues = (c: StoredCategory): AuditValues => ({
  name: c.name,
  groupId: c.groupId,
  icon: c.icon,
  color: c.color,
  essential: c.essential === null ? null : String(c.essential),
  state: c.state,
  mergedInto: c.mergedInto,
});

/**
 * FR 1: the system tree of the space, written the first time it is needed (any route, the directory). Idempotent:
 * a second writer at the same time adds nothing (the unique keys of the system keys). A key added to the catalogue
 * later is added to the space then. One audit entry of the system for the tree written.
 */
export async function ensureTree(deps: CategoriesDeps, tx: CategoriesTx, householdId: string): Promise<void> {
  if ((await tx.systemGroupCount(householdId)) === SYSTEM_TREE.length) {
    const count = (await tx.categories(householdId)).filter((c) => c.systemKey !== null).length;
    if (count >= SYSTEM_TREE.reduce((n, g) => n + g.categories.length, 0)) return;
  }
  const groups = SYSTEM_TREE.map((g, i): StoredGroup => ({
    id: deps.newId(),
    systemKey: g.key,
    kind: g.kind,
    name: g.name,
    renamed: false,
    tone: g.tone,
    position: g.kind === "service" ? SERVICE_POSITION : i,
    version: 1,
  }));
  await tx.seed(householdId, groups, []);
  const ids = new Map((await tx.groups(householdId)).map((g) => [g.systemKey, g.id]));
  // A system group missing in the space (a custom group took its name before a later release added it) brings none.
  const categories = SYSTEM_TREE.filter((g) => ids.has(g.key)).flatMap((g) =>
    g.categories.map((c, i): StoredCategory => ({
      id: deps.newId(),
      groupId: ids.get(g.key)!,
      kind: g.kind,
      systemKey: c.key,
      name: c.name,
      renamed: false,
      icon: c.icon,
      color: c.color,
      essential: hasEssential(g.kind) ? c.essential === true : null,
      state: "active",
      mergedInto: null,
      position: i,
      version: 1,
    })),
  );
  const added = await tx.seed(householdId, [], categories);
  if (added > 0)
    await deps.audit.changed(
      householdId,
      "system",
      { type: "categories.tree", id: householdId },
      "create",
      null,
      {
        systemCategories: String(added),
      },
    );
}

/** The tree as the settings show it (FR 1, FR 3): groups in order, each with its categories in use (hidden too). */
export async function readTree(
  tx: CategoriesTx,
  householdId: string,
): Promise<{ readonly group: StoredGroup; readonly categories: StoredCategory[] }[]> {
  const [groups, categories] = await Promise.all([tx.groups(householdId), tx.categories(householdId)]);
  return groups.map((group) => ({ group, categories: categories.filter((c) => c.groupId === group.id) }));
}

function checkName(text: string): string | Result<never> {
  return categoryName(text) ?? invalid("name", "invalid");
}

/** FR 2: a custom group of type «дохід» or «витрата». */
export async function createGroup(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: Caller,
  input: { readonly name: string; readonly kind: "expense" | "income" },
): Promise<Result<StoredGroup>> {
  const name = checkName(input.name);
  if (typeof name !== "string") return name;
  if (await tx.nameTaken(caller.householdId, name, "groups")) return { kind: "name-taken" };
  const position = Math.max(FIRST_CUSTOM_POSITION, await tx.nextPosition(caller.householdId, "groups"));
  const group = await tx.insertGroup(caller.householdId, {
    id: deps.newId(),
    systemKey: null,
    kind: input.kind,
    name,
    renamed: false,
    tone: customGroupTone(input.kind, await tx.customGroupCount(caller.householdId, input.kind)),
    position,
    version: 1,
  });
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.group", id: group.id },
    "create",
    null,
    groupValues(group),
  );
  return ok(group);
}

/** FR 2, FR 3: rename a group; a renamed system group shows its new name. */
export async function renameGroup(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: Caller,
  groupId: string,
  input: { readonly name: string },
): Promise<Result<StoredGroup>> {
  const before = await tx.group(caller.householdId, groupId, true);
  if (!before) return { kind: "not-found" };
  const name = checkName(input.name);
  if (typeof name !== "string") return name;
  if (name === before.name) return ok(before);
  if (await tx.nameTaken(caller.householdId, name, "groups", groupId)) return { kind: "name-taken" };
  const standard = SYSTEM_TREE.find((g) => g.key === before.systemKey)?.name;
  const after = await tx.updateGroup(caller.householdId, {
    ...before,
    name,
    renamed: standard !== undefined && standard !== name,
    version: before.version + 1,
  });
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.group", id: groupId },
    "update",
    groupValues(before),
    groupValues(after),
  );
  return ok(after);
}

export interface CategoryInput {
  readonly groupId: string;
  readonly name: string;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly essential?: boolean | undefined;
}

/** FR 2: a custom category in a group of income or expenses (never in the service group). */
export async function createCategory(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: Caller,
  input: CategoryInput,
): Promise<Result<StoredCategory>> {
  const group = await tx.group(caller.householdId, input.groupId);
  if (!group) return invalid("groupId", "not_found");
  if (group.kind === "service") return invalid("groupId", "service");
  const name = checkName(input.name);
  if (typeof name !== "string") return name;
  const icon = input.icon === undefined ? CUSTOM_ICON : categoryIcon(input.icon);
  if (icon === undefined) return invalid("icon", "invalid");
  const color = input.color === undefined ? group.tone : categoryColor(input.color);
  if (color === undefined) return invalid("color", "invalid");
  if (input.essential !== undefined && !hasEssential(group.kind)) return invalid("essential", "not_expense");
  if (await tx.nameTaken(caller.householdId, name, "categories")) return { kind: "name-taken" };
  const category = await tx.insertCategory(caller.householdId, {
    id: deps.newId(),
    groupId: group.id,
    kind: group.kind,
    systemKey: null,
    name,
    renamed: false,
    icon,
    color,
    // FR 11: off for every custom category unless set.
    essential: hasEssential(group.kind) ? (input.essential ?? false) : null,
    state: "active",
    mergedInto: null,
    position: await tx.nextPosition(caller.householdId, "categories", group.id),
    version: 1,
  });
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.category", id: category.id },
    "create",
    null,
    categoryValues(category),
  );
  return ok(category);
}

export interface CategoryChange {
  readonly name?: string | undefined;
  readonly hidden?: boolean | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly essential?: boolean | undefined;
}

/** FR 2, FR 3, FR 10, FR 11: rename, hide or show, icon and colour, «обов'язкова». An unchanged save writes nothing. */
export async function updateCategory(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: Caller,
  categoryId: string,
  change: CategoryChange,
): Promise<Result<StoredCategory>> {
  const before = await tx.category(caller.householdId, categoryId, true);
  if (!before || before.state === "retired") return { kind: "not-found" };
  let next: StoredCategory = before;
  if (change.name !== undefined) {
    const name = checkName(change.name);
    if (typeof name !== "string") return name;
    const standard = SYSTEM_TREE.flatMap((g) => g.categories).find((c) => c.key === before.systemKey)?.name;
    next = { ...next, name, renamed: standard !== undefined && standard !== name };
  }
  if (change.icon !== undefined) {
    const icon = categoryIcon(change.icon);
    if (icon === undefined) return invalid("icon", "invalid");
    next = { ...next, icon };
  }
  if (change.color !== undefined) {
    const color = categoryColor(change.color);
    if (color === undefined) return invalid("color", "invalid");
    next = { ...next, color };
  }
  if (change.essential !== undefined) {
    if (!hasEssential(before.kind)) return invalid("essential", "not_expense");
    next = { ...next, essential: change.essential };
  }
  if (change.hidden !== undefined) {
    if (before.kind === "service" && change.hidden) return { kind: "service-fixed" };
    const state: CategoryState = change.hidden ? "hidden" : "active";
    // Shown again (edge case 5), a merged system category is a category in use: new transactions may go to it.
    if (state !== before.state)
      next = { ...next, state, mergedInto: state === "active" ? null : next.mergedInto };
  }
  const changed = (Object.keys(categoryValues(before)) as (keyof AuditValues)[]).some(
    (k) => categoryValues(before)[k] !== categoryValues(next)[k],
  );
  if (!changed) return ok(before);
  if (
    next.name !== before.name &&
    (await tx.nameTaken(caller.householdId, next.name, "categories", categoryId))
  )
    return { kind: "name-taken" };
  const after = await tx.updateCategory(caller.householdId, { ...next, version: before.version + 1 });
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.category", id: categoryId },
    "update",
    categoryValues(before),
    categoryValues(after),
  );
  return ok(after);
}

const MERGE_RESULT: Record<MergeProblem, Result<never>> = {
  same: invalid("targetId", "same"),
  target_hidden: invalid("targetId", "hidden"),
  service: { kind: "service-fixed" },
  kinds_differ: { kind: "kinds-differ" },
};

/**
 * FR 8: merge a category into another of the same type. The source is hidden (a system category, edge case 5) or
 * taken out of use (a custom one); categories merged into it before now point to the target. The event
 * `categories.merged` (same transaction) tells the modules holding transactions, split parts, rules, recurring
 * payments and limits to move them to the target; the periods are recounted from their projections.
 */
export async function mergeCategory(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: Caller,
  sourceId: string,
  input: { readonly targetId: string },
): Promise<Result<{ readonly source: StoredCategory; readonly target: StoredCategory }>> {
  // Both rows locked in one order, so two merges of the same pair never wait on each other.
  const [first, second] = [sourceId, input.targetId].sort();
  const locked = new Map<string, StoredCategory | null>();
  for (const id of new Set([first!, second!]))
    locked.set(id, await tx.category(caller.householdId, id, true));
  const source = locked.get(sourceId);
  if (!source || source.state === "retired") return { kind: "not-found" };
  const target = locked.get(input.targetId);
  if (!target || target.state === "retired") return invalid("targetId", "not_found");
  const problem = mergeProblem(source, target);
  if (problem !== null) return MERGE_RESULT[problem];
  const repointed = await tx.repointMerged(caller.householdId, source.id, target.id);
  const after = await tx.updateCategory(caller.householdId, {
    ...source,
    state: stateAfterMerge(source.systemKey !== null),
    mergedInto: target.id,
    version: source.version + 1,
  });
  await tx.publishMerged({
    sourceId: source.id,
    targetId: target.id,
    kind: source.kind as "expense" | "income",
    mergedAt: new Date(deps.now()).toISOString(),
  });
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.category", id: source.id },
    "update",
    categoryValues(source),
    categoryValues(after),
  );
  // Every category re-pointed is a change of its own: one entry each (`mergedInto` before and after).
  for (const r of repointed)
    await deps.audit.changed(
      caller.householdId,
      caller,
      { type: "categories.category", id: r.after.id },
      "update",
      categoryValues(r.before),
      categoryValues(r.after),
    );
  return ok({ source: after, target });
}

/**
 * FR 12: of the given categories, those data holds — a record of another module (`usage`: transactions, split parts,
 * category rules, regular payments) or a category merged into it. Limits and «План» cells do not hold a category
 * (owner decision 2026-11-26). A system category is never deletable whatever this says.
 */
export async function categoriesInUse(
  usage: readonly CategoryUsage[],
  tx: CategoriesTx,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const answers = await Promise.all([
    tx.mergeTargets(householdId, ids),
    ...usage.map((u) => (u.used ? u.used(householdId, ids) : Promise.resolve(new Set<string>()))),
  ]);
  return new Set(answers.flatMap((a) => [...a]));
}

/**
 * BUD-02@PoC FR 23, AC 19; BUD-01@PoC FR 13: the count «N транзакцій» of the dialog «Видалити категорію…» — the sum of
 * the answers of the modules that keep transactions' categories.
 */
export async function transactionCount(
  usage: readonly CategoryUsage[],
  householdId: string,
  categoryId: string,
): Promise<number> {
  const counts = await Promise.all(
    usage.map((u) => (u.transactions ? u.transactions(householdId, categoryId) : Promise.resolve(0))),
  );
  return counts.reduce((t, n) => t + n, 0);
}

/**
 * BUD-01@PoC FR 12, FR 13, AC 19, AC 23; BUD-02@PoC FR 23: the exact reason of the delete dialog — every kind of data
 * that holds the category with its count — and its budget entries, which are deleted with it (AC 22).
 */
export async function categoryUsage(
  usage: readonly CategoryUsage[],
  tx: CategoriesTx,
  householdId: string,
  categoryId: string,
): Promise<CategoryUsageReport> {
  const limits = usage.find((u) => u.limits)?.limits;
  const [transactions, holds, mergedCategories, budget] = await Promise.all([
    transactionCount(usage, householdId, categoryId),
    Promise.all(
      usage.map((u): Promise<Partial<Record<HoldKind, number>>> =>
        u.holds ? u.holds(householdId, categoryId) : Promise.resolve({}),
      ),
    ),
    tx.mergedCount(householdId, categoryId),
    limits ? limits.entries(householdId, categoryId) : Promise.resolve(NO_BUDGET_ENTRIES),
  ]);
  const sum = (kind: HoldKind) => holds.reduce((t, h) => t + (h[kind] ?? 0), 0);
  return {
    transactions,
    rules: sum("rules"),
    recurringPayments: sum("recurringPayments"),
    mergedCategories,
    budget,
  };
}

/**
 * FR 12: which of `categories` the menu offers «Видалити» for — custom, in the tree and held by no data (a limit or
 * «План» cells do not hold it: owner decision 2026-11-26, the delete confirms them).
 */
export async function deletableIds(
  usage: readonly CategoryUsage[],
  tx: CategoriesTx,
  householdId: string,
  categories: readonly StoredCategory[],
): Promise<ReadonlySet<string>> {
  const custom = categories.filter((c) => c.systemKey === null && c.state !== "retired").map((c) => c.id);
  const used = await categoriesInUse(usage, tx, householdId, custom);
  return new Set(custom.filter((id) => !used.has(id)));
}

/**
 * FR 12: delete a custom category no data holds (AC18); one held is refused with every reason and its count, and
 * nothing changes (AC19, AC23); a system one never (FR 3). Its limit and «План» cells do not hold it (owner decision
 * 2026-11-26, AC22): unconfirmed (`confirmLimit` false) the request is refused naming them; confirmed, module budget
 * removes them first (its own transaction, with its audit entries; finished periods' snapshots stay), then the row
 * goes. The row stays locked while the modules are asked, so a merge into it waits and then finds it gone. One audit
 * entry `delete` with the fields before and the budget entries removed. A record another module saves with the
 * category after its check and before this commit is the residual race of a check across modules (README «Порядок
 * однієї зміни»); a failure after the budget's commit leaves the category without its limit — as «Прибрати з бюджету».
 */
export async function deleteCategory(
  deps: CategoriesDeps,
  usage: readonly CategoryUsage[],
  tx: CategoriesTx,
  caller: Caller,
  categoryId: string,
  confirmLimit = false,
): Promise<Result<StoredCategory>> {
  const before = await tx.category(caller.householdId, categoryId, true);
  if (!before || before.state === "retired") return { kind: "not-found" };
  const used =
    before.systemKey === null &&
    (await categoriesInUse(usage, tx, caller.householdId, [before.id])).has(before.id);
  const problem = deleteProblem(before, used);
  if (problem === "system") return { kind: "system-fixed" };
  if (problem === "not_empty")
    return { kind: "not-empty", usage: await categoryUsage(usage, tx, caller.householdId, before.id) };
  const limits = usage.find((u) => u.limits)?.limits;
  let removed = NO_BUDGET_ENTRIES;
  if (limits && (await limits.held(caller.householdId, [before.id])).has(before.id)) {
    // Rows without a value (a «План» cell back to its default) need no confirmation; they go all the same.
    const report = await categoryUsage(usage, tx, caller.householdId, before.id);
    if (!confirmLimit && hasBudgetEntries(report.budget)) return { kind: "confirm-limit", usage: report };
    removed = await limits.release(caller, before.id);
  }
  await tx.deleteCategory(caller.householdId, before.id);
  await deps.audit.changed(
    caller.householdId,
    caller,
    { type: "categories.category", id: before.id },
    "delete",
    { ...categoryValues(before), ...(hasBudgetEntries(removed) ? budgetValues(removed) : {}) },
    null,
  );
  return ok(before);
}

/** FR 12: the budget entries a delete removed, in its audit entry (П-10). */
const budgetValues = (b: CategoryBudgetEntries): AuditValues => ({
  limit: b.limit ? `${b.limit.amount} ${b.limit.currency}` : null,
  planCells: String(b.planCells),
});
