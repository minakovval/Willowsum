// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  colors,
  contrastRatio,
  cssDeclarations,
  layout,
  space,
  type ColorTokenName,
} from "../tokens/index.ts";

/**
 * DS-14@PoC items 1, 2, 4, 5, 7 and 10, criteria 7, 8 and 9, and edge case 2 on the real stylesheets (light theme,
 * 1280 px; the contrast pairs in both themes). Items 3, 6, 8, 9 and the criteria on focus are in
 * `dialog/ds14-items.test.tsx` and `tokens/contrast.test.ts`.
 */
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const base = cssDeclarations(read("base.css"));
const components = cssDeclarations(read("components.css"));
const shell = cssDeclarations(read("shell.css"));
const all = [...base, ...components, ...shell];
const rule = (list: typeof all, selector: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const norm = (x: string) => x.replace(/\s+/g, " ").replace(/, /g, ",");
  for (const d of list)
    if (norm(d.selector) === norm(selector) && d.atRules.length === 0) out[d.property] = d.value;
  return out;
};
const has = (list: typeof all, selector: string) => list.some((d) => d.selector === selector);
const light = (name: ColorTokenName) => colors[name].light;
const ratio = (fg: string, bg: string) => contrastRatio(fg, bg);

/** Resolves `calc(var(--ws-touch-target) - var(--ws-space-1))` and the like to px. */
function px(value: string): number {
  const expr = value
    .replace(/var\(--ws-space-(\d)\)/g, (_m, n: string) => String(space[`space-${n}` as keyof typeof space]))
    .replace(/var\(--ws-touch-target\)/g, String(layout["touch-target"]))
    .replace(/^calc/, "");
  return Function(`return (${expr})`)() as number;
}

