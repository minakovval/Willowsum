// @vitest-environment node
import {
  CHART_CATEGORY_PALETTE,
  CHART_FILL_STEPS,
  colors,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  THEME_ONLY_PAIRS,
  THEMES,
} from "./color.ts";
import { contrastRatio, relativeLuminance } from "./contrast.ts";

/** DS-06 item 4: every text pair ≥ 4.5:1, control borders, focus rings and data graphics ≥ 3:1, both themes. */
describe("WCAG AA contrast of token pairs (DS-06 item 4, DS-07, DS-14 item 3)", () => {
  const cases = THEMES.flatMap((theme) =>
    CONTRAST_PAIRS.map((p) => ({ theme, ...p, label: `${theme}: ${p.fg} on ${p.bg} (${p.kind})` })),
  );

  it.each(cases)("$label", ({ theme, fg, bg, kind }) => {
    expect(contrastRatio(colors[fg][theme], colors[bg][theme])).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM[kind],
    );
  });

  it.each(THEME_ONLY_PAIRS)("$theme only: $fg on $bg", ({ theme, fg, bg, kind }) => {
    expect(contrastRatio(colors[fg][theme], colors[bg][theme])).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM[kind],
    );
  });

  it("covers every text colour named in DS-06 on each surface it is allowed on", () => {
    const textPairs = CONTRAST_PAIRS.filter((p) => p.kind === "text").map((p) => `${p.fg}/${p.bg}`);
    for (const fg of ["ink", "ink-muted", "link", "gain", "loss"]) {
      expect(textPairs).toContain(`${fg}/surface-100`);
      expect(textPairs).toContain(`${fg}/surface-200`);
    }
    expect(textPairs).toContain("ink/surface-300");
  });
});

describe("DS-06 reference ratios", () => {
  const r = (a: string, b: string) => Math.round(contrastRatio(a, b) * 10) / 10;

  it("matches the documented palette ratios (± 0.1)", () => {
    expect(r(colors.brand.light, colors["surface-100"].light)).toBeCloseTo(14.9, 1);
    expect(r(colors.ink.light, colors["surface-100"].light)).toBeCloseTo(15.4, 1);
    expect(r(colors["brand-2"].light, colors["surface-100"].light)).toBeCloseTo(8.1, 1);
    expect(r(colors.accent.dark, colors["surface-100"].dark)).toBeCloseTo(7.0, 1);
    expect(r(colors["ink-muted"].dark, colors["surface-100"].dark)).toBeCloseTo(7.1, 1);
    expect(r(colors["ink-muted"].dark, colors["surface-300"].dark)).toBeCloseTo(4.9, 1);
  });

  it("light ink-muted #566174 gives 6.04:1 on surface-100 and 5.53:1 on surface-300 (DS-06)", () => {
    expect(contrastRatio(colors["ink-muted"].light, colors["surface-100"].light)).toBeCloseTo(6.04, 2);
    expect(contrastRatio(colors["ink-muted"].light, colors["surface-300"].light)).toBeCloseTo(5.53, 2);
  });

  it("amber on paper is below 3:1, so accent is never text or a border on light grounds", () => {
    expect(contrastRatio(colors.accent.light, colors["surface-100"].light)).toBeLessThan(3);
  });
});

describe("chart scheme (DS-07)", () => {
  it("chart fill steps 1–4 stay brand, brand-2, ink-muted, border-control", () => {
    expect(CHART_FILL_STEPS).toEqual(["brand", "brand-2", "ink-muted", "border-control"]);
  });

  it("the categorical palette keeps its fixed order", () => {
    expect(CHART_CATEGORY_PALETTE.map((n) => colors[n].light)).toEqual([
      "#5872D2",
      "#0E9161",
      "#9C7305",
      "#097FCD",
      "#C35047",
      "#9B5BB6",
      "#0F899B",
      "#678800",
    ]);
  });
});

describe("contrast maths", () => {
  it("black on white is 21:1 and luminance is bounded", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(() => relativeLuminance("red")).toThrow();
  });
});
