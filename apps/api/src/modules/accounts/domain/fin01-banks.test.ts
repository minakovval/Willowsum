import { describe, expect, it } from "vitest";
import {
  BANK_COUNTRY,
  bankInstitution,
  displayNameOf,
  importNbuBanks,
  institutionOf,
  parseBankRegistry,
  searchBanks,
} from "./index.ts";

/** FIN-01@PoC FR 4: the built-in directory of NBU banks and «Інша установа». Synthetic file contents only. */
const source = {
  name: "Національний банк України — перелік банків",
  url: "https://bank.gov.ua/NBU_BankInfo/get_data_branch_glbank?json",
  licence: "Відкриті дані",
  attribution: "Джерело: Національний банк України (bank.gov.ua)",
};
const file = (banks: unknown[], extra: Record<string, unknown> = {}) => ({
  registry: "nbu-banks",
  seed: true,
  asOf: "2026-11-16",
  source,
  banks,
  ...extra,
});
const registry = parseBankRegistry(
  file([
    { code: "305299", name: "ПриватБанк" },
    { code: "300465", name: "Ощадбанк" },
    { code: "300346", name: "Сенс Банк" },
    { code: "322001", name: "Універсал Банк (monobank)", legalName: 'АТ "УНІВЕРСАЛ БАНК"' },
  ]),
);

describe("FIN-01@PoC FR 4: the directory of banks by the NBU list", () => {
  it("FIN-01@PoC AC22: «Приват» finds «ПриватБанк»; picked from the directory, the country is «Україна»", () => {
    const hits = searchBanks(registry, "Приват");
    expect(hits.map((b) => b.name)).toEqual(["ПриватБанк"]);
    expect(bankInstitution(hits[0]!)).toEqual({ name: "ПриватБанк", country: "UA" });
    expect(BANK_COUNTRY).toBe("UA");
  });

  it("FIN-01@PoC FR 4: search ignores case and quotes, matches the legal name, names starting with the text first", () => {
    expect(searchBanks(registry, "  привАТ ").map((b) => b.code)).toEqual(["305299"]);
    expect(searchBanks(registry, '"універсал').map((b) => b.code)).toEqual(["322001"]);
    expect(searchBanks(registry, "mono").map((b) => b.code)).toEqual(["322001"]);
    expect(searchBanks(registry, "банк").map((b) => b.name)).toEqual([
      "Ощадбанк",
      "ПриватБанк",
      "Сенс Банк",
      "Універсал Банк (monobank)",
    ]);
    expect(searchBanks(registry, "о").map((b) => b.name)[0]).toBe("Ощадбанк");
    expect(searchBanks(registry, "").length).toBe(4);
    expect(searchBanks(registry, "Revolut")).toEqual([]);
  });

  it("FIN-01@PoC AC22: «Інша установа» is a name and a country by hand and leaves the directory unchanged", () => {
    const before = JSON.stringify(registry);
    expect(institutionOf({ name: "Revolut", country: "LT" })).toEqual({ name: "Revolut", country: "LT" });
    expect(JSON.stringify(registry)).toBe(before);
    expect(searchBanks(registry, "Revolut")).toEqual([]);
  });

  it("FIN-01@PoC FR 4: a broken file is refused — duplicate code, a code not of 6 digits, a bad name, no banks", () => {
    expect(() =>
      parseBankRegistry(
        file([
          { code: "305299", name: "ПриватБанк" },
          { code: "305299", name: "Інший" },
        ]),
      ),
    ).toThrow(/duplicate code 305299/);
    expect(() => parseBankRegistry(file([{ code: "30529", name: "ПриватБанк" }]))).toThrow(/code/);
    expect(() => parseBankRegistry(file([{ code: "305299", name: " ПриватБанк" }]))).toThrow(/name/);
    expect(() => parseBankRegistry(file([{ code: "305299", name: "a\nb" }]))).toThrow(/name/);
    expect(() => parseBankRegistry(file([{ code: "305299", name: "x".repeat(101) }]))).toThrow(/name/);
    expect(() => parseBankRegistry(file([]))).toThrow(/no banks/);
    expect(() =>
      parseBankRegistry(file([{ code: "305299", name: "ПриватБанк" }], { asOf: "16.11.2026" })),
    ).toThrow(/asOf/);
    expect(() =>
      parseBankRegistry({ ...file([{ code: "305299", name: "ПриватБанк" }]), source: undefined }),
    ).toThrow(/source/);
  });
});

