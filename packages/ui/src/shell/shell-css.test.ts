// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** CMP-69@PoC, UX-09@PoC item 11, GRID-00@PoC item 14: shell styles. */
const css = readFileSync(fileURLToPath(new URL("../styles/shell.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("shell styles", () => {
  it("CMP-69 AC1: the current item has the surface-300 background (F1F1EF in the light theme)", () => {
    expect(rule('.ws-nav-item[aria-current="page"]')).toMatch(/background:\s*var\(--ws-surface-300\)/);
  });

  it("CMP-69 AC4 / UX-09 item 11: the count badge is brand-2 on on-brand, never amber", () => {
    const badge = rule(".ws-nav-badge");
    expect(badge).toMatch(/background:\s*var\(--ws-brand-2\)/);
    expect(badge).toMatch(/color:\s*var\(--ws-on-brand\)/);
    expect(css).not.toMatch(/accent/);
  });

  it("CMP-69 / UX-09 items 4, 16: sidebar 212 px, collapsed rail 64 px, from the layout tokens", () => {
    expect(rule(".ws-shell")).toMatch(/--ws-nav-width:\s*var\(--ws-sidebar-width\)/);
    expect(rule('.ws-shell[data-collapsed="true"]')).toMatch(/--ws-nav-width:\s*var\(--ws-rail-width\)/);
  });

  it("GRID-00 item 14: navigation targets keep the 44 px touch target", () => {
    expect(rule(".ws-nav-item::after")).toMatch(/inset-block/);
    expect(rule(".ws-nav-expand")).toMatch(/min-height:\s*var\(--ws-touch-target\)/);
    expect(rule(".ws-nav-profile")).toMatch(/min-height:\s*var\(--ws-touch-target\)/);
    expect(rule(".ws-menu-item")).toMatch(/min-height:\s*var\(--ws-touch-target\)/);
  });
});
