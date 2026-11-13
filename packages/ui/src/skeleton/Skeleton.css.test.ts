// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, radii, space } from "../tokens/index.ts";

/**
 * CMP-22@PoC Skeleton: the sizes, colour and motion of the shapes on the stylesheets (jsdom does not resolve
 * `var(--ws-…)`), and the token values those rules name.
 */
const sheet = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const base = sheet("../styles/base.css");
const components = sheet("../styles/components.css");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start));
}

const VARIANTS = [
  ".ws-skeleton--circle",
  ".ws-skeleton--tile",
  ".ws-skeleton--block",
  ".ws-skeleton--field",
  ".ws-skeleton--amount",
];

describe("CMP-22@PoC Skeleton styles", () => {
  it("CMP-22@PoC AC1: a circle 28–36 px or a 32 px tile with an 8 px radius and 12 px bars in the light `skeleton` colour ECEEF1", () => {
    const circle = rule(components, ".ws-skeleton--circle");
    expect(circle).toContain("inline-size: var(--ws-space-6);");
    expect(circle).toContain("block-size: var(--ws-space-6);");
    expect(circle).toContain("border-radius: var(--ws-radius-pill);");
    const tile = rule(components, ".ws-skeleton--tile");
    expect(tile).toContain("inline-size: var(--ws-space-6);");
    expect(tile).toContain("block-size: var(--ws-space-6);");
    expect(tile).toContain("border-radius: var(--ws-radius-md);");
    expect(space["space-6"]).toBe(32);
    expect(radii["radius-md"]).toBe(8);

    // Bars: 12 px high, 6 px radius, the `skeleton` colour.
    const bar = rule(base, ".ws-skeleton");
    expect(bar).toContain("height: var(--ws-space-3);");
    expect(bar).toContain("border-radius: calc(var(--ws-radius-md) - var(--ws-space-1) / 2);");
    expect(bar).toContain("background-color: var(--ws-skeleton);");
    expect(space["space-3"]).toBe(12);
    expect(radii["radius-md"] - space["space-1"] / 2).toBe(6);
    expect(colors.skeleton.light).toBe("#ECEEF1");
  });

  it("CMP-22@PoC AC1: text bars 100 / 80 / 60 % wide and 12 px apart; the amount bar 64 px; a 64 px block; a 40 px field with an 8 px radius", () => {
    expect(rule(components, ".ws-skeleton-shapes--text")).toContain("gap: var(--ws-space-3);");
    for (const w of ["100", "80", "60", "40"])
      expect(rule(components, `.ws-skeleton[data-width="${w}"]`)).toContain(`inline-size: ${w}%;`);
    expect(rule(components, ".ws-skeleton--amount")).toContain("inline-size: var(--ws-space-8);");
    expect(rule(components, ".ws-skeleton--block")).toContain("block-size: var(--ws-space-8);");
    expect(space["space-8"]).toBe(64);
    const field = rule(components, ".ws-skeleton--field");
    expect(field).toContain("block-size: calc(var(--ws-space-6) + var(--ws-space-2));");
    expect(field).toContain("border-radius: var(--ws-radius-md);");
    expect(space["space-6"] + space["space-2"]).toBe(40);
  });

  it("CMP-22@PoC AC3: with reduced motion the shimmer is off and the shapes are static; the variants add no motion of their own", () => {
    const reduced = rule(mediaBlock(base, "(prefers-reduced-motion: reduce)"), ".ws-skeleton");
    expect(reduced).toContain("animation: none !important;");
    expect(reduced).toContain("background-image: none;");
    for (const sel of [...VARIANTS, ".ws-skeleton-row", ".ws-skeleton-region", ".ws-skeleton-shapes"])
      expect(rule(components, sel)).not.toMatch(/animation|transition|background/);
  });

  it("CMP-22@PoC AC5: the skeleton takes the container's width and a list row keeps the 52 px row height", () => {
    expect(rule(components, ".ws-skeleton-region")).toContain("inline-size: 100%;");
    expect(rule(components, ".ws-skeleton-row")).toContain(
      "min-block-size: calc(var(--ws-space-7) + var(--ws-space-1));",
    );
    expect(space["space-7"] + space["space-1"]).toBe(52);
  });
});
