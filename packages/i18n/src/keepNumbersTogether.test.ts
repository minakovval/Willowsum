import { describe, expect, it } from "vitest";
import { keepNumbersTogether } from "./keepNumbersTogether.ts";

const NB = " ";

describe("keepNumbersTogether (DS-08 item 11)", () => {
  it("joins digit groups, currency and sign", () => {
    expect(keepNumbersTogether("Залишок € 12 345 678,90")).toBe(`Залишок €${NB}12${NB}345${NB}678,90`);
  });
  it("joins a number with its unit word or percent", () => {
    expect(keepNumbersTogether("через 30 днів, за 3 дні, 15 %")).toBe(
      `через 30${NB}днів, за 3${NB}дні, 15${NB}%`,
    );
  });
  it("joins ISO currency codes", () => {
    expect(keepNumbersTogether("UAH 5 000")).toBe(`UAH${NB}5${NB}000`);
  });
  it("leaves ordinary words untouched", () => {
    expect(keepNumbersTogether("Тут поки нічого немає")).toBe("Тут поки нічого немає");
  });
});
