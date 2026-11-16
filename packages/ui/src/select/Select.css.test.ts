// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  colors,
  contrastRatio,
  CONTRAST_MINIMUM,
  radii,
  space,
  typeScale,
  type ColorTokenName,
} from "../tokens/index.ts";

/**
 * CMP-03@PoC Select: the sizes, colours and states on the stylesheet (jsdom does not resolve `var(--ws-…)`), the
 * token values those rules name, and the contrast of every pair the component draws.
 */
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const components = read("../styles/components.css");
const base = read("../styles/base.css");
const tokensCss = read("../styles/tokens.css");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

const FORTY = "calc(var(--ws-touch-target) - var(--ws-space-1))";
const THIRTY_SIX = "calc(var(--ws-touch-target) - var(--ws-space-2))";
const px = (name: string) => Number(new RegExp(`--ws-${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);

describe("CMP-03@PoC Select styles", () => {
  it("CMP-03@PoC AC5: 40 px visible, radius 8, a 1 px `border-control` border (7B8494), the label 13 px 500 in ordinary case, a 44 px hit area", () => {
    const control = rule(components, ".ws-select-control");
    expect(control).toContain(`block-size: ${FORTY};`);
    expect(px("touch-target") - space["space-1"]).toBe(40);
    expect(control).toContain("border: 1px solid var(--ws-border-control);");
    expect(colors["border-control"].light).toBe("#7B8494");
    expect(control).toContain("border-radius: var(--ws-radius-md);");
    expect(radii["radius-md"]).toBe(8);
    expect(control).toContain(
      "padding-inline: var(--ws-space-3) calc(var(--ws-space-6) + var(--ws-space-2));",
    );
    const label = rule(components, ".ws-select-label");
    expect(label).toContain("font-size: var(--ws-text-label-size);");
    expect(label).toContain("font-weight: var(--ws-text-label-weight);");
    expect(label).toContain("text-transform: none;");
    expect(typeScale.label.size).toBe(13);
    expect(typeScale.label.weight).toBe(500);
    // The 2 px strips above and below the 40 px control make the 44 px hit area.
    expect(rule(components, ".ws-select-box::after")).toContain("inset-block: calc(var(--ws-space-1) / -2);");
    expect(px("touch-target")).toBeGreaterThanOrEqual(44);
  });

  it("CMP-03@PoC AC1: the chosen value is cut with an ellipsis; options in the panel wrap and show the full text", () => {
    const control = rule(components, ".ws-select-control");
    expect(control).toContain("text-overflow: ellipsis;");
    expect(control).toContain("white-space: nowrap;");
    expect(rule(components, ".ws-select-value")).toContain("text-overflow: ellipsis;");
    const option = rule(components, ".ws-select-option");
    expect(option).toContain("white-space: normal;");
    expect(option).not.toContain("text-overflow");
  });

  it("CMP-03@PoC AC2: the error border is `loss` (B23A3A) and the error text is `loss`", () => {
    expect(rule(components, '.ws-select-control[aria-invalid="true"]')).toContain(
      "border-color: var(--ws-loss);",
    );
    expect(colors.loss.light).toBe("#B23A3A");
    expect(rule(components, ".ws-select-error")).toContain("color: var(--ws-loss);");
  });

  it("CMP-03@PoC AC3: in focus a 3 px `focus` ring with a 2 px offset is drawn and the border turns `ink`", () => {
    expect(rule(base, ":focus-visible")).toContain(
      "outline: var(--ws-focus-ring-width) solid var(--ws-focus);",
    );
    expect(px("focus-ring-width")).toBe(3);
    expect(px("focus-ring-offset")).toBe(2);
    expect(rule(components, ".ws-select-control:focus-visible")).toContain("border-color: var(--ws-ink);");
    expect(rule(components, ".ws-select-control:focus-visible")).not.toContain("outline");
  });

  it("CMP-03@PoC hover, disabled, empty: hover border `ink`; disabled `disabled-bg` / `disabled-ink` without border; empty in `ink-muted`", () => {
    expect(rule(components, ".ws-select-control:hover")).toContain("border-color: var(--ws-ink);");
    const disabled = rule(components, ".ws-select-control:disabled,\n.ws-select-control:disabled:hover");
    expect(disabled).toContain("border-color: transparent;");
    expect(disabled).toContain("background: var(--ws-disabled-bg);");
    expect(disabled).toContain("color: var(--ws-disabled-ink);");
    expect(rule(components, ".ws-select-control--empty")).toContain("color: var(--ws-ink-muted);");
  });

  it("CMP-03@PoC AC10: the list button is 36 px with a 1 px `border-control` border and radius 8; label `ink-muted`, value 500", () => {
    const button = rule(components, ".ws-list-button");
    expect(button).toContain(`block-size: ${THIRTY_SIX};`);
    expect(px("touch-target") - space["space-2"]).toBe(36);
    expect(button).toContain("border: 1px solid var(--ws-border-control);");
    expect(button).toContain("border-radius: var(--ws-radius-md);");
    expect(button).toContain("padding: 0 var(--ws-space-3);");
    expect(rule(components, ".ws-list-button::after")).toContain(
      "inset-block: calc(var(--ws-space-1) * -1);",
    );
    expect(rule(components, ".ws-list-button__label")).toContain("color: var(--ws-ink-muted);");
    expect(rule(components, ".ws-list-button__value")).toContain("font-weight: 500;");
  });

  it("CMP-03@PoC panel: `surface-200`, 1 px `line`, radius 8, `shadow-popover`; a 36 px search field; 11 px group headings in capitals", () => {
    const panel = rule(components, ".ws-dropdown-panel");
    expect(panel).toContain("background: var(--ws-surface-200);");
    expect(panel).toContain("border: 1px solid var(--ws-line);");
    expect(panel).toContain("border-radius: var(--ws-radius-md);");
    expect(panel).toContain("box-shadow: var(--ws-shadow-popover);");
    expect(rule(components, ".ws-select-search")).toContain(`block-size: ${THIRTY_SIX};`);
    const heading = rule(components, ".ws-select-group-title");
    expect(heading).toContain("font-size: var(--ws-text-badge-size);");
    expect(heading).toContain("font-weight: 600;");
    expect(heading).toContain("text-transform: uppercase;");
  });

  it("CMP-03@PoC NFR-08: every text pair is at least 4.5 : 1 and every control and mark at least 3 : 1, both themes", () => {
    const pair = (fg: ColorTokenName, bg: ColorTokenName, min: number) => {
      for (const theme of ["light", "dark"] as const) {
        expect(
          contrastRatio(colors[fg][theme], colors[bg][theme]),
          `${fg} on ${bg} (${theme})`,
        ).toBeGreaterThanOrEqual(min);
      }
    };
    for (const bg of ["surface-200", "surface-300"] as const) {
      pair("ink", bg, CONTRAST_MINIMUM.text);
      pair("ink-muted", bg, CONTRAST_MINIMUM.text);
      pair("brand", bg, CONTRAST_MINIMUM.ui);
    }
    pair("loss", "surface-200", CONTRAST_MINIMUM.text);
    pair("loss", "surface-100", CONTRAST_MINIMUM.text);
    pair("border-control", "surface-200", CONTRAST_MINIMUM.ui);
    pair("border-control", "surface-100", CONTRAST_MINIMUM.ui);
  });
});
