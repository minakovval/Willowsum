import { describe, expect, it } from "vitest";
import { MERCHANT_NAME_MAX, normalizeDescription } from "./index.ts";

/**
 * Security review of PR #305 (BUD-14 a): a bank description is untrusted text (a payer chooses the name of a transfer,
 * a user types a counterparty of up to 200 characters), and every description of a space is normalised on each
 * GET /v1/merchants in the API process. Normalising one must take bounded time and give a row the schema accepts.
 */
describe("BUD-14@PoC FR 1: normalising an untrusted bank description is bounded", () => {
  const crafted = [
    // On e038a3d this one takes ~2 s; the 200-character ones below never finish (the API process hangs).
    `1234${"*".repeat(34)}a`,
    `1234${"*".repeat(195)}a`,
    `${"*".repeat(199)}a`,
    `${"X".repeat(199)}!`,
    `1234 ${"x-".repeat(97)}a`,
    `${"•".repeat(199)}Z`,
    `${"*X".repeat(99)}-a`,
  ];

  it.each(crafted.map((s) => [s.slice(0, 12), s]))(
    "BUD-14@PoC FR 1: a 200-character crafted description «%s…» is normalised in under 100 ms",
    (_label, description) => {
      expect(description.length).toBeLessThanOrEqual(200);
      const started = performance.now();
      normalizeDescription(description);
      expect(performance.now() - started).toBeLessThan(100);
    },
  );

  it("BUD-14@PoC FR 1: card masks are still dropped after the fix", () => {
    expect(normalizeDescription("OKKO **1234")?.name).toBe("Okko");
    expect(normalizeDescription("XXXX4321 NOVA POSHTA")?.name).toBe("Nova Poshta");
    expect(normalizeDescription("444111******1234 ROZETKA")?.name).toBe("Rozetka");
    expect(normalizeDescription("SYNTH SHOP XX-XX-1234")?.name).toBe("Synth Shop");
  });

  it("BUD-14@PoC FR 1: any description of up to 200 characters gives a name and a key the schema accepts", () => {
    let seed = 305;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const alphabet = [
      "*",
      "X",
      "x",
      "•",
      "-",
      " ",
      "1",
      "9",
      "İ",
      "ﷺ",
      "ß",
      "Ä",
      "a",
      "Z",
      "‮",
      "😀",
      "ТОВ ",
      "PAYPAL *",
    ];
    for (let i = 0; i < 2000; i++) {
      let s = "";
      while (s.length < 1 + Math.floor(next() * 200)) s += alphabet[Math.floor(next() * alphabet.length)]!;
      s = s.slice(0, 200);
      const m = normalizeDescription(s);
      if (m === null) continue;
      expect([...m.name].length).toBeGreaterThanOrEqual(1);
      expect([...m.name].length).toBeLessThanOrEqual(MERCHANT_NAME_MAX);
      expect([...m.key].length).toBeGreaterThanOrEqual(1);
      expect([...m.key].length).toBeLessThanOrEqual(200);
    }
  });
});
