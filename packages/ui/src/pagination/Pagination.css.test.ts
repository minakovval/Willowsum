// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, CONTRAST_MINIMUM, contrastRatio, cssDeclarations } from "../tokens/index.ts";

/** CMP-13@PoC Pagination on the stylesheet (jsdom does not resolve `var(--ws-…)`); light theme: PoC. */
const components = readFileSync(
  fileURLToPath(new URL("../styles/components.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of cssDeclarations(components)) if (d.selector === selector) out[d.property] = d.value;
  return out;
}
const light = (name: keyof typeof colors) => colors[name].light;

describe("CMP-13@PoC Pagination styles", () => {
  it("CMP-13@PoC «Розміри і стиль»: Inter 14/20, ink-muted, tabular digits, 12 px between groups, 8 px between arrows, aligned right", () => {
    const block = rule(".ws-pagination");
    expect(block["font-size"]).toBe("var(--ws-text-body-sm-size)");
    expect(block["line-height"]).toBe("var(--ws-text-body-sm-line)");
    expect(block["font-family"]).toBe("var(--ws-font-sans)");
    expect(block.color).toBe("var(--ws-ink-muted)");
    expect(block["font-variant-numeric"]).toBe("tabular-nums");
    expect(block.gap).toBe("var(--ws-space-3)");
    expect(block["justify-content"]).toBe("flex-end");
    expect(rule(".ws-pagination__arrows").gap).toBe("var(--ws-space-2)");
  });

  it("CMP-13@PoC «Розміри і стиль»: the arrows are 44 px high and wide; the size label is a 44 px target", () => {
    const arrow = rule(".ws-pagination__arrow.ws-button");
    expect(arrow["min-height"]).toBe("var(--ws-touch-target)");
    expect(arrow["min-width"]).toBe("var(--ws-touch-target)");
    expect(rule(".ws-pagination__size")["min-height"]).toBe("var(--ws-touch-target)");
    expect(light("ink-muted")).toBe("#566174");
    expect(light("disabled-bg")).toBe("#E7E1D3");
    expect(light("disabled-ink")).toBe("#8A8F99");
  });

  it("CMP-13@PoC DS-06: the info text on the page and the size control meet the contrast minimums", () => {
    expect(contrastRatio(light("ink-muted"), light("surface-100"))).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM.text,
    );
    expect(contrastRatio(light("ink-muted"), light("surface-200"))).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM.text,
    );
    expect(contrastRatio(light("border-control"), light("surface-200"))).toBeGreaterThanOrEqual(
      CONTRAST_MINIMUM.ui,
    );
    expect(rule(".ws-pagination__select").border).toBe("1px solid var(--ws-border-control)");
  });

  it("CMP-13@PoC «Стани»: a disabled size uses disabled-bg and disabled-ink; the reason is clipped, not removed", () => {
    const disabled = rule(".ws-pagination__select:disabled");
    expect(disabled.background).toBe("var(--ws-disabled-bg)");
    expect(disabled.color).toBe("var(--ws-disabled-ink)");
    expect(rule(".ws-pagination__arrows .ws-disabled-reason")["clip-path"]).toBe("inset(50%)");
  });
});
