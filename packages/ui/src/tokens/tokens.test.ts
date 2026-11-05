// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  brandColors,
  buildTokensCss,
  colors,
  componentTypeScale,
  easings,
  layers,
  layout,
  motion,
  navFormOf,
  radii,
  shadows,
  space,
  typeScale,
  widthClasses,
  widthClassOf,
  breakpoints,
} from "./index.ts";

describe("design tokens", () => {
  it("snapshot of every token (a change here must be a deliberate DS change)", () => {
    expect({
      colors,
      brandColors,
      typeScale,
      componentTypeScale,
      space,
      radii,
      shadows,
      layers,
      motion,
      easings,
      breakpoints,
      widthClasses,
      layout,
    }).toMatchSnapshot();
  });

  it("generated CSS snapshot", () => {
    expect(buildTokensCss()).toMatchSnapshot();
  });

  it("committed tokens.css is up to date (run `pnpm --filter @willowsum/ui build`)", () => {
    const path = fileURLToPath(new URL("../styles/tokens.css", import.meta.url));
    expect(readFileSync(path, "utf8")).toBe(buildTokensCss());
  });
});

describe("exact DS values", () => {
  it("DS-06 table: both columns, e.g. light ink-muted #566174", () => {
    expect(colors["ink-muted"]).toMatchObject({ light: "#566174", dark: "#9DB2C8" });
    expect(colors["surface-100"]).toMatchObject({ light: "#FBFBFA", dark: "#0B2545" });
    expect(colors.overlay).toMatchObject({ light: "rgba(11, 37, 69, 0.45)", dark: "rgba(0, 0, 0, 0.6)" });
  });

  it("DS-06 / DS-07 chart scheme is kept exactly (owner, 2026-11-05)", () => {
    expect(
      (
        [
          "chart-cat-1",
          "chart-cat-2",
          "chart-cat-3",
          "chart-cat-4",
          "chart-cat-5",
          "chart-cat-6",
          "chart-cat-7",
          "chart-cat-8",
        ] as const
      ).map((n) => colors[n].light),
    ).toEqual(["#5872D2", "#0E9161", "#9C7305", "#097FCD", "#C35047", "#9B5BB6", "#0F899B", "#678800"]);
    expect(colors["chart-group-income-1"].light).toBe("#BA4E84");
    expect(colors["chart-group-income-2"].light).toBe("#BE590F");
    expect(colors["chart-transfer"].light).toBe("#9DB2C8");
    expect(colors["chart-other"].light).toBe("#9AA3AF");
    expect(colors["chart-reference"]).toMatchObject({
      light: "rgba(27, 34, 48, 0.6)",
      dark: "rgba(246, 241, 232, 0.6)",
    });
    expect(
      (["usage-0", "usage-30", "usage-55", "usage-75", "usage-95"] as const).map((n) => colors[n].light),
    ).toEqual(["#0E7A3B", "#34A853", "#7CC242", "#C9C21A", "#FBBC05"]);
    expect(
      (["over-1", "over-2", "over-3", "over-4", "over-5", "over-6", "over-7", "over-8"] as const).map(
        (n) => colors[n].light,
      ),
    ).toEqual(["#E3A39B", "#DE7A6F", "#E5584A", "#F2281A", "#D21C10", "#B5180C", "#94130A", "#7A0F08"]);
  });

  it("canvas P0 tokens (owner decision 2026-11-05): tints, goals, scrim, shadows", () => {
    expect(colors["surface-inset"]).toMatchObject({ light: "#FAFAF8", dark: "#0F2B50" });
    expect(colors["tint-info"]).toMatchObject({ light: "#EEF2F7", dark: "#1B3F6E" });
    expect(colors["tint-warning"]).toMatchObject({ light: "#FBF3E8", dark: "#3A3122" });
    expect(colors["on-warning"]).toMatchObject({ light: "#7A4505", dark: "#F2C27A" });
    expect(colors["tint-positive"]).toMatchObject({ light: "#E9F3EE", dark: "#173F36" });
    expect(colors["tint-negative"]).toMatchObject({ light: "#F8ECEC", dark: "#4A2532" });
    expect(colors.skeleton).toMatchObject({ light: "#ECEEF1", dark: "#1B3F6E" });
    expect(
      (["goal-0", "goal-25", "goal-55", "goal-80", "goal-100", "goal-paused"] as const).map(
        (n) => colors[n].light,
      ),
    ).toEqual(["#FFD000", "#E6CF1A", "#9ACD32", "#4CAF50", "#2E7D32", "#C5CAD1"]);
    expect(colors.scrim).toMatchObject({ light: "rgba(11, 37, 69, 0.36)", dark: "rgba(0, 0, 0, 0.55)" });
    expect(shadows["shadow-popover"].light).toBe("0 8px 24px rgba(11, 37, 69, 0.16)");
    expect(shadows["shadow-dialog"].light).toBe(
      "0 2px 4px rgba(11, 37, 69, 0.06), 0 24px 48px rgba(11, 37, 69, 0.20)",
    );
    const css = buildTokensCss();
    expect(css).toContain("--ws-chart-1: var(--ws-brand);");
    expect(css).toContain("--ws-chart-4: var(--ws-border-control);");
    expect(css).toContain("--ws-chart-other-hatch: repeating-linear-gradient(");
    expect(css).toContain("--ws-scrim-blur: 2px;");
    expect(css).toContain("--ws-radius-xl: 16px;");
  });

  it("emits every colour token for both themes in the CSS", () => {
    const css = buildTokensCss();
    for (const [name, t] of Object.entries(colors)) {
      expect(css).toContain(`--ws-${name}: ${t.light};`);
      expect(css).toContain(`--ws-${name}: ${t.dark};`);
    }
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
  });

  it("DS-08 heading-1 is Inter Tight 600, 28/34 px, −0.02 em, in rem", () => {
    expect(typeScale["heading-1"]).toMatchObject({
      family: "display",
      size: 28,
      lineHeight: 34,
      weight: 600,
      tracking: -0.02,
    });
    const css = buildTokensCss();
    expect(css).toContain("--ws-text-heading-1-size: 1.75rem;");
    expect(css).toContain("--ws-text-heading-1-line: 2.125rem;");
    expect(css).toMatch(/\.ws-text-amount-m \{[^}]*tabular-nums/);
    expect(css).toMatch(/\.ws-text-label \{[^}]*uppercase/);
  });

  it("CMP-07 amount sizes by role: Inter Tight totals 32/40, 24/30, 18/24; Inter rows 14/20", () => {
    const pick = (name: keyof typeof typeScale) => {
      const { family, size, lineHeight, weight } = typeScale[name];
      return { family, size, lineHeight, weight };
    };
    expect(pick("amount-xl")).toEqual({ family: "display", size: 32, lineHeight: 40, weight: 600 });
    expect(pick("amount-l")).toEqual({ family: "display", size: 24, lineHeight: 30, weight: 600 });
    expect(pick("amount-m")).toEqual({ family: "display", size: 18, lineHeight: 24, weight: 600 });
    expect(pick("amount-s")).toEqual({ family: "sans", size: 14, lineHeight: 20, weight: 600 });
    for (const name of ["amount-xl", "amount-l", "amount-m", "amount-s"] as const) {
      expect(buildTokensCss()).toMatch(new RegExp(`\\.ws-text-${name} \\{[^}]*tabular-nums`));
    }
  });

  it("CMP-22 skeleton line is 12 px with a 6 px radius on the skeleton token, 1.6 s pass", () => {
    const base = readFileSync(fileURLToPath(new URL("../styles/base.css", import.meta.url)), "utf8");
    const rule = /\.ws-skeleton \{([^}]*)\}/.exec(base)?.[1] ?? "";
    expect(rule).toContain("height: var(--ws-space-3);");
    expect(rule).toContain("border-radius: calc(var(--ws-radius-md) - var(--ws-space-1) / 2);");
    expect(rule).toContain("background: var(--ws-skeleton);");
    expect(space["space-3"]).toBe(12);
    expect(motion["duration-skeleton"]).toBe(1600);
  });

  it("DS-09 spacing, radii and layers", () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
    expect(radii).toEqual({
      "radius-none": 0,
      "radius-sm": 4,
      "radius-md": 8,
      "radius-lg": 14,
      "radius-xl": 16,
      "radius-pill": 999,
    });
    expect(layers["layer-nav"]).toBe(40);
    expect(layers["layer-top"]).toBe(1000);
    expect(layout["content-max"]).toBe(1200);
  });

  it("DS-13 reduced motion: ≤ 0.01 ms and a 2.4 s spinner", () => {
    expect(motion["duration-reduced"]).toBeLessThanOrEqual(0.01);
    expect(motion["duration-spinner-reduced"]).toBe(2400);
    expect(motion["duration-interaction"]).toBeGreaterThanOrEqual(motion["duration-hover-min"]);
    expect(motion["duration-interaction"]).toBeLessThanOrEqual(motion["duration-hover-max"]);
    expect(buildTokensCss()).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("CMP-20 toast: closes after 8 s, or 10 s with the «Відмінити» action", () => {
    expect(motion["duration-toast"]).toBe(8000);
    expect(motion["duration-toast-undo"]).toBe(10000);
    const css = buildTokensCss();
    expect(css).toContain("--ws-duration-toast: 8000ms;");
    expect(css).toContain("--ws-duration-toast-undo: 10000ms;");
  });

  it("DS-10 width classes and navigation forms", () => {
    expect(widthClassOf(359)).toBe("narrow");
    expect(widthClassOf(599)).toBe("narrow");
    expect(widthClassOf(600)).toBe("medium");
    expect(widthClassOf(740)).toBe("medium");
    expect(widthClassOf(1024)).toBe("wide");
    expect(widthClassOf(1440)).toBe("large");
    expect(navFormOf(599)).toBe("bottom");
    expect(navFormOf(600)).toBe("rail");
    expect(navFormOf(1279)).toBe("rail");
    expect(navFormOf(1280)).toBe("sidebar");
    expect(widthClasses.narrow.cardPadding).toBe(16);
    expect(widthClasses.medium.cardPadding).toBe(24);
  });
});
