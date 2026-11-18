// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakpoints,
  colors,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  contrastRatio,
  cssDeclarations,
  layout,
  navFormOf,
  type CssDeclaration as Declaration,
} from "../tokens/index.ts";

/**
 * GRID-00@PoC general rules (part 2), read from the shipped stylesheets of the design system and of the app. jsdom has
 * no layout, so a rule is read and compared with the value the requirement or the token declares.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const parse = (file: string) => cssDeclarations(readFileSync(file, "utf8"));
const sheet = (name: string) => parse(here(`./${name}.css`));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}
/** Every stylesheet that ships: the design system's and the app's. */
const shipped = [...cssFiles(here("../")), ...cssFiles(here("../../../../apps/web/src"))];
const shippedExceptTokens = shipped.filter((f) => !f.endsWith("/styles/tokens.css"));
const all = (files: string[]): (Declaration & { file: string })[] =>
  files.flatMap((file) => parse(file).map((d) => ({ ...d, file })));

const rule = (decls: Declaration[], selector: string, property: string) =>
  decls.find(
    (d) =>
      d.selector.split(",").some((s) => s.trim() === selector) &&
      d.property === property &&
      d.atRules.length === 0,
  )?.value;

describe("GRID-00@PoC FR 1, AC1: one layout from 1280 px; nothing scrolls sideways; targets are 44 px", () => {
  it("GRID-00@PoC FR 1: the shell takes its form from the window — the sidebar from 1280 px — and its stylesheet has no width queries of its own", () => {
    expect(breakpoints.sidebar).toBe(1280);
    expect(navFormOf(1280)).toBe("sidebar");
    expect(navFormOf(1440)).toBe("sidebar");
    expect(layout["sidebar-width"]).toBe(212);
    // One form from 1280 px (PoC): no rule of the shell changes with the window width.
    expect(sheet("shell").filter((d) => d.atRules.some((r) => /width/.test(r)))).toEqual([]);
  });

  it("GRID-00@PoC AC1: no rule makes the page scroll sideways, and the controls of the shell have a 44 px target", () => {
    const touch = 44;
    expect(layout["touch-target"]).toBe(touch);
    const tokens = sheet("tokens");
    expect(tokens.find((d) => d.selector === ":root" && d.property === "--ws-touch-target")?.value).toBe(
      `${touch}px`,
    );
    // Only the tabs may scroll sideways (FR 9, checked in grid00-css.test.ts); nowhere does the page or the main area.
    for (const sel of ["html", "body", ".ws-shell", ".ws-shell-body", ".ws-main", ".ws-main-inner"]) {
      for (const prop of ["overflow", "overflow-x"]) {
        expect(["scroll", "auto"], `${sel} ${prop}`).not.toContain(rule(all(shipped), sel, prop));
      }
    }
    const components = sheet("components");
    const base = sheet("base");
    const shell = sheet("shell");
    expect(rule(components, ".ws-icon-button", "min-width")).toBe("var(--ws-touch-target)");
    expect(rule(components, ".ws-icon-button", "min-height")).toBe("var(--ws-touch-target)");
    expect(rule(base, ".ws-skip", "min-height")).toBe("var(--ws-touch-target)");
    expect(rule(shell, ".ws-nav-item", "min-height")).toBe("var(--ws-touch-target)");
  });
});

