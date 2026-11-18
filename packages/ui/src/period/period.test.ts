import { describe, expect, it } from "vitest";
import { formatPeriodMonth, formatPeriodRange } from "./period.ts";

/** DS-04@PoC item 9 on the real formatter (the project's own Intl data, not a copied expectation). */
describe("DS-04@PoC periods", () => {
  it("DS-04@PoC FR 9: a month is «жовт. 2026»; a range in one month has no spaces around the dash, a range over two months has", () => {
    expect(formatPeriodMonth("uk", "2026-10")).toBe("жовт. 2026");
    expect(formatPeriodMonth("en", "2026-10")).toBe("Oct 2026");
    expect(formatPeriodRange("uk", "2026-10-01", "2026-10-31")).toBe("1–31 жовт. 2026");
    expect(formatPeriodRange("uk", "2026-09-28", "2026-10-04")).toBe("28 вер. – 4 жовт. 2026");
    expect(formatPeriodRange("en", "2026-07-28", "2026-08-04")).toBe("28 Jul \u2013 4 Aug 2026");
    // Across a year both years are written; one day is a single date.
    expect(formatPeriodRange("uk", "2026-12-30", "2027-01-02")).toBe("30 груд. 2026 – 2 січ. 2027");
    expect(formatPeriodRange("uk", "2026-10-05", "2026-10-05")).toBe("5 жовт. 2026");
    // The dash is the en dash, never a hyphen, and the text never carries the «р.» of a full date.
    expect(formatPeriodRange("uk", "2026-10-01", "2026-10-31")).not.toMatch(/-| р\./);
  });

  it("DS-04@PoC FR 9: a calendar that does not exist or a range that ends before it starts is an error, not a wrong text", () => {
    expect(() => formatPeriodRange("uk", "2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => formatPeriodRange("uk", "2026-10-31", "2026-10-01")).toThrow(RangeError);
    expect(() => formatPeriodMonth("uk", "2026-13")).toThrow(RangeError);
  });
});
