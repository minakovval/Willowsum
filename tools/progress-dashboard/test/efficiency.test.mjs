// PRC-02 (owner decision 2026-11-28, docs/decisions/log/2026-11-28-owner-dashboard-token-efficiency.md): the progress
// page shows the price of a requirement item. The calculation block of the page (<script id="eff-lib">) runs here in
// node; history.mjs is the CI step that appends a point per merge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { isPoint, main, merge, pointOf, prOf } from '../history.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = read('tools/progress-dashboard/index.html');
const E = (() => {
  const src = /<script id="eff-lib">([\s\S]*?)<\/script>/.exec(PAGE)[1];
  const ctx = {};
  vm.runInNewContext(`${src};this.E = WillowsumEfficiency;`, ctx);
  return ctx.E;
})();
const plain = (x) => JSON.parse(JSON.stringify(x));

const HEAD = '| PR | Тип | Раунди | Токени агентів (`subagent_tokens`) | Агенти: cache read, млн | Агенти: output, тис. | Час автора, хв | Час рецензій, хв | CI, хв | Примітка |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |';
const row = (pr, type, cr) => `| #${pr} | ${type} | 1 | 100 000 | ${String(cr).replace('.', ',')} | 50 | 30 | 6 | 10 | моделі: sonnet |`;
const pt = (sha, at, pr, covered, poc = [covered, 1000]) => [sha, at, pr, covered, poc[0], poc[1]];

test('PRC-02 (owner, 2026-11-28): «PR» rows of #180 and its archive — type, cache read; the later body wins; «Сесії» rows with their PRs', () => {
  const archive = `${HEAD}\n${row(10, 'code', 99)}\n${row(11, 'UI', '1 234,5')}`;
  const body = `## Сесії\n| Сегмент | Період | cache read | output | ≈ USD | Тривалість, год | Час агентів, год | CI, год | Примітка |\n| --- |\n` +
    '| ведучий 7 | 2026-11-15 | 300,0 млн | 1,0 млн | 1 120,5 | 3 | 2 | 1 | 2 PR (#10, #12, #10) |\n' +
    '| ведучі 8–9 | 2026-11-16 | — | — | — | — | — | — | без ціни |\n' +
    `## PR\n${HEAD}\n${row(10, 'code', 12.5)}\n${row(12, 'docs', 3)}\n| #13 | код | зламаний рядок |\n\nАрхів рядків PR: #499, #812`;
  assert.deepEqual(plain(E.archives(body)), [499, 812]);
  const rows = plain(E.parsePrRows([archive, body]));
  assert.deepEqual(Object.keys(rows), ['10', '11', '12']);
  assert.deepEqual([rows[10].type, rows[10].cr, rows[11].type, rows[11].cr, rows[12].type], ['код', 12.5, 'UI', 1234.5, 'вимоги']);
  assert.equal(rows[10].hours, 0.6);
  assert.deepEqual(plain(E.parseSessions(body)), [{ name: 'ведучий 7', usd: 1120.5, prs: [10, 12] }, { name: 'ведучі 8–9', usd: null, prs: [] }]);
});

test('PRC-02 (owner, 2026-11-28): items of a PR = growth of distinct covered items at its merge commit; a stacked PR adds to its umbrella; rows not on main stay out', () => {
  const history = {
    umbrella: { 21: 20 },
    points: [pt('aaaaaaaa', '2026-11-01T10:00:00Z', 1, 100), pt('bbbbbbbb', '2026-11-01T11:00:00Z', 20, 110), pt('cccccccc', '2026-11-01T12:00:00Z', 22, 108)],
  };
  const rows = { 1: { pr: 1, type: 'код', cr: 5, hours: 0 }, 20: { pr: 20, type: 'вимоги', cr: 2, hours: 1 }, 21: { pr: 21, type: 'код', cr: 8, hours: 1 },
    22: { pr: 22, type: 'UI', cr: 4, hours: 0 }, 30: { pr: 30, type: 'код', cr: 7, hours: 0 } };
  const j = plain(E.join(rows, history));
  assert.deepEqual(j.prs.map((p) => [p.pr, p.type, p.items, p.cr, p.parts]), [[1, 'код', 0, 5, 1], [20, 'код', 10, 10, 2], [22, 'UI', -2, 4, 1]]);
  assert.deepEqual(j.unmatched, { prs: 1, cr: 7 });
});

const series = (n, type, at0, items, cr) => Array.from({ length: n }, (_, i) => ({ pr: at0 + i, at: new Date(Date.UTC(2026, 10, 1) + (at0 + i) * 36e5).toISOString(), type, items, cr }));

test('PRC-02 (owner, 2026-11-28): rolling price of an item over the last 20 PRs of a type, from the 10th PR', () => {
  const prs = series(25, 'код', 0, 2, 10).concat(series(5, 'UI', 100, 1, 1));
  const r = plain(E.rolling(prs));
  assert.equal(r['код'].length, 16);
  assert.deepEqual(r['код'][0], { at: prs[9].at, pr: 9, v: 5 });
  assert.deepEqual(r.UI, []);
});

