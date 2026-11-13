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
  it("joins only a standalone three-letter code, not the end of a longer word", () => {
    expect(keepNumbersTogether("ABCD 5")).toBe("ABCD 5");
    expect(keepNumbersTogether("Сума EUR 5")).toBe(`Сума EUR${NB}5`);
  });
  it("does not touch a placeholder left in text or spaces next to braces", () => {
    expect(keepNumbersTogether("{count} днів, {amount} €")).toBe("{count} днів, {amount} €");
  });
  it("only changes spaces in text that merely contains digits", () => {
    const input = "Windows 10 Pro, PIN 1234, Крок 1 з 3";
    const out = keepNumbersTogether(input);
    expect(out.replaceAll(NB, " ")).toBe(input);
    expect(out).toBe(`Windows 10${NB}Pro, PIN${NB}1234, Крок 1${NB}з 3`);
  });
  it("DS-08@PoC AC7: «30 днів» and «3 дні» never break between the number and the word", () => {
    const out = keepNumbersTogether("Строк дії спливає через 30 днів, нагадування за 3 дні");
    expect(out).toBe(`Строк дії спливає через 30${NB}днів, нагадування за 3${NB}дні`);
    // The other spaces still allow the line to wrap.
    expect(out).toContain("спливає через");
  });
});
