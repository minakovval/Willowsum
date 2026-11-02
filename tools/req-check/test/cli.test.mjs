import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, parseArgs } from '../index.mjs';
import { applyBaseline, makeBaseline } from '../lib/baseline.mjs';
import { Findings } from '../lib/findings.mjs';
import { req, readme } from './helpers.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-check-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, 'docs/requirements', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

const quiet = () => {};

test('repeated findings get unique ids', () => {
  const out = new Findings();
  out.add({ check: 'c', rule: 'r', file: 'f', key: 'k', message: 'm' });
  out.add({ check: 'c', rule: 'r', file: 'f', key: 'k', message: 'm' });
  assert.deepEqual(out.list.map((f) => f.id), ['r:f:k', 'r:f:k#2']);
});

test('baseline downgrades known errors and reports stale entries', () => {
  const findings = [
    { id: 'a', severity: 'error' },
    { id: 'b', severity: 'error' },
    { id: 'w', severity: 'warning' },
  ];
  const { findings: res, stale } = applyBaseline(findings, { findings: [{ id: 'a' }, { id: 'gone' }, { id: 'w' }] });
  assert.deepEqual(res.map((f) => [f.id, !!f.baselined]), [
    ['a', true],
    ['b', false],
    ['w', false],
  ]);
  assert.deepEqual(stale, ['gone', 'w']);
  assert.deepEqual(makeBaseline(findings).findings.map((f) => f.id), ['a', 'b']);
});

test('CLI exits 1 on errors, 0 once they are baselined, and writes a report', () => {
  const root = fixture({
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02']]),
    'bud/BUD-01.md': req('BUD-01', { body: 'Як у BUD-02.' }),
    'bud/BUD-02.md': req('BUD-02'),
  });
  const baseline = path.join(root, 'baseline.json');
  const report = 'out/report.md';
  const logs = [];
  assert.equal(main(['--root', root, '--baseline', baseline], (l) => logs.push(l)), 1);
  assert.ok(logs.some((l) => l.includes('BUD-01.md:11 [foreign-id]')));

  assert.equal(main(['--root', root, '--baseline', baseline, '--update-baseline'], quiet), 0);
  assert.equal(JSON.parse(fs.readFileSync(baseline, 'utf8')).findings.length, 1);

  assert.equal(main(['--root', root, '--baseline', baseline, '--report', report], quiet), 0);
  const md = fs.readFileSync(path.join(root, report), 'utf8');
  assert.match(md, /^# Requirements check report/);
  assert.match(md, /\*\*Result: PASS\*\*/);
  assert.match(md, /Baselined errors \(1\)/);
  assert.match(md, /\| BUD \| 2 \| 2 \|/);

  // A new error fails even with a baseline.
  fs.writeFileSync(path.join(root, 'docs/requirements/bud/BUD-02.md'), req('BUD-02').replace('# BUD-02', '# BUD-09'));
  assert.equal(main(['--root', root, '--baseline', baseline], quiet), 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown options are rejected', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.equal(parseArgs(['--report', 'r.md']).report, 'r.md');
});
