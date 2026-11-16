#!/usr/bin/env node
// Створено: 2026-11-14 · Оновлено: 2026-11-16
//
// Token and time accounting for the issue «Облік токенів» (#180) — owner, 2026-11-14 (#178, comment 6873950124).
//
//   node tools/token-report/index.mjs pr --pr <n> --type <тип> --rounds <text> --run role=…,log=…,ms=…,tokens=… …
//        (--ci-runs <runs.json> | --branch <PR branch>) [--note <text>]   → the ready row of the table «PR»
//        + one line per model (calls, cache read, cache creation, input, output); the note gets «моделі: …» (no per-agent list)
//   node tools/token-report/index.mjs session <transcript.jsonl> [--since <ISO>] [--until <ISO>]   → the lead's sums
//   node tools/token-report/index.mjs append --body <file> --row "<| … |>" [--sessions]   → the #180 body saved in
//        <file> (`gh api repos/{owner}/{repo}/issues/180 --jq .body > <file>`) gets the row after the last row of the
//        table «PR» (with --sessions: «Сесії»); every other byte stays; the file is written in place for
//        `gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@<file>`. A row of the wrong width, of several lines
//        or already in the table (same PR or segment) fails (exit 1) and the file is not written. So does a row whose
//        «Примітка» cell is longer than 120 characters, and an append that would take the body over 55 000
//        characters (GitHub's limit is 65 536): then the lead archives the «PR» table (owner, 2026-11-16, #178,
//        comment 6904503474).
//   node tools/token-report/index.mjs archive --body <file> --out <file>   → moves all rows of the table «PR» to the
//        markdown <out> (for a new archive issue) and leaves in <body> the header, a blank line and the line
//        «Архів рядків PR: <посилання>» that the lead fills; every other byte of the body stays.
//
// Run it right after the merge: agent logs (`tasks/<id>.output`) vanish with the container. A log without any
// `usage` field fails the run (exit 1) instead of counting zero. Rules: .claude/skills/pr-pipeline/references/
// token-economy.md, «Token accounting». Tests: node --test tools/token-report
import { execFileSync } from "node:child_process";
import { main } from "./lib.mjs";

process.exitCode = main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  gh: (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
});
