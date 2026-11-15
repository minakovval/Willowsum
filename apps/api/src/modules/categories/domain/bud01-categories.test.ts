import { describe, expect, it } from "vitest";
import {
  categoryName,
  contrastRatio,
  customGroupTone,
  deleteProblem,
  iconTone,
  INK,
  mergeProblem,
  sameName,
  stateAfterMerge,
  SYSTEM_TREE,
  WHITE,
} from "./index.ts";

const all = SYSTEM_TREE.flatMap((g) => g.categories.map((c) => ({ ...c, group: g })));
const byName = (name: string) => all.find((c) => c.name === name)!;

describe("BUD-01@PoC FR 1: the system tree", () => {
  it("BUD-01@PoC FR 1: 10 groups — 8 of expenses, 2 of income — and the service categories «Переказ» and «Коригування»; two levels", () => {
    const kinds = SYSTEM_TREE.map((g) => g.kind);
    expect(kinds.filter((k) => k === "expense")).toHaveLength(8);
    expect(kinds.filter((k) => k === "income")).toHaveLength(2);
    const service = SYSTEM_TREE.filter((g) => g.kind === "service");
    expect(service.flatMap((g) => g.categories.map((c) => c.name))).toEqual(["Переказ", "Коригування"]);
    expect(SYSTEM_TREE.map((g) => g.name).slice(0, 10)).toEqual([
      "Житло",
      "Харчування",
      "Транспорт і авто",
      "Зв'язок і підписки",
      "Здоров'я і догляд",
      "Родина",
      "Відпочинок",
      "Фінанси і податки",
      "Дохід від роботи",
      "Інші доходи",
    ]);
    expect(SYSTEM_TREE.find((g) => g.key === "housing")!.categories.map((c) => c.name)).toEqual([
      "Оренда",
      "Комунальні",
      "Ремонт",
      "Дім",
      "Побутова хімія",
      "Сад",
      "Страхування житла",
    ]);
    expect(all).toHaveLength(51);
    // Names and keys are unique (FR 2: a name is unique in the space, the system tree included).
    expect(new Set(all.map((c) => c.name.toLowerCase())).size).toBe(51);
    expect(new Set(all.map((c) => c.key)).size).toBe(51);
    expect(byName("Кафе і ресторани").hint).toBe("кафе, ресторани, кава, бари");
    // No category «Без категорії» (a state of a transaction) and no income category for refunds.
    expect(all.some((c) => /Без категорії|Повернення/.test(c.name))).toBe(false);
  });
});

