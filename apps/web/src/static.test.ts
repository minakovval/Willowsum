// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@willowsum/ui";
import viteConfig, { requireCaptchaSiteKey } from "../vite.config.ts";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, ext) : name.endsWith(ext) ? [full] : [];
  });
}

describe("static checks", () => {
  it("index.html applies the stored theme before first paint with the ui package's key (DS-11 item 7)", () => {
    const html = readFileSync(join(appRoot, "index.html"), "utf8");
    // A classic blocking script in <head> (no module, defer or async), from the app's own origin: the CSP
    // allows no inline script (NFR-14 FR 3), so the code lives in public/theme-init.js.
    const tag = '<script src="./theme-init.js"></script>';
    expect(html).toContain(tag);
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("</head>"));
    const script = readFileSync(join(appRoot, "public", "theme-init.js"), "utf8");
    expect(script).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(script).toContain(`setAttribute("${THEME_ATTRIBUTE}"`);
  });

  it("NFR-14 FR 3: index.html has no inline script or event handler (the CSP allows scripts from 'self' only)", () => {
    const html = readFileSync(join(appRoot, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc="/);
    expect(html).not.toMatch(/<script\b[^>]*>[^<\s]/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("builds with a relative base so dist/ works as one static site", () => {
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it.each(files(join(appRoot, "src"), ".css").map((f) => [f.slice(appRoot.length), f]))(
    "%s uses tokens only (no colour literals, no z-index numbers)",
    (_n, file) => {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(css).not.toMatch(/z-index:\s*-?\d/);
    },
  );

  it("ACC-01 FR 12: a production build fails without the Turnstile site key; local and CI builds do not need it", () => {
    const plugin = requireCaptchaSiteKey();
    expect(plugin.apply).toBe("build");
    const resolve = (mode: string, env: Record<string, string>) =>
      (plugin.configResolved as unknown as (c: { mode: string; env: Record<string, string> }) => void)({
        mode,
        env,
      });
    expect(() => resolve("production", {})).toThrow(/VITE_CAPTCHA_SITE_KEY/);
    expect(() => resolve("production", { VITE_CAPTCHA_SITE_KEY: "not a key" })).toThrow(
      /VITE_CAPTCHA_SITE_KEY/,
    );
    expect(() =>
      resolve("production", { VITE_CAPTCHA_SITE_KEY: ["0x4", "dummy", "site", "key"].join("-") }),
    ).not.toThrow();
    expect(() => resolve("ci", {})).not.toThrow();
    const scripts = (
      JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts["build"]).toBe("vite build --mode ci");
    expect(scripts["build:production"]).toBe("vite build --mode production");
    expect(
      (viteConfig as { plugins?: { name?: string }[] }).plugins?.some((p) => p?.name === plugin.name),
    ).toBe(true);
  });
});
