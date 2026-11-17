// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../tokens/contrast.ts";
import { colors } from "../tokens/color.ts";

const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
const base = readFileSync(fileURLToPath(new URL("../styles/base.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";

describe("CMP-73@PoC SelectionBar styles", () => {
  it("CMP-73@PoC FR «Розміри і стиль»: the bar is a `brand` surface, so its ring is the shared on-brand ring (DS-06 FR 7), 3 px, 2 px offset, at least 3 : 1 on brand in both themes", () => {
    const tsx = readFileSync(fileURLToPath(new URL("./SelectionBar.tsx", import.meta.url)), "utf8");
    expect(tsx).toContain('className="ws-selection-bar ws-surface-brand"');
    // No ring colour of its own: the one rule lives in base.css.
    expect(css).not.toMatch(/\.ws-selection-bar[^{]*:focus-visible/);
    expect(base).toMatch(/\.ws-surface-brand\s*\{[^}]*--ws-focus-ring-color:\s*var\(--ws-on-brand\)/);
    expect(base).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-focus-ring-color\)/,
    );
    expect(base).toMatch(/outline-offset:\s*var\(--ws-focus-ring-offset\)/);
    for (const theme of ["light", "dark"] as const)
      expect(contrastRatio(colors["on-brand"][theme], colors.brand[theme])).toBeGreaterThanOrEqual(3);
  });

  it("CMP-73@PoC FR «Розміри і стиль»: the menu on surface-200 inside the bar keeps the `focus` ring, at least 3 : 1 on surface-200 (DS-06 FR 7)", () => {
    expect(rule(".ws-surface-brand .ws-menu")).toMatch(/--ws-focus-ring-color:\s*var\(--ws-focus\)/);
    for (const theme of ["light", "dark"] as const)
      expect(contrastRatio(colors.focus[theme], colors["surface-200"][theme])).toBeGreaterThanOrEqual(3);
  });
});
