import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../lib/checks/release.mjs';
import { checkStructure } from '../lib/checks/structure.mjs';
import { mainRelease, mainPriority, parseReleaseLine } from '../lib/release.mjs';
import { Findings } from '../lib/findings.mjs';
import { corpus, req, readme, rules } from './helpers.mjs';

function run(files) {
  const c = corpus(files);
  const out = new Findings();
  const { readmeRows } = checkStructure(c, new Findings());
  const result = checkRelease(c, out, readmeRows);
  return { list: out.list, result };
}

test('main release is the first token; v1-mobile is not v1; quotes are stripped', () => {
  assert.equal(mainRelease('MVP'), 'MVP');
  assert.equal(mainRelease('v1-mobile'), 'v1-mobile');
  assert.equal(mainRelease('v1 (дані з пристрою iPhone — v1-mobile)'), 'v1');
  assert.equal(mainRelease('«Сейф» (веб); офлайн — v1-mobile.'), 'Сейф');
  assert.equal(mainRelease('v2.'), 'v2');
  assert.equal(mainRelease('PoC'), 'PoC');
  assert.equal(mainRelease('PoC v2 (фото камерою — v1-mobile)'), 'PoC v2');
  assert.equal(mainRelease('PoC (лише CSV); решта — MVP'), 'PoC');
  assert.equal(mainRelease('PoCx'), null);
  assert.equal(mainRelease('MVPx'), null);
  assert.equal(mainRelease('поза обсягом (далі не раніше v2)'), null);
  assert.equal(mainPriority('M (критичний для запуску)'), 'M');
  assert.equal(mainPriority('X'), null);
});

test('release line is parsed with and without a priority', () => {
  const p = parseReleaseLine(['# A-01 · T', '', '**Реліз:** Сейф (push — v1-mobile) · **Пріоритет:** S']);
  assert.deepEqual(p, { line: 3, releaseText: 'Сейф (push — v1-mobile)', priorityText: 'S', release: 'Сейф', priority: 'S' });
  const q = parseReleaseLine(['# A-01 · T', '', '**Реліз:** v2.']);
  assert.equal(q.priorityText, null);
  assert.equal(q.release, 'v2');
});

test('missing, invalid release and invalid priority are errors', () => {
  const { list } = run({
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02', 'Назва', 'Later', 'M'], ['BUD-03', 'Назва', 'MVP', 'Z'], ['BUD-04']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-02.md': req('BUD-02', { release: '**Реліз:** Later · **Пріоритет:** M' }),
    'bud/BUD-03.md': req('BUD-03', { release: '**Реліз:** MVP · **Пріоритет:** Z' }),
    'bud/BUD-04.md': req('BUD-04', { release: null }),
  });
  assert.deepEqual(rules(list), ['priority-invalid', 'release-invalid', 'release-missing']);
});

test('folders where most files lack the field are exempt and reported', () => {
  const { list, result } = run({
    'jrn/README.md': readme('JRN', [['JRN-01', 'Назва', 'MVP', ''], ['JRN-02', 'Назва', 'v2', ''], ['JRN-03', 'Назва', '', '']]),
    'jrn/JRN-01.md': req('JRN-01', { release: '**Реліз:** MVP' }),
    'jrn/JRN-02.md': req('JRN-02', { release: '**Реліз:** v2.' }),
    'jrn/JRN-03.md': req('JRN-03', { release: null }),
  });
  assert.deepEqual(list, []);
  const jrn = result.folders.find((f) => f.folder === 'jrn');
  assert.equal(jrn.needRelease, true);
  assert.equal(jrn.needPriority, false);
  assert.deepEqual(result.exemptFiles, [{ file: 'docs/requirements/jrn/JRN-03.md', field: 'release', reason: 'README row has no release (n/a)' }]);
});

test('a file without priority in a folder that needs it is an error unless the README declares n/a', () => {
  const files = {
    'bud/README.md': readme('BUD', [['BUD-01'], ['BUD-02'], ['BUD-03', 'Назва', 'MVP', 'M']]),
    'bud/BUD-01.md': req('BUD-01'),
    'bud/BUD-02.md': req('BUD-02'),
    'bud/BUD-03.md': req('BUD-03', { release: '**Реліз:** MVP' }),
  };
  assert.deepEqual(rules(run(files).list), ['priority-missing']);
  files['bud/README.md'] = readme('BUD', [['BUD-01'], ['BUD-02'], ['BUD-03', 'Назва', 'MVP', '']]);
  assert.deepEqual(run(files).list, []);
});
