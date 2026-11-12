// Security re-review of PR #87 (CICD-01), round 2: the daily workflow after 92b0158.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (text) => text.replace(/^\s*#.*$/gm, '').replace(/\s#\s.*$/gm, '');

test('SEC87R2: the daily job reads no secret in any expression form (only github.token)', () => {
  const daily = code(read('.github/workflows/daily-main-check.yml'));
  for (const [, expr] of daily.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) assert.doesNotMatch(expr, /\bsecrets\b/i, expr);
  assert.doesNotMatch(daily, /^\s*secrets:/m);
});

test('SEC87R2: a crash of the check step can never be read as a checked window (no continue-on-error)', () => {
  // With continue-on-error a failed step reports conclusion «success» in the jobs API, which moves the window.
  assert.doesNotMatch(code(read('.github/workflows/daily-main-check.yml')), /continue-on-error/);
});