describe("BUD-01@PoC FR 10: colour and icon of every category", () => {
  const INK_ICONS = [
    "Сад",
    "Страхування житла",
    "Доставка їжі",
    "Страхування авто",
    "Паркування і дороги",
    "Підписки",
    "Краса і догляд",
    "Страхування здоров'я",
    "Домашні тварини",
    "Благодійність",
    "Хобі",
    "Штрафи",
    "Інші витрати",
    "Фриланс",
    "Продаж майна",
    "Інші надходження",
    "Переказ",
    "Коригування",
  ];

  it("BUD-01@PoC FR 10: every system category has a Lucide icon and the colour of the table; the icon is white at 3 : 1 against white, else ink — as the table says", () => {
    for (const c of all) {
      expect(c.icon, c.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.color, c.name).toMatch(/^#[0-9A-F]{6}$/);
      expect(iconTone(c.color), c.name).toBe(INK_ICONS.includes(c.name) ? "ink" : "white");
    }
    expect(SYSTEM_TREE.slice(0, 10).map((g) => g.tone)).toEqual([
      "#5872D2",
      "#0E9161",
      "#9C7305",
      "#097FCD",
      "#C35047",
      "#9B5BB6",
      "#0F899B",
      "#678800",
      "#BA4E84",
      "#BE590F",
    ]);
  });

  it("BUD-01@PoC AC17: «Оренда» #144097, «Комунальні» #494BAB, «Сад» #959FFE of «Житло» #5872D2 and «Продукти» #045D2F of «Харчування» #0E9161; «Сад» has the ink icon (white below 3 : 1)", () => {
    expect(["Оренда", "Комунальні", "Сад", "Продукти"].map((n) => byName(n).color)).toEqual([
      "#144097",
      "#494BAB",
      "#959FFE",
      "#045D2F",
    ]);
    expect(byName("Сад").group.tone).toBe("#5872D2");
    expect(byName("Продукти").group.tone).toBe("#0E9161");
    expect(["Оренда", "Комунальні", "Продукти", "Сад"].map((n) => iconTone(byName(n).color))).toEqual([
      "white",
      "white",
      "white",
      "ink",
    ]);
    expect(contrastRatio(WHITE, "#959FFE")).toBeLessThan(3);
    expect(contrastRatio(INK, "#959FFE")).toBeGreaterThan(3);
  });

  it("BUD-01@PoC FR 10: a custom group takes the tones of its type in turn (lead decision)", () => {
    expect(customGroupTone("expense", 0)).toBe("#5872D2");
    expect(customGroupTone("expense", 9)).toBe("#0E9161");
    expect([customGroupTone("income", 0), customGroupTone("income", 1)]).toEqual(["#BA4E84", "#BE590F"]);
  });
});

describe("BUD-01@PoC FR 11: «обов'язкова»", () => {
  it("BUD-01@PoC FR 11: on by default for «Оренда», «Комунальні», «Продукти», «Зв'язок», «Освіта», «Здоров'я» only; only expense categories have it", () => {
    expect(all.filter((c) => c.essential).map((c) => c.name)).toEqual([
      "Оренда",
      "Комунальні",
      "Продукти",
      "Зв'язок",
      "Здоров'я",
      "Освіта",
    ]);
    expect(all.every((c) => !c.essential || c.group.kind === "expense")).toBe(true);
  });
});

describe("BUD-01@PoC FR 2, FR 3, FR 8: names and merging", () => {
  it("BUD-01@PoC FR 2: a name is one trimmed line of 1–60 characters; names compare without case", () => {
    expect(categoryName("  Кава   на  винос ")).toBe("Кава на винос");
    expect(categoryName("")).toBeUndefined();
    expect(categoryName("   ")).toBeUndefined();
    expect(categoryName("а".repeat(61))).toBeUndefined();
    expect(categoryName("Кава\nчай")).toBeUndefined();
    expect(categoryName("Кава\u202Eчай")).toBeUndefined();
    expect(categoryName("Кава\u0007")).toBeUndefined();
    expect(sameName("ПРОДУКТИ", "продукти")).toBe(true);
  });

  it("BUD-01@PoC FR 8: only categories of one type merge; «Переказ» and «Коригування» never; the target is in use", () => {
    const side = (id: string, kind: "expense" | "income" | "service", state = "active" as const) => ({
      id,
      kind,
      state,
    });
    expect(mergeProblem(side("a", "expense"), side("b", "expense"))).toBeNull();
    expect(mergeProblem(side("a", "income"), side("b", "income"))).toBeNull();
    expect(mergeProblem(side("a", "expense"), side("b", "income"))).toBe("kinds_differ");
    expect(mergeProblem(side("a", "service"), side("b", "service"))).toBe("service");
    expect(mergeProblem(side("a", "expense"), side("a", "expense"))).toBe("same");
    expect(mergeProblem(side("a", "expense"), { id: "b", kind: "expense", state: "hidden" })).toBe(
      "target_hidden",
    );
  });

  it("BUD-01@PoC FR 3: after a merge a system category is hidden (edge case 5), a custom one taken out of use", () => {
    expect(stateAfterMerge(true)).toBe("hidden");
    expect(stateAfterMerge(false)).toBe("retired");
  });
});

describe("BUD-01@PoC FR 12: deleting a category", () => {
  it("BUD-01@PoC FR 12: a custom category is deleted only while empty; a system one never, empty or not", () => {
    expect(deleteProblem({ systemKey: null }, false)).toBeNull();
    expect(deleteProblem({ systemKey: null }, true)).toBe("not_empty");
    expect(deleteProblem({ systemKey: "travel" }, false)).toBe("system");
    expect(deleteProblem({ systemKey: "travel" }, true)).toBe("system");
  });
});
