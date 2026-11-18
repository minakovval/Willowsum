// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssDeclarations, layers, layout, radii, shadows, space, SCRIM_BLUR } from "../tokens/index.ts";

/**
 * DS-09@PoC items 1–8 and criteria 1, 2, 3, 4 and 6 on the real stylesheets (light theme, 1280 px): the scales,
 * the radii of the named components, the shadow levels and the layers. Criterion 5 is `tokens/no-literals.test.ts`.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (file: string) => readFileSync(file, "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const tokensCss = read(here("./tokens.css"));
const sheetFiles = [
  ...walk(here("../")).filter((f) => f.endsWith(".css") && !f.endsWith("tokens.css")),
  ...walk(here("../../../../apps/web/src/")).filter((f) => f.endsWith(".css")),
];
const decls = sheetFiles.flatMap((f) => cssDeclarations(read(f)));
const uiDecls = ["base.css", "components.css", "shell.css"].flatMap((f) =>
  cssDeclarations(read(here(`./${f}`))),
);
const find = (selector: string, property: string) =>
  uiDecls.find((d) => d.selector === selector && d.property === property && d.atRules.length === 0)?.value;
const rootVars = (css: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const d of cssDeclarations(css))
    if (/^:root\b/.test(d.selector) && d.atRules.length === 0 && !/dark/.test(d.selector))
      m.set(d.property, d.value);
  return m;
};
const vars = rootVars(tokensCss);

/** A radius or length value (`var(--ws-radius-md)`, `calc(… ± …)`) resolved to px. */
function px(value: string): number {
  const expr = value
    .replace(/var\((--ws-[a-z0-9-]+)\)/g, (_m, name: string) => {
      const v = vars.get(name);
      if (v === undefined) throw new Error(`unknown ${name}`);
      return String(parseFloat(v));
    })
    .replace(/px/g, "")
    .replace(/^calc/, "");
  if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error(`cannot resolve ${value}`);
  return Function(`return (${expr})`)() as number;
}
const radius = (selector: string) => px(find(selector, "border-radius") ?? "");
const z = (selector: string) => px(find(selector, "z-index") ?? "");

