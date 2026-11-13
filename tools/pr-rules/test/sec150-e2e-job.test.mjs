// Security review of PR #150 (NFR-07@PoC, pipeline): the hardening of the `e2e` job, held by tests so a later edit
// cannot widen it silently. Mutants this file kills: job-level `permissions: write-all`, `if: always()` on the
// artifact upload, a secret in the job, a cache key without the lockfile/version, `persist-credentials` dropped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const block = /^ {2}e2e:\n((?: {4,}.*\n|\s*\n)*)/m.exec(wf)?.[1] ?? '';

test('sec150: the e2e job exists and inherits the read-only workflow token', () => {
  assert.ok(block.length > 0);
  assert.match(wf, /^permissions:\n {2}contents: read\n/m);
  // No job-level widening: either no `permissions:` key or only `: read` / `: none` grants.
  const perms = /^ {4}permissions:(.*)\n((?: {6}.*\n)*)/m.exec(block);
  if (perms) {
    assert.doesNotMatch(perms[1], /write|all/);
    for (const line of perms[2].split('\n').filter(Boolean)) assert.match(line, /:\s*(read|none)\b/, line);
  }
});

test('sec150: the e2e job uses no secrets and does not persist the checkout token', () => {
  assert.doesNotMatch(block, /secrets\.|github\.token|GITHUB_TOKEN/);
  assert.match(block, /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n {8}with:\n {10}persist-credentials: false/);
});

test('sec150: report and traces are uploaded only on failure, only the Playwright output, for 7 days', () => {
  const up = /- name: [^\n]*\n {8}if: ([^\n]+)\n {8}uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n((?: {8,}.*\n)*)/.exec(block);
  assert.ok(up, 'upload-artifact step');
  assert.equal(up[1].trim(), 'failure()');
  const paths = /path: \|\n((?: {12}.*\n)*)/.exec(up[2])?.[1].trim().split(/\s+/);
  assert.deepEqual(paths, ['apps/web/playwright-report/', 'apps/web/test-results/']);
  assert.match(up[2], /retention-days: 7/);
});

test('sec150: caches are keyed by content (lockfile hash, Playwright version), never by PR input', () => {
  const keys = [...block.matchAll(/^ {10}key: (.*)$/gm)].map((m) => m[1]);
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => k.includes("hashFiles('pnpm-lock.yaml')")));
  assert.ok(keys.some((k) => k.includes('steps.playwright.outputs.version')));
  for (const k of keys) assert.doesNotMatch(k, /github\.(head_ref|event)/, k);
});
