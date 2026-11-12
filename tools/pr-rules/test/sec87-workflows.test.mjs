// Security review of PR #87 (CICD-01): workflow injection and token hardening of the PR-rule workflows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** YAML without comment lines and trailing ` # …` comments. */
const code = (text) => text.replace(/^\s*#.*$/gm, '').replace(/\s#\s.*$/gm, '');
const PR_RULES = ['.github/workflows/pr-sensitive-label.yml', '.github/workflows/pr-description.yml', '.github/workflows/daily-main-check.yml'];
const ALL = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((n) => /\.ya?ml$/.test(n)).map((n) => `.github/workflows/${n}`);

/** Every `run:` script, inline or as a block scalar (`run: |` / `run: >`), with its line number. */
export function runScripts(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    if (/^[|>][-+]?\s*(#.*)?$/.test(m[2])) {
      const body = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^(\s*)/.exec(lines[j])[1].length > indent); j++) body.push(lines[j]);
      out.push({ line: i + 1, script: body.join('\n') });
    } else {
      out.push({ line: i + 1, script: m[2] });
    }
  }
  return out;
}

/** Expressions that are safe inside a shell script: no attacker-controlled text. */
const SAFE_EXPR = /^\s*(?:github\.(?:workspace|run_id|run_number|run_attempt|repository|server_url|api_url|sha|token|event\.pull_request\.number|event\.number)|runner\.\w+|env\.[A-Z_]+|secrets\.GITHUB_TOKEN|matrix\.[\w-]+|steps\.[\w-]+\.outcome)\s*$/;

test('SEC87: runScripts finds inline and block-scalar scripts (self-test of the probe)', () => {
  const yml = 'jobs:\n  a:\n    steps:\n      - run: echo 1\n      - name: x\n        run: |\n          echo "${{ github.head_ref }}"\n          echo 2\n      - run: >-\n          echo 3\n      - uses: x\n';
  const s = runScripts(yml);
  assert.equal(s.length, 3);
  assert.match(s[1].script, /github\.head_ref/);
  assert.match(s[2].script, /echo 3/);
});

test('SEC87: no `${{ }}` expression with untrusted text reaches any shell script (inline or block)', () => {
  for (const wf of ALL) {
    for (const { line, script } of runScripts(read(wf))) {
      for (const m of script.matchAll(/\$\{\{([^}]*)\}\}/g)) {
        assert.match(m[1], SAFE_EXPR, `${wf}:${line}: ${m[0]}`);
      }
    }
  }
});

test('SEC87: PR-rule workflows pass event data only through the event file or env, never as script arguments', () => {
  for (const wf of PR_RULES) {
    const text = read(wf);
    assert.doesNotMatch(text, /github\.(?:head_ref|event\.(?:pull_request\.(?:title|body|head\.ref|head\.label)|comment|review|commits|head_commit|issue))/, wf);
    assert.doesNotMatch(text, /actions\/github-script/, `${wf}: no inline JS with interpolated expressions`);
    for (const { line, script } of runScripts(text)) {
      // The only programs run are node on files of this repository.
      assert.match(script.trim(), /^node (?:--test )?tools\/pr-rules(?:\/index\.mjs \w+)?(?:\s|$)/, `${wf}:${line}`);
      // Shell variables are always quoted.
      // (`${VAR:+--flag "$VAR"}` expands to nothing or to the quoted value.)
      const plain = script.replace(/\$\{[A-Z_]+:\+[^"}]*"\$[A-Z_]+"\}/g, '');
      for (const v of plain.matchAll(/(.)\$\{?([A-Z_]+)/g)) assert.equal(v[1], '"', `${wf}:${line}: unquoted $${v[2]}`);
    }
  }
});

test('SEC87: every PR-rule job has a timeout; checks that alert have a concurrency group', () => {
  for (const wf of PR_RULES) {
    const text = read(wf);
    const jobsBlock = /^jobs:\n([\s\S]*)/m.exec(text)[1];
    const jobs = [...jobsBlock.matchAll(/^ {2}([\w-]+):\n((?: {4,}.*\n|\s*\n)*)/gm)];
    assert.ok(jobs.length > 0, wf);
    for (const [, name, body] of jobs) assert.match(body, /^ {4}timeout-minutes: \d+$/m, `${wf}: ${name}`);
  }
  assert.match(read('.github/workflows/daily-main-check.yml'), /^concurrency:\n {2}group: daily-main-check\n {2}cancel-in-progress: false$/m);
  assert.match(read('.github/workflows/pr-description.yml'), /^concurrency:\n {2}group: pr-description-\$\{\{ github\.event\.pull_request\.number \}\}/m);
});

test('SEC87: the label job runs on pull_request only and never on fork-privileged triggers or comments', () => {
  const label = code(read('.github/workflows/pr-sensitive-label.yml'));
  const on = /^on:\n((?: {2,}.*\n)*)/m.exec(label)[1];
  assert.deepEqual([...on.matchAll(/^ {2}([\w_]+):/gm)].map((m) => m[1]), ['pull_request']);
  assert.doesNotMatch(label, /issue_comment|pull_request_review|workflow_run|pull_request_target/);
  // The write token is only `pull-requests`; the workflow-level default is empty.
  assert.match(label, /^permissions: \{\}$/m);
  assert.doesNotMatch(label, /(?:contents|issues|actions|checks|statuses|id-token|packages):\s*write/);
});

test('SEC87: the label command refuses to write on a fork PR (read-only token, no labels)', () => {
  const index = read('tools/pr-rules/index.mjs');
  const fork = index.indexOf('if (pr.head?.repo?.full_name !== gh.repo) {');
  assert.ok(fork > 0, 'fork check present');
  const firstWrite = Math.min(index.indexOf('await ensureLabel(', fork), index.indexOf('await gh.post(', fork));
  assert.ok(index.slice(fork, firstWrite).includes('return;'), 'fork check returns before any write');
  assert.ok(index.indexOf('await ensureLabel(') > fork, 'no label write before the fork check');
  // Labels are fixed names, never built from file paths or PR text.
  assert.match(read('tools/pr-rules/lib/paths.mjs'), /return \['sensitive', \.\.\.classification\.categories\.map\(\(c\) => `sensitive:\$\{c\}`\)\];/);
});

test('SEC87: the daily check needs no secret beyond the job token and checks out without credentials', () => {
  const daily = code(read('.github/workflows/daily-main-check.yml'));
  assert.doesNotMatch(daily, /secrets\./);
  assert.match(daily, /SINCE: \$\{\{ inputs\.since \}\}/);
  assert.match(daily, /\$\{SINCE:\+--since "\$SINCE"\} \$\{UNTIL:\+--until "\$UNTIL"\}/);
});

