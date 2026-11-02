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

  it("DS-09 spacing, radii and layers", () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
    expect(radii).toEqual({
      "radius-none": 0,
      "radius-sm": 4,
      "radius-md": 8,
      "radius-lg": 14,
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
