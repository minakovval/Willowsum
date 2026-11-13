import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTag, formatTag, splitTag, joinTag, numberLines, parseSource, renderViews, viewReleases, convertToSource, convertRequirement, viewHeader, SOURCE_MARKER } from '../lib/source.mjs';
import { moveItems } from '../lib/move.mjs';
import { itemsOf } from '../lib/items.mjs';
import { findMentions, computeCoverage, renderCoverage, danglingMentions, IGNORE_MENTION } from '../lib/coverage.mjs';
import { runChecks } from '../lib/run.mjs';
import { makeRegistries } from '../lib/registries.mjs';
import { main } from '../index.mjs';
import { corpus, card, readme, generalAndArc, rules } from './helpers.mjs';

/** A slice with the given FR, AC and edge-case lines and link fields. */
function sliceText(id, release, { ext = '—', dep = '—', fr, ac, ec = ['- Випадок.'], purpose = 'Як користувач, я хочу щось.' }) {
  return [
    `# ${id}@${release} · Назва`,
    '',
    `**Реліз:** ${release} · **Пріоритет:** S`,
    '',
    "**Зв'язки**",
    `- Розширює: ${ext}`,
    `- Залежить від: ${dep}`,
    '- Дизайн: —',
    '- Спільні правила: —',
    '- Сценарії: —',
    '- Модуль: budget',
    '- Перевіряється: —',
    '',
    `**Мета.** ${purpose}`,
    '',
    '**Функціональні вимоги**',
    ...fr.map((t, i) => `${i + 1}. ${t}`),
    '',
    '**Критерії приймання**',
    ...ac.map((t, i) => `${i + 1}. **Given** ${t} **When** дія **Then** результат.`),
    '',
    '**Граничні випадки**',
    ...ec,
    '',
  ].join('\n');
}

const CARD = card('BUD-16', ['PoC', 'PoC v2', 'MVP']);
const SLICES = [
  { release: 'PoC', text: sliceText('BUD-16', 'PoC', { fr: ['Перша вимога.', 'Лише в PoC «Ліміти».', 'Третя вимога.'], ac: ['умова А'] }) },
  { release: 'PoC v2', text: sliceText('BUD-16', 'PoC v2', { ext: 'BUD-16@PoC', dep: 'BUD-01@PoC v2', fr: ['Перша вимога.', 'Третя вимога.', 'Нова в PoC v2.'], ac: ['умова А', 'умова Б'] }) },
  { release: 'MVP', text: sliceText('BUD-16', 'MVP', { ext: 'BUD-16@PoC v2', dep: 'BUD-01@PoC v2', fr: ['Перша вимога, змінена в MVP.', 'Третя вимога.', 'Нова в PoC v2.'], ac: ['умова А', 'умова Б'], ec: ['- Випадок.', '- Ще випадок MVP.'], purpose: 'Як учасник, я хочу щось.' }) },
];

/** The source the converter must produce for CARD + SLICES: the format, pinned. */
const SOURCE = `${CARD}
${SOURCE_MARKER}

[лише PoC] **Реліз:** PoC · **Пріоритет:** S
[лише PoC v2] **Реліз:** PoC v2 · **Пріоритет:** S
[MVP] **Реліз:** MVP · **Пріоритет:** S

**Зв'язки**
- [лише PoC] Розширює: —
- [лише PoC] Залежить від: —
- [лише PoC v2] Розширює: BUD-16@PoC
- [MVP] Розширює: BUD-16@PoC v2
- [PoC v2] Залежить від: BUD-01@PoC v2
- Дизайн: —
- Спільні правила: —
- Сценарії: —
- Модуль: budget
- Перевіряється: —

[PoC–PoC v2] **Мета.** Як користувач, я хочу щось.
[MVP] **Мета.** Як учасник, я хочу щось.

**Функціональні вимоги**
#. [PoC–PoC v2] Перша вимога.
#. [лише PoC] Лише в PoC «Ліміти».
#. [MVP] Перша вимога, змінена в MVP.
#. [PoC] Третя вимога.
#. [PoC v2] Нова в PoC v2.

**Критерії приймання**
#. [PoC] **Given** умова А **When** дія **Then** результат.
#. [PoC v2] **Given** умова Б **When** дія **Then** результат.

**Граничні випадки**
- [PoC] Випадок.
- [MVP] Ще випадок MVP.
`;

