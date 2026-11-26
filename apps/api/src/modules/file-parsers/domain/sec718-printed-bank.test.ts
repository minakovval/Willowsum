import { describe, expect, it } from "vitest";
import { bankName, detectAccount, printedBank } from "./index.ts";

/** SEC #718: a printed bank name never carries a card or IBAN number, whatever digits it is written with. */
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
const digitCount = (s: string) => (s.normalize("NFKC").match(/\p{Nd}/gu) ?? []).length;

describe("SEC #718 probes: the printed bank in the worker", () => {
  it("bankName drops every variant with more than 4 digits", () => {
    for (const v of variants) expect(bankName(v), v).toBeNull();
  });
  it("printedBank (label, colon, word) never returns more than 4 digits", () => {
    for (const v of variants) {
      for (const pre of [
        [["Bank", v]],
        [[`Bank: ${v}`]],
        [[`Банк：${v}`]],
        [[`${v} Bank`]],
        [["Назва банку", v]],
      ]) {
        const out = printedBank(pre);
        if (out !== null) expect(digitCount(out), `${v} → ${out}`).toBeLessThanOrEqual(4);
        const d = detectAccount(pre, [], []);
        expect(JSON.stringify(d)).not.toMatch(/\d{5}/);
      }
    }
  });
});
