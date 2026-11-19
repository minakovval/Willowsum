import {
  addDecimal,
  chooseStep,
  compareDecimal,
  niceScale,
  percentChange,
  stepEnd,
  subDecimal,
} from "./math.ts";

describe("CHT-00@PoC shared chart arithmetic", () => {
  it("CHT-00@PoC AC2: sums are decimal strings added and subtracted exactly, with no floating-point error", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(subDecimal("3144.46", "3000")).toBe("144.46");
    expect(subDecimal("2455.99", "3144.46")).toBe("-688.47");
    expect(compareDecimal("1.10", "1.1")).toBe(0);
    expect(percentChange("3288.69", "2496.07")).toBe("31.8");
    expect(percentChange("5", "0")).toBeNull();
    expect(() => addDecimal("1e3", "1")).toThrow(RangeError);
  });

  it("CMP-42@PoC FR scale: the scale is not tied to zero, runs 10 % beyond the data and ends on round ticks", () => {
    const s = niceScale([1000, 1100], false);
    expect(s.min).toBeGreaterThan(0);
    expect(s.min).toBeLessThanOrEqual(990);
    expect(s.max).toBeGreaterThanOrEqual(1110);
    expect(s.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(niceScale([-20, 50], true).min).toBe(-20);
    expect(niceScale([3, 9], true).min).toBe(0);
  });

  it("CMP-42@PoC FR step: the step is the finest of event, day, week, month, quarter, year with at most 120 points", () => {
    const days = Array.from({ length: 400 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    );
    expect(chooseStep(days.slice(0, 100))).toBe("event");
    expect(chooseStep(days.slice(0, 200))).toBe("week");
    expect(chooseStep(days)).toBe("week");
    const years = Array.from({ length: 300 }, (_, i) => `${1800 + i}-06-01`);
    expect(chooseStep(years)).toBe("year");
    expect(stepEnd("2026-09-23", "week")).toBe("2026-09-27");
    expect(stepEnd("2026-02-10", "month")).toBe("2026-02-28");
    expect(stepEnd("2026-08-10", "quarter")).toBe("2026-09-30");
  });
});