test('release tags: R and later, R–R2, «лише R», lists; anything else is not a tag', () => {
  assert.deepEqual(parseTag('PoC v2'), ['PoC v2', 'MVP', 'v1-mobile', 'v1', 'v2']);
  assert.deepEqual(parseTag('PoC–MVP'), ['PoC', 'PoC v2', 'MVP']);
  assert.deepEqual(parseTag('лише PoC'), ['PoC']);
  assert.deepEqual(parseTag('лише PoC, MVP–v1'), ['PoC', 'MVP', 'v1-mobile', 'v1']);
  assert.equal(parseTag('MVP–PoC'), null);
  assert.equal(parseTag('PoC v3'), null);
  assert.equal(parseTag('посилання'), null);
  const views = ['PoC', 'PoC v2', 'MVP'];
  assert.equal(formatTag(views, ['PoC', 'PoC v2', 'MVP']), 'PoC');
  assert.equal(formatTag(views, ['PoC v2', 'MVP']), 'PoC v2');
  assert.equal(formatTag(views, ['PoC', 'PoC v2']), 'PoC–PoC v2');
  assert.equal(formatTag(views, ['PoC v2']), 'лише PoC v2');
  assert.equal(formatTag(views, ['PoC', 'MVP']), 'лише PoC, MVP');
  // Releases without a view between two views do not break a run.
  assert.equal(formatTag(['PoC', 'MVP', 'v1'], ['PoC', 'MVP']), 'PoC–MVP');
});

test('a tag sits after the indentation and a list marker or a table pipe; joinTag and splitTag are inverse', () => {
  const cases = [
    ['#. Перша.', '#. [PoC] Перша.'],
    ['12. Друга.', '12. [PoC] Друга.'],
    ['   - вкладене', '   - [PoC] вкладене'],
    ['| a | b |', '| [PoC] a | b |'],
    ['|  | b |', '| [PoC]  | b |'],
    ['', '[PoC]'],
    ['**Мета.** Текст.', '[PoC] **Мета.** Текст.'],
    ['[лише PoC] текст, що сам починається з тегу', '[PoC] [лише PoC] текст, що сам починається з тегу'],
  ];
  for (const [plain, tagged] of cases) {
    assert.equal(joinTag('PoC', plain), tagged);
    const s = splitTag(tagged);
    assert.deepEqual([s.text, s.tag], [plain, 'PoC']);
  }
  assert.deepEqual(splitTag('[посилання](x.md) текст'), { releases: null, text: '[посилання](x.md) текст', tag: null, bad: null });
  assert.equal(splitTag('- [PoC v3] текст').bad, 'PoC v3');
});

test('#. items are numbered per list and indentation; explicit numbers are kept', () => {
  assert.deepEqual(numberLines(['**A**', '#. a', '   - x', '#. b', '', '#. c', '**B**', '#. d', '   #. d1', '   #. d2', '#. e', '7. f', '#. g']), [
    '**A**',
    '1. a',
    '   - x',
    '2. b',
    '',
    '3. c',
    '**B**',
    '1. d',
    '   1. d1',
    '   2. d2',
    '2. e',
    '7. f',
    '8. g',
  ]);
});

test('converter: card + slices → one source with release tags (format pinned)', () => {
  assert.equal(convertToSource('BUD-16', CARD, SLICES), SOURCE);
});

