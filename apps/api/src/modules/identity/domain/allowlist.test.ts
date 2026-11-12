import { describe, expect, it } from "vitest";
import { normalizeEmail, signUpAllowlist } from "./index.ts";

/** ACC-01@PoC FR 16, AC27: the family's addresses, matched as login keys (trimmed, case-insensitive). Synthetic. */
describe("ACC-01 FR 16: sign-up only for the family's addresses", () => {
  it("AC27: «Olena@Example.TEST » matches a list entry «olena@example.test», and the other way round", () => {
    expect(signUpAllowlist(["olena@example.test"])(normalizeEmail(" Olena@Example.TEST "))).toBe(true);
    expect(signUpAllowlist([" Olena@Example.TEST "])(normalizeEmail("olena@example.test"))).toBe(true);
  });

  it("AC26: an address outside the list is not allowed, nor one that only contains a listed one", () => {
    const allowed = signUpAllowlist(["olena@example.test", "taras@example.test"]);
    for (const other of ["guest@example.test", "olena@example.test.evil", "xolena@example.test", ""])
      expect(allowed(normalizeEmail(other)), other).toBe(false);
  });

  it("no list (local development and CI only): every address", () => {
    expect(signUpAllowlist(undefined)("guest@example.test")).toBe(true);
  });

  it("an empty list allows nobody", () => {
    expect(signUpAllowlist([])("olena@example.test")).toBe(false);
  });
});
