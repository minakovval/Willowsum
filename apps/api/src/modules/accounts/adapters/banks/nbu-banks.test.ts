import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANK_REGISTRY_FILE, bankRegistry } from "./registry.ts";

/** FIN-01@PoC FR 4: the shipped directory file (adapters/banks/nbu-banks.json) — the guard of every update. */
describe("FIN-01@PoC FR 4: the shipped directory of NBU banks", () => {
  it("FIN-01@PoC FR 4: the file parses, every code is 6 digits and no code repeats, the source and its attribution are named", () => {
    const registry = bankRegistry();
    expect(registry.banks.length).toBeGreaterThan(0);
    const codes = registry.banks.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(registry.source.attribution).toMatch(/Національний банк України/);
    expect(registry.source.url).toMatch(/^https:\/\/bank\.gov\.ua\//);
    // The raw file has no duplicate code either (a parser bug must not hide one).
    const raw = JSON.parse(readFileSync(BANK_REGISTRY_FILE, "utf8")) as { banks: { code: string }[] };
    expect(new Set(raw.banks.map((b) => b.code)).size).toBe(raw.banks.length);
  });

  it("FIN-01@PoC AC22: the shipped directory has «ПриватБанк»", () => {
    expect(bankRegistry().banks.some((b) => b.name === "ПриватБанк")).toBe(true);
  });
});
