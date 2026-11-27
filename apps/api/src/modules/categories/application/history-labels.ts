import { createHash } from "node:crypto";
import {
  customGroupTone,
  hasEssential,
  leafKey,
  planLabels,
  type ChoiceIssue,
  type FileLabelCount,
  type LabelChoice,
  type LabelPlan,
  type PlannedLabel,
} from "../domain/index.ts";
import {
  CUSTOM_ICON,
  FIRST_CUSTOM_POSITION,
  type CategoriesDeps,
  type CategoriesTx,
  type StoredCategory,
  type StoredGroup,
} from "./categories.ts";

/**
 * The labels of a history file (BUD-21@PoC FR 7, FR 8, FR 25; wave 2 row 234): the plan the step «Перевірка
 * розпізнавання» shows — nothing is written — and, at the confirmation, the categories and groups the plan creates, the
 * hidden categories the user shows again and the matchings kept for the next file, in one transaction of this module
 * under the tree's lock, with one audit entry for all of it (FR 7: «одним груповим записом аудиту»). The entry holds
 * counts and the batch's id, never a label.
 */

/** FR 25: a label as stored — the SHA-256 of its key, never its text. */
export const labelHash = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

export type LabelRefusal =
  | { readonly kind: "choice"; readonly index: number; readonly issue: ChoiceIssue }
  /** A category to be created has no valid name (longer than 60 characters, not one line): the user maps it. */
  | { readonly kind: "name-invalid"; readonly labels: number };

/** What the confirmation made of each label: its category (null — a transfer, or skipped) and its spellings. */
export interface ResolvedLabel {
  readonly variants: PlannedLabel["variants"];
  readonly action: "category" | "transfer" | "skip";
  readonly categoryId: string | null;
}

export type LabelsResult<T> =
  | ({ readonly ok: true; readonly plan: LabelPlan } & T)
  | { readonly ok: false; readonly refusal: LabelRefusal };

const keysOf = (counts: readonly FileLabelCount[]): string[] => [
  ...new Set(
    counts.flatMap((c) => {
      const category = c.category ?? c.subcategory;
      return category === null ? [] : [leafKey(category, c.category !== null ? c.subcategory : null)];
    }),
  ),
];

async function planOf(
  tx: CategoriesTx,
  householdId: string,
  counts: readonly FileLabelCount[],
  choices: readonly LabelChoice[],
): Promise<LabelsResult<{ readonly groups: StoredGroup[] }>> {
  const keys = keysOf(counts);
  const hashes = new Map(keys.map((k) => [labelHash(k), k]));
  const [groups, categories, stored] = await Promise.all([
    tx.groups(householdId),
    tx.categories(householdId, { withRetired: true }),
    tx.labelMappings(householdId, [...hashes.keys()]),
  ]);
  const result = planLabels({
    counts,
    groups,
    categories,
    remembered: stored.map((m) => ({ key: hashes.get(m.hash)!, categoryId: m.categoryId })),
    choices,
  });
  if (!result.ok) return { ok: false, refusal: { kind: "choice", ...result.refusal } };
  return { ok: true, plan: result.plan, groups };
}

/** FR 5, FR 7: the plan of the labels as the step shows it; the user's choices so far applied. Writes nothing. */
export async function planHistoryLabels(
  tx: CategoriesTx,
  householdId: string,
  counts: readonly FileLabelCount[],
  choices: readonly LabelChoice[],
): Promise<LabelsResult<object>> {
  const result = await planOf(tx, householdId, counts, choices);
  return result.ok ? { ok: true, plan: result.plan } : result;
}

/**
 * FR 7, FR 25, EC3: «Підтвердити» — under the tree's lock the plan is made again from the tree as it is now, then its
 * groups and categories are created (a new group of the file's category, the history group of a type), the hidden
 * categories the user chose are shown again and every label's matching is kept; one audit entry. A plan with a name
 * that cannot be a category's creates nothing.
 */
