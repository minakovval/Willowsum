import {
  formatDate,
  formatDateTime,
  formatDelta,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPoints,
  maskNumber,
  speakMoney,
} from "./index.ts";

/**
 * DS-04@PoC: formats of amounts, numbers, percentages, dates and time (the formatters of `format.ts`).
 * The view: docs/requirements/ds/DS-04.poc.md. Amounts are decimal strings, never JS numbers.
 */
const NBSP = "\u00A0";
const MINUS = "−";
/** No-break and narrow no-break spaces compare as ordinary spaces where the test does not check them. */
const plain = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("DS-04@PoC: full amounts", () => {
  it("DS-04@PoC AC1: uk-UA shows 1234567,5 UAH as «1 234 567,50 ₴» with no-break spaces", () => {
    expect(formatMoney("uk", "1234567.5", "UAH")).toBe(`1${NBSP}234${NBSP}567,50${NBSP}₴`);
  });

  it("DS-04@PoC AC2: −42,1 EUR in a list has the true minus U+2212 and two decimals: «−42,10 €»", () => {
    const shown = formatMoney("uk", "-42.1", "EUR");
    expect(shown).toBe(`${MINUS}42,10${NBSP}€`);
    expect(shown).not.toContain("-");
  });

  it("DS-04@PoC AC3: 2,345 EUR is shown as «2,34 €» (half to even) and the stored value stays 2,345", () => {
    const stored = "2.345";
    expect(formatMoney("uk", stored, "EUR")).toBe(`2,34${NBSP}€`);
    expect(stored).toBe("2.345");
    // Half to even both ways: 2,355 → 2,36; 2,365 → 2,36.
    expect(formatMoney("uk", "2.355", "EUR")).toBe(`2,36${NBSP}€`);
    expect(formatMoney("uk", "2.365", "EUR")).toBe(`2,36${NBSP}€`);
  });

  it("DS-04@PoC FR 2: the currency symbol and the number are joined by a no-break space, never an ordinary one", () => {
    for (const [value, currency] of [
      ["128450", "EUR"],
      ["-1234567.5", "UAH"],
      ["128450", "CHF"],
    ] as const) {
      for (const locale of ["uk", "en"] as const) {
        expect(formatMoney(locale, value, currency), `${locale} ${currency}`).not.toMatch(/ /);
      }
    }
  });

  it("DS-04@PoC FR 3: uk-UA examples «128 450,00 €», «1 234 567,50 ₴», «−42,10 €»; the symbol after the number", () => {
    expect(plain(formatMoney("uk", "128450", "EUR"))).toBe("128 450,00 €");
    expect(plain(formatMoney("uk", "1234567.50", "UAH"))).toBe("1 234 567,50 ₴");
    expect(plain(formatMoney("uk", "-42.1", "EUR"))).toBe(`${MINUS}42,10 €`);
    expect(plain(formatMoney("uk", "128450", "CHF"))).toBe("128 450,00 CHF");
  });

  it("DS-04@PoC FR 4: a value without an arrow keeps «+» or «−»: «+3 400,00 €», «−42,80 €», «+2,1 %»", () => {
    expect(plain(formatMoney("uk", "3400", "EUR", { signed: true }))).toBe("+3 400,00 €");
    expect(plain(formatMoney("uk", "-42.8", "EUR", { signed: true }))).toBe(`${MINUS}42,80 €`);
    expect(plain(formatPercent("uk", "2.1", { signed: true }))).toBe("+2,1 %");
    expect(plain(formatMoney("uk", "0", "EUR", { signed: true }))).toBe("0,00 €");
  });
});

describe("DS-04@PoC: edge cases of amounts", () => {
  it("DS-04@PoC EC2: −0,004 EUR rounds to zero and shows «0,00 €» without a minus", () => {
    expect(formatMoney("uk", "-0.004", "EUR")).toBe(`0,00${NBSP}€`);
    expect(formatMoney("uk", "-0.004", "EUR", { signed: true })).toBe(`0,00${NBSP}€`);
  });

  it("DS-04@PoC EC3: a currency with no digits after the separator shows no fraction", () => {
    expect(plain(formatMoney("uk", "1500.4", "JPY"))).toBe("1 500 ¥");
    expect(formatMoney("en", "1500", "JPY")).toBe("¥1,500");
  });

  it("DS-04@PoC EC4: a cryptocurrency shows the precision of its currency; the stored value keeps 18 digits", () => {
    const stored = "0.123456789012345678";
    expect(plain(formatMoney("uk", stored, "BTC", { digits: 8 }))).toBe("0,12345679 BTC");
    expect(plain(formatMoney("uk", stored, "BTC", { digits: 18 }))).toBe("0,123456789012345678 BTC");
    expect(stored).toBe("0.123456789012345678");
    expect(() => formatMoney("uk", stored, "BTC", { digits: 19 })).toThrow(RangeError);
  });
});

