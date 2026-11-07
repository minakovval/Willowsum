// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@willowsum/ui";
import viteConfig from "../vite.config.ts";

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
});
