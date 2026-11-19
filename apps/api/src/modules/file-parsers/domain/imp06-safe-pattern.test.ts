import { describe, expect, it } from "vitest";
import { compilePattern, PATTERN_LIMITS } from "./index.ts";

/** IMP-06@PoC FR 3: the recipe's patterns are a safe dialect run by the engine's own matcher, never by `eval`. */
describe("IMP-06@PoC FR 3: the safe pattern dialect", () => {
  const ok = (source: string) => {
    const result = compilePattern(source);
    if (!result.ok) throw new Error(`expected «${source}» to compile, got ${result.issue}`);
    return result.pattern;
  };
  const issue = (source: string) => {
    const result = compilePattern(source);
    return result.ok ? "ok" : result.issue;
  };

  it("IMP-06@PoC FR 3: literals, escapes, classes, groups, alternation and bounded repeats are allowed", () => {
    for (const source of [
      "^Разом",
      String.raw`\d{2}\.\d{2}\.\d{4}`,
      "[A-Z]{2}[0-9]{2}",
      "(?:EUR|UAH|USD)",
      String.raw`Ref:\s*([A-Z0-9-]{1,40})`,
      "[^;]+",
      String.raw`a\-b\(c\)`,
      "x{100}",
    ])
      expect(issue(source), source).toBe("ok");
  });

  it("IMP-06@PoC FR 3: back-references are refused", () => {
    expect(issue(String.raw`(a)\1`)).toBe("backreference");
    expect(issue(String.raw`(?<n>a)\k<n>`)).not.toBe("ok");
  });

  it("IMP-06@PoC FR 3: look-ahead and look-behind are refused", () => {
    for (const source of ["a(?=b)", "a(?!b)", "(?<=a)b", "(?<!a)b"]) expect(issue(source)).toBe("lookaround");
  });

  it("IMP-06@PoC FR 3: Unicode classes are refused", () => {
    expect(issue(String.raw`\p{L}+`)).toBe("unicode-class");
    expect(issue(String.raw`[\P{Lu}]`)).toBe("unicode-class");
  });

  it("IMP-06@PoC FR 3: at most 3 unbounded repeats", () => {
    expect(issue("a+b*c+")).toBe("ok");
    expect(issue("a+b*c+d{2,}")).toBe("too-many-unbounded");
  });

  it("IMP-06@PoC FR 3: no nested repeats", () => {
    expect(issue("(a+)+")).toBe("nested-repeat");
    expect(issue("(?:ab{1,3})*")).toBe("nested-repeat");
    expect(issue("(ab)+")).toBe("ok");
  });

  it("IMP-06@PoC FR 3: a repeat's upper bound is at most 100", () => {
    expect(issue("a{1,100}")).toBe("ok");
    expect(issue("a{1,101}")).toBe("repeat-bound");
    expect(issue("a{101}")).toBe("repeat-bound");
    expect(issue("a{5,2}")).toBe("syntax");
  });

  it("IMP-06@PoC FR 3: a pattern is at most 200 characters", () => {
    expect(issue("a".repeat(PATTERN_LIMITS.maxLength))).toBe("ok");
    expect(issue("a".repeat(PATTERN_LIMITS.maxLength + 1))).toBe("too-long");
  });

  it("IMP-06@PoC FR 3: malformed patterns are a syntax issue, not a crash", () => {
    for (const source of ["(", "a)", "[abc", "*a", "a**", "a{2", String.raw`\q`, "", "a|*"])
      expect(issue(source), source).toBe("syntax");
  });

  it("IMP-06@PoC FR 3: matching ignores case and returns the groups", () => {
    const pattern = ok(String.raw`ref:\s*([a-z0-9]{1,10})`);
    expect(pattern.groups).toBe(1);
    expect(pattern.match("Оплата REF: AB12 кава")).toEqual(["REF: AB12", "AB12"]);
    expect(ok("^разом").match("РАЗОМ за період")).toEqual(["РАЗОМ"]);
    expect(ok("^разом").match("Не разом")).toBeNull();
    expect(ok("ab|a").match("xab")).toEqual(["ab"]);
    expect(ok("(a)|(b)").match("b")).toEqual(["b", null, "b"]);
    expect(ok("[а-я]+").match("КАВА")).toEqual(["КАВА"]);
    expect(ok(String.raw`\bUA\d{2}`).match("IBAN UA12")).toEqual(["UA12"]);
    expect(ok("a$").match("ba")).toEqual(["a"]);
  });

  it("IMP-06@PoC FR 3: the text is cut to 2000 / 2000 / 400 / 120 characters for 0 / 1 / 2 / 3 unbounded repeats", () => {
    expect(PATTERN_LIMITS.inputChars).toEqual([2000, 2000, 400, 120]);
    const tail = (unbounded: string, at: number) => ok(unbounded).match(`${"x".repeat(at - 1)}Z`);
    expect(tail("z$", 2000)).not.toBeNull();
    expect(tail("z$", 2001)).toBeNull();
    expect(tail("x*z", 2000)).not.toBeNull();
    expect(tail("x*z", 2001)).toBeNull();
    expect(tail("x*y*z", 400)).not.toBeNull();
    expect(tail("x*y*z", 401)).toBeNull();
    expect(tail("x*y*w*z", 120)).not.toBeNull();
    expect(tail("x*y*w*z", 121)).toBeNull();
  });

  it("IMP-06@PoC FR 3: a pattern whose expanded program is too costly is refused (the time limit)", () => {
    for (const source of [
      `(?:${"()".repeat(93)}x){100}z`,
      `(?:${"x|".repeat(44)}x){100}z`,
      `(?:${"()".repeat(40)}[a-z]){100}z`,
    ])
      expect(issue(source), source).toBe("too-complex");
  });

  it("IMP-06@PoC FR 3: crafted patterns run in bounded time (no backtracking)", () => {
    const crafted: [string, string][] = [
      [`${"a?".repeat(50)}${"a".repeat(50)}b`, "a".repeat(2000)],
      ["(?:a|a)(?:a|a)(?:a|a)a{0,100}a{0,100}a{0,100}b", "a".repeat(2000)],
      ["x*x*x*y", "x".repeat(5000)],
    ];
    for (const [source, text] of crafted) {
      const pattern = ok(source);
      const started = performance.now();
      expect(pattern.match(text)).toBeNull();
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});
