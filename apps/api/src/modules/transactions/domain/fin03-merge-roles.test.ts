import { describe, expect, it } from "vitest";
import { issuesOfRequest, mergeRoles } from "./duplicates.ts";

/**
 * Who stays in «Об'єднати» of a manual and an imported transaction (the bank's posting is kept, the manual one's
 * category goes over to it), pure. The API's scenario is in apps/api/test/fin03-manual-imported-duplicate.it.test.ts.
 */
const manual = { id: "m", source: "manual" as const };
const bank = { id: "b", source: "imported" as const };

describe("mergeRoles: the bank's transaction stays", () => {
  it("acted on the manual one — the sides swap and the manual one is merged into the bank's", () => {
    expect(mergeRoles(manual, bank)).toEqual({
      kept: bank,
      duplicate: manual,
      swapped: true,
      intoBank: true,
    });
  });

  it("acted on the bank's — as asked, the manual one merged into it", () => {
    expect(mergeRoles(bank, manual)).toEqual({
      kept: bank,
      duplicate: manual,
      swapped: false,
      intoBank: true,
    });
  });

  it("two manual or two imported ones — the one acted on stays, nothing to carry", () => {
    const other = { id: "m2", source: "manual" as const };
    expect(mergeRoles(manual, other)).toEqual({
      kept: manual,
      duplicate: other,
      swapped: false,
      intoBank: false,
    });
    const bank2 = { id: "b2", source: "imported" as const };
    expect(mergeRoles(bank, bank2)).toEqual({
      kept: bank,
      duplicate: bank2,
      swapped: false,
      intoBank: false,
    });
  });
});

describe("issuesOfRequest: each issue names the field of the request", () => {
  it("swapped — transactionId and duplicateId trade places; another field stays", () => {
    expect(
      issuesOfRequest(
        [
          { field: "duplicateId", issue: "split" },
          { field: "transactionId", issue: "pending" },
          { field: "amount", issue: "invalid" },
        ],
        true,
      ),
    ).toEqual([
      { field: "transactionId", issue: "split" },
      { field: "duplicateId", issue: "pending" },
      { field: "amount", issue: "invalid" },
    ]);
  });

  it("not swapped — as they are", () => {
    const issues = [{ field: "duplicateId", issue: "hidden" }] as const;
    expect(issuesOfRequest(issues, false)).toEqual(issues);
  });
});
