#!/usr/bin/env node
// Requirements checker for docs/requirements. Zero dependencies, Node 22.
//
//   node tools/req-check/index.mjs                       check, print findings, exit 1 on new errors
//   node tools/req-check/index.mjs --report <file.md>    also write a Markdown report
//   node tools/req-check/index.mjs --update-baseline     accept all current errors into baseline.json
//   node tools/req-check/index.mjs --traceability        also write docs/traceability/ (matrix, releases, coverage)
//   node tools/req-check/index.mjs --impact <target>     list what depends on a requirement, slice, screen, board,
//                                                        П-rule, use case or module (transitively), then exit
//   node tools/req-check/index.mjs --views               write the release views generated from the requirement sources
//   node tools/req-check/index.mjs --convert <ID|all>    turn a card and its slice files into a source (only when the
//                                                        round trip is exact), write the views, report exceptions
//   node tools/req-check/index.mjs --move <ID> --items FR4,AC5 --to "PoC v2" [--from PoC]
//                                                        move items to another release (changes their tags), write the
//                                                        views, report dependents
//   node tools/req-check/index.mjs --coverage            per-item and per-release coverage by tests named by item
//   node tools/req-check/index.mjs --check-mentions      fail (exit 1) on a test that names an item its requirement
//                                                        does not have; prints file:line for each (CI, PRC-02)
//
// Options: --root <dir> (repository root, default cwd), --requirements <dir> (default docs/requirements),
// --baseline <file> (default tools/req-check/baseline.json), --no-baseline, --quiet,
// --traceability-dir <dir> (default docs/traceability).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, addMigrated, readMigratedFile } from './lib/corpus.mjs';
import { runChecks } from './lib/run.mjs';
import { readBaseline, applyBaseline, makeBaseline } from './lib/baseline.mjs';
import { renderReport } from './lib/report.mjs';
import { CHECKS } from './lib/findings.mjs';
import { loadRegistries } from './lib/registries.mjs';
import { renderTraceability } from './lib/traceability.mjs';
import { computeImpact, renderImpact } from './lib/impact.mjs';
import { convertRequirement, viewFileName } from './lib/source.mjs';
import { moveItems } from './lib/move.mjs';
import { findMentions, computeCoverage, renderCoverage, danglingMentions } from './lib/coverage.mjs';
import { SLICE_FILE_RE } from './lib/config.mjs';
import { buildModel } from './lib/model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Names of the files --traceability generates; only these are ever removed from the output folder. */
export const GENERATED_RE = /^(README|matrix|coverage|release-[a-z0-9-]+)\.md$/;

const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Resolve and create the --traceability output folder. It must lie inside the repository root (not the
 * root itself), outside the requirements folder, and must not be a symbolic link (also after resolving
 * links in its parents).
 */
