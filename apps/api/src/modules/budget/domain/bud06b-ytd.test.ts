import { describe, expect, it } from "vitest";
import { baseWindow, compareSelection, type CompareSelection } from "./index.ts";

/**
 * BUD-06@PoC b) (#609 item 2): «З початку року» for a past year — 1 January to the same date of that year, so the
 * picker's «‹» reaches the previous year's ytd (owner decision 2026-11-19, replaces lead decision 5 of #605). Synthetic.
 */
const sel = (input: Parameters<typeof compareSelection>[0], today: string): CompareSelection => {
  const s = compareSelection(input, today);
  if (!("window" in s)) throw new Error(`${s.field}: ${s.issue}`);
  return s;
};

describe("BUD-06@PoC: «З початку року» of a past year", () => {
  it("BUD-06@PoC AC10 (server part): a past year's «З початку року» is 1 January to the same date of that year; its base the year before on the same date", () => {
    const s = sel({ type: "ytd", period: "2025" }, "2026-11-19");
    expect(s.window).toEqual({ from: "2025-01-01", to: "2025-11-19" });
    expect(s.months).toHaveLength(11);
    expect(s.months.at(-1)).toBe("2025-11");
    expect(s).toMatchObject({ type: "ytd", year: "2025", inProgress: false, finished: true });
    expect(baseWindow(s, "last-year", false)).toEqual({ from: "2024-01-01", to: "2024-11-19" });
    // «Повний попередній період» — the base year whole, as for this year's.
    expect(baseWindow(s, "last-year", true)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    // Two years back: the same date too.
    expect(sel({ type: "ytd", period: "2024" }, "2026-11-19").window).toEqual({
      from: "2024-01-01",
      to: "2024-11-19",
    });
    // This year's is unchanged: January to today.
    expect(sel({ type: "ytd" }, "2026-11-19").window).toEqual({ from: "2026-01-01", to: "2026-11-19" });
  });

  it("BUD-06@PoC AC10 (server part): «З початку року» of a year not begun is `future`; a year before 1900 is invalid", () => {
    expect(compareSelection({ type: "ytd", period: "2027" }, "2026-11-19")).toEqual({
      field: "period",
      issue: "future",
    });
    expect(compareSelection({ type: "ytd", period: "1899" }, "2026-11-19")).toEqual({
      field: "period",
      issue: "invalid",
    });
  });

  it("BUD-06@PoC EC1: on 29 February 2028 a past year's «З початку року» ends on the last day of its shorter February", () => {
    const today = "2028-02-29";
    const past = sel({ type: "ytd", period: "2027" }, today);
    expect(past.window).toEqual({ from: "2027-01-01", to: "2027-02-28" });
    expect(baseWindow(past, "last-year", false)).toEqual({ from: "2026-01-01", to: "2026-02-28" });
    // A leap year keeps its 29th.
    expect(sel({ type: "ytd", period: "2024" }, today).window).toEqual({
      from: "2024-01-01",
      to: "2024-02-29",
    });
    // This year's base: 29 February 2028 → 28 February 2027.
    const now = sel({ type: "ytd" }, today);
    expect(now.window).toEqual({ from: "2028-01-01", to: "2028-02-29" });
    expect(baseWindow(now, "last-year", false)).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });
});
