import { Money } from "@willowsum/domain-kernel";
import {
  categoryAllowed,
  firstRule,
  lastManualCategory,
  topCategories,
  type HistoryRow,
  type RuleSubject,
  type TopCategories,
} from "../domain/index.ts";
import { attentionOf, memoized, type RuleDeps, type StoredRule } from "./rules.ts";
import type { StoredTransactionCategory } from "./transaction-categories.ts";

/**
 * The category hints of «Нова транзакція» (FIN-03@PoC FR 30, FR 31; FR 15; wave 2 row 116, issue #438 — the server
 * part): for the counterparty being entered, the category the form fills in and the first group of the list
 * «Категорія»; for each known merchant of the space, the category the list «Контрагент» shows next to it. Read only:
 * nothing is written and no merchant is born. Every read is bound to the caller's space (П-5).
 *
 * The history is the newest `scanMax` shown transactions of the space (no side of a transfer, not split, merged into
 * none — the transactions the rules see, BUD-14 FR 7) with their categories. A category is offered only while it is in
 * use in the tree, not hidden and of the transaction's type («Витрата» / «Надходження»), when the form gives it.
 */

/** What the form knows so far: the counterparty typed or chosen, and from step 1 the account, amount and type. */
export interface SuggestionInput {
  readonly counterparty: string | null;
  readonly accountId: string | null;
  /** Without a sign: the type gives it (FR 28). */
  readonly amount: Money | null;
  readonly type: "expense" | "income" | null;
}

/** FR 30: the category the form fills in, and where it comes from (FR 15). */
export interface Suggestion {
  readonly categoryId: string;
  /** «за правилом» or «як раніше» (the last category set by hand for this merchant). */
  readonly source: "rule" | "merchant";
  /** BUD-14 FR 13: the rule and its place in the order; null unless `source` is «rule». */
  readonly rule: { readonly id: string; readonly position: number } | null;
}

export interface CategorySuggestions {
  /** The shown merchant name of the counterparty; null — no counterparty. */
  readonly merchant: string | null;
  /** FR 30: the category for the counterparty; null — none (no counterparty, no rule and no category by hand). */
  readonly suggestion: Suggestion | null;
  /** FR 31: «Часто для <мерчанта>» or «Нещодавні». */
  readonly top: TopCategories;
  /** FR 30: the known merchants of the space that have a category to show, by name. */
  readonly merchants: readonly { readonly name: string; readonly suggestion: Suggestion }[];
  /** The space has more transactions than are read at once: only the newest were looked at. */
  readonly truncated: boolean;
}

/** The categorization schema as the hints read it, in one transaction of the module bound to the space. */
export interface SuggestionsTx {
  read(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, StoredTransactionCategory>>;
  rules(householdId: string): Promise<StoredRule[]>;
}

const usesAccount = (r: StoredRule) =>
  r.accountIds.length > 0 || r.conditions.some((c) => c.field === "account");
const usesAmount = (r: StoredRule) => r.conditions.some((c) => c.field === "amount");

export async function categorySuggestions(
  rawDeps: RuleDeps,
  read: <T>(fn: (tx: SuggestionsTx) => Promise<T>) => Promise<T>,
  householdId: string,
  input: SuggestionInput,
  scanMax: number,
): Promise<CategorySuggestions> {
  const deps = { ...rawDeps, ...memoized(rawDeps) };
  const { items, more } = await rawDeps.inputs.candidates(householdId, scanMax);
  const counterparty = input.counterparty?.trim() || null;
  const counterparties = [
    ...new Set([
      ...items.flatMap((r) => (r.counterparty === null ? [] : [r.counterparty])),
      ...(counterparty === null ? [] : [counterparty]),
    ]),
  ];
  // Read only: a description seen for the first time has the name its merchant would be born with.
  const names =
    counterparties.length === 0
      ? new Map<string, string>()
      : await rawDeps.merchants.knownNames(householdId, counterparties);
  const { rows, rules } = await read(async (tx) => ({
    rows: await tx.read(
      householdId,
      items.map((r) => r.id),
    ),
    rules: await tx.rules(householdId),
  }));

  const history: HistoryRow[] = [];
  const known = new Set<string>();
  for (const item of items) {
    const merchant = item.counterparty === null ? null : (names.get(item.counterparty) ?? null);
    if (merchant !== null) known.add(merchant);
    const row = rows.get(item.id);
    if (row && row.categoryId !== null && row.source !== "none")
      history.push({ merchant, categoryId: row.categoryId, source: row.source });
  }

  const ids = new Set([...history.map((h) => h.categoryId), ...rules.map((r) => r.categoryId)]);
  const fitting = new Set<string>();
  for (const id of ids) {
    const facts = await deps.categories.category(householdId, id);
    if (
      categoryAllowed(facts) &&
      facts!.state !== "hidden" &&
      (input.type === null || facts!.kind === input.type)
    )
      fitting.add(id);
  }
  const fits = (id: string) => fitting.has(id);

  // Without the account or the amount, a rule that needs one cannot be said to match: it is left out.
  const applicable = rules.filter(
    (r) =>
      r.enabled && (input.accountId !== null || !usesAccount(r)) && (input.amount !== null || !usesAmount(r)),
  );
  const position = new Map(rules.map((r) => [r.id, r.position]));
  // A placeholder when there is no amount: no rule left in `applicable` reads it.
  const amount = input.amount ?? Money.zero("EUR");

  async function suggestionFor(merchant: string, description: string): Promise<Suggestion | null> {
    const subject: RuleSubject = { merchant, description, amount, accountId: input.accountId ?? "" };
    // FR 15: a rule first — the first enabled rule in priority order that matches and needs no attention decides (as
    // for a new transaction, BUD-14 FR 8); its category is offered only if it fits.
    const rule = await firstRule(applicable, subject, (r) => attentionOf(deps, householdId, r));
    if (rule !== null && fits(rule.categoryId))
      return {
        categoryId: rule.categoryId,
        source: "rule",
        rule: { id: rule.id, position: position.get(rule.id)! },
      };
    // Then «як раніше»: the last category set by hand for this merchant.
    const manual = lastManualCategory(history, merchant, fits);
    return manual === null ? null : { categoryId: manual, source: "merchant", rule: null };
  }

  const merchant = counterparty === null ? null : (names.get(counterparty) ?? counterparty);
  const merchants: { name: string; suggestion: Suggestion }[] = [];
  for (const name of [...known].sort((a, b) => a.localeCompare(b, "uk"))) {
    const suggestion = await suggestionFor(name, name);
    if (suggestion !== null) merchants.push({ name, suggestion });
  }
  return {
    merchant,
    suggestion: merchant === null ? null : await suggestionFor(merchant, counterparty!),
    top: topCategories(history, merchant !== null && known.has(merchant) ? merchant : null, fits),
    merchants,
    truncated: more,
  };
}