test('PRC-02 (owner, 2026-11-28): an action splits the PRs of a type into 20 before and 20 after; fewer than 5 on a side gives no number', () => {
  const prs = series(20, 'код', 0, 1, 10).concat(series(20, 'код', 20, 1, 5)).concat(series(3, 'UI', 40, 1, 1));
  // The action is PR 19 itself (minutes only in events.json): it and the PRs before it are «before».
  const [e] = plain(E.effects(prs, [{ at: prs[19].at.slice(0, 16) + 'Z', pr: 19, category: 'моделі', label: 'x', effect: 'y' }]));
  assert.deepEqual(e.code, { before: 10, after: 5, after_n: 20, change: -50 });
  assert.equal(e.ui.before, null);
  assert.deepEqual([e.all.before, e.all.after, e.all.after_n], [10, 4.5, 23]);
});

test('PRC-02 (owner, 2026-11-28): the forecast is a range — PoC items left × the price over 7 and 14 days, dollars over all and the last 5 priced sessions', () => {
  const day = (d) => new Date(Date.UTC(2026, 10, d, 12)).toISOString();
  const prs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((d) => ({ pr: d, at: day(d), type: 'код', items: 10, cr: d <= 7 ? 20 : 50 }));
  const cs = [{ at: day(1), pocCovered: 0, pocTotal: 900 }, { at: day(14), pocCovered: 500, pocTotal: 1000 }];
  const sessions = [{ name: 'a', usd: 100, prs: [1, 2, 3, 4, 5] }, { name: 'b', usd: 0, prs: [6] }, { name: 'c', usd: 300, prs: [13, 14] }];
  const f = plain(E.forecast(prs, sessions, cs));
  assert.deepEqual([f.left, f.pocTotalFirst, f.per7, f.per14], [500, 900, 5, 3.5]);
  assert.deepEqual([f.tokensLowBn, f.tokensHighBn], [1.8, 2.5]);
  assert.deepEqual([f.usdAll, f.usdLast5, f.usdLow, f.usdHigh], [5.71, 5.71, 2900, 2900]);
  assert.deepEqual([f.pace7, f.pace14, f.daysLow, f.daysHigh], [10, 10, 50, 50]);
  assert.equal(E.forecast([], sessions, cs), null);
});

test('PRC-02 (owner, 2026-11-28): the seed history and the actions in the repository are well formed', () => {
  const seed = JSON.parse(read('tools/progress-dashboard/history-seed.json'));
  assert.equal(seed.schema, 1);
  assert.ok(seed.points.length > 300);
  seed.points.forEach((p, i) => assert.ok(isPoint(p), `point ${i}`));
  assert.equal(new Set(seed.points.map((p) => p[0])).size, seed.points.length);
  const onMain = new Set(seed.points.map((p) => p[2]));
  for (const [child, parent] of Object.entries(seed.umbrella)) assert.ok(onMain.has(parent) && !onMain.has(Number(child)), `${child} → ${parent}`);
  const { events } = JSON.parse(read('tools/progress-dashboard/events.json'));
  for (const e of events) {
    assert.ok(!Number.isNaN(Date.parse(e.at)) && Number.isInteger(e.pr) && e.category && e.label && e.effect, JSON.stringify(e));
    for (const f of e.source.split(/;\s*/)) assert.ok(fs.existsSync(path.join(ROOT, 'docs/decisions/log', f)), f);
  }
});

test('PRC-02 (owner, 2026-11-28): history.mjs appends this commit after the published points, once, and skips a broken published file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
  const w = (n, j) => { fs.writeFileSync(path.join(dir, n), typeof j === 'string' ? j : JSON.stringify(j)); return path.join(dir, n); };
  const seed = w('seed.json', { schema: 1, umbrella: { 5: 4 }, points: [pt('aaaaaaaa', '2026-11-01T10:00:00Z', 1, 10), pt('bbbbbbbb', '2026-11-01T11:00:00Z', 4, 12)] });
  const prev = w('prev.json', { schema: 1, points: [pt('aaaaaaaa', '2026-11-01T10:00:00Z', 1, 10), pt('bbbbbbbb', '2026-11-01T11:00:00Z', 4, 12), pt('cccccccc', '2026-11-02T10:00:00Z', 6, 15)] });
  const cov = w('cov.json', { sha: 'd'.repeat(40), distinct: { covered: 20, mentions: 30 }, releases: [{ release: 'PoC', items: { covered: 18, total: 50 } }] });
  const args = (p) => ['--seed', seed, ...(p ? ['--prev', p] : []), '--coverage', cov, '--subject', 'BUD-1: x (#7)', '--at', '2026-11-03T10:00:00+01:00', '--out', path.join(dir, 'out.json')];
  const out = main(args(prev));
  assert.deepEqual(out.points.map((p) => p[0]), ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd']);
  assert.deepEqual(out.points[3], ['dddddddd', '2026-11-03T09:00:00Z', 7, 20, 18, 50]);
  assert.deepEqual(out.umbrella, { 5: 4 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')), out);
  // Run again on the same commit: no second point.
  assert.equal(merge(JSON.parse(fs.readFileSync(seed)), out, out.points[3]).points.length, 4);
  const warnings = [];
  const broken = main(args(w('bad.json', '{"schema":1,"points":[["zz"]]}')), { warn: (m) => warnings.push(m) });
  assert.deepEqual(broken.points.map((p) => p[0]), ['aaaaaaaa', 'bbbbbbbb', 'dddddddd']);
  assert.match(warnings[0], /published history skipped/);
  assert.equal(prOf('PRC-02: x (#12)'), 12);
  assert.equal(prOf('Merge branch main'), null);
  assert.throws(() => pointOf({ sha: 'd'.repeat(40), releases: [] }, { subject: '', at: '2026-11-03T10:00:00Z' }), /distinct/);
});
