// NFR-07@PoC FR 1 (#161, owner decision 2026-11-17): the daily check of main, not a PR's CI, says when the web
// app's browser release tables are stale. Every case fixes its date.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BROWSER_TABLES_FILE, browserTableFindings, readBrowserTables } from '../lib/browser-tables.mjs';
import { evaluate, needsAlert, render } from '../lib/daily.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const data = (over = {}) => ({
  staleAfterDays: { chromium: 42, safari: 84 },
  releases: {
    chromium: [['157', '2026-10-22'], ['158', '2026-11-04']],
    safari: [['27.1', '2026-10-23'], ['27.2', '2026-10-26']],
  },
  ...over,
});
const input = (browserTables, now) => ({
  now,
  window: { since: '2026-11-16T05:00:00Z', until: now },
  owner: 'repo-owner',
  main: { name: 'main' },
  ...(browserTables === undefined ? {} : { browserTables }),
});

test('NFR-07@PoC FR 1: a table whose newest release is within its limit is not reported', () => {
  // Chromium 158 came out on 2026-11-04: day 42 is 2026-12-16. Safari 27.2 on 2026-10-26: day 84 is 2027-01-18.
  assert.deepEqual(browserTableFindings(data(), '2026-11-17T05:41:00Z'), []);
  assert.deepEqual(browserTableFindings(data(), '2026-12-16T23:59:59Z'), []);
});

test('NFR-07@PoC FR 1: the day after the limit the table is reported, each table by its own limit', () => {
  const chromium = browserTableFindings(data(), '2026-12-17T00:00:00Z');
  assert.equal(chromium.length, 1);
  assert.equal(chromium[0].severity, 'stale');
  assert.equal(chromium[0].subject, 'таблиця випусків chromium');
  assert.match(chromium[0].message, /\(158, 2026-11-04\) вийшов 43 дн\. тому, більше за 42/);
  assert.ok(chromium[0].message.includes(BROWSER_TABLES_FILE));

  assert.deepEqual(
    browserTableFindings(data(), '2027-01-18T12:00:00Z').map((f) => f.subject),
    ['таблиця випусків chromium'],
  );
  const both = browserTableFindings(data(), '2027-01-19T00:00:00Z');
  assert.deepEqual(both.map((f) => f.subject), ['таблиця випусків chromium', 'таблиця випусків safari']);
  assert.match(both[1].message, /\(27\.2, 2026-10-26\) вийшов 85 дн\. тому, більше за 84/);
});

test('NFR-07@PoC FR 1: data that cannot be judged is reported, never passed (fail closed)', () => {
  const now = '2026-11-17T05:41:00Z';
  const one = (d) => browserTableFindings(d, now);
  assert.match(one({ error: 'ENOENT' })[0].message, /не вдалося прочитати .*ENOENT/);
  assert.equal(one(undefined).length, 1);
  assert.equal(one({ staleAfterDays: {}, releases: {} }).length, 1);
  assert.equal(one(data({ staleAfterDays: { chromium: 42 } })).length, 1, 'no limit for safari');
  assert.equal(one(data({ staleAfterDays: { chromium: 0, safari: 84 } })).length, 1, 'a zero limit');
  assert.equal(one(data({ releases: { chromium: [], safari: [['27.2', '2026-10-26']] } })).length, 1, 'an empty table');
  assert.equal(one(data({ releases: { chromium: [['158', 'soon']], safari: [['27.2', '2026-10-26']] } })).length, 1, 'no date');
  assert.equal(one(data({ releases: { chromium: 'x', safari: [['27.2', '2026-10-26']] } })).length, 1, 'not a table');
  assert.equal(browserTableFindings(data(), 'not a date').length, 2, 'an unreadable clock reports every table');
});

test('NFR-07@PoC FR 1: the daily check alerts on a stale table and names the requirement', () => {
  const fresh = evaluate(input(data(), '2026-11-17T05:41:00Z'));
  assert.equal(needsAlert(fresh), false);
  const stale = evaluate(input(data(), '2026-12-17T05:41:00Z'));
  assert.equal(stale.summary.stale, 1);
  assert.equal(needsAlert(stale), true);
  assert.match(render(stale), /### Перевірити\n\n- \*\*таблиця випусків chromium\*\* \(NFR-07@PoC FR 1\): /);
  // A replayed input without the tables (a fixture) is not judged by today's files.
  assert.equal(needsAlert(evaluate(input(undefined, '2027-06-01T05:41:00Z'))), false);
  // Other findings keep their requirement.
  const gap = evaluate({ ...input(undefined, '2026-11-17T05:41:00Z'), window: { since: 'a', until: 'b', gap: true } });
  assert.match(render(gap), /\(CICD-01 FR 3\)/);
});

test('NFR-07@PoC FR 1: the tables are read from the web app; a missing file is a finding', () => {
  const real = readBrowserTables(ROOT);
  assert.deepEqual(Object.keys(real.releases).sort(), ['chromium', 'safari']);
  assert.deepEqual(Object.keys(real.staleAfterDays).sort(), ['chromium', 'safari']);
  // On the newest release date itself nothing is stale: the file is well formed (no clock here).
  const newest = Object.values(real.releases).map((rows) => rows.at(-1)[1]).sort().at(-1);
  assert.deepEqual(browserTableFindings(real, `${newest}T00:00:00Z`).filter((f) => !/дн\. тому/.test(f.message)), []);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'nfr07-'));
  try {
    const missing = readBrowserTables(empty);
    assert.ok(missing.error);
    assert.equal(browserTableFindings(missing, '2026-11-17T05:41:00Z').length, 1);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('NFR-07@PoC FR 1: the daily command reads the tables in a live run only', () => {
  const index = fs.readFileSync(path.join(ROOT, 'tools/pr-rules/index.mjs'), 'utf8');
  const live = index.indexOf('input = await fetchDailyInput(');
  const read = index.indexOf('input.browserTables = readBrowserTables(ROOT);');
  assert.ok(live > 0 && read > live && read < index.indexOf("if (flag('--save-input'))"));
});