describe("FIN-01@PoC FR 4: the update from the NBU list (scripts/nbu-banks.ts)", () => {
  it("FIN-01@PoC FR 4: keeps curated names, derives new ones, leaves out banks not «Нормальний», reports added and removed", () => {
    const rows = [
      { GLMFO: 305299, SHORTNAME: 'АТ КБ "ПРИВАТБАНК"', N_STAN: "Нормальний" },
      { GLMFO: "380805", SHORTNAME: 'АТ "Райффайзен Банк"', N_STAN: "Нормальний" },
      { GLMFO: 300346, SHORTNAME: 'АТ "СЕНС БАНК"', N_STAN: "Ліквідація" },
      { MFO: 322001, SHORTNAME: 'АТ "УНІВЕРСАЛ БАНК"' },
      { GLMFO: 305299, SHORTNAME: "дубль" },
      { GLMFO: "abc", SHORTNAME: "АТ «Хибний»" },
      "not a row",
    ];
    const result = importNbuBanks(rows, registry, "2026-12-01");
    expect(result.registry.banks).toEqual([
      { code: "305299", name: "ПриватБанк", legalName: 'АТ КБ "ПРИВАТБАНК"' },
      { code: "380805", name: "Райффайзен Банк", legalName: 'АТ "Райффайзен Банк"' },
      { code: "322001", name: "Універсал Банк (monobank)", legalName: 'АТ "УНІВЕРСАЛ БАНК"' },
    ]);
    expect(result.registry).toMatchObject({ asOf: "2026-12-01", seed: false, source });
    expect(result.added).toEqual(["380805"]);
    expect(result.removed).toEqual(["300465", "300346"]);
    // The result is a valid directory file again.
    expect(parseBankRegistry({ registry: "nbu-banks", ...result.registry }).banks).toHaveLength(3);
  });

  it("FIN-01@PoC FR 4: a display name is the NBU short name without the legal form and quotes", () => {
    expect(displayNameOf('АТ "Райффайзен Банк"')).toBe("Райффайзен Банк");
    expect(displayNameOf("ПУБЛІЧНЕ АКЦІОНЕРНЕ ТОВАРИСТВО «Банк Приклад»")).toBe("Банк Приклад");
    expect(displayNameOf('АТ АКБ "КОНКОРД"')).toBe("КОНКОРД");
    // Forms seen in the NBU list of 2026-11-16.
    expect(displayNameOf('АБ "УКРГАЗБАНК"')).toBe("УКРГАЗБАНК");
    expect(displayNameOf('АТ "АБ "РАДАБАНК"')).toBe("РАДАБАНК");
    expect(displayNameOf('ПуАТ "КБ "АКОРДБАНК"')).toBe("АКОРДБАНК");
    expect(displayNameOf('Акціонерний банк "Південний"')).toBe("Південний");
    expect(displayNameOf("ПрАТ “ПЕРЕХІДНИЙ БАНК “ЮТЕ БАНК”")).toBe("ПЕРЕХІДНИЙ БАНК ЮТЕ БАНК");
    expect(displayNameOf("Полікомбанк")).toBe("Полікомбанк");
    expect(displayNameOf('АТ "БАНК 3/4"')).toBe("БАНК 3/4");
    expect(displayNameOf('АТ "АТБ Інвест"')).toBe("АТБ Інвест");
  });
});
