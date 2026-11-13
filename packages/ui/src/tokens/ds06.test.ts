// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accentTextViolations,
  accentUsageViolations,
  buildTokensCss,
  colors,
  COLOR_TOKEN_NAMES,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  contrastRatio,
  controlBorderViolations,
  cssDeclarations,
  surface300TextViolations,
  warningMeaningViolations,
  type ColorTokenName,
} from "./index.ts";

/**
 * DS-06@PoC — colour tokens and colour roles, light theme (PoC is light only, П-25). Criteria checked on
 * the token sources and on the stylesheets of this package; `apps/web/src/designSystem.test.tsx` runs
 * the same role checks over the app's stylesheets. AC2 (contrast of every route in a browser) is the
 * Playwright check of NFR-07 (plan row 20).
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const view = readFileSync(here("../../../../docs/requirements/ds/DS-06.poc.md"), "utf8");
const stylesDir = here("../styles/");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") && name !== "tokens.css" ? [full] : [];
  });
}
const sheets = cssFiles(here("../")).map((f) => [f.slice(here("../").length), readFileSync(f, "utf8")]);

/** Rows of the DS-06@PoC table «Токен | Світла тема | Призначення». */
const tableRows = view
  .split("\n")
  .filter((l) => /^\| [a-z][a-z0-9-]* \| (#|rgba)/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()))
  .map(([, name, light]) => ({ name: name!, light: light! }));

/** The light block of the generated CSS: `:root, [data-theme="light"] { … }`. */
const lightBlock = (() => {
  const css = buildTokensCss();
  const start = css.indexOf(':root,\n[data-theme="light"] {');
  return css.slice(start, css.indexOf("}", start));
})();

const ratio = (fg: ColorTokenName, bg: ColorTokenName) => contrastRatio(colors[fg].light, colors[bg].light);

describe("DS-06@PoC colour tokens", () => {
  it("DS-06@PoC AC1: the light value of every token in the table is exactly the token and the CSS on the root", () => {
    expect(tableRows.length).toBeGreaterThanOrEqual(60);
    for (const { name, light } of tableRows) {
      expect(COLOR_TOKEN_NAMES, name).toContain(name);
      expect(colors[name as ColorTokenName].light, name).toBe(light);
      expect(lightBlock, name).toContain(`--ws-${name}: ${light};`);
    }
  });

  it("DS-06@PoC AC1 (#51): gain-soft #387F5A, loss-soft #C34A48 and warning-line #A15C07 exist", () => {
    expect(colors["gain-soft"].light).toBe("#387F5A");
    expect(colors["loss-soft"].light).toBe("#C34A48");
    expect(colors["warning-line"].light).toBe("#A15C07");
    // Light step: a change up to 10 %, always with an arrow; text contrast on both surfaces.
    for (const fg of ["gain-soft", "loss-soft"] as const)
      for (const bg of ["surface-100", "surface-200"] as const)
        expect(ratio(fg, bg)).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
  });

  it("DS-06@PoC AC3: stylesheets hold no hex or rgb colour outside the token file", () => {
    expect(sheets.length).toBeGreaterThan(2);
    for (const [name, css] of sheets) {
      const code = css!.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, name).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    }
  });

  it("DS-06@PoC AC4: the accent fills only the small leaf of the mark; goal progress uses goal-0 … goal-100", () => {
    for (const [name, css] of sheets) expect(accentUsageViolations(css!), name).toEqual([]);
    // The small leaf is the accent; the goal gradient stops are their own tokens, never amber.
    expect(buildTokensCss()).toContain("--ws-mark-small: var(--ws-accent);");
    for (const stop of ["goal-0", "goal-25", "goal-55", "goal-80", "goal-100"] as const)
      expect(colors[stop].light).not.toBe(colors.accent.light);
  });

  it("DS-06@PoC AC4: the check rejects the accent on a border, an outline or a progress bar", () => {
    expect(accentUsageViolations(".x { border: 1px solid var(--ws-accent); }")).toHaveLength(1);
    expect(accentUsageViolations(".x:focus { outline-color: var(--ws-accent); }")).toHaveLength(1);
    expect(accentUsageViolations(".ws-goal-bar { background: var(--ws-accent); }")).toHaveLength(1);
    expect(accentUsageViolations(".ws-mark-small { fill: var(--ws-mark-small); }")).toEqual([]);
  });

  it("DS-06@PoC AC5: no text has the accent colour", () => {
    for (const [name, css] of sheets) expect(accentTextViolations(css!), name).toEqual([]);
    expect(accentTextViolations(".x { color: var(--ws-accent); }")).toHaveLength(1);
    expect(
      accentTextViolations("@media (min-width: 1px) { .x { color: var(--ws-mark-small) } }"),
    ).toHaveLength(1);
    expect(CONTRAST_PAIRS.some((p) => p.fg === "accent" && p.kind === "text")).toBe(false);
  });

  it("DS-06@PoC AC6: text on surface-300 is ink (brand on the current tab and navigation item)", () => {
    for (const [name, css] of sheets) expect(surface300TextViolations(css!), name).toEqual([]);
    expect(
      surface300TextViolations(".x { background: var(--ws-surface-300); color: var(--ws-ink-muted); }"),
    ).toHaveLength(1);
    expect(
      surface300TextViolations(
        ".ws-badge-neutral { background: var(--ws-surface-300); color: var(--ws-ink-muted); }",
      ),
    ).toEqual([]);
    expect(ratio("ink", "surface-300")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
  });

  it("DS-06@PoC AC7: a disabled button has a disabled-bg fill and disabled-ink text, with a reason style beside it", () => {
    const css = readFileSync(join(stylesDir, "components.css"), "utf8");
    const decls = cssDeclarations(css).filter((d) => d.selector.includes('.ws-button[aria-disabled="true"]'));
    const value = (p: string) => decls.find((d) => d.property === p)?.value;
    expect(value("background")).toBe("var(--ws-disabled-bg)");
    expect(value("color")).toBe("var(--ws-disabled-ink)");
    expect(value("cursor")).toBe("not-allowed");
    expect(decls[0]!.selector).toContain(".ws-button:disabled");
    // The reason is ordinary readable text, not the exempt disabled-ink.
    const reason = cssDeclarations(css).find(
      (d) => d.selector === ".ws-disabled-reason" && d.property === "color",
    );
    expect(reason?.value).toBe("var(--ws-ink-muted)");
  });

  it("DS-06@PoC AC8: on-warning on tint-warning is at least 4.5:1 (7.12:1) and warning-line at least 3:1 (4.71:1)", () => {
    expect(colors["on-warning"].light).toBe("#7A4505");
    expect(colors["tint-warning"].light).toBe("#FBF3E8");
    expect(ratio("on-warning", "tint-warning")).toBeCloseTo(7.12, 2);
    expect(ratio("warning-line", "tint-warning")).toBeCloseTo(4.71, 2);
    expect(ratio("warning-line", "surface-200")).toBeCloseTo(5.19, 2);
    expect(CONTRAST_PAIRS).toContainEqual(
      expect.objectContaining({ fg: "warning-line", bg: "tint-warning", kind: "ui" }),
    );
    expect(CONTRAST_PAIRS).toContainEqual(
      expect.objectContaining({ fg: "warning-line", bg: "surface-200", kind: "ui" }),
    );
  });

  it("DS-06@PoC AC9: the warning colours never mark a goal or an error", () => {
    for (const [name, css] of sheets) expect(warningMeaningViolations(css!), name).toEqual([]);
    expect(warningMeaningViolations(".ws-goal-late { color: var(--ws-on-warning); }")).toHaveLength(1);
    expect(warningMeaningViolations(".x-error { background: var(--ws-tint-warning); }")).toHaveLength(1);
    expect(warningMeaningViolations(".ws-chart-warning { stroke: var(--ws-warning-line); }")).toEqual([]);
  });

  it("DS-06@PoC AC10: badge texts of the four tones are at least 4.5:1 on their grounds", () => {
    const pairs: [ColorTokenName, ColorTokenName, number][] = [
      ["gain", "tint-positive", 5.28],
      ["on-warning", "tint-warning", 7.12],
      ["loss", "tint-negative", 5.11],
      ["link", "tint-info", 7.46],
    ];
    for (const [fg, bg, documented] of pairs) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
      expect(ratio(fg, bg)).toBeCloseTo(documented, 1);
    }
  });

  it("DS-06@PoC AC11: buttons, fields, switches and checkboxes are bordered in border-control #7B8494 (≥ 3:1 on surface-200)", () => {
    expect(colors["border-control"].light).toBe("#7B8494");
    expect(ratio("border-control", "surface-200")).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.ui);
    const css = readFileSync(join(stylesDir, "components.css"), "utf8");
    const border = (sel: string) =>
      cssDeclarations(css).find((d) => d.selector === sel && d.property === "border")?.value;
    expect(border(".ws-button")).toBe("1px solid var(--ws-border-control)");
    expect(border(".ws-switch-track")).toBe("1px solid var(--ws-border-control)");
    const controls = [/\.ws-(button|switch|input|field|checkbox|select|search|chip)/];
    for (const [name, sheet] of sheets) expect(controlBorderViolations(sheet!, controls), name).toEqual([]);
    expect(controlBorderViolations(".ws-input { border: 1px solid var(--ws-line); }", controls)).toHaveLength(
      1,
    );
  });

  it("DS-06@PoC EC1: in forced colours the focus ring is an outline and controls keep a border", () => {
    const base = readFileSync(join(stylesDir, "base.css"), "utf8");
    const focus = cssDeclarations(base).filter((d) => d.selector === ":focus-visible");
    expect(focus.map((d) => d.property)).toContain("outline");
    expect(focus.some((d) => d.property === "box-shadow")).toBe(false);
    const components = readFileSync(join(stylesDir, "components.css"), "utf8");
    expect(
      cssDeclarations(components).some(
        (d) =>
          d.atRules.includes("@media (forced-colors: active)") &&
          d.selector.includes(".ws-switch-track::after"),
      ),
    ).toBe(true);
  });

  it("DS-06@PoC EC2: every colour token has both theme values and every new text or graphic token a contrast check", () => {
    for (const name of COLOR_TOKEN_NAMES) {
      expect(colors[name].light, name).toMatch(/^(#[0-9A-F]{6}|rgba\(.+\))$/);
      expect(colors[name].dark, name).toMatch(/^(#[0-9A-F]{6}|rgba\(.+\))$/);
    }
    const checked = new Set(CONTRAST_PAIRS.map((p) => p.fg));
    for (const name of ["gain-soft", "loss-soft", "warning-line"] as const) expect(checked).toContain(name);
  });
});
