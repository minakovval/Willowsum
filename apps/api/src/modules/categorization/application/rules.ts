import { Money } from "@willowsum/domain-kernel";
import {
  conditionKey,
  moved,
  proposalApplies,
  RULES_MAX,
  ruleMatches,
  rulesFor,
  UNCATEGORIZED,
  categoryAllowed,
  type RankedRule,
  type RuleAttention,
  type RuleCondition,
  type RuleMatcher,
  type RuleSubject,
  type TransactionCategory,
} from "../domain/index.ts";
import { auditKey } from "./hand-off.ts";
import { writeCategory, type CategorizationTx, type CategoryFactsPort } from "./transaction-categories.ts";

/**
 * Category rules (BUD-14@PoC FR 4, FR 5, FR 7 «Показати», FR 8–FR 13; AC7–AC9, AC12, AC14; wave 2 row 23): the space's
 * rules in priority order, a new transaction through them, and the existing transactions a rule would match. Applying a
 * rule to the existing transactions («Застосувати до N наявних…», FR 7) and the tags action come in the next slice.
 *
 * Order of one change (ARC-04, ADR-0015): checks through other modules (category, accounts) → in this module's
 * transaction under the space's rules lock: the rows and the audit job (`categorization.audit`) → commit → the entry
 * right away (adapters/http). A new transaction's rules run in the job of its event (`transactions.created`).
 */

export interface StoredRule extends RankedRule {
  readonly tags: readonly string[];
  readonly position: number;
  readonly version: number;
  /** When the rule was saved (UTC, microseconds, as `RuleInputRow.createdAt`); absent on a rule not read back yet. */
  readonly createdAt?: string;
}

/** A rule as written: conditions, «Лише для рахунків», category, «Увімкнено». */
export interface RuleFields extends RuleMatcher {
  readonly categoryId: string;
  readonly enabled: boolean;
  /** FR 5: «Додатково» → «Теги» — the tags the rule adds, by name; empty — none. */
  readonly tags: readonly string[];
}

/** The audit entry of a change, carried by the job `categorization.audit` (no free text: conditions are masked). */
export interface AuditHandOff {
  readonly key: string;
  /** The account that made the change; null — the system (a rule applied to a new transaction). */
  readonly actorAccountId: string | null;
  readonly entity:
    | "categorization.rule"
    | "categorization.transaction-category"
    | "categorization.rule-run"
    // BUD-21 FR 26: «запуск виведення» правил з файлу історії.
    | "categorization.history-derivation";
  readonly entityId: string;
  readonly action: "create" | "update" | "delete";
  readonly changes: { field: string; before: string | null; after: string | null; sensitive: boolean }[];
}

/** The rules part of the categorization schema, in one transaction of the module (adapters/db/rules.ts). */
export interface RulesTx {
  /** The space's lock of its rules until the transaction ends: one create, change or move at a time. */
  lockRules(householdId: string): Promise<void>;
  /** The space's rules in priority order (position 1 first). */
  rules(householdId: string): Promise<StoredRule[]>;
  insertRule(householdId: string, rule: StoredRule, key: string): Promise<void>;
  updateRule(householdId: string, rule: StoredRule, key: string): Promise<void>;
  /** Renumbers the rules: `ids[i]` gets the position i + 1; each one whose position changes gets its next version. */
  setOrder(householdId: string, ids: readonly string[]): Promise<void>;
  /** FR 15: the rule goes; the transactions it categorized or tagged keep their values without the reference. */
  deleteRule(householdId: string, id: string): Promise<void>;
  /** FR 11: the highest-priority other rule with these conditions; null — none. */
  sameConditions(householdId: string, key: string, exceptId: string): Promise<string | null>;
  /** «Застосовано: N транзакцій»: per rule, how many transactions have the category it set now. */
  appliedCounts(householdId: string): Promise<ReadonlyMap<string, number>>;
  /** FR 10: the rules of `sourceId` take `targetId`; returns how many. */
  moveRules(householdId: string, sourceId: string, targetId: string): Promise<number>;
  enqueueAudit(householdId: string, handOff: AuditHandOff): Promise<void>;
}

