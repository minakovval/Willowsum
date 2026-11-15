// Security review of PR #241 (CICD-02, pipeline; follow-up #243 item 1): the required check `api` is a gate over the
// matrix job `api-parts`, held by tests so a later edit cannot loosen it silently. Mutants this file kills:
// `test "$PARTS" = "success" || true`, `skipped` accepted as success, `continue-on-error` on the matrix job or on one of
// its steps, the gate no longer depending on `api-parts`, and the gate reading something other than its result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const job = (name) => new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\s*\\n)*)`, 'm').exec(wf)?.[1] ?? '';
const gate = job('api');
const parts = job('api-parts');

/** The shell lines of the gate's run step, comments and blanks dropped. */
const runLines = () => {
  const run = /^ {8}run: \|\n((?: {10}.*\n)+)/m.exec(gate)?.[1] ?? '';
  return run.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
};

test('sec241: the gate `api` needs the parts and runs unless cancelled, so a failed or skipped part cannot pass it unseen', () => {
  assert.ok(gate.length > 0 && parts.length > 0);
  assert.match(gate, /^ {4}needs: \[changes, api-parts\]$/m);
  assert.match(gate, /^ {4}if: \$\{\{ !cancelled\(\) && needs\.changes\.outputs\.api != 'false' \}\}$/m);
});

test('sec241: the gate compares the result of the parts with `success` and nothing else decides', () => {
  assert.match(gate, /^ {8}env:\n {10}PARTS: \$\{\{ needs\.api-parts\.result \}\}$/m);
  const lines = runLines();
  // Exactly the echo and the one test; the last command is the test and its exit code is the job's.
  assert.deepEqual(lines, ['echo "api-parts: $PARTS"', 'test "$PARTS" = "success"']);
});

test('sec241: no `|| true`, `skipped`, `continue-on-error` or `always()` loosens the gate', () => {
  assert.doesNotMatch(gate, /\|\|\s*true|;\s*true\b|\bskipped\b.*=|=.*\bskipped\b|continue-on-error|always\(\)|set \+e/);
  assert.doesNotMatch(gate, /^ {4}continue-on-error:/m);
  // One step only: no second step can turn the result around.
  assert.equal((gate.match(/^ {6}- /gm) ?? []).length, 1);
});

test('sec241: neither the matrix job `api-parts` nor any of its steps may fail without failing the job', () => {
  // A failing shard must fail the part (and so the gate): no `continue-on-error`, at job or step level.
  assert.doesNotMatch(parts, /continue-on-error:\s*(?!false\b)/);
  // `fail-fast: false` only lets the other shards report; it does not make a failed shard pass.
  assert.match(parts, /^ {6}fail-fast: false/m);
  // Every part runs the checks it is named for: the integration tests are a step of the shards, not conditional on `||`.
  assert.match(parts, /run: pnpm --filter @willowsum\/api test:integration --shard="\$WS_SHARD"/);
  assert.doesNotMatch(parts, /test:integration[^\n]*\|\|/);
});

test('sec241: the part job `api-parts` is not a required check by name, the gate is', () => {
  assert.match(parts, /^ {4}name: api \$\{\{ matrix\.part \}\}$/m);
  assert.match(gate, /runs-on: ubuntu-latest/);
});
