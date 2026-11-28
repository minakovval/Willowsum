#!/usr/bin/env node
// History of the progress page (PRC-02, owner decision 2026-11-28,
// docs/decisions/log/2026-11-28-owner-dashboard-token-efficiency.md): one point per merge to main
// [commit, time UTC, PR, distinct items covered, PoC items covered, PoC items total]. The page's «Ціна пункту вимоги»
// takes the items a PR adds from the growth of the distinct count at its merge commit.
//
//   node tools/progress-dashboard/history.mjs --seed history-seed.json [--prev published-history.json]
//     --coverage coverage.json --subject "<commit subject>" --at <ISO time> --out history.json
//
// The output is the seed's points, then the points of --prev after the seed's last commit, then this commit's point,
// once per commit. A missing or broken --prev is skipped with a warning (the points after the seed are then lost, the
// page still works). Run by .github/workflows/progress-dashboard.yml in the read-only job `build`; no network.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export class UsageError extends Error {}

const SHA = /^[0-9a-f]{8}$/;
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** A point is [commit (8 hex), ISO time, PR number or null, distinct covered, PoC covered, PoC total]. */
export function isPoint(p) {
  return Array.isArray(p) && p.length === 6 && SHA.test(p[0]) && typeof p[1] === 'string' && !Number.isNaN(Date.parse(p[1]))
    && (p[2] === null || isCount(p[2])) && isCount(p[3]) && isCount(p[4]) && isCount(p[5]) && p[4] <= p[5];
}

function checkFile(j, what) {
  if (!j || j.schema !== 1 || !Array.isArray(j.points)) throw new UsageError(`${what}: not a history file (schema 1, points)`);
  const bad = j.points.findIndex((p) => !isPoint(p));
  if (bad >= 0) throw new UsageError(`${what}: point ${bad} is not [commit, time, PR, covered, PoC covered, PoC total]`);
  return j;
}

/** The PR number of a squash-merge subject «Title (#123)», else null. */
export function prOf(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject || '');
  return m ? Number(m[1]) : null;
}

/** This commit's point from coverage.json (req-check --coverage-json, with `distinct`). */
export function pointOf(coverage, { subject, at }) {
  const poc = (coverage?.releases || []).find((r) => r.release === 'PoC');
  if (!coverage || !SHA.test(String(coverage.sha || '').slice(0, 8)) || !isCount(coverage.distinct?.covered) || !poc) {
    throw new UsageError('coverage: needs sha, distinct.covered and the PoC release');
  }
  const p = [coverage.sha.slice(0, 8), new Date(at).toISOString().replace('.000Z', 'Z'), prOf(subject), coverage.distinct.covered, poc.items.covered, poc.items.total];
  if (!isPoint(p)) throw new UsageError(`coverage: bad point ${JSON.stringify(p)}`);
  return p;
}

/** Seed points, then --prev points after the seed's last commit, then `point`; each commit once. */
export function merge(seed, prev, point) {
  const points = seed.points.slice();
  const seen = new Set(points.map((p) => p[0]));
  if (prev) {
    const i = prev.points.findIndex((p) => p[0] === points[points.length - 1]?.[0]);
    for (const p of i >= 0 ? prev.points.slice(i + 1) : []) if (!seen.has(p[0])) { points.push(p); seen.add(p[0]); }
  }
  if (!seen.has(point[0])) points.push(point);
  return { schema: 1, generatedAt: point[1], umbrella: seed.umbrella || {}, corrections: seed.corrections || [], points };
}

export function main(argv, io = { warn: (m) => console.error(m) }) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    if (!['seed', 'prev', 'coverage', 'subject', 'at', 'out'].includes(k) || argv[i + 1] == null) throw new UsageError(`unknown or empty option ${argv[i]}`);
    opts[k] = argv[i + 1];
  }
  for (const k of ['seed', 'coverage', 'subject', 'at', 'out']) if (!opts[k]) throw new UsageError(`--${k} is required`);
  if (Number.isNaN(Date.parse(opts.at))) throw new UsageError('--at: not a time');
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const seed = checkFile(read(opts.seed), 'seed');
  let prev = null;
  if (opts.prev) {
    try { prev = checkFile(read(opts.prev), 'prev'); } catch (e) { io.warn(`history: published history skipped (${e.message})`); }
  }
  const out = merge(seed, prev, pointOf(read(opts.coverage), opts));
  fs.writeFileSync(opts.out, JSON.stringify(out) + '\n');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const out = main(process.argv.slice(2));
    console.log(`history: ${out.points.length} points, last ${out.points[out.points.length - 1].join(' ')}`);
  } catch (e) {
    console.error(`history: ${e.message}`);
    process.exit(1);
  }
}