export function traceabilityDir(root, reqDir, outDir) {
  const rootAbs = path.resolve(root);
  const reqAbs = path.resolve(root, reqDir);
  const abs = path.resolve(root, outDir);
  const check = (r, d, req) => {
    if (d === r || !inside(r, d)) throw new Error(`--traceability-dir must be a folder inside the repository root: ${outDir}`);
    if (inside(req, d)) throw new Error(`--traceability-dir must not be inside the requirements folder: ${outDir}`);
  };
  check(rootAbs, abs, reqAbs);
  if (fs.existsSync(abs) || isLink(abs)) {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw new Error(`--traceability-dir is a symbolic link; refusing to write: ${outDir}`);
    if (!st.isDirectory()) throw new Error(`--traceability-dir is not a folder: ${outDir}`);
  }
  fs.mkdirSync(abs, { recursive: true });
  const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
  check(real(rootAbs), real(abs), real(reqAbs));
  return abs;
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function parseArgs(argv) {
  const opts = { root: process.cwd(), requirements: 'docs/requirements', baseline: path.join(here, 'baseline.json'), facts: path.join(here, 'facts.json'), report: null, impact: null, views: false, convert: null, move: null, items: null, to: null, from: null, coverage: false, checkMentions: false, traceability: false, traceabilityDir: 'docs/traceability', updateBaseline: false, useBaseline: true, quiet: false, migratedBase: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--root') opts.root = next();
    else if (a === '--requirements') opts.requirements = next();
    else if (a === '--baseline') opts.baseline = next();
    else if (a === '--facts') opts.facts = next();
    else if (a === '--report') opts.report = next();
    else if (a === '--traceability') opts.traceability = true;
    else if (a === '--impact') opts.impact = next();
    else if (a === '--traceability-dir') opts.traceabilityDir = next();
    else if (a === '--views') opts.views = true;
    else if (a === '--convert') opts.convert = next();
    else if (a === '--move') opts.move = next();
    else if (a === '--items') opts.items = next();
    else if (a === '--to') opts.to = next();
    else if (a === '--from') opts.from = next();
    else if (a === '--coverage') opts.coverage = true;
    else if (a === '--check-mentions') opts.checkMentions = true;
    else if (a === '--update-baseline') opts.updateBaseline = true;
    else if (a === '--no-baseline') opts.useBaseline = false;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--migrated-base') opts.migratedBase = next();
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.move && (!opts.items || !opts.to)) throw new Error('--move needs --items and --to');
  return opts;
}

const reqPath = (root, rel) => path.resolve(root, rel);
const write = (root, rel, text) => {
  const p = reqPath(root, rel);
  if (fs.existsSync(p) && !fs.lstatSync(p).isFile()) throw new Error(`${rel} is not a regular file; refusing to overwrite it`);
  fs.writeFileSync(p, text);
};

/** Write the views of the given sources (all when ids is null); remove view files a source no longer lists. */
export function writeViews(root, corpus, ids = null) {
  let written = 0;
  let removed = 0;
  for (const s of corpus.sources) {
    if (ids && !ids.includes(s.id)) continue;
    const dir = path.dirname(reqPath(root, s.rel));
    for (const v of s.views.values()) {
      const p = reqPath(root, v.rel);
      if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === v.text) continue;
      write(root, v.rel, v.text);
      written++;
    }
    const keep = new Set([...s.views.keys()].map((r) => viewFileName(s.id, r)));
    for (const name of fs.readdirSync(dir)) {
      const m = SLICE_FILE_RE.exec(name);
      if (!m || m[1] !== s.id || keep.has(name) || !fs.lstatSync(path.join(dir, name)).isFile()) continue;
      fs.rmSync(path.join(dir, name));
      removed++;
    }
  }
  return { written, removed };
}

/** Convert cards with slice files to sources; only exact round trips are written. */
export function convertAll(root, reqDir, which) {
  const corpus = loadCorpus(root, reqDir);
  const model = buildModel(corpus);
  const done = [];
  const exceptions = [];
  const read = (rel) => fs.readFileSync(reqPath(root, rel), 'utf8');
  for (const f of model.features.values()) {
    if (which !== 'all' && f.id !== which) continue;
    if (!f.card || f.doc.source) continue;
    const slices = f.slices.map((s) => ({ release: s.release, text: read(s.doc.rel) }));
    if (!slices.length) {
      exceptions.push({ id: f.id, reason: 'a card without slice files' });
      continue;
    }
    const r = convertRequirement(f.id, read(f.doc.rel), slices);
    if (!r.ok) {
      exceptions.push({ id: f.id, reason: r.reason });
      continue;
    }
    write(root, f.doc.rel, r.source);
    for (const s of f.slices) write(root, s.doc.rel, r.views.get(s.release));
    done.push(f.id);
  }
  if (which !== 'all' && !done.length && !exceptions.length) throw new Error(`--convert: ${which} is not a card with slice files (or is already a source)`);
  return { done, exceptions };
}

/** Test files of the repository (apps, packages, tools), as {rel, text}. */
export function loadTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isSymbolicLink() || e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) out.push({ rel: path.relative(root, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
    }
  };
  for (const top of ['apps', 'packages', 'tools']) walk(path.resolve(root, top));
  return out;
}

