// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  colors,
  contrastRatio,
  CONTRAST_MINIMUM,
  layout,
  radii,
  SCRIM_BLUR,
  shadows,
  space,
} from "../tokens/index.ts";

/**
 * CMP-21@PoC Dialog: sizes, colours and motion on the stylesheet (jsdom does not resolve `var(--ws-…)`), and the
 * token values those rules name. The real 1280 px rendering is checked in the gallery (screenshot, e2e contrast).
 */
const components = readFileSync(
  fileURLToPath(new URL("../styles/components.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(components)?.[1] ?? "";
}

const light = (name: keyof typeof colors) => colors[name].light;

describe("CMP-21@PoC Dialog styles", () => {
  it("CMP-21@PoC AC7: radius 16 px, `shadow-dialog`, white surface; the scrim rgba(11, 37, 69, 0.36) blurs the page 2 px", () => {
    const dialog = rule(".ws-dialog");
    expect(dialog).toContain("border-radius: var(--ws-radius-xl);");
    expect(dialog).toContain("box-shadow: var(--ws-shadow-dialog);");
    expect(dialog).toContain("background: var(--ws-surface-200);");
    expect(radii["radius-xl"]).toBe(16);
    expect(light("surface-200")).toBe("#FFFFFF");
    expect(shadows["shadow-dialog"].light).toBe(
      "0 2px 4px rgba(11, 37, 69, 0.06), 0 24px 48px rgba(11, 37, 69, 0.20)",
    );
    const backdrop = rule(".ws-dialog::backdrop");
    expect(backdrop).toContain("background: var(--ws-scrim);");
    expect(backdrop).toContain("backdrop-filter: blur(var(--ws-scrim-blur));");
    expect(light("scrim")).toBe("rgba(11, 37, 69, 0.36)");
    expect(SCRIM_BLUR).toBe(2);
  });

  it("CMP-21@PoC AC7: the icon tile is 56 × 56 px with radius 16 px in the tone's tint, the icon in the tone's colour", () => {
    const tile = rule(".ws-dialog-icon");
    expect(tile).toContain("width: calc(var(--ws-space-7) + var(--ws-space-2));");
    expect(tile).toContain("height: calc(var(--ws-space-7) + var(--ws-space-2));");
    expect(space["space-7"] + space["space-2"]).toBe(56);
    expect(tile).toContain("border-radius: var(--ws-radius-xl);");
    expect(tile).toContain("background: var(--ws-tint-info);");
    expect(tile).toContain("color: var(--ws-link);");
    expect(rule('.ws-dialog-icon[data-tone="warning"]')).toContain("color: var(--ws-on-warning);");
    expect(rule('.ws-dialog-icon[data-tone="danger"]')).toContain("background: var(--ws-tint-negative);");
    expect(rule('.ws-dialog-icon[data-tone="danger"]')).toContain("color: var(--ws-loss);");
  });

  it("CMP-21@PoC AC7: the action bar on FAFAF8 with a 1 px line, 20 × 32 px; «Видалити рахунок» as `danger` — white, 1.5 px B23A3A", () => {
    const foot = rule(".ws-dialog-foot");
    expect(foot).toContain("background: var(--ws-surface-inset);");
    expect(foot).toContain("border-block-start: 1px solid var(--ws-surface-300);");
    expect(foot).toContain("padding: calc(var(--ws-space-4) + var(--ws-space-1)) var(--ws-space-6);");
    expect(light("surface-inset")).toBe("#FAFAF8");
    const danger = rule('.ws-dialog-action[data-variant="danger"]:not([aria-disabled="true"])');
    expect(danger).toContain("border: 1.5px solid var(--ws-loss);");
    expect(danger).toContain("color: var(--ws-loss);");
    expect(light("loss")).toBe("#B23A3A");
  });

  it("CMP-21@PoC AC7: the top part has 32 px padding and 12 px gaps; title Inter Tight 600 22/28, text 15/22 `ink-muted`", () => {
    expect(rule(".ws-dialog-body")).toContain("padding: var(--ws-space-6);");
    expect(rule(".ws-dialog-head")).toContain("gap: var(--ws-space-3);");
    const title = rule(".ws-dialog-title");
    expect(title).toContain("font-size: var(--ws-text-heading-2-size);");
    expect(title).toContain("letter-spacing: var(--ws-text-heading-2-tracking);");
    const text = rule(".ws-dialog-text");
    expect(text).toContain("color: var(--ws-ink-muted);");
    expect(text).toContain("font-size: var(--ws-text-action-size);");
    expect(text).toContain("line-height: calc(var(--ws-space-5) - var(--ws-space-1) / 2);");
  });

  it("CMP-21@PoC AC9: a centred dialog centres the icon, the title and the text", () => {
    const head = rule('.ws-dialog[data-align="center"] .ws-dialog-head');
    expect(head).toContain("align-items: center;");
    expect(head).toContain("text-align: center;");
  });

  it("CMP-21@PoC AC10: a left-aligned dialog keeps the icon, title, text and content on the 32 px left edge", () => {
    const head = rule('.ws-dialog[data-align="start"] .ws-dialog-head');
    expect(head).toContain("align-items: flex-start;");
    expect(head).toContain("text-align: start;");
    expect(rule(".ws-dialog-content")).toContain("text-align: start;");
    expect(space["space-6"]).toBe(32);
  });

  it("CMP-21@PoC AC11: stacked buttons take the full width; no label wraps onto a second line", () => {
    const column = rule('.ws-dialog-actions[data-layout="column"]');
    expect(column).toContain("grid-auto-flow: row;");
    expect(column).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".ws-dialog-action")).toContain("white-space: nowrap;");
  });

  it("CMP-21@PoC AC12: at most 560 px wide; equal buttons share one row 12 px apart", () => {
    expect(rule(".ws-dialog")).toContain(
      "width: min(var(--ws-dialog-width), calc(100% - 2 * var(--ws-space-4)));",
    );
    expect(layout["dialog-width"]).toBe(560);
    const row = rule(".ws-dialog-actions");
    expect(row).toContain("grid-auto-flow: column;");
    expect(row).toContain("grid-auto-columns: minmax(0, 1fr);");
    expect(row).toContain("gap: var(--ws-space-3);");
  });

  it("CMP-21@PoC AC23: dialog buttons are 40 px high with radius 8 px and a 44 × 44 px target; «✕» a 36 px circle", () => {
    const button = rule(".ws-button");
    expect(button).toContain("min-height: calc(var(--ws-touch-target) - var(--ws-space-1));");
    expect(button).toContain("border-radius: var(--ws-radius-md);");
    expect(layout["touch-target"] - space["space-1"]).toBe(40);
    expect(radii["radius-md"]).toBe(8);
    // The 2 px above and below make the 44 px target.
    expect(rule(".ws-button::after")).toContain("inset-block: calc(var(--ws-space-1) / -2);");
    const close = rule(".ws-dialog-close.ws-icon-button");
    expect(close).toContain("min-width: calc(var(--ws-space-6) + var(--ws-space-1));");
    expect(close).toContain("border-radius: var(--ws-radius-pill);");
    expect(rule(".ws-dialog-close.ws-icon-button::after")).toContain(
      "inset: calc((var(--ws-space-6) + var(--ws-space-1) - var(--ws-touch-target)) / 2);",
    );
  });

  it("CMP-21@PoC AC25: 640 px for `split` and 900 px for `wide`", () => {
    expect(rule('.ws-dialog[data-size="split"]')).toContain("var(--ws-dialog-width-split)");
    expect(rule('.ws-dialog[data-size="wide"]')).toContain("var(--ws-dialog-width-wide)");
    expect([layout["dialog-width-split"], layout["dialog-width-wide"]]).toEqual([640, 900]);
  });

  it("CMP-21@PoC: the dialog is never taller than the window minus 2 × 48 px; only the body scrolls, the bar stays", () => {
    const dialog = rule(".ws-dialog");
    expect(dialog).toContain("max-height: calc(100% - 2 * var(--ws-space-7));");
    expect(dialog).toContain("overflow: hidden;");
    const body = rule(".ws-dialog-body");
    expect(body).toContain("overflow-y: auto;");
    expect(body).toContain("min-height: 0;");
    expect(rule(".ws-dialog-foot")).toContain("flex: 0 0 auto;");
  });

  it("CMP-21@PoC «Зменшений рух»: the dialog appears without sliding or scaling", () => {
    const all = [".ws-dialog", ".ws-dialog[open]", ".ws-dialog::backdrop", ".ws-dialog-box"]
      .map(rule)
      .join("\n");
    expect(all).not.toMatch(/transform|animation|transition/);
  });

  it("CMP-21@PoC: text and control colours of the dialog meet 4.5 : 1 and 3 : 1 in the light theme", () => {
    const text: [keyof typeof colors, keyof typeof colors][] = [
      ["ink", "surface-200"],
      ["ink-muted", "surface-200"],
      ["loss", "surface-200"],
      ["ink", "surface-inset"],
      ["ink-muted", "surface-inset"],
      ["ink", "tint-negative"],
      ["on-brand", "brand"],
    ];
    for (const [fg, bg] of text)
      expect(contrastRatio(light(fg), light(bg))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    const ui: [keyof typeof colors, keyof typeof colors][] = [
      ["border-control", "surface-200"],
      ["loss", "surface-inset"],
      ["link", "tint-info"],
      ["on-warning", "tint-warning"],
      ["loss", "tint-negative"],
    ];
    for (const [fg, bg] of ui)
      expect(contrastRatio(light(fg), light(bg))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.ui);
  });
});