/** A transaction as module transactions gives it to the rules (`TransactionRuleInputs`). */
export interface RuleInputRow {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  readonly amount: string;
  readonly currency: string;
  readonly counterparty: string | null;
  readonly eligible: boolean;
  /** When the transaction was saved (UTC, microseconds). */
  readonly createdAt?: string;
}

export interface RuleDeps {
  readonly categories: CategoryFactsPort;
  /** Whether the account is one of the space's (module accounts' directory). */
  readonly accounts: { exists(householdId: string, accountId: string): Promise<boolean> };
  /** The shown merchant name of each counterparty that has one (module merchants' directory). */
  readonly merchants: {
    names(householdId: string, counterparties: readonly string[]): Promise<ReadonlyMap<string, string>>;
    /** As `names`, read only: a description seen for the first time has the name its merchant would be born with. */
    knownNames(householdId: string, counterparties: readonly string[]): Promise<ReadonlyMap<string, string>>;
  };
  /**
   * FR 5, FR 7, FR 9: a rule's tags on a transaction (module transactions' `TransactionRuleTags`); absent — the rules
   * add no tags.
   */
  readonly tags?: RuleTagsPort;
  readonly inputs: {
    inputs(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, RuleInputRow>>;
    candidates(
      householdId: string,
      limit: number,
    ): Promise<{ readonly items: readonly RuleInputRow[]; readonly more: boolean }>;
  };
}

export interface RuleTagsPort {
  addTags(
    householdId: string,
    transactionId: string,
    names: readonly string[],
    actorAccountId: string | null,
  ): Promise<
    | { readonly kind: "changed"; readonly before: string[]; readonly after: string[] }
    | { readonly kind: "unchanged" }
    | { readonly kind: "refused" }
  >;
  restoreTags(
    householdId: string,
    transactionId: string,
    expected: readonly string[],
    next: readonly string[],
    actorAccountId: string,
  ): Promise<"restored" | "changed">;
}

/** Stands for the conditions in the job and the entry: they may name a person (a bank description), so masked. */
const CHANGED = "changed";

const accountsOf = (rule: RuleMatcher) => [
  ...new Set([
    ...rule.accountIds,
    ...rule.conditions.flatMap((c) => (c.field === "account" ? [c.value] : [])),
  ]),
];

/** FR 10, AC7: why a rule is skipped until it is edited — its category or one of its accounts is gone; null — none. */
export async function attentionOf(
  deps: Pick<RuleDeps, "categories" | "accounts">,
  householdId: string,
  rule: RuleFields,
): Promise<RuleAttention | null> {
  if (!categoryAllowed(await deps.categories.category(householdId, rule.categoryId)))
    return "category_deleted";
  for (const accountId of accountsOf(rule))
    if (!(await deps.accounts.exists(householdId, accountId))) return "account_deleted";
  return null;
}

export type RuleIssue = { readonly path: string; readonly issue: "not_found" };

/** The checks of a create or a change that read other modules — before the categorization transaction (ARC-04). */
export async function checkRule(
  deps: Pick<RuleDeps, "categories" | "accounts">,
  householdId: string,
  rule: Partial<RuleFields>,
): Promise<RuleIssue | null> {
  if (
    rule.categoryId !== undefined &&
    !categoryAllowed(await deps.categories.category(householdId, rule.categoryId))
  )
    return { path: "categoryId", issue: "not_found" };
  for (const accountId of rule.accountIds ?? [])
    if (!(await deps.accounts.exists(householdId, accountId)))
      return { path: "accountIds", issue: "not_found" };
  for (const [i, c] of (rule.conditions ?? []).entries())
    if (c.field === "account" && !(await deps.accounts.exists(householdId, c.value)))
      return { path: `conditions.${i}.value`, issue: "not_found" };
  return null;
}

export type RuleResult =
  | {
      readonly kind: "ok";
      readonly rule: StoredRule;
      readonly duplicateOf: string | null;
      readonly audit: AuditHandOff | null;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "limit" }
  | { readonly kind: "invalid"; readonly path: string; readonly issue: "out_of_range" };

/** The conditions and accounts as written (a change of the text's case is a change, unlike `conditionKey`). */
const written = (rule: RuleMatcher) =>
  JSON.stringify([
    rule.conditions.map((c) =>
      c.field === "amount"
        ? [c.field, c.operator, c.value.toDecimalString(), c.value.currency]
        : [c.field, c.operator, c.value],
    ),
    [...rule.accountIds].sort(),
  ]);

/** The tags of a rule are free text: masked like the conditions. */
const conditionsAudit = (before: RuleMatcher | null, after: RuleMatcher) =>
  before === null || written(before) !== written(after)
    ? [{ field: "conditions", before: before === null ? null : CHANGED, after: CHANGED, sensitive: true }]
    : [];

function ruleChanges(before: StoredRule | null, after: StoredRule): AuditHandOff["changes"] {
  const plain: AuditHandOff["changes"] = [
    {
      field: "position",
      before: before?.position.toString() ?? null,
      after: after.position.toString(),
      sensitive: false,
    },
    { field: "categoryId", before: before?.categoryId ?? null, after: after.categoryId, sensitive: false },
    {
      field: "accountIds",
      before: before === null ? null : [...before.accountIds].sort().join(","),
      after: [...after.accountIds].sort().join(","),
      sensitive: false,
    },
    {
      field: "enabled",
      before: before === null ? null : String(before.enabled),
      after: String(after.enabled),
      sensitive: false,
    },
  ];
  const tags =
    before === null ? after.tags.length > 0 : JSON.stringify(before.tags) !== JSON.stringify(after.tags);
  return [
    ...conditionsAudit(before, after),
    ...(tags
      ? [{ field: "tags", before: before === null ? null : CHANGED, after: CHANGED, sensitive: true }]
      : []),
    ...plain.filter((c) => c.before !== c.after),
  ];
}

function ruleAudit(
  actorAccountId: string | null,
  before: StoredRule | null,
  after: StoredRule,
): AuditHandOff {
  return {
    key: `categorization.rule:${after.id}:${after.version}`,
    actorAccountId,
    entity: "categorization.rule",
    entityId: after.id,
    action: before === null ? "create" : "update",
    changes: ruleChanges(before, after),
  };
}

/**
 * FR 10 («Категорію об'єднано»): the rules of `sourceId` take `targetId`, under the space's rules lock (a change by
 * hand then reads the version after this one), and each rewritten rule has a system entry in the audit log
 * (`actorAccountId` null). Returns how many.
 */
export async function moveRulesToCategory(
  tx: Pick<RulesTx, "lockRules" | "rules" | "moveRules" | "enqueueAudit">,
  householdId: string,
  sourceId: string,
  targetId: string,
): Promise<number> {
  await tx.lockRules(householdId);
  const before = new Map(
    (await tx.rules(householdId)).filter((r) => r.categoryId === sourceId).map((r) => [r.id, r]),
  );
  if (before.size === 0) return 0;
  const moved = await tx.moveRules(householdId, sourceId, targetId);
  for (const after of await tx.rules(householdId)) {
    const was = before.get(after.id);
    if (was && after.version !== was.version) await tx.enqueueAudit(householdId, ruleAudit(null, was, after));
  }
  return moved;
}

/** «Нове правило» (FR 4): the lowest priority — the last position; at most `RULES_MAX` in a space. */
export async function createRule(
  tx: RulesTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly id: string;
    readonly fields: RuleFields;
  },
): Promise<RuleResult> {
  await tx.lockRules(input.householdId);
  const rules = await tx.rules(input.householdId);
  if (rules.length >= RULES_MAX) return { kind: "limit" };
  const rule: StoredRule = { id: input.id, ...input.fields, position: rules.length + 1, version: 1 };
  const key = conditionKey(rule);
  await tx.insertRule(input.householdId, rule, key);
  const audit = ruleAudit(input.actorAccountId, null, rule);
  await tx.enqueueAudit(input.householdId, audit);
  return { kind: "ok", rule, duplicateOf: await tx.sameConditions(input.householdId, key, rule.id), audit };
}

