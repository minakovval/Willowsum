import { describe, expect, it } from "vitest";
import { withTransferCategory, type HistorySourceRow } from "./derivations.ts";
import { deriveSuggestions, type DerivationRow } from "../domain/history-derivation.ts";
import { categoryAllowed, isTransferCategory } from "../domain/transaction-category.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» d) (wave 2 row 236): the transfer rows of a history file take «Переказ» and
 * go through the same engine with the same thresholds (FR 16, EC11); «категорія „Переказ“» is a rule's action, never a
 * category a transaction takes from a rule. Every row is synthetic; categories are opaque ids.
 */
const TRANSFER = "00000000-0000-4000-8000-0000000000aa";
const GROCERIES = "00000000-0000-4000-8000-000000000001";

let next = 1;
const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
function source(over: Partial<HistorySourceRow>): HistorySourceRow {
  const n = next++;
  return {
    row: n,
    date: day(n),
    amount: "-1000.00",
    currency: "UAH",
    counterparty: null,
    description: null,
    shown: null,
    accountId: null,
    categoryId: null,
    transfer: true,
    tags: [],
    ...over,
  };
}
const asRow = (r: HistorySourceRow & { categoryId: string }, merchant: string | null): DerivationRow => ({
  row: r.row,
  date: r.date,
  amount: r.amount,
  currency: r.currency,
  merchant,
  description: r.description,
  accountId: r.accountId,
  categoryId: r.categoryId,
  tags: r.tags,
});
const times = <T>(n: number, make: () => T) => Array.from({ length: n }, make);
const derive = (rows: readonly HistorySourceRow[], merchant: (r: HistorySourceRow) => string | null) =>
  deriveSuggestions(withTransferCategory(rows, TRANSFER).map((r) => asRow(r, merchant(r))));

describe("BUD-21@PoC FR 16: the transfer rows through the same engine", () => {
  it("BUD-21@PoC FR 16: a transfer row takes «Переказ», a categorised row keeps its category; without «Переказ» the transfer rows are left out", () => {
    const rows = [source({}), source({ transfer: false, categoryId: GROCERIES })];
    expect(withTransferCategory(rows, TRANSFER).map((r) => r.categoryId)).toEqual([TRANSFER, GROCERIES]);
    expect(withTransferCategory(rows, null).map((r) => r.categoryId)).toEqual([GROCERIES]);
  });

  it("BUD-21@PoC FR 16: 6 transfer rows «На свою картку» give a confident suggestion «категорія „Переказ“» with the same thresholds as a category — 2 rows give none", () => {
    const rows = [
      ...times(6, () => source({ description: "На свою картку" })),
      ...times(2, () => source({ description: "Скарбничка" })),
      ...times(5, () => source({ transfer: false, categoryId: GROCERIES, description: "SILPO" })),
    ];
    const out = derive(rows, (r) => r.description);
    const own = out.find((s) => s.conditions[0]?.value === "На свою картку");
    expect(own).toMatchObject({ kind: "confident", categoryId: TRANSFER, matched: 6, agreeing: 6 });
    expect(out.find((s) => s.conditions[0]?.value === "Скарбничка")).toBeUndefined();
    expect(out.find((s) => s.conditions[0]?.value === "SILPO")).toMatchObject({ categoryId: GROCERIES });
  });

  it("BUD-21@PoC FR 16: a merchant whose rows are partly transfers is as mixed as with two categories — 4 transfers of 5 are «суперечлива», the other row an exception", () => {
    const rows = [
      ...times(2, () => source({ description: "KESHBEK" })),
      source({ transfer: false, categoryId: GROCERIES, description: "KESHBEK" }),
      ...times(2, () => source({ description: "KESHBEK" })),
    ];
    const [s] = derive(rows, (r) => r.description);
    expect(s).toMatchObject({ kind: "conflicting", categoryId: TRANSFER, matched: 5, agreeing: 4 });
    expect(s!.exceptions).toEqual([rows[2]!.row]);
  });

  it("BUD-21@PoC EC11: every row a transfer — every suggestion has «Переказ»", () => {
    const rows = [
      ...times(5, () => source({ description: "На свою картку" })),
      ...times(3, () => source({ description: "Копілка" })),
    ];
    const out = derive(rows, (r) => r.description);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.categoryId === TRANSFER)).toBe(true);
  });
});

describe("BUD-21@PoC FR 16: «категорія „Переказ“» is a rule's action, not a category a rule gives", () => {
  it("BUD-21@PoC FR 16: only the service «Переказ» is the transfer action; it is still no category a transaction takes", () => {
    const transfer = { kind: "service", state: "active", systemKey: "transfer" } as const;
    expect(isTransferCategory(transfer)).toBe(true);
    expect(categoryAllowed(transfer)).toBe(false);
    expect(isTransferCategory({ kind: "service", state: "active", systemKey: "adjustment" })).toBe(false);
    expect(isTransferCategory({ kind: "expense", state: "active", systemKey: null })).toBe(false);
    expect(isTransferCategory({ kind: "expense", state: "active" })).toBe(false);
    expect(isTransferCategory(null)).toBe(false);
  });
});
