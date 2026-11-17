import { describe, expect, it } from "vitest";
import {
  frequentCategories,
  lastManualCategory,
  recentCategories,
  TOP_CATEGORIES_MAX,
  topCategories,
  type HistoryRow,
} from "./index.ts";

/** FIN-03@PoC FR 30, FR 31: the category hints of «Нова транзакція», pure rules. Synthetic names only. */
const all = () => true;
const row = (
  merchant: string | null,
  categoryId: string,
  source: HistoryRow["source"] = "manual",
): HistoryRow => ({
  merchant,
  categoryId,
  source,
});

describe("FIN-03@PoC FR 30: «як раніше» — the last category set by hand for the merchant", () => {
  it("FIN-03@PoC FR 30: the newest row of the merchant set by hand decides; a rule's or the bank's category does not", () => {
    const history = [
      row("Синт Маркет", "c-rule", "rule"),
      row("Інший Синт", "c-other"),
      row("Синт Маркет", "c-new"),
      row("Синт Маркет", "c-old"),
    ];
    expect(lastManualCategory(history, "Синт Маркет", all)).toBe("c-new");
    expect(lastManualCategory([row("Синт Маркет", "c-bank", "bank")], "Синт Маркет", all)).toBeNull();
    expect(lastManualCategory(history, "Невідомий", all)).toBeNull();
  });

  it("FIN-03@PoC FR 30: a category that no longer fits (hidden, merged, another type) is skipped for an older one", () => {
    const history = [row("Синт Маркет", "c-hidden"), row("Синт Маркет", "c-ok")];
    expect(lastManualCategory(history, "Синт Маркет", (id) => id !== "c-hidden")).toBe("c-ok");
  });
});

describe("FIN-03@PoC FR 31: the first group of «Категорія»", () => {
  it("FIN-03@PoC FR 31: «Часто для <мерчанта>» — the most used first, a tie to the most recent, at most 3", () => {
    const history = [
      row("Синт Маркет", "c-b", "rule"),
      row("Синт Маркет", "c-a"),
      row("Інший Синт", "c-x"),
      row("Синт Маркет", "c-a"),
      row("Синт Маркет", "c-c"),
      row("Синт Маркет", "c-d"),
      row("Синт Маркет", "c-b"),
    ];
    expect(frequentCategories(history, "Синт Маркет", all)).toEqual(["c-b", "c-a", "c-c"]);
    expect(TOP_CATEGORIES_MAX).toBe(3);
    expect(topCategories(history, "Синт Маркет", all)).toEqual({
      kind: "frequent",
      merchant: "Синт Маркет",
      categoryIds: ["c-b", "c-a", "c-c"],
    });
  });

  it("FIN-03@PoC FR 31: «Нещодавні» without a known counterparty — distinct, newest first, only those that fit", () => {
    const history = [
      row("А", "c-1"),
      row("Б", "c-1"),
      row(null, "c-2"),
      row("В", "c-skip"),
      row("Г", "c-3"),
      row("Д", "c-4"),
    ];
    const fits = (id: string) => id !== "c-skip";
    expect(recentCategories(history, fits)).toEqual(["c-1", "c-2", "c-3"]);
    expect(topCategories(history, null, fits)).toEqual({
      kind: "recent",
      merchant: null,
      categoryIds: ["c-1", "c-2", "c-3"],
    });
  });

  it("FIN-03@PoC FR 31: a known merchant with nothing to show gives «Нещодавні» (an empty group is not shown)", () => {
    const history = [row("Інший Синт", "c-x")];
    expect(topCategories(history, "Синт Маркет", all)).toEqual({
      kind: "recent",
      merchant: null,
      categoryIds: ["c-x"],
    });
    expect(topCategories([], null, all)).toEqual({ kind: "recent", merchant: null, categoryIds: [] });
  });
});
