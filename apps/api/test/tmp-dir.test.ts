import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTestTmpDir, removeTestTmpDir, testTmpRoot } from "./tmp-dir.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" || entry.name === ".tmp" ? [] : sources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("test temp folders: each test owns only its own folder (scaffold vs guard race, PR #143)", () => {
  it("gives every caller a new, empty folder under test/.tmp", () => {
    const a = makeTestTmpDir("probe");
    const b = makeTestTmpDir("probe");
    try {
      expect(a).not.toBe(b);
      expect(path.dirname(a)).toBe(testTmpRoot);
      expect(readdirSync(a)).toEqual([]);
    } finally {
      removeTestTmpDir(a);
      removeTestTmpDir(b);
    }
  });

  it("removing one folder leaves the shared parent and the other tests' folders in place", () => {
    const mine = makeTestTmpDir("probe");
    const theirs = makeTestTmpDir("probe");
    writeFileSync(path.join(theirs, "0001_things.sql"), "SELECT 1;");
    try {
      removeTestTmpDir(mine);
      expect(existsSync(mine)).toBe(false);
      expect(existsSync(testTmpRoot)).toBe(true);
      expect(readFileSync(path.join(theirs, "0001_things.sql"), "utf8")).toBe("SELECT 1;");
    } finally {
      removeTestTmpDir(theirs);
    }
  });

  it("refuses to remove the shared parent, a nested path or a folder outside it", () => {
    for (const dir of [testTmpRoot, `${testTmpRoot}/`, path.join(testTmpRoot, "a/b"), apiDir, "/tmp"])
      expect(() => removeTestTmpDir(dir)).toThrow(/not a folder made by makeTestTmpDir/);
    expect(existsSync(testTmpRoot)).toBe(true);
  });

  it("no other file in apps/api builds the shared test/.tmp path itself", () => {
    const offenders = ["src", "scripts", "test"]
      .flatMap((dir) => sources(path.join(apiDir, dir)))
      .filter((file) => !file.endsWith(path.join("test", "tmp-dir.ts")))
      .filter((file) => /["']test\/\.tmp\/?["']/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(apiDir, file));
    expect(offenders).toEqual([]);
  });
});
