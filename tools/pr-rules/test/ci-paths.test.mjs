// Lead decision 2026-11-12 (CI minutes): path filters skip heavy jobs on docs-only PRs; the required checks
// still report, and the always-run jobs never depend on the filter.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PATH_FILTERED_JOBS, isDocsOnly, jobsToRun, outputLines } from '../lib/ci-paths.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const files = (...names) => names.map((filename) => ({ filename, status: 'modified' }));
const none = { web: false, api: false, 'local-env': false, infra: false };
const all = { web: true, api: true, 'local-env': true, infra: true };

test('docs, design, skills and root Markdown need no heavy job', () => {
  for (const f of ['docs/ops/integrations.md', 'design/canvas/x.json', '.claude/skills/pr-pipeline/SKILL.md', 'AGENTS.md', '.github/pull_request_template.md']) {
    assert.equal(isDocsOnly(f), true, f);
  }
  assert.deepEqual(jobsToRun(files('docs/requirements/bud/BUD-03.md', 'AGENTS.md')), none);
});

test('the module catalogue (ARC-01) and any code are not docs', () => {
  assert.equal(isDocsOnly('docs/requirements/arc/ARC-01.poc.md'), false);
  assert.equal(isDocsOnly('apps/api/src/modules/audit/README.md'), false);
  assert.deepEqual(jobsToRun(files('docs/requirements/arc/ARC-01.md')), { ...none, web: true, api: true });
  assert.deepEqual(jobsToRun(files('apps/web/src/App.tsx', 'docs/x.md')), { ...none, web: true, api: true });
});

test('narrow jobs run on their own paths', () => {
  assert.deepEqual(jobsToRun(files('infra/local/compose.yaml')), all);
  assert.deepEqual(jobsToRun(files('tools/local-env/index.mjs')), { ...all, infra: false });
  assert.deepEqual(jobsToRun(files('tools/observability/definitions.mjs')), { ...all, 'local-env': false });
  assert.deepEqual(jobsToRun(files('infra/start/network.tf')), { ...all, 'local-env': false });
});

test('fail closed: pipeline, filter, toolchain, a renamed file, an empty or truncated list run every job', () => {
  for (const f of ['.github/workflows/pr-checks.yml', 'tools/pr-rules/lib/ci-paths.mjs', 'package.json', 'pnpm-lock.yaml', '.nvmrc']) {
    assert.deepEqual(jobsToRun(files(f)), all, f);
  }
  assert.deepEqual(jobsToRun([{ filename: 'docs/x.md', previous_filename: 'infra/start/x.tf', status: 'renamed' }]), { ...all, 'local-env': false });
  assert.deepEqual(jobsToRun([]), all);
  assert.deepEqual(jobsToRun(files('docs/x.md'), { truncated: true }), all);
  assert.equal(outputLines(none), 'web=false\napi=false\nlocal-env=false\ninfra=false');
});

/** The text of one job (indented under `jobs:`). */
const jobBlock = (text, job) => new RegExp(`^ {2}${job}:\\n((?: {4,}.*\\n|\\s*\\n)*)`, 'm').exec(text)?.[1] ?? '';

test('pr-checks.yml: heavy jobs depend on `changes` and run unless it says false; the others always run', () => {
  const wf = read('.github/workflows/pr-checks.yml');
  assert.match(wf, /^concurrency:\n {2}group: pr-checks-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true$/m);
  for (const job of PATH_FILTERED_JOBS) {
    const block = jobBlock(wf, job);
    assert.match(block, /^ {4}needs: changes$/m, job);
    // !cancelled(): when `changes` fails its outputs are empty, and the job runs (fail closed).
    assert.match(block, new RegExp(`^ {4}if: \\$\\{\\{ !cancelled\\(\\) && needs\\.changes\\.outputs\\.${job.replace('-', '_')} != 'false' \\}\\}$`, 'm'), job);
  }
  for (const job of ['requirements', 'secrets', 'changes']) assert.doesNotMatch(jobBlock(wf, job), /^ {4}(if|needs):/m, job);
  assert.match(jobBlock(wf, 'changes'), /run: node tools\/pr-rules\/index\.mjs changes/);
  assert.match(jobBlock(wf, 'changes'), /^ {4}outputs:\n {6}web: .*\n {6}api: .*\n {6}local_env: .*\n {6}infra: /m);
});

test('pnpm store is cached with a pinned action keyed by the lockfile', () => {
  const wf = read('.github/workflows/pr-checks.yml');
  for (const job of ['web', 'api']) {
    const block = jobBlock(wf, job);
    assert.match(block, /uses: actions\/cache@[0-9a-f]{40} # v\d+\.\d+\.\d+/, job);
    assert.match(block, /hashFiles\('pnpm-lock\.yaml'\)/, job);
  }
});
