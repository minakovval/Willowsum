// Created: 2026-11-19 (#563)
//
// Rule for API tests: a leak check on a response body goes through `leakText(...)`
// (apps/api/test/leak-text.ts), never on the raw body. A raw problem body holds a random hex `supportId`, which
// contains any short number by chance, so `expect(res.body).not.toContain("10")` fails at random (#557, #563).
//
// `findRawBodyLeakChecks(source)` returns the lines of a test file with `expect(<x>.body ...).not.toContain(`
// where `<x>.body` is the raw response body. It does not flag `leakText(<x>.body)`, `JSON.stringify(...)`,
// `.json()` or a body read for another reason (`toContain` without `not`). A line that asserts on the raw body
// on purpose (for example, that `supportId` is absent) carries the comment `leak-guard: raw` with the reason.

export const RAW_OK_MARKER = "leak-guard: raw";

// expect(res.body)  expect(reads[0]!.body)  expect((await call(...)).body)  expect(res.body, "message")
const RAW_BODY_CHECK = /\bexpect\(\s*(?:\(await .*?\)|[\w$.\[\]!?]+?)\.body\s*(?:,[^)]*)?\)\s*\.not\.toContain\(/;

/** @param {string} source @returns {{ line: number, text: string }[]} */
export function findRawBodyLeakChecks(source) {
  const found = [];
  source.split("\n").forEach((text, index) => {
    if (RAW_BODY_CHECK.test(text) && !text.includes(RAW_OK_MARKER)) found.push({ line: index + 1, text: text.trim() });
  });
  return found;
}