// GitHub workflow-command escaping: data encodes % CR LF; properties also encode : and ,
const escData = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (v) => escData(v).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Print one finding as `LEVEL file:line [rule] message`, plus a GitHub annotation when run in Actions. */
function printFinding(log, f, level) {
  const file = String(f.file).replace(/[\r\n]/g, ' ');
  log(`${level.toUpperCase()} ${file}:${f.line} [${f.rule}] ${String(f.message).replace(/[\r\n]+/g, ' ')}`);
  if (process.env.GITHUB_ACTIONS === 'true') log(`::${level} file=${escProp(f.file)},line=${Math.max(1, f.line)},title=${escProp(`req-check ${f.rule}`)}::${escData(f.message)}`);
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log('usage: node tools/req-check/index.mjs [--report file.md] [--impact ID|S-id|board|П-n|UC-id|module] [--traceability] [--traceability-dir dir] [--views] [--coverage] [--check-mentions] [--update-baseline] [--no-baseline] [--migrated-base base-migrated.json] [--root dir]');
    return 0;
  }
  if (opts.convert) {
    const { done, exceptions } = convertAll(opts.root, opts.requirements, opts.convert);
    if (done.length) addMigrated(opts.root, done);
    log(`req-check: converted ${done.length} requirements to sources; round trip byte-identical for every view (apart from the view header).`);
    if (exceptions.length) log(`req-check: not converted (kept as card + slice files): ${exceptions.map((e) => `${e.id} (${e.reason})`).join('; ')}`);
    return 0;
  }
  if (opts.move) {
    const corpus0 = loadCorpus(opts.root, opts.requirements);
    const s = corpus0.sources.find((x) => x.id === opts.move);
    if (!s) throw new Error(`--move: ${opts.move} is not a requirement source`);
    const res = moveItems(fs.readFileSync(reqPath(opts.root, s.rel), 'utf8'), s.id, { items: opts.items.split(',').map((x) => x.trim()).filter(Boolean), to: opts.to, from: opts.from ?? undefined });
    write(opts.root, s.rel, res.text);
    const corpus1 = loadCorpus(opts.root, opts.requirements);
    writeViews(opts.root, corpus1, [s.id]);
    log(renderMove(opts, res, loadCorpus(opts.root, opts.requirements)));
    return 0;
  }
  let migratedBase;
  if (opts.migratedBase) {
    migratedBase = readMigratedFile(path.resolve(opts.migratedBase));
    if (!migratedBase) throw new Error(`--migrated-base: file not found: ${opts.migratedBase}`);
  }
  const corpus = loadCorpus(opts.root, opts.requirements, migratedBase ? { migratedBase } : {});
  const factsSpec = JSON.parse(fs.readFileSync(opts.facts, 'utf8'));
  const registries = loadRegistries(opts.root);
  const result = runChecks(corpus, factsSpec, registries);

  if (opts.impact) {
    const impact = computeImpact(result.model, registries, opts.impact);
    if (!impact) throw new Error(`--impact: "${opts.impact}" is not a known requirement, slice, screen, board name, П-rule, use case or module`);
    log(renderImpact(impact));
    return 0;
  }

  if (opts.coverage || opts.checkMentions) {
    const cov = computeCoverage(result.model, findMentions(loadTestFiles(opts.root)));
    if (opts.coverage) log(renderCoverage(cov));
    if (!opts.checkMentions) return 0;
    const dangling = danglingMentions(cov);
    for (const f of dangling) printFinding(log, f, 'error');
    log(`req-check: ${dangling.length} test mentions name no item${dangling.length ? ' (listed above as file:line)' : ''}.`);
    return dangling.length ? 1 : 0;
  }

  if (opts.views) {
    const { written, removed } = writeViews(opts.root, corpus);
    addMigrated(opts.root, corpus.sources.map((x) => x.id));
    log(`req-check: views written from ${corpus.sources.length} sources (${written} files changed, ${removed} removed)`);
    // Check what is on disk now.
    return main(argv.filter((a) => a !== '--views'), log);
  }

  if (opts.updateBaseline) {
    const doc = makeBaseline(result.findings);
    fs.writeFileSync(opts.baseline, `${JSON.stringify(doc, null, 2)}\n`);
    log(`req-check: baseline written with ${doc.findings.length} entries to ${path.relative(process.cwd(), opts.baseline)}`);
  }

  const baseline = opts.useBaseline ? readBaseline(opts.baseline) : { findings: [] };
  const { findings, stale } = applyBaseline(result.findings, baseline);
  const errors = findings.filter((f) => f.severity === 'error' && !f.baselined);
  const baselined = findings.filter((f) => f.baselined);
  const warnings = findings.filter((f) => f.severity === 'warning');

  const print = (f, level) => printFinding(log, f, level);
  for (const f of errors) print(f, 'error');
  if (!opts.quiet) for (const f of warnings) print(f, 'warning');

  if (opts.report) {
    const md = renderReport({
      corpus,
      result,
      findings,
      stale,
      baselineSize: baseline.findings.length,
      factsSpec,
      command: `node tools/req-check/index.mjs --report ${opts.report}`,
    });
    const out = path.resolve(opts.root, opts.report);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md);
    log(`req-check: report written to ${path.relative(process.cwd(), out)}`);
  }

  if (opts.traceability) {
    const dir = traceabilityDir(opts.root, opts.requirements, opts.traceabilityDir);
    const files = renderTraceability(result.model, registries, opts.traceabilityDir.split(path.sep).join('/'));
    for (const name of fs.readdirSync(dir)) {
      if (!GENERATED_RE.test(name) || files.has(name)) continue;
      if (!fs.lstatSync(path.join(dir, name)).isFile()) continue; // never follow or remove links and folders
      fs.rmSync(path.join(dir, name));
    }
    for (const [name, text] of files) {
      const p = path.join(dir, name);
      if (fs.existsSync(p) && !fs.lstatSync(p).isFile()) throw new Error(`--traceability: ${p} is not a regular file; refusing to overwrite it`);
      fs.writeFileSync(p, text);
    }
    log(`req-check: traceability written to ${path.relative(process.cwd(), dir) || '.'} (${files.size} files)`);
  }

  const perCheck = CHECKS.map((c) => `${c} ${findings.filter((f) => f.check === c && f.severity === 'error' && !f.baselined).length}`).join(', ');
  log(`req-check: ${corpus.docs.filter((d) => d.kind === 'requirement').length} requirement files, ${corpus.docs.filter((d) => d.kind === 'slice').length} slice files (${corpus.docs.filter((d) => d.generated).length} generated from ${corpus.sources.length} sources); ${errors.length} new errors (${perCheck}); ${baselined.length} baselined; ${warnings.length} warnings; baseline ${baseline.findings.length} entries${stale.length ? `, ${stale.length} stale` : ''}.`);
  if (stale.length && !opts.quiet) log(`req-check: stale baseline entries (fixed, remove them): ${stale.join(', ')}`);
  return errors.length ? 1 : 0;
}

