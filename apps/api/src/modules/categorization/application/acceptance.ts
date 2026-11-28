import {
  acceptanceOrder,
  againstRules,
  conditionKey,
  descriptionsDiffer,
  isTransferCategory,
  ruleConditions,
  ruleMatches,
  RULES_MAX,
  suggestionKey,
  type CategoryFacts,
  type RuleCondition,
  type RuleMatcher,
} from "../domain/index.ts";
import {
  rejectionKey,
  type DerivationRun,
  type DerivationsTx,
  type StoredSuggestion,
} from "./derivations.ts";
import {
  createRule,
  namesOf,
  subjectOf,
  type AuditHandOff,
  type RuleDeps,
  type RulesTx,
  type StoredRule,
} from "./rules.ts";
import type { ItemRule, RunRow, RunsTx } from "./runs.ts";
import type { CategoryFactsPort } from "./transaction-categories.ts";

/**
 * The suggestions of a derivation against the space, their acceptance and their rejection (BUD-21@PoC FR 18–20, FR 22,
 * FR 23, EC8; BUD-14@PoC FR 16; wave 2 row 237).
 *
 * A suggestion is shown unless it was rejected (FR 23) or a rule of the space has its conditions and category (FR 20);
 * one with the conditions of a rule and another category is marked as conflicting with that rule and not selected.
 * A suggestion whose category was merged away goes to the target category; one whose category was deleted is shown
 * with that fact and cannot be accepted (EC8). The acceptance writes ordinary category rules «з історії» below every
 * existing rule, in the order of FR 20, and — with «Застосувати до наявних» — one run of them over the existing
 * transactions they match (each record by the first accepted rule that sets it), up to 500 at once, the rest in the
 * background, with «Відмінити» for 7 days (application/runs.ts).
 */

/** A suggestion as the page «Пропозиції правил» shows it. */
export interface ShownSuggestion extends StoredSuggestion {
  /** FR 20, FR 23: the canonical key of its conditions. */
  readonly key: string;
  /** EC8: the target of a merge of its category, else its own category. */
  readonly categoryId: string;
  /** EC8: its category was deleted — the acceptance refuses it. */
  readonly categoryDeleted: boolean;
  /** FR 16: the group «Переказ» (the action «категорія „Переказ“»). */
  readonly transfer: boolean;
  /** FR 20, AC23: the rule of the space with the same conditions and another category; null — none. */
  readonly conflict: { readonly id: string; readonly position: number } | null;
  /** FR 21: selected by default — confident, no conflict with a rule, its category there. */
  readonly selected: boolean;
}

/** At most this many merges are followed from a suggestion's category to the category in use. */
const MERGE_HOPS = 8;

/** EC8: the category in use a merge moved `categoryId` to (or itself), with its facts; null facts — deleted. */
export async function resolveCategory(
  categories: CategoryFactsPort,
  householdId: string,
  categoryId: string,
): Promise<{ readonly id: string; readonly facts: CategoryFacts | null }> {
  let id = categoryId;
  let facts = await categories.category(householdId, id);
  for (let hop = 0; hop < MERGE_HOPS && facts?.state === "retired" && facts.mergedInto; hop++) {
    id = facts.mergedInto;
    facts = await categories.category(householdId, id);
  }
  return { id, facts: facts?.state === "retired" ? null : facts };
}

/** FR 20, FR 23, EC8: the suggestions of a derivation the page shows, in their order. */
export async function shownSuggestions(
  categories: CategoryFactsPort,
  householdId: string,
  stored: readonly StoredSuggestion[],
  rules: readonly StoredRule[],
  rejected: ReadonlySet<string>,
): Promise<ShownSuggestion[]> {
  const resolved = new Map<string, Promise<{ readonly id: string; readonly facts: CategoryFacts | null }>>();
  const shown: ShownSuggestion[] = [];
  for (const s of stored) {
    if (!resolved.has(s.categoryId))
      resolved.set(s.categoryId, resolveCategory(categories, householdId, s.categoryId));
    const category = await resolved.get(s.categoryId)!;
    const key = suggestionKey(s.conditions);
    if (rejected.has(rejectionKey(key, category.id)) || rejected.has(rejectionKey(key, s.categoryId)))
      continue;
    const verdict = againstRules(key, category.id, rules);
    if (verdict === "same") continue;
    const conflict = verdict === null ? null : { id: verdict.id, position: verdict.position };
    shown.push({
      ...s,
      key,
      categoryId: category.id,
      categoryDeleted: category.facts === null,
      transfer: isTransferCategory(category.facts),
      conflict,
      selected: s.kind === "confident" && conflict === null && category.facts !== null,
    });
  }
  return shown;
}