describe("DS-04@PoC: dates and time", () => {
  const machineZone = process.env.TZ;
  afterEach(() => {
    if (machineZone === undefined) delete process.env.TZ;
    else process.env.TZ = machineZone;
  });

  it("DS-04@PoC AC5: a transaction dated 2026-10-26 seen from UTC−5 shows «26 жовт. 2026 р.», not the day before", () => {
    process.env.TZ = "Etc/GMT+5"; // UTC−5
    expect(new Date("2026-10-26").getDate()).toBe(25); // what a naive implementation would show
    expect(plain(formatDate("uk", "2026-10-26"))).toBe("26 жовт. 2026 р.");
  });

  it("DS-04@PoC AC6: the audit entry 2026-10-26T12:05:00Z in Europe/Kyiv shows «26 жовт. 2026 р., 14:05»", () => {
    expect(plain(formatDateTime("uk", "2026-10-26T12:05:00Z", "Europe/Kyiv"))).toBe(
      "26 жовт. 2026 р., 14:05",
    );
  });

  it("DS-04@PoC FR 6: an event date is «day, short month, year» by region", () => {
    expect(plain(formatDate("uk", "2026-10-26"))).toBe("26 жовт. 2026 р.");
    expect(plain(formatDate("en", "2026-10-26"))).toBe("26 Oct 2026");
  });

  it("DS-04@PoC FR 7: a UTC time stamp is shown in the user's zone as «date, time», hours by region", () => {
    expect(plain(formatDateTime("en", "2026-10-26T12:05:00Z", "Europe/Kyiv"))).toBe("26 Oct 2026, 14:05");
    expect(plain(formatDateTime("uk", "2026-10-26T12:05:00Z", "America/New_York"))).toBe(
      "26 жовт. 2026 р., 08:05",
    );
  });
});

describe("DS-04@PoC: percentages and changes", () => {
  it("DS-04@PoC FR 5: at most two digits after the separator and the percent sign by region: «2,4 %»", () => {
    expect(formatPercent("uk", "2.4")).toBe(`2,4${NBSP}%`);
    expect(formatPercent("en", "2.4")).toBe("2.4%");
    expect(plain(formatPercent("uk", "33.33333"))).toBe("33,33 %");
    expect(plain(formatPercent("uk", "100"))).toBe("100 %");
    expect(plain(formatPercent("uk", "-7.7"))).toBe(`${MINUS}7,7 %`);
    expect(() => formatPercent("uk", "2.4", { digits: 3 })).toThrow(RangeError);
  });

  it("DS-04@PoC AC10: a change of +2,4 % is «▲ 2,4 %» with no «+», and its name says «зросло»", () => {
    const delta = formatDelta("uk", { percent: "2.4" });
    expect(delta.text).toBe(`▲${NBSP}2,4${NBSP}%`);
    expect(delta.text).not.toContain("+");
    expect(delta.direction).toBe("up");
    expect(delta.label).toContain("зросло");
  });

  it("DS-04@PoC AC12: savings rate 22 % against 24 % is «▼ 2 п. п. м/м» without «−»", () => {
    const delta = formatDelta("uk", { points: "-2", period: "month" });
    expect(plain(delta.text)).toBe("▼ 2 п. п. м/м");
    expect(delta.text).not.toContain(MINUS);
    expect(delta.direction).toBe("down");
    expect(delta.label).toContain("знизилось");
  });

  it("DS-04@PoC FR 14: a change of a percentage is in percentage points «п. п.», not percent of percent", () => {
    expect(formatPoints("uk", "2")).toBe(`2${NBSP}п.${NBSP}п.`);
    expect(plain(formatPoints("en", "2"))).toBe("2 pp");
  });

  it("DS-04@PoC AC16: «▲ 9 900 € · 15,0 % р/р» without any «+», the market line «з них ринок +3 400 € · TWR +5,1 %»", () => {
    const delta = formatDelta("uk", {
      amount: { value: "9900", currency: "EUR" },
      percent: "15",
      period: "year",
    });
    expect(plain(delta.text)).toBe("▲ 9 900 € · 15,0 % р/р");
    expect(delta.text).not.toContain("+");
    const market = `${plain(formatMoney("uk", "3400", "EUR", { signed: true, digits: 0 }))} · TWR ${plain(
      formatPercent("uk", "5.1", { signed: true }),
    )}`;
    expect(market).toBe("+3 400 € · TWR +5,1 %");
  });

  it("DS-04@PoC FR 4: examples «▼ 200 € · 7,7 % м/м», «▲ 3 876 € · 1,4 % т/т»; the name says the direction", () => {
    const down = formatDelta("uk", {
      amount: { value: "-200", currency: "EUR" },
      percent: "-7.7",
      period: "month",
    });
    expect(plain(down.text)).toBe("▼ 200 € · 7,7 % м/м");
    expect(down.text).not.toContain(MINUS);
    expect(plain(down.label)).toBe("знизилось на 200 євро, 7,7 % за місяць");
    const up = formatDelta("uk", {
      amount: { value: "3876", currency: "EUR" },
      percent: "1.4",
      period: "week",
    });
    expect(plain(up.text)).toBe("▲ 3 876 € · 1,4 % т/т");
    const en = formatDelta("en", {
      amount: { value: "3876", currency: "EUR" },
      percent: "1.4",
      period: "week",
    });
    expect(plain(en.text)).toBe("▲ €3,876 · 1.4% w/w");
    expect(plain(en.label)).toBe("up by 3,876 euros, 1.4% over the week");
  });

  it("DS-04@PoC EC1: a zero change is «– 0,0 %» with neither «+» nor «−», named «без змін»", () => {
    for (const percent of ["0", "-0.04", "0.04"]) {
      const delta = formatDelta("uk", { percent });
      expect(plain(delta.text), percent).toBe("– 0,0 %");
      expect(delta.direction).toBe("none");
      expect(delta.label).toBe("без змін");
    }
  });

  it("DS-04@PoC FR 4: one change moves one way; parts that disagree are refused", () => {
    expect(() => formatDelta("uk", { amount: { value: "100", currency: "EUR" }, percent: "-1" })).toThrow(
      RangeError,
    );
    expect(() => formatDelta("uk", {})).toThrow(RangeError);
  });

  it("DS-04@PoC FR 16: the parts of a change are unbreakable; a line may break only after «·» and before the period", () => {
    const { text } = formatDelta("uk", {
      amount: { value: "3876", currency: "EUR" },
      percent: "1.4",
      period: "month",
    });
    // The only ordinary spaces (break opportunities) are right after «·» and before «м/м».
    expect(text.split(" ")).toEqual([`▲${NBSP}3${NBSP}876${NBSP}€${NBSP}·`, `1,4${NBSP}%`, "м/м"]);
  });
});