describe("GRID-00@PoC FR 11: skip links and a header that does not cover the focus", () => {
  it("GRID-00@PoC FR 11: a skip link is off the screen until it has the focus, then shown on the top layer, 44 px tall", () => {
    const base = sheet("base");
    expect(rule(base, ".ws-skip", "transform")).toBe("translateY(-200%)");
    expect(rule(base, ".ws-skip", "position")).toBe("fixed");
    expect(rule(base, ".ws-skip", "z-index")).toBe("var(--ws-layer-top)");
    expect(rule(base, ".ws-skip:focus", "transform")).toBe("none");
    expect(rule(base, ".ws-skip", "min-height")).toBe("var(--ws-touch-target)");
  });

  it("GRID-00@PoC FR 11: nothing in the shell sticks to the top of the page over the content — only the navigation and the skip links are fixed", () => {
    const stuck = [...sheet("shell"), ...sheet("base")].filter(
      (d) => d.property === "position" && /^(sticky|fixed)$/.test(d.value),
    );
    expect(stuck.map((d) => d.selector.trim()).sort()).toEqual([".ws-nav", ".ws-skip"]);
    // The navigation is at the side, so it cannot hide what the content scrolls to the top.
    expect(rule(sheet("shell"), ".ws-nav-sidebar", "inset-inline-start")).toBe("0");
    expect(rule(sheet("shell"), ".ws-shell-body", "margin-inline-start")).toBe("var(--ws-nav-width)");
  });
});

describe("GRID-00@PoC FR 15, FR 16, AC9: quiet secondary controls", () => {
  it("GRID-00@PoC FR 15, AC9: an icon-only control has no border or fill, is grey until hover, and keeps a 44 px target", () => {
    const c = sheet("components");
    expect(rule(c, ".ws-icon-button", "border")).toBe("0");
    expect(rule(c, ".ws-icon-button", "background")).toBe("transparent");
    expect(rule(c, ".ws-icon-button", "color")).toBe("var(--ws-ink-muted)");
    const hover = c.find(
      (d) => d.selector.includes(".ws-icon-button:hover") && d.property === "color",
    )?.value;
    expect(hover).toBe("var(--ws-ink)");
    expect(rule(c, ".ws-icon-button", "min-width")).toBe("var(--ws-touch-target)");
    expect(rule(c, ".ws-icon-button", "min-height")).toBe("var(--ws-touch-target)");
  });
});

describe("GRID-00@PoC FR 18, FR 33: the name ladder", () => {
  it("GRID-00@PoC FR 18: a name goes one line, one line at 85 %, two lines at 85 % that break inside a word, then the ellipsis", () => {
    const c = sheet("components");
    const at = (selector: string, property: string) =>
      c.find((d) => d.selector === selector && d.property === property)?.value;
    // The plain one-line cut stays as it was.
    expect(at(".ws-truncate", "white-space")).toBe("nowrap");
    expect(at(".ws-truncate", "text-overflow")).toBe("ellipsis");
    // 85 % in both of the later steps; the first step has no size rule.
    const smaller = c.find(
      (d) => d.selector.includes('.ws-truncate--name[data-fit="smaller"]') && d.property === "font-size",
    );
    expect(smaller?.value).toBe("85%");
    expect(smaller?.selector).toContain('.ws-truncate--name[data-fit="two"]');
    expect(c.some((d) => d.selector.includes('[data-fit="one"]'))).toBe(false);
    // The two-line step: at most two lines, whole word wrap with a break inside a long word (EC2).
    const two = '.ws-truncate--name[data-fit="two"]';
    expect(at(two, "-webkit-line-clamp")).toBe("2");
    expect(at(two, "line-clamp")).toBe("2");
    expect(at(two, "display")).toBe("-webkit-box");
    expect(at(two, "white-space")).toBe("normal");
    expect(at(two, "overflow-wrap")).toBe("anywhere");
    // The clamp ends in the ellipsis of `.ws-truncate`: overflow stays hidden, so more than two lines never show.
    expect(at(".ws-truncate", "overflow")).toBe("hidden");
  });

  it("GRID-00@PoC FR 33: text is cut vertically nowhere except by the two-line name clamp", () => {
    const clamps = all(shipped).filter((d) => /line-clamp/.test(d.property) && d.value !== "none");
    expect(clamps.length).toBeGreaterThan(0);
    for (const d of clamps) expect(d.selector, d.file).toContain(".ws-truncate--name");
    // The page and the main area never have a fixed or maximum height that would cut their text.
    const pageBlocks = all(shipped).filter(
      (d) =>
        [".ws-shell", ".ws-shell-body", ".ws-main", ".ws-main-inner"].includes(d.selector.trim()) &&
        /^(height|max-height|block-size|max-block-size)$/.test(d.property),
    );
    expect(pageBlocks).toEqual([]);
  });
});

