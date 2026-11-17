// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";

describe("CMP-32@PoC FilterBar styles", () => {
  it("CMP-32@PoC AC7, FR «Розміри і стиль»: the button is 36 px in a 44 px hit area, 0 × 12 px, 1 px border-control, radius 8, surface-200, 13/18 px 600; open — brand-2 and tint-info", () => {
    const button = rule(".ws-filter-button");
    expect(button).toMatch(/block-size:\s*calc\(var\(--ws-touch-target\) - var\(--ws-space-2\)\)/);
    expect(button).toMatch(/padding:\s*0 var\(--ws-space-3\)/);
    expect(button).toMatch(/border:\s*1px solid var\(--ws-border-control\)/);
    expect(button).toMatch(/border-radius:\s*var\(--ws-radius-md\)/);
    expect(button).toMatch(/background:\s*var\(--ws-surface-200\)/);
    expect(button).toMatch(/font-weight:\s*600/);
    expect(rule(".ws-filter-button::after")).toMatch(/inset-block:\s*calc\(var\(--ws-space-1\) \* -1\)/);
    const open = rule('.ws-filter-button[aria-expanded="true"]');
    expect(open).toMatch(/border-color:\s*var\(--ws-brand-2\)/);
    expect(open).toMatch(/background:\s*var\(--ws-tint-info\)/);
  });

  it("CMP-32@PoC AC7, FR «Розміри і стиль»: the chip is 32 px, pill, tint-info with brand text 500, 8 px apart; its «×» has a 44 × 44 px hit area and the 3 px focus ring with a 2 px offset", () => {
    const chip = rule(".ws-filter-chip");
    expect(chip).toMatch(/block-size:\s*var\(--ws-space-6\)/);
    expect(chip).toMatch(/border-radius:\s*var\(--ws-radius-pill\)/);
    expect(chip).toMatch(/background:\s*var\(--ws-tint-info\)/);
    expect(chip).toMatch(/color:\s*var\(--ws-brand\)/);
    expect(chip).toMatch(/font-weight:\s*500/);
    expect(rule(".ws-filter-bar")).toMatch(/gap:\s*var\(--ws-space-2\)/);
    // 24 px circle + 2 × 10 px = 44 px.
    expect(rule(".ws-filter-chip__remove::after")).toMatch(
      /inset:\s*calc\(\(var\(--ws-touch-target\) - var\(--ws-space-5\)\) \/ -2\)/,
    );
    expect(css).toMatch(
      /\.ws-filter-chip__remove:focus-visible,[\s\S]*?outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-focus-ring-color\);\s*outline-offset:\s*var\(--ws-focus-ring-offset\)/,
    );
    expect(rule(".ws-filter-rows")).toMatch(/gap:\s*var\(--ws-space-3\)/);
  });
});