/** «Змінити правило» and «Увімкнено» (FR 4): only new transactions see the change (FR 7); nothing — no change. */
export async function updateRule(
  tx: RulesTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly id: string;
    readonly fields: Partial<RuleFields>;
  },
): Promise<RuleResult> {
  await tx.lockRules(input.householdId);
  const current = (await tx.rules(input.householdId)).find((r) => r.id === input.id);
  if (!current) return { kind: "not-found" };
  const next: StoredRule = { ...current, ...input.fields, version: current.version + 1 };
  const key = conditionKey(next);
  const changes = ruleChanges(current, next);
  if (changes.length === 0)
    return {
      kind: "ok",
      rule: current,
      duplicateOf: await tx.sameConditions(input.householdId, key, current.id),
      audit: null,
    };
  await tx.updateRule(input.householdId, next, key);
  const audit = ruleAudit(input.actorAccountId, current, next);
  await tx.enqueueAudit(input.householdId, audit);
  return {
    kind: "ok",
    rule: next,
    duplicateOf: await tx.sameConditions(input.householdId, key, next.id),
    audit,
  };
}

/**
 * FR 4, AC14: «#» drag and «Вище» / «Нижче» — the rule takes `position` (1 — the highest priority), the others shift.
 * Past rules keep their categories (FR 7). The entry records the moved rule's position.
 */
