// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** DS-23@PoC DS-13: the status stylesheet, read as text (jsdom does not resolve `var(--ws-…)`). */
const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
const block = css.slice(css.indexOf("DS-23@PoC status dictionary"));

describe("DS-23@PoC status stylesheet", () => {
  it("DS-23@PoC DS-13: the status and usage rules declare no transition or animation", () => {
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/transition|animation/);
  });

  it("DS-23@PoC FR 3: colours come from tokens, and the marks paint the ink of the entry's tone", () => {
    for (const ink of ["gain", "gain-soft", "on-warning", "loss", "loss-soft", "link", "brand", "ink-muted"])
      expect(block).toContain(`.ws-status[data-ink="${ink}"] {\n  color: var(--ws-${ink});`);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("DS-23@PoC FR 4: the usage bar is a 6 px pill (1,5 × the 4 px step) on `surface-300`", () => {
    expect(block).toMatch(
      /\.ws-usage-track \{[^}]*block-size: calc\(var\(--ws-space-1\) \+ var\(--ws-space-1\) \/ 2\)/,
    );
    expect(block).toMatch(/\.ws-usage-track \{[^}]*background-color: var\(--ws-surface-300\)/);
  });
});
