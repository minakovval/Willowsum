import { describe, expect, it } from "vitest";
import {
  HISTORY_GROUP_NAMES,
  labelKey,
  planLabels,
  SYSTEM_TREE,
  type FileLabelCount,
  type LabelPlanInput,
  type PlanCategory,
  type PlanGroup,
} from "./index.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» b) (wave 2 row 234): the labels of a history file matched with the space's
 * tree — pure. Ids are the test's; every label is synthetic.
 */

/** The system tree of a space, with ids `g:<key>` and `c:<key>`. */
const systemGroups: PlanGroup[] = SYSTEM_TREE.map((g) => ({
  id: `g:${g.key}`,
  name: g.name,
  kind: g.kind,
  historyKind: null,
}));
const systemCategories: PlanCategory[] = SYSTEM_TREE.flatMap((g) =>
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

const label = (
  category: string | null,
  subcategory: string | null,
  negative: number,
  positive = 0,
): FileLabelCount => ({ category, subcategory, negative, positive });

function plan(counts: readonly FileLabelCount[], over: Partial<LabelPlanInput> = {}) {
  const result = planLabels({
    counts,
    groups: systemGroups,
    categories: systemCategories,
    remembered: [],
    choices: [],
    ...over,
  });
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.plan;
}

const leaf = (p: ReturnType<typeof plan>, category: string, subcategory: string | null = null) =>
  p.labels.find((l) => l.category === category && l.subcategory === subcategory)!;

/** AC6's file: «Авто · Пальне» (55), «Авто · Мийка» (9), «Їжа · Супермаркети» (212), «Кав'ярні» (30). */
const AC6 = [
  label("Авто", "Пальне", 55),
  label("Авто", "Мийка", 9),
  label("Їжа", "Супермаркети", 212),
  label("Кав'ярні", null, 30),
];

describe("BUD-21@PoC FR 7: the file's labels become the space's categories", () => {
  it("BUD-21@PoC AC6: «Авто · Пальне» matches the category «Пальне»; «Мийка», «Супермаркети» and «Кав'ярні» are to be created, in the groups of «Авто», «Їжа» and the history group", () => {
    const p = plan(AC6);
    expect(leaf(p, "Авто", "Пальне").outcome).toMatchObject({
      action: "category",
      categoryId: "c:fuel",
      name: "Пальне",
      source: "name",
    });
    expect(leaf(p, "Авто", "Мийка").outcome).toMatchObject({
      action: "create",
      name: "Мийка",
      kind: "expense",
      group: { kind: "new", name: "Авто" },
    });
    expect(leaf(p, "Їжа", "Супермаркети").outcome).toMatchObject({
      action: "create",
      name: "Супермаркети",
      group: { kind: "new", name: "Їжа" },
    });
    expect(leaf(p, "Кав'ярні").outcome).toMatchObject({
      action: "create",
      name: "Кав'ярні",
      kind: "expense",
      group: { kind: "history", groupId: null, name: HISTORY_GROUP_NAMES.expense },
    });
    // The labels by rows, most first: the order the step shows.
    expect(p.labels.map((l) => l.rows)).toEqual([212, 55, 30, 9]);
    expect(p.groups.map((g) => [g.category, g.kind, g.target.kind])).toEqual([
      ["Їжа", "expense", "new"],
      ["Авто", "expense", "new"],
    ]);
  });

  it("BUD-21@PoC FR 7: a file category with subcategories matches an existing group by name; its new categories go there with the group's type", () => {
    const p = plan([label("харчування", "Супермаркети", 10)]);
    expect(p.groups[0]!.target).toEqual({ kind: "group", groupId: "g:food", name: "Харчування" });
    expect(leaf(p, "харчування", "Супермаркети").outcome).toMatchObject({
      action: "create",
      kind: "expense",
      group: { kind: "group", groupId: "g:food" },
    });
  });

  it("BUD-21@PoC FR 7: the type of a new category is the sign of most of its rows; a new group's type is that of all its rows and its categories have it; a subcategory of the opposite sign is a question", () => {
    const p = plan([
      label("Підробіток", null, 1, 7),
      label("Робота", "Аванс", 0, 12),
      label("Робота", "Повернення витрат", 4, 1),
    ]);
    expect(leaf(p, "Підробіток").outcome).toMatchObject({
      action: "create",
      kind: "income",
      group: { kind: "history", name: HISTORY_GROUP_NAMES.income },
    });
    expect(p.groups[0]).toMatchObject({ category: "Робота", kind: "income", questions: [] });
    expect(leaf(p, "Робота", "Повернення витрат")).toMatchObject({
      outcome: { action: "create", kind: "income" },
      questions: ["opposite-sign"],
    });
    expect(leaf(p, "Робота", "Аванс").questions).toEqual([]);
  });

  it("BUD-21@PoC FR 7: the history group is one per type and an existing one is used again", () => {
    const history: PlanGroup = { id: "g:h", name: "Мої витрати", kind: "expense", historyKind: "expense" };
    const p = plan([label("Кав'ярні", null, 3), label("Премія", null, 0, 2)], {
      groups: [...systemGroups, history],
    });
    expect(leaf(p, "Кав'ярні").outcome).toMatchObject({
      group: { kind: "history", groupId: "g:h", name: "Мої витрати" },
    });
    expect(leaf(p, "Премія").outcome).toMatchObject({
      group: { kind: "history", groupId: null, name: HISTORY_GROUP_NAMES.income },
    });
  });

  it("BUD-21@PoC FR 6: the user's choice — another existing category or «створити нову» — replaces the match", () => {
    const p = plan(AC6, {
      choices: [
        { category: "Їжа", subcategory: "Супермаркети", action: "category", categoryId: "c:groceries" },
        { category: "Авто", subcategory: "Пальне", action: "create" },
      ],
    });
    expect(leaf(p, "Їжа", "Супермаркети").outcome).toMatchObject({
      action: "category",
      categoryId: "c:groceries",
      name: "Продукти",
      source: "choice",
    });
    // «Пальне» exists: the new one takes its group's name in brackets.
    expect(leaf(p, "Авто", "Пальне")).toMatchObject({
      outcome: { action: "create", name: "Пальне (Авто)", source: "choice" },
      questions: ["duplicate-name"],
    });
    // No category of «Їжа» is created now: the group is not either.
    expect(p.groups.map((g) => g.category)).toEqual(["Авто"]);
  });

  it("BUD-21@PoC FR 6: a choice of a label the file does not have, of an unknown or service category, or twice is refused", () => {
    const refused = (choices: LabelPlanInput["choices"]) =>
      planLabels({
        counts: AC6,
        groups: systemGroups,
        categories: systemCategories,
        remembered: [],
        choices,
      });
    expect(refused([{ category: "Дім", subcategory: null, action: "create" }])).toEqual({
      ok: false,
      refusal: { index: 0, issue: "unknown-label" },
    });
    expect(
      refused([{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: "c:nope" }]),
    ).toEqual({ ok: false, refusal: { index: 0, issue: "unknown-category" } });
    expect(
      refused([{ category: "Кав'ярні", subcategory: null, action: "category", categoryId: "c:transfer" }]),
    ).toEqual({ ok: false, refusal: { index: 0, issue: "unknown-category" } });
    expect(
      refused([
        { category: "Кав'ярні", subcategory: null, action: "create" },
        { category: "кав'ярні ", subcategory: null, action: "transfer" },
      ]),
    ).toEqual({ ok: false, refusal: { index: 1, issue: "duplicate" } });
  });

  it("BUD-21@PoC FR 7: a name that cannot be a category's (longer than 60 characters) is a question; nothing can be created with it", () => {
    const long = "Дуже довга назва категорії, яку користувач написав у своїй таблиці колись";
    expect(leaf(plan([label(long, null, 3)]), long)).toMatchObject({
      outcome: { action: "create", name: null },
      questions: ["name-invalid"],
    });
  });
});

describe("BUD-21@PoC FR 8: transfers", () => {
  it("BUD-21@PoC FR 8: a label the user marks as a transfer creates no category", () => {
    const p = plan(AC6, { choices: [{ category: "Кав'ярні", subcategory: null, action: "transfer" }] });
    expect(leaf(p, "Кав'ярні").outcome).toEqual({ action: "transfer", source: "choice" });
    expect(p.historyGroups).toEqual([]);
  });
});

describe("BUD-21@PoC FR 25: the confirmed matching is remembered", () => {
  it("BUD-21@PoC FR 25: a remembered label takes its category (a merged one — its target), still open to change; a deleted one is matched again", () => {
    const merged: PlanCategory = {
      id: "c:old",
      groupId: "g:food",
      name: "Старі продукти",
      kind: "expense",
      state: "retired",
      systemKey: null,
      mergedInto: "c:groceries",
    };
    const p = plan([...AC6, label("Дім", "Меблі", 2)], {
      categories: [...systemCategories, merged],
      remembered: [
        { key: labelKey("Їжа") + "\u001f" + labelKey("Супермаркети"), categoryId: "c:old" },
        { key: labelKey("Кав'ярні") + "\u001f", categoryId: null },
        { key: labelKey("Дім") + "\u001f" + labelKey("Меблі"), categoryId: "c:gone" },
      ],
    });
    expect(leaf(p, "Їжа", "Супермаркети").outcome).toMatchObject({
      action: "category",
      categoryId: "c:groceries",
      source: "remembered",
    });
    expect(leaf(p, "Кав'ярні").outcome).toEqual({ action: "transfer", source: "remembered" });
    expect(leaf(p, "Дім", "Меблі").outcome).toMatchObject({ action: "create", name: "Меблі" });
    const changed = plan(AC6, {
      remembered: [{ key: labelKey("Їжа") + "\u001f" + labelKey("Супермаркети"), categoryId: "c:groceries" }],
      choices: [{ category: "Їжа", subcategory: "Супермаркети", action: "create" }],
    });
    expect(leaf(changed, "Їжа", "Супермаркети").outcome).toMatchObject({
      action: "create",
      source: "choice",
    });
  });
});

describe("BUD-21@PoC edge cases of labels", () => {
  it("BUD-21@PoC EC1: labels that differ only in case, diacritics or spaces («Продукти», «продукти ») are one label", () => {
    expect(labelKey("  Продукти ")).toBe(labelKey("продукти"));
    expect(labelKey("Кав’ярні")).toBe(labelKey("кав'ярні"));
    expect(labelKey("Café  du   Monde")).toBe(labelKey("cafe du monde"));
    const p = plan([label("Продукти", null, 5), label("продукти ", null, 3), label("ПРОДУКТИ", null, 1)]);
    expect(p.labels).toHaveLength(1);
    expect(p.labels[0]).toMatchObject({
      category: "Продукти",
      rows: 9,
      outcome: { action: "category", categoryId: "c:groceries", source: "name" },
    });
    expect(p.labels[0]!.variants).toEqual([
      { category: "Продукти", subcategory: null },
      { category: "продукти ", subcategory: null },
      { category: "ПРОДУКТИ", subcategory: null },
    ]);
  });

  it("BUD-21@PoC EC2: the same subcategory in two file categories («Авто · Інше», «Дім · Інше») — the second is created with its group's name in brackets, and the step shows it", () => {
    const p = plan([label("Авто", "Інше", 8), label("Дім", "Інше", 3)]);
    expect(leaf(p, "Авто", "Інше")).toMatchObject({
      outcome: { action: "create", name: "Інше" },
      questions: [],
    });
    expect(leaf(p, "Дім", "Інше")).toMatchObject({
      outcome: { action: "create", name: "Інше (Дім)" },
      questions: ["duplicate-name"],
    });
  });

  it("BUD-21@PoC EC3: a label that matches a hidden category takes it, and the step offers to show it again", () => {
    const hidden = systemCategories.map((c) =>
      c.systemKey === "garden" ? { ...c, state: "hidden" as const } : c,
    );
    const p = plan([label("Сад", null, 4)], { categories: hidden });
    expect(leaf(p, "Сад")).toMatchObject({
      outcome: { action: "category", categoryId: "c:garden", hidden: true, show: false },
      questions: ["hidden-category"],
    });
    const shown = plan([label("Сад", null, 4)], {
      categories: hidden,
      choices: [
        { category: "Сад", subcategory: null, action: "category", categoryId: "c:garden", show: true },
      ],
    });
    expect(leaf(shown, "Сад")).toMatchObject({
      outcome: { action: "category", hidden: true, show: true },
      questions: [],
    });
  });

  it("BUD-21@PoC EC4: rows of one label with as many positive as negative amounts — the new category is «витрата», and the step makes it a question", () => {
    const p = plan([label("Каса", null, 3, 3), label("Сім'я", "Обмін", 2, 2)]);
    expect(leaf(p, "Каса")).toMatchObject({
      outcome: { action: "create", kind: "expense" },
      questions: ["equal-signs"],
    });
    expect(p.groups[0]).toMatchObject({ kind: "expense", questions: ["equal-signs"] });
    expect(leaf(p, "Сім'я", "Обмін").questions).toEqual(["equal-signs"]);
  });

  it("BUD-21@PoC EC12: the label «Переказ» is marked as a transfer (open to change); rows of «Коригування» are skipped as a service category", () => {
    const p = plan([label("переказ", null, 6), label("Коригування", null, 2), label("Різне", "Переказ", 1)]);
    expect(leaf(p, "переказ").outcome).toEqual({ action: "transfer", source: "service" });
    expect(leaf(p, "Різне", "Переказ").outcome).toEqual({ action: "transfer", source: "service" });
    expect(leaf(p, "Коригування").outcome).toEqual({ action: "skip", reason: "service-category" });
    const changed = plan([label("переказ", null, 6)], {
      choices: [{ category: "переказ", subcategory: null, action: "create" }],
    });
    // «Переказ» is the service category's name: the new one is told apart.
    expect(leaf(changed, "переказ").outcome).toMatchObject({ action: "create", name: "переказ 2" });
  });

  it("BUD-21@PoC FR 7: the same labels, the same tree and answers give the same plan", () => {
    const shuffled = [AC6[2]!, AC6[0]!, AC6[3]!, AC6[1]!];
    expect(plan(shuffled)).toEqual(plan(AC6));
  });
});