/** FR 19: what the suggestions match among the existing transactions of the space. */
export interface ExistingMatches {
  /** Per suggestion (by the index of the list given), how many existing transactions its conditions match. */
  readonly counts: readonly number[];
  /** The transactions of the space imported from statements (among those read). */
  readonly imported: number;
  /** Of them, how many any suggestion matches. */
  readonly matchedImported: number;
  /** AC21: «описи у файлі, схоже, відрізняються від описів банку». */
  readonly descriptionsDiffer: boolean;
  /** Only the newest `scanMax` transactions were read (as «Показати» of the rules). */
  readonly truncated: boolean;
}

const fold = (text: string) => text.trim().toLowerCase();

/** The matchers of a list of conditions, indexed by the merchant of «Мерчант дорівнює» (most suggestions have it). */
function indexed(matchers: readonly RuleMatcher[]) {
  const byMerchant = new Map<string, number[]>();
  const others: number[] = [];
  matchers.forEach((m, i) => {
    const merchant = m.conditions.find((c) => c.field === "merchant" && c.operator === "equals");
    if (merchant && merchant.field === "merchant") {
      const list = byMerchant.get(fold(merchant.value));
      if (list) list.push(i);
      else byMerchant.set(fold(merchant.value), [i]);
    } else others.push(i);
  });
  return (merchant: string | null): number[] => {
    const own = merchant === null ? [] : (byMerchant.get(fold(merchant)) ?? []);
    return own.length === 0 ? others : [...own, ...others].sort((a, b) => a - b);
  };
}

/**
 * FR 19, AC21: each suggestion's count of the existing transactions of the space its conditions match (the eligible
 * ones a rule may categorize, the newest `scanMax`, as «Показати»), and the warning about the descriptions. Read only:
 * no merchant is born. The space is the caller's (PoC: the Owner, every transaction).
 */
export async function existingMatches(
  deps: Pick<RuleDeps, "merchants" | "inputs">,
  householdId: string,
  conditions: readonly (readonly RuleCondition[])[],
  scanMax: number,
): Promise<ExistingMatches> {
  const { items, more } = await deps.inputs.candidates(householdId, scanMax);
  const names = await namesOf(deps, householdId, items, true);
  const matchers = conditions.map((c) => ({ conditions: c, accountIds: [] as string[] }));
  const of = indexed(matchers);
  const counts = matchers.map(() => 0);
  let imported = 0;
  let matchedImported = 0;
  for (const row of items) {
    const subject = subjectOf(row, names);
    let any = false;
    for (const i of of(subject.merchant))
      if (ruleMatches(matchers[i]!, subject)) {
        counts[i]! += 1;
        any = true;
      }
    if (row.imported) {
      imported += 1;
      if (any) matchedImported += 1;
    }
  }
  return {
    counts,
    imported,
    matchedImported,
    descriptionsDiffer: descriptionsDiffer(imported, matchedImported),
    truncated: more,
  };
}

/** A suggestion to accept, as the page sends it: its ordinal and, after the pencil (FR 21), the changed rule. */
export interface AcceptItem {
  readonly ordinal: number;
  readonly edited?: {
    readonly conditions: readonly RuleCondition[];
    readonly accountIds: readonly string[];
    readonly categoryId: string;
    readonly tags: readonly string[];
  };
}

/** A suggestion ready to become a rule: the rule's fields and the numbers FR 20 orders by. */
export interface AcceptedRule extends RuleMatcher {
  readonly id: string;
  readonly ordinal: number;
  readonly categoryId: string;
  readonly tags: readonly string[];
  readonly matched: number;
  readonly rows: readonly number[];
  readonly transfer: boolean;
}

export type AcceptIssue =
  | { readonly kind: "invalid"; readonly path: string; readonly issue: "not_found" | "duplicate" }
  | { readonly kind: "category-deleted"; readonly ordinal: number };

/**
 * FR 22, FR 20, EC8: the rules the acceptance writes, in their order — each from a shown suggestion (or the pencil's
 * change of it); a suggestion whose category was deleted — refused; one whose category was merged — the target's.
 * `checkEdited` is the rule editor's check of a changed rule (category, accounts).
 */
