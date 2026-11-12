// Security review PR #117: a view keeps its «Згенеровано з» header after its source section is deleted, and
// then it is edited by hand without any CI error (the «views must match» gate is switched off by content).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runChecks } from '../lib/run.mjs';
import { loadRegistries } from '../lib/registries.mjs';
import { loadCorpus } from '../lib/corpus.mjs';
import { SOURCE_MARKER } from '../lib/source.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SRC = 'nfr/NFR-01.md';
const VIEW = 'nfr/NFR-01.poc.md';

test('a slice that carries the generated-view header but has no source is an error (view-orphan)', () => {
  const abs = (rel) => `${ROOT}docs/requirements/${rel}`;
  const before = { src: fs.readFileSync(abs(SRC), 'utf8'), view: fs.readFileSync(abs(VIEW), 'utf8') };
  const cardOnly = before.src.slice(0, before.src.indexOf(`\n\n${SOURCE_MARKER}`) + 1);
  const edited = before.view.replace('AES-256 за схемою envelope encryption', 'за потреби');
  assert.notEqual(edited, before.view);
  // Build the corpus from disk, then swap in the two attacked files in memory (nothing is written).
  const real = loadCorpus(ROOT);
  const files = real.docs.map((d) => ({ rel: d.rel.replace(/^docs\/requirements\//, ''), text: fs.readFileSync(`${ROOT}${d.rel}`, 'utf8') }));
  for (const f of files) {
    if (f.rel === SRC) f.text = cardOnly;
    if (f.rel === VIEW) f.text = edited;
  }
  return import('../lib/corpus.mjs').then(({ buildCorpus }) => {
    const res = runChecks(buildCorpus(files), JSON.parse(fs.readFileSync(`${ROOT}tools/req-check/facts.json`, 'utf8')), loadRegistries(ROOT));
    const errs = res.findings.filter((f) => f.severity === 'error' && !f.baselined).map((f) => f.rule);
    assert.ok(errs.includes('view-orphan'), `expected view-orphan, got ${JSON.stringify([...new Set(errs)])}`);
  });
});
