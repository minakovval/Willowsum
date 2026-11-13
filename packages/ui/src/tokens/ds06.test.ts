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
 * Playwright check of NFR-07 (`apps/web/e2e/contrast.spec.ts`).
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const stylesDir = here("../styles/");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") && name !== "tokens.css" ? [full] : [];
  });
}
const sheets = cssFiles(here("../")).map((f) => [f.slice(here("../").length), readFileSync(f, "utf8")]);

/**
 * The DS-06@PoC table «Токен | Світла тема», row for row (item 2). Copied here rather than read from
 * docs/: the `web` CI job is skipped on docs-only PRs, so a test that reads docs/ could go stale
 * silently (tools/pr-rules ci-paths rule, review #92). A change of the table changes this list.
 */
const TABLE: readonly (readonly [string, string])[] = [
  ["surface-100", "#FBFBFA"],
  ["surface-200", "#FFFFFF"],
  ["surface-300", "#F1F1EF"],
  ["ink", "#1B2230"],
  ["ink-muted", "#566174"],
  ["line", "#E5E5E2"],
  ["border-control", "#7B8494"],
  ["brand", "#0B2545"],
  ["brand-hover", "#173A66"],
  ["brand-pressed", "#061833"],
  ["on-brand", "#F6F1E8"],
  ["brand-2", "#1D4E89"],
  ["accent", "#E3A33B"],
  ["on-accent", "#0B2545"],
  ["link", "#1D4E89"],
  ["focus", "#1D4E89"],
  ["gain", "#27704C"],
  ["loss", "#B23A3A"],
  ["gain-soft", "#387F5A"],
  ["loss-soft", "#C34A48"],
  ["usage-0", "#0E7A3B"],
  ["usage-30", "#34A853"],
  ["usage-55", "#7CC242"],
  ["usage-75", "#C9C21A"],
  ["usage-95", "#FBBC05"],
  ["over-1", "#E3A39B"],
  ["over-2", "#DE7A6F"],
  ["over-3", "#E5584A"],
  ["over-4", "#F2281A"],
  ["over-5", "#D21C10"],
  ["over-6", "#B5180C"],
  ["over-7", "#94130A"],
  ["over-8", "#7A0F08"],
  ["chart-cat-1", "#5872D2"],
  ["chart-cat-2", "#0E9161"],
  ["chart-cat-3", "#9C7305"],
  ["chart-cat-4", "#097FCD"],
  ["chart-cat-5", "#C35047"],
  ["chart-cat-6", "#9B5BB6"],
  ["chart-cat-7", "#0F899B"],
  ["chart-cat-8", "#678800"],
  ["chart-group-income-1", "#BA4E84"],
  ["chart-group-income-2", "#BE590F"],
  ["chart-transfer", "#9DB2C8"],
  ["chart-other", "#9AA3AF"],
  ["chart-reference", "rgba(27, 34, 48, 0.6)"],
  ["goal-0", "#FFD000"],
  ["goal-25", "#E6CF1A"],
  ["goal-55", "#9ACD32"],
  ["goal-80", "#4CAF50"],
  ["goal-100", "#2E7D32"],
  ["goal-paused", "#C5CAD1"],
  ["on-warning", "#7A4505"],
  ["tint-warning", "#FBF3E8"],
  ["warning-line", "#A15C07"],
  ["disabled-bg", "#E7E1D3"],
  ["disabled-ink", "#8A8F99"],
  ["overlay", "rgba(11, 37, 69, 0.45)"],
  ["scrim", "rgba(11, 37, 69, 0.36)"],
  ["surface-inset", "#FAFAF8"],
  ["tint-info", "#EEF2F7"],
  ["tint-positive", "#E9F3EE"],
  ["tint-negative", "#F8ECEC"],
  ["skeleton", "#ECEEF1"],
];
const tableRows = TABLE.map(([name, light]) => ({ name, light }));

/** The light block of the generated CSS: `:root, [data-theme="light"] { … }`. */
const lightBlock = (() => {
  const css = buildTokensCss();
  const start = css.indexOf(':root,\n[data-theme="light"] {');
  return css.slice(start, css.indexOf("}", start));
})();

const ratio = (fg: ColorTokenName, bg: ColorTokenName) => contrastRatio(colors[fg].light, colors[bg].light);

describe("DS-06@PoC colour tokens", () => {
  it("DS-06@PoC AC1: the light value of every token in the table is exactly the token and the CSS on the root", () => {
    expect(tableRows).toHaveLength(COLOR_TOKEN_NAMES.length);
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
