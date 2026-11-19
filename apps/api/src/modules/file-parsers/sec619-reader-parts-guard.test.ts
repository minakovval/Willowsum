// Security review of #619 (#607 item 3): the parts the reader is made of — decoding the bytes, finding the delimiter,
// reading rows, the signature of a table — are named only in file-parsers' domain and application layers, so a file is
// not read into rows in the API process by composing them outside the worker.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as publicInterface from "./index.ts";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const MODULE = "modules/file-parsers/";
const PARTS = [
  "readRows",
  "decodeText",
  "detectEncoding",
  "detectDelimiter",
  "encodingSample",
  "formatSignature",
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.(?:[cm]?ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );

describe("IMP-06@PoC FR 3: the reader's parts stay inside file-parsers (#607 item 3)", () => {
  it("IMP-06@PoC FR 3: the public interface exports none of the reader's parts", () => {
    for (const name of PARTS) expect(Object.keys(publicInterface), name).not.toContain(name);
  });

  it("IMP-06@PoC FR 3: no file outside file-parsers' domain and application names a part of the reader", () => {
    const pattern = new RegExp(`\\b(?:${PARTS.join("|")})\\b`);
    const callers = sources(SRC)
      .map((file) => relative(SRC, file).split("\\").join("/"))
      .filter((file) => !file.startsWith(`${MODULE}domain/`) && !file.startsWith(`${MODULE}application/`))
      .filter((file) => pattern.test(readFileSync(join(SRC, file), "utf8")));
    expect(callers).toEqual([]);
  });
});
