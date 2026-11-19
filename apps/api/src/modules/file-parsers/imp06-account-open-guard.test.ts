// Wave 2 row 41 part 3 (#618, its second item): the recipe's account value is opened only in the parse worker. No file of the
// API outside household opens a value with a field opener but the worker, and nothing anywhere opens the account
// value's field in-process (`SpaceKeys.open` with `ACCOUNT_VALUE_FIELD` or its text).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** The file's code without its comments: a comment may name the function. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.includes(".test-")
        ? [join(dir, e.name)]
        : [],
  );
}

const files = () => sources(SRC).map((file) => relative(SRC, file).split("\\").join("/"));

describe("NFR-01@PoC FR 6: the account value is opened only in the parse worker", () => {
  it("NFR-01@PoC FR 6: outside household only the parse worker opens a value with a field opener", () => {
    const callers = files()
      .filter((file) => !file.startsWith("modules/household/"))
      .filter((file) => /\bopenWithFieldOpener\b/.test(code(join(SRC, file))));
    expect(callers).toEqual(["modules/file-parsers/adapters/isolation/open-binding.ts"]);
  });

  it("NFR-01@PoC FR 6: only the parse worker loads the code that opens the binding", () => {
    const importers = files().filter((file) => /open-binding\.ts["']/.test(code(join(SRC, file))));
    expect(importers).toEqual(["modules/file-parsers/adapters/isolation/worker.ts"]);
  });

  it("NFR-01@PoC FR 6: no code opens the account value's field in-process", () => {
    const opens = files().filter((file) =>
      /\.open\(\s*[^)]*(?:ACCOUNT_VALUE_FIELD|importRecipes\.accountValue)/.test(code(join(SRC, file))),
    );
    expect(opens).toEqual([]);
  });
});