export async function confirmHistoryLabels(
  deps: CategoriesDeps,
  tx: CategoriesTx,
  caller: { readonly householdId: string; readonly accountId: string },
  batchId: string,
  counts: readonly FileLabelCount[],
  choices: readonly LabelChoice[],
): Promise<LabelsResult<{ readonly resolved: readonly ResolvedLabel[] }>> {
  const { householdId } = caller;
  await tx.lockTree(householdId);
  const planned = await planOf(tx, householdId, counts, choices);
  if (!planned.ok) return planned;
  const { plan } = planned;
  const invalid = plan.labels.filter((l) => l.questions.includes("name-invalid")).length;
  if (invalid > 0) return { ok: false, refusal: { kind: "name-invalid", labels: invalid } };

  const customOfKind = new Map<string, number>();
  const tone = async (kind: "expense" | "income") => {
    const n = customOfKind.get(kind) ?? (await tx.customGroupCount(householdId, kind));
    customOfKind.set(kind, n + 1);
    return customGroupTone(kind, n);
  };
  const newGroup = async (name: string, kind: "expense" | "income", history: boolean) =>
    tx.insertGroup(householdId, {
      id: deps.newId(),
      systemKey: null,
      kind,
      name,
      renamed: false,
      tone: await tone(kind),
      position: Math.max(FIRST_CUSTOM_POSITION, await tx.nextPosition(householdId, "groups")),
      version: 1,
      historyKind: history ? kind : null,
    });
  const groupIds = new Map<string, StoredGroup>();
  for (const g of plan.groups)
    if (g.target.kind === "new") groupIds.set(`file:${g.key}`, await newGroup(g.target.name!, g.kind, false));
  for (const h of plan.historyGroups) groupIds.set(`history:${h.kind}`, await newGroup(h.name, h.kind, true));
  const existing = new Map(planned.groups.map((g) => [g.id, g]));

  let created = 0;
  let shown = 0;
  const resolved: ResolvedLabel[] = [];
  for (const label of plan.labels) {
    const o = label.outcome;
    let categoryId: string | null = null;
    if (o.action === "category") {
      categoryId = o.categoryId;
      if (o.show) {
        const before = await tx.category(householdId, o.categoryId, true);
        if (before?.state === "hidden") {
          await tx.updateCategory(householdId, { ...before, state: "active", version: before.version + 1 });
          shown += 1;
        }
      }
    } else if (o.action === "create") {
      const group =
        o.group.kind === "group"
          ? existing.get(o.group.groupId)!
          : o.group.kind === "new"
            ? groupIds.get(`file:${label.groupKey}`)!
            : o.group.groupId !== null
              ? existing.get(o.group.groupId)!
              : groupIds.get(`history:${o.kind}`)!;
      const category: StoredCategory = await tx.insertCategory(householdId, {
        id: deps.newId(),
        groupId: group.id,
        kind: group.kind,
        systemKey: null,
        name: o.name!,
        renamed: false,
        icon: CUSTOM_ICON,
        color: group.tone,
        essential: hasEssential(group.kind) ? false : null,
        state: "active",
        mergedInto: null,
        position: await tx.nextPosition(householdId, "categories", group.id),
        version: 1,
      });
      categoryId = category.id;
      created += 1;
    }
    resolved.push({
      variants: label.variants,
      action: o.action === "create" ? "category" : o.action,
      categoryId,
    });
  }
  const kept = plan.labels.flatMap((l, i) =>
    resolved[i]!.action === "skip" ? [] : [{ hash: labelHash(l.key), categoryId: resolved[i]!.categoryId }],
  );
  await tx.saveLabelMappings(householdId, kept, caller.accountId, new Date(deps.now()));
  await deps.audit.changed(householdId, caller, { type: "categories.history", id: batchId }, "create", null, {
    groupsCreated: String(groupIds.size),
    categoriesCreated: String(created),
    categoriesShown: String(shown),
    labelsMatched: String(kept.length),
  });
  return { ok: true, plan, resolved };
}
