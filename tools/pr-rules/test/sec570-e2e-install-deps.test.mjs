// Security review of PR #570 (pipeline): the retry loop of the e2e «System libraries» step stays fail-closed and adds
// no untrusted input or apt trust change. Mutants killed: final `exit 1` -> `exit 0` / removed, `|| true` on the
// install command, `continue-on-error`, `${{ github.event.* }}` in the script, an apt option that drops verification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const block = /^ {2}e2e:\n((?: {4,}.*\n|\s*\n)*)/m.exec(wf)?.[1] ?? '';
const step = /- name: System libraries of the cached browsers\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
const run = (/^ {8}run: \|\n((?: {10,}.*\n)*)/m.exec(step)?.[1] ?? '').replace(/^ {10}/gm, '');

test('sec570: the install-deps retry loop is fail-closed', () => {
  assert.ok(run.length > 0, 'run script');
  assert.doesNotMatch(block, /continue-on-error/);
  assert.doesNotMatch(step, /^ {8}shell:/m); // default `bash -e`
  // The only tolerated `|| true` are the cleanup commands run with sudo between attempts, never the install command.
  assert.doesNotMatch(run.replace(/^ *sudo (pkill|dpkg) [^\n]*\|\| true$/gm, ''), /\|\|\s*(true|:)|set \+e/);
  const lines = run.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'exit 1');
  // The only success exit is the branch taken when the bounded install command itself succeeded.
  assert.equal(run.match(/exit 0/g)?.length, 1);
  assert.match(run, /^ {2}if timeout -k \d+s \d+m pnpm [^;|&\n]*playwright install-deps chromium webkit; then\n {4}exit 0\n {2}fi$/m);
  assert.match(run, /^for attempt in 1 2; do$/m);
});

test('sec570: no workflow expression in the script and no apt trust or source change', () => {
  assert.doesNotMatch(run, /\$\{\{/);
  assert.doesNotMatch(run, /AllowUnauthenticated|AllowInsecure|allow-unauthenticated|Verify-Peer|Verify-Host|trusted=yes|--force-yes|sources\.list|add-apt-repository|apt-key|curl|wget/i);
  const confStep = /- name: Settings and cache of apt[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  assert.doesNotMatch(confStep, /AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host|\$\{\{|continue-on-error/);
  const conf = /printf '([^']*)'/.exec(confStep)?.[1].split('\\n').filter(Boolean);
  assert.deepEqual(conf, ['Acquire::Retries "3";', 'Acquire::http::Timeout "20";', 'Acquire::https::Timeout "20";', 'DPkg::Lock::Timeout "60";', 'Dir::Cache::Archives "%s/apt-archives";']);
});