export async function acceptedRules(
  shown: readonly ShownSuggestion[],
  items: readonly AcceptItem[],
  newId: () => string,
  checkEdited: (
    edited: NonNullable<AcceptItem["edited"]>,
    suggestion: ShownSuggestion,
  ) => Promise<{ readonly path: string; readonly issue: "not_found" } | null>,
): Promise<{ readonly rules: AcceptedRule[] } | AcceptIssue> {
  const byOrdinal = new Map(shown.map((s) => [s.ordinal, s]));
  const seen = new Set<number>();
  const rules: AcceptedRule[] = [];
  for (const [i, item] of items.entries()) {
    const s = byOrdinal.get(item.ordinal);
    if (!s) return { kind: "invalid", path: `suggestions.${i}.ordinal`, issue: "not_found" };
    if (seen.has(item.ordinal))
      return { kind: "invalid", path: `suggestions.${i}.ordinal`, issue: "duplicate" };
    seen.add(item.ordinal);
    if (item.edited) {
      const issue = await checkEdited(item.edited, s);
      if (issue) return { kind: "invalid", path: `suggestions.${i}.${issue.path}`, issue: issue.issue };
    } else if (s.categoryDeleted) return { kind: "category-deleted", ordinal: s.ordinal };
    rules.push({
      id: newId(),
      ordinal: s.ordinal,
      conditions: item.edited ? item.edited.conditions : ruleConditions(s.conditions),
      accountIds: item.edited ? item.edited.accountIds : [],
      categoryId: item.edited ? item.edited.categoryId : s.categoryId,
      tags: item.edited ? item.edited.tags : s.tags,
      matched: s.matched,
      rows: s.rows,
      transfer: item.edited ? item.edited.categoryId === s.categoryId && s.transfer : s.transfer,
    });
  }
  return { rules: acceptanceOrder(rules) };
}

/** FR 22: what «Застосувати до наявних» of an acceptance changes — the records of its run. */
export interface AcceptancePlan {
  readonly transactionIds: readonly string[];
  readonly rules: readonly ItemRule[];
  /**
   * Lead decision (row 237): the existing transactions whose first accepted rule is «категорія „Переказ“» — left as
   * they are (no category, no flag); a new transaction is flagged as before (FR 16). Owner question in the PR.
   */
  readonly transfers: number;
  readonly truncated: boolean;
}

/**
 * FR 22, AC25: the existing transactions the accepted rules match, each by the first of them (in their order) that
 * sets its category and the first with tags that sets its tags (BUD-14 FR 8) — the rules being applied, as «Застосувати
 * до N наявних» of one rule (BUD-14 FR 7) applies its own. The manual categories are skipped by the run itself.
 */
export async function acceptancePlan(
  deps: Pick<RuleDeps, "merchants" | "inputs">,
  householdId: string,
  rules: readonly AcceptedRule[],
  scanMax: number,
): Promise<AcceptancePlan> {
  const { items, more } = await deps.inputs.candidates(householdId, scanMax);
  const names = await namesOf(deps, householdId, items, true);
  const transactionIds: string[] = [];
  const records: ItemRule[] = [];
  let transfers = 0;
  for (const row of items) {
    const subject = subjectOf(row, names);
    const matching = rules.filter((r) => ruleMatches(r, subject));
    const category = matching[0];
    if (!category) continue;
    if (category.transfer) {
      transfers += 1;
      continue;
    }
    const tags = matching.find((r) => r.tags.length > 0) ?? null;
    transactionIds.push(row.id);
    records.push({
      ruleId: category.id,
      categoryId: category.categoryId,
      tagRuleId: tags?.id ?? null,
      tags: tags?.tags ?? [],
    });
  }
  return { transactionIds, rules: records, transfers, truncated: more };
}

/** The acceptance's entry (FR 26): how many rules, whether applied — ids and counts only. */
function acceptanceAudit(
  derivationId: string,
  actorAccountId: string,
  rules: readonly StoredRule[],
  runId: string | null,
): AuditHandOff {
  return {
    key: `categorization.history-accept:${derivationId}:${rules[0]!.id}`,
    actorAccountId,
    entity: "categorization.history-derivation",
    entityId: derivationId,
    action: "update",
    changes: [
      { field: "accepted", before: null, after: String(rules.length), sensitive: false },
      ...(runId === null ? [] : [{ field: "runId", before: null, after: runId, sensitive: false }]),
    ],
  };
}

