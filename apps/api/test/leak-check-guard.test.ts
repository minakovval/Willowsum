import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRawBodyLeakChecks } from "../../../tools/test-guards/leak-checks.mjs";

/**
 * #563: a leak check on a raw response body fails at random, because a problem body holds a random hex
 * `supportId`. The rule is in tools/test-guards/leak-checks.mjs; this file tests the rule and runs it over the
 * API tests.
 */
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", "fixtures", ".tmp", "e2e", "leak-check-guard.test.ts"]);

// Tests of other open PRs (budget, recurring, debt payoff), not changed here to avoid conflicts. Follow-up of
// #563: move each to leakText and delete its line. The scan below fails when an entry no longer has a raw check.
const PENDING = [
  "test/bud02-budget.it.test.ts",
  "test/bud02b-wizard.it.test.ts",
  "test/bud07-recurring-sec.it.test.ts",
  "test/bud07-recurring.it.test.ts",
  "test/bud07a2-recurring.it.test.ts",
  "test/bud19-debt-payoff.it.test.ts",
];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the leak-check rule: no «not.toContain» on a raw response body (#563)", () => {
  it("flags a raw body, with or without a message or an index", () => {
    const source = [
      'expect(res.body).not.toContain("10");',
      'expect(res.body, `${url}`).not.toContain("10");',
      'expect(reads[0]!.body).not.toContain("x");',
      'expect((await call(a, "GET", "/v1/x")).body).not.toContain("x");',
    ].join("\n");
    expect(findRawBodyLeakChecks(source).map((f) => f.line)).toEqual([1, 2, 3, 4]);
  });

  it("does not flag leakText, a positive check, parsed JSON, or a line marked «leak-guard: raw»", () => {
    const source = [
      'expect(leakText(res.body)).not.toContain("10");',
      'expect(res.body).toContain("10");',
      'expect(JSON.stringify(res.json())).not.toContain("10");',
      'expect(res.body).not.toContain("supportId"); // leak-guard: raw (the field is absent)',
      'expect(rows[0]!.payload).not.toContain("x");',
    ].join("\n");
    expect(findRawBodyLeakChecks(source)).toEqual([]);
  });

  it("no API test checks a raw body, except the pending files", () => {
    const files = testFiles(path.join(apiRoot, "test")).concat(testFiles(path.join(apiRoot, "src")));
    // Fails closed: the scan sees the files that carry the helper.
    expect(files.length).toBeGreaterThan(100);
    const raw = files
      .map((file) => ({
        file: path.relative(apiRoot, file).split(path.sep).join("/"),
        source: readFileSync(file, "utf8"),
      }))
      .map(({ file, source }) => ({ file, lines: findRawBodyLeakChecks(source) }))
      .filter(({ lines }) => lines.length > 0);
    expect(raw.filter(({ file }) => !PENDING.includes(file))).toEqual([]);
    expect(raw.map(({ file }) => file).sort()).toEqual([...PENDING].sort());
  });
});
