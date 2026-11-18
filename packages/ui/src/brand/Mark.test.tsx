import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { Wordmark, WillowsumMark } from "./Mark.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const read = (...p: string[]) => readFileSync(join(repo, ...p), "utf8");
const css = read("packages/ui/src/styles/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("packages/ui/src/styles/tokens.css");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";
const pathsOf = (svg: string) => [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);

describe("CMP-71@PoC the mark and the name", () => {
  it("CMP-71@PoC AC1: the mark is never drawn below 16 px, and the space between it and the name is a third of its width or more", () => {
    const { container, rerender } = render(<WillowsumMark size={8} decorative />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("16");
    expect(container.querySelector("svg")!.getAttribute("height")).toBe("16");
    rerender(<WillowsumMark size={24} decorative />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("24");
    // The sidebar mark is 24 px; its gap to the name is `space-2` = 8 px = 24 / 3.
    const gap = /gap:\s*var\(--ws-space-(\d)\)/.exec(rule(".ws-wordmark"))![1];
    const space = Number(new RegExp(`--ws-space-${gap}:\\s*(\\d+)px`).exec(tokens)![1]);
    expect(space * 3).toBeGreaterThanOrEqual(24);
  });

  it("CMP-71@PoC AC2: the name beside the mark is live text «Willowsum» (not an image) in Inter Tight 600 with −2 % tracking", () => {
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <Wordmark markSize={24} />
      </I18nProvider>,
    );
    const name = container.querySelector(".ws-wordmark-name")!;
    expect(name.tagName).toBe("SPAN");
    expect(name.textContent).toBe("Willowsum");
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("img")).toBeNull();
    const style = rule(".ws-wordmark-name");
    expect(style).toContain("font-family: var(--ws-font-display);");
    expect(style).toContain("font-weight: 600;");
    expect(style).toContain("letter-spacing: -0.02em;");
    expect(tokens).toMatch(/--ws-font-display:\s*"Inter Tight"/);
  });

  it("CMP-71@PoC AC5: the mark in the code is the mark of the brand assets (light mark, favicon) — the same three paths — and no other source file draws its own copy", () => {
    const { container } = render(<WillowsumMark size={24} decorative />);
    const drawn = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(drawn).toHaveLength(3);
    for (const file of ["packages/ui/src/brand/assets/mark-light.svg", "apps/web/public/favicon.svg"]) {
      expect(pathsOf(read(file)), file).toEqual(drawn);
    }
    // The comparison with the design-system file is not made here: heavy CI jobs read nothing under design/.
    // No other source file of the apps and packages carries the mark's outline.
    const outline = drawn[0]!;
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|css|html|svg)$/.test(entry) && read(relative(repo, full)).includes(outline))
          found.push(relative(repo, full));
      }
    };
    walk(join(repo, "apps"));
    walk(join(repo, "packages"));
    expect(found.sort()).toEqual([
      "apps/web/public/favicon.svg",
      "packages/ui/src/brand/Mark.tsx",
      "packages/ui/src/brand/assets/app-icon.svg",
      "packages/ui/src/brand/assets/mark-dark.svg",
      "packages/ui/src/brand/assets/mark-light.svg",
      "packages/ui/src/brand/assets/mark-mono.svg",
    ]);
  });
});

describe("CMP-71@PoC the mark and reduced motion", () => {
  it("CMP-71@PoC AC4: the mark is never animated — no animation or transition on it anywhere, so with reduced motion the loading screen shows it still", () => {
    const all = ["components.css", "shell.css", "base.css"]
      .map((f) => read("packages/ui/src/styles", f))
      .join("\n");
    const bare = all.replace(/\/\*[\s\S]*?\*\//g, "");
    // No rule that targets the mark (or its leaves) sets an animation or a transition.
    const rules = [...bare.matchAll(/([^{}]*\.ws-mark[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      expect(body, selector).not.toMatch(/animation|transition/);
    }
    // The markup carries no SMIL or CSS animation either.
    const { container } = render(<WillowsumMark size={64} />);
    expect(container.querySelector("animate, animateTransform, animateMotion, set")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("style")).toBeNull();
    // And the global reduced-motion rule is there for anything a screen puts around it.
    expect(bare).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
