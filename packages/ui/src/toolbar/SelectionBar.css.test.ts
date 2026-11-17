// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../tokens/contrast.ts";
import { colors } from "../tokens/color.ts";

const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";
const light = (name: keyof typeof colors) => colors[name].light;

describe("CMP-73@PoC SelectionBar styles", () => {
  it("CMP-73@PoC FR «Розміри і стиль»: the controls on the dark bar get a 3 px on-brand ring with a 2 px offset, at least 3 : 1 on brand", () => {
    const ring = rule(".ws-selection-bar :is(button, [tabindex]):focus-visible");
    expect(ring).toMatch(/outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-on-brand\)/);
    expect(ring).toMatch(/outline-offset:\s*var\(--ws-focus-ring-offset\)/);
    expect(contrastRatio(light("on-brand"), light("brand"))).toBeGreaterThanOrEqual(3);
  });

  it("CMP-73@PoC FR «Розміри і стиль»: the items of the menu on surface-200 keep the shared focus ring, at least 3 : 1 on surface-200 (DS-06 FR 4)", () => {
    const menu = rule(".ws-selection-bar .ws-menu :focus-visible");
    expect(menu).toMatch(/outline-color:\s*var\(--ws-focus\)/);
    // The menu rule comes after the bar's ring, so it wins at the same specificity or higher.
    expect(css.indexOf(".ws-selection-bar .ws-menu :focus-visible")).toBeGreaterThan(
      css.indexOf(".ws-selection-bar :is(button, [tabindex]):focus-visible"),
    );
    expect(contrastRatio(light("focus"), light("surface-200"))).toBeGreaterThanOrEqual(3);
  });
});