describe("DS-04@PoC: the spoken form of an amount", () => {
  it("DS-04@PoC AC7: a screen reader hears −5 EUR as «мінус 5,00 євро»", () => {
    expect(plain(speakMoney("uk", "-5", "EUR"))).toBe("мінус 5,00 євро");
  });

  it("DS-04@PoC FR 10: the sign is a word, then the number and the full currency name in the interface language", () => {
    expect(plain(speakMoney("uk", "3200", "UAH", { signed: true }))).toBe("плюс 3 200,00 гривні");
    expect(plain(speakMoney("uk", "3200", "UAH"))).toBe("3 200,00 гривні");
    expect(plain(speakMoney("en", "-5", "EUR"))).toBe("minus 5.00 euros");
    expect(plain(speakMoney("uk", "-0.004", "EUR"))).toBe("0,00 євро");
    // A currency without a catalogue name uses its name from Intl.
    expect(plain(speakMoney("en", "12", "CHF"))).toBe("12.00 Swiss francs");
  });
});

describe("DS-04@PoC: the number mask", () => {
  it("DS-04@PoC AC11: a credit card ending in 4417 is «··4417» everywhere", () => {
    expect(maskNumber("4417")).toBe("··4417");
    expect(maskNumber("0000 0000 0000 4417")).toBe("··4417");
    expect(maskNumber("4441-1144-1744-4417")).toBe("··4417");
  });

  it("DS-04@PoC FR 13: two middle dots and the last 4 digits, no space; no other mask", () => {
    const mask = maskNumber("4441 1144 1744 4417");
    expect(mask).toMatch(/^·{2}\d{4}$/);
    expect(mask).not.toMatch(/[•*\s]/);
    for (const bad of ["", "441", "44a7", "****4417"]) expect(() => maskNumber(bad), bad).toThrow(RangeError);
  });
});

describe("DS-04@PoC FR 1: only Intl formatting by the user's regional format", () => {
  it("DS-04@PoC FR 1: the same value follows the regional format of each language", () => {
    expect(plain(formatNumber("uk", "1234.5"))).toBe("1 234,5");
    expect(formatNumber("en", "1234.5")).toBe("1,234.5");
  });
});
