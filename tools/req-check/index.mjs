#!/usr/bin/env node
// Requirements checker for docs/requirements. Zero dependencies, Node 22.
//
//   node tools/req-check/index.mjs                       check, print findings, exit 1 on new errors
//   node tools/req-check/index.mjs --report <file.md>    also write a Markdown report
//   node tools/req-check/index.mjs --update-baseline     accept all current errors into baseline.json
//
// Options: --root <dir> (repository root, default cwd), --requirements <dir> (default docs/requirements),
// --baseline <file> (default tools/req-check/baseline.json), --no-baseline, --quiet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib/corpus.mjs';
import { runChecks } from './lib/run.mjs';
import { readBaseline, applyBaseline, makeBaseline } from './lib/baseline.mjs';
import { renderReport } from './lib/report.mjs';
import { CHECKS } from './lib/findings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const opts = { root: process.cwd(), requirements: 'docs/requirements', baseline: path.join(here, 'baseline.json'), facts: path.join(here, 'facts.json'), report: null, updateBaseline: false, useBaseline: true, quiet: false };
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
    else if (a === '--update-baseline') opts.updateBaseline = true;
    else if (a === '--no-baseline') opts.useBaseline = false;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log('usage: node tools/req-check/index.mjs [--report file.md] [--update-baseline] [--no-baseline] [--root dir]');
    return 0;
  }
  const corpus = loadCorpus(opts.root, opts.requirements);
  const factsSpec = JSON.parse(fs.readFileSync(opts.facts, 'utf8'));
  const result = runChecks(corpus, factsSpec);

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

  const gha = process.env.GITHUB_ACTIONS === 'true';
  // GitHub workflow-command escaping: data encodes % CR LF; properties also encode : and ,
  const escData = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escProp = (v) => escData(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const print = (f, level) => {
    const file = String(f.file).replace(/[\r\n]/g, ' ');
    log(`${level.toUpperCase()} ${file}:${f.line} [${f.rule}] ${String(f.message).replace(/[\r\n]+/g, ' ')}`);
    if (gha) log(`::${level} file=${escProp(f.file)},line=${Math.max(1, f.line)},title=${escProp(`req-check ${f.rule}`)}::${escData(f.message)}`);
  };
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

  const perCheck = CHECKS.map((c) => `${c} ${findings.filter((f) => f.check === c && f.severity === 'error' && !f.baselined).length}`).join(', ');
  log(`req-check: ${corpus.docs.filter((d) => d.kind === 'requirement').length} requirement files; ${errors.length} new errors (${perCheck}); ${baselined.length} baselined; ${warnings.length} warnings; baseline ${baseline.findings.length} entries${stale.length ? `, ${stale.length} stale` : ''}.`);
  if (stale.length && !opts.quiet) log(`req-check: stale baseline entries (fixed, remove them): ${stale.join(', ')}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`req-check: ${e.message}`);
    process.exitCode = 2;
  }
}
