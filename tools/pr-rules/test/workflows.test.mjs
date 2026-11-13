import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DAILY_CHECK_STEP, DAILY_WORKFLOW } from '../lib/fetch.mjs';
import { REQUIRED_WORKFLOWS, jobNames } from '../lib/workflows.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WORKFLOWS = fs
  .readdirSync(path.join(ROOT, '.github/workflows'))
  .filter((n) => /\.ya?ml$/.test(n))
  .map((n) => `.github/workflows/${n}`);

/** The `permissions:` block of one job (indented 4 spaces under the job key). */
function jobPermissions(text, job) {
  const block = new RegExp(`^ {2}${job}:\\n((?: {4,}.*\\n|\\s*\\n)*)`, 'm').exec(text)?.[1] ?? '';
  const perms = /^ {4}permissions:\s*(\{\})?\n((?: {6}.*\n)*)/m.exec(block);
  if (!perms) return null;
  if (perms[1]) return {};
  return Object.fromEntries(
    perms[2]
      .split('\n')
      .filter(Boolean)
      .map((l) => /^\s*([\w-]+):\s*(\w+)/.exec(l))
      .map((m) => [m[1], m[2]]),
  );
}

test('jobNames: job keys, or a plain `name:`', () => {
  const yml = 'name: X\non: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - name: not a job\n  b-c: # comment\n    name: Bee\n  d:\n    name: ${{ matrix.x }}\nother:\n  e: 1\n';
  assert.deepEqual(jobNames(yml), ['a', 'Bee', 'd']);
});

test('CICD-01 FR 3: the required CI jobs are exactly the ones AGENTS.md lists', () => {
  const jobs = REQUIRED_WORKFLOWS.flatMap((wf) => jobNames(read(wf))).sort();
  assert.deepEqual(jobs, ['api', 'changes', 'e2e', 'infra', 'local-env', 'requirements', 'secrets', 'traceability', 'web']);
  const listed = /All CI checks green \(jobs ([^)]+)\)/.exec(read('AGENTS.md').replace(/\n\s*/g, ' '))[1];
  assert.deepEqual([...listed.matchAll(/`([\w-]+)`/g)].map((m) => m[1]).sort(), jobs);
});

test('CICD-03: every action is pinned to a full commit hash', () => {
  for (const wf of WORKFLOWS) {
    for (const m of read(wf).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${wf}: ${m[1]}`);
    }
  }
});

test('ADR-0008: no workflow runs on pull_request_target or workflow_run (PR code never gets a privileged token)', () => {
  const code = (text) => text.replace(/#.*$/gm, '');
  for (const wf of WORKFLOWS) assert.doesNotMatch(code(read(wf)), /pull_request_target|workflow_run/, wf);
});

test('ADR-0008: PR rule workflows have least-privilege tokens', () => {
  const label = read('.github/workflows/pr-sensitive-label.yml');
  assert.match(label, /^permissions: \{\}$/m);
  assert.deepEqual(jobPermissions(label, 'sensitive-label'), { contents: 'read', 'pull-requests': 'write' });

  const description = read('.github/workflows/pr-description.yml');
  assert.deepEqual(jobPermissions(description, 'traceability'), { contents: 'read', 'pull-requests': 'read' });
  assert.match(description, /types: \[opened, edited, reopened, synchronize, ready_for_review\]/);

  const daily = read('.github/workflows/daily-main-check.yml');
  assert.match(daily, /^permissions: \{\}$/m);
  assert.deepEqual(jobPermissions(daily, 'main-check'), {
    contents: 'read',
    'pull-requests': 'read',
    checks: 'read',
    actions: 'read',
    issues: 'write',
  });
  assert.match(daily, /schedule:\n\s+- cron: "\d+ \d+ \* \* \*"/, 'runs every day');
  assert.match(daily, /workflow_dispatch:/, 'can be run by hand');
});

test('ADR-0008: no checkout keeps the token, and inputs reach scripts only through env', () => {
  for (const wf of WORKFLOWS) {
    const text = read(wf);
    const checkouts = [...text.matchAll(/uses: actions\/checkout@\w+[^\n]*\n((?:\s{8,}.*\n)*)/g)];
    for (const c of checkouts) assert.match(c[1], /persist-credentials: false/, wf);
    for (const m of text.matchAll(/^\s*run:.*\$\{\{\s*(github\.event|inputs)\./gm)) assert.fail(`${wf}: ${m[0].trim()}`);
  }
});

test('review #87 item 7: the window starts at the last run whose check step succeeded — the step exists and never fails on findings', () => {
  const daily = read(`.github/workflows/${DAILY_WORKFLOW}`);
  assert.match(daily, new RegExp(`^ {6}- name: ${DAILY_CHECK_STEP}\\n {8}id: check$`, 'm'));
  assert.match(daily, /daily --issue --outputs /, 'the check step writes `alert` instead of failing');
  assert.match(daily, /if: steps\.check\.outputs\.alert == 'true'\n\s+run: node tools\/pr-rules\/index\.mjs alerted\n/, 'a later step fails the run');
});
