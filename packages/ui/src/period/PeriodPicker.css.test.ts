// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, radii, space } from "../tokens/index.ts";

/** CMP-72@PoC: the measures of the picker on the stylesheet (jsdom does not resolve `var(--ws-…)`) and on the tokens they name. */
const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const tokensCss = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8");
const rule = (selector: string): string =>
  new RegExp(`(?:^|[}{])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
    css,
  )?.[1] ?? "";
const px = (name: string) => Number(new RegExp(`--ws-${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);

describe("CMP-72@PoC PeriodPicker styles", () => {
  it("CMP-72@PoC AC8: one group 38 px high with a 1 px `border-control` (7B8494) border, radius 8 and `surface-200`; the two controls are divided by a 1 px `line`; each hit area is 44 px", () => {
    const group = rule(".ws-period-picker");
    expect(group).toContain("min-block-size: calc(var(--ws-space-6) + var(--ws-space-1) * 1.5);");
    expect(px("space-6") + px("space-1") * 1.5).toBe(38);
    expect(group).toContain("border: 1px solid var(--ws-border-control);");
    expect(colors["border-control"].light).toBe("#7B8494");
    expect(group).toContain("border-radius: var(--ws-radius-md);");
    expect(radii["radius-md"]).toBe(8);
    expect(group).toContain("background: var(--ws-surface-200);");
    expect(rule(".ws-period-current")).toContain("border-inline-start: 1px solid var(--ws-line);");
    expect(rule(".ws-period-button")).toContain("min-block-size: var(--ws-touch-target);");
    expect(px("touch-target")).toBe(44);
    expect(space["space-6"]).toBe(32);
  });
});
