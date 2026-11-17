// Requirement text fingerprints (owner decision 2026-11-16, items 6–8; external review §10б proposal 1): one file
// per requirement next to its source maps item keys («PoC/FR 3») to a hash of the item's text at the last
// re-check of its tests and code. `--check-fingerprints` fails when the text changed and the hash is old;
// `--update-fingerprints <ID> [items…]` rewrites the hashes after the re-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, parseArgs } from '../index.mjs';
import { normaliseItem, hashItem, itemKey, parseItemKey, compareKeys, renderFingerprints, parseFingerprints, FINGERPRINT_FILE_RE } from '../lib/fingerprints.mjs';
import { card } from './helpers.mjs';

const SOURCE = `${card('TST-16', ['PoC', 'PoC v2'])}
## Джерело зрізів

[лише PoC] **Реліз:** PoC · **Пріоритет:** S
[PoC v2] **Реліз:** PoC v2 · **Пріоритет:** S

**Зв'язки**
- [лише PoC] Розширює: —
- [PoC v2] Розширює: TST-16@PoC
- Залежить від: —
- Дизайн: —
- Спільні правила: —
- Сценарії: —
- Модуль: budget
- [лише PoC] Перевіряється: apps/web/budget.test.ts, apps/web/other.test.ts
- [PoC v2] Перевіряється: —

**Мета.** Як користувач, я хочу щось.

**Функціональні вимоги**
#. Перша вимога.
#. Друга вимога
   з продовженням.
#. [PoC v2] Нова в PoC v2.

**Критерії приймання**
#. **Given** умова А **When** дія **Then** результат.

**Граничні випадки**
- Випадок.
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-check-fp-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put('docs/requirements/tst/TST-16.md', SOURCE);
  put('apps/web/budget.test.ts', 'it("TST-16@PoC FR 2: друга", () => {});\nit("TST-16@PoC AC1", () => {});\n');
  main(['--root', root, '--no-baseline', '--quiet', '--views'], () => {});
  return { root, put, read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8') };
}
const FP = 'docs/requirements/tst/TST-16.fingerprints.json';
const run = (root, args) => {
  const logs = [];
  const code = main(['--root', root, '--no-baseline', '--quiet', ...args], (l) => logs.push(l));
  return { code, out: logs.join('\n') };
};

test('normalisation: the list marker, indentation and runs of whitespace do not count; words and punctuation do', () => {
  assert.equal(normaliseItem(['3. Друга   вимога', '   з продовженням. ']), 'Друга вимога з продовженням.');
  assert.equal(normaliseItem(['- Випадок.']), 'Випадок.');
  assert.equal(hashItem(['1. Перша вимога.']), hashItem(['7.  Перша\tвимога.']));
  assert.notEqual(hashItem(['1. Перша вимога.']), hashItem(['1. Перша вимога!']));
  // NFC: a composed and a decomposed «й» are the same text.
  assert.equal(hashItem(['1. й']), hashItem(['1. й']));
  assert.match(hashItem(['1. x']), /^[0-9a-f]{16}$/);
});

test('item keys: release and item label, sorted by release, kind (FR, AC, EC) and number', () => {
  assert.equal(itemKey('PoC v2', 'FR', 3), 'PoC v2/FR 3');
  assert.deepEqual(parseItemKey('PoC v2/AC 12'), { release: 'PoC v2', kind: 'AC', n: 12 });
  assert.deepEqual(parseItemKey('PoC/FR3'), { release: 'PoC', kind: 'FR', n: 3 });
  assert.deepEqual(parseItemKey('EC 2'), { release: null, kind: 'EC', n: 2 });
  assert.equal(parseItemKey('Beta/FR 1'), null);
  assert.equal(parseItemKey('PoC/XY 1'), null);
  const keys = ['PoC v2/FR 1', 'PoC/EC 1', 'PoC/FR 10', 'PoC/AC 1', 'PoC/FR 2'];
  assert.deepEqual(keys.sort(compareKeys), ['PoC/FR 2', 'PoC/FR 10', 'PoC/AC 1', 'PoC/EC 1', 'PoC v2/FR 1']);
});

test('file format: sorted keys, one item per line, final newline; anything else is reported', () => {
  const text = renderFingerprints(new Map([['PoC/AC 1', 'b'.repeat(16)], ['PoC/FR 2', 'a'.repeat(16)]]));
  assert.equal(text, `{\n  "PoC/FR 2": "${'a'.repeat(16)}",\n  "PoC/AC 1": "${'b'.repeat(16)}"\n}\n`);
  assert.deepEqual(parseFingerprints(text).problems, []);
  assert.equal(parseFingerprints(text).entries.get('PoC/FR 2'), 'a'.repeat(16));
  assert.match(parseFingerprints('{').problems[0], /not valid JSON/);
  assert.match(parseFingerprints('{"PoC/QQ 1": "aaaaaaaaaaaaaaaa"}\n').problems[0], /not an item key/);
  assert.match(parseFingerprints('{"PoC/FR 1": 5}\n').problems[0], /16 hex/);
  assert.match(parseFingerprints(`{"PoC/AC 1": "${'b'.repeat(16)}", "PoC/FR 2": "${'a'.repeat(16)}"}\n`).problems[0], /canonical form/);
  assert.ok(FINGERPRINT_FILE_RE.test('TST-16.fingerprints.json'));
  assert.ok(!FINGERPRINT_FILE_RE.test('TST-16.poc.md'));
});

test('--update-fingerprints without items writes every item a test names; --check-fingerprints then passes', () => {
  const { root, read } = fixture();
  // No file yet: nothing to check (until the initial fingerprints of owner item 9), exit 0.
  let r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 changed items/);
  // PoC FR 2 and AC 1, and the same source lines in PoC v2.
  assert.match(r.out, /4 items named by tests have no fingerprint yet/);

  r = run(root, ['--update-fingerprints', 'TST-16']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no item whose text had changed was updated/);
  const text = read(FP);
  // FR 2 and AC 1 of PoC are named by a test; PoC v2 keeps the same lines, so its FR 2 and AC 1 are the same items.
  assert.deepEqual(Object.keys(JSON.parse(text)), ['PoC/FR 2', 'PoC/AC 1', 'PoC v2/FR 2', 'PoC v2/AC 1']);
  assert.equal(JSON.parse(text)['PoC/FR 2'], hashItem(['2. Друга вимога', '   з продовженням.']));
  r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 changed items/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--check-fingerprints fails on a changed item, naming the requirement, the item, «Перевіряється» and the tests naming it', () => {
  const { root, put, read } = fixture();
  run(root, ['--update-fingerprints', 'TST-16']);
  // A whitespace-only edit is not a change.
  put('docs/requirements/tst/TST-16.md', SOURCE.replace('#. Друга вимога\n   з продовженням.', '#. Друга  вимога\n      з продовженням.'));
  run(root, ['--views']);
  assert.equal(run(root, ['--check-fingerprints']).code, 0);
  // A wording change is.
  put('docs/requirements/tst/TST-16.md', SOURCE.replace('з продовженням.', 'з іншим продовженням.'));
  run(root, ['--views']);
  const r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 1);
  const errors = r.out.split('\n').filter((l) => l.startsWith('ERROR '));
  assert.equal(errors.length, 2, r.out); // PoC/FR 2 and PoC v2/FR 2
  assert.match(errors[0], /^ERROR docs\/requirements\/tst\/TST-16\.md:\d+ \[fingerprint-changed\] TST-16@PoC FR 2: /);
  assert.match(errors[0], /«Перевіряється»: apps\/web\/budget\.test\.ts, apps\/web\/other\.test\.ts/);
  assert.match(errors[0], /tests naming this item: apps\/web\/budget\.test\.ts:1/);
  assert.match(errors[0], /--update-fingerprints TST-16 "PoC\/FR 2"/);
  assert.match(errors[1], /TST-16@PoC v2 FR 2: .*«Перевіряється»: —/);
  assert.match(r.out, /2 changed items/);
  // The source line of the item: annotations point at the text to re-check.
  const line = Number(/TST-16\.md:(\d+)/.exec(errors[0])[1]);
  assert.match(read('docs/requirements/tst/TST-16.md').split('\n')[line - 1], /^#\. Друга вимога/);

  // Updating only the PoC item leaves the PoC v2 one failing; updating it too passes. Each update lists the
  // changed items it marks re-checked.
  const u = run(root, ['--update-fingerprints', 'TST-16', 'PoC/FR2']);
  assert.equal(u.code, 0);
  assert.match(u.out, /1 items whose text had changed are now marked re-checked: PoC\/FR 2\./);
  assert.equal(run(root, ['--check-fingerprints']).code, 1);
  assert.equal(run(root, ['--update-fingerprints', 'TST-16', 'PoC v2/FR 2']).code, 0);
  assert.equal(run(root, ['--check-fingerprints']).code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an item named without a release is updated in every view that has it; an unknown item is refused', () => {
  const { root, read } = fixture();
  assert.equal(run(root, ['--update-fingerprints', 'TST-16', 'FR 3']).code, 0);
  // FR 3 exists only in PoC v2 («Нова в PoC v2»); named explicitly, it is written although no test names it.
  assert.deepEqual(Object.keys(JSON.parse(read(FP))), ['PoC v2/FR 3']);
  assert.throws(() => main(['--root', root, '--update-fingerprints', 'TST-16', 'PoC/FR 9'], () => {}), /TST-16 has no item PoC\/FR 9/);
  assert.throws(() => main(['--root', root, '--update-fingerprints', 'TST-99'], () => {}), /TST-99 is not a requirement with release views/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an entry for an item the views no longer have fails; the update without items removes it', () => {
  const { root, put, read } = fixture();
  run(root, ['--update-fingerprints', 'TST-16']);
  const extra = { ...JSON.parse(read(FP)), 'PoC/FR 9': 'f'.repeat(16) };
  put(FP, renderFingerprints(new Map(Object.entries(extra))));
  const r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR docs\/requirements\/tst\/TST-16\.fingerprints\.json:\d+ \[fingerprint-no-item\] TST-16 has a fingerprint for PoC\/FR 9/);
  run(root, ['--update-fingerprints', 'TST-16']);
  assert.ok(!('PoC/FR 9' in JSON.parse(read(FP))));
  assert.equal(run(root, ['--check-fingerprints']).code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a malformed file, or a file of no requirement, fails the check', () => {
  const { root, put } = fixture();
  put(FP, '{"PoC/FR 2": "x"}\n');
  let r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[fingerprint-file\] .*16 hex/);
  // The update refuses to overwrite a file it cannot read.
  assert.throws(() => main(['--root', root, '--update-fingerprints', 'TST-16'], () => {}), /16 hex/);
  fs.rmSync(path.join(root, FP));
  put('docs/requirements/tst/TST-77.fingerprints.json', '{}\n');
  r = run(root, ['--check-fingerprints']);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[fingerprint-file\] TST-77 has no requirement source with release views/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--require-fingerprints (after the initial fingerprints) fails on an item a test names without an entry', () => {
  const { root } = fixture();
  let r = run(root, ['--check-fingerprints', '--require-fingerprints']);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[fingerprint-missing\] TST-16@PoC FR 2: named by tests .* has no fingerprint/);
  run(root, ['--update-fingerprints', 'TST-16']);
  r = run(root, ['--check-fingerprints', '--require-fingerprints']);
  assert.equal(r.code, 0, r.out);
  fs.rmSync(root, { recursive: true, force: true });
});

test('arguments: --update-fingerprints takes an ID and the items after it', () => {
  const o = parseArgs(['--update-fingerprints', 'TST-16', 'PoC/FR 3', 'AC1', '--quiet']);
  assert.equal(o.updateFingerprints, 'TST-16');
  assert.deepEqual(o.fingerprintItems, ['PoC/FR 3', 'AC1']);
  assert.equal(o.quiet, true);
  assert.throws(() => parseArgs(['--update-fingerprints']), /needs a value/);
  assert.equal(parseArgs(['--check-fingerprints']).checkFingerprints, true);
});

test('--update-fingerprints without items lists every changed item it marks re-checked', () => {
  const { root, put } = fixture();
  run(root, ['--update-fingerprints', 'TST-16']);
  put('docs/requirements/tst/TST-16.md', SOURCE.replace('з продовженням.', 'з іншим продовженням.').replace('умова А', 'умова Б'));
  run(root, ['--views']);
  const r = run(root, ['--update-fingerprints', 'TST-16']);
  assert.equal(r.code, 0);
  assert.match(r.out, /4 items whose text had changed are now marked re-checked: PoC\/FR 2, PoC\/AC 1, PoC v2\/FR 2, PoC v2\/AC 1\./);
  fs.rmSync(root, { recursive: true, force: true });
});
