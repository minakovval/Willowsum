// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssDeclarations, rem } from "../tokens/index.ts";

/**
 * DS-08@PoC items 1, 3, 4, 5 and 9, checked on the generated token CSS and the stylesheets (the page-heading
 * structure of item 6 is checked in `apps/web/src/designSystem.test.tsx`; items 2, 7, 8, 10 and the
 * criteria in `typography.test.ts`). The scale is copied from the DS-08@PoC table, row for row, so a change of
 * the table changes this list (a test must not read docs/: the `web` CI job skips docs-only PRs).
 */
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const tokensCss = read("tokens.css");
const base = cssDeclarations(read("base.css"));
const components = cssDeclarations(read("components.css"));
const token = (name: string, property: string) =>
  new RegExp(`--ws-text-${name}-${property}: ([^;]+);`).exec(tokensCss)?.[1];
const klass = (name: string) =>
  Object.fromEntries(
    cssDeclarations(tokensCss)
      .filter((d) => d.selector === `.ws-text-${name}` && d.atRules.length === 0)
      .map((d) => [d.property, d.value]),
  );

const DISPLAY = "var(--ws-font-display)";
const SANS = "var(--ws-font-sans)";
/** name, family, size, line, weight, tracking (em), uppercase, tabular. */
const SCALE: readonly (readonly [string, string, number, number, number, string, boolean, boolean])[] = [
  ["display-xl", DISPLAY, 56, 60, 600, "-0.03em", false, false],
  ["display-l", DISPLAY, 40, 44, 600, "-0.025em", false, false],
  ["heading-1", DISPLAY, 28, 34, 600, "-0.02em", false, false],
  ["heading-2", DISPLAY, 22, 28, 600, "-0.015em", false, false],
  ["heading-3", DISPLAY, 18, 24, 600, "-0.01em", false, false],
  ["body", SANS, 16, 24, 400, "0em", false, false],
  ["body-sm", SANS, 14, 20, 400, "0em", false, false],
  ["label", SANS, 13, 16, 500, "0.08em", true, false],
  ["action", SANS, 15, 20, 600, "0em", false, false],
  ["amount-xl", DISPLAY, 32, 40, 600, "-0.02em", false, true],
  ["amount-l", DISPLAY, 24, 30, 600, "-0.01em", false, true],
  ["amount-m", DISPLAY, 18, 24, 600, "-0.01em", false, true],
  ["amount-s", SANS, 14, 20, 600, "0em", false, true],
];

describe("DS-08@PoC typography items", () => {
  it("DS-08@PoC FR 1: Inter Tight (600, tracking −1 % to −3 %) for headings and big numbers, Inter (400, 500, 600) for text, labels, tables and amounts", () => {
    expect(tokensCss).toMatch(/--ws-font-display: "Inter Tight", system-ui, sans-serif;/);
    expect(tokensCss).toMatch(/--ws-font-sans: "Inter", system-ui, sans-serif;/);
    for (const [name, family, , , weight, tracking] of SCALE) {
      const display = family === DISPLAY;
      expect(token(name, "family"), name).toBe(family);
      if (display) {
        expect(token(name, "weight"), name).toBe("600");
        const pct = parseFloat(tracking) * 100;
        expect(pct, name).toBeGreaterThanOrEqual(-3);
        expect(pct, name).toBeLessThanOrEqual(-1);
        expect(token(name, "tracking"), name).toBe(tracking);
      } else {
        expect([400, 500, 600], name).toContain(weight);
      }
    }
    // Headings, the large numbers and the wordmark are display styles; tables, labels and row amounts are sans.
    expect(
      ["heading-1", "heading-2", "heading-3", "amount-xl", "amount-l", "amount-m"].every(
        (n) => token(n, "family") === DISPLAY,
      ),
    ).toBe(true);
    expect(token("amount-s", "family")).toBe(SANS);
  });

  it("DS-08@PoC FR 3: every style of the scale has its family, size / line height, weight and tracking, as a token and as a class", () => {
    expect(SCALE).toHaveLength(13);
    for (const [name, family, size, line, weight, tracking, upper, tabular] of SCALE) {
      expect(token(name, "size"), name).toBe(rem(size));
      expect(token(name, "line"), name).toBe(rem(line));
      expect(token(name, "weight"), name).toBe(String(weight));
      expect(token(name, "tracking"), name).toBe(tracking);
      expect(klass(name), name).toMatchObject({
        "font-family": `var(--ws-text-${name}-family)`,
        "font-size": `var(--ws-text-${name}-size)`,
        "line-height": `var(--ws-text-${name}-line)`,
        "font-weight": `var(--ws-text-${name}-weight)`,
        "letter-spacing": `var(--ws-text-${name}-tracking)`,
      });
      expect(klass(name)["text-transform"] === "uppercase", name).toBe(upper);
      expect(klass(name)["font-variant-numeric"] === "tabular-nums", name).toBe(tabular);
      expect(token(name, "family")).toBe(family);
    }
  });

  it("DS-08@PoC FR 4: component sizes: axis labels 12/16 400, tooltip 13/18 400, status badge 11/16 500, map cluster 14 600", () => {
    expect([token("chart-axis", "size"), token("chart-axis", "line"), token("chart-axis", "weight")]).toEqual(
      [rem(12), rem(16), "400"],
    );
    expect([token("tooltip", "size"), token("tooltip", "line"), token("tooltip", "weight")]).toEqual([
      rem(13),
      rem(18),
      "400",
    ]);
    expect([token("badge", "size"), token("badge", "line"), token("badge", "weight")]).toEqual([
      rem(11),
      rem(16),
      "500",
    ]);
    expect([token("map-cluster", "size"), token("map-cluster", "weight")]).toEqual([rem(14), "600"]);
    // The components take them from the tokens, not from numbers of their own.
    const badge = components.filter((d) => d.selector.startsWith(".ws-badge") && d.property === "font-size");
    expect(badge.length).toBeGreaterThan(0);
    for (const d of badge) expect(d.value, d.selector).toBe("var(--ws-text-badge-size)");
    expect(components.find((d) => d.selector === ".ws-tooltip" && d.property === "font-size")?.value).toBe(
      "var(--ws-text-tooltip-size)",
    );
  });

  it("DS-08@PoC FR 5: every amount style has tabular figures and the amount component uses them", () => {
    for (const name of ["amount-xl", "amount-l", "amount-m", "amount-s"])
      expect(klass(name)["font-variant-numeric"], name).toBe("tabular-nums");
    for (const selector of [".ws-amount", ".ws-delta", ".ws-tabular", ".ws-num"]) {
      const value = [...base, ...components].find(
        (d) => d.selector === selector && d.property === "font-variant-numeric" && d.atRules.length === 0,
      )?.value;
      expect(value, selector).toBe("tabular-nums");
    }
  });

  it("DS-08@PoC FR 9: a link inside running text is underlined, so colour is not its only sign", () => {
    const value = (selector: string) =>
      base.find((d) => d.selector === selector && d.property === "text-decoration" && d.atRules.length === 0)
        ?.value;
    expect(value("a")).toBe("underline");
    expect(value("p .ws-link, li .ws-link")).toBe("underline");
    // No rule takes the underline off a link in a paragraph or a list.
    for (const d of [...base, ...components])
      if (/\b(p|li)\b.*\ba\b|\b(p|li)\b.*\.ws-link/.test(d.selector) && d.property === "text-decoration")
        expect(d.value, d.selector).not.toBe("none");
  });
});
