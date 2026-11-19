// Security review of #619 (confirmation): the header a column carries out of the worker is cut by itself, not only by
// the 2 MiB ceiling of the whole answer (ARC-06@PoC FR 4).
import { describe, expect, it } from "vitest";
import { ANALYSIS_LIMITS, analyzeTable } from "./index.ts";

describe("ARC-06@PoC FR 4: a column's header in the analysis is bounded", () => {
  it("ARC-06@PoC FR 4: a 500-character header comes back as its first 120 characters and still names the role", () => {
    const a = analyzeTable(
      [
        [`amount ${"x".repeat(500)}`, "date"],
        ["1,50", "01.03.2026"],
        ["2,50", "02.03.2026"],
      ],
      0,
      0,
    );
    expect(a.columns[0]!.header).toHaveLength(ANALYSIS_LIMITS.headerChars);
    expect(ANALYSIS_LIMITS.headerChars).toBe(120);
    expect(a.columns[0]!.role.chosen.value).toBe("amount");
  });
});
