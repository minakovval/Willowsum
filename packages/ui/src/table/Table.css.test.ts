// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, CONTRAST_MINIMUM, contrastRatio, cssDeclarations, layout } from "../tokens/index.ts";

/** CMP-26@PoC Table on the stylesheet (jsdom has no layout and does not resolve `var(--ws-…)`); light theme: PoC. */
const raw = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of cssDeclarations(raw))
    if (d.selector.split(",").some((part) => part.trim() === selector)) out[d.property] = d.value;
  return out;
}
const light = (name: keyof typeof colors) => colors[name].light;
const CARD = ".ws-dtable-wrap:not(.ws-dtable-wrap--flat)";

describe("CMP-26@PoC Table styles", () => {
  it("CMP-26@PoC FR «Розміри і стиль»: frame 1 px line, radius 8, surface-200; summary 12 × 16, 14/20, 500, ink-muted", () => {
    const frame = rule(".ws-dtable-frame");
    expect(frame.border).toBe("1px solid var(--ws-line)");
    expect(frame["border-radius"]).toBe("var(--ws-radius-md)");
    expect(frame.background).toBe("var(--ws-surface-200)");
    const sum = rule(".ws-dtable-summary");
    expect(sum.padding).toBe("var(--ws-space-3) var(--ws-space-4)");
    expect(sum["border-block-end"]).toBe("1px solid var(--ws-line)");
    expect(sum["font-weight"]).toBe("500");
    expect(sum.color).toBe("var(--ws-ink-muted)");
    expect(light("line")).toBe("#E5E5E2");
  });

  it("CMP-26@PoC FR «Розміри і стиль»: heading padding 12 × 16 (13/16 label token: no 12 px label token; the 12 px chart-axis and nav-bottom tokens belong to other roles), caps, 0.08 em tracking, ink-muted on surface-100; cell 52 px, 16 px sides, line", () => {
    const th = rule(".ws-dtable th");
    expect(th.padding).toBe("var(--ws-space-3) var(--ws-space-4)");
    expect(th["text-transform"]).toBe("uppercase");
    expect(th["letter-spacing"]).toBe("var(--ws-text-label-tracking)");
    expect(th.background).toBe("var(--ws-surface-100)");
    const td = rule(".ws-dtable td");
    expect(td["block-size"]).toBe("calc(var(--ws-space-1) * 13)");
    expect(td.padding).toBe("0 var(--ws-space-4)");
    expect(td["border-block-end"]).toBe("1px solid var(--ws-line)");
  });

  it("CMP-26@PoC FR «Розміри і стиль»: flat — 12 px padding, 44 px rows, half the heading tracking", () => {
    expect(rule(".ws-dtable-wrap--flat .ws-dtable td")["block-size"]).toBe("calc(var(--ws-space-1) * 11)");
    expect(rule(".ws-dtable-wrap--flat .ws-dtable td")["padding-inline"]).toBe("var(--ws-space-3)");
    expect(rule(".ws-dtable-wrap--flat .ws-dtable th")["letter-spacing"]).toBe(
      "calc(var(--ws-text-label-tracking) / 2)",
    );
  });

  it("CMP-26@PoC FR «Розміри і стиль»: amounts end-aligned with tabular digits; columns share the width, the table never exceeds the container", () => {
    expect(rule(".ws-dtable th.ws-dtable-end")["text-align"]).toBe("end");
    expect(rule(".ws-dtable td.ws-dtable-end")["font-variant-numeric"]).toBe("tabular-nums");
    const table = rule(".ws-dtable");
    expect(table["table-layout"]).toBe("fixed");
    expect(table["inline-size"]).toBe("100%");
    expect(rule(".ws-dtable-frame").overflow).toBe("hidden");
  });

  it("CMP-26@PoC FR «Стани»: hover surface-100, selected surface-300, 3 px focus ring inside the row and the heading", () => {
    expect(rule(".ws-dtable-row:hover").background).toBe("var(--ws-surface-100)");
    expect(rule('.ws-dtable-row[data-selected="true"]').background).toBe("var(--ws-surface-300)");
    for (const sel of [".ws-dtable-row:focus-visible", ".ws-dtable-sort:focus-visible"]) {
      expect(rule(sel).outline).toBe("var(--ws-focus-ring-width) solid var(--ws-focus)");
      expect(rule(sel)["outline-offset"]).toBe("calc(var(--ws-focus-ring-width) * -1)");
    }
    expect(rule('.ws-dtable-sort[data-sort="desc"]').color).toBe("var(--ws-ink)");
    expect(rule(".ws-dtable-sort")["min-block-size"]).toBe("var(--ws-touch-target)");
  });

  it("CMP-26@PoC AC1: below 520 px of the container (a container query, not the window) a row is a card", () => {
    expect(layout["table-stack-below"]).toBe(520);
    expect(raw).toContain("@container (max-width: 519px)");
    expect(rule(".ws-dtable-wrap")["container-type"]).toBe("inline-size");
    expect(raw).not.toMatch(/@media[^{]*max-width:\s*519/);
    const td = rule(`${CARD} .ws-dtable td`);
    expect(td["grid-template-columns"]).toBe("minmax(0, 38fr) minmax(0, 62fr)");
    expect(td["min-block-size"]).toBe("calc(var(--ws-space-1) * 9)");
    expect(td.padding).toBe("var(--ws-space-1) var(--ws-space-4)");
    expect(rule(`${CARD} .ws-dtable td[data-first="true"]`)["font-weight"]).toBe("600");
    expect(rule(`${CARD} .ws-dtable td::before`).content).toBe("attr(data-label)");
    expect(rule(`${CARD} .ws-dtable tbody tr`)["border-block-end"]).toBe("1px solid var(--ws-line)");
  });

  it("CMP-26@PoC FR «Стани»: in a card the hidden heading row comes back while a sort button in it has focus", () => {
    const hidden = rule(`${CARD} .ws-dtable thead`);
    expect(hidden["clip-path"]).toBe("inset(50%)");
    const focused = rule(`${CARD} .ws-dtable thead:focus-within`);
    expect(focused["clip-path"]).toBe("none");
    expect(focused.position).toBe("static");
    expect(focused["block-size"]).toBe("auto");
  });

  it("CMP-26@PoC AC6: every card rule is limited to the non-flat table, so `flat` rows stay rows in a narrow container", () => {
    const inside = raw.slice(
      raw.indexOf(".ws-dtable-wrap:not(.ws-dtable-wrap--flat) .ws-dtable thead"),
      undefined,
    );
    const selectors = cssDeclarations(inside)
      .map((d) => d.selector)
      .filter((sel) => sel.includes("ws-dtable"));
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors)
      for (const part of sel.split(","))
        if (part.includes("ws-dtable"))
          expect(part.trim()).toMatch(/^\.ws-dtable-wrap:not\(\.ws-dtable-wrap--flat\) /);
  });

  it("CMP-26@PoC FR «Адаптивність»: the table never scrolls sideways — no overflow-x scroll or auto on any table rule", () => {
    const decls = cssDeclarations(raw).filter((d) => d.selector.includes("ws-dtable"));
    for (const d of decls) {
      if (d.property === "overflow" || d.property === "overflow-x")
        expect(d.value).not.toMatch(/scroll|auto/);
    }
  });

  it("CMP-26@PoC DS-06 / NFR-08: heading, summary and selected-row text meet the contrast minimums", () => {
    for (const bg of ["surface-100", "surface-200", "surface-300"] as const)
      expect(contrastRatio(light("ink"), light(bg))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    for (const bg of ["surface-100", "surface-200"] as const)
      expect(contrastRatio(light("ink-muted"), light(bg))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
    expect(contrastRatio(light("ink-muted"), light("surface-300"))).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM.text,
    );
    expect(contrastRatio(light("focus"), light("surface-200"))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.ui);
    expect(contrastRatio(light("loss"), light("surface-200"))).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
  });
});