/** Report of a --move: what changed, dependents (--impact) and mentions of the moved items' key phrases. */
function renderMove(opts, res, corpus) {
  const registries = loadRegistries(opts.root);
  const model = buildModel(corpus);
  const L = [`# Move ${opts.move}: ${opts.items} → ${opts.to}`, ''];
  for (const m of res.moved) {
    L.push(`- ${m.ref}: source lines ${m.lines.join(', ')}`);
    m.after.forEach((a, i) => L.push(`  - \`${m.before[i].slice(0, 70)}\` → \`${a.slice(0, 70)}\``));
  }
  L.push('', `Views changed: ${res.changed.map((r) => `${opts.move}@${r}`).join(', ') || 'none'} (regenerated).`, '');
  for (const v of res.variants) L.push(`**Check:** in ${opts.move}@${v.release} source line ${v.line} now sits beside line ${v.other}, which starts the same way: probably two wordings of one item; keep one.`, '');
  L.push('Update by hand if needed: the card part (the «Реліз» line and the table of slices), the module README row.', '');
  const num = (n) => (n === null ? 'no longer in that view' : `now ${n}`);
  if (res.shifts.length) {
    L.push('## Item numbers that changed', '');
    L.push(res.shifts.map((s) => `- ${opts.move}@${s.release} ${s.kind}${s.from}: ${num(s.to)}`).join('\n'), '');
  }
  if (res.citations.length) {
    L.push('## Warning: citations of changed numbers in the source', '');
    L.push(res.citations.map((c) => `- source line ${c.line}: «${c.ref}» in ${opts.move}@${c.release} is ${num(c.to)}; reword or renumber it`).join('\n'), '');
  }
  if (res.selfMentions.length) {
    L.push('## Warning: the moved items are still mentioned in the same requirement', '');
    L.push(res.selfMentions.map((m) => `- «${m.phrase}» — source line ${m.line}`).join('\n'), '');
  }
  const refs = staleRefs(opts.root, opts.move, res);
  if (refs.length) {
    L.push('## Warning: tests and docs that cite changed numbers', '');
    L.push(refs.map((r) => `- ${r.file}:${r.line} — ${opts.move}@${r.release} ${r.kind}${r.n} is ${num(r.to)}${r.plain ? ' (plain ID read as its first view)' : ''}`).join('\n'), '');
  }
  const seen = new Set();
  for (const r of res.changed) {
    const imp = computeImpact(model, registries, `${opts.move}@${r}`);
    if (!imp) continue;
    const rows = imp.slices.filter((a) => a.slice.id !== opts.move && !seen.has(a.slice.sid));
    for (const a of rows) seen.add(a.slice.sid);
    L.push(`## Dependents of ${opts.move}@${r} (--impact)`, '');
    L.push(rows.length ? rows.map((a) => `- ${a.slice.sid} — ${a.why}${a.via ? ` (via ${a.via})` : ''}`).join('\n') : 'None.', '');
  }
  L.push('## Key phrases of the moved items elsewhere', '');
  const hits = grepPhrases(opts.root, res.phrases, opts.move);
  L.push(hits.length ? hits.map((h) => `- «${h.phrase}» — ${h.file}:${h.line}`).join('\n') : 'None.', '');
  return L.join('\n');
}

