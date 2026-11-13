// PRC-02 (owner, 2026-11-13): `local` runs the description check and the label decision before a push or a body
// PATCH, on the branch's diff against the base — the same functions as the CI jobs, with the file list from git.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseNameStatus } from '../lib/local.mjs';

const INDEX = new URL('../index.mjs', import.meta.url).pathname;

test('parseNameStatus: added, modified, removed, renamed (old name first) in the API shape', () => {
  const text = ['A', 'a.md', 'M', 'b.ts', 'D', 'c.ts', 'R087', 'infra/start/x.tf', 'apps/web/x.ts', ''].join('\0');
  assert.deepEqual(parseNameStatus(text), [
    { filename: 'a.md', status: 'added' },
    { filename: 'b.ts', status: 'modified' },
    { filename: 'c.ts', status: 'removed' },
    { filename: 'apps/web/x.ts', previous_filename: 'infra/start/x.tf', status: 'renamed' },
  ]);
});

/** A throwaway repository: `main` with a requirement file, a branch that changes `files`. */
function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-local-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  git('init', '-q', '-b', 'main');
  write('docs/requirements/prc/PRC-02.md', '# PRC-02\n');
  write('infra/start/x.tf', 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'work');
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      git('mv', 'infra/start/x.tf', rel);
    }
    else write(rel, text);
  }
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  return root;
}

function run(root, args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [INDEX, 'local', '--root', root, '--base', 'main', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, stdout: e.stdout };
  }
}

const BODY = '## Requirement\nx\n## Owner decision\nx\n## Acceptance criteria covered\nx\n## How it was tested\n- [x] node --test\n## Sensitive areas touched\n- [ ] Pipeline\n';

test('local: a sensitive branch needs the box ticked; labels and the owner-decision label are named; no network', () => {
  const root = repo({ '.github/workflows/x.yml': 'on: push\n', '.claude/skills/a/SKILL.md': 'x\n' });
  const body = path.join(root, 'proc3-body.md');
  fs.writeFileSync(body, BODY);
  const bad = run(root, ['--title', 'PRC-02: x', '--body-file', body]);
  assert.equal(bad.code, 1, bad.stdout);
  assert.match(bad.stdout, /Labels CI will set: sensitive, sensitive:pipeline, owner-decision\./);
  assert.match(bad.stdout, /ERROR The PR changes sensitive files \(pipeline\): tick «Sensitive areas touched»/);
  fs.writeFileSync(body, BODY.replace('- [ ] Pipeline', '- [x] Pipeline'));
  const ok = run(root, ['--title', 'PRC-02: x', '--body-file', body]);
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /the CI job `traceability` will pass/);
  // A title without an existing requirement ID fails, as in CI.
  assert.match(run(root, ['--title', 'XYZ-99: x', '--body-file', body]).stdout, /docs\/requirements\/ has no file for it/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('local: a file renamed out of a sensitive path counts by its old name; missing flags exit 2', () => {
  const root = repo({ 'apps/web/x.ts': null });
  const body = path.join(root, 'proc3-body.md');
  fs.writeFileSync(body, BODY);
  const r = run(root, ['--title', 'PRC-02: x', '--body-file', body]);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /^  infrastructure: infra\/start\/x\.tf$/m);
  assert.equal(run(root, ['--body-file', body]).code, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('local: lists every changed file of a category and every rule file, not only the first ten (follow-up of #166)', () => {
  const files = {};
  for (let i = 1; i <= 12; i++) files[`.github/workflows/w${String(i).padStart(2, '0')}.yml`] = 'on: push\n';
  for (let i = 1; i <= 12; i++) files[`.claude/skills/s${String(i).padStart(2, '0')}/SKILL.md`] = 'x\n';
  const root = repo(files);
  const body = path.join(root, 'proc4-body.md');
  fs.writeFileSync(body, BODY.replace('- [ ] Pipeline', '- [x] Pipeline'));
  const r = run(root, ['--title', 'PRC-02: x', '--body-file', body]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /\.github\/workflows\/w12\.yml/);
  assert.match(r.stdout, /\.claude\/skills\/s12\/SKILL\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});
