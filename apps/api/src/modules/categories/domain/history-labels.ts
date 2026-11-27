import { categoryName } from "./categories.ts";
import { SYSTEM_TREE, type CategoryKind } from "./catalogue.ts";

/**
 * The labels of a history file matched with the space's category tree (BUD-21@PoC FR 7, FR 8, FR 25, EC 1–5, EC 12;
 * wave 2 row 234), pure. The file's categories lead: a file category with subcategories is a group, a subcategory a
 * category in it, a file category without subcategories a category (in the history group of its type). A label takes
 * the user's choice, else the matching the user confirmed before, else the service category of its name, else the
 * category of its name, else a category to be created. The same labels, tree and answers give the same plan.
 */

/** The history groups' names (lead decision: the canvas has no board yet), one per type (FR 7). */
export const HISTORY_GROUP_NAMES = { expense: "Витрати з історії", income: "Доходи з історії" } as const;

const APOSTROPHES = /[’ʼ‘`´]/gu;

/** EC1: a label without case, diacritics and extra spaces; the apostrophes of Ukrainian are one (lead decision). */
export function labelKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(APOSTROPHES, "'")
    .toLocaleLowerCase("uk")
    .trim()
    .replace(/\s+/gu, " ");
}

/** The key of a label: its file category and its subcategory (empty — none). */
export const leafKey = (category: string, subcategory: string | null): string =>
  `${labelKey(category)}\u001f${subcategory === null ? "" : labelKey(subcategory)}`;

/** A label of the file as printed, with its rows' signs (transfers by the transfer column are not labels, FR 8). */
export interface FileLabelCount {
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly negative: number;
  readonly positive: number;
}

export interface PlanGroup {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  /** The history group of this type (FR 7); null — any other group. */
  readonly historyKind: "expense" | "income" | null;
}

export interface PlanCategory {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly state: "active" | "hidden" | "retired";
  readonly systemKey: string | null;
  readonly mergedInto: string | null;
}

/** FR 6: the user's answer for one label (named as printed: any of its variants). */
export type LabelChoice = {
  readonly category: string | null;
  readonly subcategory: string | null;
} & (
  | { readonly action: "category"; readonly categoryId: string; readonly show?: boolean }
  | { readonly action: "create" }
  | { readonly action: "transfer" }
);

/** FR 25: a label's matching confirmed before; `categoryId` null — a transfer. */
export interface RememberedLabel {
  readonly key: string;
  readonly categoryId: string | null;
}

export type LabelQuestion =
  "equal-signs" | "opposite-sign" | "hidden-category" | "duplicate-name" | "name-invalid";

export type GroupTarget =
  | { readonly kind: "group"; readonly groupId: string; readonly name: string }
  /** A group created from the file category (`name` null — not a valid name). */
  | { readonly kind: "new"; readonly name: string | null }
  /** The history group of the category's type; `groupId` null — created now. */
  | { readonly kind: "history"; readonly groupId: string | null; readonly name: string };

export type LabelOutcome =
  | {
      readonly action: "category";
      readonly categoryId: string;
      readonly name: string;
      readonly hidden: boolean;
      /** EC3: a hidden category the user shows again at the confirmation. */
      readonly show: boolean;
      readonly source: "name" | "remembered" | "choice";
    }
  | {
      readonly action: "create";
      /** null — the label is no valid name (a question: map it to a category). */
      readonly name: string | null;
      readonly kind: "expense" | "income";
      readonly group: GroupTarget;
      readonly source: "new" | "choice";
    }
  | { readonly action: "transfer"; readonly source: "service" | "remembered" | "choice" }
  | { readonly action: "skip"; readonly reason: "service-category" };

export interface PlannedLabel {
  readonly key: string;
  /** As printed: the variant of most rows. */
  readonly category: string;
  readonly subcategory: string | null;
  /** Every spelling of the label in the file (EC1), most rows first. */
  readonly variants: readonly { readonly category: string | null; readonly subcategory: string | null }[];
  readonly rows: number;
  /** The file category this label is a subcategory of (its key); null — a category of its own. */
  readonly groupKey: string | null;
  readonly outcome: LabelOutcome;
  readonly questions: readonly LabelQuestion[];
}

export interface PlannedGroup {
  readonly key: string;
  readonly category: string;
  readonly rows: number;
  readonly kind: "expense" | "income";
  readonly target: Exclude<GroupTarget, { kind: "history" }>;
  readonly questions: readonly LabelQuestion[];
}

export interface LabelPlan {
  readonly labels: readonly PlannedLabel[];
  /** File categories with subcategories that match a group or need one. */
  readonly groups: readonly PlannedGroup[];
  /** The history groups to be created. */
  readonly historyGroups: readonly { readonly kind: "expense" | "income"; readonly name: string }[];
}

export type ChoiceIssue = "unknown-label" | "unknown-category" | "duplicate";

export interface LabelPlanInput {
  readonly counts: readonly FileLabelCount[];
  readonly groups: readonly PlanGroup[];
  readonly categories: readonly PlanCategory[];
  readonly remembered: readonly RememberedLabel[];
  readonly choices: readonly LabelChoice[];
}

export type LabelPlanResult =
  | { readonly ok: true; readonly plan: LabelPlan }
  | { readonly ok: false; readonly refusal: { readonly index: number; readonly issue: ChoiceIssue } };

const SERVICE_NAMES = new Map(
  SYSTEM_TREE.filter((g) => g.kind === "service").flatMap((g) =>
    g.categories.map((c) => [labelKey(c.name), c.key] as const),
  ),
);

const byRows = <T extends { rows: number; key: string }>(a: T, b: T): number =>
  b.rows - a.rows || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** FR 7: the type by the sign of most rows; as many of each — «витрата», and a question (EC4). */
function kindOf(negative: number, positive: number): { kind: "expense" | "income"; tie: boolean } {
  return { kind: positive > negative ? "income" : "expense", tie: positive === negative };
}

interface Leaf {
  key: string;
  catKey: string;
  name: string;
  variants: { category: string | null; subcategory: string | null; rows: number; text: string }[];
  rows: number;
  negative: number;
  positive: number;
}

/** BUD-21 FR 7, FR 8, FR 25: the plan of the file's labels, or the refusal of a choice. */
export function planLabels(input: LabelPlanInput): LabelPlanResult {
  // A label is its file category and subcategory; a subcategory without a category is a category (as the tree shows).
  const leaves = new Map<string, Leaf>();
  const withSubs = new Set<string>();
  for (const c of input.counts) {
    const category = c.category ?? c.subcategory;
    if (category === null) continue;
    const sub = c.category !== null ? c.subcategory : null;
    const key = leafKey(category, sub);
    const leaf = leaves.get(key) ?? {
      key,
      catKey: labelKey(category),
      name: sub ?? category,
      variants: [],
      rows: 0,
      negative: 0,
      positive: 0,
    };
    const rows = c.negative + c.positive;
    leaf.variants.push({
      category: c.category,
      subcategory: c.subcategory,
      rows,
      text: `${category}\u001f${sub ?? ""}`,
    });
    leaf.rows += rows;
    leaf.negative += c.negative;
    leaf.positive += c.positive;
    leaves.set(key, leaf);
    if (sub !== null) withSubs.add(leaf.catKey);
  }
  for (const leaf of leaves.values()) {
    leaf.variants.sort((a, b) => b.rows - a.rows || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    const first = leaf.variants[0]!;
    leaf.name = (first.category !== null ? first.subcategory : null) ?? first.category ?? first.subcategory!;
  }

  const inUse = input.categories.filter((c) => c.state !== "retired");
  const byId = new Map(input.categories.map((c) => [c.id, c]));
  const choices = new Map<string, LabelChoice>();
  for (const [index, choice] of input.choices.entries()) {
    const category = choice.category ?? choice.subcategory;
    const key =
      category === null ? "" : leafKey(category, choice.category !== null ? choice.subcategory : null);
    if (!leaves.has(key)) return { ok: false, refusal: { index, issue: "unknown-label" } };
    if (choices.has(key)) return { ok: false, refusal: { index, issue: "duplicate" } };
    if (choice.action === "category") {
      const target = byId.get(choice.categoryId);
      if (!target || target.state === "retired" || target.kind === "service")
        return { ok: false, refusal: { index, issue: "unknown-category" } };
    }
    choices.set(key, choice);
  }
  const remembered = new Map(input.remembered.map((r) => [r.key, r.categoryId]));
  /** A category in use for an id: a merged one gives its target (FR 8 keeps `mergedInto` flat). */
  const live = (id: string): PlanCategory | null => {
    const c = byId.get(id);
    const target = c?.state === "retired" && c.mergedInto ? byId.get(c.mergedInto) : c;
    return target && target.state !== "retired" ? target : null;
  };
  const matched = (
    c: PlanCategory,
    source: "name" | "remembered" | "choice",
    show = false,
  ): LabelOutcome => ({
    action: "category",
    categoryId: c.id,
    name: c.name,
    hidden: c.state === "hidden",
    show: c.state === "hidden" && show,
    source,
  });

  // File categories with subcategories: a group of the space by name (never the service group), else a new one.
  const sorted = [...leaves.values()].sort(byRows);
  const fileGroups = new Map<
    string,
    { key: string; category: string; rows: number; negative: number; positive: number }
  >();
  for (const leaf of sorted) {
    if (!withSubs.has(leaf.catKey)) continue;
    const g = fileGroups.get(leaf.catKey) ?? {
      key: leaf.catKey,
      category: leaf.variants[0]!.category ?? leaf.name,
      rows: 0,
      negative: 0,
      positive: 0,
    };
    g.rows += leaf.rows;
    g.negative += leaf.negative;
    g.positive += leaf.positive;
    fileGroups.set(leaf.catKey, g);
  }
  const spaceGroup = (key: string) =>
    input.groups.find((g) => g.kind !== "service" && labelKey(g.name) === key) ?? null;

  const outcomes = new Map<string, LabelOutcome>();
  for (const leaf of sorted) {
    const choice = choices.get(leaf.key);
    if (choice) {
      outcomes.set(
        leaf.key,
        choice.action === "category"
          ? matched(byId.get(choice.categoryId)!, "choice", choice.show ?? false)
          : choice.action === "transfer"
            ? { action: "transfer", source: "choice" }
            : {
                action: "create",
                name: null,
                kind: "expense",
                group: { kind: "new", name: null },
                source: "choice",
              },
      );
      continue;
    }
    if (remembered.has(leaf.key)) {
      const id = remembered.get(leaf.key)!;
      const target = id === null ? null : live(id);
      if (id === null || target?.kind === "service") {
        outcomes.set(leaf.key, { action: "transfer", source: "remembered" });
        continue;
      }
      if (target) {
        outcomes.set(leaf.key, matched(target, "remembered"));
        continue;
      }
    }
    // EC12: «Переказ» is a transfer, «Коригування» is no category of income or expenses.
    const service = SERVICE_NAMES.get(labelKey(leaf.name)) ?? SERVICE_NAMES.get(leaf.catKey);
    if (service === "transfer") outcomes.set(leaf.key, { action: "transfer", source: "service" });
    else if (service === "adjustment") outcomes.set(leaf.key, { action: "skip", reason: "service-category" });
    else {
      const found = inUse.find((c) => c.kind !== "service" && labelKey(c.name) === labelKey(leaf.name));
      outcomes.set(
        leaf.key,
        found
          ? matched(found, "name")
          : {
              action: "create",
              name: null,
              kind: "expense",
              group: { kind: "new", name: null },
              source: "new",
            },
      );
    }
  }

  // The groups that a category is created in, or that match one of the space.
  const groups: PlannedGroup[] = [];
  const groupNames = new Set(input.groups.map((g) => labelKey(g.name)));
  const freeGroupName = (base: string): string | null => {
    for (let n = 1; n < 100; n++) {
      const name = categoryName(n === 1 ? base : `${base} ${n}`);
      if (name === undefined) return null;
      if (!groupNames.has(labelKey(name))) {
        groupNames.add(labelKey(name));
        return name;
      }
    }
    return null;
  };
  const creates = (catKey: string) =>
    sorted.some(
      (l) => l.catKey === catKey && withSubs.has(catKey) && outcomes.get(l.key)!.action === "create",
    );
  for (const g of fileGroups.values()) {
    const existing = spaceGroup(g.key);
    if (!existing && !creates(g.key)) continue;
    const sign = kindOf(g.negative, g.positive);
    groups.push({
      key: g.key,
      category: g.category,
      rows: g.rows,
      kind: existing ? (existing.kind as "expense" | "income") : sign.kind,
      target: existing
        ? { kind: "group", groupId: existing.id, name: existing.name }
        : { kind: "new", name: freeGroupName(g.category) },
      questions: !existing && sign.tie ? ["equal-signs"] : [],
    });
  }
  const groupOf = new Map(groups.map((g) => [g.key, g]));
  const historyGroups: { kind: "expense" | "income"; name: string }[] = [];
  const historyGroup = (kind: "expense" | "income"): GroupTarget => {
    const existing = input.groups.find((g) => g.historyKind === kind);
    if (existing) return { kind: "history", groupId: existing.id, name: existing.name };
    let made = historyGroups.find((h) => h.kind === kind);
    if (!made) {
      made = { kind, name: freeGroupName(HISTORY_GROUP_NAMES[kind]) ?? HISTORY_GROUP_NAMES[kind] };
      historyGroups.push(made);
    }
    return { kind: "history", groupId: null, name: made.name };
  };

  // New categories' names: unique in the space (FR 2); a taken one gets its group's name in brackets (EC2), then a number.
  const names = new Set(inUse.map((c) => labelKey(c.name)));
  const freeName = (base: string, group: string | null): { name: string | null; renamed: boolean } => {
    const stem = group !== null ? `${base} (${group})` : base;
    const tries = group !== null ? [base, stem] : [base];
    for (let n = 2; n < 100; n++) tries.push(`${stem} ${n}`);
    for (const [i, t] of tries.entries()) {
      const name = categoryName(t);
      if (name === undefined) return { name: null, renamed: false };
      if (!names.has(labelKey(name))) {
        names.add(labelKey(name));
        return { name, renamed: i > 0 };
      }
    }
    return { name: null, renamed: false };
  };

  const labels: PlannedLabel[] = sorted.map((leaf) => {
    let outcome = outcomes.get(leaf.key)!;
    const questions: LabelQuestion[] = [];
    if (outcome.action === "category" && outcome.hidden && !outcome.show) questions.push("hidden-category");
    if (outcome.action === "create") {
      const sign = kindOf(leaf.negative, leaf.positive);
      const fileGroup = withSubs.has(leaf.catKey) ? groupOf.get(leaf.catKey)! : null;
      const kind = fileGroup ? fileGroup.kind : sign.kind;
      if (sign.tie) questions.push("equal-signs");
      else if (fileGroup && sign.kind !== kind) questions.push("opposite-sign");
      const group: GroupTarget = fileGroup ? fileGroup.target : historyGroup(kind);
      const groupName = group.kind === "new" ? (group.name ?? fileGroup!.category) : group.name;
      const free = freeName(leaf.name, fileGroup ? groupName : null);
      if (free.renamed) questions.push("duplicate-name");
      if (free.name === null || (group.kind === "new" && group.name === null)) questions.push("name-invalid");
      outcome = { ...outcome, name: free.name, kind, group };
    }
    const first = leaf.variants[0]!;
    return {
      key: leaf.key,
      category: first.category ?? first.subcategory!,
      subcategory: first.category !== null ? first.subcategory : null,
      variants: leaf.variants.map((v) => ({ category: v.category, subcategory: v.subcategory })),
      rows: leaf.rows,
      groupKey: withSubs.has(leaf.catKey) ? leaf.catKey : null,
      outcome,
      questions,
    };
  });
  return { ok: true, plan: { labels, groups, historyGroups } };
}