describe("DS-09@PoC scales (stylesheets)", () => {
  it("DS-09@PoC FR 1: the spacing steps are 4, 8, 12, 16, 24, 32, 48 and 64 px, and no stylesheet spaces anything with a literal length", () => {
    const steps = Object.entries(space).map(([k, v]): [string, string] => [`--ws-${k}`, `${v}px`]);
    expect(steps.map(([k]) => k)).toHaveLength(8);
    for (const [k, v] of steps) expect(vars.get(k)).toBe(v);
    expect(steps.map(([, v]) => parseInt(v))).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
    const spacing = uiDecls.filter((d) =>
      /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(d.property),
    );
    expect(spacing.length).toBeGreaterThan(200);
    for (const d of spacing) {
      if (d.value === "-1px") continue; // the visually-hidden clip, not layout
      // Only tokens, 0, auto and the 1 px visually-hidden offset: «Відступи — лише кроки шкали».
      const rest = d.value.replace(/var\(--[a-z0-9-]+\)/g, "").replace(/\b(0|auto|calc|inherit)\b/g, "");
      expect(rest, `${d.selector} ${d.property}: ${d.value}`).not.toMatch(/\d+(\.\d+)?(px|rem|em)/);
    }
  });

  it("DS-09@PoC FR 2: card padding and the grid gap are 16 px under 600 px and 24 px from 600 px", () => {
    expect(vars.get("--ws-card-padding")).toBe("16px");
    expect(vars.get("--ws-gutter")).toBe("16px");
    const medium = cssDeclarations(tokensCss).filter((d) => d.atRules.includes("@media (min-width: 600px)"));
    expect(medium.find((d) => d.property === "--ws-card-padding")?.value).toBe("24px");
    expect(medium.find((d) => d.property === "--ws-gutter")?.value).toBe("24px");
    expect(find(".ws-card", "padding")).toBe("var(--ws-card-padding)");
  });

  it("DS-09@PoC FR 3: the radius tokens are 0, 4, 8, 14, 16 and 999 px and the product uses them as listed", () => {
    expect(radii).toEqual({
      "radius-none": 0,
      "radius-sm": 4,
      "radius-md": 8,
      "radius-lg": 14,
      "radius-xl": 16,
      "radius-pill": 999,
    });
    for (const [k, v] of Object.entries(radii)) expect(vars.get(`--ws-${k}`)).toBe(`${v}px`);
    // Navigation items and badges 4; buttons, fields, cards, menus, segmented control 8; dialogs 16; bars and tabs pill.
    expect(radius(".ws-badge")).toBe(4);
    expect(radius(".ws-button")).toBe(8);
    expect(radius(".ws-field-box")).toBe(8);
    expect(radius(".ws-card")).toBe(8);
    expect(radius(".ws-menu")).toBe(8);
    expect(radius(".ws-segmented-options")).toBe(8);
    expect(radius(".ws-menu-item")).toBe(4);
    expect(radius(".ws-dialog")).toBe(16);
    expect(radius(".ws-dialog-icon")).toBe(16);
    expect(radius(".ws-progress-track")).toBe(999);
    expect(radius(".ws-progress-fill")).toBe(999);
    expect(radius(".ws-switch-track")).toBe(999);
    expect(radius(".ws-dialog-close.ws-icon-button")).toBe(999);
  });

  it("DS-09@PoC FR 4: besides the scale only 6 px (segment, menu item, skeleton), 10 px and 12 px radii exist", () => {
    const values = new Set<number>();
    for (const d of decls) {
      if (d.property !== "border-radius") continue;
      const parts = d.value.match(/calc\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|[\d.]+(?:px|%)?/g) ?? [];
      expect(parts.length, `${d.selector}: ${d.value}`).toBeGreaterThan(0);
      for (const part of parts) if (!part.endsWith("%")) values.add(px(part));
    }
    const allowed = new Set([0, 4, 6, 8, 10, 12, 14, 16, 999]);
    for (const v of values)
      expect(allowed.has(v), `radius ${v}px is not on the scale or in the canvas list`).toBe(true);
    expect(radius(".ws-segmented-option")).toBe(6);
    expect(radius(".ws-skeleton")).toBe(6);
    expect(radius(".ws-field-box")).toBe(radii["radius-md"]);
  });

  it("DS-09@PoC FR 5: shadow levels — flat surface has none; raised, popover and dialog have the listed light values; scrim and overlay are navy", () => {
    expect(shadows["shadow-raised"].light).toBe(
      "0 1px 2px rgba(11, 37, 69, 0.10), 0 4px 12px rgba(11, 37, 69, 0.06)",
    );
    expect(shadows["shadow-popover"].light).toBe("0 8px 24px rgba(11, 37, 69, 0.16)");
    expect(shadows["shadow-dialog"].light).toBe(
      "0 2px 4px rgba(11, 37, 69, 0.06), 0 24px 48px rgba(11, 37, 69, 0.20)",
    );
    expect(vars.get("--ws-shadow-raised")).toBe(shadows["shadow-raised"].light);
    expect(vars.get("--ws-shadow-popover")).toBe(shadows["shadow-popover"].light);
    expect(vars.get("--ws-shadow-dialog")).toBe(shadows["shadow-dialog"].light);
    expect(vars.get("--ws-scrim")).toBe("rgba(11, 37, 69, 0.36)");
    expect(vars.get("--ws-overlay")).toBe("rgba(11, 37, 69, 0.45)");
    expect(vars.get("--ws-scrim-blur")).toBe(`${SCRIM_BLUR}px`);
    // Level 0: a card is a 1 px `line` border without a shadow; only `.ws-card-raised` lifts it.
    expect(find(".ws-card", "border")).toBe("1px solid var(--ws-line)");
    expect(find(".ws-card", "box-shadow")).toBeUndefined();
    expect(find(".ws-card-raised", "box-shadow")).toBe("var(--ws-shadow-raised)");
    expect(find(".ws-segmented-option:has(input:checked)", "box-shadow")).toBe("var(--ws-shadow-raised)");
    for (const sel of [".ws-menu", ".ws-dropdown-panel", ".ws-tooltip", ".ws-filter-panel"])
      expect(find(sel, "box-shadow"), sel).toBe("var(--ws-shadow-popover)");
    expect(find(".ws-dialog", "box-shadow")).toBe("var(--ws-shadow-dialog)");
  });

  it("DS-09@PoC FR 6: there are no other shadow levels — every outer shadow is one of the three tokens; the rest are inset markers or a 1 px divider", () => {
    const shadowDecls = decls.filter((d) => d.property === "box-shadow" || d.property === "text-shadow");
    expect(shadowDecls.length).toBeGreaterThan(10);
    for (const d of shadowDecls) {
      expect(d.property).toBe("box-shadow");
      const ok =
        /^var\(--ws-shadow-(raised|popover|dialog)\)$/.test(d.value) ||
        /^inset /.test(d.value) ||
        d.value === "0 -1px 0 var(--ws-line)";
      expect(ok, `${d.selector}: ${d.value}`).toBe(true);
    }
    expect(Object.keys(shadows)).toEqual(["shadow-raised", "shadow-popover", "shadow-dialog"]);
  });

  it("DS-09@PoC FR 7: the z-index scale is 0, 1–4, 10, 30, 40, 45, 50, 60 and 1000, and the layers the product sets are on it", () => {
    expect(Object.values(layers)).toEqual([0, 1, 2, 3, 4, 10, 30, 40, 45, 50, 60, 1000]);
    for (const [k, v] of Object.entries(layers)) expect(vars.get(`--ws-${k}`)).toBe(String(v));
    const used = decls.filter((d) => d.property === "z-index");
    expect(used.length).toBeGreaterThan(10);
    for (const d of used) expect(d.value, d.selector).toMatch(/^var\(--ws-layer-[a-z0-9-]+\)$/);
    // Quick navigation 40, inline tip 30, toast 60, the skip link 1000; local layers inside components 1–2.
    expect(z(".ws-nav")).toBe(40);
    expect(z(".ws-tooltip")).toBe(30);
    expect(z(".ws-toast")).toBe(60);
    expect(z(".ws-skip")).toBe(1000);
    expect(z(".ws-segmented-option input")).toBe(1);
    expect(z(".ws-select-chevron")).toBe(2);
    expect(z(".ws-toast")).toBeGreaterThan(z(".ws-nav"));
    expect(z(".ws-nav")).toBeGreaterThan(z(".ws-tooltip"));
    // Modal dialogs and sheets use the browser's top layer: no z-index on the dialog.
    expect(find(".ws-dialog", "z-index")).toBeUndefined();
  });

  it("DS-09@PoC FR 8: the content is at most 1200 px wide; the rail is 64 px and the sidebar 212 px", () => {
    expect(layout["content-max"]).toBe(1200);
    expect(layout["rail-width"]).toBe(64);
    expect(layout["sidebar-width"]).toBe(212);
    expect(vars.get("--ws-content-max")).toBe("1200px");
    expect(vars.get("--ws-rail-width")).toBe("64px");
    expect(vars.get("--ws-sidebar-width")).toBe("212px");
    expect(find(".ws-main-inner", "max-width")).toBe("var(--ws-content-max)");
    expect(find(".ws-shell", "--ws-nav-width")).toBe("var(--ws-sidebar-width)");
    expect(find('.ws-shell[data-collapsed="true"]', "--ws-nav-width")).toBe("var(--ws-rail-width)");
  });
});