/**
 * Mentions of the moved requirement's items by number («BUD-12 FR 9», «BUD-12@PoC AC3») in test files and in
 * docs outside generated files and the decision log (all of `docs/decisions/`: the archive `state-*.md` and the
 * per-decision files in `log/`; a decision quotes numbers as they were), whose number changed in that view.
 * A plain ID is read as --coverage reads it: the release named for it elsewhere in the file, else its first view.
 */
function staleRefs(root, id, res) {
  if (!res.shifts.length) return [];
  const files = loadTestFiles(root);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (!['docs/traceability', 'docs/validation', 'docs/decisions'].includes(rel)) walk(p);
      } else if (e.name.endsWith('.md')) {
        const text = fs.readFileSync(p, 'utf8');
        if (!text.split('\n')[1]?.startsWith('> Згенеровано з ')) files.push({ rel, text });
      }
    }
  };
  walk(path.resolve(root, 'docs'));
  const out = [];
  for (const m of findMentions(files)) {
    if (m.id !== id) continue;
    const release = m.release ?? res.releases[0];
    const s = res.shifts.find((q) => q.release === release && q.kind === m.kind && q.from === m.n);
    if (s) out.push({ file: m.file, line: m.line, release, kind: m.kind, n: m.n, to: s.to, plain: !m.release });
  }
  return out;
}

/** Lines in docs/requirements, docs/ux, apps and packages that contain a phrase (other requirements only). */
function grepPhrases(root, phrases, id, limit = 40) {
  const hits = [];
  if (!phrases.length) return hits;
  const walk = (dir) => {
    if (!fs.existsSync(dir) || hits.length >= limit) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isSymbolicLink() || e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|tsx?|mjs|json)$/.test(e.name) && !e.name.startsWith(`${id}.`)) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        if (lines[1]?.startsWith('> Згенеровано з ')) continue; // a generated view: its source is searched
        lines.forEach((line, i) => {
          for (const ph of phrases) if (hits.length < limit && line.includes(ph)) hits.push({ phrase: ph, file: rel, line: i + 1 });
        });
      }
    }
  };
  for (const top of ['docs/requirements', 'docs/ux', 'apps', 'packages']) walk(path.resolve(root, top));
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`req-check: ${e.message}`);
    process.exitCode = 2;
  }
}
