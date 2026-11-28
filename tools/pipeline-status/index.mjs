#!/usr/bin/env node
// Створено: 2026-11-28 · Оновлено: 2026-11-28
// `node tools/pipeline-status/index.mjs [--ledger <tsv>] [<PR> …]` — one line per PR: head SHA, CI (green / running /
// red with names), the latest Verdict and Security verdict that name the head, behind_by, mergeable_state, labels and
// the agents of the lead ledger. No numbers: every open PR. Needs `gh` (REST only). README.md.
import fs from 'node:fs';
import { main } from './lib.mjs';

process.exitCode = await main(process.argv.slice(2), { readFile: (p) => fs.readFileSync(p, 'utf8') });
