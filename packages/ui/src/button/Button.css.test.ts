// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  accentUsageViolations,
  colors,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  contrastRatio,
  cssDeclarations,
  layout,
  motion,
  radii,
  space,
  THEME_ONLY_PAIRS,
  typeScale,
  type ColorTokenName,
} from "../tokens/index.ts";

/**
 * CMP-01@PoC Button: sizes, colours, states and motion on the stylesheet (jsdom does not resolve `var(--ws-…)`),
 * and the token values those rules name (light theme: PoC).
 */
const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
const components = read("components.css");
const base = read("base.css");

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of cssDeclarations(css)) if (d.selector === selector) out[d.property] = d.value;
  return out;
}
const light = (name: ColorTokenName) => colors[name].light;
const ratio = (fg: ColorTokenName, bg: ColorTokenName) => contrastRatio(light(fg), light(bg));

/** Resolves the few `calc()` forms the button rules use, in px. */
function px(value: string): number {
  const expr = value
    .replace(/var\(--ws-space-(\d)\)/g, (_m, n: string) => String(space[`space-${n}` as keyof typeof space]))
    .replace(/var\(--ws-touch-target\)/g, String(layout["touch-target"]))
    .replace(/^calc/, "");
  if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error(`cannot resolve ${value}`);
  return Function(`return (${expr})`)() as number;
}

/** The `::after` hit area: centred, at least the touch target both ways, on any visible size. */
function hitArea(): number {
  const after = rule(components, ".ws-button::after");
  expect(after).toMatchObject({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "max(100%, var(--ws-touch-target))",
    height: "max(100%, var(--ws-touch-target))",
  });
  return layout["touch-target"];
}

