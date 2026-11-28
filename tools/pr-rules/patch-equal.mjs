#!/usr/bin/env node
// Usage: node tools/pr-rules/patch-equal.mjs <old-head> <new-head> <patch-file…>
// Prints `equal`, or `differs` and the names of the files that differ, one per line. Exit 0 equal, 1 differs,
// 2 wrong usage or git failure. Rule: `pr-pipeline` step 5 (a fix equal to the reviewers' patches needs no agent).
import { patchEqual } from './lib/patch-equal.mjs';

const [oldHead, newHead, ...patches] = process.argv.slice(2);
if (!oldHead || !newHead || patches.length === 0) {
  console.error('usage: node tools/pr-rules/patch-equal.mjs <old-head> <new-head> <patch-file…>');
  process.exit(2);
}
try {
  const { equal, files } = patchEqual(oldHead, newHead, patches);
  console.log(equal ? 'equal' : ['differs', ...files.map((f) => `  ${f}`)].join('\n'));
  process.exit(equal ? 0 : 1);
} catch (e) {
  console.error(`patch-equal: ${e.message}`);
  process.exit(2);
}
