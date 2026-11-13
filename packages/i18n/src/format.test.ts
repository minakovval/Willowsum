import { formatDate, formatDateTime, formatLocaleOf, formatMoney, formatNumber, LANGUAGES } from "./index.ts";

/**
 * NFR-09@PoC FR 3 (criterion «Формати»): dates, numbers, currencies and time zones follow the user's locale
 * and time zone. Unit tests for uk and en. The regional format of each language comes from the language
 * registry (uk → uk-UA, en → en-GB).
 */
const NBSP = "\u00A0";
const MINUS = "\u2212";
/** No-break and narrow no-break spaces compare as ordinary spaces where the test does not check them. */
const plain = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("NFR-09@PoC FR 3: regional format of each language", () => {
  it("NFR-09@PoC FR 3: uk formats as uk-UA and en as en-GB", () => {
    expect(formatLocaleOf("uk")).toBe("uk-UA");
    expect(formatLocaleOf("en")).toBe("en-GB");
  });

  it("NFR-09@PoC FR 3: every registered language names a regional format the runtime supports", () => {
    for (const { code } of LANGUAGES) {
      const format = formatLocaleOf(code);
      expect(Intl.NumberFormat.supportedLocalesOf([format]), code).toEqual([format]);
    }
  });
});

describe("NFR-09@PoC FR 3: numbers", () => {
  it("NFR-09@PoC FR 3: uk groups thousands with a no-break space and uses a decimal comma", () => {
    expect(formatNumber("uk", "1234567.891")).toBe(`1${NBSP}234${NBSP}567,891`);
  });

  it("NFR-09@PoC FR 3: en groups thousands with a comma and uses a decimal point", () => {
    expect(formatNumber("en", "1234567.891")).toBe("1,234,567.891");
  });

  it("NFR-09@PoC FR 3: a negative number has the true minus U+2212 in both languages", () => {
    expect(formatNumber("uk", "-42.5")).toBe(`${MINUS}42,5`);
    expect(formatNumber("en", "-42.5")).toBe(`${MINUS}42.5`);
  });

  it("NFR-09@PoC FR 3: keeps every digit of a long decimal string (no floating point)", () => {
    expect(plain(formatNumber("en", "12345678901234567.123456789"))).toBe("12,345,678,901,234,567.123456789");
  });

  it("NFR-09@PoC FR 3: refuses anything that is not a plain decimal string", () => {
    for (const bad of ["", "1e5", "12,5", "1 000", "abc", "0x10", "NaN"]) {
      expect(() => formatNumber("uk", bad), bad).toThrow(RangeError);
    }
  });
});

describe("NFR-09@PoC FR 3: currencies", () => {
  it("NFR-09@PoC FR 3: uk puts the symbol after the amount: «1 234 567,50 ₴», «128 450,00 €»", () => {
    expect(formatMoney("uk", "1234567.5", "UAH")).toBe(`1${NBSP}234${NBSP}567,50${NBSP}₴`);
    expect(formatMoney("uk", "128450", "EUR")).toBe(`128${NBSP}450,00${NBSP}€`);
  });

  it("NFR-09@PoC FR 3: en puts the symbol first: «€128,450.00», «₴1,234,567.50»", () => {
    expect(formatMoney("en", "128450", "EUR")).toBe("€128,450.00");
    expect(formatMoney("en", "1234567.5", "UAH")).toBe("₴1,234,567.50");
  });

  it("NFR-09@PoC FR 3: a negative amount has the true minus before the amount and the symbol", () => {
    expect(formatMoney("uk", "-42.1", "EUR")).toBe(`${MINUS}42,10${NBSP}€`);
    expect(formatMoney("en", "-42.1", "EUR")).toBe(`${MINUS}€42.10`);
  });

  it("NFR-09@PoC FR 3: a currency without a symbol shows its code", () => {
    expect(formatMoney("uk", "128450", "CHF")).toBe(`128${NBSP}450,00${NBSP}CHF`);
    expect(plain(formatMoney("en", "128450", "CHF"))).toBe("CHF 128,450.00");
  });

  it("NFR-09@PoC FR 3: rounds only for display, half to even, to the currency's digits", () => {
    expect(formatMoney("uk", "2.345", "EUR")).toBe(`2,34${NBSP}€`);
    expect(formatMoney("en", "2.355", "EUR")).toBe("€2.36");
  });

  it("NFR-09@PoC FR 3: an amount that rounds to zero shows no minus", () => {
    expect(formatMoney("uk", "-0.004", "EUR")).toBe(`0,00${NBSP}€`);
    expect(formatMoney("en", "-0.004", "EUR")).toBe("€0.00");
  });

  it("NFR-09@PoC FR 3: a currency with no minor unit has no fraction", () => {
    expect(formatMoney("en", "1500", "JPY")).toBe("¥1,500");
  });

  it("NFR-09@PoC FR 3: refuses a float-like or malformed amount and an unknown currency code", () => {
    expect(() => formatMoney("uk", "1e3", "EUR")).toThrow(RangeError);
    expect(() => formatMoney("uk", "10", "euro")).toThrow(RangeError);
  });
});

