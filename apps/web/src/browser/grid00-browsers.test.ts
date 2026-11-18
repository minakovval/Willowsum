import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browserSupport, supportedMinimums } from "./support.ts";

/**
 * GRID-00@PoC FR 30: Chrome, Safari and Edge of the last 3 months are supported, Firefox only from PoC v2 (owner
 * decisions 2026-11-12 and 2026-11-13). The detection itself is NFR-07@PoC; here the rule as the grid requirement states it.
 */
const TODAY = new Date("2026-11-18T12:00:00Z");
const chrome = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const edge = (v: string) => `${chrome(v)} Edg/${v}`;
const safari = (v: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;
const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

describe("GRID-00@PoC FR 30: supported browsers", () => {
  it("GRID-00@PoC FR 30: Chrome, Edge and Safari at the oldest version of the last 3 months are supported, one major older is not; Firefox is not", () => {
    const min = supportedMinimums(TODAY);
    const chromeMajor = Number(min.chromium.split(".")[0]);
    const [safariMajor, safariMinor] = min.safari.split(".").map(Number) as [number, number];
    expect(browserSupport(chrome(`${chromeMajor}.0.0.0`), TODAY)).toBe("supported");
    expect(browserSupport(edge(`${chromeMajor}.0.0.0`), TODAY)).toBe("supported");
    expect(browserSupport(chrome(`${chromeMajor - 1}.0.0.0`), TODAY)).toBe("unsupported");
    expect(browserSupport(edge(`${chromeMajor - 1}.0.0.0`), TODAY)).toBe("unsupported");
    expect(browserSupport(safari(`${safariMajor}.${safariMinor}`), TODAY)).toBe("supported");
    expect(browserSupport(safari(`${safariMajor - 1}.${safariMinor}`), TODAY)).toBe("unsupported");
    expect(browserSupport(firefox, TODAY)).toBe("unsupported");
  });

  it("GRID-00@PoC FR 30: the end-to-end tests run in the engines of those browsers (Chromium for Chrome and Edge, WebKit for Safari) and not in Firefox", () => {
    const config = readFileSync(resolve(process.cwd(), "e2e/playwright.config.ts"), "utf8");
    const projects = [...config.matchAll(/^\s*(?:\{\s*)?name: "(\w+)"/gm)].map((m) => m[1]);
    expect(projects).toEqual(["chromium", "webkit"]);
  });
});
