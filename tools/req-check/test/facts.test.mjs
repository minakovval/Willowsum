import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkFacts, compileFacts, normValue, normAllowed, parsePlanRuns } from '../lib/checks/facts.mjs';
import { corpus, collect } from './helpers.mjs';

const registry = JSON.parse(fs.readFileSync(new URL('../facts.json', import.meta.url), 'utf8'));

const spec = {
  planOtherFeatures: 'звіт',
  facts: [
    { id: 'trash', title: 'Trash', allowed: ['30 d'], patterns: ['кошик\\S*\\s+на\\s+(?<v>\\d+)\\s*(?<u>дн[\\p{L}]*)'] },
    {
      id: 'grace',
      title: 'Grace',
      allowed: ['7 d'],
      context: '2FA',
      exclude: 'оплат',
      patterns: ['пільгов\\S*\\s+період\\S*[^.;|\\d*]{0,30}?(?<v>\\d+)\\s*(?<u>дн[\\p{L}]*)'],
    },
    { id: 'rows', title: 'Rows', allowed: ['20 000 rows'], patterns: ['стел\\S*\\s+(?<v>\\d[\\d  ]*?)\\s*(?<u>рядк[\\p{L}]*)'] },
    { id: 'members', type: 'plan', title: 'Members', allowed: { Free: '1', Plus: '2', Family: '6', Trial: '6' }, context: 'учасник' },
    { id: 'storage', type: 'plan', title: 'Storage', allowed: { Free: '1 GB', Plus: '25 GB', Family: '100 GB', Trial: '100 GB' }, context: 'сховищ' },
  ],
};

const run = (files, s = spec) => collect(checkFacts, corpus(files), s);

test('values and units are normalised', () => {
  assert.equal(normValue('20 000', 'рядків'), '20000 rows');
  assert.equal(normValue('1 500', 'м'), '1500 m');
  assert.equal(normValue('7', 'днів'), '7 d');
  assert.equal(normValue('3', 'робочі'), '3 bd');
  assert.equal(normValue('15', 'хв'), '15 min');
  assert.equal(normValue('без ліміту'), '∞');
  assert.equal(normAllowed('20 000 rows'), '20000 rows');
  assert.equal(normAllowed('100 GB'), '100 GB');
});

test('a different value is an error with file:line; the canonical value passes', () => {
  const { list, result } = run({ 'doc/DOC-01.md': '# DOC-01 · T\n\nДокумент іде в кошик на 30 днів.\nАктив іде в кошик на 14 днів.' });
  assert.equal(list.length, 1);
  assert.equal(list[0].rule, 'fact-mismatch');
  assert.equal(list[0].line, 4);
  assert.equal(list[0].file, 'docs/requirements/doc/DOC-01.md');
  assert.match(list[0].message, /found "14 днів" \(14 d\), canonical 30 d/);
  assert.equal(result.stats.get('trash').mentions, 2);
});

test('fact context and exclude limit where a pattern applies', () => {
  const { list } = run({
    'a/A-01.md': '# A-01 · T\n2FA: пільговий період 9 днів.\nПідписка: пільговий період 14 днів після несплати оплати.\nПільговий період 5 днів.',
  });
  assert.deepEqual(list.map((f) => f.line), [2]);
});

test('an example age ("… 25 днів тому") is not a rule', () => {
  const { list } = run({ 'a/A-01.md': '# A-01 · T\nАктив іде в кошик на 25 днів тому.' });
  assert.deepEqual(list, []);
});

test('numbers with thin spaces are compared as numbers', () => {
  const { list } = run({ 'a/A-01.md': '# A-01 · T\nстеля 20 000 рядків; стеля 25 000 рядків.' });
  assert.equal(list.length, 1);
  assert.match(list[0].message, /25000 rows/);
});

test('plan runs bind a value to the plans listed right before it', () => {
  const runs = parsePlanRuns('Free 25, Plus, Family і Trial без ліміту; Free 1 / Plus 2 / Family 6 / Trial 6');
  assert.deepEqual(
    runs.map((r) => r.assignments.map((a) => `${a.plan}=${a.value}`)),
    [['Free=25', 'Plus=∞', 'Family=∞', 'Trial=∞', 'Free=1', 'Plus=2', 'Family=6', 'Trial=6']],
  );
  assert.deepEqual(parsePlanRuns('Free 1 ГБ, Family 100 ГБ (Trial — як Family)')[0].assignments.map((a) => a.value), ['1 GB', '100 GB']);
  assert.deepEqual(parsePlanRuns('глибина історії Free — 3 міс.'), []);
  assert.deepEqual(parsePlanRuns('Trial дає права Family на 14 днів'), []);
});

test('plan limits in prose and plan-matrix tables are checked against the nearest feature', () => {
  const text = [
    '# A-01 · T',
    'Ліміт учасників: Free 1, Plus 3, Family 6.',
    'Сховище документів: Free 1 ГБ, Plus 25 ГБ, Family 100 ГБ; звіти — Free 2 звіти.',
    '',
    '| Функція | Free | Plus | Family / Trial |',
    '| --- | --- | --- | --- |',
    '| Учасники простору | 1 | 2 | 5 |',
  ].join('\n');
  const { list } = run({ 'a/A-01.md': text });
  assert.deepEqual(
    list.map((f) => [f.line, f.id.split(':').slice(2).join(':')]),
    [
      [2, 'members:Plus=3'],
      [7, 'members:Family=5'],
      [7, 'members:Trial=5'],
    ],
  );
});

test('facts.json compiles and every fact has a title, sources and allowed values', () => {
  const facts = compileFacts(registry);
  assert.ok(facts.length >= 30);
  const ids = new Set();
  for (const f of registry.facts) {
    assert.ok(!ids.has(f.id), `duplicate fact id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.title && f.sources?.length, `${f.id} needs title and sources`);
    if (f.type === 'plan') assert.ok(f.context && Object.keys(f.allowed).length);
    else {
      assert.ok(f.allowed.length && f.patterns.length, `${f.id} needs allowed values and patterns`);
      for (const p of f.patterns) assert.match(typeof p === 'string' ? p : p.re, /\(\?<v>/, `${f.id}: pattern without (?<v>…)`);
    }
  }
});

test('registry detects a wrong value in each family of facts', () => {
  const text = [
    '# X-01 · T',
    'Відкат імпорту доступний 5 днів.',
    'Веб-сесія завершується після 30 хв бездіяльності за замовчуванням.',
    'Технічні стелі: файл до 50 МБ; до 10 000 рядків у файлі; до 90 с на розбір файлу.',
    'Ціна застаріла, якщо не оновлювалась понад 5 робочих днів.',
    'Інші ролі бачать місто і зону радіусом 1 000 м.',
    'RPO — не більше 60 хв; RTO — не більше 8 год.',
    'Кількість активів, ключ `assets.count`: Free 10, Plus без ліміту.',
  ].join('\n');
  const { list } = run({ 'x/X-01.md': text }, registry);
  const found = list.map((f) => f.id.replace('fact-mismatch:docs/requirements/x/X-01.md:', '')).sort();
  assert.deepEqual(found, [
    'ceiling-file-size=50 MB',
    'ceiling-parse-time=90 s',
    'ceiling-rows=10000 rows',
    'import-rollback=5 d',
    'map-zone=1000 m',
    'plan-assets:Free=10',
    'rpo=60 min',
    'rto=8 h',
    'stale-price=5 bd',
    'web-inactivity=30 min',
  ]);
});