describe("NFR-09@PoC FR 3: dates and time zones", () => {
  it("NFR-09@PoC FR 3: a calendar date is «day, short month, year» in each language", () => {
    expect(plain(formatDate("uk", "2026-10-26"))).toBe("26 жовт. 2026 р.");
    expect(plain(formatDate("en", "2026-10-26"))).toBe("26 Oct 2026");
  });

  it("NFR-09@PoC FR 3: a calendar date never shifts to another day, whatever the machine's time zone", () => {
    // A calendar date has no time zone: it is formatted as is, not as midnight UTC seen from UTC−5.
    expect(plain(formatDate("en", "2026-01-01"))).toBe("1 Jan 2026");
    expect(plain(formatDate("uk", "2026-12-31"))).toBe("31 груд. 2026 р.");
  });

  it("NFR-09@PoC FR 3: refuses a malformed or impossible calendar date", () => {
    for (const bad of ["2026-02-30", "26.10.2026", "2026-10-26T00:00:00Z", ""]) {
      expect(() => formatDate("uk", bad), bad).toThrow(RangeError);
    }
  });

  it("NFR-09@PoC FR 3: a UTC time stamp is shown in the user's time zone, 24-hour clock for uk and en", () => {
    const at = "2026-07-15T12:05:00Z";
    expect(plain(formatDateTime("uk", at, "Europe/Kyiv"))).toBe("15 лип. 2026 р., 15:05");
    expect(plain(formatDateTime("en", at, "Europe/Kyiv"))).toBe("15 Jul 2026, 15:05");
    expect(plain(formatDateTime("en", at, "Europe/Lisbon"))).toBe("15 Jul 2026, 13:05");
  });

  it("NFR-09@PoC FR 3: the time zone can move a time stamp to another calendar day", () => {
    const at = "2026-10-26T02:30:00Z";
    expect(plain(formatDateTime("en", at, "America/New_York"))).toBe("25 Oct 2026, 22:30");
    expect(plain(formatDateTime("uk", at, "Europe/Kyiv"))).toBe("26 жовт. 2026 р., 04:30");
  });

  it("NFR-09@PoC FR 3: follows daylight saving time of the user's zone", () => {
    // Kyiv: UTC+3 in summer, UTC+2 in winter.
    expect(plain(formatDateTime("en", "2026-01-15T12:00:00Z", "Europe/Kyiv"))).toBe("15 Jan 2026, 14:00");
    expect(plain(formatDateTime("en", "2026-07-15T12:00:00Z", "Europe/Kyiv"))).toBe("15 Jul 2026, 15:00");
  });

  it("NFR-09@PoC FR 3: refuses a time stamp without an explicit UTC offset and an unknown time zone", () => {
    expect(() => formatDateTime("uk", "2026-10-26T12:05:00", "Europe/Kyiv")).toThrow(RangeError);
    expect(() => formatDateTime("uk", "2026-10-26T12:05:00Z", "Europe/Atlantis")).toThrow(RangeError);
  });
});
