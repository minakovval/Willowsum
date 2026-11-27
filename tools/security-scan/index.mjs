#!/usr/bin/env node
// Blocking SAST and SCA (CICD-02 «Статичний аналіз безпеки коду», «Вразливості залежностей»; NFR-01 «Вразливості»).
//
//   node tools/security-scan/index.mjs sast [--semgrep <binary>] [path ...]   Semgrep with the committed ruleset, offline
//   node tools/security-scan/index.mjs sca                                    pnpm audit of the production dependencies
//   node tools/security-scan/index.mjs allowlist                              only the allowlist's shape and review dates
//
// Exit 1 on any High or Critical finding that the allowlist does not accept, on an allowlist entry past its review
// date or no longer matching anything, and when a scanner did not run. How to install Semgrep: README.md here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateSast, evaluateSca, isoDay, summarize, validateAllowlist } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const RULES = join(HERE, 'semgrep/rules.yml');
export const ALLOWLIST = join(HERE, 'allowlist.json');
/** What the full scan covers: production code and the repository tools (tests and fixtures: .semgrepignore). */
export const DEFAULT_TARGETS = ['apps', 'packages', 'tools', 'infra'];

/** Semgrep arguments: the committed rules only, no registry, no metrics, inline `nosemgrep` comments ignored. */
export function semgrepArgs(targets) {
  return ['scan', '--config', RULES, '--metrics', 'off', '--disable-version-check', '--disable-nosem', '--json', '--quiet', ...targets];
}

function readAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
}

function report(kind, result, problems) {
  const { ok, lines, annotations } = summarize(kind, result, problems);
  for (const l of lines) console.log(l);
  for (const a of annotations) console.log(a);
  return ok;
}

function sast(args) {
  let semgrep = process.env.WS_SEMGREP || 'semgrep';
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--semgrep') semgrep = args[++i];
    else targets.push(args[i]);
  }
  const fullScan = targets.length === 0;
  const run = spawnSync(semgrep, semgrepArgs(fullScan ? DEFAULT_TARGETS : targets), {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error || !run.stdout) {
    console.log(`::error::semgrep did not run (${run.error?.message ?? run.stderr?.trim() ?? 'no output'}). Install it: tools/security-scan/README.md`);
    return false;
  }
  // Without --error, semgrep exits 0 with findings; any other status means the scan did not finish: fail closed.
  if (run.status !== 0) {
    console.log(`::error::semgrep exited with status ${run.status}: ${run.stderr?.trim().slice(0, 2000)}`);
    return false;
  }
  const json = JSON.parse(run.stdout);
  const partial = (json.errors ?? []).filter((e) => e.level !== 'error');
  if (partial.length) console.log(`note: ${partial.length} file(s) parsed only partly (${partial.map((e) => e.path).filter(Boolean).join(', ')})`);
  console.log(`semgrep ${json.version ?? ''}: ${json.paths?.scanned?.length ?? 0} files scanned`);
  const cache = new Map();
  const sourceOf = (path, start, end) => {
    if (!cache.has(path)) cache.set(path, readFileSync(resolve(ROOT, path), 'utf8').split('\n'));
    return cache.get(path).slice(start - 1, end).join('\n');
  };
  const allowlist = readAllowlist();
  const problems = validateAllowlist(allowlist, isoDay(new Date()));
  const result = evaluateSast(json, allowlist, sourceOf, { fullScan });
  return report('sast', result, problems);
}

function sca() {
  // pnpm audit exits non-zero when it finds anything; its JSON on stdout is what counts.
  let out;
  try {
    out = execFileSync('pnpm', ['audit', '--prod', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = e.stdout;
  }
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    json = null;
  }
  const allowlist = readAllowlist();
  const problems = validateAllowlist(allowlist, isoDay(new Date()));
  const result = evaluateSca(json, allowlist);
  if (json?.metadata) console.log(`pnpm audit: ${json.metadata.totalDependencies} production dependencies`);
  return report('sca', result, problems);
}

function allowlistOnly() {
  const problems = validateAllowlist(readAllowlist(), isoDay(new Date()));
  for (const p of problems) console.log(`::error file=${relative(ROOT, ALLOWLIST)}::${p}`);
  console.log(`allowlist: ${problems.length === 0 ? 'valid' : `${problems.length} problem(s)`}`);
  return problems.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const ok = cmd === 'sast' ? sast(rest) : cmd === 'sca' ? sca() : cmd === 'allowlist' ? allowlistOnly() : null;
  if (ok === null) {
    console.error('usage: node tools/security-scan/index.mjs sast [--semgrep <binary>] [path ...] | sca | allowlist');
    process.exit(2);
  }
  process.exit(ok ? 0 : 1);
}
