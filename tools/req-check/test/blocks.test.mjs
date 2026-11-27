// PRC-02 (owner, 2026-11-27): the progress page groups the PoC features into big blocks, one config for the mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignBlocks } from '../lib/coverage.mjs';
import { main } from '../index.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/progress-dashboard/blocks.json'), 'utf8'));

test('PRC-02 blocks: assignBlocks reports an unmapped ID, an ID in two blocks and an ID that is no longer in PoC', () => {
  const r = assignBlocks({ blocks: [{ id: 'a', ids: ['X-01', 'X-02', 'OLD-01'] }, { id: 'b', ids: ['X-02', 'X-03'] }] }, ['X-01', 'X-02', 'X-03', 'X-04']);
  assert.deepEqual(r.unmapped, ['X-04']);
  assert.deepEqual(r.duplicated, ['X-02']);
  assert.deepEqual(r.stale, ['OLD-01']);
  assert.equal(r.block.get('X-02'), 'a');
});

test('PRC-02 blocks: every PoC requirement of the repository is mapped to exactly one block in tools/progress-dashboard/blocks.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-check-blocks-'));
  const out = path.join(dir, 'coverage.json');
  assert.equal(main(['--root', ROOT, '--quiet', '--coverage-json', out], () => {}), 0);
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  const r = assignBlocks(config, json.features.map((f) => f.id));
  assert.deepEqual(r.unmapped, [], 'add each unmapped PoC requirement to one block in tools/progress-dashboard/blocks.json');
  assert.deepEqual(r.duplicated, [], 'a requirement is in one block only');
  assert.deepEqual(r.stale, [], 'remove requirements that are not in the PoC release any more from blocks.json');
  assert.ok(json.features.every((f) => f.block !== 'other'));
  assert.deepEqual(json.blocks.map((b) => b.id), config.blocks.map((b) => b.id));
});
