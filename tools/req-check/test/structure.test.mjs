import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStructure } from '../lib/checks/structure.mjs';
import { corpus, req, readme, collect, rules } from './helpers.mjs';

test('a consistent module produces no structure findings', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-02.md': req('BUD-02'),
  });
  assert.deepEqual(collect(checkStructure, c).list, []);
});

test('heading must be "# <ID> · <title>" with the file ID', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02']]),
    'bud/BUD-01.md': req('BUD-01').replace('# BUD-01 · Назва', '# BUD-03 · Назва'),
    'bud/BUD-02.md': req('BUD-02').replace('# BUD-02 · Назва', 'BUD-02 Назва'),
  });
  const { list } = collect(checkStructure, c);
  assert.deepEqual(rules(list), ['heading', 'heading']);
  assert.equal(list[0].line, 1);
  assert.match(list[0].message, /does not match file name BUD-01/);
});

test('file name must be an ID and live in its module folder', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-1.md': req('BUD-1'),
    'bud/FIN-02.md': req('FIN-02'),
  });
  const r = rules(collect(checkStructure, c).list);
  assert.ok(r.includes('file-name'));
  assert.ok(r.includes('file-folder'));
});

test('duplicate IDs across folders are reported for every copy', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01']]),
    'bud/BUD-01.md': req('BUD-01'),
    'fin/README.md': readme('FIN', [['BUD-01']]),
    'fin/BUD-01.md': req('BUD-01'),
  });
  const dup = collect(checkStructure, c).list.filter((f) => f.rule === 'duplicate-id');
  assert.equal(dup.length, 2);
});

test('README must list exactly the files present', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-03']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-02.md': req('BUD-02'),
  });
  const { list } = collect(checkStructure, c);
  assert.deepEqual(rules(list), ['readme-extra', 'readme-missing']);
  assert.ok(list.every((f) => f.severity === 'error'));
});

test('README title or release that differs from the file is a warning', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01', 'Інша назва', 'v1', 'S']]),
    'bud/BUD-01.md': req('BUD-01'),
  });
  const { list } = collect(checkStructure, c);
  assert.deepEqual(rules(list), ['readme-release', 'readme-title']);
  assert.ok(list.every((f) => f.severity === 'warning'));
});

test('module folder without README is an error', () => {
  const c = corpus({ 'bud/BUD-01.md': req('BUD-01') });
  assert.deepEqual(rules(collect(checkStructure, c).list), ['readme-absent']);
});

test('index README rows are checked against folders and counts', () => {
  const index = [
    '## Modules (3 requirements)',
    '',
    '| Code | Folder | Scope | Requirements | Release mix |',
    '| --- | --- | --- | --- | --- |',
    '| BUD | [bud/](bud/README.md) | Budget | 2 | MVP 1 |',
    '| OLD | [old/](old/README.md) | Gone | 1 | MVP 1 |',
  ].join('\n');
  const c = corpus({
    'README.md': index,
    'bud/README.md': readme('BUD', [['BUD-01']]),
    'bud/BUD-01.md': req('BUD-01'),
    'fin/README.md': readme('FIN', [['FIN-01']]),
    'fin/FIN-01.md': req('FIN-01'),
  });
  const r = rules(collect(checkStructure, c).list);
  assert.deepEqual(r, ['index-count', 'index-extra', 'index-missing', 'index-total']);
});

test('misnamed or nested markdown files are reported, not silently skipped', () => {
  const c = corpus({
    'bud/README.md': readme('BUD', [['BUD-01']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/bud-99.md': req('BUD-99'),
    'bud/sub/BUD-97.md': req('BUD-97'),
  });
  const { list } = collect(checkStructure, c);
  const unexpected = list.filter((f) => f.rule === 'unexpected-file').map((f) => f.file).sort();
  assert.equal(unexpected.length, 2);
  assert.ok(unexpected.some((f) => f.endsWith('bud/bud-99.md')));
  assert.ok(unexpected.some((f) => f.endsWith('bud/sub/BUD-97.md')));
});
