import { describe, expect, it } from "vitest";
import { REJECTION_CODES, rejection } from "./index.ts";

describe("messages of rejected files (IMP-01@PoC FR 15, FR 13)", () => {
  it("IMP-01@PoC FR 15: the rejections say «Файл зашифровано», «Занадто багато рядків», «Формат не підтримується», «Файл пошкоджено», «У файлі немає транзакцій», «Розбір триває занадто довго»", () => {
    expect(rejection("ENCRYPTED").message.uk).toMatch(/^Файл зашифровано/);
    expect(rejection("TOO_MANY_ROWS").message.uk).toMatch(/^Занадто багато рядків/);
    expect(rejection("UNSUPPORTED_FORMAT").message.uk).toBe("Формат не підтримується");
    expect(rejection("CORRUPTED").message.uk).toBe("Файл пошкоджено");
    expect(rejection("NO_TRANSACTIONS").message.uk).toBe("У файлі немає транзакцій");
    expect(rejection("PARSE_TIMEOUT").message.uk).toMatch(/^Розбір триває занадто довго/);
  });

  it("IMP-01@PoC FR 13: every ceiling's message names it and advises splitting the file; none is a plan's limit or 402", () => {
    for (const code of REJECTION_CODES) {
      const r = rejection(code);
      expect([413, 422]).toContain(r.status);
      expect(r.message.uk.length).toBeGreaterThan(0);
      expect(r.message.en.length).toBeGreaterThan(0);
      expect(`${r.message.uk} ${r.message.en}`).not.toMatch(/план|тариф|plan|upgrade/i);
      if (r.ceiling && code !== "SPACE_STORAGE_LIMIT") {
        expect(r.message.uk).toContain("Розділіть файл");
        expect(r.message.en).toContain("Split the file");
      }
    }
  });
});
