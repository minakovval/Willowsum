// Security review of #617 (PRC-02): the progress-dashboard workflow. Each test kills a mutant the PR's own test let
// survive (mutants M11–M17 in the review).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const WF = '.github/workflows/progress-dashboard.yml';
const read = () => fs.readFileSync(path.join(ROOT, WF), 'utf8');
const code = (t) => t.replace(/(^|\s)#.*$/gm, '$1');
const job = (wf, name) => new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\s*\\n)*)`, 'm').exec(wf)?.[1] ?? '';

test('PRC-02: progress dashboard workflow (#621): the triggers are exactly push to main and workflow_dispatch (no workflow_call, issue_comment, schedule…)', () => {
  const on = /^on:\n((?: {2,}.*\n|\s*\n)*)/m.exec(code(read()))?.[1] ?? '';
  assert.equal(on.trim().replace(/\s+\n/g, '\n'), 'push:\n    branches: [main]\n  workflow_dispatch:');
});

test('PRC-02: progress dashboard workflow (#621): `publish` (write token) uses only download-artifact of this run and the gh-pages checkout', () => {
  const pub = code(job(read(), 'publish'));
  const uses = [...pub.matchAll(/uses: ([^@\s]+)@/g)].map((m) => m[1]);
  assert.deepEqual(uses, ['actions/download-artifact', 'actions/checkout']);
  // No cross-run artifact (run-id / github-token / repository): only this run's `build` output.
  assert.doesNotMatch(pub, /run-id|github-token|repository:|pattern:|merge-multiple/);
  assert.match(pub, /name: progress-dashboard\n/);
  // No checkout leaves the token in .git/config (build: main and the published gh-pages; publish: gh-pages).
  assert.equal([...code(read()).matchAll(/uses: actions\/checkout@/g)].length, 3);
  assert.equal([...code(read()).matchAll(/persist-credentials: false/g)].length, 3);
});

test('PRC-02: progress dashboard workflow (#621): `publish` runs only copy-and-push shell commands, no interpreter or file from the artifact or gh-pages', () => {
  const pub = code(job(read(), 'publish'));
  const run = /run: \|\n((?: {10}.*\n|\s*\n)*)/.exec(pub)?.[1] ?? '';
  assert.ok(run.trim(), 'the push step has a run block');
  assert.equal([...pub.matchAll(/^\s*(?:- )?run:/gm)].length, 1, 'one shell step');
  const allowed = [
    /^test -s "\$RUNNER_TEMP\/site\/(index\.html|coverage\.json|history\.json)"$/,
    /^cp "\$RUNNER_TEMP\/site\/index\.html" "\$RUNNER_TEMP\/site\/coverage\.json" "\$RUNNER_TEMP\/site\/history\.json" pages\/$/,
    /^cd pages$/,
    /^git config user\.(name|email) "[^"$`]+"$/,
    /^git add index\.html coverage\.json history\.json$/,
    /^if git diff --cached --quiet; then echo "gh-pages is up to date"; exit 0; fi$/,
    /^git commit -q -m "Progress dashboard: coverage on main \$GITHUB_SHA"$/,
    /^AUTH="\$\(printf 'x-access-token:%s' "\$GH_TOKEN" \| base64 -w0\)"$/,
    /^echo "::add-mask::\$AUTH"$/,
    /^git -c "http\.\$GITHUB_SERVER_URL\/\.extraheader=AUTHORIZATION: basic \$AUTH" push origin HEAD:gh-pages$/,
  ];
  for (const line of run.split('\n').map((l) => l.trim()).filter(Boolean)) {
    assert.ok(allowed.some((re) => re.test(line)), `publish runs an unexpected command: ${line}`);
  }
});

test('PRC-02: progress dashboard workflow (#621): the only push in the workflow is a fast-forward to gh-pages (no force, no other ref)', () => {
  const wf = code(read());
  const pushes = wf.split('\n').filter((l) => /\bgit\b.*\bpush\b/.test(l));
  assert.equal(pushes.length, 1, pushes.join('\n'));
  assert.match(pushes[0], / push origin HEAD:gh-pages$/);
  assert.doesNotMatch(wf, /--force|\s-f\s|\+HEAD|--mirror|--delete|push-to|force_orphan/);
});

test('PRC-02: progress dashboard workflow (#621): the job token reaches only the push step, by env, never in a `run` line', () => {
  const wf = code(read());
  assert.equal([...wf.matchAll(/github\.token|GITHUB_TOKEN/g)].length, 1);
  assert.match(job(wf, 'publish'), /env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {8}run: \|/);
  assert.doesNotMatch(job(wf, 'build'), /token/i);
});

test('PRC-02 (owner, 2026-11-28): `build` reads the published gh-pages only as data — history.mjs --prev, no file of it is run or copied', () => {
  const build = code(job(read(), 'build'));
  assert.match(build, /ref: gh-pages\n {10}path: published\n {10}persist-credentials: false\n/);
  const uses = build.split('\n').filter((l) => /published\//.test(l));
  assert.equal(uses.length, 1, uses.join('\n'));
  assert.match(uses[0], /^ {10}node tools\/progress-dashboard\/history\.mjs --seed tools\/progress-dashboard\/history-seed\.json --prev published\/history\.json /);
  assert.doesNotMatch(build, /contents: write|git push/);
});
