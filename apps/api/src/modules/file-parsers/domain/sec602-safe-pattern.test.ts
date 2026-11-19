import { describe, expect, it } from "vitest";
import { compilePattern } from "./index.ts";

/** Security review of PR #602: the matcher's bounds (IMP-06@PoC FR 3; «ліміти довжини і часу»). */
describe("IMP-06@PoC FR 3: the pattern matcher's bounds (security review)", () => {
  const issue = (source: string) => {
    const result = compilePattern(source);
    return result.ok ? "ok" : result.issue;
  };
  const first = (source: string, text: string) => {
    const result = compilePattern(source);
    if (!result.ok) throw new Error(`«${source}»: ${result.issue}`);
    return result.pattern.match(text);
  };

  it("IMP-06@PoC FR 3: an open repeat's lower bound is at most 100 too", () => {
    expect(issue("a{100,}")).toBe("ok");
    expect(issue("a{101,}")).toBe("repeat-bound");
    expect(issue("a{9999,}")).toBe("repeat-bound");
    expect(issue("a{10000,}")).toBe("repeat-bound");
  });

  it("IMP-06@PoC FR 3: a named back-reference is refused as a back-reference", () => {
    expect(issue(String.raw`(a)\k<n>`)).toBe("backreference");
  });

  it("IMP-06@PoC FR 3: the first alternative and the lazy repeat win over a longer match", () => {
    expect(first("a|ab", "ab")).toEqual(["a"]);
    expect(first("(a+?)(a*)", "aaa")).toEqual(["aaa", "a", "aa"]);
    expect(first("a{1,3}?", "aaa")).toEqual(["a"]);
    expect(first("(ab|a)(c|bcd)?", "abcd")).toEqual(["abc", "ab", "c"]);
  });

  // Defect at 652ddc57: repeats are expanded, so a pattern of ≤ 200 characters compiles to ~20 000 instructions and
  // one match of 2000 characters takes 5–7 s (measured), not the «< 500 ms» the PR states. With the patch
  // (PATTERN_LIMITS.maxProgramCost) these are refused at validation (fixed in review round 1; was `it.fails`).
  it("IMP-06@PoC FR 3: a pattern whose expanded program is too large is refused", () => {
    const heavy = [
      `(?:${"()".repeat(93)}){100}b`,
      `(?:${"(a|)".repeat(47)}){100}b`,
      `(?:${Array(47).fill("(a)").join("|")}){100}b`,
      `(?:${Array(90).fill("a").join("|")}){100}b`,
      `(?:${"(".repeat(45)}a|${")".repeat(45)}){100}b`,
    ];
    for (const source of heavy) expect(issue(source), source).toBe("too-complex");
  });

  it("IMP-06@PoC FR 3: patterns a statement needs stay inside the program bound", () => {
    for (const source of [
      String.raw`Ref:\s*([A-Z0-9-]{1,40})`,
      String.raw`^(\d{2})\.(\d{2})\.(\d{4})\s+(.{0,100})\s+(-?[\d ]{1,20},\d{2})$`,
      "[A-Z]{2}[0-9]{2}[A-Z0-9 ]{10,34}",
      "x{100}",
      "(?:EUR|UAH|USD|PLN|GBP|CHF)",
      `${"a?".repeat(50)}${"a".repeat(50)}b`,
    ])
      expect(issue(source), source).toBe("ok");
  });
});
