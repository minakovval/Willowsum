import { describe, expect, it } from "vitest";
import { maskedChecks } from "./decisions.ts";
import { accountFor } from "../domain/index.ts";

/** SEC #718: the import boundary drops a forged worker bank and the matcher picks only by a real tail. */
const D = ["4149", "4999", "1234", "5678"];
const fw = (s: string) =>
  [...s].map((c) => (/[0-9]/.test(c) ? String.fromCodePoint(0xff10 + Number(c)) : c)).join("");
const ar = (s: string) =>
  [...s].map((c) => (/[0-9]/.test(c) ? String.fromCodePoint(0x0660 + Number(c)) : c)).join("");
const bold = (s: string) =>
  [...s].map((c) => (/[0-9]/.test(c) ? String.fromCodePoint(0x1d7ce + Number(c)) : c)).join("");
const sup = (s: string) => [...s].map((c) => (/[0-9]/.test(c) ? "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)]! : c)).join("");
const variants = [
  `Revolut ${D.join(" ")}`,
  `Revolut ${D.join("-")}`,
  `Revolut${D.join("")}`,
  `Revolut ${D.join("​")}`,
  `Revolut ${D.join("­")}`,
  `Revolut ${fw(D.join(""))}`,
  `Revolut ${ar(D.join(""))}`,
  `Revolut ${bold(D.join(""))}`,
  `Revolut ${sup(D.join(""))}`,
  `Re1v2o3l4u5t6 7B8a9n0k1 2U3A4B5`,
  `UA21${"3223130000026007233566001"}`,
  `Bank ${"1".repeat(5)}`,
  `${"a".repeat(299)}1234512345`,
];

describe("SEC #718 probes: the import boundary", () => {
  it("maskedChecks strips a forged worker bank and an unknown bankInDirectory", () => {
    for (const v of variants) {
      const out = maskedChecks({
        account: { reasons: [] },
        flags: [],
        detected: { bank: v, bankInDirectory: false },
      } as never);
      expect(out.detected).toEqual({});
    }
    const out2 = maskedChecks({
      account: { reasons: [] },
      flags: [],
      detected: { bank: "Revolut", bankInDirectory: "yes" as never, accountMatch: "picked:abc" as never },
    } as never);
    expect(out2.detected).toEqual({ bank: "Revolut" });
  });
  it("accountFor never picks with a non-mask tail and ignores candidates not given", () => {
    expect(accountFor({ mask: "…12345" }, [{ accountId: "x", institution: null, last4: "2345" }])).toBeNull();
    expect(
      accountFor({ bank: "Revolut", mask: "1234" }, [{ accountId: "x", institution: null, last4: "1234" }]),
    ).toEqual({ kind: "none" });
  });
});
