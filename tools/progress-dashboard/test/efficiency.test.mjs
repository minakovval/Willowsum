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
const row = (pr, type, cr, note = 'a:sonnet') => `| #${pr} | ${type} | 1 | 100 000 | ${String(cr).replace('.', ',')} | 50 | 30 | 6 | 10 | ${note} |`;
const pt = (sha, at, pr, covered, poc = [covered, 1000]) => [sha, at, pr, covered, poc[0], poc[1]];

test('PRC-02 (owner, 2026-11-28): «PR» rows of #180 and its archive — type, cache read; the later body wins', () => {
  const archive = `${HEAD}\n${row(10, 'code', 99)}\n${row(11, 'UI', '1 234,5')}`;
  const body = `## PR\n${HEAD}\n${row(10, 'code', 12.5)}\n${row(12, 'docs', 3)}\n| #13 | код | зламаний рядок |\n\nАрхів рядків PR: #499, #812`;
  assert.deepEqual(plain(E.archives(body)), [499, 812]);
  const rows = plain(E.parsePrRows([archive, body]));
  assert.deepEqual(Object.keys(rows), ['10', '11', '12']);
  assert.deepEqual([rows[10].type, rows[10].cr, rows[11].type, rows[11].cr, rows[12].type], ['код', 12.5, 'UI', 1234.5, 'вимоги']);
  assert.equal(rows[10].hours, 0.6);
});

// Review 2026-11-28, A1: models are priced differently; the page weighs cache read by the model price relative to Opus.
test('PRC-02 (owner, 2026-11-28): tokens are weighted by model — Sonnet × 0.5, Fable × 2, the part without a model split as Opus', () => {
  assert.equal(E.weighted(41.2, 'a:opus s:fable; моделі: opus 34,1 млн / fable 6,1 млн / sonnet 1,0 млн cache read'), 34.1 + 12.2 + 0.5);
  assert.equal(E.weighted(10, 'моделі: sonnet 6 млн cache read'), 3 + 4);
  assert.equal(E.weighted(10, 'a:opus'), 10);
  const rows = plain(E.parsePrRows([`${HEAD}\n${row(5, 'UI', 8, 'моделі: sonnet 8 млн cache read')}`]));
  assert.deepEqual([rows[5].cr, rows[5].w], [8, 4]);
});

// Review 2026-11-28, A2 and A4: ranges of PRs, the lead's own tokens, a session whose usage leaves the agents out.
test('PRC-02 (owner, 2026-11-28): «Сесії» rows — a range «#181–#186» is every PR in it; the lead\'s own cache read; no USD when the usage leaves the agents out', () => {
  const body = '| Сегмент | Період |\n| --- |\n' +
    '| ведучий 2 | 2026-11-13 | 290,8 млн | 1,08 млн | 112,9 | 12 | 7 | 2 | 9 PR (#181–#184, #189). `usage` сесії агентів не включає |\n' +
    '| ведучий 3 | 2026-11-14 | 279,1 млн | 0,99 млн | 110,3 | 3 | 8 | 2 | 3 PR (#194, #197, #194). Сам ведучий (`tools/token-report session`) — 62,0 млн cache read |\n' +
    '| ведучі 8–9 | 2026-11-16 | — | — | — | — | — | — | без ціни |\n';
  assert.deepEqual(plain(E.parseSessions(body)), [
    { name: 'ведучий 2', usd: null, lead: null, prs: [181, 182, 183, 184, 189] },
    { name: 'ведучий 3', usd: 110.3, lead: 62, prs: [194, 197] },
    { name: 'ведучі 8–9', usd: null, lead: null, prs: [] },
  ]);
});

test('PRC-02 (owner, 2026-11-28): items of a PR = growth of distinct covered items at its merge commit; a stacked PR adds to its umbrella; owner corrections are their own type; rows not on main stay out', () => {
  const history = {
    umbrella: { 21: 20 },
    corrections: [22],
    points: [pt('aaaaaaaa', '2026-11-01T10:00:00Z', 1, 100), pt('bbbbbbbb', '2026-11-01T11:00:00Z', 20, 110), pt('cccccccc', '2026-11-01T12:00:00Z', 22, 108)],
  };
  const rows = { 1: { pr: 1, type: 'код', cr: 5, w: 5, hours: 0 }, 20: { pr: 20, type: 'вимоги', cr: 2, w: 1, hours: 1 }, 21: { pr: 21, type: 'код', cr: 8, w: 16, hours: 1 },
    22: { pr: 22, type: 'код', cr: 4, w: 4, hours: 0 }, 30: { pr: 30, type: 'код', cr: 7, w: 7, hours: 0 } };
  const j = plain(E.join(rows, history));
  assert.deepEqual(j.prs.map((p) => [p.pr, p.type, p.items, p.cr, p.w, p.parts]), [[1, 'код', 0, 5, 5, 1], [20, 'код', 10, 10, 17, 2], [22, E.CORRECTION, -2, 4, 4, 1]]);
  assert.deepEqual(j.unmatched, { prs: 1, cr: 7 });
});

const series = (n, type, at0, items, w) => Array.from({ length: n }, (_, i) => ({ pr: at0 + i, at: new Date(Date.UTC(2026, 10, 1) + (at0 + i) * 36e5).toISOString(), type, items, w, cr: w }));