export async function moveRule(
  tx: RulesTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly id: string;
    readonly position: number;
  },
): Promise<
  | { readonly kind: "ok"; readonly rules: StoredRule[]; readonly audit: AuditHandOff | null }
  | Exclude<RuleResult, { kind: "ok" } | { kind: "limit" }>
> {
  await tx.lockRules(input.householdId);
  const rules = await tx.rules(input.householdId);
  const current = rules.find((r) => r.id === input.id);
  if (!current) return { kind: "not-found" };
  if (input.position > rules.length) return { kind: "invalid", path: "position", issue: "out_of_range" };
  if (current.position === input.position) return { kind: "ok", rules, audit: null };
  const order = moved(
    rules.map((r) => r.id),
    input.id,
    input.position,
  );
  await tx.setOrder(input.householdId, order);
  const after = await tx.rules(input.householdId);
  const audit = ruleAudit(
    input.actorAccountId,
    current,
    after.find((r) => r.id === input.id)!,
  );
  await tx.enqueueAudit(input.householdId, audit);
  return { kind: "ok", rules: after, audit };
}

/**
 * «Видалити» (FR 15, AC17): the rule goes, the others keep their order (positions 1…n again); the transactions it
 * categorized or tagged keep their category and tags without «за правилом №…». The entry: `delete` with the fields
 * before (conditions and tags masked).
 */
export async function deleteRule(
  tx: RulesTx,
  input: { readonly householdId: string; readonly actorAccountId: string; readonly id: string },
): Promise<{ readonly kind: "ok"; readonly audit: AuditHandOff } | { readonly kind: "not-found" }> {
  await tx.lockRules(input.householdId);
  const rules = await tx.rules(input.householdId);
  const current = rules.find((r) => r.id === input.id);
  if (!current) return { kind: "not-found" };
  await tx.deleteRule(input.householdId, input.id);
  await tx.setOrder(
    input.householdId,
    rules.filter((r) => r.id !== input.id).map((r) => r.id),
  );
  const audit: AuditHandOff = {
    key: `categorization.rule.delete:${current.id}:${current.version}`,
    actorAccountId: input.actorAccountId,
    entity: "categorization.rule",
    entityId: current.id,
    action: "delete",
    changes: [
      { field: "conditions", before: CHANGED, after: null, sensitive: true },
      ...(current.tags.length > 0 ? [{ field: "tags", before: CHANGED, after: null, sensitive: true }] : []),
      { field: "position", before: current.position.toString(), after: null, sensitive: false },
      { field: "categoryId", before: current.categoryId, after: null, sensitive: false },
      { field: "enabled", before: String(current.enabled), after: null, sensitive: false },
    ],
  };
  await tx.enqueueAudit(input.householdId, audit);
  return { kind: "ok", audit };
}

/** A rule as «Правила категорій» lists it (FR 4, FR 10). */
export interface ListedRule {
  readonly rule: StoredRule;
  readonly attention: RuleAttention | null;
  readonly appliedCount: number;
}

/** The lookups of other modules once per category and account within one call. */
export function memoized(
  deps: Pick<RuleDeps, "categories" | "accounts">,
): Pick<RuleDeps, "categories" | "accounts"> {
  const categories = new Map<string, ReturnType<RuleDeps["categories"]["category"]>>();
  const accounts = new Map<string, Promise<boolean>>();
  return {
    categories: {
      category: (householdId, id) => {
        if (!categories.has(id)) categories.set(id, deps.categories.category(householdId, id));
        return categories.get(id)!;
      },
    },
    accounts: {
      exists: (householdId, id) => {
        if (!accounts.has(id)) accounts.set(id, deps.accounts.exists(householdId, id));
        return accounts.get(id)!;
      },
    },
  };
}

