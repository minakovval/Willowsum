#!/usr/bin/env node
// Створено: 2026-11-14 · Оновлено: 2026-11-14
//
// Token and time accounting for the issue «Облік токенів» (#180) — owner, 2026-11-14 (#178, comment 6873950124).
//
//   node tools/token-report/index.mjs pr --pr <n> --type <тип> --rounds <text> --run role=…,log=…,ms=…,tokens=… …
//        (--ci-runs <runs.json> | --branch <PR branch>) [--note <text>]   → the ready row of the table «PR»
//   node tools/token-report/index.mjs session <transcript.jsonl> [--since <ISO>] [--until <ISO>]   → the lead's sums
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
