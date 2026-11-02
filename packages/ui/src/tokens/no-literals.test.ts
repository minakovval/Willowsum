// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * DS-06 acceptance 3 and DS-09 acceptance 7 for stylesheets: no hex / rgb colours and no z-index
 * numbers outside the generated tokens.css. (TypeScript sources are covered by ESLint.)
 */
const srcRoot = fileURLToPath(new URL("../", import.meta.url));

function cssFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(cssFiles(full));
    else if (name.endsWith(".css") && name !== "tokens.css") out.push(full);
  }
  return out;
}

describe("stylesheets use tokens only", () => {
  const files = cssFiles(srcRoot);

  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it.each(files.map((f) => [f.slice(srcRoot.length), f]))(
    "%s has no colour literals or z-index numbers",
    (_n, file) => {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(css).not.toMatch(/z-index:\s*-?\d/);
    },
  );
});