export async function listRules(
  tx: RulesTx,
  rawDeps: Pick<RuleDeps, "categories" | "accounts">,
  householdId: string,
): Promise<ListedRule[]> {
  const deps = memoized(rawDeps);
  const rules = await tx.rules(householdId);
  const counts = await tx.appliedCounts(householdId);
  const listed: ListedRule[] = [];
  for (const rule of rules)
    listed.push({
      rule,
      attention: await attentionOf(deps, householdId, rule),
      appliedCount: counts.get(rule.id) ?? 0,
    });
  return listed;
}

const subjectOf = (row: RuleInputRow, names: ReadonlyMap<string, string>): RuleSubject => ({
  merchant: row.counterparty === null ? null : (names.get(row.counterparty) ?? null),
  description: row.counterparty,
  amount: Money.of(row.amount, row.currency),
  accountId: row.accountId,
});

async function namesOf(
  deps: Pick<RuleDeps, "merchants">,
  householdId: string,
  rows: readonly RuleInputRow[],
  readOnly = false,
) {
  const counterparties = [...new Set(rows.flatMap((r) => (r.counterparty === null ? [] : [r.counterparty])))];
  return counterparties.length === 0
    ? new Map<string, string>()
    : readOnly
      ? deps.merchants.knownNames(householdId, counterparties)
      : deps.merchants.names(householdId, counterparties);
}

/** «Показати» (FR 7, AC2, AC12): at most this many of the matching transactions are listed, newest first. */
export const MATCHES_LISTED = 100;

export interface Matches {
  readonly count: number;
  /** The sum of the matching amounts per currency, signed (no conversion). */
  readonly totals: readonly Money[];
  readonly items: readonly RuleInputRow[];
  /** Every matching transaction, newest first: what «Застосувати до N наявних…» changes. */
  readonly ids: readonly string[];
  /** The space has more transactions than `scanMax`: only the newest were matched. */
  readonly truncated: boolean;
}

/**
 * FR 7 «Показати» and the count of «Застосувати до N наявних транзакцій, що підходять»: the eligible transactions the
 * conditions match — among the newest `scanMax` of the space. Writes nothing.
 */
export async function matchingTransactions(
  deps: Pick<RuleDeps, "merchants" | "inputs">,
  householdId: string,
  matcher: RuleMatcher,
  scanMax: number,
): Promise<Matches> {
  const { items, more } = await deps.inputs.candidates(householdId, scanMax);
  // Read permission: no merchant is born here; a merchant not known yet is matched by the name it would be born with.
  const names = await namesOf(deps, householdId, items, true);
  const matching = items.filter((row) => ruleMatches(matcher, subjectOf(row, names)));
  const totals = new Map<string, Money>();
  for (const row of matching) {
    const amount = Money.of(row.amount, row.currency);
    totals.set(row.currency, (totals.get(row.currency) ?? Money.zero(row.currency)).plus(amount));
  }
  return {
    count: matching.length,
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    items: matching.slice(0, MATCHES_LISTED),
    ids: matching.map((r) => r.id),
    truncated: more,
  };
}

/**
 * FR 8, FR 9, FR 10, AC3, AC7, AC9, AC12: a new transaction through the rules — each attribute from the first enabled
 * rule that matches, needs no attention and sets it: the category «за правилом», unless the transaction has a category
 * of a higher source by now (a change by hand wins, FR 9), and the tags (added after its own, whatever its category).
 * Run by the job of `transactions.created` in its categorization transaction; running it again changes nothing more.
 * A transaction gone, hidden, split, merged or a side of a transfer takes nothing.
 */
