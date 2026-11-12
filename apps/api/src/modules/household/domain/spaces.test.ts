import { describe, expect, it } from "vitest";
import { firstSpaceName, SPACE_NAME_MAX } from "./index.ts";

describe("ACC-01 FR 7 / ACC-08 FR 1: the first space is «Родина <Прізвище>»", () => {
  it("the surname is the last word of the name", () => {
    expect(firstSpaceName("Олена Синтетична")).toBe("Родина Синтетична");
    expect(firstSpaceName("  Марія   Олена  Тестова ")).toBe("Родина Тестова");
  });

  it("ACC-08 edge case: a one-word name gives «Родина <Ім'я>»", () => {
    expect(firstSpaceName("Олена")).toBe("Родина Олена");
  });

  it("ACC-08 FR 5: at most 60 characters, counted as code points (a surrogate pair is never split)", () => {
    const long = firstSpaceName(`Ім'я ${"Д".repeat(100)}`);
    expect([...long]).toHaveLength(SPACE_NAME_MAX);
    expect(long.startsWith("Родина ДДД")).toBe(true);
    const emoji = firstSpaceName(`Ім'я ${"😀".repeat(80)}`);
    expect([...emoji]).toHaveLength(SPACE_NAME_MAX);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
