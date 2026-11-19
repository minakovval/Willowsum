// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brandColors, colors, contrastRatio, cssDeclarations, type ColorTokenName } from "./index.ts";
import { ACCENT_SELECTORS } from "./roles.ts";

/**
 * DS-06@PoC items 1, 3, 5 and 6 (colour tokens): checked on the real stylesheets, the sources and the
 * token values. Items 2, 4 and 7 and the criteria are in `ds06.test.ts`.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(full).isDirectory()) return walk(full, ext);
    return ext.test(name) ? [full] : [];
  });
}

const uiSrc = here("../");
const webSrc = here("../../../../apps/web/src/");
const sheets = [...walk(uiSrc, /\.css$/), ...walk(webSrc, /\.css$/)].filter((f) => !f.endsWith("tokens.css"));
const decls = sheets.flatMap((f) => cssDeclarations(readFileSync(f, "utf8")).map((d) => ({ ...d, file: f })));
const COLOUR_PROPERTY =
  /^(color|background|background-color|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration-color)$/;
const NAMED = /\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|navy|silver|teal)\b/i;

describe("DS-06@PoC colour tokens (items 1, 3, 5, 6)", () => {
  it("DS-06@PoC FR 1: every colour in a stylesheet or in code is a token, never a literal", () => {
    expect(decls.length).toBeGreaterThan(1000);
    const colourDecls = decls.filter((d) => COLOUR_PROPERTY.test(d.property));
    expect(colourDecls.length).toBeGreaterThan(300);
    for (const d of colourDecls) {
      const value = d.value.replace(/var\([^)]*\)/g, "");
      expect(value, `${d.file} ${d.selector} ${d.property}`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch)\(/,
      );
      expect(value, `${d.file} ${d.selector} ${d.property}`).not.toMatch(NAMED);
    }
    // Most colour declarations read a token (the rest are `none`, `transparent`, `currentColor`, system colours).
    const tokenised = colourDecls.filter((d) => d.value.includes("var(--ws-"));
    expect(tokenised.length / colourDecls.length).toBeGreaterThan(0.8);

    // Code: no colour literal in a function, a component or an inline style.
    const sources = [...walk(uiSrc, /\.tsx?$/), ...walk(webSrc, /\.tsx?$/)].filter(
      (f) =>
        !/\.test\.tsx?$/.test(f) && !f.includes(join("ui", "src", "tokens")) && !f.includes("test-utils"),
    );
    for (const file of sources) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(/["'`]#[0-9a-fA-F]{6}\b|["'`]#[0-9a-fA-F]{3}["'`]|\brgba?\(\s*\d/);
    }
  });

  it("DS-06@PoC FR 3: brand works (primary button, page ink), brand-2 is secondary and the link, surfaces carry the page, cards and fields", () => {
    const value = (selector: string, property: string) =>
      decls.find((d) => d.selector === selector && d.property === property && d.atRules.length === 0)?.value;
    expect(value(".ws-button-primary", "background")).toBe("var(--ws-brand)");
    expect(value("a", "color")).toBe("var(--ws-link)");
    expect(colors.link.light).toBe(colors["brand-2"].light);
    expect(colors.brand.light).toBe(brandColors.navy);
    expect(colors["brand-2"].light).toBe(brandColors.blue);
    // Surfaces: page 100, cards and fields 200; text is ink.
    expect(value("body", "background")).toBe("var(--ws-surface-100)");
    expect(value("body", "color")).toBe("var(--ws-ink)");
    expect(value(".ws-card", "background")).toBe("var(--ws-surface-200)");
    expect(value(".ws-field-box", "background")).toBe("var(--ws-surface-200)");
    // The accent is the goal and the small leaf only, never text or a border (checked in full by AC4 and AC5);
    // here the accent token itself is the brand's amber.
    expect(colors.accent.light).toBe(brandColors.amber);
    expect(
      decls
        .filter((d) => COLOUR_PROPERTY.test(d.property) && /--ws-accent\b/.test(d.value))
        // The goal icon of «Цілі» is the one fill (GRID-04@PoC FR 7; ACCENT_SELECTORS).
        .filter((d) => !ACCENT_SELECTORS.some((re) => re.test(d.selector)))
        .map((d) => d.selector),
    ).toEqual([]);
    // The sum is not painted: no amount selector has a colour from `gain` or `loss`.
    for (const d of decls.filter((x) => /\.ws-amount/.test(x.selector) && x.property === "color"))
      expect(d.value, d.selector).not.toMatch(/--ws-(gain|loss)/);
    // `gain` and `loss` are the change's colours, paired with an arrow or a word; the utility classes use them.
    expect(value(".ws-gain", "color")).toBe("var(--ws-gain)");
    expect(value(".ws-loss", "color")).toBe("var(--ws-loss)");
    // The warning has its own tokens, not the amber.
    expect(colors["tint-warning"].light).not.toBe(colors.accent.light);
    // The limit scale has its own gradient and eight over-limit shades.
    for (const n of [0, 30, 55, 75, 95]) expect(colors[`usage-${n}` as ColorTokenName]).toBeDefined();
    for (let n = 1; n <= 8; n++) expect(colors[`over-${n}` as ColorTokenName]).toBeDefined();
  });

  it("DS-06@PoC FR 5: the reference contrast values of the palette hold (paper = surface-100)", () => {
    const c = (fg: ColorTokenName | string, bg: ColorTokenName | string) =>
      contrastRatio(
        fg in colors ? colors[fg as ColorTokenName].light : fg,
        bg in colors ? colors[bg as ColorTokenName].light : bg,
      );
    const one = (n: number) => Math.round(n * 10) / 10;
    const two = (n: number) => Math.round(n * 100) / 100;
    expect(one(c("brand", "surface-100"))).toBe(14.9);
    expect(one(c("on-brand", "brand"))).toBe(13.7);
    expect(one(c("brand-2", "surface-100"))).toBe(8.1);
    expect(one(c("accent", "brand"))).toBe(7.0);
    expect(one(c(brandColors.steel, "brand"))).toBe(7.1);
    expect(one(c("ink", "surface-100"))).toBe(15.4);
    expect(one(c("ink-muted", "surface-100"))).toBe(6.0);
    // Amber on paper: 2,1 : 1, which is why it is never text or a border on a light ground.
    expect(one(c("accent", "surface-100"))).toBe(2.1);
    expect(c("accent", "surface-100")).toBeLessThan(3);
    expect(two(c("on-warning", "tint-warning"))).toBe(7.12);
    expect(two(c("warning-line", "tint-warning"))).toBe(4.71);
    expect(two(c("warning-line", "surface-200"))).toBe(5.19);
    expect(two(c("gain", "tint-positive"))).toBe(5.28);
    expect(two(c("loss", "tint-negative"))).toBe(5.11);
    expect(two(c("link", "tint-info"))).toBe(7.46);
    expect(two(c("ink-muted", "surface-300"))).toBe(5.53);
  });

  it("DS-06@PoC FR 6: the named brand colours are Navy, Blue, Amber, Steel, Sand and Paper, and the tokens use them", () => {
    expect(brandColors).toEqual({
      navy: "#0B2545",
      blue: "#1D4E89",
      amber: "#E3A33B",
      steel: "#9DB2C8",
      sand: "#EBDFC6",
      paper: "#F6F1E8",
    });
    expect(colors.brand.light).toBe(brandColors.navy);
    expect(colors["brand-2"].light).toBe(brandColors.blue);
    expect(colors.accent.light).toBe(brandColors.amber);
    expect(colors["chart-transfer"].light).toBe(brandColors.steel);
    expect(colors["on-brand"].light).toBe(brandColors.paper);
    // Sand is the brand on the dark theme.
    expect(colors.brand.dark).toBe(brandColors.sand);
  });
});