export async function applyRulesToNew(
  tx: CategorizationTx,
  rulesTx: RulesTx,
  deps: RuleDeps,
  householdId: string,
  transactionId: string,
): Promise<"applied" | "none" | "conflict"> {
  const row = (await deps.inputs.inputs(householdId, [transactionId])).get(transactionId);
  if (!row || !row.eligible) return "none";
  // FR 7: a rule saved after the transaction is not its rule, even when this job runs late (a retry, the daily
  // recovery of a dead job): past transactions change only through «Застосувати до N наявних…».
  const rules = (await rulesTx.rules(householdId)).filter(
    (r) =>
      r.enabled && (r.createdAt === undefined || row.createdAt === undefined || r.createdAt <= row.createdAt),
  );
  if (rules.length === 0) return "none";
  const subject = subjectOf(row, await namesOf(deps, householdId, [row]));
  const lookups = memoized(deps);
  const chosen = await rulesFor(rules, subject, (r) => attentionOf(lookups, householdId, r));
  let applied = false;
  // The tags first, in their own transactions transaction: a retry finds them there and adds nothing.
  if (chosen.tags !== null && deps.tags) {
    const tagged = await deps.tags.addTags(householdId, transactionId, chosen.tags.tags, null);
    const current = await tx.lock(householdId, transactionId);
    if (tagged.kind !== "refused" && current?.tagRuleId !== chosen.tags.id) {
      await tx.setTagRule(householdId, transactionId, chosen.tags.id);
      applied = true;
    }
  }
  const rule = chosen.category;
  if (rule === null) return applied ? "applied" : "none";
  const next: TransactionCategory & { ruleId: string } = {
    categoryId: rule.categoryId,
    source: "rule",
    ruleId: rule.id,
  };
  const current = (await tx.lock(householdId, transactionId)) ?? UNCATEGORIZED;
  if (
    !proposalApplies(current, next) ||
    (current.categoryId === next.categoryId && current.source === "rule")
  )
    return applied ? "applied" : "none";
  const outcome = await writeCategory(tx, householdId, transactionId, next);
  if (outcome.kind === "conflict") return "conflict";
  if (outcome.kind === "unchanged") return applied ? "applied" : "none";
  await rulesTx.enqueueAudit(householdId, categoryAudit(null, transactionId, outcome, next));
  return "applied";
}

/** The entry of a category a rule set (the system's on a new transaction, the user's in a run or its undo). */
export function categoryAudit(
  actorAccountId: string | null,
  transactionId: string,
  outcome: Extract<Awaited<ReturnType<typeof writeCategory>>, { kind: "changed" }>,
  next: TransactionCategory & { readonly ruleId?: string | null },
): AuditHandOff {
  return {
    key: auditKey({ transactionId, version: outcome.row.version }),
    actorAccountId,
    entity: "categorization.transaction-category",
    entityId: transactionId,
    action: "update",
    changes: [
      { field: "categoryId", before: outcome.before.categoryId, after: next.categoryId, sensitive: false },
      { field: "source", before: outcome.before.source, after: next.source, sensitive: false },
      {
        field: "ruleId",
        before: (outcome.before as { ruleId?: string | null }).ruleId ?? null,
        after: next.ruleId ?? null,
        sensitive: false,
      },
    ].filter((c) => c.before !== c.after),
  };
}

export type { RuleCondition };

/** The space's audit log as the rules write it (П-10): `record` of the audit module's `AuditLog`. */
export interface RulesAuditLog {
  record(
    householdId: string,
    entry: {
      readonly actor: { readonly kind: "user"; readonly id: string } | { readonly kind: "system" };
      readonly channel: "web" | "system";
      readonly entity: { readonly type: string; readonly id: string };
      readonly action: "create" | "update" | "delete";
      readonly changes: AuditHandOff["changes"];
      readonly key: string;
    },
  ): Promise<unknown>;
}

/** Writes the entry of a hand-off; it can run again (the entry is keyed). Throws if the write fails (a retry). */
export async function applyAudit(
  audit: RulesAuditLog,
  householdId: string,
  handOff: AuditHandOff,
): Promise<void> {
  await audit.record(householdId, {
    actor:
      handOff.actorAccountId === null ? { kind: "system" } : { kind: "user", id: handOff.actorAccountId },
    channel: handOff.actorAccountId === null ? "system" : "web",
    entity: { type: handOff.entity, id: handOff.entityId },
    action: handOff.action,
    changes: handOff.changes.map((c) => ({ ...c })),
    key: handOff.key,
  });
}