describe("DS-14@PoC interaction states (stylesheets)", () => {
  it("DS-14@PoC FR 1: a button and a field have a rule for every state — normal, hover, pressed (buttons), focus, disabled, and loading (buttons)", () => {
    for (const s of [
      ".ws-button",
      ".ws-button:hover",
      ".ws-button:active",
      ".ws-button-primary:hover",
      ".ws-button-primary:active",
      ".ws-button-quiet:hover",
      ".ws-button-quiet:active",
      '.ws-button[aria-busy="true"]',
      ".ws-field-box",
      ".ws-field-box:hover",
      ".ws-field-box:has(.ws-field-input:focus-visible)",
      '.ws-field[data-state="readonly"] .ws-field-box',
      '.ws-field[data-state="disabled"] .ws-field-box',
    ])
      expect(has(components, s), s).toBe(true);
    expect(
      has(
        components,
        '.ws-button:disabled, .ws-button[aria-disabled="true"], .ws-button[aria-disabled="true"]:hover, .ws-button[aria-disabled="true"]:active',
      ),
    ).toBe(true);
    // The switch and the check box change on focus and when checked.
    expect(has(components, ".ws-switch input:focus-visible + .ws-switch-track")).toBe(true);
    expect(rule(components, ".ws-check-box[data-checked]")["background"]).toBe("var(--ws-brand)");
  });

  it("DS-14@PoC FR 2: primary is brand, brand-hover, brand-pressed with on-brand text; secondary is surface-200 with a 1 px border-control border and ink, surface-300 on hover, line pressed; quiet takes surface-300 on hover; a field's border turns ink on hover", () => {
    expect(rule(components, ".ws-button-primary")["background"]).toBe("var(--ws-brand)");
    expect(rule(components, ".ws-button-primary")["color"]).toBe("var(--ws-on-brand)");
    expect(rule(components, ".ws-button-primary:hover")["background"]).toBe("var(--ws-brand-hover)");
    expect(rule(components, ".ws-button-primary:active")["background"]).toBe("var(--ws-brand-pressed)");
    const secondary = rule(components, ".ws-button");
    expect(secondary["background"]).toBe("var(--ws-surface-200)");
    expect(secondary["border"]).toBe("1px solid var(--ws-border-control)");
    expect(secondary["color"]).toBe("var(--ws-ink)");
    expect(rule(components, ".ws-button:hover")["background"]).toBe("var(--ws-surface-300)");
    expect(rule(components, ".ws-button:active")["background"]).toBe("var(--ws-line)");
    expect(rule(components, ".ws-button-quiet:hover")["background"]).toBe("var(--ws-surface-300)");
    expect(rule(components, ".ws-field-box:hover")["border-color"]).toBe("var(--ws-ink)");
    // The border of every control kind is `border-control`, never a lighter grey or a literal.
    expect(rule(components, ".ws-field-box")["border"]).toBe("1px solid var(--ws-border-control)");
    expect(rule(components, ".ws-check-box")["border"]).toBe("1.5px solid var(--ws-border-control)");
    expect(["#C9CDD3", "#9AA3AF"].map((c) => ratio(c, light("surface-200")).toFixed(2))).toEqual([
      "1.60",
      "2.55",
    ]);
    const literals = all.filter((d) => /border/.test(d.property) && /#C9CDD3|#9AA3AF/i.test(d.value));
    expect(literals).toEqual([]);
  });

  it("DS-14@PoC FR 4: nothing pinned to the page can cover a focused element — the navigation sits beside the content, not over it, and there is no sticky bar", () => {
    expect(all.filter((d) => d.property === "position" && d.value === "sticky")).toEqual([]);
    // The page content starts after the navigation (the sidebar or the rail), so the sidebar never overlaps it.
    expect(rule(shell, ".ws-shell-body")["margin-inline-start"]).toBe("var(--ws-nav-width)");
    const fixed = all.filter((d) => d.property === "position" && d.value === "fixed").map((d) => d.selector);
    // The skip link, the tooltip, the toast and the navigation: each is transient or beside the content.
    expect(new Set(fixed)).toEqual(new Set([".ws-skip", ".ws-tooltip", ".ws-toast", ".ws-nav"]));
  });

  it("DS-14@PoC FR 5: a disabled control is disabled-bg with disabled-ink and no border; a read-only field keeps its border and stands on surface-100", () => {
    const disabled = rule(
      components,
      '.ws-button:disabled, .ws-button[aria-disabled="true"], .ws-button[aria-disabled="true"]:hover, .ws-button[aria-disabled="true"]:active',
    );
    expect(disabled).toMatchObject({
      background: "var(--ws-disabled-bg)",
      color: "var(--ws-disabled-ink)",
      "border-color": "transparent",
    });
    expect(rule(components, '.ws-field[data-state="disabled"] .ws-field-box')).toMatchObject({
      background: "var(--ws-disabled-bg)",
      color: "var(--ws-disabled-ink)",
      "border-color": "transparent",
    });
    const readonly = rule(components, '.ws-field[data-state="readonly"] .ws-field-box');
    expect(readonly["background"]).toBe("var(--ws-surface-100)");
    expect(readonly["border-color"]).toBeUndefined(); // the base `border-control` border stays
    expect(rule(components, ".ws-field-box")["border"]).toBe("1px solid var(--ws-border-control)");
    expect(rule(components, ".ws-disabled-reason")["color"]).toBe("var(--ws-ink-muted)");
  });

  it("DS-14@PoC FR 6, AC6: a loading button keeps its size — the busy rule changes only the cursor and takes the spinner's room out of the padding", () => {
    const busy = [...components.filter((d) => d.selector.startsWith('.ws-button[aria-busy="true"]'))];
    expect(busy.map((d) => d.property).sort()).toEqual(["cursor", "padding-inline"]);
    for (const p of ["width", "min-width", "height", "min-height", "font-size", "border-width"])
      expect(busy.some((d) => d.property === p)).toBe(false);
    expect(rule(components, '.ws-button[aria-busy="true"]')["cursor"]).toBe("progress");
  });

  it("DS-14@PoC FR 7, AC8: a typical button is 40 px and a small one 32 px visibly, and each has a hit area of at least 44 × 44 px", () => {
    const visible = (selector: string) => px(rule(components, selector)["min-height"]!);
    expect(visible(".ws-button")).toBe(40);
    expect(visible(".ws-button-sm")).toBe(32);
    const after = rule(components, ".ws-button::after");
    expect(after).toMatchObject({
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "max(100%, var(--ws-touch-target))",
      height: "max(100%, var(--ws-touch-target))",
    });
    expect(layout["touch-target"]).toBeGreaterThanOrEqual(44);
    // The small button does not turn the hit area off or shrink it.
    expect(has(components, ".ws-button-sm::after")).toBe(false);
    // The field's input is 44 px tall inside its 40 px box; the minimum target of 24 px is met by everything.
    expect(rule(components, ".ws-field-input")["block-size"]).toBe("var(--ws-touch-target)");
    expect(px(rule(components, ".ws-field-box")["block-size"]!)).toBe(40);
  });

  it("DS-14@PoC FR 10: links in running text are underlined; a stand-alone link is underlined on hover and focus and inside a paragraph or list it is underlined always", () => {
    expect(rule(base, "a")["text-decoration"]).toBe("underline");
    expect(rule(base, "p .ws-link, li .ws-link")["text-decoration"]).toBe("underline");
    expect(rule(base, ".ws-link")["text-decoration"]).toBe("none");
    expect(rule(base, ".ws-link:hover, .ws-link:focus-visible")["text-decoration"]).toBe("underline");
  });

  it("DS-14@PoC AC7: the ring of a date field with a calendar button is drawn around the whole field box, not the inner input; the input draws none of its own", () => {
    const ring = rule(components, ".ws-field-box:has(.ws-field-input:focus-visible)");
    expect(ring["outline"]).toBe("var(--ws-focus-ring-width) solid var(--ws-focus-ring-color)");
    expect(ring["outline-offset"]).toBe("var(--ws-focus-ring-offset)");
    expect(rule(components, ".ws-field-input:focus-visible")["outline"]).toBe("none");
    // The calendar button is inside the same box: its own focus uses the shared ring.
    expect(rule(base, ":focus-visible")["outline"]).toBe(
      "var(--ws-focus-ring-width) solid var(--ws-focus-ring-color)",
    );
  });

  it.each(["light", "dark"] as const)(
    "DS-14@PoC AC9: the border of the secondary button, the field and the check box has at least 3 : 1 against its background in the %s theme",
    (theme) => {
      const border = colors["border-control"][theme];
      const bg = colors["surface-200"][theme];
      const r = ratio(border, bg);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r.toFixed(2)).toBe(theme === "light" ? "3.77" : "3.79");
      expect(border).toBe(theme === "light" ? "#7B8494" : "#6F8CB0");
      // The field also stands on surface-100 pages.
      expect(ratio(border, colors["surface-100"][theme])).toBeGreaterThanOrEqual(3);
    },
  );

  it("DS-14@PoC EC2: in forced-colours mode the focus ring is an outline, which the system keeps, and no forced-colours rule removes it or the control borders", () => {
    const forced = all.filter((d) => d.atRules.some((a) => a.includes("forced-colors")));
    expect(forced.length).toBeGreaterThan(0);
    for (const d of forced) {
      expect(d.property, d.selector).not.toMatch(/^outline/);
      expect(d.property, d.selector).not.toBe("forced-color-adjust");
    }
    expect(
      base.some((d) => d.selector === ":focus-visible" && d.property === "outline" && d.atRules.length === 0),
    ).toBe(true);
    // A ring drawn as a shadow or a background would vanish: the shared ring and the field ring are outlines.
    expect(rule(base, ":focus-visible")["box-shadow"]).toBeUndefined();
    expect(
      rule(components, ".ws-field-box:has(.ws-field-input:focus-visible)")["box-shadow"],
    ).toBeUndefined();
    // Controls keep a real border, so they stay visible without their fill.
    expect(rule(components, ".ws-button")["border"]).toMatch(/^1px solid/);
    expect(rule(components, ".ws-field-box")["border"]).toMatch(/^1px solid/);
  });
});