describe("GRID-00@PoC FR 22: amber is for goals only", () => {
  it("GRID-00@PoC FR 22: no stylesheet uses the amber accent for text, borders, outlines, counters or badges; the goal progress scale is not amber", () => {
    const amber = colors.accent.light.toLowerCase();
    const uses = all(shippedExceptTokens).filter(
      (d) => /--ws-(accent|mark-small)\b/.test(d.value) || d.value.toLowerCase().includes(amber),
    );
    for (const d of uses) {
      expect(d.property, `${d.file} ${d.selector}`).toMatch(/^(background|background-color|fill)$/);
      expect(d.selector, d.file).not.toMatch(/badge|count|chip|input|text|link|button/);
    }
    // The goal scale that fills a goal's progress bar is yellow-green, a different colour from the amber mark.
    for (const goal of ["goal-0", "goal-25", "goal-55", "goal-80", "goal-100"] as const) {
      expect(colors[goal].light.toLowerCase(), goal).not.toBe(amber);
    }
  });
});

describe("GRID-00@PoC FR 25, FR 26, FR 28, AC11: light theme from tokens, text that scales, contrast", () => {
  it("GRID-00@PoC FR 25: every colour in every stylesheet of the design system and the app comes from a token — no hex, rgb or hsl literal outside tokens.css", () => {
    expect(shippedExceptTokens.length).toBeGreaterThan(5);
    expect(shippedExceptTokens.some((f) => f.includes("apps/web"))).toBe(true);
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
    const bad = all(shippedExceptTokens)
      .filter((d) => literal.test(d.value))
      .map((d) => `${d.file}: ${d.selector} { ${d.property}: ${d.value} }`);
    expect(bad).toEqual([]);
    // The default theme, the one without any attribute, is the light one (white cards on «теплий папір»).
    const root = sheet("tokens").filter(
      (d) => d.atRules.length === 0 && d.selector.split(",").some((s) => s.trim() === ":root"),
    );
    expect(root.find((d) => d.property === "color-scheme")?.value).toBe("light");
    expect(root.find((d) => d.property === "--ws-surface-200")?.value.toLowerCase()).toBe(
      colors["surface-200"].light.toLowerCase(),
    );
  });

  it("GRID-00@PoC FR 26, AC11: text sizes and line heights are in rem, the root size is not fixed, so system font size scales everything", () => {
    const tokens = sheet("tokens").filter((d) => /^--ws-text-.*-(size|line)$/.test(d.property));
    expect(tokens.length).toBeGreaterThan(20);
    for (const d of tokens) expect(d.value, d.property).toMatch(/rem$|^calc\(.*rem.*\)$/);
    const sizes = all(shipped).filter((d) => d.property === "font-size" && d.selector.trim() !== "html");
    for (const d of sizes) expect(d.value, `${d.file} ${d.selector}`).not.toMatch(/^\d+(\.\d+)?px$/);
    for (const d of all(shipped).filter((d) => d.selector.trim() === "html" && d.property === "font-size"))
      expect(d.value).toMatch(/%$/);
  });

  it("GRID-00@PoC FR 28: every text pair of the design system is at least 4.5:1 and every control border, focus ring and graphic at least 3:1 (light theme)", () => {
    expect(CONTRAST_MINIMUM.text).toBe(4.5);
    expect(CONTRAST_MINIMUM.ui).toBe(3);
    const pairs = CONTRAST_PAIRS;
    expect(pairs.filter((p) => p.kind === "text").length).toBeGreaterThan(10);
    expect(pairs.some((p) => p.fg === "focus" || p.fg === "border-control")).toBe(true);
    for (const p of pairs) {
      expect(
        contrastRatio(colors[p.fg].light, colors[p.bg].light),
        `${p.fg} on ${p.bg}`,
      ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM[p.kind]);
    }
  });
});
