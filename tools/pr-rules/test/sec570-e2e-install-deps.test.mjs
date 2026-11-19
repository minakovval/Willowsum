// Security review of PR #570 (pipeline): the retry loop of the e2e «System libraries» step stays fail-closed and adds
// no untrusted input or apt trust change. Mutants killed: final `exit 1` -> `exit 0` / removed, `|| true` on the
// install command, `continue-on-error`, `${{ github.event.* }}` in the script, an apt option that drops verification.
// #579: `sudo dpkg --force-all -i x.deb || true` in the loop, an apt package cache restored without verification,
// `--with-deps` (an unbounded apt install) on the browser cache miss, an `if:` that skips the bounded install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const block = /^ {2}e2e:\n((?: {4,}.*\n|\s*\n)*)/m.exec(wf)?.[1] ?? '';
const step = /- name: System libraries of the browsers\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
const code = (text) => text.replace(/^ *#.*\n/gm, '');
const run = (/^ {8}run: \|\n((?: {10,}.*\n)*)/m.exec(step)?.[1] ?? '').replace(/^ {10}/gm, '');

// The only tolerated `|| true` are the exact cleanup commands run with sudo between attempts (review 5972480675).
const swallowsFailure = (script) =>
  /\|\|\s*(true|:)|set \+e/.test(
    script.replace(/^ *sudo (pkill -(TERM|KILL) -x (apt-get|dpkg)|dpkg --configure -a) \|\| true$/gm, ''),
  );

test('sec570: the install-deps retry loop is fail-closed', () => {
  assert.ok(run.length > 0, 'run script');
  assert.doesNotMatch(block, /continue-on-error/);
  assert.doesNotMatch(step, /^ {8}shell:/m); // default `bash -e`
  assert.doesNotMatch(step, /^ {8}if:/m); // #579: runs on a browser cache hit and miss alike
  assert.equal(swallowsFailure(run), false);
  const lines = run.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'exit 1');
  // The only success exit is the branch taken when the bounded install command itself succeeded.
  assert.equal(run.match(/exit 0/g)?.length, 1);
  assert.match(run, /^ {2}if timeout -k \d+s \d+m pnpm [^;|&\n]*playwright install-deps chromium webkit; then\n {4}exit 0\n {2}fi$/m);
  assert.match(run, /^for attempt in 1 2; do$/m);
});

test('sec579: the failure guard kills a forced dpkg install hidden behind a tolerated cleanup prefix', () => {
  const cleanup = '  sudo dpkg --configure -a || true\n';
  assert.ok(run.includes(cleanup), 'cleanup line present');
  for (const mutant of [
    '  sudo dpkg --force-all -i /tmp/x.deb || true\n',
    '  sudo dpkg -i x.deb || true\n',
    '  sudo pkill -TERM -x apt-get; exit 0 || true\n',
    '  sudo pkill -f apt || true\n',
    '  pnpm --filter @willowsum/web exec playwright install-deps chromium webkit || true\n',
  ]) {
    assert.equal(swallowsFailure(run.replace(cleanup, cleanup + mutant)), true, mutant);
  }
});

test('sec579: no apt package cache, and every apt install of the e2e job is the bounded one', () => {
  const steps = code(block);
  assert.doesNotMatch(steps, /apt-archives|Dir::Cache|chmod/);
  assert.doesNotMatch(steps, /--with-deps/);
  assert.equal(steps.match(/playwright install-deps|playwright install [^\n]*--with-deps|apt-get install/g)?.length, 1);
  const miss = /- name: Install Chromium and WebKit[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  assert.match(miss, /^ {8}timeout-minutes: \d+$/m);
  assert.match(code(miss), /^ {8}run: pnpm --filter @willowsum\/web exec playwright install --only-shell chromium webkit$/m);
});

test('sec570: no workflow expression in the script and no apt trust or source change', () => {
  assert.doesNotMatch(run, /\$\{\{/);
  assert.doesNotMatch(run, /AllowUnauthenticated|AllowInsecure|allow-unauthenticated|Verify-Peer|Verify-Host|trusted=yes|--force-yes|sources\.list|add-apt-repository|apt-key|curl|wget/i);
  const confStep = /- name: Settings of apt[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  assert.doesNotMatch(confStep, /AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host|\$\{\{|continue-on-error/);
  const conf = /printf '([^']*)'/.exec(confStep)?.[1].split('\\n').filter(Boolean);
  assert.deepEqual(conf, ['Acquire::Retries "3";', 'Acquire::http::Timeout "20";', 'Acquire::https::Timeout "20";', 'DPkg::Lock::Timeout "60";']);
});
