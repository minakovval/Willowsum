import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSelfContained } from '../lib/checks/self-contained.mjs';
import { corpus, req, collect, rules } from './helpers.mjs';

const run = (files) => collect(checkSelfContained, corpus(files)).list;

test('another requirement ID in a body is an error with file:line; the own ID is fine', () => {
  const list = run({ 'bud/BUD-01.md': req('BUD-01', { body: 'Як у BUD-03 і AST-14a; сама BUD-01.' }) });
  assert.deepEqual(list.map((f) => f.message.match(/"(.+?)"/)[1]), ['BUD-03', 'AST-14a']);
  assert.equal(list[0].line, 11);
  assert.equal(list[0].rule, 'foreign-id');
});

test('technical identifiers and look-alikes are not requirement IDs', () => {
  const list = run({ 'fin/FIN-07.md': req('FIN-07', { body: 'UTF-16, ERC-20, BIP-39, SHA-256, AES-256-GCM, ISO 4217, X-REQ-01.' }) });
  assert.deepEqual(list, []);
});

test('00-general.md and READMEs may cite requirement IDs', () => {
  const list = run({ '00-general.md': 'MVP: BUD-01…20', 'bud/README.md': '| [BUD-01](BUD-01.md) | x |' });
  assert.deepEqual(list, []);
});

test('forbidden words are errors in every file', () => {
  const list = run({
    'bud/BUD-01.md': req('BUD-01', { body: 'Джерело: KAN-12, BR-7, Confluence, jira, PRD, ADR-0003, див. розділ, ціна 10 USD.' }),
    'bud/README.md': 'Посилання на Confluence.',
  });
  // KAN-12 also has the shape of a requirement ID.
  assert.deepEqual(rules(list), [...Array(9).fill('forbidden-word'), 'foreign-id']);
});

test('USDT, ADR without dash and «Дивіденди» are allowed', () => {
  const list = run({ 'cry/CRY-01.md': req('CRY-01', { body: 'Пара BTC/USDT; ADR як документ; Дивіденди; дивитися.' }) });
  assert.deepEqual(list, []);
});

test('"$" is an error in prose and a warning inside a code span', () => {
  const list = run({ 'bud/BUD-01.md': req('BUD-01', { body: 'Ціна $10. Шаблон `${amount}`.' }) });
  assert.deepEqual(
    list.map((f) => [f.rule, f.severity]),
    [
      ['forbidden-word', 'error'],
      ['dollar-in-code', 'warning'],
    ],
  );
});
