// The committed Semgrep ruleset finds known-bad code and blocks the job; the safe forms pass. Needs semgrep
// (WS_SEMGREP or `semgrep` on PATH; tools/security-scan/README.md). The job `security` installs it before these run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { semgrepArgs } from '../index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const CLI = join(HERE, '..', 'index.mjs');
const SEMGREP = process.env.WS_SEMGREP || 'semgrep';
const RULES = readFileSync(join(HERE, '..', 'semgrep', 'rules.yml'), 'utf8');
const RULE_IDS = [...RULES.matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1]);

/** The fixtures copied to a fresh folder with their real extensions (`bad.ts.txt` → `bad.ts`). */
function workdir(only) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-semgrep-'));
  for (const f of readdirSync(FIXTURES)) {
    if (!f.endsWith('.txt') || (only && !only.test(f))) continue;
    copyFileSync(join(FIXTURES, f), join(dir, f.replace(/\.txt$/, '')));
  }
  return dir;
}

function scan(dir) {
  const run = spawnSync(SEMGREP, semgrepArgs(['.']), { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.ok(!run.error && run.stdout, `semgrep did not run (${run.error?.message ?? run.stderr}); install it: tools/security-scan/README.md`);
  const json = JSON.parse(run.stdout);
  assert.deepEqual(json.errors.filter((e) => e.level === 'error'), [], 'the ruleset loads without errors');
  return json.results.map((r) => ({ file: r.path, start: r.start.line, end: r.end.line, rule: r.check_id.split('.').pop(), severity: r.extra.severity }));
}

/** `// expect: <rule>` markers of a fixture, after its two header lines. */
function expectations(file) {
  return readFileSync(join(FIXTURES, `${file}.txt`), 'utf8')
    .split('\n')
    .flatMap((l, i) => {
      const m = i > 1 && /\/\/ expect: (\S+)/.exec(l);
      return m ? [{ file, line: i + 1, rule: m[1] }] : [];
    });
}

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: every rule finds its known-bad snippet, as High or Critical', () => {
  const dir = workdir(/^bad\./);
  try {
    const found = scan(dir);
    const expected = [...expectations('bad.ts'), ...expectations('bad.tsx')];
    for (const e of expected) {
      assert.ok(
        found.some((f) => f.file === e.file && f.rule === e.rule && f.start <= e.line && e.line <= f.end),
        `${e.rule} must find ${e.file}:${e.line}`,
      );
    }
    for (const f of found) {
      assert.ok(expected.some((e) => e.file === f.file && e.rule === f.rule && f.start <= e.line && e.line <= f.end), `unexpected ${f.rule} at ${f.file}:${f.start}`);
      assert.equal(f.severity, 'ERROR', `${f.rule}: blocking rules are ERROR (High or Critical)`);
    }
    // Every rule of the ruleset has at least one known-bad snippet, so none can silently stop matching.
    assert.deepEqual([...new Set(expected.map((e) => e.rule))].sort(), [...RULE_IDS].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: the safe forms the codebase uses give no finding', () => {
  const dir = workdir(/^good\./);
  try {
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: a High finding fails the job (exit 1, annotation on the line); an inline nosemgrep does not hide it', () => {
  const dir = workdir(/^bad\.ts\./);
  try {
    // An inline suppression without a reason or review date is ignored (--disable-nosem): accepted findings go to the allowlist.
    const src = join(dir, 'bad.ts');
    const text = readFileSync(src, 'utf8').replace('eval(input); // expect: ws-eval', 'eval(input); // nosemgrep');
    writeFileSync(src, text);
    const run = spawnSync(process.execPath, [CLI, 'sast', '--semgrep', SEMGREP, dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /::error file=[^,]*bad\.ts,line=16,title=ws-eval \(Critical\)::/);
    assert.match(run.stdout, /::error file=[^,]*bad\.ts,line=\d+,title=ws-sql-template-interpolation \(High\)::SQL text built with a template-literal interpolation\. Pass values as numbered query parameters;/);
    assert.match(run.stdout, /SAST: \d+ blocking, 0 allowlisted, 0 below High — FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: safe code passes the job (exit 0)', () => {
  const dir = workdir(/^good\./);
  try {
    const run = spawnSync(process.execPath, [CLI, 'sast', '--semgrep', SEMGREP, dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /SAST: 0 blocking, 0 allowlisted, 0 below High — passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
