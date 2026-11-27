#!/usr/bin/env node
// Створено: 2026-11-27 · Оновлено: 2026-11-27
// Step 6 of the lead's merge checklist: `node tools/pr-rules/merge-ready.mjs [--wait] <PR> [<PR>…]`.
// One line per condition (CI on the head, verdicts on the exact head, owner-decision, mergeable_state, sync only
// when needed, comments since the last review) and READY / NOT READY. `--wait` polls CI every 60 s first.
// `--sync-check <old> <new> [--sensitive]` prints the sync-confirmation checks (unchanged|changed, ok|failed list).
// Exit 0: every PR READY; 1: some NOT READY; 2: usage. Needs `gh` (REST only).
import { main } from './lib/merge-ready.mjs';
import { syncCheckCli } from './lib/sync-confirm.mjs';

// `--sync-check <old> <new> [--sensitive]`: the git checks of «The lead confirms a sync itself» (lib/sync-confirm.mjs).
const argv = process.argv.slice(2);
if (argv[0] === '--sync-check') {
  process.exitCode = syncCheckCli(argv.slice(1));
  if (process.exitCode === 2) console.error('usage: node tools/pr-rules/merge-ready.mjs --sync-check <old-head> <new-head> [--sensitive]');
} else {
  process.exitCode = await main(argv);
}
