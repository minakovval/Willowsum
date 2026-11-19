// #607 item 3 (binding for row 41): a recipe's patterns are matched and a file is read into rows only in the isolated
// parse worker, never in the API process. The public interface does not export the reader or the matcher, and no
// file of the API outside file-parsers' domain and application layers and its worker names them.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as publicInterface from "./index.ts";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const MODULE = "modules/file-parsers/";

/** The file's code without its comments: a comment may name the reader. */
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

describe("IMP-06@PoC FR 3: the matcher and the reader run only in the parse worker (#607 item 3)", () => {
  it("IMP-06@PoC FR 3: the public interface exports neither the reader, the matcher nor the in-process parse", () => {
    for (const name of ["readDelimitedFile", "compilePattern", "parseStatement", "analyzeTable"])
      expect(Object.keys(publicInterface), name).not.toContain(name);
    expect(typeof publicInterface.checkPattern("a(b)").ok).toBe("boolean");
    expect(publicInterface.checkPattern("a(b)")).toEqual({ ok: true, groups: 1 });
    expect(publicInterface.checkPattern("(a)\\1")).toEqual({ ok: false, issue: "backreference" });
  });

  it("IMP-06@PoC FR 3: outside file-parsers' domain and application only its worker calls the parse", () => {
    const callers = sources(SRC)
      .map((file) => relative(SRC, file).split("\\").join("/"))
      .filter((file) => !file.startsWith(`${MODULE}domain/`) && !file.startsWith(`${MODULE}application/`))
      .filter((file) =>
        /\b(?:readDelimitedFile|compilePattern|parseStatement|analyzeTable)\b/.test(code(join(SRC, file))),
      );
    expect(callers).toEqual([`${MODULE}adapters/isolation/worker.ts`]);
  });
});