test('PRC-02 (owner, 2026-11-28): rolling price of an item over the last 20 PRs of a type, from the 10th PR', () => {
  const prs = series(25, 'код', 0, 2, 10).concat(series(5, 'UI', 100, 1, 1));
  const r = plain(E.rolling(prs));
  assert.equal(r['код'].length, 16);
  assert.deepEqual(r['код'][0], { at: prs[9].at, pr: 9, v: 5 });
  assert.deepEqual(r.UI, []);
});

// Review 2026-11-28, A3: actions merged close together cannot be told apart; a change inside the noise is marked.
test('PRC-02 (owner, 2026-11-28): actions within 24 hours are one package, split into 20 PRs of a type before the first and after the last, with a 90 % interval', () => {
  const at = (h) => new Date(Date.UTC(2026, 10, 1) + h * 36e5).toISOString().slice(0, 16) + 'Z';
  assert.deepEqual(plain(E.packages([{ at: at(30), pr: 3 }, { at: at(0), pr: 1 }, { at: at(23), pr: 2 }])).map((p) => p.actions.map((e) => e.pr)), [[1, 2], [3]]);
  const prs = series(20, 'код', 0, 1, 10).concat(series(20, 'код', 20, 1, 5)).concat(series(3, 'UI', 40, 1, 1));
  // The package is PRs 18 and 19 themselves (minutes only in events.json): they and the PRs before them are «before».
  const [e] = plain(E.effects(prs, [{ at: at(18), pr: 18, category: 'моделі' }, { at: at(19), pr: 19, category: 'контекст' }]));
  assert.deepEqual(e.actions.map((x) => x.pr), [18, 19]);
  assert.deepEqual([e.code.before, e.code.after, e.code.after_n, e.code.change], [10, 5, 20, -50]);
  // Every PR the same: the interval is the change itself, not noise.
  assert.deepEqual([e.code.ci, e.code.noise], [[-50, -50], false]);
  assert.equal(e.ui.before, null);
  assert.deepEqual([e.all.before, e.all.after, e.all.after_n], [10, 4.5, 23]);
  // Uneven PRs on both sides with the same mean: the interval contains zero.
  const mixed = Array.from({ length: 40 }, (_, i) => ({ pr: i, at: at(i), type: 'код', items: i % 2 ? 4 : 1, w: i % 2 ? 2 : 30, cr: 0 }));
  const [m] = plain(E.effects(mixed, [{ at: at(19), pr: 19 }]));
  assert.equal(m.code.noise, true);
  assert.deepEqual(plain(E.interval(mixed.slice(0, 20), mixed.slice(20), 1)), plain(E.interval(mixed.slice(0, 20), mixed.slice(20), 1)), 'the same seed, the same interval');
});

test('PRC-02 (owner, 2026-11-28): placebo — the spread of the before/after change at every point of a type without any action', () => {
  // 60 PRs: a point at each of PRs 20…40. The price doubles from PR 50: the window after point k holds k − 30 dearer PRs
  // (+5 % each), so points 31…40 see +5…+50 %, five of them beyond +25 %.
  const prs = series(50, 'код', 0, 1, 10).concat(series(10, 'код', 50, 1, 20));
  const p = plain(E.placebo(prs));
  assert.equal(p['код'].points, 21);
  assert.deepEqual([p['код'].p10, p['код'].p90, p['код'].beyond25], [0, 40, 24]);
  assert.equal(p.UI, null);
});

test('PRC-02 (owner, 2026-11-28): the forecast is a range — PoC items left × the price over 7 and 14 days plus the lead per PR, dollars over all and the last 5 priced sessions', () => {
  const day = (d) => new Date(Date.UTC(2026, 10, d, 12)).toISOString();
  const prs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((d) => ({ pr: d, at: day(d), type: 'код', items: 10, cr: d <= 7 ? 20 : 50, w: 1 }));
  const cs = [{ at: day(1), pocCovered: 0, pocTotal: 900 }, { at: day(14), pocCovered: 500, pocTotal: 1000 }];
  const sessions = [{ name: 'a', usd: 100, prs: [1, 2, 3, 4, 5] }, { name: 'b', usd: 0, prs: [6] }, { name: 'c', usd: 300, prs: [13, 14, 5] }];
  const f = plain(E.forecast(prs, sessions, cs));
  assert.deepEqual([f.left, f.pocTotalFirst, f.per7, f.per14, f.withLead], [500, 900, 5, 3.5, false]);
  assert.deepEqual([f.tokensLowBn, f.tokensHighBn], [1.8, 2.5]);
  // #5 is in two sessions: it counts in the first only.
  assert.deepEqual([f.usdAll, f.usdLast5, f.usdLow, f.usdHigh], [5.71, 5.71, 2900, 2900]);
  assert.deepEqual([f.pace7, f.pace14, f.daysLow, f.daysHigh], [10, 10, 50, 50]);
  assert.equal(E.forecast([], sessions, cs), null);
  // The lead's own 20 млн over 2 PRs = 10 per PR; 1 PR per 10 items adds 1 млн per item.
  const g = plain(E.forecast(prs, [{ name: 'd', usd: null, lead: 20, prs: [13, 14] }], cs));
  assert.deepEqual([g.per7, g.per14, g.withLead], [6, 4.5, true]);
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
