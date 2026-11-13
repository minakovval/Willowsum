// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, contrastRatio, CONTRAST_PAIRS, layers, radii, space } from "../tokens/index.ts";

/** CMP-25@PoC Tooltip: the styles, from tokens only. */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = read("../styles/components.css");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";
const tip = () => rule(".ws-tooltip");

describe("CMP-25@PoC Tooltip styles", () => {
  it("CMP-25@PoC AC1: at most 320 px wide (space-8 × 5) and never wider than the window; longer text wraps", () => {
    expect(space["space-8"] * 5).toBe(320);
    expect(tip()).toMatch(
      /max-inline-size:\s*min\(calc\(var\(--ws-space-8\) \* 5\),\s*calc\(100vw - 2 \* var\(--ws-space-2\)\)\)/,
    );
    expect(tip()).toMatch(/white-space:\s*normal/);
    expect(tip()).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("CMP-25@PoC FR «Розміри і стиль»: white surface-200 panel, 1 px line border, radius-md, shadow-popover, top layer", () => {
    expect(tip()).toMatch(/background:\s*var\(--ws-surface-200\)/);
    expect(tip()).toMatch(/border:\s*1px solid var\(--ws-line\)/);
    expect(tip()).toMatch(/border-radius:\s*var\(--ws-radius-md\)/);
    expect(radii["radius-md"]).toBe(8);
    expect(tip()).toMatch(/box-shadow:\s*var\(--ws-shadow-popover\)/);
    expect(tip()).toMatch(/z-index:\s*var\(--ws-layer-tooltip\)/);
    expect(tip()).toMatch(/position:\s*fixed/);
    expect(layers["layer-tooltip"]).toBeGreaterThan(layers["layer-sticky"]);
  });

  it("CMP-25@PoC FR «Розміри і стиль»: 6 px top and bottom, 10 px at the sides", () => {
    expect(tip()).toMatch(
      /padding:\s*calc\(var\(--ws-space-1\) \* 1\.5\) calc\(var\(--ws-space-1\) \* 2\.5\)/,
    );
    expect(space["space-1"] * 1.5).toBe(6);
    expect(space["space-1"] * 2.5).toBe(10);
  });

  it("CMP-25@PoC FR «Розміри і стиль»: ink text, Inter 13/18 px from the tooltip type token", () => {
    expect(tip()).toMatch(/color:\s*var\(--ws-ink\)/);
    expect(tip()).toMatch(/font-family:\s*var\(--ws-text-tooltip-family\)/);
    expect(tip()).toMatch(/font-size:\s*var\(--ws-text-tooltip-size\)/);
    expect(tip()).toMatch(/line-height:\s*var\(--ws-text-tooltip-line\)/);
    const tokensCss = read("../styles/tokens.css");
    expect(tokensCss).toMatch(/--ws-text-tooltip-size:\s*0\.8125rem/);
    expect(tokensCss).toMatch(/--ws-text-tooltip-line:\s*1\.125rem/);
  });

  it("CMP-25@PoC FR «Розміри і стиль»: ink on surface-200 meets 4.5 : 1 and is a checked contrast pair", () => {
    expect(contrastRatio(colors.ink.light, colors["surface-200"].light)).toBeGreaterThanOrEqual(4.5);
    expect(CONTRAST_PAIRS.some((p) => p.fg === "ink" && p.bg === "surface-200" && p.kind === "text")).toBe(
      true,
    );
  });

  it("CMP-25@PoC FR «Стани»: appears and goes at once, with no transition (DS-13)", () => {
    expect(tip()).not.toMatch(/transition|animation/);
  });

  it("CMP-25@PoC FR «Стани» / WCAG 1.4.13: the 4 px gap to the element is bridged, so the pointer can reach the tooltip", () => {
    expect(rule(".ws-tooltip::before")).toMatch(/block-size:\s*var\(--ws-space-1\)/);
    expect(rule('.ws-tooltip[data-placement="top"]::before')).toMatch(/inset-block-start:\s*100%/);
    expect(rule('.ws-tooltip[data-placement="bottom"]::before')).toMatch(/inset-block-end:\s*100%/);
  });

  it("CMP-25@PoC FR «Стани»: the cut-off element keeps the 3 px focus ring with a 2 px offset (DS-14)", () => {
    expect(read("../styles/base.css")).toMatch(
      /:focus-visible\s*\{\s*outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-focus\);\s*outline-offset:\s*var\(--ws-focus-ring-offset\)/,
    );
    expect(css).not.toMatch(/\.ws-(truncate|amount-fit)[^{]*\{[^}]*outline:\s*(none|0)/);
  });

  it("CMP-25@PoC FR «Призначення»: the cut-off text is one line with an ellipsis", () => {
    const t = rule(".ws-truncate");
    expect(t).toMatch(/overflow:\s*hidden/);
    expect(t).toMatch(/text-overflow:\s*ellipsis/);
    expect(t).toMatch(/white-space:\s*nowrap/);
  });
});
