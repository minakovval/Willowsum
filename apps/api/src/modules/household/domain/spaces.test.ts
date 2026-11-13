import { describe, expect, it } from "vitest";
import { firstSpaceName, SPACE_NAME_MAX, spaceName } from "./index.ts";

describe("ACC-01 FR 7 / ACC-08 FR 1: the first space is «Родина <Прізвище>»", () => {
  it("the surname is the last word of the name", () => {
    expect(firstSpaceName("Олена Синтетична")).toBe("Родина Синтетична");
    expect(firstSpaceName("  Марія   Олена  Тестова ")).toBe("Родина Тестова");
  });

  it("ACC-08@PoC EC1: a one-word name gives «Родина <Ім'я>»", () => {
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

describe("ACC-08@PoC FR 5: a new name of the space", () => {
  it("ACC-08@PoC AC5: «Коваль і батьки» is saved as typed, trimmed and in NFC", () => {
    expect(spaceName("Коваль і батьки")).toBe("Коваль і батьки");
    expect(spaceName("  Коваль і батьки \n")).toBe("Коваль і батьки");
    // «й» typed as «и» + combining breve becomes the one composed character.
    expect(spaceName("Родина Гайова".replace("й", "й"))).toBe("Родина Гайова");
  });

  it("ACC-08@PoC AC5: an empty name, or one of whitespace only, is not saved", () => {
    expect(spaceName("")).toBeNull();
    expect(spaceName("   \t ")).toBeNull();
  });

  it("ACC-08@PoC AC5: 60 characters are saved, 61 are not (code points: an emoji is one character)", () => {
    expect(spaceName("Д".repeat(SPACE_NAME_MAX))).toBe("Д".repeat(60));
    expect(spaceName("Д".repeat(SPACE_NAME_MAX + 1))).toBeNull();
    expect(spaceName("😀".repeat(60))).toBe("😀".repeat(60));
    expect(spaceName("😀".repeat(61))).toBeNull();
  });

  it("a name is one line: control characters are not saved; uniqueness is not required", () => {
    expect(spaceName("Коваль\nі батьки")).toBeNull();
    expect(spaceName("Коваль\u0000")).toBeNull();
    expect(spaceName("Родина Коваль")).toBe("Родина Коваль");
  });
});