describe("DS-09@PoC criteria (stylesheets)", () => {
  it("DS-09@PoC AC1: the button, field, card, badge and dialog measure 8, 8, 8, 4 and 16 px; the goal progress bar is a 999 px pill", () => {
    expect([".ws-button", ".ws-field-box", ".ws-card", ".ws-badge", ".ws-dialog"].map(radius)).toEqual([
      8, 8, 8, 4, 16,
    ]);
    expect(radius(".ws-progress-track")).toBe(999);
    expect(radius(".ws-progress-fill")).toBe(999);
  });

  it("DS-09@PoC AC2: no screen shows more than one `shadow-raised` card", () => {
    const web = here("../../../../apps/web/src/");
    const sources = walk(web).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
    expect(sources.length).toBeGreaterThan(20);
    let raised = 0;
    for (const f of sources) {
      const n = (read(f).match(/ws-card-raised/g) ?? []).length;
      raised += n;
      expect(n, f).toBeLessThanOrEqual(1);
    }
    // The only raised card of the product is the one shown on the tokens gallery page.
    expect(raised).toBe(1);
    // In the stylesheets only the raised card and the chosen segment take the level-1 shadow.
    const holders = decls.filter((d) => d.property === "box-shadow" && d.value === "var(--ws-shadow-raised)");
    expect(holders.map((d) => d.selector).sort()).toEqual(
      [".tx-segment:has(input:checked)", ".ws-card-raised", ".ws-segmented-option:has(input:checked)"].sort(),
    );
  });

  it("DS-09@PoC AC3: the dialog is a top-layer element above the sticky bar, navigation and toast, and the page under the scrim is blurred 2 px", () => {
    expect(find(".ws-dialog", "z-index")).toBeUndefined();
    expect(find(".ws-dialog::backdrop", "background")).toBe("var(--ws-scrim)");
    expect(find(".ws-dialog::backdrop", "backdrop-filter")).toBe("blur(var(--ws-scrim-blur))");
    expect(vars.get("--ws-scrim-blur")).toBe("2px");
    // Nothing the page sets can outrank the top layer: the highest page layer is the skip link, which is not shown with a dialog open.
    expect(Math.max(z(".ws-nav"), z(".ws-toast"), z(".ws-tooltip"))).toBeLessThan(layers["layer-top"]);
  });

  it("DS-09@PoC AC4: the focused «Перейти до вмісту» link is on layer 1000, at least 44 px tall, and fixed above every page layer", () => {
    expect(z(".ws-skip")).toBe(1000);
    expect(find(".ws-skip", "position")).toBe("fixed");
    expect(find(".ws-skip", "min-height")).toBe("var(--ws-touch-target)");
    expect(layout["touch-target"]).toBeGreaterThanOrEqual(44);
    for (const d of decls.filter((x) => x.property === "z-index" && x.selector !== ".ws-skip"))
      expect(px(d.value), d.selector).toBeLessThan(1000);
    expect(find(".ws-skip:focus", "transform")).toBe("none");
  });

  it("DS-09@PoC AC6: the dialog in the light theme — radius 16, shadow-dialog, scrim 0.36, a 2 px blur behind", () => {
    expect(radius(".ws-dialog")).toBe(16);
    expect(find(".ws-dialog", "box-shadow")).toBe("var(--ws-shadow-dialog)");
    expect(vars.get("--ws-shadow-dialog")).toBe(
      "0 2px 4px rgba(11, 37, 69, 0.06), 0 24px 48px rgba(11, 37, 69, 0.20)",
    );
    expect(vars.get("--ws-scrim")).toBe("rgba(11, 37, 69, 0.36)");
    expect(find(".ws-dialog::backdrop", "background")).toBe("var(--ws-scrim)");
    expect(find(".ws-dialog::backdrop", "backdrop-filter")).toBe("blur(var(--ws-scrim-blur))");
  });
});
