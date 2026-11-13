// Gap in the view-orphan check: delete a source section AND remove the «Згенеровано» header from all of its
// views, and the requirement became a plain card with hand-written slices that nothing compared to a source.
// An ID on the migrated list (tools/req-check/migrated.json) must keep its source section (source-missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../lib/run.mjs';
import { loadRegistries } from '../lib/registries.mjs';
import { loadCorpus, buildCorpus, readMigrated, addMigrated, MIGRATED_FILE } from '../lib/corpus.mjs';
import { SOURCE_MARKER } from '../lib/source.mjs';
import { main } from '../index.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const ID = 'NFR-01';
const dirOf = (rel) => `${ROOT}docs/requirements/${rel}`;
const facts = () => JSON.parse(fs.readFileSync(`${ROOT}tools/req-check/facts.json`, 'utf8'));

/** Real requirement files, as {rel, text}, with `edit` applied to each. */
function files(edit) {
  const real = loadCorpus(ROOT);
  return real.docs.map((d) => {
    const rel = d.rel.replace(/^docs\/requirements\//, '');
    return { rel, text: edit(rel, fs.readFileSync(`${ROOT}${d.rel}`, 'utf8')) };
  });
}
const errorRules = (corpus) =>
  runChecks(corpus, facts(), loadRegistries(ROOT)).findings.filter((f) => f.severity === 'error' && !f.baselined).map((f) => f.rule);

/** The attack: the source section is cut off and the header is removed from every view of the ID. */
const attack = (rel, text) => {
  if (rel === `nfr/${ID}.md`) return text.slice(0, text.indexOf(`\n\n${SOURCE_MARKER}`) + 1);
  if (rel.startsWith(`nfr/${ID}.`)) return text.split('\n').filter((l, i) => !(i === 1 && l.startsWith('> Згенеровано з '))).join('\n');
  return text;
};

test('the migrated list holds every source of the repository', () => {
  const ids = new Set(readMigrated(ROOT));
  const sources = loadCorpus(ROOT).sources.map((s) => s.id);
  assert.ok(sources.length > 0);
  assert.deepEqual(sources.filter((id) => !ids.has(id)), []);
});

test('without the list the attack passes (this is the gap)', () => {
  assert.equal(errorRules(buildCorpus(files(attack))).includes('source-missing'), false);
});

test('a migrated ID whose source section and view headers are gone is an error (source-missing)', () => {
  const rules = errorRules(buildCorpus(files(attack), 'docs/requirements', { migrated: readMigrated(ROOT) }));
  assert.ok(rules.includes('source-missing'), `got ${JSON.stringify([...new Set(rules)])}`);
});

test('an untouched repository and an ID without a card file', () => {
  assert.equal(errorRules(buildCorpus(files((_, t) => t), 'docs/requirements', { migrated: readMigrated(ROOT) })).includes('source-missing'), false);
  const rules = errorRules(buildCorpus(files((_, t) => t), 'docs/requirements', { migrated: [...readMigrated(ROOT), 'ZZZ-99'] }));
  assert.ok(rules.includes('source-missing'));
});

test('--views adds new sources to the list and never removes an ID', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrated-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools/req-check'), { recursive: true });
    assert.equal(addMigrated(tmp, ['B-1', 'A-1']), 2);
    assert.deepEqual(readMigrated(tmp), ['A-1', 'B-1']);
    assert.equal(addMigrated(tmp, ['B-1']), 0);
    addMigrated(tmp, ['C-1']);
    assert.deepEqual(readMigrated(tmp), ['A-1', 'B-1', 'C-1']);
    assert.ok(fs.existsSync(path.join(tmp, MIGRATED_FILE)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the CLI fails on the attack', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrated-cli-'));
  try {
    for (const f of files(attack)) {
      const p = path.join(tmp, 'docs/requirements', f.rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.text);
    }
    fs.cpSync(`${ROOT}docs/ux`, path.join(tmp, 'docs/ux'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tools/req-check'), { recursive: true });
    fs.copyFileSync(`${ROOT}${MIGRATED_FILE}`, path.join(tmp, MIGRATED_FILE));
    const out = [];
    const code = main(['--root', tmp, '--no-baseline', '--quiet', '--facts', `${ROOT}tools/req-check/facts.json`], (l) => out.push(l));
    assert.equal(code, 1);
    assert.ok(out.some((l) => l.includes('[source-missing]')), out.slice(0, 5).join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
