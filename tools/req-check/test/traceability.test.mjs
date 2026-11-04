import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModel } from '../lib/model.mjs';
import { renderTraceability, buildWaves } from '../lib/traceability.mjs';
import { makeRegistries } from '../lib/registries.mjs';
import { main } from '../index.mjs';
import { corpus, req, card, slice, readme, generalAndArc } from './helpers.mjs';

const files = () => ({
  ...generalAndArc(),
  'bud/BUD-01.md': req('BUD-01', { release: '**Реліз:** PoC; решта — MVP · **Пріоритет:** M' }),
  'bud/BUD-02.md': req('BUD-02', { release: '**Реліз:** PoC · **Пріоритет:** M', criteria: [] }),
  'bud/BUD-16.md': card('BUD-16', ['PoC', 'PoC v2']),
  'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['BUD-01@PoC'], Дизайн: ['S-121'] }),
  'bud/BUD-16.poc-v2.md': slice('BUD-16', 'PoC v2', { Розширює: ['BUD-16@PoC'] }),
  'bud/BUD-18.md': card('BUD-18', ['PoC']),
  'bud/BUD-18.poc.md': slice('BUD-18', 'PoC', { 'Залежить від': ['BUD-16@PoC'], Дизайн: ['S-131'] }),
});
const reg = makeRegistries({
  screens: [
    { id: 'S-121', release: 'MVP', title: 'Бюджет', requirements: ['BUD-02'] },
    { id: 'S-131', release: 'PoC', title: 'Цільова сума', requirements: ['BUD-18'] },
    { id: 'S-055a', release: 'PoC', title: 'Оновити залишок', requirements: ['BUD-02'] },
  ],
});

test('build waves follow dependencies inside a release; earlier releases count as built', () => {
  const m = buildModel(corpus(files()));
  const { waves, cyclic } = buildWaves(['BUD-01@PoC', 'BUD-16@PoC', 'BUD-18@PoC'], m);
  assert.deepEqual(waves, [['BUD-01@PoC'], ['BUD-16@PoC'], ['BUD-18@PoC']]);
  assert.deepEqual(cyclic, []);
});

test('matrix, release files and coverage', () => {
  const out = renderTraceability(buildModel(corpus(files())), reg);
  assert.deepEqual([...out.keys()].sort(), ['README.md', 'coverage.md', 'matrix.md', 'release-mvp.md', 'release-poc-v2.md', 'release-poc.md', 'release-v1-mobile.md', 'release-v1.md', 'release-v2.md']);

  const matrix = out.get('matrix.md');
  assert.match(matrix, /\| \[BUD-16@PoC\]\(\.\.\/\.\.\/docs\/requirements\/bud\/BUD-16\.poc\.md\) \| PoC \| мігровано \| budget \| — \| BUD-01@PoC \| S-121 \|/);
  assert.match(matrix, /\| \[BUD-01@MVP\]\(\.\.\/\.\.\/docs\/requirements\/bud\/BUD-01\.md\) \| MVP \| не мігровано \| — \|/);

  const poc = out.get('release-poc.md');
  assert.match(poc, /```mermaid\nflowchart LR/);
  assert.match(poc, /BUD_18_PoC --> BUD_16_PoC/);
  assert.match(poc, /class BUD_01_PoC notMigrated/);
  assert.match(poc, /1\. \*\*Wave 1:\*\* BUD-01@PoC \(не мігровано\)\n2\. \*\*Wave 2:\*\* BUD-16@PoC\n3\. \*\*Wave 3:\*\* BUD-18@PoC/);
  assert.match(poc, /- BUD: BUD-02/);
  const v2 = out.get('release-poc-v2.md');
  assert.match(v2, /BUD_16_PoC_v2 -.-> BUD_16_PoC/);

  const cov = out.get('coverage.md');
  const pocCov = cov.split('## PoC v2')[0];
  assert.match(pocCov, /Screens without a slice \(1 of 2\)/);
  assert.match(pocCov, /\| S-055a \| Оновити залишок \| BUD-02 \| migration \|/);
  assert.match(cov.split('## PoC v2')[1], /Migrated slices without design \(1\)\n\n- BUD-16@PoC v2/);
  assert.match(pocCov, /Slices without acceptance criteria \(2\)\n\n- ARC-01@PoC \(не мігровано\)\n- BUD-02@PoC \(не мігровано\)/);
});

test('--traceability writes the files and removes stale ones; output is stable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-trace-'));
  const all = { ...files(), 'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02'], ['BUD-16'], ['BUD-18']]) };
  for (const [rel, text] of Object.entries(all)) {
    const p = path.join(root, 'docs/requirements', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  const dir = path.join(root, 'docs/traceability');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'release-old.md'), 'stale');
  const args = ['--root', root, '--no-baseline', '--quiet', '--traceability'];
  main(args, () => {});
  assert.ok(!fs.existsSync(path.join(dir, 'release-old.md')));
  const first = fs.readFileSync(path.join(dir, 'matrix.md'), 'utf8');
  main(args, () => {});
  assert.equal(fs.readFileSync(path.join(dir, 'matrix.md'), 'utf8'), first);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--traceability-dir: inside the root, outside docs/requirements, never a symbolic link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-trace-safe-'));
  const all = { ...files(), 'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02'], ['BUD-16'], ['BUD-18']]) };
  for (const [rel, text] of Object.entries(all)) {
    const p = path.join(root, 'docs/requirements', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  const run = (dir) => main(['--root', root, '--no-baseline', '--quiet', '--traceability', '--traceability-dir', dir], () => {});
  assert.throws(() => run('../outside'), /inside the repository root/);
  assert.throws(() => run('.'), /inside the repository root/);
  assert.throws(() => run('docs/requirements/trace'), /requirements folder/);

  // A symbolic link as the output folder, or as a parent that points elsewhere, is refused.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'req-trace-target-'));
  fs.writeFileSync(path.join(target, 'matrix.md'), 'victim');
  fs.mkdirSync(path.join(root, 'docs/links'), { recursive: true });
  fs.symlinkSync(target, path.join(root, 'docs/links/trace'));
  assert.throws(() => run('docs/links/trace'), /symbolic link/);
  fs.symlinkSync(target, path.join(root, 'docs/linked'));
  assert.throws(() => run('docs/linked/sub'), /inside the repository root/);
  assert.equal(fs.readFileSync(path.join(target, 'matrix.md'), 'utf8'), 'victim');

  // Only generated names are removed; other files stay; a symlinked generated file is not overwritten.
  const dir = path.join(root, 'docs/traceability');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.md'), 'keep');
  fs.writeFileSync(path.join(dir, 'release-old.md'), 'stale');
  run('docs/traceability');
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), 'keep');
  assert.ok(!fs.existsSync(path.join(dir, 'release-old.md')));
  fs.rmSync(path.join(dir, 'matrix.md'));
  fs.symlinkSync(path.join(target, 'matrix.md'), path.join(dir, 'matrix.md'));
  assert.throws(() => run('docs/traceability'), /not a regular file/);
  assert.equal(fs.readFileSync(path.join(target, 'matrix.md'), 'utf8'), 'victim');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});
