import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks } from '../lib/checks/links.mjs';
import { checkSelfContained } from '../lib/checks/self-contained.mjs';
import { parseLinkBlock, releasesOf } from '../lib/links.mjs';
import { parseScreenMap, parseUseCases, parseGeneralRules, parseModuleCatalogue, makeRegistries } from '../lib/registries.mjs';
import { buildModel } from '../lib/model.mjs';
import { corpus, req, card, slice, generalAndArc, collect, rules } from './helpers.mjs';

const REG = makeRegistries({ screens: ['S-121', 'S-131'], useCases: ['UC-BUD-15'], files: ['tools/x.test.mjs'] });
const run = (files, reg = REG) => collect(checkLinks, corpus({ ...generalAndArc(), ...files }), reg).list;

test('link header syntax: fields, IDs, «—» for empty, backticks stripped', () => {
  const b = parseLinkBlock(['# X', '', "**Зв'язки**", '- Розширює: —', '- Залежить від: BUD-01@PoC, BUD-02@PoC v2', '- Перевіряється: `a/b.test.mjs`', '', 'text']);
  assert.equal(b.start, 2);
  assert.equal(b.end, 6);
  assert.deepEqual(b.fields.map((f) => [f.name, f.values]), [
    ['Розширює', []],
    ['Залежить від', ['BUD-01@PoC', 'BUD-02@PoC v2']],
    ['Перевіряється', ['a/b.test.mjs']],
  ]);
  assert.deepEqual(b.problems, []);
  assert.equal(parseLinkBlock(['# X']), null);
  assert.equal(parseLinkBlock(["**Зв'язки**", '- Дизайн:']).problems.length, 1);
});

test('releases of a «Реліз» line: segments, «решта — MVP», foundation is not a slice, Сейф is MVP', () => {
  assert.deepEqual(releasesOf('PoC (лише A; і B); PoC v2 (C); решта — MVP').releases, ['PoC', 'PoC v2', 'MVP']);
  assert.deepEqual(releasesOf('MVP; основа в архітектурі й моделі даних — PoC (сутність)'), { releases: ['MVP'], foundation: 'PoC' });
  assert.deepEqual(releasesOf('MVP (ручні); v1 — решта back office').releases, ['MVP', 'v1']);
  assert.deepEqual(releasesOf('PoC; PDF і скани — MVP').releases, ['PoC', 'MVP']);
  assert.deepEqual(releasesOf('Сейф').releases, ['MVP']);
  assert.deepEqual(releasesOf('').releases, []);
});

test('registries: screen map rows, use cases, П-rules, module catalogue', () => {
  const sm = parseScreenMap(['| S-121 | screen | Бюджет | /b | Планування | MVP | BUD-02, BUD-16 | E | Ow |', '| S-170 Імпорт | вхід | x |', '| S-131 | popover | Ціль | — | П | PoC | BUD-18 | ERR | Ow |']);
  assert.deepEqual([...sm.keys()], ['S-121', 'S-131']);
  assert.deepEqual(sm.get('S-121').requirements, ['BUD-02', 'BUD-16']);
  assert.equal(sm.get('S-131').release, 'PoC');
  assert.deepEqual([...parseUseCases(['| UC-BUD-15 | x |\n## UC-BUD-99 · y'])], ['UC-BUD-15', 'UC-BUD-99']);
  const g = generalAndArc(5, ['budget']);
  assert.deepEqual([...parseGeneralRules(g['00-general.md'].split('\n'))], ['П-1', 'П-2', 'П-3', 'П-4', 'П-5']);
  assert.deepEqual([...parseModuleCatalogue(g['arc/ARC-01.md'].split('\n'))], ['budget']);
});

test('a consistent card with slices produces no findings', () => {
  const list = run({
    'bud/BUD-01.md': req('BUD-01', { release: '**Реліз:** PoC; решта — MVP · **Пріоритет:** M' }),
    'bud/BUD-16.md': card('BUD-16', ['PoC', 'PoC v2']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['BUD-01@PoC'], Дизайн: ['S-121', 'PocPlanBudget'], 'Спільні правила': ['П-17', 'ARC-01'], Сценарії: ['UC-BUD-15'], Перевіряється: ['tools/x.test.mjs'] }),
    'bud/BUD-16.poc-v2.md': slice('BUD-16', 'PoC v2', { Розширює: ['BUD-16@PoC'], 'Залежить від': ['BUD-01@PoC'] }),
  });
  assert.deepEqual(list, []);
});

test('unknown IDs in every field are errors', () => {
  const list = run({
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', {
      'Залежить від': ['BUD-77@PoC', 'BUD-16'],
      Дизайн: ['S-999', 'bad name'],
      'Спільні правила': ['П-99', 'DS-42'],
      Сценарії: ['UC-BUD-77'],
      Модуль: ['nope'],
      Перевіряється: ['missing.test.mjs'],
    }),
  });
  assert.deepEqual(rules(list), ['depends-needs-release', 'link-unknown-id', 'link-unknown-id', 'link-unknown-module', 'link-unknown-rule', 'link-unknown-screen', 'link-unknown-test', 'link-unknown-use-case', 'link-wrong-field'].sort());
});