export type AcceptResult =
  | {
      readonly kind: "ok";
      readonly rules: readonly StoredRule[];
      readonly run: RunRow | null;
      readonly audit: readonly AuditHandOff[];
    }
  | { readonly kind: "limit" }
  | { readonly kind: "running" }
  /** A suggestion was accepted (or a rule with its conditions and category written) meanwhile: reload. */
  | { readonly kind: "changed" };

/** Rolls the acceptance back: another run of the space is running (one at a time). */
export class RunRunning extends Error {
  constructor() {
    super("Another run of the space is running");
    this.name = "RunRunning";
  }
}

/**
 * FR 22, FR 20: under the space's rules lock — each suggestion still not a rule's (else `changed`), at most
 * `RULES_MAX` rules — the rules «з історії» at the lowest priorities in the order given, the acceptance's entry and,
 * with a plan, its run with the first part's job (one run at a time in a space: else `running`, nothing written).
 * Throws inside the caller's transaction so a refused run takes the rules back with it.
 */
export async function acceptSuggestions(
  rulesTx: RulesTx,
  runsTx: RunsTx | null,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly derivationId: string;
    readonly rules: readonly AcceptedRule[];
    readonly plan: AcceptancePlan | null;
    readonly runId: string;
    readonly now: number;
  },
): Promise<AcceptResult> {
  const { householdId } = input;
  await rulesTx.lockRules(householdId);
  const existing = await rulesTx.rules(householdId);
  if (existing.length + input.rules.length > RULES_MAX) return { kind: "limit" };
  for (const r of input.rules)
    if (againstRules(conditionKey(r), r.categoryId, existing) === "same") return { kind: "changed" };
  const written: StoredRule[] = [];
  const audit: AuditHandOff[] = [];
  for (const r of input.rules) {
    const result = await createRule(rulesTx, {
      householdId,
      actorAccountId: input.actorAccountId,
      id: r.id,
      fields: {
        conditions: r.conditions,
        accountIds: r.accountIds,
        categoryId: r.categoryId,
        enabled: true,
        tags: r.tags,
        origin: "history",
      },
    });
    if (result.kind !== "ok") return { kind: "limit" };
    written.push(result.rule);
    if (result.audit) audit.push(result.audit);
  }
  let run: RunRow | null = null;
  if (input.plan && runsTx) {
    const first = written[0]!;
    run = {
      id: input.runId,
      ruleId: first.id,
      actorAccountId: input.actorAccountId,
      undoActorAccountId: null,
      categoryId: first.categoryId,
      tags: [],
      status: "running",
      truncated: input.plan.truncated,
      count: input.plan.transactionIds.length,
      createdAt: input.now,
      endedAt: null,
      derivationId: input.derivationId,
    };
    if (!(await runsTx.insertRun(householdId, run, input.plan.transactionIds, input.plan.rules)))
      throw new RunRunning();
    await runsTx.enqueuePart(householdId, run.id, "running", 0);
  }
  const entry = acceptanceAudit(input.derivationId, input.actorAccountId, written, run?.id ?? null);
  await rulesTx.enqueueAudit(householdId, entry);
  return { kind: "ok", rules: written, run, audit: [...audit, entry] };
}

/** FR 23, FR 26: the rejection's entry — the category, the conditions masked (they may name a person). */
export function rejectionAudit(
  derivationId: string,
  actorAccountId: string,
  suggestion: ShownSuggestion,
): AuditHandOff {
  return {
    key: `categorization.history-reject:${derivationId}:${suggestion.ordinal}`,
    actorAccountId,
    entity: "categorization.history-derivation",
    entityId: derivationId,
    action: "update",
    changes: [
      { field: "rejected", before: null, after: "1", sensitive: false },
      { field: "conditions", before: null, after: "changed", sensitive: true },
      { field: "categoryId", before: null, after: suggestion.categoryId, sensitive: false },
    ],
  };
}

/** FR 23: «Відхилити» — the suggestion is never shown again (also after the next file); false — rejected already. */
export async function rejectSuggestion(
  tx: Pick<DerivationsTx, "reject" | "enqueueAudit">,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly derivation: DerivationRun;
    readonly suggestion: ShownSuggestion;
    readonly now: number;
  },
): Promise<AuditHandOff | null> {
  const fresh = await tx.reject(input.householdId, {
    key: input.suggestion.key,
    categoryId: input.suggestion.categoryId,
    actorAccountId: input.actorAccountId,
    at: input.now,
  });
  if (!fresh) return null;
  const entry = rejectionAudit(input.derivation.id, input.actorAccountId, input.suggestion);
  await tx.enqueueAudit(input.householdId, entry);
  return entry;
}
