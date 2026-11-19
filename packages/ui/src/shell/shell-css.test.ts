// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** CMP-69@PoC, UX-09@PoC item 11, GRID-00@PoC item 14: shell styles. */
const css = readFileSync(fileURLToPath(new URL("../styles/shell.css", import.meta.url)), "utf8");
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

const tokens = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8");

describe("shell styles", () => {
  it("UX-09@PoC FR 4: the sidebar is 212 px wide and the shell takes its width from that token; the collapsed rail is 64 px (FR 16)", () => {
    expect(tokens).toMatch(/--ws-sidebar-width:\s*212px/);
    expect(tokens).toMatch(/--ws-rail-width:\s*64px/);
    expect(rule(".ws-nav-sidebar")).toMatch(/width:\s*var\(--ws-nav-width\)/);
  });

  it("UX-09@PoC FR 13: every navigation target — L1 and L2 items, profile, «+ Додати», the menu items and the rail handle — keeps a 44 px target", () => {
    expect(tokens).toMatch(/--ws-touch-target:\s*44px/);
    for (const selector of [".ws-nav-item", ".ws-nav-profile", ".ws-menu-item", ".ws-nav-expand"])
      expect(rule(selector), selector).toMatch(/min-(height|width):\s*var\(--ws-touch-target\)/);
  });

  it("UX-09@PoC FR 16: on the collapsed rail the edge is highlighted on hover and the round «›» handle appears; names show as tooltips", () => {
    expect(rule(".ws-nav-edge:hover,\n.ws-nav-edge:focus-within") || css).toMatch(
      /border-inline-start-color:\s*var\(--ws-brand-2\)/,
    );
    expect(rule(".ws-nav-expand")).toMatch(/border-radius:\s*var\(--ws-radius-pill\)/);
    expect(css).toMatch(/\.ws-nav-edge:hover \.ws-nav-expand[^{]*\{[^}]*opacity:\s*1/);
    expect(css).toMatch(/\.ws-nav-item:hover \.ws-nav-label[^{]*\{[^}]*opacity:\s*1/);
  });

  it("CMP-69 AC1: the current item has the surface-300 background (F1F1EF in the light theme)", () => {
    expect(rule('.ws-nav-item[aria-current="page"]')).toMatch(/background:\s*var\(--ws-surface-300\)/);
  });

  it("CMP-69 AC1: the current L1 item has brand text, the current L2 item brand on surface-100", () => {
    expect(rule('.ws-nav-item[aria-current="page"]')).toMatch(/color:\s*var\(--ws-brand\)/);
    const sub = rule('.ws-nav-subitem[aria-current="page"]');
    expect(sub).toMatch(/background:\s*var\(--ws-surface-100\)/);
    expect(sub).toMatch(/color:\s*var\(--ws-brand\)/);
  });

  it("CMP-69 AC4 / UX-09 item 11: the count is a plain ink-muted number without a pill, never amber", () => {
    const badge = rule(".ws-nav-badge");
    expect(badge).toMatch(/color:\s*var\(--ws-ink-muted\)/);
    expect(badge).not.toMatch(/background/);
    expect(badge).not.toMatch(/radius/);
    expect(css).not.toMatch(/accent/);
  });

  it("CMP-69 (canvas P0): white sidebar, 44 px L1 items with a 4 px radius", () => {
    expect(rule(".ws-nav-sidebar")).toMatch(/background:\s*var\(--ws-surface-200\)/);
    const item = rule(".ws-nav-item");
    expect(item).toMatch(/min-height:\s*var\(--ws-touch-target\)/);
    expect(item).toMatch(/border-radius:\s*var\(--ws-radius-sm\)/);
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
