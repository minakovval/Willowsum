// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("CMP-60@PoC Toolbar styles", () => {
  it("CMP-60@PoC FR «Розміри і стиль»: 44 px high, 8 px between controls, 16 px between groups and to the list, no background or border", () => {
    const bar = rule(".ws-toolbar");
    expect(bar).toMatch(/min-block-size:\s*var\(--ws-touch-target\)/);
    expect(bar).toMatch(/gap:\s*var\(--ws-space-4\)/);
    expect(bar).toMatch(/margin-block-end:\s*var\(--ws-space-4\)/);
    expect(bar).not.toMatch(/background|border/);
    expect(rule(".ws-toolbar-start,\n.ws-toolbar-end")).toMatch(/gap:\s*var\(--ws-space-2\)/);
  });

  it("CMP-60@PoC AC1: the toolbar is one flex row — the start group takes the space, «Параметри» sits at the end — and its row does not wrap", () => {
    const bar = rule(".ws-toolbar");
    expect(bar).toMatch(/display:\s*flex/);
    expect(bar).not.toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.ws-toolbar-start\s*\{[^}]*flex:\s*1 1 auto/);
    expect(css).toMatch(/\.ws-toolbar-end\s*\{[^}]*flex:\s*none;[^}]*margin-inline-start:\s*auto/);
  });
});