test('a slice must not depend on a later release, nor on a superseded slice', () => {
  const list = run({
    'fin/FIN-01.md': req('FIN-01', { release: '**Реліз:** PoC; PoC v2; решта — MVP · **Пріоритет:** M' }),
    'bud/BUD-16.md': card('BUD-16', ['PoC', 'PoC v2']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['FIN-01@MVP'] }),
    'bud/BUD-16.poc-v2.md': slice('BUD-16', 'PoC v2', { Розширює: ['BUD-16@PoC'], 'Залежить від': ['FIN-01@PoC'] }),
  });
  assert.deepEqual(rules(list), ['depends-later-release', 'depends-stale-slice']);
  assert.match(list.find((f) => f.rule === 'depends-stale-slice').message, /in effect is FIN-01@PoC v2/);
});

test('dependency cycles are detected once', () => {
  const list = run({
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['BUD-18@PoC'] }),
    'bud/BUD-18.md': card('BUD-18', ['PoC']),
    'bud/BUD-18.poc.md': slice('BUD-18', 'PoC', { 'Залежить від': ['BUD-16@PoC'] }),
  });
  assert.deepEqual(rules(list), ['depends-cycle']);
  assert.match(list[0].message, /BUD-16@PoC → BUD-18@PoC → BUD-16@PoC/);
});

test('«Розширює» must be exactly the previous slice of the same requirement', () => {
  const list = run({
    'bud/BUD-16.md': card('BUD-16', ['PoC', 'MVP', 'v1']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { Розширює: ['BUD-16@MVP'] }),
    'bud/BUD-16.mvp.md': slice('BUD-16', 'MVP'),
    'bud/BUD-16.v1.md': slice('BUD-16', 'v1', { Розширює: ['BUD-16@PoC'] }),
  });
  assert.deepEqual(rules(list), ['extends-invalid', 'extends-invalid', 'extends-invalid']);
  assert.match(list[2].message, /exactly BUD-16@MVP/);
});

test('card checks: slices list, release line, body, heading and release line of slices', () => {
  const c = card('BUD-16', ['PoC', 'PoC v2']).replace('- Зрізи: BUD-16@PoC, BUD-16@PoC v2', '- Зрізи: BUD-16@PoC') + '\n**Критерії приймання**\n1. **Given** a **When** b **Then** c.\n';
  const list = run({
    'bud/BUD-16.md': c,
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC').replace('# BUD-16@PoC · Назва', '# BUD-16@PoC · Інша'),
    'bud/BUD-16.mvp.md': slice('BUD-16', 'MVP', { Розширює: ['BUD-16@PoC'] }).replace('**Пріоритет:** S', '**Пріоритет:** M'),
  });
  assert.deepEqual(rules(list), ['card-body', 'card-release', 'card-slices', 'slice-heading', 'slice-release']);
});

test('slices need a card; link fields must be complete and in order, right after the release line', () => {
  const list = run({
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-01.poc.md': slice('BUD-01', 'PoC'),
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC').replace('- Сценарії: —\n', '').replace("**Зв'язки**", "**Мета.** Раніше.\n\n**Зв'язки**"),
  });
  assert.deepEqual(rules(list), ['link-block-position', 'link-fields', 'slice-without-card']);
});

test('shared rules: only shared areas, available by the slice release', () => {
  const list = run({
    'nfr/NFR-13.md': req('NFR-13', { release: '**Реліз:** v1-mobile · **Пріоритет:** M' }),
    'bud/BUD-01.md': req('BUD-01', { release: '**Реліз:** PoC · **Пріоритет:** M' }),
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Спільні правила': ['NFR-13', 'BUD-01', 'ARC-01'] }),
  });
  assert.deepEqual(rules(list), ['shared-later-release', 'shared-not-shared']);
});

test('«Модуль» may be empty only in shared areas', () => {
  const list = run({
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { Модуль: [] }),
    'prc/PRC-01.md': card('PRC-01', ['PoC'], { module: '—' }),
    'prc/PRC-01.poc.md': slice('PRC-01', 'PoC', { Модуль: [] }),
  });
  assert.deepEqual(rules(list), ['link-module-missing']);
  assert.match(list[0].file, /BUD-16\.poc\.md$/);
});

test('IDs are allowed in the link header but not in the body of cards and slices', () => {
  const c = corpus({
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC', { 'Залежить від': ['BUD-02@PoC'] }, { body: 'Як у BUD-03; файл BUD-16.poc.md.' }),
  });
  const list = collect(checkSelfContained, c).list;
  assert.deepEqual(list.map((f) => [f.rule, f.message.match(/"(.+?)"/)[1]]), [['foreign-id', 'BUD-03']]);
});

test('not-migrated files become implicit slices; slice files are not requirements', () => {
  const m = buildModel(corpus({
    'bud/BUD-01.md': req('BUD-01', { release: '**Реліз:** PoC (A); решта — MVP · **Пріоритет:** M' }),
    'scr/SCR-01.md': req('SCR-01', { release: null }),
    'bud/BUD-16.md': card('BUD-16', ['PoC']),
    'bud/BUD-16.poc.md': slice('BUD-16', 'PoC'),
  }));
  assert.deepEqual([...m.slices.keys()].sort(), ['BUD-01@MVP', 'BUD-01@PoC', 'BUD-16@PoC']);
  assert.equal(m.slices.get('BUD-01@PoC').explicit, false);
  assert.equal(m.slices.get('BUD-16@PoC').explicit, true);
  assert.equal(m.slices.get('BUD-16@PoC').criteria, 1);
  assert.equal(m.features.get('SCR-01').releases.length, 0);
});