test('generator: every view is the slice byte for byte, with the view header as line 2', () => {
  const src = parseSource(SOURCE);
  assert.equal(src.cardText, CARD);
  const releases = viewReleases('BUD-16', src.cardLines);
  assert.deepEqual(releases, ['PoC', 'PoC v2', 'MVP']);
  const views = renderViews('BUD-16', 'Назва', src, releases);
  for (const s of SLICES) {
    const v = views.get(s.release);
    assert.equal(v.lines[1], viewHeader('BUD-16'));
    const lines = [...v.lines];
    lines.splice(1, 1);
    assert.equal(lines.join('\n'), s.text);
    // Every view line maps to the source line it came from.
    v.lines.forEach((l, i) => {
      if (i > 1) assert.equal(splitTag(SOURCE.split('\n')[v.lineMap[i]]).text.replace(/^#\./, l.match(/^\d+\./)?.[0] ?? '#.'), l);
    });
  }
  const r = convertRequirement('BUD-16', CARD, SLICES);
  assert.equal(r.ok, true);
  assert.equal(r.source, SOURCE);
});

test('converter: renumbering that #. cannot reproduce becomes explicit numbers or per-release variants', () => {
  const odd = [
    { release: 'PoC', text: sliceText('BUD-16', 'PoC', { fr: ['А.', 'Б.'], ac: ['умова'] }).replace('2. Б.', '5. Б.') },
    { release: 'PoC v2', text: sliceText('BUD-16', 'PoC v2', { ext: 'BUD-16@PoC', fr: ['А.', 'Б.'], ac: ['умова'] }).replace('2. Б.', '7. Б.') },
    { release: 'MVP', text: sliceText('BUD-16', 'MVP', { ext: 'BUD-16@PoC v2', fr: ['А.', 'Б.'], ac: ['умова'] }).replace('2. Б.', '7. Б.') },
  ];
  const r = convertRequirement('BUD-16', CARD, odd);
  assert.equal(r.ok, true);
  assert.match(r.source, /^5\. \[лише PoC\] Б\.$/mu);
  assert.match(r.source, /^7\. \[PoC v2\] Б\.$/mu);
});

test('converter refuses what it cannot round-trip and says why', () => {
  assert.match(convertRequirement('BUD-16', CARD.trimEnd(), SLICES).reason, /newline/);
  assert.match(convertRequirement('BUD-16', CARD, SLICES.slice(0, 2)).reason, /do not match the slice files/);
  const reserved = [{ release: 'PoC', text: SLICES[0].text.replace('1. Перша', '#. Перша') }, ...SLICES.slice(1)];
  assert.match(convertRequirement('BUD-16', CARD, reserved).reason, /reserves/);
});

/** Files of a corpus where BUD-16 is a source with its generated views. */
function sourced(overrides = {}) {
  const views = convertRequirement('BUD-16', CARD, SLICES).views;
  return {
    ...generalAndArc(),
    'arc/README.md': readme('ARC', [['ARC-01', 'Модулі', 'PoC', 'M']]),
    'bud/README.md': readme('BUD', [['BUD-01', 'Назва', 'PoC v2', 'S'], ['BUD-16', 'Назва', 'PoC (обсяг); PoC v2 (обсяг); MVP (обсяг)', 'S']]),
    'bud/BUD-01.md': card('BUD-01', ['PoC v2'], { releaseText: 'PoC v2' }),
    'bud/BUD-01.poc-v2.md': sliceText('BUD-01', 'PoC v2', { fr: ['А.'], ac: ['умова'] }),
    'bud/BUD-16.md': SOURCE,
    'bud/BUD-16.poc.md': views.get('PoC'),
    'bud/BUD-16.poc-v2.md': views.get('PoC v2'),
    'bud/BUD-16.mvp.md': views.get('MVP'),
    ...overrides,
  };
}
const check = (files) => runChecks(corpus(files), { facts: [] }, makeRegistries());
const errors = (files) => check(files).findings.filter((f) => f.severity === 'error');

test('req-check reads the source: the views it generates are checked; a source in sync has no findings', () => {
  const res = check(sourced());
  assert.deepEqual(res.findings.filter((f) => f.severity === 'error'), []);
  const f = res.model.features.get('BUD-16');
  assert.deepEqual(f.slices.map((s) => s.sid), ['BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-16@MVP']);
  assert.deepEqual(f.slices[1].links.depends, ['BUD-01@PoC v2']);
  assert.equal(f.slices[2].criteria, 2);
  assert.equal(f.slices[0].doc.generated.sourceRel, 'docs/requirements/bud/BUD-16.md');
});

test('a view that differs from the source, is missing or is not listed is an error', () => {
  const stale = sourced({ 'bud/BUD-16.poc.md': sourced()['bud/BUD-16.poc.md'].replace('Третя вимога.', 'Третя вимога, правлена руками.') });
  assert.deepEqual(rules(errors(stale)), ['view-stale']);
  assert.equal(errors(stale)[0].file, 'docs/requirements/bud/BUD-16.poc.md');
  const missing = sourced();
  delete missing['bud/BUD-16.mvp.md'];
  assert.deepEqual(rules(errors(missing)), ['view-missing']);
  const extra = sourced({ 'bud/BUD-16.v1.md': sourced()['bud/BUD-16.mvp.md'] });
  assert.ok(rules(check(extra).findings).includes('view-extra'));
});

test('source lint: untagged item, invalid tag, tag that selects no view, marker without a blank line', () => {
  const src = SOURCE.replace('- [MVP] Ще випадок MVP.', '- Ще випадок без тегу.\n- [MVP v3] Помилка.\n- [v2] Ніде.');
  const files = sourced({ 'bud/BUD-16.md': src });
  const views = parseSource(src);
  const out = renderViews('BUD-16', 'Назва', views, ['PoC', 'PoC v2', 'MVP']);
  for (const [r, v] of out) files[`bud/BUD-16.${{ PoC: 'poc', 'PoC v2': 'poc-v2', MVP: 'mvp' }[r]}.md`] = v.text;
  assert.deepEqual(rules(check(files).findings.filter((f) => f.check === 'source')), ['source-item-untagged', 'source-tag-invalid', 'source-tag-no-view']);
  const glued = sourced({ 'bud/BUD-16.md': SOURCE.replace(`\n\n${SOURCE_MARKER}`, `\n${SOURCE_MARKER}`) });
  assert.ok(rules(check(glued).findings).includes('source-marker'));
});

test('a finding in a generated view points at the source line, prefixed with the slice ID', () => {
  const src = SOURCE.replace('#. [PoC v2] Нова в PoC v2.', '#. [PoC v2] Нова в PoC v2, як у FIN-07.');
  const files = sourced({ 'bud/BUD-16.md': src });
  const views = renderViews('BUD-16', 'Назва', parseSource(src), ['PoC', 'PoC v2', 'MVP']);
  files['bud/BUD-16.poc-v2.md'] = views.get('PoC v2').text;
  files['bud/BUD-16.mvp.md'] = views.get('MVP').text;
  const found = check(files).findings.filter((f) => f.rule === 'foreign-id');
  const line = src.split('\n').findIndex((l) => l.includes('FIN-07')) + 1;
  assert.deepEqual(
    found.map((f) => [f.file, f.line, f.message.split(':')[0]]).sort(),
    [
      ['docs/requirements/bud/BUD-16.md', line, 'BUD-16@MVP'],
      ['docs/requirements/bud/BUD-16.md', line, 'BUD-16@PoC v2'],
    ],
  );
});

test('--move changes the tags of an item block and regenerates only the affected views', () => {
  const res = moveItems(SOURCE, 'BUD-16', { items: ['FR3', 'AC1'], to: 'PoC v2' });
  assert.deepEqual(res.moved.map((m) => m.after), [['#. [PoC v2] Третя вимога.'], ['#. [PoC v2] **Given** умова А **When** дія **Then** результат.']]);
  assert.deepEqual(res.changed, ['PoC']);
  const views = renderViews('BUD-16', 'Назва', parseSource(res.text), ['PoC', 'PoC v2', 'MVP']);
  const poc = views.get('PoC').lines;
  assert.ok(!poc.some((l) => l.includes('Третя вимога')));
  assert.deepEqual(itemsOf(poc).map((i) => `${i.kind}${i.n}`), ['FR1', 'FR2', 'EC1']);
  // Back again: FR2 of PoC v2 starts in PoC once more, numbers follow.
  const back = moveItems(res.text, 'BUD-16', { items: ['FR2'], from: 'PoC v2', to: 'PoC' });
  assert.match(back.text, /^#\. \[PoC\] Третя вимога\.$/mu);
  assert.deepEqual(moveItems(SOURCE, 'BUD-16', { items: ['FR2'], to: 'PoC v2' }).moved[0].after, ['#. [лише PoC v2] Лише в PoC «Ліміти».']);
  assert.deepEqual(moveItems(SOURCE, 'BUD-16', { items: ['FR2'], to: 'PoC v2' }).phrases, ['Ліміти']);
  // Moving the PoC wording of FR1 into MVP puts it beside the MVP wording: reported as a likely variant.
  const dup = moveItems(SOURCE.replace('Перша вимога, змінена в MVP.', 'Перша вимога. Змінена в MVP.'), 'BUD-16', { items: ['FR1'], to: 'MVP' });
  assert.deepEqual(dup.variants.map((v) => v.release), ['MVP']);
  assert.throws(() => moveItems(SOURCE, 'BUD-16', { items: ['FR2'], to: 'v1' }), /has no v1 view/);
  assert.throws(() => moveItems(SOURCE, 'BUD-16', { items: ['FR9'], to: 'MVP' }), /has no FR9/); // req-check-ignore-mention
});

test('--move warns about cited numbers that changed and about mentions of the moved items in the same source', () => {
  const text = SOURCE.replace('#. [PoC v2] Нова в PoC v2.', '#. [PoC v2] Нова в PoC v2, як у FR 3, без «Ліміти».');
  const line = text.split('\n').findIndex((l) => l.startsWith('#. [PoC v2] Нова')) + 1;
  // «Ліміти» (only PoC, FR2) moves to only PoC v2: it leaves PoC, and in PoC v2 it becomes FR2, so the old FR2
  // and FR3 become FR3 and FR4.
  const res = moveItems(text, 'BUD-16', { items: ['FR2'], to: 'PoC v2' });
  assert.deepEqual(res.changed, ['PoC', 'PoC v2']);
  assert.deepEqual(
    res.shifts.filter((s) => s.release === 'PoC v2').map((s) => `${s.kind}${s.from}→${s.to}`),
    ['FR2→3', 'FR3→4'],
  );
  assert.deepEqual(
    res.shifts.filter((s) => s.release === 'PoC').map((s) => `${s.kind}${s.from}→${s.to}`),
    ['FR2→null', 'FR3→2'],
  );
  assert.deepEqual(
    res.citations.map((c) => [c.line, c.release, c.ref, c.to]),
    [[line, 'PoC v2', 'FR 3', 4]],
  );
  assert.deepEqual(res.selfMentions, [{ phrase: 'Ліміти', line }]);
  // Moving an item out of a view: its number is gone there, and a citation of it is reported too.
  const out = moveItems(text.replace('#. [PoC] Третя вимога.', '#. [PoC] Третя вимога, після FR 1.'), 'BUD-16', { items: ['FR1'], to: 'MVP' });
  assert.ok(out.shifts.some((s) => s.release === 'PoC' && s.kind === 'FR' && s.from === 1 && s.to === null));
  assert.ok(out.citations.some((c) => c.release === 'PoC' && c.ref === 'FR 1' && c.to === null));
  // Nothing cited, nothing mentioned: no warnings.
  const clean = moveItems(SOURCE, 'BUD-16', { items: ['FR3'], to: 'PoC v2' });
  assert.deepEqual([clean.citations, clean.selfMentions], [[], []]);
});

test('coverage: tests named by item map to source items, across renumbering, and count per release', () => {
  const mentions = findMentions([
    { rel: 'apps/a.test.ts', text: 'describe("BUD-16@PoC budget", () => {\n  it("BUD-16 FR 3, AC1: x", () => {});\n  it("BUD-16 EC1 / FR 9", () => {});\n});' }, // req-check-ignore-mention
    { rel: 'apps/b.test.ts', text: 'it("BUD-16@MVP FR1–FR2", () => {});' },
  ]);
  assert.deepEqual(
    mentions.map((m) => `${m.id}@${m.release} ${m.kind}${m.n}`),
    ['BUD-16@PoC FR3', 'BUD-16@PoC AC1', 'BUD-16@PoC EC1', 'BUD-16@PoC FR9', 'BUD-16@MVP FR1', 'BUD-16@MVP FR2'], // req-check-ignore-mention
  );
  const cov = computeCoverage(check(sourced()).model, mentions);
  const row = (sid) => cov.rows.find((r) => r.sid === sid);
  // FR 3 of PoC («Третя вимога») is FR 2 in PoC v2 and MVP: the same source line, covered there too.
  assert.deepEqual(row('BUD-16@PoC').FR, { total: 3, covered: 1, missing: ['FR1', 'FR2'] });
  assert.deepEqual(row('BUD-16@PoC v2').FR, { total: 3, covered: 1, missing: ['FR1', 'FR3'] });
  assert.deepEqual(row('BUD-16@MVP').FR, { total: 3, covered: 2, missing: ['FR3'] });
  assert.deepEqual(row('BUD-16@MVP').AC, { total: 2, covered: 1, missing: ['AC2'] });
  assert.deepEqual(cov.unresolved.map((m) => `${m.sid} ${m.kind}${m.n}`), ['BUD-16@PoC FR9']); // req-check-ignore-mention
  assert.match(renderCoverage(cov), /\| PoC \| 1 \| 1 \/ 3 \(33 %\) \| 1 \/ 1 \(100 %\)/);
});

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-check-src-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, 'docs/requirements', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

test('CLI: --convert writes the source and the views; --views regenerates; --move edits and reports', () => {
  const files = sourced({ 'bud/BUD-16.md': CARD, 'bud/BUD-16.poc.md': SLICES[0].text, 'bud/BUD-16.poc-v2.md': SLICES[1].text, 'bud/BUD-16.mvp.md': SLICES[2].text });
  // BUD-02 cannot round-trip (its card has no final newline): it stays a card with slice files.
  files['bud/README.md'] = readme('BUD', [['BUD-01', 'Назва', 'PoC v2', 'S'], ['BUD-02', 'Назва', 'PoC', 'S'], ['BUD-16', 'Назва', 'PoC (обсяг); PoC v2 (обсяг); MVP (обсяг)', 'S']]);
  files['bud/BUD-02.md'] = card('BUD-02', ['PoC'], { releaseText: 'PoC' }).trimEnd();
  files['bud/BUD-02.poc.md'] = sliceText('BUD-02', 'PoC', { fr: ['А.'], ac: ['умова'] });
  const root = fixture(files);
  const req = (rel) => path.join(root, 'docs/requirements', rel);
  const logs = [];
  const log = (l) => logs.push(l);
  const base = ['--root', root, '--no-baseline', '--quiet'];
  assert.equal(main([...base, '--convert', 'all'], log), 0);
  assert.match(logs.join('\n'), /converted 2 requirements/);
  assert.match(logs.join('\n'), /not converted .*: BUD-02 \(the card does not end with a newline\)/);
  assert.equal(fs.readFileSync(req('bud/BUD-02.poc.md'), 'utf8'), files['bud/BUD-02.poc.md']);
  assert.equal(fs.readFileSync(req('bud/BUD-16.md'), 'utf8'), SOURCE);
  assert.equal(fs.readFileSync(req('bud/BUD-16.poc.md'), 'utf8').split('\n')[1], viewHeader('BUD-16'));
  assert.equal(main(base, () => {}), 0);

  // A hand edit of a view fails; --views puts the generated text back.
  fs.writeFileSync(req('bud/BUD-16.mvp.md'), 'зіпсовано\n');
  assert.equal(main(base, () => {}), 1);
  assert.equal(main([...base, '--views'], () => {}), 0);
  assert.equal(fs.readFileSync(req('bud/BUD-16.mvp.md'), 'utf8'), convertRequirement('BUD-16', CARD, SLICES).views.get('MVP'));

  logs.length = 0;
  fs.mkdirSync(path.join(root, 'apps/web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/web/budget.test.ts'), 'it("BUD-16@PoC FR 3: третя", () => {});\nit("BUD-16 FR 1", () => {});\n');
  // The decision log, both the archive and the per-decision files in log/, quotes numbers as they were: not reported.
  const docFiles = { 'docs/plans/wave.md': 'План: BUD-16@PoC FR 3.\n', 'docs/decisions/state-2026-11-05.md': 'Архів: BUD-16@PoC FR 3.\n', 'docs/decisions/log/2026-11-13-move.md': 'Рішення: BUD-16@PoC FR 3.\n' };
  for (const [rel, text] of Object.entries(docFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  assert.equal(main([...base, '--move', 'BUD-16', '--items', 'FR3', '--to', 'PoC v2'], log), 0);
  assert.match(logs.join('\n'), /# Move BUD-16: FR3 → PoC v2/);
  assert.match(logs.join('\n'), /apps\/web\/budget\.test\.ts:1 — BUD-16@PoC FR3 is no longer in that view/);
  assert.doesNotMatch(logs.join('\n'), /budget\.test\.ts:2/);
  assert.match(logs.join('\n'), /docs\/plans\/wave\.md:1 — BUD-16@PoC FR3 is no longer in that view/);
  assert.doesNotMatch(logs.join('\n'), /docs\/decisions\//);
  assert.match(logs.join('\n'), /Views changed: BUD-16@PoC \(regenerated\)/);
  assert.ok(!fs.readFileSync(req('bud/BUD-16.poc.md'), 'utf8').includes('Третя вимога'));
  assert.equal(main(base, () => {}), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--check-mentions fails on a test that names an item its view does not have, with file:line', () => {
  const root = fixture(sourced());
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const base = ['--root', root, '--no-baseline', '--quiet'];
  // Only existing items, a table criterion named by its words and a marked fixture line: passes.
  write('apps/web/ok.test.ts', ['it("BUD-16@PoC FR 3: третя", () => {});', 'it("BUD-16 criterion «Поріг»", () => {});', `const fixture = "BUD-16 FR 9"; // ${IGNORE_MENTION}`, ''].join('\n')); // req-check-ignore-mention
  let logs = [];
  assert.equal(main([...base, '--check-mentions'], (l) => logs.push(l)), 0);
  assert.match(logs.join('\n'), /0 test mentions name no item/);
  // FR 9 and AC 7 do not exist in BUD-16@PoC: exit 1, each reported once with its file and line.
  write('packages/ui/bad.test.ts', ['// header', 'it("BUD-16@PoC FR 9, FR 9: x", () => {});', 'it("BUD-16 AC7", () => {});', ''].join('\n')); // req-check-ignore-mention
  logs = [];
  assert.equal(main([...base, '--check-mentions'], (l) => logs.push(l)), 1);
  const errors = logs.filter((l) => l.startsWith('ERROR '));
  assert.deepEqual(errors.map((l) => l.split(' [')[0]), ['ERROR packages/ui/bad.test.ts:2', 'ERROR packages/ui/bad.test.ts:3']);
  assert.match(errors[0], /\[mention-no-item\] BUD-16@PoC has no FR9/); // req-check-ignore-mention
  assert.match(errors[1], /BUD-16@PoC has no AC7/); // req-check-ignore-mention
  assert.match(logs.at(-1), /2 test mentions name no item/);
  // In GitHub Actions each one is also an error annotation on that line.
  const prev = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  try {
    logs = [];
    main([...base, '--check-mentions'], (l) => logs.push(l));
    assert.ok(logs.some((l) => l.startsWith('::error file=packages/ui/bad.test.ts,line=2,title=req-check mention-no-item::BUD-16@PoC has no FR9'))); // req-check-ignore-mention
  } finally {
    if (prev === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = prev;
  }
  // --coverage alone still only lists them and exits 0.
  assert.equal(main([...base, '--coverage'], () => {}), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('danglingMentions: one finding per file, line and item; a marked line is not read at all', () => {
  const mentions = findMentions([{ rel: 'a.test.ts', text: `it("BUD-16@PoC FR 9 FR 9 AC1")\nit("BUD-16@PoC FR 9") // ${IGNORE_MENTION}` }]); // req-check-ignore-mention
  assert.deepEqual(mentions.map((m) => `${m.line} ${m.kind}${m.n}`), ['1 FR9', '1 FR9', '1 AC1']);
  const d = danglingMentions(computeCoverage(check(sourced()).model, mentions));
  assert.deepEqual(d.map((f) => `${f.file}:${f.line} ${f.rule}`), ['a.test.ts:1 mention-no-item']);
});

test('items: FR n of a text without a «Функціональні вимоги» label is item n of its first numbered list', () => {
  const lines = ['# ARC-05@PoC · Назва', '', '**Реліз:** PoC', '', "**Зв'язки**", '- Модуль: —', '', 'Вступ.', '', '1. Перше.', '2. Друге.', '   продовження', '', '| a | b |', '', '**Критерії приймання**', '1. **Given** а **When** б **Then** в.'];
  assert.deepEqual(itemsOf(lines).map((i) => [`${i.kind}${i.n}`, i.index, i.end]), [
    ['FR1', 9, 10],
    ['FR2', 10, 12],
    ['AC1', 16, 17],
  ]);
});

test('--impact on a source names the source to edit, not the generated views', async () => {
  const { computeImpact } = await import('../lib/impact.mjs');
  const imp = computeImpact(check(sourced()).model, makeRegistries(), 'BUD-16@PoC');
  assert.deepEqual(imp.slices.map((a) => a.slice.sid), ['BUD-16@PoC', 'BUD-16@PoC v2', 'BUD-16@MVP']);
  assert.ok(imp.files.includes('docs/requirements/bud/BUD-16.md'));
  assert.ok(!imp.files.some((f) => /BUD-16\.(poc|poc-v2|mvp)\.md$/.test(f)));
});
