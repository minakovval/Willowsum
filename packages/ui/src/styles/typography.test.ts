// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssDeclarations, fontFamilies, rem, typeScale } from "../tokens/index.ts";

/**
 * DS-08@PoC — typography. AC3 (one h1 per page, no skipped levels) is checked on every route in
 * `apps/web/src/designSystem.test.tsx`; AC7 (numbers kept with their words) in `packages/i18n`.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const base = cssDeclarations(readFileSync(here("./base.css"), "utf8"));
const tokensCss = readFileSync(here("./tokens.css"), "utf8");
const fontsCss = readFileSync(here("./fonts.css"), "utf8");
const rule = (selector: string) =>
  Object.fromEntries(
    base.filter((d) => d.selector === selector && d.atRules.length === 0).map((d) => [d.property, d.value]),
  );
const fontsource = (pkg: string, weight: number) =>
  readFileSync(here(`../../node_modules/@fontsource/${pkg}/${weight}.css`), "utf8");

describe("DS-08@PoC typography", () => {
  it("DS-08@PoC AC1: the page heading is Inter Tight 600, 28/34 px, tracking −0.02 em", () => {
    expect(typeScale["heading-1"]).toMatchObject({
      family: "display",
      size: 28,
      lineHeight: 34,
      weight: 600,
      tracking: -0.02,
    });
    expect(fontFamilies.display.startsWith('"Inter Tight"')).toBe(true);
    expect(rule("h1")).toEqual({
      "font-family": "var(--ws-text-heading-1-family)",
      "font-size": "var(--ws-text-heading-1-size)",
      "line-height": "var(--ws-text-heading-1-line)",
      "font-weight": "var(--ws-text-heading-1-weight)",
      "letter-spacing": "var(--ws-text-heading-1-tracking)",
    });
    expect(tokensCss).toContain("--ws-text-heading-1-size: 1.75rem;");
    expect(tokensCss).toContain("--ws-text-heading-1-tracking: -0.02em;");
    expect(rule("h2")["font-size"]).toBe("var(--ws-text-heading-2-size)");
    expect(rule("h3")["font-size"]).toBe("var(--ws-text-heading-3-size)");
  });

  it("DS-08@PoC AC2: an amount column has tabular figures and is aligned to the end, so commas line up", () => {
    expect(rule(".ws-num")).toMatchObject({ "font-variant-numeric": "tabular-nums", "text-align": "end" });
    for (const name of ["amount-xl", "amount-l", "amount-m", "amount-s"] as const) {
      expect(typeScale[name].tabularNumbers).toBe(true);
      expect(tokensCss).toMatch(new RegExp(`\\.ws-text-${name} \\{[^}]*tabular-nums`));
    }
    const components = cssDeclarations(readFileSync(here("./components.css"), "utf8"));
    expect(components).toContainEqual(
      expect.objectContaining({
        selector: ".ws-amount",
        property: "font-variant-numeric",
        value: "tabular-nums",
      }),
    );
  });

  it("DS-08@PoC AC4: a label is 13/16 px, 500, capitals, tracking +8 %", () => {
    expect(typeScale.label).toMatchObject({
      size: 13,
      lineHeight: 16,
      weight: 500,
      tracking: 0.08,
      uppercase: true,
    });
    expect(rule(".ws-label")).toMatchObject({
      "font-size": "var(--ws-text-label-size)",
      "line-height": "var(--ws-text-label-line)",
      "font-weight": "var(--ws-text-label-weight)",
      "letter-spacing": "var(--ws-text-label-tracking)",
      "text-transform": "uppercase",
    });
    expect(tokensCss).toContain("--ws-text-label-size: 0.8125rem;");
    expect(tokensCss).toContain("--ws-text-label-tracking: 0.08em;");
  });

  it("DS-08@PoC AC5: a link inside a paragraph is underlined", () => {
    expect(rule("a")["text-decoration"]).toBe("underline");
    // A standalone link drops the underline only outside running text.
    expect(rule(".ws-link")["text-decoration"]).toBe("none");
    expect(rule("p .ws-link, li .ws-link")["text-decoration"]).toBe("underline");
  });

  it("DS-08@PoC AC6: if Inter does not load, text shows in the system font at once (font-display: swap)", () => {
    expect(fontFamilies.sans).toBe('"Inter", system-ui, sans-serif');
    expect(fontFamilies.display).toBe('"Inter Tight", system-ui, sans-serif');
    for (const [pkg, weight] of [
      ["inter", 400],
      ["inter", 500],
      ["inter", 600],
      ["inter-tight", 600],
    ] as const) {
      expect(fontsCss).toContain(`@import "@fontsource/${pkg}/${weight}.css";`);
      const faces = fontsource(pkg, weight).match(/@font-face \{[^}]*\}/g) ?? [];
      expect(faces.length).toBeGreaterThan(0);
      for (const face of faces) expect(face).toContain("font-display: swap;");
    }
  });

  it("DS-08@PoC FR 2, FR 10: fonts come from the product's own server and cover Cyrillic and Latin", () => {
    expect(fontsCss).not.toMatch(/https?:\/\//);
    const inter = fontsource("inter", 400);
    expect(inter).not.toMatch(/url\(https?:/);
    expect(inter).toContain("U+0400-045F"); // Cyrillic
    expect(inter).toMatch(/U\+0000-00FF/); // Basic Latin and Latin-1
  });

  it("DS-08@PoC FR 7: sizes are in rem so text follows the system font size", () => {
    expect(rem(13)).toBe("0.8125rem");
    const sizes = [...tokensCss.matchAll(/--ws-text-[\w-]+-(size|line): ([^;]+);/g)].map((m) => m[2]);
    expect(sizes.length).toBeGreaterThan(20);
    for (const v of sizes) expect(v).toMatch(/rem$/);
  });

  it("DS-08@PoC FR 8: running text keeps a 45–75 character measure", () => {
    expect(rule(".ws-prose")["max-width"]).toBe("70ch");
  });
});
