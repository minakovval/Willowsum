// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssDeclarations, motion, transitionDurationViolations } from "../tokens/index.ts";

/** DS-13@PoC — motion and reduced motion, checked on the stylesheets of this package. */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (name: string) => readFileSync(here(`./${name}`), "utf8");
const base = cssDeclarations(read("base.css"));
const tokensCss = read("tokens.css");
const REDUCED = "@media (prefers-reduced-motion: reduce)";

function files(dir: string, ext: readonly string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full, ext);
    return ext.some((e) => name.endsWith(e)) ? [full] : [];
  });
}
const sheets = files(here("../"), [".css"]).filter((f) => !f.endsWith("tokens.css"));

const reduced = (selector: string) =>
  Object.fromEntries(
    base
      .filter((d) => d.atRules.includes(REDUCED) && d.selector === selector)
      .map((d) => [d.property, d.value]),
  );
const normal = (selector: string) =>
  Object.fromEntries(
    base.filter((d) => d.atRules.length === 0 && d.selector === selector).map((d) => [d.property, d.value]),
  );
const ms = (v: string) => Number(/([\d.]+)ms/.exec(v)?.[1]);

describe("DS-13@PoC motion", () => {
  it("DS-13@PoC AC1: with reduced motion nothing on a chart animates longer than 1 ms and the skeleton does not move", () => {
    const all = reduced("*, *::before, *::after");
    expect(all["animation-duration"]).toBe("var(--ws-duration-reduced) !important");
    expect(all["transition-duration"]).toBe("var(--ws-duration-reduced) !important");
    expect(motion["duration-reduced"]).toBeLessThan(1);
    expect(motion["duration-reduced"]).toBeLessThanOrEqual(0.01);
    expect(reduced(".ws-skeleton")).toMatchObject({
      animation: "none !important",
      "background-image": "none",
    });
    expect(normal(".ws-chart, .ws-chart *")).toMatchObject({ animation: "none", transition: "none" });
  });

  it("DS-13@PoC AC2: with reduced motion the spinner stays visible and turns once in 2.4 s", () => {
    expect(reduced(".ws-spinner")).toEqual({
      "animation-duration": "var(--ws-duration-spinner-reduced) !important",
      "animation-iteration-count": "infinite !important",
    });
    expect(motion["duration-spinner-reduced"]).toBe(2400);
    expect(tokensCss).toMatch(
      /prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--ws-duration-spinner: 2400ms;/,
    );
    expect(normal(".ws-spinner").animation).toBe(
      "ws-spin var(--ws-duration-spinner) var(--ws-easing-linear) infinite",
    );
    expect(motion["duration-spinner"]).toBe(800);
  });

  it("DS-13@PoC AC3: a hover colour change lasts 120–200 ms (every transition uses duration-interaction, ease-out)", () => {
    expect(motion["duration-interaction"]).toBeGreaterThanOrEqual(120);
    expect(motion["duration-interaction"]).toBeLessThanOrEqual(200);
    for (const file of sheets)
      expect(transitionDurationViolations(readFileSync(file, "utf8")), file).toEqual([]);
    expect(transitionDurationViolations(".x { transition: color 400ms ease; }")).toHaveLength(1);
    expect(
      transitionDurationViolations(".x { transition: color var(--ws-duration-skeleton); }"),
    ).toHaveLength(1);
    const components = cssDeclarations(read("components.css"));
    const button = components.find((d) => d.selector === ".ws-button" && d.property === "transition");
    expect(button?.value).toBe("background-color var(--ws-duration-interaction) var(--ws-easing-out)");
  });

  it("DS-13@PoC AC4: a chart shows new data without an appearance animation", () => {
    expect(normal(".ws-chart, .ws-chart *")).toMatchObject({ animation: "none", transition: "none" });
  });

  it("DS-13@PoC AC5: with reduced motion the switch thumb moves at once", () => {
    const components = cssDeclarations(read("components.css"));
    const thumb = components.find(
      (d) => d.selector === ".ws-switch-track::after" && d.property === "transition",
    );
    expect(thumb?.value).toBe("transform var(--ws-duration-interaction) var(--ws-easing-out)");
    expect(motion["duration-interaction"]).toBe(150);
    expect(tokensCss).toMatch(
      /prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--ws-duration-interaction: 0\.01ms;/,
    );
    expect(reduced("*, *::before, *::after")["transition-duration"]).toContain("--ws-duration-reduced");
  });

  it("DS-13@PoC AC6: one shimmer pass of the skeleton lasts 1.6 s and nothing flashes more than 3 times a second", () => {
    expect(normal(".ws-skeleton").animation).toBe(
      "ws-shimmer var(--ws-duration-skeleton) var(--ws-easing-in-out) infinite",
    );
    expect(motion["duration-skeleton"]).toBe(1600);
    expect(1000 / motion["duration-skeleton"]).toBeLessThan(3);
    // The band moves left to right across the shape; it does not blink.
    const frames = base.filter((d) => d.atRules.includes("@keyframes ws-shimmer"));
    expect(frames.map((d) => d.property)).toEqual(["background-position", "background-position"]);
    // Only the spinner turn and the shimmer exist; no opacity blinking anywhere.
    for (const file of sheets) {
      const names = [...readFileSync(file, "utf8").matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
      for (const name of names) expect(["ws-spin", "ws-shimmer"], file).toContain(name);
    }
    // Every infinite animation repeats slower than 3 times a second.
    expect(1000 / motion["duration-spinner"]).toBeLessThan(3);
  });

  it("DS-13@PoC EC1: a change of the reduced-motion setting applies at once (CSS media queries, not a value read once)", () => {
    expect(base.some((d) => d.atRules.includes(REDUCED))).toBe(true);
    // Script reads the setting only through useMediaQuery, which follows the media query's changes.
    const sources = files(here("../"), [".ts", ".tsx"]).filter(
      (f) => !/\.test\.tsx?$/.test(f) && !f.includes(join("src", "test-utils")),
    );
    const readers = sources.filter((f) => readFileSync(f, "utf8").includes("matchMedia("));
    expect(readers.map((f) => f.slice(here("../").length))).toEqual(["useMediaQuery.ts"]);
    expect(readFileSync(here("../useMediaQuery.ts"), "utf8")).toContain('addEventListener("change"');
  });

  it("DS-13@PoC FR 9: with reduced motion scrolling is not smooth", () => {
    expect(reduced("*, *::before, *::after")["scroll-behavior"]).toBe("auto !important");
    expect(ms(tokensCss.match(/--ws-duration-reduced: ([^;]+);/)?.[1] ?? "")).toBe(0.01);
  });
});
