import { describe, expect, it } from "vitest";
import { noteText, tagKey, tagName, tagNames, TAGS_PER_TRANSACTION_MAX } from "./attributes.ts";

/** BUD-13@PoC a) (wave 2 row 21): the rules of «Нотатка» and «Теги», without I/O. */
describe("BUD-13@PoC FR 1: «Нотатка» up to 2 000 characters", () => {
  it("BUD-13@PoC FR 1: a note of 2 000 characters is kept, 2 001 is refused, empty is none", () => {
    expect(noteText("  фарба і валики \r\n")).toBe("фарба і валики");
    expect(noteText("я".repeat(2000))).toHaveLength(2000);
    expect(noteText("я".repeat(2001))).toBeUndefined();
    expect(noteText("   ")).toBeNull();
    expect(noteText("рядок 1\nрядок 2")).toBe("рядок 1\nрядок 2");
    expect(noteText("bad\u0007")).toBeUndefined();
  });
});

describe("BUD-13@PoC FR 2: tags — trimmed, up to 60 characters, unique without regard to case, up to 20", () => {
  it("BUD-13@PoC FR 2: the ends are trimmed, 60 characters is the most, one line", () => {
    expect(tagName("  ремонт-кухні  ")).toBe("ремонт-кухні");
    expect(tagName("т".repeat(60))).toHaveLength(60);
    expect(tagName("т".repeat(61))).toBeUndefined();
    expect(tagName("   ")).toBeUndefined();
    expect(tagName("два\nрядки")).toBeUndefined();
  });

  it("BUD-13@PoC FR 2: «Ремонт» and «ремонт » are one tag; the first spelling is kept", () => {
    expect(tagKey("Ремонт")).toBe(tagKey(" ремонт "));
    expect(tagNames(["Ремонт", "ремонт ", "повернути"])).toEqual({ names: ["Ремонт", "повернути"] });
  });

  it("BUD-13@PoC FR 2: «Досягнуто 20 тегів» — 21 different tags are refused, 20 are kept", () => {
    const names = Array.from({ length: TAGS_PER_TRANSACTION_MAX + 1 }, (_, i) => `тег ${i}`);
    expect(tagNames(names.slice(0, 20))).toEqual({ names: names.slice(0, 20) });
    expect(tagNames(names)).toEqual({ issue: { field: "tags", issue: "too_many" } });
    // The same tag repeated is not «more».
    expect(tagNames([...names.slice(0, 20), "ТЕГ 0"])).toEqual({ names: names.slice(0, 20) });
    expect(tagNames(["ok", " "])).toEqual({ issue: { field: "tags.1", issue: "invalid" } });
  });
});
