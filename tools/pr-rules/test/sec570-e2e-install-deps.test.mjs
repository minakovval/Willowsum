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
  assert.match(run, /^ {2}if timeout -k \d+s \d+m pnpm [^;|&\n]*playwright install-deps chromium; then\n {4}exit 0\n {2}fi$/m);
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
    '  pnpm --filter @willowsum/web exec playwright install-deps chromium || true\n',
  ]) {
    assert.equal(swallowsFailure(run.replace(cleanup, cleanup + mutant)), true, mutant);
  }
});

test('sec579: no apt package cache, and every apt install of the e2e job is the bounded one', () => {
  const steps = code(block);
  assert.doesNotMatch(steps, /apt-archives|Dir::Cache|chmod/);
  assert.doesNotMatch(steps, /--with-deps/);
  assert.equal(steps.match(/playwright install-deps|playwright install [^\n]*--with-deps|\bapt(-get)?\b[^\n]*\binstall\b|\bdpkg\b[^\n]*\s-i\b/g)?.length, 1);
  const miss = /- name: Install Chromium[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  const missLimit = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(miss)?.[1]);
  assert.ok(missLimit > 0 && missLimit <= 6, `browser download limit ${missLimit}`);
  assert.match(code(miss), /^ {8}run: pnpm --filter @willowsum\/web exec playwright install --only-shell chromium$/m);
});

test('sec570: no workflow expression in the script and no apt trust or source change', () => {
  assert.doesNotMatch(run, /\$\{\{/);
  assert.doesNotMatch(run, /AllowUnauthenticated|AllowInsecure|allow-unauthenticated|Verify-Peer|Verify-Host|trusted=yes|--force-yes|sources\.list|add-apt-repository|apt-key|curl|wget/i);
  const confStep = /- name: Settings of apt[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  assert.doesNotMatch(confStep, /AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host|\$\{\{|continue-on-error/);
  const conf = /printf '([^']*)'/.exec(confStep)?.[1].split('\\n').filter(Boolean);
  assert.deepEqual(conf, ['Acquire::Retries "3";', 'Acquire::http::Timeout "20";', 'Acquire::https::Timeout "20";', 'DPkg::Lock::Timeout "60";']);
});

// Security review of PR #590: survivors of the round-1 mutants (an unmasked or `|| echo` / `&&` / `!` forced dpkg
// install, `apt install`, `--allow-insecure-repositories`, a new step that changes apt trust or installs a .deb,
// a removed or raised timeout, `restore-keys` on the browser cache, another browser download host).
test('sec590: every privileged or package-manager line of the e2e job is one of the exact known lines', () => {
  const known = new Set([
    '| sudo tee /etc/apt/apt.conf.d/99ci-retries > /dev/null',
    'sudo pkill -TERM -x apt-get || true',
    'sudo pkill -TERM -x dpkg || true',
    'sudo pkill -KILL -x apt-get || true',
    'sudo pkill -KILL -x dpkg || true',
    'sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock > /dev/null 2>&1 || break',
    'sudo dpkg --configure -a || true',
  ]);
  const lines = code(block)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('- name:') && /\b(sudo|su|doas|apt|apt-get|aptitude|dpkg|snap|pip|pipx|npx|dlx)\b/.test(l));
  assert.equal(lines.length, 7);
  for (const l of lines) assert.ok(known.has(l), l);
  assert.doesNotMatch(code(block), /allow-insecure|allow-unauthenticated|allow-downgrades|AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host|trusted=yes|--force-|sources\.list|add-apt-repository|apt-key|\b(curl|wget)\b/i);
});

test('sec590: the install is bounded at every level and the limits fit into each other', () => {
  const job = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(block)?.[1]);
  const libs = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(step)?.[1]);
  const miss = /- name: Install Chromium[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  const browsers = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(miss)?.[1]);
  const [, kill, attempt] = /^ {2}if timeout -k (\d+)s (\d+)m pnpm /m.exec(run) ?? [];
  assert.ok(job > 0 && job <= 30, `job ${job}`);
  assert.ok(libs > 0 && browsers > 0 && libs + browsers <= job, `steps ${libs} + ${browsers} > job ${job}`);
  assert.ok(Number(attempt) > 0 && 2 * (Number(attempt) + Number(kill) / 60) <= libs, `2 attempts of ${attempt} min > step ${libs}`);
});

test('sec590: the browser cache has one exact key and the browsers come from the default host', () => {
  const cache = /- name: Cache the browsers[^\n]*\n((?: {8,}.*\n)*)/.exec(block)?.[1] ?? '';
  assert.match(cache, /^ {10}key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.playwright\.outputs\.version \}\}-chromium$/m);
  assert.doesNotMatch(cache, /restore-keys|enableCrossOsArchive|fail-on-cache-miss/);
  assert.doesNotMatch(code(block), /PLAYWRIGHT_\w*(HOST|SKIP)|HTTPS?_PROXY|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_OPTIONS/);
});
