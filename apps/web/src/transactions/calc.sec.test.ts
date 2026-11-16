import { describe, expect, it } from "vitest";
import { EXPRESSION_MAX_LENGTH, evaluate } from "./calc.ts";
describe("BUD-13 FR 7 calculator: security properties", () => {
  it("adds exactly in decimals, never in floats", () => {
    expect(evaluate("0,1+0,2")!.toFixed()).toBe("0.3");
    expect(evaluate("0.1+0.2", false)!.toFixed()).toBe("0.3");
    expect(evaluate("99999999999999999999,99+0,01")!.toFixed()).toBe("100000000000000000000");
  });
  it("rejects anything that is not a number, an operator or a bracket", () => {
    for (const s of [
      "1e5",
      "alert(1)",
      "constructor",
      "__proto__",
      "Infinity",
      "NaN",
      "0x10",
      "1/0",
      "١٢",
      "1..2",
      "(1",
      ")1(",
      "toString",
      "1)",
      "(1)2",
      "2(3)",
    ])
      expect(evaluate(s)).toBeNull();
  });
  it("returns null, not a RangeError, for input over the bound", () => {
    const deep = "(".repeat(200000) + "1" + ")".repeat(200000);
    expect(() => evaluate(deep)).not.toThrow();
    expect(evaluate(deep)).toBeNull();
    expect(evaluate("-".repeat(200000) + "1")).toBeNull();
    expect(evaluate("1+".repeat(EXPRESSION_MAX_LENGTH) + "1")).toBeNull();
    expect(evaluate("1".repeat(EXPRESSION_MAX_LENGTH))).not.toBeNull();
  });
});
