// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssDeclarations, motion } from "../tokens/index.ts";

/**
 * DS-13@PoC items 1, 2, 3, 4, 7 and 8 on the real stylesheets (the criteria and items 6 and 9 are in
 * `motion.test.ts`; the toast, the skeleton markup and the tooltip are in `toast/ds13-items.test.tsx`).
 */
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const base = cssDeclarations(read("base.css"));
const components = cssDeclarations(read("components.css"));
const shell = cssDeclarations(read("shell.css"));
const tokensCss = read("tokens.css");
const all = [...base, ...components, ...shell];
const find = (list: typeof all, selector: string, property: string, rm = false) =>
  list.find(
    (d) =>
      d.selector === selector &&
      d.property === property &&
      d.atRules.some((a) => a.includes("prefers-reduced-motion")) === rm,
  )?.value;

describe("DS-13@PoC motion items (stylesheets)", () => {
  it("DS-13@PoC FR 1: hover and focus take 120–200 ms ease-out; the switch thumb, the field border and the link colour 150 ms", () => {
    const interaction = motion["duration-interaction"];
    expect(interaction).toBe(150);
    expect(interaction).toBeGreaterThanOrEqual(120);
    expect(interaction).toBeLessThanOrEqual(200);
    expect(tokensCss).toMatch(/--ws-duration-interaction: 150ms;/);
    expect(tokensCss).toMatch(/--ws-easing-out: ease-out;/);
    const t = "var(--ws-duration-interaction) var(--ws-easing-out)";
    expect(find(components, ".ws-switch-track::after", "transition")).toBe(`transform ${t}`);
    expect(find(components, ".ws-field-box", "transition")).toBe(`border-color ${t}`);
    expect(find(base, "a", "transition")).toBe(`color ${t}`);
    expect(find(components, ".ws-button", "transition")).toBe(`background-color ${t}`);
    // Every transition in the product uses these two tokens only: no literal time, no other curve.
    const transitions = all.filter((d) => d.property === "transition" && d.value !== "none");
    expect(transitions.length).toBeGreaterThan(8);
    for (const d of transitions)
      for (const part of d.value.split(",")) {
        expect(part, `${d.selector}`).toContain("var(--ws-duration-interaction)");
        expect(part, `${d.selector}`).toContain("var(--ws-easing-out)");
      }
  });

  it("DS-13@PoC FR 2: the spinner turns evenly, one turn in 0.8 s", () => {
    expect(find(base, ".ws-spinner", "animation")).toBe(
      "ws-spin var(--ws-duration-spinner) var(--ws-easing-linear) infinite",
    );
    expect(tokensCss).toMatch(/--ws-duration-spinner: 800ms;/);
    expect(tokensCss).toMatch(/--ws-easing-linear: linear;/);
    const turn = base.filter((d) => d.atRules.includes("@keyframes ws-spin"));
    expect(turn.map((d) => d.value)).toEqual(["rotate(1turn)"]);
  });

  it("DS-13@PoC FR 3: the skeleton shimmers left to right once in 1.6 s with ease-in-out, and stands still with reduced motion; it is not a spinner", () => {
    expect(find(base, ".ws-skeleton", "animation")).toBe(
      "ws-shimmer var(--ws-duration-skeleton) var(--ws-easing-in-out) infinite",
    );
    expect(tokensCss).toMatch(/--ws-duration-skeleton: 1600ms;/);
    expect(tokensCss).toMatch(/--ws-easing-in-out: ease-in-out;/);
    const frames = base.filter((d) => d.atRules.includes("@keyframes ws-shimmer"));
    // The 200 %-wide band moves from the right edge to the left, so the light band passes left to right.
    expect(frames.map((d) => [d.selector, d.value])).toEqual([
      ["from", "100% 0"],
      ["to", "-100% 0"],
    ]);
    expect(find(base, ".ws-skeleton", "animation", true)).toBe("none !important");
    expect(find(base, ".ws-skeleton", "background-image", true)).toBe("none");
  });

  it("DS-13@PoC FR 4: a chart is drawn without an appearance animation and a data change is instant", () => {
    expect(find(base, ".ws-chart, .ws-chart *", "animation")).toBe("none");
    expect(find(base, ".ws-chart, .ws-chart *", "transition")).toBe("none");
  });

  it("DS-13@PoC FR 7: with reduced motion every animation and transition lasts at most 0.01 ms, the skeleton stops, the spinner slows to 2.4 s", () => {
    const rm = base.filter((d) => d.atRules.some((a) => a.includes("prefers-reduced-motion")));
    const star = (p: string) =>
      rm.find((d) => d.selector === "*, *::before, *::after" && d.property === p)?.value;
    expect(star("animation-duration")).toBe("var(--ws-duration-reduced) !important");
    expect(star("transition-duration")).toBe("var(--ws-duration-reduced) !important");
    expect(star("animation-iteration-count")).toBe("1 !important");
    expect(motion["duration-reduced"]).toBeLessThanOrEqual(0.01);
    expect(find(base, ".ws-skeleton", "animation", true)).toBe("none !important");
    expect(find(base, ".ws-spinner", "animation-duration", true)).toBe(
      "var(--ws-duration-spinner-reduced) !important",
    );
    expect(find(base, ".ws-spinner", "animation-iteration-count", true)).toBe("infinite !important");
    expect(motion["duration-spinner-reduced"]).toBe(2400);
  });
  it("DS-13@PoC FR 8: no animation repeats more than 3 times a second", () => {
    const named = all.filter(
      (d) => /^animation/.test(d.property) && !d.atRules.some((a) => a.startsWith("@keyframes")),
    );
    expect(named.length).toBeGreaterThan(1);
    const seconds = (token: string) => (motion as Record<string, number>)[token]! / 1000;
    for (const d of named.filter((x) => x.property === "animation" && !x.value.startsWith("none"))) {
      const token = /var\(--ws-(duration-[\w-]+)\)/.exec(d.value)?.[1];
      expect(token, `${d.selector}: an animation takes a duration token, not a literal`).toBeDefined();
      expect(1 / seconds(token!), d.selector).toBeLessThan(3);
    }
    // The only keyframes are the spinner turn and the shimmer: nothing blinks or pulses.
    const names = new Set(
      all.flatMap((d) => d.atRules.filter((a) => a.startsWith("@keyframes")).map((a) => a.slice(11))),
    );
    expect([...names].sort()).toEqual(["ws-shimmer", "ws-spin"]);
  });

  it("DS-13@PoC FR 5: the tooltip has no transition and no animation, so it appears at once", () => {
    const tip = components.filter((d) => d.selector.startsWith(".ws-tooltip"));
    expect(tip.length).toBeGreaterThan(5);
    for (const d of tip) expect(d.property, d.selector).not.toMatch(/^(transition|animation)/);
  });
});
