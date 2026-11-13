// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  colors,
  componentTypeScale,
  contrastRatio,
  CONTRAST_MINIMUM,
  radii,
  space,
} from "../tokens/index.ts";

/**
 * CMP-74@PoC Progress: the sizes, colours and motion of the bar on the stylesheet (jsdom does not resolve
 * `var(--ws-…)`), and the token values those rules name.
 */
const components = readFileSync(
  fileURLToPath(new URL("../styles/components.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector is exactly `selector`, searched in `css`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

function atBlock(css: string, prelude: string): string {
  const start = css.indexOf(prelude);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start));
}

const SIX_PX = "calc(var(--ws-space-1) + var(--ws-space-1) / 2)";

describe("CMP-74@PoC Progress styles", () => {
  it("CMP-74@PoC AC1: a 6 px pill track in `surface-300` with no border; the fill in `link`, proportional, the full height", () => {
    const track = rule(components, ".ws-progress-track");
    expect(track).toContain(`block-size: ${SIX_PX};`);
    expect(track).toContain("border-radius: var(--ws-radius-pill);");
    expect(track).toContain("background-color: var(--ws-surface-300);");
    expect(track).not.toMatch(/(^|\s)border(?!-radius)[a-z-]*:/);
    expect(space["space-1"] * 1.5).toBe(6);
    expect(radii["radius-pill"]).toBe(999);
    expect(colors["surface-300"].light).toBe("#F1F1EF");

    const fill = rule(components, ".ws-progress-fill");
    expect(fill).toContain("block-size: 100%;");
    expect(fill).toContain("border-radius: var(--ws-radius-pill);");
    expect(fill).toContain("background-color: var(--ws-link);");
    expect(colors.link.light).toBe("#1D4E89");
  });

  it("CMP-74@PoC AC1: text Inter 13/18, the count 600 tabular `ink`, the rest `ink-muted`; 12 px beside the bar, 6 px above it", () => {
    const text = rule(components, ".ws-progress-text");
    expect(text).toContain("font-size: var(--ws-text-tooltip-size);");
    expect(text).toContain("line-height: var(--ws-text-tooltip-line);");
    expect(text).toContain("color: var(--ws-ink-muted);");
    expect(componentTypeScale.tooltip.size).toBe(13);
    expect(componentTypeScale.tooltip.lineHeight).toBe(18);
    const count = rule(components, ".ws-progress-count");
    expect(count).toContain("font-weight: 600;");
    expect(count).toContain("font-variant-numeric: tabular-nums;");
    expect(count).toContain("color: var(--ws-ink);");

    expect(rule(components, ".ws-progress-row--inline")).toContain("column-gap: var(--ws-space-3);");
    expect(rule(components, ".ws-progress-row--stacked")).toContain(`row-gap: ${SIX_PX};`);
    expect(space["space-3"]).toBe(12);
  });

  it("CMP-74@PoC AC2: a finished process fills in `gain` and its text is `gain`", () => {
    expect(rule(components, '.ws-progress[data-state="done"] .ws-progress-fill')).toContain(
      "background-color: var(--ws-gain);",
    );
    expect(rule(components, ".ws-progress-text--done")).toContain("color: var(--ws-gain);");
    expect(colors.gain.light).toBe("#27704C");
  });

  it("CMP-74@PoC AC3: a failed process keeps its fill and its text is `loss`", () => {
    expect(rule(components, '.ws-progress[data-state="error"] .ws-progress-fill')).toContain(
      "background-color: var(--ws-loss);",
    );
    expect(rule(components, ".ws-progress-text--error")).toContain("color: var(--ws-loss);");
    expect(colors.loss.light).toBe("#B23A3A");
  });

  it("CMP-74@PoC AC1: each fill colour stands out from the track by 3 : 1 in both themes (WCAG 1.4.11)", () => {
    for (const fg of ["link", "gain", "loss"] as const)
      for (const theme of ["light", "dark"] as const)
        expect(contrastRatio(colors[fg][theme], colors["surface-300"][theme])).toBeGreaterThanOrEqual(
          CONTRAST_MINIMUM.ui,
        );
  });

  it("CMP-74@PoC AC5: with reduced motion the fill has no transition; there is no shimmer or animation in any mode", () => {
    const reduced = atBlock(components, "@media (prefers-reduced-motion: reduce) {\n  .ws-progress-fill");
    expect(rule(reduced, ".ws-progress-fill")).toContain("transition: none;");
    for (const sel of [".ws-progress", ".ws-progress-track", ".ws-progress-fill", ".ws-progress-row"]) {
      expect(rule(components, sel)).not.toMatch(/animation|background-image|linear-gradient/);
    }
    // In normal motion the fill only eases its width, in the DS-13 interaction time.
    expect(rule(components, ".ws-progress-fill")).toContain(
      "transition: inline-size var(--ws-duration-interaction) var(--ws-easing-out);",
    );
  });

  it("CMP-74@PoC: the bar takes the container's width; the text wraps under the bar when the row is narrower than 320 px", () => {
    expect(rule(components, ".ws-progress")).toContain("container-type: inline-size;");
    expect(rule(components, ".ws-progress-track")).toContain("flex: 1 1 0;");
    const narrow = atBlock(components, "@container (max-width: 319px)");
    expect(narrow).not.toBe("");
    expect(rule(narrow, ".ws-progress-row--inline")).toContain("flex-wrap: wrap;");
    expect(rule(narrow, ".ws-progress-row--inline .ws-progress-track")).toContain("flex-basis: 100%;");
  });
});
