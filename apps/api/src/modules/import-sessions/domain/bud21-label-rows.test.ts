import { describe, expect, it } from "vitest";
import { classifyRows, labelCounts, rowCategories, type HistoryRowFields } from "./index.ts";

/** BUD-21@PoC b) (wave 2 row 234): the rows of a history file and their labels, pure. Every value is synthetic. */
const row = (
  category: string | null,
  subcategory: string | null,
  amount: string,
  transferMark: string | null = null,
): HistoryRowFields => ({ date: "2026-03-01", amount, category, subcategory, transferMark, account: null });

describe("BUD-21@PoC FR 7: the labels of the rows read", () => {
  it("BUD-21@PoC FR 7: each label as printed with its rows' signs; a zero counts as negative; transfers have no label", () => {
    const { read } = classifyRows(
      [
        row("Їжа", "Супермаркети", "-120.50"),
        row("Їжа", "Супермаркети", "0.00"),
        row("Премія", null, "500.00"),
        row("Заощадження", null, "-1000.00", "переказ"),
      ],
      new Set(["переказ"]),
    );
    expect(labelCounts(read)).toEqual([
      { category: "Їжа", subcategory: "Супермаркети", negative: 2, positive: 0 },
      { category: "Премія", subcategory: null, negative: 0, positive: 1 },
    ]);
  });
});

describe("BUD-21@PoC edge cases of the rows", () => {
  it("BUD-21@PoC EC5: a row with a category and a transfer mark is a transfer: its label is not asked about", () => {
    const action = () => "skip" as const;
    const { read, summary } = classifyRows(
      [row("Кафе", null, "-5.00", "переказ")],
      new Set(["переказ"]),
      action,
    );
    expect(read[0]!.transfer).toBe(true);
    expect(summary.skipped).toEqual([]);
  });

  it("BUD-21@PoC EC12: rows of a label that is a transfer count as transfers; rows of «Коригування» are skipped with their reason", () => {
    const { summary } = classifyRows(
      [row("Переказ", null, "-100.00"), row("Коригування", null, "3.00"), row("Кафе", null, "-5.00")],
      new Set(),
      (category) => (category === "Переказ" ? "transfer" : category === "Коригування" ? "skip" : undefined),
    );
    expect(summary).toEqual({
      rows: 3,
      read: 2,
      transfers: 1,
      skipped: [{ reason: "service-category", count: 1 }],
      tagsSkipped: 0,
    });
  });
});

describe("BUD-21@PoC AC8: the confirmed labels for the derivation", () => {
  it("BUD-21@PoC AC8: every row of «Їжа · Супермаркети» matched with «Продукти» has «Продукти»; a transfer label has none", () => {
    const of = rowCategories([
      {
        variants: [
          { category: "Їжа", subcategory: "Супермаркети" },
          { category: "їжа", subcategory: "супермаркети" },
        ],
        action: "category",
        categoryId: "groceries",
      },
      { variants: [{ category: "Переказ", subcategory: null }], action: "transfer", categoryId: null },
    ]);
    const rows = Array.from({ length: 212 }, (_, i) =>
      i % 2 === 0 ? row("Їжа", "Супермаркети", "-1.00") : row("їжа", "супермаркети", "-1.00"),
    );
    expect(rows.filter((r) => of(r)?.categoryId === "groceries")).toHaveLength(212);
    expect(of(row("Переказ", null, "-1.00"))).toMatchObject({ action: "transfer", categoryId: null });
    expect(of(row("Дім", null, "-1.00"))).toBeNull();
  });
});
