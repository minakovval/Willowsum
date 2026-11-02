import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCriteria, GWT_RE, explainCriterion } from '../lib/checks/criteria.mjs';
import { corpus, req, collect, rules } from './helpers.mjs';

const run = (text) => collect(checkCriteria, corpus({ 'bud/BUD-01.md': text })).list;

test('Given/When/Then with optional And is accepted', () => {
  assert.ok(GWT_RE.test('**Given** a **When** b **Then** c.'));
  assert.ok(GWT_RE.test('**Given** a **And** a2 **When** b **And** b2 **Then** c **And** d.'));
  assert.ok(!GWT_RE.test('**Given** a **Then** c **When** b.'));
  assert.ok(!GWT_RE.test('**Given** a **When** **Then** c.'));
  assert.equal(explainCriterion('**Given** a **When** b'), 'missing **Then**');
  assert.equal(explainCriterion('Given a **When** b **Then** c'), 'missing **Given**');
  assert.equal(explainCriterion('x **Given** a **When** b **Then** c'), 'must start with **Given**');
});

test('a valid file has no findings', () => {
  assert.deepEqual(run(req('BUD-01')), []);
});

test('criterion without Then is an error with its line', () => {
  const list = run(req('BUD-01', { criteria: ['1. **Given** a **When** b **Then** c.', '2. **Given** a **When** b, і c.'] }));
  assert.deepEqual(rules(list), ['criterion-format']);
  assert.equal(list[0].line, 15);
  assert.match(list[0].message, /missing \*\*Then\*\*/);
});

test('numbering must start at 1 and run without gaps', () => {
  const list = run(req('BUD-01', { criteria: ['2. **Given** a **When** b **Then** c.', '3. **Given** a **When** b **Then** c.', '5. **Given** a **When** b **Then** c.'] }));
  assert.deepEqual(
    list.map((f) => f.message.match(/numbered (\d+), expected (\d+)/).slice(1)),
    [
      ['2', '1'],
      ['5', '4'],
    ],
  );
});

test('an unnumbered line inside the section is an error; blank lines and «Припущення» are fine', () => {
  const list = run(req('BUD-01', { criteria: ['1. **Given** a **When** b **Then** c.', '', '- **Given** a **When** b **Then** c.', '2. **Given** a **When** b **Then** c.'] }));
  assert.deepEqual(rules(list), ['criterion-format']);
  const ok = run(req('BUD-01', { criteria: ['1. **Given** a **When** b **Then** c.', '', 'Припущення: значення.'] }));
  assert.deepEqual(ok, []);
});

test('a (v1-mobile) marker is allowed; a bold marker is a warning', () => {
  const list = run(req('BUD-01', { criteria: ['1. (v1-mobile) **Given** a **When** b **Then** c.', '2. **(v1-mobile)** **Given** a **When** b **Then** c.', '3. **Given** a **When** b **Then** c. (v1-mobile)'] }));
  assert.deepEqual(list.map((f) => [f.rule, f.severity]), [['criterion-marker', 'warning']]);
});

test('criteria tables (NFR style) before numbered items are skipped', () => {
  const list = run(req('BUD-01', { criteria: ['| Критерій | Поріг |', '| --- | --- |', '| A | 1 |', '', '1. **Given** a **When** b **Then** c.'] }));
  assert.deepEqual(list, []);
});

test('gaps and duplicates in the functional-requirements list are warnings', () => {
  const text = req('BUD-01').replace('2. Друга вимога.', '2. Друга.\n2. Дубль.\n4. Пропуск.');
  const list = run(text);
  assert.deepEqual(list.map((f) => [f.rule, f.severity]), [
    ['fr-numbering', 'warning'],
    ['fr-numbering', 'warning'],
  ]);
});
