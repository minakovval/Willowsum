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
