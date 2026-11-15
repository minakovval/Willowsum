import { describe, expect, it } from "vitest";
import {
  CATEGORY_SOURCES,
  categoryAllowed,
  pickCategory,
  proposalApplies,
  refusal,
  UNCATEGORIZED,
} from "./index.ts";

/** BUD-01@PoC b) (wave 2 row 20): the category of a transaction — pure rules. Ids are synthetic. */
const RENT = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e0001";
const GROCERIES = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e0002";
const CAFES = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e0003";
const SUPERMARKETS = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e0004";

describe("BUD-01@PoC FR 1: «Без категорії» is a state, not a category", () => {
  it("BUD-01@PoC FR 1: a transaction without a category has none and the source «немає»", () => {
    expect(UNCATEGORIZED).toEqual({ categoryId: null, source: "none" });
    expect(pickCategory({})).toEqual(UNCATEGORIZED);
    expect(pickCategory({ rule: null, bank: undefined })).toEqual(UNCATEGORIZED);
  });

  it("BUD-01@PoC FR 1: a refund gets the category of the purchase — the type of a category is not checked against the sign", () => {
    // An expense category on an income (a refund) is allowed: categoryAllowed looks at the tree only.
    expect(categoryAllowed({ kind: "expense", state: "active" })).toBe(true);
    expect(categoryAllowed({ kind: "income", state: "active" })).toBe(true);
  });
});

describe("BUD-01@PoC FR 4: the priority of a transaction's category, its source kept", () => {
  it("BUD-01@PoC FR 4: manual > rule > the merchant's last manual > bank > dictionary > «Без категорії»; the first source with a category decides", () => {
    expect(CATEGORY_SOURCES).toEqual(["manual", "rule", "merchant", "bank", "dictionary", "none"]);
    const all = { manual: RENT, rule: GROCERIES, merchant: CAFES, bank: SUPERMARKETS, dictionary: GROCERIES };
    expect(pickCategory(all)).toEqual({ categoryId: RENT, source: "manual" });
    expect(pickCategory({ ...all, manual: null })).toEqual({ categoryId: GROCERIES, source: "rule" });
    expect(pickCategory({ merchant: CAFES, bank: SUPERMARKETS, dictionary: GROCERIES })).toEqual({
      categoryId: CAFES,
      source: "merchant",
    });
    expect(pickCategory({ bank: SUPERMARKETS, dictionary: GROCERIES })).toEqual({
      categoryId: SUPERMARKETS,
      source: "bank",
    });
    expect(pickCategory({ dictionary: GROCERIES })).toEqual({ categoryId: GROCERIES, source: "dictionary" });
  });

  it("BUD-01@PoC FR 4: an automatic proposal replaces only a category of a lower-priority source, never one set by hand", () => {
    const byBank = { categoryId: SUPERMARKETS, source: "bank" } as const;
    expect(proposalApplies(UNCATEGORIZED, byBank)).toBe(true);
    expect(proposalApplies(byBank, { categoryId: GROCERIES, source: "rule" })).toBe(true);
    expect(proposalApplies({ categoryId: GROCERIES, source: "rule" }, byBank)).toBe(false);
    expect(proposalApplies(byBank, { categoryId: GROCERIES, source: "dictionary" })).toBe(false);
    // A user's change is no proposal: it is written by setCategory, not through this rule.
    expect(proposalApplies(byBank, { categoryId: RENT, source: "manual" })).toBe(false);
    expect(proposalApplies(byBank, UNCATEGORIZED)).toBe(false);
  });

  it("BUD-01@PoC EC3: the bank changed the category after a manual change — the manual category stays", () => {
    const manual = { categoryId: CAFES, source: "manual" } as const;
    expect(proposalApplies(manual, { categoryId: SUPERMARKETS, source: "bank" })).toBe(false);
    expect(proposalApplies(manual, { categoryId: GROCERIES, source: "rule" })).toBe(false);
  });
});

describe("BUD-01@PoC FR 9: a transaction's category belongs to the space's tree", () => {
  it("BUD-01@PoC FR 9: unknown or of another space, merged away or a service one is refused; a hidden one is allowed", () => {
    expect(categoryAllowed(null)).toBe(false);
    expect(categoryAllowed({ kind: "expense", state: "retired" })).toBe(false);
    expect(categoryAllowed({ kind: "service", state: "active" })).toBe(false);
    expect(categoryAllowed({ kind: "expense", state: "hidden" })).toBe(true);
  });
});

describe("BUD-01@PoC FR 6: which transactions take a category of their own", () => {
  it("BUD-01@PoC FR 6: a split transaction has its parts' categories; a transfer side and a merged duplicate are refused too", () => {
    const plain = { transfer: false, split: false, merged: false };
    expect(refusal(plain)).toBeNull();
    expect(refusal({ ...plain, split: true })).toBe("split");
    expect(refusal({ ...plain, transfer: true })).toBe("in_transfer");
    expect(refusal({ ...plain, merged: true })).toBe("merged");
  });
});
