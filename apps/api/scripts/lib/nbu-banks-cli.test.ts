import { describe, expect, it } from "vitest";
import { kyivDate, listDate, mayDownload, parseNbuBanksCommand } from "./nbu-banks-cli.ts";

/** FIN-01@PoC FR 4: the options of the update of the NBU bank directory (scripts/nbu-banks.ts). */
describe("FIN-01@PoC FR 4: scripts/nbu-banks.ts options", () => {
  it("FIN-01@PoC FR 4: --from and --as-of need a value, never the next flag; unknown arguments are refused", () => {
    expect(parseNbuBanksCommand([])).toEqual({ check: false, force: false });
    expect(parseNbuBanksCommand(["--from", "nbu.json", "--as-of", "2026-11-16", "--check"])).toEqual({
      from: "nbu.json",
      asOf: "2026-11-16",
      check: true,
      force: false,
    });
    expect(() => parseNbuBanksCommand(["--from", "--check"])).toThrow(/--from needs a value/);
    expect(() => parseNbuBanksCommand(["--from"])).toThrow(/--from needs a value/);
    expect(() => parseNbuBanksCommand(["--as-of", "16.11.2026"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseNbuBanksCommand(["--froom", "x"])).toThrow(/unknown argument/);
  });

  it("FIN-01@PoC FR 4: bank.gov.ua at most once a day — no download when the file is from today's list, unless --force", () => {
    const plain = parseNbuBanksCommand([]);
    expect(mayDownload(plain, "2026-11-16", "2026-11-16")).toBe(false);
    expect(mayDownload(plain, "2026-11-15", "2026-11-16")).toBe(true);
    expect(mayDownload(parseNbuBanksCommand(["--force"]), "2026-11-16", "2026-11-16")).toBe(true);
    // A downloaded file never calls the NBU.
    expect(mayDownload(parseNbuBanksCommand(["--from", "nbu.json"]), "2026-11-15", "2026-11-16")).toBe(false);
  });

  it("FIN-01@PoC FR 4: --check keeps the file's date, so an unchanged list passes on any later day", () => {
    expect(listDate(parseNbuBanksCommand(["--check"]), "2026-11-16", "2026-12-01")).toBe("2026-11-16");
    expect(listDate(parseNbuBanksCommand([]), "2026-11-16", "2026-12-01")).toBe("2026-12-01");
    expect(listDate(parseNbuBanksCommand(["--as-of", "2026-11-20"]), "2026-11-16", "2026-12-01")).toBe(
      "2026-11-20",
    );
  });

  it("FIN-01@PoC FR 4: «today» is the Kyiv date", () => {
    expect(kyivDate(new Date("2026-11-16T22:30:00Z"))).toBe("2026-11-17");
    expect(kyivDate(new Date("2026-11-16T21:30:00Z"))).toBe("2026-11-16");
  });
});
