import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModel } from '../lib/model.mjs';
import { computeImpact, renderImpact } from '../lib/impact.mjs';
import { makeRegistries } from '../lib/registries.mjs';
import { main } from '../index.mjs';
import { corpus, req, card, slice, generalAndArc } from './helpers.mjs';

const files = {
  ...generalAndArc(),
  'bud/BUD-01.md': req('BUD-01', { release: '**Реліз:** PoC · **Пріоритет:** M' }),
  'ds/DS-01.md': req('DS-01', { release: '**Реліз:** PoC · **Пріоритет:** M' }),
  'bud/BUD-16.md': card('BUD-16', ['PoC', 'PoC v2']),
  'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['BUD-01@PoC'], Дизайн: ['S-121', 'PocPlanBudget'], 'Спільні правила': ['П-17'] }),
  'bud/BUD-16.poc-v2.md': slice('BUD-16', 'PoC v2', { Розширює: ['BUD-16@PoC'], Дизайн: ['S-125'] }),
  'bud/BUD-18.md': card('BUD-18', ['PoC']),
  'bud/BUD-18.poc.md': slice('BUD-18', 'PoC', { 'Залежить від': ['BUD-16@PoC'], Дизайн: ['S-121'], 'Спільні правила': ['DS-01'], Сценарії: ['UC-BUD-99'], Перевіряється: ['t/a.test.mjs'] }),
  'fcs/FCS-01.md': card('FCS-01', ['PoC'], { module: 'cashflow' }),
  'fcs/FCS-01.poc.md': slice('FCS-01', 'PoC', { 'Залежить від': ['BUD-18@PoC'], Модуль: ['cashflow'] }),
};
const reg = makeRegistries({
  screens: ['S-121', 'S-125'],
  useCases: ['UC-BUD-99'],
  uxDocs: [{ rel: 'docs/ux/screen-map.md', lines: ['| S-121 | screen | Бюджет | | | MVP | BUD-02, BUD-16 |', 'інше BUD-160'] }],
});
const model = buildModel(corpus(files));
const sids = (imp) => imp.slices.map((a) => a.slice.sid);

test('a slice: transitive dependents through «Залежить від» and «Розширює», with the path', () => {
  const imp = computeImpact(model, reg, 'BUD-16@PoC');
  assert.deepEqual(sids(imp), ['BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-18@PoC', 'FCS-01@PoC']);
  const fcs = imp.slices.find((a) => a.slice.sid === 'FCS-01@PoC');
  assert.equal(fcs.via, 'BUD-18@PoC');
  assert.match(fcs.why, /Залежить від/);
  assert.equal(imp.slices.find((a) => a.slice.sid === 'BUD-16@PoC v2').why, '«Розширює» BUD-16@PoC');
  assert.deepEqual(imp.tests, ['t/a.test.mjs']);
  assert.deepEqual(imp.modules, ['budget', 'cashflow']);
  assert.deepEqual(imp.useCases, ['UC-BUD-99']);
});

test('a screen or a board: slices whose «Дизайн» lists it, plus their dependents', () => {
  assert.deepEqual(sids(computeImpact(model, reg, 'S-121')), ['BUD-16@PoC', 'BUD-18@PoC', 'BUD-16@PoC v2', 'FCS-01@PoC']);
  assert.deepEqual(sids(computeImpact(model, reg, 'S-125')), ['BUD-16@PoC v2']);
  assert.deepEqual(sids(computeImpact(model, reg, 'PocPlanBudget')), ['BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-18@PoC', 'FCS-01@PoC']);
});

test('a general rule or a shared requirement: slices that cite it', () => {
  assert.deepEqual(sids(computeImpact(model, reg, 'П-17')), ['BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-18@PoC', 'FCS-01@PoC']);
  const ds = computeImpact(model, reg, 'DS-01');
  assert.equal(ds.kind, 'shared requirement');
  assert.deepEqual(sids(ds), ['BUD-18@PoC', 'DS-01@PoC', 'FCS-01@PoC']);
});

test('a requirement: all its slices; not-migrated dependents are listed; mentions in docs/ux', () => {
  const imp = computeImpact(model, reg, 'BUD-01');
  assert.deepEqual(sids(imp), ['BUD-01@PoC', 'BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-18@PoC', 'FCS-01@PoC']);
  assert.deepEqual(imp.notMigrated, ['BUD-01']);
  const imp16 = computeImpact(model, reg, 'BUD-16');
  assert.deepEqual(imp16.mentions, [{ file: 'docs/ux/screen-map.md', line: 1, ids: ['BUD-16'] }]);
  const md = renderImpact(imp16);
  assert.match(md, /^# Impact of BUD-16 \(requirement\)/);
  assert.match(md, /docs\/ux\/screen-map\.md:1 — BUD-16/);
  assert.match(md, /Release-features Google Sheet/);
  assert.match(md, /node tools\/req-check\/index\.mjs --traceability/);
});

test('a use case and a module; unknown targets return null', () => {
  assert.deepEqual(sids(computeImpact(model, reg, 'UC-BUD-99')), ['BUD-18@PoC', 'FCS-01@PoC']);
  assert.deepEqual(sids(computeImpact(model, reg, 'cashflow')), ['FCS-01@PoC']);
  for (const t of ['BUD-99', 'BUD-16@MVP', 'S-999', 'П-99', 'UC-BUD-1000', 'nomodule', '???']) assert.equal(computeImpact(model, reg, t), null, t);
});

test('CLI --impact prints the report and fails on an unknown target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-impact-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, 'docs/requirements', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  const logs = [];
  assert.equal(main(['--root', root, '--impact', 'BUD-18@PoC'], (l) => logs.push(l)), 0);
  assert.match(logs.join('\n'), /\| FCS-01@PoC \| PoC \| мігровано \| «Залежить від» BUD-18@PoC \| BUD-18@PoC \|/);
  assert.throws(() => main(['--root', root, '--impact', 'BUD-99'], () => {}), /not a known/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('docs/ux registries skip symbolic links', async () => {
  const { loadRegistries } = await import('../lib/registries.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-ux-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'req-ux-out-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'BUD-16 secret');
  fs.writeFileSync(path.join(outside, 'UC-X.md'), '## UC-BUD-500 · x');
  fs.mkdirSync(path.join(root, 'docs/ux/use-cases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/ux/use-cases/UC-BUD.md'), '## UC-BUD-99 · y');
  fs.symlinkSync(path.join(outside, 'UC-X.md'), path.join(root, 'docs/ux/use-cases/UC-X.md'));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'docs/ux/secret.md'));
  fs.symlinkSync(outside, path.join(root, 'docs/ux/dir'));
  const r = loadRegistries(root);
  assert.deepEqual([...r.useCases], ['UC-BUD-99']);
  assert.deepEqual(r.uxDocs.map((d) => d.rel), ['docs/ux/use-cases/UC-BUD.md']);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
