// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  colors,
  componentTypeScale,
  contrastRatio,
  CONTRAST_PAIRS,
  layout,
  radii,
  space,
  typeScale,
} from "../tokens/index.ts";

/** CMP-02@PoC Field: the styles, from tokens only (light theme values as the criteria give them). */
const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
/** Every declaration block whose selector list ends with `selector` (a shared rule counts too). */
const rule = (selector: string) =>
  [
    ...css.matchAll(
      new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"),
    ),
  ]
    .map((m) => m[1])
    .join("");
const light = (name: keyof typeof colors) => colors[name].light;

describe("CMP-02@PoC Field styles", () => {
  it("CMP-02@PoC AC7: label 13 px weight 500 in normal case, no letter spacing", () => {
    const label = rule(".ws-field-label");
    expect(label).toMatch(/font-size:\s*var\(--ws-text-label-size\)/);
    expect(typeScale.label.size).toBe(13);
    expect(typeScale.label.lineHeight).toBe(16);
    expect(label).toMatch(/font-weight:\s*500/);
    expect(label).toMatch(/text-transform:\s*none/);
    expect(label).toMatch(/letter-spacing:\s*normal/);
    expect(label).toMatch(/color:\s*var\(--ws-ink\)/);
    expect(rule(".ws-field-required")).toMatch(/color:\s*var\(--ws-loss\)/);
  });

  it("CMP-02@PoC AC7: the field is visibly 40 px with radius 8 px, a 1 px border of 7B8494 and 14 px text; the touch area is 44 px", () => {
    const box = rule(".ws-field-box");
    expect(box).toMatch(/block-size:\s*calc\(var\(--ws-touch-target\) - var\(--ws-space-1\)\)/);
    expect(box).toMatch(/box-sizing:\s*border-box/);
    expect(layout["touch-target"] - space["space-1"]).toBe(40);
    expect(box).toMatch(/border-radius:\s*var\(--ws-radius-md\)/);
    expect(radii["radius-md"]).toBe(8);
    expect(box).toMatch(/border:\s*1px solid var\(--ws-border-control\)/);
    expect(light("border-control")).toBe("#7B8494");
    expect(box).toMatch(/padding-inline:\s*var\(--ws-space-3\)/);
    expect(space["space-3"]).toBe(12);
    expect(box).toMatch(/background:\s*var\(--ws-surface-200\)/);
    const input = rule(".ws-field-input");
    expect(input).toMatch(/font-size:\s*var\(--ws-text-body-sm-size\)/);
    expect(typeScale["body-sm"].size).toBe(14);
    expect(typeScale["body-sm"].lineHeight).toBe(20);
    expect(input).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // The input is the touch target: 44 px tall inside the 40 px box, the box does not clip it.
    expect(input).toMatch(/block-size:\s*var\(--ws-touch-target\)/);
    expect(layout["touch-target"]).toBe(44);
    expect(box).not.toMatch(/overflow:\s*hidden/);
    // Where the input is shorter (an abbreviated amount), 2 px strips above and below keep the 44 px.
    expect(rule(".ws-field-box::before,\n.ws-field-box::after")).toMatch(
      /block-size:\s*calc\(var\(--ws-space-1\) \/ 2\)/,
    );
  });

  it("CMP-02@PoC AC5: a disabled field has the E7E1D3 fill, 8A8F99 text and no border", () => {
    const box = rule('.ws-field[data-state="disabled"] .ws-field-box');
    expect(box).toMatch(/background:\s*var\(--ws-disabled-bg\)/);
    expect(box).toMatch(/border-color:\s*transparent/);
    expect(rule('.ws-field[data-state="disabled"] .ws-field-input')).toMatch(
      /color:\s*var\(--ws-disabled-ink\)/,
    );
    expect(light("disabled-bg")).toBe("#E7E1D3");
    expect(light("disabled-ink")).toBe("#8A8F99");
  });

  it("CMP-02@PoC AC6: the placeholder changes only the colour, never the font, size or weight", () => {
    const ph = rule(".ws-field-input::placeholder");
    expect(ph).toMatch(/color:\s*var\(--ws-ink-muted\)/);
    expect(ph).not.toMatch(/font|letter-spacing|text-transform/);
  });

  it("CMP-02@PoC AC2: the error border is B23A3A; the message is 14/20 weight 500 in loss", () => {
    expect(rule('.ws-field[data-state="error"] .ws-field-box')).toMatch(/border-color:\s*var\(--ws-loss\)/);
    expect(light("loss")).toBe("#B23A3A");
    const error = rule(".ws-field-error");
    expect(error).toMatch(/color:\s*var\(--ws-loss\)/);
    expect(error).toMatch(/font-size:\s*var\(--ws-text-body-sm-size\)/);
    expect(error).toMatch(/font-weight:\s*500/);
    // The error state comes after hover and focus, so its border stays while hovered or focused.
    expect(css.indexOf('.ws-field[data-state="error"] .ws-field-box')).toBeGreaterThan(
      css.indexOf(".ws-field-box:has(.ws-field-input:focus-visible)"),
    );
  });

  it("CMP-02@PoC AC3: an abbreviated amount has a dotted underline", () => {
    const abbr = rule(".ws-field-input[data-abbreviated]");
    // The input is as wide and tall as its text, so its dotted bottom border is the underline.
    expect(abbr).toMatch(/field-sizing:\s*content/);
    expect(abbr).toMatch(/block-size:\s*auto/);
    expect(abbr).toMatch(/border-block-end:\s*1px dotted currentColor/);
  });

  it("CMP-02@PoC FR «Стани»: hover and focus make the border ink; focus draws the 3 px ring 2 px off the whole field", () => {
    expect(rule(".ws-field-box:hover")).toMatch(/border-color:\s*var\(--ws-ink\)/);
    const focus = rule(".ws-field-box:has(.ws-field-input:focus-visible)");
    expect(focus).toMatch(/border-color:\s*var\(--ws-ink\)/);
    expect(focus).toMatch(/outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-focus-ring-color\)/);
    expect(focus).toMatch(/outline-offset:\s*var\(--ws-focus-ring-offset\)/);
    expect(rule(".ws-field-input:focus-visible")).toMatch(/outline:\s*none/);
    expect(rule('.ws-field[data-state="readonly"] .ws-field-box')).toMatch(
      /background:\s*var\(--ws-surface-100\)/,
    );
  });

  it("CMP-02@PoC FR «Розміри і стиль»: 8 px between label, field and hint; the hint is 13/18 ink-muted; the search field 36 px; the counter 12 px", () => {
    expect(rule(".ws-field-label")).toMatch(/margin-block-end:\s*var\(--ws-space-2\)/);
    expect(rule(".ws-field-hint")).toMatch(/margin-block-start:\s*var\(--ws-space-2\)/);
    expect(rule(".ws-field-error")).toMatch(/margin-block-start:\s*var\(--ws-space-2\)/);
    expect(space["space-2"]).toBe(8);
    const hint = rule(".ws-field-hint");
    expect(hint).toMatch(/color:\s*var\(--ws-ink-muted\)/);
    expect(hint).toMatch(/font-size:\s*var\(--ws-text-tooltip-size\)/);
    expect([componentTypeScale.tooltip.size, componentTypeScale.tooltip.lineHeight]).toEqual([13, 18]);
    expect(rule('.ws-field-box[data-size="search"]')).toMatch(
      /block-size:\s*calc\(var\(--ws-touch-target\) - var\(--ws-space-2\)\)/,
    );
    expect(layout["touch-target"] - space["space-2"]).toBe(36);
    expect(rule(".ws-field-counter")).toMatch(/font-size:\s*var\(--ws-text-chart-axis-size\)/);
    expect(componentTypeScale["chart-axis"].size).toBe(12);
    expect(rule(".ws-field")).toMatch(/inline-size:\s*100%/);
  });

  it("CMP-02@PoC FR «Розміри і стиль»: every text and control pair of the field meets its contrast and is a checked pair", () => {
    const pairs: [keyof typeof colors, keyof typeof colors, number][] = [
      ["ink", "surface-200", 4.5],
      ["ink-muted", "surface-200", 4.5],
      ["ink-muted", "surface-100", 4.5],
      ["loss", "surface-200", 4.5],
      ["border-control", "surface-200", 3],
      ["focus", "surface-200", 3],
    ];
    for (const [fg, bg, min] of pairs) {
      for (const theme of ["light", "dark"] as const) {
        expect(contrastRatio(colors[fg][theme], colors[bg][theme])).toBeGreaterThanOrEqual(min);
      }
      expect(CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg === bg)).toBe(true);
    }
  });
});
