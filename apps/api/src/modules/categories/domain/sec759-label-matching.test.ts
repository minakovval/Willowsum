import { describe, expect, it } from "vitest";
import {
  leafKey,
  planLabels,
  SYSTEM_TREE,
  type LabelPlanInput,
  type PlanCategory,
  type PlanGroup,
} from "./index.ts";

/**
 * Security review of PR #759 (BUD-21@PoC b, wave 2 row 234): the guards of `planLabels` no test of the PR holds —
 * a category out of use (merged away) is never a label's category. Every label is synthetic.
 */
const groups: PlanGroup[] = SYSTEM_TREE.map((g) => ({
  id: `g:${g.key}`,
  name: g.name,
  kind: g.kind,
  historyKind: null,
}));
const system: PlanCategory[] = SYSTEM_TREE.flatMap((g) =>
  g.categories.map((c) => ({
    id: `c:${c.key}`,
    groupId: `g:${g.key}`,
    name: c.name,
    kind: g.kind,
    state: "active" as const,
    systemKey: c.key,
    mergedInto: null,
  })),
);
const expenseGroup = groups.find((g) => g.kind === "expense")!;
const service = system.find((c) => c.kind === "service")!;
const custom = (id: string, name: string, over: Partial<PlanCategory> = {}): PlanCategory => ({
  id,
  groupId: expenseGroup.id,
  name,
  kind: "expense",
  state: "active",
  systemKey: null,
  mergedInto: null,
  ...over,
});

function outcome(over: Partial<LabelPlanInput>) {
  const result = planLabels({
    counts: [{ category: "Синтетика", subcategory: null, negative: 5, positive: 0 }],
    groups,
    categories: system,
    remembered: [],
    choices: [],
    ...over,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.plan.labels[0]!.outcome;
}

describe("sec759: a category out of use is never a label's category", () => {
  it("sec759 FR 7: a retired (merged away) category of the label's name is not matched — the label is created", () => {
    const target = custom("c:target", "Ціль");
    const retired = custom("c:old", "Синтетика", { state: "retired", mergedInto: target.id });
    expect(outcome({ categories: [...system, target, retired] })).toMatchObject({
      action: "create",
      name: "Синтетика",
      source: "new",
    });
  });

  it("sec759 FR 25: a remembered matching whose category was merged into a category that is itself out of use is not followed", () => {
    const gone = custom("c:gone", "Зникла", { state: "retired", mergedInto: "c:nowhere" });
    const old = custom("c:old", "Стара", { state: "retired", mergedInto: gone.id });
    expect(
      outcome({
        categories: [...system, gone, old],
        remembered: [{ key: leafKey("Синтетика", null), categoryId: old.id }],
      }),
    ).toMatchObject({ action: "create", source: "new" });
  });

  it("sec759 FR 8: a remembered matching that leads to a service category is a transfer, never that category", () => {
    const old = custom("c:old", "Стара", { state: "retired", mergedInto: service.id });
    expect(
      outcome({
        categories: [...system, old],
        remembered: [{ key: leafKey("Синтетика", null), categoryId: old.id }],
      }),
    ).toEqual({ action: "transfer", source: "remembered" });
  });
});