describe("CMP-01@PoC Button styles", () => {
  it("CMP-01@PoC AC1: the primary fill is brand, never the amber accent; no button style fills with accent", () => {
    expect(rule(components, ".ws-button-primary")["background"]).toBe("var(--ws-brand)");
    expect(light("brand")).toBe("#0B2545");
    expect(accentUsageViolations(components)).toEqual([]);
    for (const d of cssDeclarations(components).filter((x) => x.selector.includes(".ws-button")))
      expect(d.value, `${d.selector} ${d.property}`).not.toContain("--ws-accent");
  });

  it("CMP-01@PoC AC2: primary hover fills 173A66 (brand-hover), pressed 061833 (brand-pressed); on-brand text stays readable", () => {
    expect(rule(components, ".ws-button-primary:hover")["background"]).toBe("var(--ws-brand-hover)");
    expect(rule(components, ".ws-button-primary:active")["background"]).toBe("var(--ws-brand-pressed)");
    expect(light("brand-hover")).toBe("#173A66");
    expect(light("brand-pressed")).toBe("#061833");
    expect(light("on-brand")).toBe("#F6F1E8");
    for (const bg of ["brand", "brand-hover", "brand-pressed"] as const)
      expect(ratio("on-brand", bg)).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
  });

  it("CMP-01@PoC AC2: the other variants' hover and pressed fills follow the view", () => {
    expect(rule(components, ".ws-button:hover")["background"]).toBe("var(--ws-surface-300)");
    expect(rule(components, ".ws-button:active")["background"]).toBe("var(--ws-line)");
    expect(rule(components, ".ws-button-quiet:hover")).toMatchObject({
      background: "var(--ws-surface-300)",
      "text-decoration": "underline",
    });
    expect(rule(components, ".ws-button-quiet:active")["background"]).toBe("var(--ws-line)");
    expect(rule(components, ".ws-button-danger:hover, .ws-button-danger:active")["background"]).toBe(
      "var(--ws-tint-negative)",
    );
    // Every text on its state fill is readable (light theme); the new pairs are in the contrast tables.
    expect(ratio("ink", "surface-300")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(ratio("ink", "line")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(ratio("link", "surface-300")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(ratio("link", "line")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(ratio("loss", "tint-negative")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(ratio("loss", "surface-200")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    const pairs = [...CONTRAST_PAIRS, ...THEME_ONLY_PAIRS];
    for (const [fg, bg] of [
      ["ink", "line"],
      ["link", "surface-300"],
      ["link", "line"],
      ["loss", "tint-negative"],
    ])
      expect(pairs).toContainEqual(expect.objectContaining({ fg, bg }));
  });

  it("CMP-01@PoC AC3: every variant shows the 3 px focus ring in 1D4E89 with a 2 px offset; no button rule removes it", () => {
    expect(rule(base, ":focus-visible")).toEqual({
      outline: "var(--ws-focus-ring-width) solid var(--ws-focus)",
      "outline-offset": "var(--ws-focus-ring-offset)",
    });
    expect(layout["focus-ring-width"]).toBe(3);
    expect(layout["focus-ring-offset"]).toBe(2);
    expect(light("focus")).toBe("#1D4E89");
    const buttonRules = cssDeclarations(components).filter((d) => d.selector.includes(".ws-button"));
    expect(buttonRules.filter((d) => d.property.startsWith("outline"))).toEqual([]);
    expect(ratio("focus", "surface-100")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.ui);
  });

  it("CMP-01@PoC AC4: while loading the width does not change — the spinner slot and its gap come out of the padding", () => {
    const busy = rule(components, '.ws-button[aria-busy="true"]:not(.ws-button-with-icon)');
    expect(busy["padding-inline"]).toBe(
      "calc(var(--ws-button-pad) - (var(--ws-space-4) + var(--ws-space-2)) / 2)",
    );
    const slot = rule(components, ".ws-button-slot");
    const gap = px(rule(components, ".ws-button")["gap"]!);
    const added = px(slot["width"]!) + gap;
    for (const sel of [".ws-button", ".ws-button-primary", ".ws-button-quiet", ".ws-button-sm"]) {
      const pad = px(rule(components, sel)["--ws-button-pad"]!);
      const shrunk = pad - (space["space-4"] + space["space-2"]) / 2;
      expect(shrunk, sel).toBeGreaterThanOrEqual(0);
      expect(2 * pad, sel).toBe(2 * shrunk + added);
    }
    // With an icon the spinner takes the icon's 16 px slot: nothing is added.
    expect(px(slot["width"]!)).toBe(16);
  });

  it("CMP-01@PoC AC4: the spinner is 14 × 14 px with a 2 px rim in the text colour, one side clear, 0.8 s a turn (2.4 s with reduced motion)", () => {
    const spinner = rule(components, ".ws-button-spinner");
    expect(px(spinner["width"]!)).toBe(14);
    expect(px(spinner["height"]!)).toBe(14);
    expect(spinner["border"]).toBe("calc(var(--ws-space-1) / 2) solid currentcolor");
    expect(spinner["border-inline-end-color"]).toBe("transparent");
    expect(rule(base, ".ws-spinner")["animation"]).toContain("var(--ws-duration-spinner)");
    expect(motion["duration-spinner"]).toBe(800);
    expect(base).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*\.ws-spinner\s*\{\s*animation-duration: var\(--ws-duration-spinner-reduced\)/,
    );
    expect(motion["duration-spinner-reduced"]).toBe(2400);
  });

  it("CMP-01@PoC AC5: disabled is E7E1D3 with 8A8F99 text, a clear border, a «not allowed» cursor and no underline", () => {
    const disabled = rule(
      components,
      '.ws-button:disabled, .ws-button[aria-disabled="true"], .ws-button[aria-disabled="true"]:hover, .ws-button[aria-disabled="true"]:active',
    );
    expect(disabled).toMatchObject({
      "border-color": "transparent",
      background: "var(--ws-disabled-bg)",
      color: "var(--ws-disabled-ink)",
      "text-decoration": "none",
      cursor: "not-allowed",
    });
    expect(light("disabled-bg")).toBe("#E7E1D3");
    expect(light("disabled-ink")).toBe("#8A8F99");
    expect(rule(components, ".ws-disabled-reason")["color"]).toBe("var(--ws-ink-muted)");
  });

  it("CMP-01@PoC AC6: `sm` is 32 px visible, 13/20 px text, and its hit area reaches 44 px", () => {
    const sm = rule(components, ".ws-button-sm");
    expect(px(sm["min-height"]!)).toBe(32);
    expect(sm["font-size"]).toBe("var(--ws-text-label-size)");
    expect(typeScale.label.size).toBe(13);
    expect(typeScale["body-sm"].lineHeight).toBe(20);
    expect(hitArea()).toBe(44);
    // No size rule replaces the hit area.
    expect(cssDeclarations(components).filter((d) => /\.ws-button-[\w-]+::after/.test(d.selector))).toEqual(
      [],
    );
    // Icon-only `sm`: 32 × 32 visible, 44 × 44 hit area.
    expect(px(rule(components, ".ws-button-sm.ws-button-icon-only")["min-width"]!)).toBe(32);
  });

  it("CMP-01@PoC AC7: an icon-only `md` button is 40 × 40 px visible with a 44 × 44 px hit area", () => {
    const only = rule(components, ".ws-button-icon-only");
    expect(px(only["min-width"]!)).toBe(40);
    expect(hitArea()).toBe(44);
  });

  it("CMP-01@PoC AC8: `md` is 40 px visible, radius 8, 14 px 600 on one line; the hit area at least 44 px", () => {
    const md = rule(components, ".ws-button");
    expect(px(md["min-height"]!)).toBe(40);
    expect(md["border-radius"]).toBe("var(--ws-radius-md)");
    expect(radii["radius-md"]).toBe(8);
    expect(md["font-size"]).toBe("var(--ws-text-body-sm-size)");
    expect(md["line-height"]).toBe("var(--ws-text-body-sm-line)");
    expect(typeScale["body-sm"].size).toBe(14);
    expect(md["font-weight"]).toBe("600");
    expect(md["white-space"]).toBe("nowrap");
    expect(md["flex"]).toBe("none");
    expect(px(md["gap"]!)).toBe(8);
    expect(hitArea()).toBeGreaterThanOrEqual(44);
  });

  it("CMP-01@PoC AC8: secondary is white FFFFFF with a 1 px 7B8494 border and 1B2230 text, 14 px padding", () => {
    const md = rule(components, ".ws-button");
    expect(md).toMatchObject({
      background: "var(--ws-surface-200)",
      border: "1px solid var(--ws-border-control)",
      color: "var(--ws-ink)",
    });
    expect(px(md["--ws-button-pad"]!)).toBe(14);
    expect(light("surface-200")).toBe("#FFFFFF");
    expect(light("border-control")).toBe("#7B8494");
    expect(light("ink")).toBe("#1B2230");
    expect(ratio("border-control", "surface-200")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.ui);
  });

  it("CMP-01@PoC AC8: primary 16 px padding with no visible border; quiet transparent with link text, 12 px; danger a 1.5 px loss border", () => {
    const primary = rule(components, ".ws-button-primary");
    expect(px(primary["--ws-button-pad"]!)).toBe(16);
    expect(primary["border-color"]).toBe(primary["background"]);
    expect(primary["color"]).toBe("var(--ws-on-brand)");
    const quiet = rule(components, ".ws-button-quiet");
    expect(quiet).toMatchObject({
      "border-color": "transparent",
      background: "transparent",
      color: "var(--ws-link)",
    });
    expect(px(quiet["--ws-button-pad"]!)).toBe(12);
    expect(light("link")).toBe("#1D4E89");
    const danger = rule(components, ".ws-button-danger");
    expect(danger["border"]).toBe("calc(var(--ws-space-1) * 3 / 8) solid var(--ws-loss)");
    expect(px("calc(var(--ws-space-1) * 3 / 8)")).toBe(1.5);
    expect(danger["color"]).toBe("var(--ws-loss)");
    expect(light("loss")).toBe("#B23A3A");
  });

  it("CMP-01@PoC: hover and focus transitions take 150 ms ease-out (120–200 ms), instant with reduced motion", () => {
    expect(rule(components, ".ws-button")["transition"]).toBe(
      "background-color var(--ws-duration-interaction) var(--ws-easing-out)",
    );
    expect(motion["duration-interaction"]).toBeGreaterThanOrEqual(120);
    expect(motion["duration-interaction"]).toBeLessThanOrEqual(200);
    expect(base).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*transition-duration: var\(--ws-duration-reduced\) !important/,
    );
  });

  it("CMP-01@PoC «Адаптивність»: a row of buttons wraps 16 px apart with the main action on the right", () => {
    expect(rule(components, ".ws-button-row")).toMatchObject({
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "flex-end",
      gap: "var(--ws-space-4)",
    });
  });
});
