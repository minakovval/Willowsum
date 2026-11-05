// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** DS-14 item 7, DS-10 AC7: the hidden-amount button is a touch target of at least 44 × 44 px. */
describe("hidden amount touch target", () => {
  const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
  const rule = css.match(/\.ws-amount-hidden\s*\{([^}]*)\}/)?.[1] ?? "";

  it("has a minimum height and width of the touch-target token", () => {
    expect(rule).toMatch(/min-height:\s*var\(--ws-touch-target\)/);
    expect(rule).toMatch(/min-width:\s*var\(--ws-touch-target\)/);
  });
});

/** CMP-01 (canvas P0): a 40 px visible button keeps a 44 px hit area; its border is border-control (3:1). */
describe("button size and hit area", () => {
  const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("is 40 px visible with radius-md and a border-control border", () => {
    const button = rule(".ws-button");
    expect(button).toMatch(/min-height:\s*calc\(var\(--ws-touch-target\) - var\(--ws-space-1\)\)/);
    expect(button).toMatch(/border-radius:\s*var\(--ws-radius-md\)/);
    expect(button).toMatch(/border:\s*1px solid var\(--ws-border-control\)/);
  });

  it("extends the hit area by 2 px above and below to 44 px", () => {
    expect(rule(".ws-button::after")).toMatch(/inset-block:\s*calc\(var\(--ws-space-1\) \/ -2\)/);
  });
});
