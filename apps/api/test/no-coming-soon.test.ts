import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DAT-05 AC6 (AGENTS.md «UI»: no "Coming soon"): an unfinished function is hidden by its flag, never shown as
 * «Coming soon» or «Скоро». No source file or translation that ships in a build holds such a text.
 */
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const SHIPPED = [
  "apps/web/src",
  "apps/web/index.html",
  "apps/admin/src",
  "packages/ui/src",
  "packages/i18n/src",
  "apps/api/src",
];
// Whole words only: «скорочення» (abbreviation) is fine, «скоро» is not.
const TEASER = /coming[\s\u00a0-]+soon|(?<!\p{L})(?:скоро|незабаром|невдовзі|soon)(?!\p{L})/iu;

function files(entry: string): string[] {
  const full = path.join(repo, entry);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [entry];
  return readdirSync(full).flatMap((name) => (name === "node_modules" ? [] : files(path.join(entry, name))));
}

describe("DAT-05 AC6: no «Coming soon» anywhere in what ships", () => {
  const shipped = SHIPPED.flatMap(files).filter(
    (f) => /\.(tsx?|json|css|html)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it("scans the shipped sources and translations", () => {
    expect(shipped.some((f) => f.startsWith("packages/i18n/src"))).toBe(true);
    expect(shipped.some((f) => f.startsWith("apps/web/src"))).toBe(true);
  });

  it("no file holds «Coming soon», «Скоро» or the like", () => {
    const offending = shipped.filter((f) => TEASER.test(readFileSync(path.join(repo, f), "utf8")));
    expect(offending).toEqual([]);
  });

  it("the pattern catches the teasers and spares ordinary words", () => {
    for (const text of ["Coming soon", "coming-soon", "Скоро", "скоро буде", "Незабаром", "Available soon"])
      expect(TEASER.test(text), text).toBe(true);
    for (const text of ["Великі суми і скорочення", "Скорочено", "Soonish"])
      expect(TEASER.test(text), text).toBe(false);
  });
});
